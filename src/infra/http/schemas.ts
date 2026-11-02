import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  CONDITIONS,
  ENROLLMENT_STATUSES,
  USER_ROLES,
} from '../../domain/shared/types.js';

const uuid = z.string().uuid();
const intId = z.coerce.number().int().positive();
const date = z.string().min(1).max(10);
const time = z.string().min(4).max(5);
const shortText = (max: number) => z.string().min(1).max(max);
const decimalInput = z.union([z.string(), z.number()]);
const optionalDecimal = z.union([z.string(), z.number()]).optional();

const pagination = {
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

const booleanQuery = z
  .string()
  .refine((value) => ['true', 'false', '1', '0'].includes(value), {
    message: 'Debe ser true o false.',
  })
  .transform((value) => value === 'true' || value === '1');

export const idParam = z.object({ id: uuid }).strict();
export const intIdParam = z.object({ id: intId }).strict();
export const codeParam = z.object({ codigo: z.string().min(1).max(255) }).strict();
export const dniParam = z.object({ dni: z.coerce.number().int().positive() }).strict();

export const paginationQuery = z.object({ ...pagination }).strict();
export const paginationWithCourseQuery = z
  .object({ curso_division_turno_id: intId.optional(), ...pagination })
  .strict();

export const loginSchema = z
  .object({ username: shortText(255), password: shortText(128) })
  .strict();

export const refreshSchema = z.object({ refresh_token: shortText(2048) }).strict();

export const logoutSchema = z
  .object({ refresh_token: z.string().min(1).max(2048).optional() })
  .strict();

export const passwordSchema = z
  .object({
    current_password: shortText(128),
    new_password: shortText(128),
    new_password_confirmation: shortText(128),
  })
  .strict();

export const adminCreateSchema = z
  .object({
    first_name: shortText(100),
    last_name: shortText(100),
    username: shortText(255),
    password: shortText(128),
  })
  .strict();

export const adminUpdateSchema = z
  .object({
    first_name: z.string().min(1).max(100).optional(),
    last_name: z.string().min(1).max(100).optional(),
    username: z.string().min(3).max(255).optional(),
  })
  .strict();

export const usersQuery = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    active: booleanQuery.optional(),
    ...pagination,
  })
  .strict();

export const userStateSchema = z
  .object({ is_active: z.boolean(), motivo: z.string().min(1).max(500) })
  .strict();

export const alumnoCreateSchema = z
  .object({
    first_name: shortText(100),
    last_name: shortText(100),
    dni: z.coerce.number().int(),
    fecha_nacimiento: date,
    curso_division_turno_id: intId,
    relationship: z.enum(['padre', 'madre', 'otra']),
    otra_relacion: z.string().max(100).nullish(),
    tutor_id: uuid.nullish(),
    tutor_first_name: z.string().min(1).max(100).optional(),
    tutor_last_name: z.string().min(1).max(100).optional(),
    tutor_dni: z.coerce.number().int().optional(),
    tutor_telephone: z.string().min(1).max(20).optional(),
  })
  .strict();

