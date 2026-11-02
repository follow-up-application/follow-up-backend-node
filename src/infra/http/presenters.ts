import type { AppContainer } from '../../application/container.js';
import type {
  Alumno,
  Docente,
  Preceptor,
  Tutor,
  User,
} from '../../domain/identity/entities.js';
import type {
  Clase,
  CursoDivisionTurno,
  Inscripcion,
  Materia,
} from '../../domain/academic/entities.js';
import type { Asistencia } from '../../domain/attendance/entities.js';
import type {
  Calificacion,
  CondicionAlumno,
  InstanciaEvaluacion,
  Periodo,
  PeriodoCierre,
} from '../../domain/grading/entities.js';
import type { ImportJob } from '../../domain/imports/entities.js';
import type { RegistroAuditoria } from '../../domain/audit/entities.js';
import { formatLegacyDate } from '../../domain/shared/value-objects.js';

const ENROLLMENT_LABELS: Record<Inscripcion['estado'], string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
};

export function presentUser(user: User): Record<string, unknown> {
  return {
    id: user.id,
    first_name: user.firstName,
    last_name: user.lastName,
    dni: user.dni,
    username: user.username,
    email: user.email,
    role: user.role,
    is_active: user.isActive,
    must_change_password: user.mustChangePassword,
  };
}

export async function presentAlumno(c: AppContainer, alumno: Alumno): Promise<Record<string, unknown>> {
  const curso = await c.cursos.findById(alumno.cursoDivisionTurnoId);
  return {
    ...presentUser(alumno.user),
    fecha_nacimiento: formatLegacyDate(alumno.fechaNacimiento),
    curso_division_turno_id: alumno.cursoDivisionTurnoId,
    curso_division: curso ? curso.displayName() : null,
  };
}

export function presentDocente(docente: Docente): Record<string, unknown> {
  return {
    ...presentUser(docente.user),
    telephone: docente.telephone,
    fecha_ingreso: formatLegacyDate(docente.fechaIngreso),
    curso_division_turno_id: docente.cursoDivisionTurnoId,
  };
}

export function presentTutor(tutor: Tutor): Record<string, unknown> {
  return {
    ...presentUser(tutor.user),
    telephone: tutor.telephone,
  };
}

export async function presentPreceptor(
  c: AppContainer,
  preceptor: Preceptor,
): Promise<Record<string, unknown>> {
  const cursos = await Promise.all(preceptor.courseIds.map((id) => c.cursos.findById(id)));
  return {
    ...presentUser(preceptor.user),
    telephone: preceptor.telephone,
    employee_code: preceptor.employeeCode,
    cursos: cursos
      .filter((curso): curso is CursoDivisionTurno => curso !== null)
      .map((curso) => ({ id: curso.id, curso_division: curso.displayName() })),
  };
}

export function presentCurso(curso: CursoDivisionTurno): Record<string, unknown> {
  return {
    id: curso.id,
    ciclo_lectivo_id: curso.cicloLectivoId,
    curso: curso.curso,
    division: curso.division,
    turno: curso.turno,
    capacidad_maxima: curso.capacidadMaxima,
    curso_division: curso.displayName(),
    version: curso.version,
  };
}

export async function presentMateria(
  c: AppContainer,
  materia: Materia,
): Promise<Record<string, unknown>> {
  const curso = await c.cursos.findById(materia.cursoDivisionTurnoId);
  return {
    id: materia.id,
    nombre: materia.nombre,
    descripcion: materia.descripcion,
    curso_division_turno_id: materia.cursoDivisionTurnoId,
    turno: curso ? curso.turno : null,
    docente_id: materia.docenteId,
    version: materia.version,
  };
}

