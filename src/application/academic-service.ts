import type { AppContainer } from './container.js';
import type { Actor, LocalDate, LocalTime } from '../domain/shared/types.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationDomainError,
} from '../domain/shared/errors.js';
import {
  assertVersion,
  nonEmptyString,
  parseLocalDate,
  parseLocalTime,
  todayIso,
} from '../domain/shared/value-objects.js';
import {
  CicloLectivo,
  Clase,
  CursoDivisionTurno,
  Inscripcion,
  Materia,
} from '../domain/academic/entities.js';
import type { EnrollmentStatus } from '../domain/shared/types.js';
import { requireRole, writeAudit, type RequestContext } from './shared/context.js';
import {
  allowedCourseIds,
  assertCourseAccess,
  assertMateriaAccess,
  assertTeacherOfMateria,
  linkedAlumnoIds,
} from './shared/scoping.js';

function parseTurno(value: unknown): 'Mañana' | 'Tarde' {
  if (value !== 'Mañana' && value !== 'Tarde') {
    throw new ValidationDomainError('El turno debe ser "Mañana" o "Tarde".');
  }
  return value;
}

function parseCourseNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 7) {
    throw new ValidationDomainError('El curso debe ser un entero entre 1 y 7.');
  }
  return n;
}

function parseCapacity(value: unknown, fallback = 30): number {
  if (value === undefined) return fallback;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100) {
    throw new ValidationDomainError('La capacidad máxima debe estar entre 1 y 100.');
  }
  return n;
}

function parsePeso(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 100) {
    throw new ValidationDomainError('El peso debe estar entre 0 y 100.');
  }
  return n;
}

export class AcademicService {
  constructor(private readonly c: AppContainer) {}

  private async resolveCycle(cicloLectivoId?: string): Promise<CicloLectivo> {
    if (cicloLectivoId) {
      const ciclo = await this.c.ciclos.findById(cicloLectivoId);
      if (!ciclo) throw new NotFoundError('Ciclo lectivo');
      return ciclo;
    }
    const active = (await this.c.ciclos.list()).filter((ciclo) => ciclo.estado === 'activo');
    if (active.length !== 1) {
      throw new ValidationDomainError(
        'No hay un único ciclo lectivo activo; indique ciclo_lectivo_id.',
        [{ path: 'body.ciclo_lectivo_id', code: 'custom', message: 'Ciclo activo ambiguo.' }],
      );
    }
    return active[0] as CicloLectivo;
  }

  private async cycleForCourse(courseId: number): Promise<CicloLectivo> {
    const curso = await this.c.cursos.findById(courseId);
    if (!curso) throw new NotFoundError('Curso');
    const ciclo = await this.c.ciclos.findById(curso.cicloLectivoId);
    if (!ciclo) throw new NotFoundError('Ciclo lectivo');
    return ciclo;
  }

  async listCursos(
    actor: Actor,
    filter: { cicloId?: string; limit: number; offset: number },
  ): Promise<CursoDivisionTurno[]> {
    const allowed = await allowedCourseIds(this.c, actor);
    if (allowed && allowed.length === 0) return [];
    return this.c.cursos.list({
      cicloId: filter.cicloId,
      courseIds: allowed ?? undefined,
      limit: filter.limit,
      offset: filter.offset,
    });
  }