export const alumnoUpdateSchema = z
  .object({
    first_name: z.string().min(1).max(100).optional(),
    last_name: z.string().min(1).max(100).optional(),
    dni: z.coerce.number().int().optional(),
    fecha_nacimiento: date.optional(),
    curso_division_turno_id: intId.optional(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const docenteCreateSchema = z
  .object({
    first_name: shortText(100),
    last_name: shortText(100),
    dni: z.coerce.number().int(),
    telephone: shortText(20),
    fecha_ingreso: date,
    curso_division_turno_id: intId.nullish(),
  })
  .strict();

export const docenteUpdateSchema = z
  .object({
    first_name: z.string().min(1).max(100).optional(),
    last_name: z.string().min(1).max(100).optional(),
    telephone: z.string().min(1).max(20).optional(),
    fecha_ingreso: date.optional(),
    curso_division_turno_id: intId.nullish(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const tutorRegisterSchema = z
  .object({
    codigo: shortText(255),
    email: shortText(255),
    password: shortText(128),
    password_confirmation: shortText(128),
  })
  .strict();

export const tutorCreateSchema = z
  .object({
    first_name: shortText(100),
    last_name: shortText(100),
    dni: z.coerce.number().int(),
    telephone: shortText(20),
    email: shortText(255),
    password: z.string().min(6).max(128).optional(),
  })
  .strict();

export const tutorUpdateSchema = z
  .object({
    telephone: z.string().min(1).max(20).optional(),
    email: z.string().min(3).max(255).optional(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const preceptorCreateSchema = z
  .object({
    first_name: shortText(100),
    last_name: shortText(100),
    dni: z.coerce.number().int(),
    telephone: z.string().max(20).nullish(),
    employee_code: z.string().max(50).nullish(),
    cursos: z.array(intId).max(50).optional(),
  })
  .strict();

export const preceptorUpdateSchema = z
  .object({
    telephone: z.string().max(20).nullish(),
    employee_code: z.string().max(50).nullish(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const preceptorCoursesSchema = z
  .object({ cursos: z.array(intId).max(50) })
  .strict();

export const cursoCreateSchema = z
  .object({
    ciclo_lectivo_id: uuid.optional(),
    curso: z.coerce.number().int(),
    division: shortText(10),
    turno: z.enum(['Mañana', 'Tarde']),
    capacidad_maxima: z.coerce.number().int().optional(),
  })
  .strict();

export const cursoUpdateSchema = z
  .object({
    curso: z.coerce.number().int().optional(),
    division: z.string().min(1).max(10).optional(),
    turno: z.enum(['Mañana', 'Tarde']).optional(),
    capacidad_maxima: z.coerce.number().int().optional(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const cursosQuery = z
  .object({ ciclo_lectivo_id: uuid.optional(), ...pagination })
  .strict();

export const materiaCreateSchema = z
  .object({
    nombre: shortText(150),
    descripcion: shortText(1000),
    curso_division_turno_id: intId,
    docente_id: uuid,
  })
  .strict();

export const materiaUpdateSchema = z
  .object({
    nombre: z.string().min(1).max(150).optional(),
    descripcion: z.string().min(1).max(1000).optional(),
    curso_division_turno_id: intId.optional(),
    docente_id: uuid.optional(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const materiasQuery = z
  .object({
    curso_division_turno_id: intId.optional(),
    docente_id: uuid.optional(),
    ...pagination,
  })
  .strict();

export const inscripcionCreateSchema = z
  .object({
    alumno_id: uuid,
    materia_id: intId,
    fecha_inscripcion: date.optional(),
  })
  .strict();

export const inscripcionEstadoSchema = z
  .object({ estado: z.enum(ENROLLMENT_STATUSES) })
  .strict();

export const inscripcionesQuery = z
  .object({
    alumno_id: uuid.optional(),
    materia_id: intId.optional(),
    estado: z.enum(ENROLLMENT_STATUSES).optional(),
    ...pagination,
  })
  .strict();

export const claseCreateSchema = z
  .object({
    materia_id: intId,
    fecha: date,
    hora_inicio: time,
    hora_fin: time,
    tema: shortText(500),
  })
  .strict();

export const claseUpdateSchema = z
  .object({
    fecha: date.optional(),
    hora_inicio: time.optional(),
    hora_fin: time.optional(),
    tema: z.string().min(1).max(500).optional(),
    estado: z.enum(['programada', 'dictada', 'cancelada']).optional(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const clasesQuery = z
  .object({
    materia_id: intId.optional(),
    curso_division_turno_id: intId.optional(),
    desde: date.optional(),
    hasta: date.optional(),
    ...pagination,
  })
  .strict();

export const asistenciaCreateSchema = z
  .object({
    clase_id: uuid,
    alumno_id: uuid,
    estado: z.enum(ATTENDANCE_STATUSES),
  })
  .strict();

export const asistenciaUpdateSchema = z
  .object({
    estado: z.enum(ATTENDANCE_STATUSES),
    motivo: z.string().max(500).optional(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const asistenciaJustifySchema = z
  .object({ justificacion: shortText(500) })
  .strict();

export const asistenciasQuery = z
  .object({
    clase_id: uuid.optional(),
    alumno_id: uuid.optional(),
    periodo_id: uuid.optional(),
    ...pagination,
  })
  .strict();

const ruleSchema = z.record(z.unknown());

export const periodoCreateSchema = z
  .object({
    ciclo_lectivo_id: uuid,
    nombre: shortText(100),
    tipo: z.enum(['trimestre', 'cuatrimestre']),
    fecha_inicio: date,
    fecha_fin: date,
    regla_default: ruleSchema.optional(),
  })
  .strict();

export const periodoUpdateSchema = z
  .object({
    nombre: z.string().min(1).max(100).optional(),
    fecha_inicio: date.optional(),
    fecha_fin: date.optional(),
    regla_default: ruleSchema.optional(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const periodosQuery = z
  .object({
    ciclo_lectivo_id: uuid.optional(),
    estado: z.enum(['abierto', 'cerrado']).optional(),
    ...pagination,
  })
  .strict();

export const condicionesQuery = z
  .object({ materia_id: intId.optional(), ...pagination })
  .strict();

export const instanciaCreateSchema = z
  .object({
    materia_id: intId,
    periodo_id: uuid,
    nombre: shortText(150),
    tipo: z.enum(['parcial', 'tp', 'oral', 'recuperatorio', 'otro']),
    peso: decimalInput,
    fecha: date,
  })
  .strict();

export const instanciaUpdateSchema = z
  .object({
    nombre: z.string().min(1).max(150).optional(),
    tipo: z.enum(['parcial', 'tp', 'oral', 'recuperatorio', 'otro']).optional(),
    peso: optionalDecimal,
    fecha: date.optional(),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const instanciasQuery = z
  .object({
    materia_id: intId.optional(),
    periodo_id: uuid.optional(),
    ...pagination,
  })
  .strict();

export const calificacionCreateSchema = z
  .object({ instancia_id: uuid, alumno_id: uuid, valor: decimalInput })
  .strict();

export const calificacionUpdateSchema = z
  .object({
    valor: decimalInput,
    version: z.coerce.number().int().positive().optional(),
    motivo: z.string().max(500).optional(),
  })
  .strict();

export const calificacionAnnulSchema = z.object({ motivo: shortText(500) }).strict();

export const calificacionRectifySchema = z
  .object({ valor: decimalInput, motivo: shortText(500) })
  .strict();

export const calificacionesQuery = z
  .object({
    instancia_id: uuid.optional(),
    alumno_id: uuid.optional(),
    periodo_id: uuid.optional(),
    materia_id: intId.optional(),
    ...pagination,
  })
  .strict();

export const condicionesPeriodoQuery = z
  .object({ materia_id: intId.optional(), ...pagination })
  .strict();

export const alumnoCondicionQuery = z.object({ periodo_id: uuid }).strict();

export const auditoriaQuery = z
  .object({
    entidad: z.string().min(1).max(100).optional(),
    entidad_id: z.string().min(1).max(100).optional(),
    ...pagination,
  })
  .strict();

export const errorsQuery = z.object({ ...pagination }).strict();

export const importQuery = z.object({}).strict();

export const enumCondition = z.enum(CONDITIONS);
