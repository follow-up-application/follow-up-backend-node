import type { AppContainer } from './container.js';
import type {
  Actor,
  Condition,
  ConditionId,
  EvaluationId,
  GradeId,
  PeriodCloseId,
  PeriodId,
  SubjectId,
  UserId,
} from '../domain/shared/types.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationDomainError,
} from '../domain/shared/errors.js';
import {
  assertVersion,
  nonEmptyString,
  parseGrade,
  parseLocalDate,
  parsePercentage,
} from '../domain/shared/value-objects.js';
import {
  Calificacion,
  CondicionAlumno,
  InstanciaEvaluacion,
  Periodo,
  PeriodoCierre,
  ReglaCondicion,
  calculateCondition,
  type ConditionRule,
} from '../domain/grading/entities.js';
import { requireRole, writeAudit, type RequestContext } from './shared/context.js';
import { enqueueTutorNotification } from './shared/notifications.js';
import {
  allowedCourseIds,
  assertAlumnoAccess,
  assertCanManageMateria,
  assertMateriaAccess,
  linkedAlumnoIds,
} from './shared/scoping.js';

const DEFAULT_RULE: ConditionRule = {
  asistencia_minima_pct: 75,
  nota_minima_regular: 6,
  nota_minima_promocion: 8,
  condicion_sin_datos: 'no_aplica',
};

function parseRule(input: unknown): ConditionRule {
  if (input === undefined || input === null) return { ...DEFAULT_RULE };
  if (typeof input !== 'object') {
    throw new ValidationDomainError('regla_default debe ser un objeto.');
  }
  const raw = input as Record<string, unknown>;
  const pct = Number(raw.asistencia_minima_pct ?? DEFAULT_RULE.asistencia_minima_pct);
  const regular = Number(raw.nota_minima_regular ?? DEFAULT_RULE.nota_minima_regular);
  const promocion = Number(raw.nota_minima_promocion ?? DEFAULT_RULE.nota_minima_promocion);
  const sinDatos = raw.condicion_sin_datos ?? DEFAULT_RULE.condicion_sin_datos;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new ValidationDomainError('asistencia_minima_pct debe estar entre 0 y 100.');
  }
  if (!Number.isFinite(regular) || regular < 0 || regular > 10) {
    throw new ValidationDomainError('nota_minima_regular debe estar entre 0 y 10.');
  }
  if (!Number.isFinite(promocion) || promocion < 0 || promocion > 10) {
    throw new ValidationDomainError('nota_minima_promocion debe estar entre 0 y 10.');
  }
  if (!['regular', 'libre', 'promocionado', 'no_aplica'].includes(String(sinDatos))) {
    throw new ValidationDomainError('condicion_sin_datos no es válida.');
  }
  return {
    asistencia_minima_pct: pct,
    nota_minima_regular: regular,
    nota_minima_promocion: promocion,
    condicion_sin_datos: sinDatos as Condition,
  };
}

function parsePeriodType(value: unknown): 'trimestre' | 'cuatrimestre' {
  if (value !== 'trimestre' && value !== 'cuatrimestre') {
    throw new ValidationDomainError('El tipo de período debe ser trimestre o cuatrimestre.');
  }
  return value;
}

function parseEvaluationType(
  value: unknown,
): 'parcial' | 'tp' | 'oral' | 'recuperatorio' | 'otro' {
  const allowed = ['parcial', 'tp', 'oral', 'recuperatorio', 'otro'] as const;
  if (!allowed.includes(value as (typeof allowed)[number])) {
    throw new ValidationDomainError('El tipo de evaluación no es válido.');
  }
  return value as (typeof allowed)[number];
}

export class GradingService {
  constructor(private readonly c: AppContainer) {}

  private async assertPeriodAccess(actor: Actor, periodo: Periodo): Promise<void> {
    if (actor.role === 'administrador') return;
    const allowed = await allowedCourseIds(this.c, actor);
    if (!allowed) return;
    if (allowed.length === 0) throw new NotFoundError('Período');
    const cursos = await Promise.all(allowed.map((id) => this.c.cursos.findById(id)));
    const cycles = new Set(cursos.filter(Boolean).map((curso) => curso!.cicloLectivoId));
    if (!cycles.has(periodo.cicloLectivoId)) throw new NotFoundError('Período');
  }