  async createCurso(
    input: {
      ciclo_lectivo_id?: string;
      curso: number;
      division: string;
      turno: 'Mañana' | 'Tarde';
      capacidad_maxima?: number;
    },
    ctx: RequestContext,
  ): Promise<CursoDivisionTurno> {
    requireRole(ctx.actor, 'administrador');
    const ciclo = await this.resolveCycle(input.ciclo_lectivo_id);
    if (ciclo.isClosed()) throw new ConflictError('El ciclo lectivo está cerrado.');
    const cursoNumber = parseCourseNumber(input.curso);
    const division = nonEmptyString(input.division, 'division', 10);
    const turno = parseTurno(input.turno);
    const capacity = parseCapacity(input.capacidad_maxima);
    const existing = await this.c.cursos.findByAttributes(
      ciclo.id,
      cursoNumber,
      division,
      turno,
    );
    if (existing) throw new ConflictError('Ya existe ese curso, división y turno en el ciclo.');
    let created: CursoDivisionTurno | null = null;
    await this.c.uow.transaction(async (tx) => {
      const curso = await this.c.cursos.save(
        CursoDivisionTurno.reconstitute({
          id: 0,
          cicloLectivoId: ciclo.id,
          curso: cursoNumber,
          division,
          turno,
          capacidadMaxima: capacity,
          version: 1,
        }),
        tx,
      );
      await writeAudit(this.c, tx, {
        entidad: 'curso_division_turno',
        entidadId: String(curso.id),
        accion: 'crear',
        actor: ctx.actor,
        despues: {
          ciclo_lectivo_id: ciclo.id,
          curso: curso.curso,
          division: curso.division,
          turno: curso.turno,
          capacidad_maxima: curso.capacidadMaxima,
        },
        requestId: ctx.requestId,
      });
      created = curso;
    });
    return created as unknown as CursoDivisionTurno;
  }

  async getCurso(actor: Actor, id: number): Promise<CursoDivisionTurno> {
    return assertCourseAccess(this.c, actor, id);
  }

