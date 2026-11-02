import type {
  AlumnoRepository,
  DocenteRepository,
  PasswordHasher,
  PreceptorRepository,
  RefreshTokenRepository,
  TokenService,
  TutorAlumnoRepository,
  TutorRepository,
  UserRepository,
} from '../domain/identity/ports.js';
import type {
  CicloLectivoRepository,
  ClaseRepository,
  CursoDivisionTurnoRepository,
  InscripcionRepository,
  InstitucionRepository,
  MateriaRepository,
} from '../domain/academic/ports.js';
import type { AsistenciaRepository } from '../domain/attendance/ports.js';
import type {
  CalificacionRepository,
  CondicionAlumnoRepository,
  InstanciaEvaluacionRepository,
  PeriodoCierreRepository,
  PeriodoRepository,
  ReglaCondicionRepository,
} from '../domain/grading/ports.js';
import type { AuditoriaRepository } from '../domain/audit/ports.js';
import type { IdempotencyRepository } from '../domain/idempotency/ports.js';
import type {
  FileStorage,
  ImportJobRepository,
  ImportWorkerQueue,
} from '../domain/imports/ports.js';
import type { NotificacionRepository, Notifier } from '../domain/notifications/ports.js';
import type { Clock, IdGenerator } from '../domain/shared/ports.js';
import type { UnitOfWork } from './shared/unit-of-work.js';

export interface AppContainer {
  uow: UnitOfWork;
  users: UserRepository;
  alumnos: AlumnoRepository;
  docentes: DocenteRepository;
  tutores: TutorRepository;
  preceptores: PreceptorRepository;
  tutorAlumno: TutorAlumnoRepository;
  refreshTokens: RefreshTokenRepository;
  instituciones: InstitucionRepository;
  ciclos: CicloLectivoRepository;
  cursos: CursoDivisionTurnoRepository;
  materias: MateriaRepository;
  inscripciones: InscripcionRepository;
  clases: ClaseRepository;
  asistencias: AsistenciaRepository;
  periodos: PeriodoRepository;
  instancias: InstanciaEvaluacionRepository;
  calificaciones: CalificacionRepository;
  reglas: ReglaCondicionRepository;
  condiciones: CondicionAlumnoRepository;
  cierres: PeriodoCierreRepository;
  auditoria: AuditoriaRepository;
  idempotency: IdempotencyRepository;
  importJobs: ImportJobRepository;
  notificaciones: NotificacionRepository;
  hasher: PasswordHasher;
  tokens: TokenService;
  clock: Clock;
  ids: IdGenerator;
  storage: FileStorage;
  notifier: Notifier;
  importQueue: ImportWorkerQueue;
}
