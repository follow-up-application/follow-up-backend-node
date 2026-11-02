/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Alumno,
  Docente,
  Preceptor,
  Tutor,
  TutorAlumno,
  User,
} from '../../domain/identity/entities.js';
import {
  CicloLectivo,
  Clase,
  CursoDivisionTurno,
  Inscripcion,
  Institucion,
  Materia,
} from '../../domain/academic/entities.js';
import { Asistencia } from '../../domain/attendance/entities.js';
import {
  Calificacion,
  CondicionAlumno,
  InstanciaEvaluacion,
  Periodo,
  PeriodoCierre,
  ReglaCondicion,
} from '../../domain/grading/entities.js';
import { RegistroAuditoria } from '../../domain/audit/entities.js';
import { IdempotencyKey } from '../../domain/idempotency/entities.js';
import { ImportJob } from '../../domain/imports/entities.js';
import { Notificacion } from '../../domain/notifications/entities.js';
import type {
  AttendanceId,
  ClassId,
  ConditionId,
  CourseId,
  CycleId,
  Decimal,
  EnrollmentId,
  EvaluationId,
  GradeId,
  ImportJobId,
  InstitutionId,
  LocalDate,
  LocalTime,
  NotificationId,
  PeriodCloseId,
  PeriodId,
  SubjectId,
  UserId,
  UserRole,
} from '../../domain/shared/types.js';

export type Row = Record<string, any>;

export function mapUser(row: Row): User {
  return User.reconstitute({
    id: row.id as UserId,
    firstName: row.first_name,
    lastName: row.last_name,
    dni: row.dni === null ? null : Number(row.dni),
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
    mustChangePassword: row.must_change_password,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  });
}

export function mapAlumno(row: Row): Alumno {
  return Alumno.reconstitute({
    user: mapUser(row),
    fechaNacimiento: row.alumno_fecha_nacimiento as LocalDate,
    cursoDivisionTurnoId: Number(row.alumno_curso_division_turno_id) as CourseId,
    version: Number(row.alumno_version),
  });
}

export function mapDocente(row: Row): Docente {
  return Docente.reconstitute({
    user: mapUser(row),
    telephone: row.docente_telephone,
    fechaIngreso: row.docente_fecha_ingreso as LocalDate,
    cursoDivisionTurnoId:
      row.docente_curso_division_turno_id === null
        ? null
        : (Number(row.docente_curso_division_turno_id) as CourseId),
    version: Number(row.docente_version),
  });
}

export function mapTutor(row: Row): Tutor {
  return Tutor.reconstitute({
    user: mapUser(row),
    telephone: row.tutor_telephone,
    version: Number(row.tutor_version),
  });
}

export function mapPreceptor(row: Row, courseIds: CourseId[] = []): Preceptor {
  return Preceptor.reconstitute({
    user: mapUser(row),
    telephone: row.preceptor_telephone,
    employeeCode: row.preceptor_employee_code,
    courseIds,
    version: Number(row.preceptor_version),
  });
}

export function mapTutorAlumno(row: Row): TutorAlumno {
  return TutorAlumno.reconstitute({
    id: row.id,
    alumnoId: row.alumno_id as UserId,
    tutorId: row.tutor_id as UserId,
    relationship: row.relationship,
    otraRelacion: row.otra_relacion,
    codigoInstitucional: row.codigo_institucional,
    estadoRegistro: row.estado_registro,
    activa: row.activa,
    codigoExpiraEn: row.codigo_expira_en,
    registeredAt: row.registered_at,
    version: Number(row.version),
  });
}

export function mapInstitucion(row: Row): Institucion {
  return Institucion.reconstitute({
    id: row.id as InstitutionId,
    nombre: row.nombre,
    cue: row.cue,
    direccion: row.direccion,
    telefono: row.telefono,
    email: row.email,
    activa: row.activa,
    version: Number(row.version),
  });
}

export function mapCiclo(row: Row): CicloLectivo {
  return CicloLectivo.reconstitute({
    id: row.id as CycleId,
    institucionId: row.institucion_id as InstitutionId,
    anio: Number(row.anio),
    fechaInicio: row.fecha_inicio as LocalDate,
    fechaFin: row.fecha_fin as LocalDate,
    estado: row.estado,
    version: Number(row.version),
  });
}

export function mapCurso(row: Row): CursoDivisionTurno {
  return CursoDivisionTurno.reconstitute({
    id: Number(row.id) as CourseId,
    cicloLectivoId: row.ciclo_lectivo_id as CycleId,
    curso: Number(row.curso),
    division: row.division,
    turno: row.turno,
    capacidadMaxima: Number(row.capacidad_maxima),
    version: Number(row.version),
  });
}

export function mapMateria(row: Row): Materia {
  return Materia.reconstitute({
    id: Number(row.id) as SubjectId,
    nombre: row.nombre,
    descripcion: row.descripcion,
    cursoDivisionTurnoId: Number(row.curso_division_turno_id) as CourseId,
    docenteId: row.docente_id as UserId,
    version: Number(row.version),
  });
}

export function mapInscripcion(row: Row): Inscripcion {
  return Inscripcion.reconstitute({
    id: Number(row.id) as EnrollmentId,
    alumnoId: row.alumno_id as UserId,
    materiaId: Number(row.materia_id) as SubjectId,
    fechaInscripcion: row.fecha_inscripcion as LocalDate,
    estado: row.estado,
    version: Number(row.version),
  });
}

