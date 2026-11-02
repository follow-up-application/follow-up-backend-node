import type { AppContainer } from './application/container.js';
import { AcademicService } from './application/academic-service.js';
import { AttendanceService } from './application/attendance-service.js';
import { AuditService } from './application/audit-service.js';
import { AuthService } from './application/auth-service.js';
import { GradingService } from './application/grading-service.js';
import { IdentityService } from './application/identity-service.js';
import { ImportsService } from './application/imports-service.js';
import { pool } from './infra/db/client.js';
import { PgUnitOfWork } from './infra/db/unit-of-work.js';
import {
  PgCicloLectivoRepository,
  PgClaseRepository,
  PgCursoDivisionTurnoRepository,
  PgInscripcionRepository,
  PgInstitucionRepository,
  PgMateriaRepository,
} from './infra/db/repositories/academic.js';
import { PgAsistenciaRepository } from './infra/db/repositories/attendance.js';
import { PgAuditoriaRepository } from './infra/db/repositories/audit.js';
import {
  PgCalificacionRepository,
  PgCondicionAlumnoRepository,
  PgInstanciaEvaluacionRepository,
  PgPeriodoCierreRepository,
  PgPeriodoRepository,
  PgReglaCondicionRepository,
} from './infra/db/repositories/grading.js';
import { PgIdempotencyRepository } from './infra/db/repositories/idempotency.js';
import {
  PgAlumnoRepository,
  PgDocenteRepository,
  PgPreceptorRepository,
  PgRefreshTokenRepository,
  PgTutorAlumnoRepository,
  PgTutorRepository,
  PgUserRepository,
} from './infra/db/repositories/identity.js';
import { PgImportJobRepository } from './infra/db/repositories/imports.js';
import { PgNotificacionRepository } from './infra/db/repositories/notifications.js';
import { LogNotifier } from './infra/external/log-notifier.js';
import { LocalImportQueue } from './infra/imports/local-queue.js';
import { ImportWorker } from './infra/imports/import-worker.js';
import { NotificationWorker } from './infra/notifications/notification-worker.js';
import { Argon2PasswordHasher } from './infra/security/password-hasher.js';
import { JwtTokenService } from './infra/security/token-service.js';
import { LocalFileStorage } from './infra/storage/local-file-storage.js';
import { SystemClock, UuidGenerator } from './infra/system/system.js';
import type { HttpServices } from './infra/http/routes.js';

export function buildContainer(): AppContainer {
  return {
    uow: new PgUnitOfWork(pool),
    users: new PgUserRepository(),
    alumnos: new PgAlumnoRepository(),
    docentes: new PgDocenteRepository(),
    tutores: new PgTutorRepository(),
    preceptores: new PgPreceptorRepository(),
    tutorAlumno: new PgTutorAlumnoRepository(),
    refreshTokens: new PgRefreshTokenRepository(),
    instituciones: new PgInstitucionRepository(),
    ciclos: new PgCicloLectivoRepository(),
    cursos: new PgCursoDivisionTurnoRepository(),
    materias: new PgMateriaRepository(),
    inscripciones: new PgInscripcionRepository(),
    clases: new PgClaseRepository(),
    asistencias: new PgAsistenciaRepository(),
    periodos: new PgPeriodoRepository(),
    instancias: new PgInstanciaEvaluacionRepository(),
    calificaciones: new PgCalificacionRepository(),
    reglas: new PgReglaCondicionRepository(),
    condiciones: new PgCondicionAlumnoRepository(),
    cierres: new PgPeriodoCierreRepository(),
    auditoria: new PgAuditoriaRepository(),
    idempotency: new PgIdempotencyRepository(),
    importJobs: new PgImportJobRepository(),
    notificaciones: new PgNotificacionRepository(),
    hasher: new Argon2PasswordHasher(),
    tokens: new JwtTokenService(),
    clock: new SystemClock(),
    ids: new UuidGenerator(),
    storage: new LocalFileStorage(),
    notifier: new LogNotifier(),
    importQueue: new LocalImportQueue(),
  };
}

export function buildHttpServices(c: AppContainer): HttpServices {
  return {
    auth: new AuthService(c),
    identity: new IdentityService(c),
    academic: new AcademicService(c),
    attendance: new AttendanceService(c),
    grading: new GradingService(c),
    imports: new ImportsService(c),
    audit: new AuditService(c),
  };
}

export interface AppWorkers {
  importWorker: ImportWorker;
  notificationWorker: NotificationWorker;
}

export function buildWorkers(c: AppContainer): AppWorkers {
  return {
    importWorker: new ImportWorker(c),
    notificationWorker: new NotificationWorker(c),
  };
}