export function presentInscripcion(inscripcion: Inscripcion): Record<string, unknown> {
  return {
    id: inscripcion.id,
    alumno_id: inscripcion.alumnoId,
    materia_id: inscripcion.materiaId,
    fecha_inscripcion: formatLegacyDate(inscripcion.fechaInscripcion),
    estado: inscripcion.estado,
    estado_label: ENROLLMENT_LABELS[inscripcion.estado],
    version: inscripcion.version,
  };
}

export function presentClase(clase: Clase): Record<string, unknown> {
  return {
    id: clase.id,
    materia_id: clase.materiaId,
    fecha: clase.fecha,
    hora_inicio: clase.horaInicio,
    hora_fin: clase.horaFin,
    tema: clase.tema,
    estado: clase.estado,
    version: clase.version,
  };
}

export function presentAsistencia(asistencia: Asistencia): Record<string, unknown> {
  return {
    id: asistencia.id,
    clase_id: asistencia.claseId,
    alumno_id: asistencia.alumnoId,
    estado: asistencia.estado,
    justificacion: asistencia.justificacion,
    registrada_por: asistencia.registradaPor,
    version: asistencia.version,
    updated_at: asistencia.updatedAt,
  };
}

export function presentPeriodo(periodo: Periodo): Record<string, unknown> {
  return {
    id: periodo.id,
    ciclo_lectivo_id: periodo.cicloLectivoId,
    nombre: periodo.nombre,
    tipo: periodo.tipo,
    fecha_inicio: periodo.fechaInicio,
    fecha_fin: periodo.fechaFin,
    estado: periodo.estado,
    version: periodo.version,
  };
}

export function presentInstancia(instancia: InstanciaEvaluacion): Record<string, unknown> {
  return {
    id: instancia.id,
    materia_id: instancia.materiaId,
    periodo_id: instancia.periodoId,
    nombre: instancia.nombre,
    tipo: instancia.tipo,
    peso: instancia.peso,
    fecha: instancia.fecha,
    version: instancia.version,
  };
}

export function presentCalificacion(calificacion: Calificacion): Record<string, unknown> {
  return {
    id: calificacion.id,
    instancia_id: calificacion.instanciaId,
    alumno_id: calificacion.alumnoId,
    valor: calificacion.valor,
    estado: calificacion.estado,
    version: calificacion.version,
    updated_at: calificacion.updatedAt,
  };
}

export function presentCondicion(condicion: CondicionAlumno): Record<string, unknown> {
  const props = condicion.toProps();
  return {
    id: props.id,
    periodo_id: props.periodoId,
    alumno_id: props.alumnoId,
    materia_id: props.materiaId,
    condicion: props.condicion,
    promedio: props.promedio,
    porcentaje_asistencia: props.porcentajeAsistencia,
    detalle: props.detalle,
    calculada_en: props.calculadaEn,
  };
}

export function presentCierre(cierre: PeriodoCierre): Record<string, unknown> {
  return {
    id: cierre.id,
    periodo_id: cierre.periodoId,
    ejecutado_en: cierre.ejecutadoEn,
    total_alumnos: cierre.totalAlumnos,
    total_condiciones: cierre.totalCondiciones,
  };
}

export function presentImportJob(job: ImportJob): Record<string, unknown> {
  return {
    id: job.id,
    estado: job.estado,
    file_name: job.fileName,
    total_rows: job.totalRows,
    processed_rows: job.processedRows,
    valid_rows: job.validRows,
    error_rows: job.errorRows,
    error_code: job.errorCode,
    error_message: job.errorMessage,
    attempts: job.attempts,
    created_at: job.createdAt,
    finished_at: job.finishedAt,
  };
}

export function presentAuditoria(entry: RegistroAuditoria): Record<string, unknown> {
  const props = entry.toProps();
  return {
    id: props.id,
    entidad: props.entidad,
    entidad_id: props.entidadId,
    accion: props.accion,
    actor_id: props.actorId,
    actor_role: props.actorRole,
    motivo: props.motivo,
    antes: props.antes,
    despues: props.despues,
    ocurrido_en: props.ocurridoEn,
  };
}
