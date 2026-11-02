import type { AppContainer } from './container.js';
import type { Actor, AttendanceId, AttendanceStatus, ClassId, UserId } from '../domain/shared/types.js';
import {
  ConflictError,
  NotFoundError,
  ValidationDomainError,
} from '../domain/shared/errors.js';
import { assertVersion } from '../domain/shared/value-objects.js';
import { Asistencia } from '../domain/attendance/entities.js';
import { requireRole, writeAudit, type RequestContext } from './shared/context.js';
import { enqueueTutorNotification } from './shared/notifications.js';
import {
  assertAlumnoAccess,
  assertCanManageMateria,
  assertMateriaAccess,
} from './shared/scoping.js';

export class AttendanceService {
  constructor(private readonly c: AppContainer) {}

  private async classContext(claseId: string) {
    const clase = await this.c.clases.findById(claseId);
    if (!clase) throw new NotFoundError('Clase');
    const materia = await this.c.materias.findById(clase.materiaId);
    if (!materia) throw new NotFoundError('Materia');
    return { clase, materia };
  }

  async listByClase(actor: Actor, claseId: string) {
    const { clase, materia } = await this.classContext(claseId);
    await assertMateriaAccess(this.c, actor, materia.id);
    const [alumnos, asistencias] = await Promise.all([
      this.c.alumnos.list({
        courseId: Number(materia.cursoDivisionTurnoId),
        limit: 500,
        offset: 0,
      }),
      this.c.asistencias.findByClase(claseId),
    ]);
    const byAlumno = new Map(asistencias.map((asistencia) => [asistencia.alumnoId, asistencia]));
    return {
      clase,
      alumnos: alumnos.map((alumno) => ({
        alumno,
        asistencia: byAlumno.get(alumno.id) ?? null,
      })),
    };
  }

  async listByAlumnoAndPeriodo(actor: Actor, alumnoId: string, periodoId: string) {
    await assertAlumnoAccess(this.c, actor, alumnoId);
    return this.c.asistencias.findByAlumnoAndPeriodo(alumnoId, periodoId);
  }

  async list(
    actor: Actor,
    filter: { claseId?: string; alumnoId?: string; limit: number; offset: number },
  ): Promise<Asistencia[]> {
    if (filter.claseId) {
      const { materia } = await this.classContext(filter.claseId);
      await assertMateriaAccess(this.c, actor, materia.id);
    }
    if (filter.alumnoId) {
      await assertAlumnoAccess(this.c, actor, filter.alumnoId);
    }
    return this.c.asistencias.list(filter);
  }

  async create(
    actor: Actor,
    input: { clase_id: string; alumno_id: string; estado: AttendanceStatus },
  ): Promise<Asistencia> {
    const { clase, materia } = await this.classContext(input.clase_id);
    await assertCanManageMateria(this.c, actor, materia.id);
    const alumno = await this.c.alumnos.findById(input.alumno_id);
    if (!alumno || !alumno.user.isActive) throw new NotFoundError('Alumno');
    if (alumno.cursoDivisionTurnoId !== materia.cursoDivisionTurnoId) {
      throw new ValidationDomainError('El alumno no pertenece al curso de la materia.');
    }
    if (!clase.canRegisterAttendance()) {
      throw new ConflictError('La clase debe estar dictada para registrar asistencia.');
    }
    const existing = await this.c.asistencias.findByClaseAndAlumno(clase.id, alumno.id);
    if (existing) throw new ConflictError('Ya existe asistencia para ese alumno en la clase.');
    if (input.estado === 'justificada') {
      throw new ValidationDomainError('Para justificar use PUT /asistencias/:id/justificacion.');
    }
    const created = await this.c.uow.transaction(async (tx) => {
      const asistencia = Asistencia.reconstitute({
        id: this.c.ids.uuid() as AttendanceId,
        claseId: clase.id as ClassId,
        alumnoId: alumno.id as UserId,
        estado: input.estado,
        justificacion: null,
        registradaPor: actor.id as UserId,
        version: 1,
        updatedAt: this.c.clock.now(),
      });
      await this.c.asistencias.save(asistencia, tx);
      await writeAudit(this.c, tx, {
        entidad: 'asistencias',
        entidadId: asistencia.id,
        accion: 'crear',
        actor,
        despues: {
          clase_id: asistencia.claseId,
          alumno_id: asistencia.alumnoId,
          estado: asistencia.estado,
        },
        requestId: null,
      });
      if (asistencia.estado === 'ausente') {
        await enqueueTutorNotification(this.c, tx, {
          alumnoId: asistencia.alumnoId,
          tipo: 'ausencia_registrada',
          payload: {
            asistencia_id: asistencia.id,
            clase_id: asistencia.claseId,
            alumno_id: asistencia.alumnoId,
            estado: asistencia.estado,
          },
          dedupeKey: `ausencia_registrada:${asistencia.id}`,
        });
      }
      return asistencia;
    });
    return created;
  }

