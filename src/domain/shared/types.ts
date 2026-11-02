type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type InstitutionId = Brand<string, 'InstitutionId'>;
export type CycleId = Brand<string, 'CycleId'>;
export type ClassId = Brand<string, 'ClassId'>;
export type AttendanceId = Brand<string, 'AttendanceId'>;
export type PeriodId = Brand<string, 'PeriodId'>;
export type PeriodCloseId = Brand<string, 'PeriodCloseId'>;
export type EvaluationId = Brand<string, 'EvaluationId'>;
export type GradeId = Brand<string, 'GradeId'>;
export type RuleId = Brand<string, 'RuleId'>;
export type ConditionId = Brand<string, 'ConditionId'>;
export type ImportJobId = Brand<string, 'ImportJobId'>;
export type NotificationId = Brand<string, 'NotificationId'>;
export type TutorLinkId = Brand<string, 'TutorLinkId'>;
export type RefreshTokenId = Brand<string, 'RefreshTokenId'>;
export type LocalDate = Brand<string, 'LocalDate'>;
export type LocalTime = Brand<string, 'LocalTime'>;
export type Instant = Brand<string, 'Instant'>;
export type Decimal = Brand<string, 'Decimal'>;

export type CourseId = number;
export type SubjectId = number;
export type EnrollmentId = number;

export const USER_ROLES = ['administrador', 'preceptor', 'docente', 'alumno', 'tutor'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ENROLLMENT_STATUSES = ['pendiente', 'aprobado', 'rechazado', 'cancelado'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['presente', 'ausente', 'justificada', 'tarde'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const CLASS_STATUSES = ['programada', 'dictada', 'cancelada'] as const;
export type ClassStatus = (typeof CLASS_STATUSES)[number];

export const PERIOD_STATUSES = ['abierto', 'cerrado'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const EVALUATION_TYPES = ['parcial', 'tp', 'oral', 'recuperatorio', 'otro'] as const;
export type EvaluationType = (typeof EVALUATION_TYPES)[number];

export const GRADE_STATUSES = ['activa', 'rectificada', 'anulada'] as const;
export type GradeStatus = (typeof GRADE_STATUSES)[number];

export const CONDITIONS = ['regular', 'libre', 'promocionado', 'no_aplica'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const IMPORT_STATUSES = ['pendiente', 'procesando', 'completada', 'fallida'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export interface Actor {
  id: UserId;
  role: UserRole;
  mustChangePassword: boolean;
  passwordChangeOnly: boolean;
}

/**
 * Contexto transaccional opaco para el dominio. La infraestructura decide
 * qué contiene (por ejemplo un PoolClient de pg) sin filtrar esa dependencia.
 */
export interface Tx {
  readonly client: unknown;
}