  async listPeriodos(
    actor: Actor,
    filter: { cicloId?: string; estado?: 'abierto' | 'cerrado'; limit: number; offset: number },
  ): Promise<Periodo[]> {
    if (actor.role === 'administrador') return this.c.periodos.list(filter);
    const allowed = await allowedCourseIds(this.c, actor);
    if (!allowed || allowed.length === 0) return [];
    const cursos = await Promise.all(allowed.map((id) => this.c.cursos.findById(id)));
    const cycles = new Set(cursos.filter(Boolean).map((curso) => curso!.cicloLectivoId));
    if (filter.cicloId && !cycles.has(filter.cicloId as never)) return [];
    const all = await this.c.periodos.list({
      cycleId: filter.cicloId,
      status: filter.estado,
      limit: 10_000,
      offset: 0,
    });
    return all
      .filter((periodo) => cycles.has(periodo.cicloLectivoId))
      .slice(filter.offset, filter.offset + filter.limit);
  }

  async getPeriodo(actor: Actor, id: string): Promise<Periodo> {
    const periodo = await this.c.periodos.findById(id);
    if (!periodo) throw new NotFoundError('Período');
    await this.assertPeriodAccess(actor, periodo);
    return periodo;
  }

  async createPeriodo(
    input: {
      ciclo_lectivo_id: string;
      nombre: string;
      tipo: 'trimestre' | 'cuatrimestre';
      fecha_inicio: string;
      fecha_fin: string;
      regla_default?: unknown;
    },
    ctx: RequestContext,
  ): Promise<Periodo> {
    requireRole(ctx.actor, 'administrador');
    const ciclo = await this.c.ciclos.findById(input.ciclo_lectivo_id);
    if (!ciclo) throw new NotFoundError('Ciclo lectivo');
    if (ciclo.isClosed()) throw new ConflictError('El ciclo lectivo está cerrado.');
    const inicio = parseLocalDate(input.fecha_inicio, 'fecha_inicio');
    const fin = parseLocalDate(input.fecha_fin, 'fecha_fin');
    if (fin <= inicio) throw new ValidationDomainError('fecha_fin debe ser posterior a fecha_inicio.');
    if (inicio < ciclo.fechaInicio || fin > ciclo.fechaFin) {
      throw new ValidationDomainError('El período debe estar dentro del ciclo lectivo.');
    }
    const rule = parseRule(input.regla_default);
    const id = this.c.ids.uuid();
    const created = await this.c.uow.transaction(async (tx) => {
      const periodo = Periodo.reconstitute({
        id: id as PeriodId,
        cicloLectivoId: ciclo.id,
        nombre: nonEmptyString(input.nombre, 'nombre', 100),
        tipo: parsePeriodType(input.tipo),
        fechaInicio: inicio,
        fechaFin: fin,
        estado: 'abierto',
        version: 1,
      });
      await this.c.periodos.save(periodo, tx);
      await this.c.reglas.save(
        ReglaCondicion.reconstitute({
          id: this.c.ids.uuid(),
          periodoId: periodo.id,
          materiaId: null,
          nombre: 'Regla por defecto',
          config: rule,
          activa: true,
          version: 1,
        }),
        tx,
      );
      await writeAudit(this.c, tx, {
        entidad: 'periodos',
        entidadId: periodo.id,
        accion: 'crear',
        actor: ctx.actor,
        despues: {
          ciclo_lectivo_id: periodo.cicloLectivoId,
          nombre: periodo.nombre,
          tipo: periodo.tipo,
          fecha_inicio: periodo.fechaInicio,
          fecha_fin: periodo.fechaFin,
          regla_default: rule,
        },
        requestId: ctx.requestId,
      });
      return periodo;
    });
    return created;
  }