export function mapClase(row: Row): Clase {
  return Clase.reconstitute({
    id: row.id as ClassId,
    materiaId: Number(row.materia_id) as SubjectId,
    fecha: row.fecha as LocalDate,
    horaInicio: String(row.hora_inicio).slice(0, 5) as LocalTime,
    horaFin: String(row.hora_fin).slice(0, 5) as LocalTime,
    tema: row.tema,
    estado: row.estado,
    createdBy: row.created_by as UserId,
    version: Number(row.version),
  });
}

export function mapAsistencia(row: Row): Asistencia {
  return Asistencia.reconstitute({
    id: row.id as AttendanceId,
    claseId: row.clase_id as ClassId,
    alumnoId: row.alumno_id as UserId,
    estado: row.estado,
    justificacion: row.justificacion,
    registradaPor: row.registrada_por as UserId,
    version: Number(row.version),
    updatedAt: row.updated_at,
  });
}

export function mapPeriodo(row: Row): Periodo {
  return Periodo.reconstitute({
    id: row.id as PeriodId,
    cicloLectivoId: row.ciclo_lectivo_id as CycleId,
    nombre: row.nombre,
    tipo: row.tipo,
    fechaInicio: row.fecha_inicio as LocalDate,
    fechaFin: row.fecha_fin as LocalDate,
    estado: row.estado,
    version: Number(row.version),
  });
}

export function mapInstancia(row: Row): InstanciaEvaluacion {
  return InstanciaEvaluacion.reconstitute({
    id: row.id as EvaluationId,
    materiaId: Number(row.materia_id) as SubjectId,
    periodoId: row.periodo_id as PeriodId,
    nombre: row.nombre,
    tipo: row.tipo,
    peso: String(row.peso) as Decimal,
    fecha: row.fecha as LocalDate,
    createdBy: row.created_by as UserId,
    version: Number(row.version),
  });
}

export function mapCalificacion(row: Row): Calificacion {
  return Calificacion.reconstitute({
    id: row.id as GradeId,
    instanciaId: row.instancia_id as EvaluationId,
    alumnoId: row.alumno_id as UserId,
    valor: String(row.valor) as Decimal,
    estado: row.estado,
    version: Number(row.version),
    createdBy: row.created_by as UserId,
    updatedBy: row.updated_by as UserId,
    rectificadaPor: row.rectificada_por,
    rectificadaEn: row.rectificada_en,
    motivoRectificacion: row.motivo_rectificacion,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function mapRegla(row: Row): ReglaCondicion {
  return ReglaCondicion.reconstitute({
    id: row.id,
    periodoId: row.periodo_id as PeriodId,
    materiaId: row.materia_id === null ? null : (Number(row.materia_id) as SubjectId),
    nombre: row.nombre,
    config: row.config,
    activa: row.activa,
    version: Number(row.version),
  });
}

export function mapCondicion(row: Row): CondicionAlumno {
  return CondicionAlumno.reconstitute({
    id: row.id as ConditionId,
    periodoId: row.periodo_id as PeriodId,
    alumnoId: row.alumno_id as UserId,
    materiaId: Number(row.materia_id) as SubjectId,
    condicion: row.condicion,
    promedio: row.promedio === null ? null : (String(row.promedio) as Decimal),
    porcentajeAsistencia: String(row.porcentaje_asistencia) as Decimal,
    detalle: row.detalle,
    calculadaEn: row.calculada_en,
    cierreId: row.cierre_id as PeriodCloseId,
    version: Number(row.version),
  });
}

export function mapCierre(row: Row): PeriodoCierre {
  return PeriodoCierre.reconstitute({
    id: row.id as PeriodCloseId,
    periodoId: row.periodo_id as PeriodId,
    ejecutadoPor: row.ejecutado_por as UserId,
    ejecutadoEn: row.ejecutado_en,
    totalAlumnos: Number(row.total_alumnos),
    totalCondiciones: Number(row.total_condiciones),
    resumen: row.resumen,
  });
}

export function mapAuditoria(row: Row): RegistroAuditoria {
  return RegistroAuditoria.reconstitute({
    id: String(row.id),
    entidad: row.entidad,
    entidadId: row.entidad_id,
    accion: row.accion,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    motivo: row.motivo,
    antes: row.antes,
    despues: row.despues,
    requestId: row.request_id,
    ocurridoEn: row.ocurrido_en,
  });
}

export function mapIdempotency(row: Row): IdempotencyKey {
  return IdempotencyKey.reconstitute({
    id: row.id,
    actorId: row.actor_id,
    scopeKey: row.scope_key,
    clave: row.clave,
    requestHash: row.request_hash,
    metodo: row.metodo,
    ruta: row.ruta,
    estado: row.estado,
    statusCode: row.status_code === null ? null : Number(row.status_code),
    responseBody: row.response_body,
    resourceId: row.resource_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });
}

export function mapImportJob(row: Row): ImportJob {
  return ImportJob.reconstitute({
    id: row.id as ImportJobId,
    tipo: row.tipo,
    estado: row.estado,
    fileName: row.file_name,
    fileHash: row.file_hash,
    storagePath: row.storage_path,
    totalRows: Number(row.total_rows),
    processedRows: Number(row.processed_rows),
    validRows: Number(row.valid_rows),
    errorRows: Number(row.error_rows),
    createdBy: row.created_by as UserId,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attempts: Number(row.attempts),
    workerToken: row.worker_token,
    heartbeatAt: row.heartbeat_at,
    leaseUntil: row.lease_until,
    createdAt: row.created_at,
  });
}

export function mapNotificacion(row: Row): Notificacion {
  return Notificacion.reconstitute({
    id: row.id as NotificationId,
    destinatarioId: row.destinatario_id as UserId,
    tipo: row.tipo,
    payload: row.payload,
    estado: row.estado,
    intentos: Number(row.intentos),
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  });
}