  async updateCurso(
    id: number,
    input: {
      curso?: number;
      division?: string;
      turno?: 'Mañana' | 'Tarde';
      capacidad_maxima?: number;
      version?: number;
    },
    ctx: RequestContext,
  ): Promise<CursoDivisionTurno> {
    requireRole(ctx.actor, 'administrador');
    const curso = await this.c.cursos.findById(id);
    if (!curso) throw new NotFoundError('Curso');
    assertVersion(curso.version, input.version);
    const ciclo = await this.c.ciclos.findById(curso.cicloLectivoId);
    if (ciclo?.isClosed()) throw new ConflictError('El ciclo lectivo está cerrado.');
    const cursoNumber = input.curso !== undefined ? parseCourseNumber(input.curso) : curso.curso;
    const division =
      input.division !== undefined ? nonEmptyString(input.division, 'division', 10) : curso.division;
    const turno = input.turno !== undefined ? parseTurno(input.turno) : curso.turno;
    const capacity =
      input.capacidad_maxima !== undefined ? parseCapacity(input.capacidad_maxima) : curso.capacidadMaxima;
    const currentStudents = await this.c.cursos.countStudents(id);
    if (capacity < currentStudents) {
      throw new ValidationDomainError('La capacidad no puede ser menor a la cantidad de alumnos.');
    }
    const existing = await this.c.cursos.findByAttributes(
      curso.cicloLectivoId,
      cursoNumber,
      division,
      turno,
    );
    if (existing && existing.id !== curso.id) {
      throw new ConflictError('Ya existe ese curso, división y turno en el ciclo.');
    }
    const updated = CursoDivisionTurno.reconstitute({
      id: curso.id,
      cicloLectivoId: curso.cicloLectivoId,
      curso: cursoNumber,
      division,
      turno,
      capacidadMaxima: capacity,
      version: curso.version,
    });
    await this.c.uow.transaction(async (tx) => {
      await this.c.cursos.save(updated, tx);
      await writeAudit(this.c, tx, {
        entidad: 'curso_division_turno',
        entidadId: String(id),
        accion: 'actualizar',
        actor: ctx.actor,
        antes: {
          curso: curso.curso,
          division: curso.division,
          turno: curso.turno,
          capacidad_maxima: curso.capacidadMaxima,
        },
        despues: {
          curso: updated.curso,
          division: updated.division,
          turno: updated.turno,
          capacidad_maxima: updated.capacidadMaxima,
        },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.cursos.findById(id)) as CursoDivisionTurno;
  }

  async deleteCurso(id: number, ctx: RequestContext): Promise<void> {
    requireRole(ctx.actor, 'administrador');
    const curso = await this.c.cursos.findById(id);
    if (!curso) throw new NotFoundError('Curso');
    const students = await this.c.cursos.countStudents(id);
    const materias = await this.c.materias.findByCourse(id);
    const clases = await this.c.clases.list({ courseId: id, limit: 1, offset: 0 });
    if (students > 0 || materias.length > 0 || clases.length > 0) {
      throw new ConflictError('El curso tiene alumnos, materias o clases asociadas.');
    }
    await this.c.uow.transaction(async (tx) => {
      await this.c.cursos.delete(id, tx);
      await writeAudit(this.c, tx, {
        entidad: 'curso_division_turno',
        entidadId: String(id),
        accion: 'eliminar',
        actor: ctx.actor,
        antes: { curso: curso.displayName() },
        requestId: ctx.requestId,
      });
    });
  }

  async listCursoAlumnos(actor: Actor, id: number) {
    const curso = await assertCourseAccess(this.c, actor, id);
    if (actor.role === 'alumno' || actor.role === 'tutor') {
      throw new ForbiddenError();
    }
    return this.c.alumnos.list({ courseId: Number(curso.id), limit: 500, offset: 0 });
  }

  async listCursoMaterias(actor: Actor, id: number): Promise<Materia[]> {
    await assertCourseAccess(this.c, actor, id);
    return this.c.materias.findByCourse(id);
  }

  async listMaterias(
    actor: Actor,
    filter: { courseId?: number; teacherId?: string; limit: number; offset: number },
  ): Promise<Materia[]> {
    if (filter.courseId !== undefined) {
      await assertCourseAccess(this.c, actor, filter.courseId);
    }
    if (actor.role === 'administrador') {
      return this.c.materias.list(filter);
    }
    if (actor.role === 'docente') {
      return this.c.materias.list({
        ...filter,
        teacherId: filter.teacherId && filter.teacherId !== actor.id ? '__none__' : actor.id,
      });
    }
    const allowed = await allowedCourseIds(this.c, actor);
    if (!allowed || allowed.length === 0) return [];
    return this.c.materias.list({ ...filter, courseIds: allowed });
  }

  async createMateria(
    input: {
      nombre: string;
      descripcion: string;
      curso_division_turno_id: number;
      docente_id: string;
    },
    ctx: RequestContext,
  ): Promise<Materia> {
    requireRole(ctx.actor, 'administrador');
    const curso = await this.c.cursos.findById(input.curso_division_turno_id);
    if (!curso) throw new NotFoundError('Curso');
    const ciclo = await this.c.ciclos.findById(curso.cicloLectivoId);
    if (ciclo?.isClosed()) throw new ConflictError('El ciclo lectivo está cerrado.');
    const docente = await this.c.docentes.findById(input.docente_id);
    if (!docente || !docente.user.isActive) throw new NotFoundError('Docente');
    let created: Materia | null = null;
    await this.c.uow.transaction(async (tx) => {
      const materia = await this.c.materias.save(
        Materia.reconstitute({
          id: 0,
          nombre: nonEmptyString(input.nombre, 'nombre', 150),
          descripcion: nonEmptyString(input.descripcion, 'descripcion', 1000),
          cursoDivisionTurnoId: curso.id,
          docenteId: docente.id,
          version: 1,
        }),
        tx,
      );
      await writeAudit(this.c, tx, {
        entidad: 'materias',
        entidadId: String(materia.id),
        accion: 'crear',
        actor: ctx.actor,
        despues: {
          nombre: materia.nombre,
          curso_division_turno_id: materia.cursoDivisionTurnoId,
          docente_id: materia.docenteId,
        },
        requestId: ctx.requestId,
      });
      created = materia;
    });
    return created as unknown as Materia;
  }

  async getMateria(actor: Actor, id: number): Promise<Materia> {
    return assertMateriaAccess(this.c, actor, id);
  }

  async updateMateria(
    id: number,
    input: {
      nombre?: string;
      descripcion?: string;
      curso_division_turno_id?: number;
      docente_id?: string;
      version?: number;
    },
    ctx: RequestContext,
  ): Promise<Materia> {
    requireRole(ctx.actor, 'administrador');
    const materia = await this.c.materias.findById(id);
    if (!materia) throw new NotFoundError('Materia');
    assertVersion(materia.version, input.version);
    const nombre =
      input.nombre !== undefined ? nonEmptyString(input.nombre, 'nombre', 150) : materia.nombre;
    const descripcion =
      input.descripcion !== undefined
        ? nonEmptyString(input.descripcion, 'descripcion', 1000)
        : materia.descripcion;
    let courseId = materia.cursoDivisionTurnoId;
    if (input.curso_division_turno_id !== undefined) {
      const curso = await this.c.cursos.findById(input.curso_division_turno_id);
      if (!curso) throw new NotFoundError('Curso');
      const ciclo = await this.c.ciclos.findById(curso.cicloLectivoId);
      if (ciclo?.isClosed()) throw new ConflictError('El ciclo lectivo está cerrado.');
      courseId = curso.id;
    }
    let docenteId = materia.docenteId;
    if (input.docente_id !== undefined) {
      const docente = await this.c.docentes.findById(input.docente_id);
      if (!docente || !docente.user.isActive) throw new NotFoundError('Docente');
      docenteId = docente.id;
    }
    const updated = Materia.reconstitute({
      id: materia.id,
      nombre,
      descripcion,
      cursoDivisionTurnoId: courseId,
      docenteId,
      version: materia.version,
    });
    await this.c.uow.transaction(async (tx) => {
      await this.c.materias.save(updated, tx);
      await writeAudit(this.c, tx, {
        entidad: 'materias',
        entidadId: String(id),
        accion: 'actualizar',
        actor: ctx.actor,
        antes: {
          nombre: materia.nombre,
          descripcion: materia.descripcion,
          curso_division_turno_id: materia.cursoDivisionTurnoId,
          docente_id: materia.docenteId,
        },
        despues: {
          nombre: updated.nombre,
          descripcion: updated.descripcion,
          curso_division_turno_id: updated.cursoDivisionTurnoId,
          docente_id: updated.docenteId,
        },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.materias.findById(id)) as Materia;
  }

  async deleteMateria(id: number, ctx: RequestContext): Promise<void> {
    requireRole(ctx.actor, 'administrador');
    const materia = await this.c.materias.findById(id);
    if (!materia) throw new NotFoundError('Materia');
    const [inscripciones, clases, calificaciones] = await Promise.all([
      this.c.inscripciones.list({ materiaId: id, limit: 1, offset: 0 }),
      this.c.clases.list({ materiaId: id, limit: 1, offset: 0 }),
      this.c.calificaciones.list({ materiaId: id, limit: 1, offset: 0 }),
    ]);
    if (inscripciones.length > 0 || clases.length > 0 || calificaciones.length > 0) {
      throw new ConflictError('La materia tiene inscripciones, clases o calificaciones asociadas.');
    }
    await this.c.uow.transaction(async (tx) => {
      await this.c.materias.delete(id, tx);
      await writeAudit(this.c, tx, {
        entidad: 'materias',
        entidadId: String(id),
        accion: 'eliminar',
        actor: ctx.actor,
        antes: { nombre: materia.nombre },
        requestId: ctx.requestId,
      });
    });
  }

  async listDocenteMaterias(actor: Actor, docenteId: string): Promise<Materia[]> {
    if (actor.role === 'administrador') return this.c.materias.findByTeacher(docenteId);
    if (actor.role === 'docente' && actor.id === docenteId) {
      return this.c.materias.findByTeacher(docenteId);
    }
    const allowed = await allowedCourseIds(this.c, actor);
    const materias = await this.c.materias.findByTeacher(docenteId);
    if (!allowed) return materias;
    return materias.filter((materia) => allowed.includes(Number(materia.cursoDivisionTurnoId)));
  }

  async listMateriaInscripciones(
    actor: Actor,
    materiaId: number,
    estado?: EnrollmentStatus,
  ): Promise<Inscripcion[]> {
    const materia = await assertTeacherOfMateria(this.c, actor, materiaId);
    return this.c.inscripciones.findByMateria(materia.id, estado);
  }

  async listInscripciones(
    actor: Actor,
    filter: { alumnoId?: string; materiaId?: number; limit: number; offset: number },
  ): Promise<Inscripcion[]> {
    if (filter.materiaId !== undefined) {
      await assertMateriaAccess(this.c, actor, filter.materiaId);
    }
    if (actor.role === 'administrador') {
      return this.c.inscripciones.list(filter);
    }
    if (actor.role === 'docente') {
      return this.c.inscripciones.list({ ...filter, teacherId: actor.id });
    }
    if (actor.role === 'alumno') {
      if (filter.alumnoId && filter.alumnoId !== actor.id) throw new NotFoundError('Alumno');
      return this.c.inscripciones.list({ ...filter, alumnoId: actor.id });
    }
    if (actor.role === 'tutor') {
      const ids = await linkedAlumnoIds(this.c, actor.id);
      if (filter.alumnoId) {
        if (!ids.includes(filter.alumnoId)) throw new NotFoundError('Alumno');
        return this.c.inscripciones.list({ ...filter, alumnoId: filter.alumnoId });
      }
      if (ids.length === 0) return [];
      return this.c.inscripciones.list({ ...filter, alumnoIds: ids });
    }
    throw new ForbiddenError();
  }

  async createInscripcion(
    actor: Actor,
    input: { alumno_id: string; materia_id: number; fecha_inscripcion?: string },
  ): Promise<Inscripcion> {
    requireRole(actor, 'administrador', 'alumno');
    if (actor.role === 'alumno' && input.alumno_id !== actor.id) {
      throw new ForbiddenError('Solo puede inscribirse a sí mismo.');
    }
    const alumno = await this.c.alumnos.findById(input.alumno_id);
    if (!alumno || !alumno.user.isActive) throw new NotFoundError('Alumno');
    const materia = await this.c.materias.findById(input.materia_id);
    if (!materia) throw new NotFoundError('Materia');
    if (alumno.cursoDivisionTurnoId !== materia.cursoDivisionTurnoId) {
      throw new ValidationDomainError('El alumno no pertenece al curso de la materia.');
    }
    const existing = await this.c.inscripciones.findActiveByAlumnoAndMateria(
      alumno.id,
      materia.id,
    );
    if (existing) throw new ConflictError('Ya existe una inscripción activa a esa materia.');
    const fecha = input.fecha_inscripcion
      ? parseLocalDate(input.fecha_inscripcion, 'fecha_inscripcion')
      : todayIso();
    const created = await this.c.uow.transaction(async (tx) => {
      const inscripcion = await this.c.inscripciones.save(
        Inscripcion.reconstitute({
          id: 0,
          alumnoId: alumno.id,
          materiaId: materia.id,
          fechaInscripcion: fecha,
          estado: 'pendiente',
          version: 1,
        }),
        tx,
      );
      await writeAudit(this.c, tx, {
        entidad: 'inscripciones',
        entidadId: String(inscripcion.id),
        accion: 'crear',
        actor,
        despues: {
          alumno_id: alumno.id,
          materia_id: materia.id,
          fecha_inscripcion: fecha,
          estado: 'pendiente',
        },
        requestId: null,
      });
      return inscripcion;
    });
    return created;
  }

  async getInscripcion(actor: Actor, id: number): Promise<Inscripcion> {
    const inscripcion = await this.c.inscripciones.findById(id);
    if (!inscripcion) throw new NotFoundError('Inscripción');
    if (actor.role === 'administrador') return inscripcion;
    if (actor.role === 'alumno' && inscripcion.alumnoId === actor.id) return inscripcion;
    if (actor.role === 'docente') {
      const materia = await this.c.materias.findById(inscripcion.materiaId);
      if (materia?.docenteId === actor.id) return inscripcion;
    }
    if (actor.role === 'tutor') {
      const ids = await linkedAlumnoIds(this.c, actor.id);
      if (ids.includes(inscripcion.alumnoId)) return inscripcion;
    }
    throw new NotFoundError('Inscripción');
  }

  async updateInscripcionEstado(
    id: number,
    estado: EnrollmentStatus,
    ctx: RequestContext,
  ): Promise<Inscripcion> {
    const inscripcion = await this.c.inscripciones.findById(id);
    if (!inscripcion) throw new NotFoundError('Inscripción');
    const materia = await assertTeacherOfMateria(this.c, ctx.actor, inscripcion.materiaId);
    const updated = Inscripcion.reconstitute({
      id: inscripcion.id,
      alumnoId: inscripcion.alumnoId,
      materiaId: inscripcion.materiaId,
      fechaInscripcion: inscripcion.fechaInscripcion,
      estado: inscripcion.estado,
      version: inscripcion.version,
    });
    if (estado === 'aprobado') updated.approve();
    else if (estado === 'rechazado') updated.reject();
    else if (estado === 'cancelado') updated.cancel();
    else throw new ValidationDomainError('Transición de estado no permitida.');
    await this.c.uow.transaction(async (tx) => {
      await this.c.inscripciones.save(updated, tx);
      await writeAudit(this.c, tx, {
        entidad: 'inscripciones',
        entidadId: String(id),
        accion: 'actualizar',
        actor: ctx.actor,
        antes: { estado: inscripcion.estado },
        despues: { estado: updated.estado, materia_id: materia.id },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.inscripciones.findById(id)) as Inscripcion;
  }

  async deleteInscripcion(id: number, ctx: RequestContext): Promise<void> {
    requireRole(ctx.actor, 'administrador');
    const inscripcion = await this.c.inscripciones.findById(id);
    if (!inscripcion) throw new NotFoundError('Inscripción');
    if (inscripcion.estado === 'cancelado') return;
    if (inscripcion.estado === 'rechazado') {
      throw new ConflictError('Una inscripción rechazada no puede cancelarse.');
    }
    await this.c.uow.transaction(async (tx) => {
      const updated = Inscripcion.reconstitute({
        id: inscripcion.id,
        alumnoId: inscripcion.alumnoId,
        materiaId: inscripcion.materiaId,
        fechaInscripcion: inscripcion.fechaInscripcion,
        estado: inscripcion.estado,
        version: inscripcion.version,
      });
      updated.cancel();
      await this.c.inscripciones.save(updated, tx);
      await writeAudit(this.c, tx, {
        entidad: 'inscripciones',
        entidadId: String(id),
        accion: 'desactivar',
        actor: ctx.actor,
        antes: { estado: inscripcion.estado },
        despues: { estado: 'cancelado' },
        requestId: ctx.requestId,
      });
    });
  }

  async listClases(
    actor: Actor,
    filter: {
      materiaId?: number;
      courseId?: number;
      from?: string;
      to?: string;
      limit: number;
      offset: number;
    },
  ) {
    if (filter.materiaId !== undefined) {
      await assertMateriaAccess(this.c, actor, filter.materiaId);
    }
    if (filter.courseId !== undefined) {
      await assertCourseAccess(this.c, actor, filter.courseId);
    }
    if (actor.role === 'administrador') {
      return this.c.clases.list(filter);
    }
    if (actor.role === 'docente') {
      return this.c.clases.list({ ...filter, teacherId: actor.id });
    }
    const allowed = await allowedCourseIds(this.c, actor);
    if (!allowed || allowed.length === 0) return [];
    return this.c.clases.list({ ...filter, courseIds: allowed });
  }

  async createClase(
    actor: Actor,
    input: {
      materia_id: number;
      fecha: string;
      hora_inicio: string;
      hora_fin: string;
      tema: string;
    },
  ): Promise<Clase> {
    const materia = await assertTeacherOfMateria(this.c, actor, input.materia_id);
    const ciclo = await this.cycleForCourse(materia.cursoDivisionTurnoId);
    if (ciclo.isClosed()) throw new ConflictError('El ciclo lectivo está cerrado.');
    const fecha = parseLocalDate(input.fecha, 'fecha');
    if (!ciclo.contains(fecha)) {
      throw new ValidationDomainError('La fecha debe pertenecer al ciclo lectivo de la materia.');
    }
    const created = await this.c.uow.transaction(async (tx) => {
      const clase = await this.c.clases.save(
        Clase.reconstitute({
          id: this.c.ids.uuid() as never,
          materiaId: materia.id,
          fecha,
          horaInicio: parseLocalTime(input.hora_inicio, 'hora_inicio'),
          horaFin: parseLocalTime(input.hora_fin, 'hora_fin'),
          tema: nonEmptyString(input.tema, 'tema', 500),
          estado: 'programada',
          createdBy: actor.id,
          version: 1,
        }),
        tx,
      );
      await writeAudit(this.c, tx, {
        entidad: 'clases',
        entidadId: clase.id,
        accion: 'crear',
        actor,
        despues: {
          materia_id: clase.materiaId,
          fecha: clase.fecha,
          hora_inicio: clase.horaInicio,
          hora_fin: clase.horaFin,
          tema: clase.tema,
        },
        requestId: null,
      });
      return clase;
    });
    return created;
  }

  async getClase(actor: Actor, id: string): Promise<Clase> {
    const clase = await this.c.clases.findById(id);
    if (!clase) throw new NotFoundError('Clase');
    await assertMateriaAccess(this.c, actor, clase.materiaId);
    return clase;
  }

  async updateClase(
    actor: Actor,
    id: string,
    input: {
      fecha?: string;
      hora_inicio?: string;
      hora_fin?: string;
      tema?: string;
      estado?: 'programada' | 'dictada' | 'cancelada';
      version?: number;
    },
  ): Promise<Clase> {
    const clase = await this.c.clases.findById(id);
    if (!clase) throw new NotFoundError('Clase');
    await assertTeacherOfMateria(this.c, actor, clase.materiaId);
    assertVersion(clase.version, input.version);
    const fecha = input.fecha !== undefined ? parseLocalDate(input.fecha, 'fecha') : clase.fecha;
    const horaInicio =
      input.hora_inicio !== undefined
        ? parseLocalTime(input.hora_inicio, 'hora_inicio')
        : clase.horaInicio;
    const horaFin =
      input.hora_fin !== undefined ? parseLocalTime(input.hora_fin, 'hora_fin') : clase.horaFin;
    const updated = Clase.reconstitute({
      id: clase.id,
      materiaId: clase.materiaId,
      fecha: clase.fecha,
      horaInicio: clase.horaInicio,
      horaFin: clase.horaFin,
      tema: clase.tema,
      estado: clase.estado,
      createdBy: clase.createdBy,
      version: clase.version,
    });
    if (input.fecha !== undefined || input.hora_inicio !== undefined || input.hora_fin !== undefined) {
      const materia = await this.c.materias.findById(clase.materiaId);
      if (!materia) throw new NotFoundError('Materia');
      const ciclo = await this.cycleForCourse(materia.cursoDivisionTurnoId);
      if (!ciclo.contains(fecha)) {
        throw new ValidationDomainError('La fecha debe pertenecer al ciclo lectivo de la materia.');
      }
      updated.updateSchedule(fecha as LocalDate, horaInicio as LocalTime, horaFin as LocalTime);
    }
    if (input.tema !== undefined) updated.changeTopic(input.tema);
    if (input.estado === 'dictada') updated.markTaught();
    else if (input.estado === 'cancelada') updated.cancel();
    else if (input.estado === 'programada') {
      throw new ValidationDomainError('No se puede volver al estado programada.');
    }
    await this.c.uow.transaction(async (tx) => {
      await this.c.clases.save(updated, tx);
      await writeAudit(this.c, tx, {
        entidad: 'clases',
        entidadId: id,
        accion: 'actualizar',
        actor,
        antes: {
          fecha: clase.fecha,
          hora_inicio: clase.horaInicio,
          hora_fin: clase.horaFin,
          tema: clase.tema,
          estado: clase.estado,
        },
        despues: {
          fecha: updated.fecha,
          hora_inicio: updated.horaInicio,
          hora_fin: updated.horaFin,
          tema: updated.tema,
          estado: updated.estado,
        },
        requestId: null,
      });
    });
    return (await this.c.clases.findById(id)) as Clase;
  }

  parsePeso(value: unknown): number {
    return parsePeso(value);
  }
}