  async updatePeriodo(
    id: string,
    input: {
      nombre?: string;
      fecha_inicio?: string;
      fecha_fin?: string;
      regla_default?: unknown;
      version?: number;
    },
    ctx: RequestContext,
  ): Promise<Periodo> {
    requireRole(ctx.actor, 'administrador');
    const periodo = await this.c.periodos.findById(id);
    if (!periodo) throw new NotFoundError('Período');
    if (!periodo.isOpen()) throw new ConflictError('El período está cerrado.');
    assertVersion(periodo.version, input.version);
    const ciclo = await this.c.ciclos.findById(periodo.cicloLectivoId);
    if (!ciclo) throw new NotFoundError('Ciclo lectivo');
    const inicio = input.fecha_inicio
      ? parseLocalDate(input.fecha_inicio, 'fecha_inicio')
      : periodo.fechaInicio;
    const fin = input.fecha_fin ? parseLocalDate(input.fecha_fin, 'fecha_fin') : periodo.fechaFin;
    if (fin <= inicio) throw new ValidationDomainError('fecha_fin debe ser posterior a fecha_inicio.');
    if (inicio < ciclo.fechaInicio || fin > ciclo.fechaFin) {
      throw new ValidationDomainError('El período debe estar dentro del ciclo lectivo.');
    }
    const updated = Periodo.reconstitute({
      id: periodo.id,
      cicloLectivoId: periodo.cicloLectivoId,
      nombre:
        input.nombre !== undefined
          ? nonEmptyString(input.nombre, 'nombre', 100)
          : periodo.nombre,
      tipo: periodo.tipo,
      fechaInicio: inicio,
      fechaFin: fin,
      estado: periodo.estado,
      version: periodo.version,
    });
    await this.c.uow.transaction(async (tx) => {
      await this.c.periodos.save(updated, tx);
      if (input.regla_default !== undefined) {
        const existing = await this.c.reglas.findForPeriodoAndMateria(periodo.id, null, tx);
        await this.c.reglas.save(
          ReglaCondicion.reconstitute({
            id: existing?.id ?? this.c.ids.uuid(),
            periodoId: periodo.id,
            materiaId: null,
            nombre: existing?.nombre ?? 'Regla por defecto',
            config: parseRule(input.regla_default),
            activa: true,
            version: existing?.version ?? 1,
          }),
          tx,
        );
      }
      await writeAudit(this.c, tx, {
        entidad: 'periodos',
        entidadId: id,
        accion: 'actualizar',
        actor: ctx.actor,
        antes: {
          nombre: periodo.nombre,
          fecha_inicio: periodo.fechaInicio,
          fecha_fin: periodo.fechaFin,
        },
        despues: {
          nombre: updated.nombre,
          fecha_inicio: updated.fechaInicio,
          fecha_fin: updated.fechaFin,
        },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.periodos.findById(id)) as Periodo;
  }

  async closePeriodo(id: string, ctx: RequestContext) {
    requireRole(ctx.actor, 'administrador');
    return this.c.uow.transaction(async (tx) => {
      const periodo = await this.c.periodos.findForUpdate(id, tx);
      if (!periodo) throw new NotFoundError('Período');
      const existingCierre = await this.c.cierres.findByPeriodo(id, tx);
      const existingConditions = await this.c.condiciones.findByPeriodo(
        id,
        { limit: 10_000, offset: 0 },
        tx,
      );
      if (!periodo.isOpen()) {
        return { cierre: existingCierre, condiciones: existingConditions };
      }
      const cierreId = this.c.ids.uuid() as PeriodCloseId;
      const now = this.c.clock.now();
      const cursos = await this.c.cursos.list({
        cicloId: periodo.cicloLectivoId,
        limit: 10_000,
        offset: 0,
      });
      const condiciones: CondicionAlumno[] = [];
      const alumnoIds = new Set<string>();
      for (const curso of cursos) {
        const materias = await this.c.materias.findByCourse(Number(curso.id), tx);
        for (const materia of materias) {
          const inscripciones = await this.c.inscripciones.findByMateria(
            materia.id,
            'aprobado',
            tx,
          );
          const instancias = await this.c.instancias.findByMateriaAndPeriodo(
            materia.id,
            periodo.id,
            tx,
          );
          const clases = await this.c.clases.findByMateriaAndRange(
            materia.id,
            periodo.fechaInicio,
            periodo.fechaFin,
            tx,
          );
          const reglaMateria = await this.c.reglas.findForPeriodoAndMateria(
            periodo.id,
            materia.id,
            tx,
          );
          const reglaDefault = await this.c.reglas.findForPeriodoAndMateria(
            periodo.id,
            null,
            tx,
          );
          const rule = (reglaMateria ?? reglaDefault)?.config ?? DEFAULT_RULE;
          const taughtClasses = clases.filter((clase) => clase.estado === 'dictada').length;
          for (const inscripcion of inscripciones) {
            alumnoIds.add(inscripcion.alumnoId);
            const grades = [];
            for (const instancia of instancias) {
              const grade = await this.c.calificaciones.findByInstanciaAndAlumno(
                instancia.id,
                inscripcion.alumnoId,
                tx,
              );
              if (grade && (grade.estado === 'activa' || grade.estado === 'rectificada')) {
                grades.push({
                  value: grade.valor,
                  weight: instancia.peso,
                  status: grade.estado as 'activa' | 'rectificada',
                });
              }
            }
            const asistencias = await this.c.asistencias.findByAlumnoAndPeriodo(
              inscripcion.alumnoId,
              periodo.id,
              tx,
            );
            const attendance = { present: 0, late: 0, justified: 0, absent: 0 };
            for (const asistencia of asistencias) {
              if (asistencia.estado === 'presente') attendance.present += 1;
              else if (asistencia.estado === 'tarde') attendance.late += 1;
              else if (asistencia.estado === 'justificada') attendance.justified += 1;
              else if (asistencia.estado === 'ausente') attendance.absent += 1;
            }
            const result = calculateCondition({
              grades,
              attendance,
              taughtClasses,
              rule,
            });
            condiciones.push(
              CondicionAlumno.reconstitute({
                id: this.c.ids.uuid() as ConditionId,
                periodoId: periodo.id,
                alumnoId: inscripcion.alumnoId,
                materiaId: materia.id as SubjectId,
                condicion: result.condition,
                promedio: result.average,
                porcentajeAsistencia: result.attendancePercentage,
                detalle: result.detail,
                calculadaEn: now,
                cierreId,
                version: 1,
              }),
            );
          }
        }
      }
      const resumen = {
        por_condicion: condiciones.reduce<Record<string, number>>((acc, condicion) => {
          acc[condicion.condicion] = (acc[condicion.condicion] ?? 0) + 1;
          return acc;
        }, {}),
      };
      const cierre = PeriodoCierre.reconstitute({
        id: cierreId,
        periodoId: periodo.id,
        ejecutadoPor: ctx.actor.id as UserId,
        ejecutadoEn: now,
        totalAlumnos: alumnoIds.size,
        totalCondiciones: condiciones.length,
        resumen,
      });
      await this.c.cierres.create(cierre, tx);
      await this.c.condiciones.replaceForPeriod(periodo.id, condiciones, tx);
      periodo.close();
      await this.c.periodos.save(periodo, tx);
      await writeAudit(this.c, tx, {
        entidad: 'periodos',
        entidadId: periodo.id,
        accion: 'cerrar',
        actor: ctx.actor,
        despues: {
          cierre_id: cierre.id,
          total_alumnos: cierre.totalAlumnos,
          total_condiciones: cierre.totalCondiciones,
        },
        requestId: ctx.requestId,
      });
      for (const alumnoId of alumnoIds) {
        await enqueueTutorNotification(this.c, tx, {
          alumnoId,
          tipo: 'periodo_cerrado',
          payload: {
            periodo_id: periodo.id,
            periodo_nombre: periodo.nombre,
            cierre_id: cierre.id,
            alumno_id: alumnoId,
            total_condiciones: cierre.totalCondiciones,
          },
          dedupeKey: `periodo_cerrado:${cierre.id}:${alumnoId}`,
        });
      }
      return { cierre, condiciones };
    });
  }

  async listCondiciones(
    actor: Actor,
    periodoId: string,
    filter: { materiaId?: number; limit: number; offset: number },
  ) {
    const periodo = await this.c.periodos.findById(periodoId);
    if (!periodo) throw new NotFoundError('Período');
    await this.assertPeriodAccess(actor, periodo);
    if (actor.role === 'administrador') {
      return this.c.condiciones.findByPeriodo(periodoId, filter);
    }
    if (filter.materiaId !== undefined) {
      await assertCanManageMateria(this.c, actor, filter.materiaId);
      return this.c.condiciones.findByPeriodo(periodoId, filter);
    }
    const allowed = await allowedCourseIds(this.c, actor);
    if (!allowed || allowed.length === 0) return [];
    const materias = [];
    for (const courseId of allowed) {
      materias.push(...(await this.c.materias.findByCourse(courseId)));
    }
    return this.c.condiciones.findByPeriodo(periodoId, {
      ...filter,
      materiaIds: materias.map((materia) => materia.id),
    });
  }

  async listInstancias(
    actor: Actor,
    filter: { materiaId?: number; periodId?: string; limit: number; offset: number },
  ) {
    requireRole(actor, 'administrador', 'docente');
    if (filter.materiaId !== undefined) {
      await assertCanManageMateria(this.c, actor, filter.materiaId);
      return this.c.instancias.list(filter);
    }
    if (actor.role === 'administrador') return this.c.instancias.list(filter);
    const materias = await this.c.materias.findByTeacher(actor.id);
    return this.c.instancias.list({
      ...filter,
      materiaIds: materias.map((materia) => materia.id),
    });
  }

  async getInstancia(actor: Actor, id: string): Promise<InstanciaEvaluacion> {
    const instancia = await this.c.instancias.findById(id);
    if (!instancia) throw new NotFoundError('Instancia de evaluación');
    await assertMateriaAccess(this.c, actor, instancia.materiaId);
    return instancia;
  }

  async createInstancia(
    actor: Actor,
    input: {
      materia_id: number;
      periodo_id: string;
      nombre: string;
      tipo: string;
      peso: string | number;
      fecha: string;
    },
  ): Promise<InstanciaEvaluacion> {
    const materia = await assertCanManageMateria(this.c, actor, input.materia_id);
    const periodo = await this.c.periodos.findById(input.periodo_id);
    if (!periodo) throw new NotFoundError('Período');
    if (!periodo.isOpen()) throw new ConflictError('El período está cerrado.');
    const fecha = parseLocalDate(input.fecha, 'fecha');
    if (fecha < periodo.fechaInicio || fecha > periodo.fechaFin) {
      throw new ValidationDomainError('La fecha debe estar dentro del período.');
    }
    const peso = parsePercentage(input.peso, 'peso');
    if (Number(peso) <= 0) throw new ValidationDomainError('El peso debe ser mayor a 0.');
    const created = await this.c.uow.transaction(async (tx) => {
      const instancia = await this.c.instancias.save(
        InstanciaEvaluacion.reconstitute({
          id: this.c.ids.uuid() as EvaluationId,
          materiaId: materia.id as SubjectId,
          periodoId: periodo.id,
          nombre: nonEmptyString(input.nombre, 'nombre', 150),
          tipo: parseEvaluationType(input.tipo),
          peso,
          fecha,
          createdBy: actor.id as UserId,
          version: 1,
        }),
        tx,
      );
      await writeAudit(this.c, tx, {
        entidad: 'instancias_evaluacion',
        entidadId: instancia.id,
        accion: 'crear',
        actor,
        despues: {
          materia_id: instancia.materiaId,
          periodo_id: instancia.periodoId,
          nombre: instancia.nombre,
          tipo: instancia.tipo,
          peso: instancia.peso,
          fecha: instancia.fecha,
        },
        requestId: null,
      });
      return instancia;
    });
    return created;
  }

  async updateInstancia(
    actor: Actor,
    id: string,
    input: {
      nombre?: string;
      tipo?: string;
      peso?: string | number;
      fecha?: string;
      version?: number;
    },
  ): Promise<InstanciaEvaluacion> {
    const instancia = await this.c.instancias.findById(id);
    if (!instancia) throw new NotFoundError('Instancia de evaluación');
    await assertCanManageMateria(this.c, actor, instancia.materiaId);
    const periodo = await this.c.periodos.findById(instancia.periodoId);
    if (!periodo) throw new NotFoundError('Período');
    if (!periodo.isOpen()) throw new ConflictError('El período está cerrado.');
    assertVersion(instancia.version, input.version);
    const fecha = input.fecha !== undefined ? parseLocalDate(input.fecha, 'fecha') : instancia.fecha;
    if (fecha < periodo.fechaInicio || fecha > periodo.fechaFin) {
      throw new ValidationDomainError('La fecha debe estar dentro del período.');
    }
    const updated = InstanciaEvaluacion.reconstitute({
      id: instancia.id,
      materiaId: instancia.materiaId,
      periodoId: instancia.periodoId,
      nombre:
        input.nombre !== undefined
          ? nonEmptyString(input.nombre, 'nombre', 150)
          : instancia.nombre,
      tipo: input.tipo !== undefined ? parseEvaluationType(input.tipo) : instancia.tipo,
      peso:
        input.peso !== undefined ? parsePercentage(input.peso, 'peso') : instancia.peso,
      fecha,
      createdBy: instancia.createdBy,
      version: instancia.version,
    });
    await this.c.uow.transaction(async (tx) => {
      await this.c.instancias.save(updated, tx);
      await writeAudit(this.c, tx, {
        entidad: 'instancias_evaluacion',
        entidadId: id,
        accion: 'actualizar',
        actor,
        antes: {
          nombre: instancia.nombre,
          tipo: instancia.tipo,
          peso: instancia.peso,
          fecha: instancia.fecha,
        },
        despues: {
          nombre: updated.nombre,
          tipo: updated.tipo,
          peso: updated.peso,
          fecha: updated.fecha,
        },
        requestId: null,
      });
    });
    return (await this.c.instancias.findById(id)) as InstanciaEvaluacion;
  }

  private async assertGradeAccess(actor: Actor, calificacion: Calificacion): Promise<void> {
    const instancia = await this.c.instancias.findById(calificacion.instanciaId);
    if (!instancia) throw new NotFoundError('Instancia de evaluación');
    if (actor.role === 'administrador') return;
    if (actor.role === 'alumno' && calificacion.alumnoId === actor.id) return;
    if (actor.role === 'docente') {
      const materia = await this.c.materias.findById(instancia.materiaId);
      if (materia?.docenteId === actor.id) return;
    }
    if (actor.role === 'tutor') {
      const ids = await linkedAlumnoIds(this.c, actor.id);
      if (ids.includes(calificacion.alumnoId)) return;
    }
    if (actor.role === 'preceptor') {
      const materia = await this.c.materias.findById(instancia.materiaId);
      const allowed = await allowedCourseIds(this.c, actor);
      if (materia && allowed?.includes(Number(materia.cursoDivisionTurnoId))) return;
    }
    throw new NotFoundError('Calificación');
  }

  async listCalificaciones(
    actor: Actor,
    filter: {
      instanciaId?: string;
      alumnoId?: string;
      periodId?: string;
      materiaId?: number;
      limit: number;
      offset: number;
    },
  ) {
    if (filter.materiaId !== undefined) {
      await assertMateriaAccess(this.c, actor, filter.materiaId);
    }
    if (filter.instanciaId) {
      const instancia = await this.c.instancias.findById(filter.instanciaId);
      if (!instancia) throw new NotFoundError('Instancia de evaluación');
      await assertMateriaAccess(this.c, actor, instancia.materiaId);
    }
    if (actor.role === 'administrador') return this.c.calificaciones.list(filter);
    if (actor.role === 'docente') {
      return this.c.calificaciones.list({ ...filter, teacherId: actor.id });
    }
    if (actor.role === 'preceptor') {
      const allowed = await allowedCourseIds(this.c, actor);
      if (!allowed || allowed.length === 0) return [];
      return this.c.calificaciones.list({ ...filter, courseIds: allowed });
    }
    if (actor.role === 'alumno') {
      if (filter.alumnoId && filter.alumnoId !== actor.id) throw new NotFoundError('Alumno');
      return this.c.calificaciones.list({ ...filter, alumnoId: actor.id });
    }
    if (actor.role === 'tutor') {
      const ids = await linkedAlumnoIds(this.c, actor.id);
      if (filter.alumnoId) {
        if (!ids.includes(filter.alumnoId)) throw new NotFoundError('Alumno');
        return this.c.calificaciones.list({ ...filter, alumnoId: filter.alumnoId });
      }
      if (ids.length === 0) return [];
      return this.c.calificaciones.list({ ...filter, alumnoIds: ids });
    }
    throw new ForbiddenError();
  }

  async getCalificacion(actor: Actor, id: string): Promise<Calificacion> {
    const calificacion = await this.c.calificaciones.findById(id);
    if (!calificacion) throw new NotFoundError('Calificación');
    await this.assertGradeAccess(actor, calificacion);
    return calificacion;
  }

  async createCalificacion(
    actor: Actor,
    input: { instancia_id: string; alumno_id: string; valor: string | number },
  ): Promise<Calificacion> {
    const instancia = await this.c.instancias.findById(input.instancia_id);
    if (!instancia) throw new NotFoundError('Instancia de evaluación');
    const materia = await assertCanManageMateria(this.c, actor, instancia.materiaId);
    const alumno = await this.c.alumnos.findById(input.alumno_id);
    if (!alumno || !alumno.user.isActive) throw new NotFoundError('Alumno');
    if (alumno.cursoDivisionTurnoId !== materia.cursoDivisionTurnoId) {
      throw new ValidationDomainError('El alumno no pertenece al curso de la materia.');
    }
    const inscripcion = await this.c.inscripciones.findActiveByAlumnoAndMateria(
      alumno.id,
      materia.id,
    );
    if (!inscripcion) {
      throw new ValidationDomainError('El alumno no tiene una inscripción activa en la materia.');
    }
    const valor = parseGrade(input.valor);
    const created = await this.c.uow.transaction(async (tx) => {
      const periodo = await this.c.periodos.findForUpdate(instancia.periodoId, tx);
      if (!periodo) throw new NotFoundError('Período');
      if (!periodo.isOpen()) throw new ConflictError('El período está cerrado.');
      const existing = await this.c.calificaciones.findByInstanciaAndAlumno(
        instancia.id,
        alumno.id,
        tx,
      );
      if (existing) throw new ConflictError('Ya existe una calificación para ese alumno.');
      const now = this.c.clock.now();
      const calificacion = Calificacion.reconstitute({
        id: this.c.ids.uuid() as GradeId,
        instanciaId: instancia.id,
        alumnoId: alumno.id,
        valor,
        estado: 'activa',
        version: 1,
        createdBy: actor.id as UserId,
        updatedBy: actor.id as UserId,
        rectificadaPor: null,
        rectificadaEn: null,
        motivoRectificacion: null,
        createdAt: now,
        updatedAt: now,
      });
      await this.c.calificaciones.save(calificacion, tx);
      await writeAudit(this.c, tx, {
        entidad: 'calificaciones',
        entidadId: calificacion.id,
        accion: 'crear',
        actor,
        despues: {
          instancia_id: calificacion.instanciaId,
          alumno_id: calificacion.alumnoId,
          valor: calificacion.valor,
          estado: calificacion.estado,
        },
        requestId: null,
      });
      await enqueueTutorNotification(this.c, tx, {
        alumnoId: calificacion.alumnoId,
        tipo: 'calificacion_creada',
        payload: {
          calificacion_id: calificacion.id,
          instancia_id: calificacion.instanciaId,
          materia_id: materia.id,
          alumno_id: calificacion.alumnoId,
          valor: calificacion.valor,
          estado: calificacion.estado,
        },
        dedupeKey: `calificacion_creada:${calificacion.id}`,
      });
      return calificacion;
    });
    return created;
  }

  async updateCalificacion(
    actor: Actor,
    id: string,
    input: { valor: string | number; version?: number; motivo?: string },
    ctx: RequestContext,
  ): Promise<Calificacion> {
    const calificacion = await this.c.calificaciones.findById(id);
    if (!calificacion) throw new NotFoundError('Calificación');
    const instancia = await this.c.instancias.findById(calificacion.instanciaId);
    if (!instancia) throw new NotFoundError('Instancia de evaluación');
    await assertCanManageMateria(this.c, actor, instancia.materiaId);
    await this.c.uow.transaction(async (tx) => {
      const periodo = await this.c.periodos.findForUpdate(instancia.periodoId, tx);
      if (!periodo) throw new NotFoundError('Período');
      if (!periodo.isOpen()) throw new ConflictError('El período está cerrado.');
      const current = await this.c.calificaciones.findForUpdate(id, tx);
      if (!current) throw new NotFoundError('Calificación');
      assertVersion(current.version, input.version);
      const valor = parseGrade(input.valor);
      const next = Calificacion.reconstitute({
        id: current.id,
        instanciaId: current.instanciaId,
        alumnoId: current.alumnoId,
        valor: current.valor,
        estado: current.estado,
        version: current.version,
        createdBy: current.createdBy,
        updatedBy: current.updatedBy,
        rectificadaPor: current.rectificadaPor,
        rectificadaEn: current.rectificadaEn,
        motivoRectificacion: current.motivoRectificacion,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      });
      if (current.estado === 'anulada') {
        next.replaceAnnulled(valor, input.motivo ?? '', actor.id as UserId);
      } else {
        next.changeValue(valor, actor.id as UserId);
      }
      await this.c.calificaciones.save(next, tx);
      await writeAudit(this.c, tx, {
        entidad: 'calificaciones',
        entidadId: id,
        accion: 'actualizar',
        actor,
        motivo: input.motivo ?? null,
        antes: { valor: current.valor, estado: current.estado },
        despues: { valor: next.valor, estado: next.estado },
        requestId: ctx.requestId,
      });
      await enqueueTutorNotification(this.c, tx, {
        alumnoId: next.alumnoId,
        tipo: 'calificacion_actualizada',
        payload: {
          calificacion_id: next.id,
          instancia_id: next.instanciaId,
          materia_id: instancia.materiaId,
          alumno_id: next.alumnoId,
          valor_anterior: current.valor,
          valor: next.valor,
          estado: next.estado,
          motivo: input.motivo ?? null,
        },
        dedupeKey: `calificacion_actualizada:${next.id}:${this.c.clock.now()}`,
      });
      return next;
    });
    return (await this.c.calificaciones.findById(id)) as Calificacion;
  }

  async annulCalificacion(
    actor: Actor,
    id: string,
    motivo: string,
    ctx: RequestContext,
  ): Promise<Calificacion> {
    const calificacion = await this.c.calificaciones.findById(id);
    if (!calificacion) throw new NotFoundError('Calificación');
    const instancia = await this.c.instancias.findById(calificacion.instanciaId);
    if (!instancia) throw new NotFoundError('Instancia de evaluación');
    await assertCanManageMateria(this.c, actor, instancia.materiaId);
    await this.c.uow.transaction(async (tx) => {
      const periodo = await this.c.periodos.findForUpdate(instancia.periodoId, tx);
      if (!periodo) throw new NotFoundError('Período');
      if (!periodo.isOpen()) throw new ConflictError('El período está cerrado.');
      const current = await this.c.calificaciones.findForUpdate(id, tx);
      if (!current) throw new NotFoundError('Calificación');
      const next = Calificacion.reconstitute({
        id: current.id,
        instanciaId: current.instanciaId,
        alumnoId: current.alumnoId,
        valor: current.valor,
        estado: current.estado,
        version: current.version,
        createdBy: current.createdBy,
        updatedBy: current.updatedBy,
        rectificadaPor: current.rectificadaPor,
        rectificadaEn: current.rectificadaEn,
        motivoRectificacion: current.motivoRectificacion,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      });
      next.annul(motivo, actor.id as UserId);
      await this.c.calificaciones.save(next, tx);
      await writeAudit(this.c, tx, {
        entidad: 'calificaciones',
        entidadId: id,
        accion: 'actualizar',
        actor,
        motivo,
        antes: { estado: current.estado },
        despues: { estado: next.estado },
        requestId: ctx.requestId,
      });
      await enqueueTutorNotification(this.c, tx, {
        alumnoId: next.alumnoId,
        tipo: 'calificacion_anulada',
        payload: {
          calificacion_id: next.id,
          instancia_id: next.instanciaId,
          materia_id: instancia.materiaId,
          alumno_id: next.alumnoId,
          valor: next.valor,
          estado: next.estado,
          motivo,
        },
        dedupeKey: `calificacion_anulada:${next.id}:${this.c.clock.now()}`,
      });
    });
    return (await this.c.calificaciones.findById(id)) as Calificacion;
  }

  async historialCalificacion(actor: Actor, id: string) {
    const calificacion = await this.c.calificaciones.findById(id);
    if (!calificacion) throw new NotFoundError('Calificación');
    await this.assertGradeAccess(actor, calificacion);
    return this.c.auditoria.list({
      entity: 'calificaciones',
      entityId: id,
      limit: 100,
      offset: 0,
    });
  }

  async rectifyCalificacion(
    actor: Actor,
    id: string,
    input: { valor: string | number; motivo: string },
    ctx: RequestContext,
  ): Promise<Calificacion> {
    requireRole(actor, 'administrador');
    const calificacion = await this.c.calificaciones.findById(id);
    if (!calificacion) throw new NotFoundError('Calificación');
    const instancia = await this.c.instancias.findById(calificacion.instanciaId);
    if (!instancia) throw new NotFoundError('Instancia de evaluación');
    await this.c.uow.transaction(async (tx) => {
      const periodo = await this.c.periodos.findForUpdate(instancia.periodoId, tx);
      if (!periodo) throw new NotFoundError('Período');
      if (periodo.isOpen()) {
        throw new ConflictError('Solo se rectifican calificaciones de períodos cerrados.');
      }
      const current = await this.c.calificaciones.findForUpdate(id, tx);
      if (!current) throw new NotFoundError('Calificación');
      const next = Calificacion.reconstitute({
        id: current.id,
        instanciaId: current.instanciaId,
        alumnoId: current.alumnoId,
        valor: current.valor,
        estado: current.estado,
        version: current.version,
        createdBy: current.createdBy,
        updatedBy: current.updatedBy,
        rectificadaPor: current.rectificadaPor,
        rectificadaEn: current.rectificadaEn,
        motivoRectificacion: current.motivoRectificacion,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      });
      next.rectify(parseGrade(input.valor), input.motivo, actor.id as UserId, this.c.clock.now());
      await this.c.calificaciones.save(next, tx);
      await writeAudit(this.c, tx, {
        entidad: 'calificaciones',
        entidadId: id,
        accion: 'rectificar',
        actor,
        motivo: input.motivo,
        antes: { valor: current.valor, estado: current.estado },
        despues: { valor: next.valor, estado: next.estado },
        requestId: ctx.requestId,
      });
      await enqueueTutorNotification(this.c, tx, {
        alumnoId: next.alumnoId,
        tipo: 'calificacion_rectificada',
        payload: {
          calificacion_id: next.id,
          instancia_id: next.instanciaId,
          materia_id: instancia.materiaId,
          alumno_id: next.alumnoId,
          valor_anterior: current.valor,
          valor: next.valor,
          estado: next.estado,
          motivo: input.motivo,
        },
        dedupeKey: `calificacion_rectificada:${next.id}:${this.c.clock.now()}`,
      });
    });
    return (await this.c.calificaciones.findById(id)) as Calificacion;
  }

  async condicionAlumno(actor: Actor, alumnoId: string, periodoId: string) {
    await assertAlumnoAccess(this.c, actor, alumnoId);
    const periodo = await this.c.periodos.findById(periodoId);
    if (!periodo) throw new NotFoundError('Período');
    await this.assertPeriodAccess(actor, periodo);
    return this.c.condiciones.findByAlumnoAndPeriodo(alumnoId, periodoId);
  }
}