  async update(
    actor: Actor,
    id: string,
    input: { estado: AttendanceStatus; motivo?: string; version?: number },
    ctx: RequestContext,
  ): Promise<Asistencia> {
    const asistencia = await this.c.asistencias.findById(id);
    if (!asistencia) throw new NotFoundError('Asistencia');
    const { materia } = await this.classContext(asistencia.claseId);
    await assertCanManageMateria(this.c, actor, materia.id);
    assertVersion(asistencia.version, input.version);
    const hoursSinceUpdate =
      (Date.now() - new Date(asistencia.updatedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceUpdate > 24 && !input.motivo?.trim()) {
      throw new ValidationDomainError('El motivo es obligatorio si pasaron más de 24 horas.');
    }
    const updated = Asistencia.reconstitute({
      id: asistencia.id,
      claseId: asistencia.claseId,
      alumnoId: asistencia.alumnoId,
      estado: asistencia.estado,
      justificacion: asistencia.justificacion,
      registradaPor: asistencia.registradaPor,
      version: asistencia.version,
      updatedAt: asistencia.updatedAt,
    });
    if (input.estado === 'justificada' && !input.motivo?.trim()) {
      throw new ValidationDomainError('La justificación es obligatoria para el estado justificada.');
    }
    updated.changeStatus(input.estado, input.motivo ?? null);
    await this.c.uow.transaction(async (tx) => {
      const saved = Asistencia.reconstitute({
        id: updated.id,
        claseId: updated.claseId,
        alumnoId: updated.alumnoId,
        estado: updated.estado,
        justificacion: updated.justificacion,
        registradaPor: actor.id as UserId,
        version: updated.version,
        updatedAt: this.c.clock.now(),
      });
      await this.c.asistencias.save(saved, tx);
      await writeAudit(this.c, tx, {
        entidad: 'asistencias',
        entidadId: id,
        accion: 'actualizar',
        actor,
        motivo: input.motivo ?? null,
        antes: { estado: asistencia.estado },
        despues: { estado: saved.estado, justificacion: saved.justificacion },
        requestId: ctx.requestId,
      });
      if (saved.estado === 'ausente' && asistencia.estado !== 'ausente') {
        await enqueueTutorNotification(this.c, tx, {
          alumnoId: saved.alumnoId,
          tipo: 'ausencia_registrada',
          payload: {
            asistencia_id: saved.id,
            clase_id: saved.claseId,
            alumno_id: saved.alumnoId,
            estado: saved.estado,
          },
          dedupeKey: `ausencia_registrada:${saved.id}:${this.c.clock.now()}`,
        });
      }
    });
    return (await this.c.asistencias.findById(id)) as Asistencia;
  }

  async justify(
    actor: Actor,
    id: string,
    justificacion: string,
    ctx: RequestContext,
  ): Promise<Asistencia> {
    const asistencia = await this.c.asistencias.findById(id);
    if (!asistencia) throw new NotFoundError('Asistencia');
    const { materia } = await this.classContext(asistencia.claseId);
    await assertCanManageMateria(this.c, actor, materia.id);
    const updated = Asistencia.reconstitute({
      id: asistencia.id,
      claseId: asistencia.claseId,
      alumnoId: asistencia.alumnoId,
      estado: asistencia.estado,
      justificacion: asistencia.justificacion,
      registradaPor: asistencia.registradaPor,
      version: asistencia.version,
      updatedAt: asistencia.updatedAt,
    });
    updated.justify(justificacion);
    await this.c.uow.transaction(async (tx) => {
      const saved = Asistencia.reconstitute({
        id: updated.id,
        claseId: updated.claseId,
        alumnoId: updated.alumnoId,
        estado: updated.estado,
        justificacion: updated.justificacion,
        registradaPor: actor.id as UserId,
        version: updated.version,
        updatedAt: this.c.clock.now(),
      });
      await this.c.asistencias.save(saved, tx);
      await writeAudit(this.c, tx, {
        entidad: 'asistencias',
        entidadId: id,
        accion: 'justificar',
        actor,
        motivo: justificacion,
        antes: { estado: asistencia.estado },
        despues: { estado: saved.estado, justificacion: saved.justificacion },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.asistencias.findById(id)) as Asistencia;
  }

  async listPeriodo(actor: Actor, periodoId: string, alumnoId?: string) {
    requireRole(actor, 'administrador', 'preceptor', 'docente', 'alumno', 'tutor');
    if (alumnoId) {
      await assertAlumnoAccess(this.c, actor, alumnoId);
      return this.c.asistencias.findByAlumnoAndPeriodo(alumnoId, periodoId);
    }
    if (actor.role !== 'administrador') {
      throw new ValidationDomainError('Debe indicar alumno_id.');
    }
    return [];
  }
}
