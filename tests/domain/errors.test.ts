import { describe, expect, it } from 'vitest';
import type { AppContainer } from '../../src/application/container.js';
import type { RequestContext } from '../../src/application/shared/context.js';
import { AcademicService } from '../../src/application/academic-service.js';
import { AttendanceService } from '../../src/application/attendance-service.js';
import { GradingService } from '../../src/application/grading-service.js';
import { IdentityService } from '../../src/application/identity-service.js';
import {
  CicloLectivo,
  Clase,
  CursoDivisionTurno,
  Inscripcion,
} from '../../src/domain/academic/entities.js';
import { Asistencia } from '../../src/domain/attendance/entities.js';
import { Calificacion, Periodo } from '../../src/domain/grading/entities.js';
import { TutorAlumno } from '../../src/domain/identity/entities.js';
import {
  CapacityExceededError,
  ConflictError,
  DomainError,
  DuplicateResourceError,
  ForbiddenError,
  IdempotencyKeyRequiredError,
  IdempotencyKeyReusedError,
  ImportAlreadyRunningError,
  ImportInvalidFileError,
  InvalidCodeError,
  InvalidCredentialsError,
  InvalidStateTransitionError,
  NotFoundError,
  PasswordChangeRequiredError,
  PayloadTooLargeError,
  PeriodClosedError,
  PeriodIncompleteError,
  RateLimitedError,
  ServiceUnavailableError,
  StaleVersionError,
  TokenReuseDetectedError,
  UnauthenticatedError,
  ValidationDomainError,
} from '../../src/domain/shared/errors.js';
import type {
  Actor,
  AttendanceId,
  AttendanceStatus,
  ClassId,
  CourseId,
  CycleId,
  Decimal as DecimalString,
  EnrollmentId,
  EnrollmentStatus,
  EvaluationId,
  GradeId,
  GradeStatus,
  InstitutionId,
  LocalDate,
  LocalTime,
  PeriodId,
  SubjectId,
  Tx,
  UserId,
} from '../../src/domain/shared/types.js';
import { assertVersion } from '../../src/domain/shared/value-objects.js';

const NOW = '2026-01-15T12:00:00.000Z';

const actor: Actor = {
  id: 'admin-1' as UserId,
  role: 'administrador',
  mustChangePassword: false,
  passwordChangeOnly: false,
};

const ctx: RequestContext = {
  actor,
  requestId: 'req-1',
  ip: null,
  userAgent: null,
};

function expectDomainError(run: () => unknown, code: string, message?: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    const domainError = error as DomainError;
    expect(domainError.code).toBe(code);
    if (message !== undefined) expect(domainError.message).toBe(message);
    return;
  }
  throw new Error(`Se esperaba un DomainError con code ${code}.`);
}

function buildService<T>(Service: new (c: AppContainer) => T, stubs: Record<string, unknown>): T {
  return new Service(stubs as unknown as AppContainer);
}

function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return fn({ client: null });
}

function makeInscripcion(estado: EnrollmentStatus): Inscripcion {
  return Inscripcion.reconstitute({
    id: 1 as EnrollmentId,
    alumnoId: 'alumno-1' as UserId,
    materiaId: 10 as SubjectId,
    fechaInscripcion: '2026-01-01' as LocalDate,
    estado,
    version: 1,
  });
}

function makeClase(estado: 'programada' | 'dictada' | 'cancelada'): Clase {
  return Clase.reconstitute({
    id: 'clase-1' as ClassId,
    materiaId: 10 as SubjectId,
    fecha: '2026-02-01' as LocalDate,
    horaInicio: '09:00' as LocalTime,
    horaFin: '10:00' as LocalTime,
    tema: 'Clase de prueba',
    estado,
    createdBy: 'docente-1' as UserId,
    version: 1,
  });
}

function makeAsistencia(estado: AttendanceStatus): Asistencia {
  return Asistencia.reconstitute({
    id: 'asistencia-1' as AttendanceId,
    claseId: 'clase-1' as ClassId,
    alumnoId: 'alumno-1' as UserId,
    estado,
    justificacion: null,
    registradaPor: 'docente-1' as UserId,
    version: 1,
    updatedAt: NOW,
  });
}

function makeCalificacion(estado: GradeStatus): Calificacion {
  return Calificacion.reconstitute({
    id: 'nota-1' as GradeId,
    instanciaId: 'instancia-1' as EvaluationId,
    alumnoId: 'alumno-1' as UserId,
    valor: '7.00' as DecimalString,
    estado,
    version: 1,
    createdBy: 'docente-1' as UserId,
    updatedBy: 'docente-1' as UserId,
    rectificadaPor: null,
    rectificadaEn: null,
    motivoRectificacion: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function makePeriodo(estado: 'abierto' | 'cerrado' = 'cerrado'): Periodo {
  return Periodo.reconstitute({
    id: 'periodo-1' as PeriodId,
    cicloLectivoId: 'ciclo-1' as CycleId,
    nombre: 'Trimestre',
    tipo: 'trimestre',
    fechaInicio: '2026-01-01' as LocalDate,
    fechaFin: '2026-03-31' as LocalDate,
    estado,
    version: 1,
  });
}

function makeCiclo(): CicloLectivo {
  return CicloLectivo.reconstitute({
    id: 'ciclo-1' as CycleId,
    institucionId: 'institucion-1' as InstitutionId,
    anio: 2026,
    fechaInicio: '2026-01-01' as LocalDate,
    fechaFin: '2026-12-31' as LocalDate,
    estado: 'cerrado',
    version: 1,
  });
}

function makeCurso(): CursoDivisionTurno {
  return CursoDivisionTurno.reconstitute({
    id: 1 as CourseId,
    cicloLectivoId: 'ciclo-1' as CycleId,
    curso: 1,
    division: 'A',
    turno: 'Mañana',
    capacidadMaxima: 3,
    version: 1,
  });
}

function makeLink(): TutorAlumno {
  return TutorAlumno.reconstitute({
    id: 'vinculo-1',
    alumnoId: 'alumno-1' as UserId,
    tutorId: 'tutor-1' as UserId,
    relationship: 'padre',
    otraRelacion: null,
    codigoInstitucional: 'CODIGO',
    estadoRegistro: 'pendiente',
    activa: true,
    codigoExpiraEn: '2026-01-20T12:00:00.000Z',
    registeredAt: null,
    version: 1,
  });
}

describe('catálogo de errores de dominio', () => {
  const casos: Array<[new (message: string) => DomainError, string, number]> = [
    [ValidationDomainError, 'VALIDATION_ERROR', 422],
    [NotFoundError, 'NOT_FOUND', 404],
    [ForbiddenError, 'FORBIDDEN', 403],
    [UnauthenticatedError, 'UNAUTHENTICATED', 401],
    [InvalidCredentialsError, 'INVALID_CREDENTIALS', 401],
    [PasswordChangeRequiredError, 'PASSWORD_CHANGE_REQUIRED', 403],
    [DuplicateResourceError, 'DUPLICATE_RESOURCE', 409],
    [ConflictError, 'CONFLICT', 409],
    [InvalidStateTransitionError, 'INVALID_STATE_TRANSITION', 409],
    [CapacityExceededError, 'CAPACITY_EXCEEDED', 409],
    [PeriodClosedError, 'PERIOD_CLOSED', 409],
    [PeriodIncompleteError, 'PERIOD_INCOMPLETE', 409],
    [StaleVersionError, 'STALE_VERSION', 409],
    [InvalidCodeError, 'INVALID_CODE', 400],
    [TokenReuseDetectedError, 'TOKEN_REUSE_DETECTED', 401],
    [IdempotencyKeyRequiredError, 'IDEMPOTENCY_KEY_REQUIRED', 400],
    [IdempotencyKeyReusedError, 'IDEMPOTENCY_KEY_REUSED', 409],
    [ImportAlreadyRunningError, 'IMPORT_ALREADY_RUNNING', 409],
    [ImportInvalidFileError, 'IMPORT_INVALID_FILE', 422],
    [PayloadTooLargeError, 'PAYLOAD_TOO_LARGE', 413],
    [RateLimitedError, 'RATE_LIMITED', 429],
    [ServiceUnavailableError, 'SERVICE_UNAVAILABLE', 503],
  ];

  for (const [ErrorClass, code, httpStatus] of casos) {
    it(`${ErrorClass.name} usa code ${code} y status ${httpStatus}`, () => {
      const error = new ErrorClass('mensaje');
      expect(error).toBeInstanceOf(DomainError);
      expect(error.name).toBe(ErrorClass.name);
      expect(error.code).toBe(code);
      expect(error.httpStatus).toBe(httpStatus);
    });
  }
});

describe('transiciones inválidas en entidades', () => {
  const casos: Array<{ nombre: string; run: () => unknown; code: string; mensaje?: string }> = [
    {
      nombre: 'aprobar una inscripción rechazada',
      run: () => makeInscripcion('rechazado').approve(),
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'Solo una inscripción pendiente puede aprobarse.',
    },
    {
      nombre: 'rechazar una inscripción aprobada',
      run: () => makeInscripcion('aprobado').reject(),
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'Solo una inscripción pendiente puede rechazarse.',
    },
    {
      nombre: 'cancelar una inscripción rechazada',
      run: () => makeInscripcion('rechazado').cancel(),
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'Una inscripción rechazada no puede cancelarse.',
    },
    {
      nombre: 'marcar una clase cancelada como dictada',
      run: () => makeClase('cancelada').markTaught(),
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'Una clase cancelada no puede marcarse como dictada.',
    },
    {
      nombre: 'cancelar una clase dictada',
      run: () => makeClase('dictada').cancel(),
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'Una clase dictada no puede cancelarse.',
    },
    {
      nombre: 'justificar una asistencia que no es ausencia',
      run: () => makeAsistencia('presente').justify('motivo'),
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'Solo una ausencia puede justificarse.',
    },
    {
      nombre: 'anular dos veces una calificación',
      run: () => {
        const nota = makeCalificacion('anulada');
        nota.annul('otro motivo', actor.id);
      },
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'La nota ya está anulada.',
    },
    {
      nombre: 'reemplazar una calificación no anulada',
      run: () =>
        makeCalificacion('activa').replaceAnnulled('8' as DecimalString, 'motivo', actor.id),
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'La nota no está anulada.',
    },
    {
      nombre: 'operar sobre un período cerrado',
      run: () => makePeriodo().assertOpen(),
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'El período está cerrado.',
    },
    {
      nombre: 'activar un ciclo cerrado',
      run: () => makeCiclo().activate(),
      code: 'INVALID_STATE_TRANSITION',
      mensaje: 'No se puede activar un ciclo cerrado.',
    },
    {
      nombre: 'registrar dos veces un vínculo tutor-alumno',
      run: () => {
        const link = makeLink();
        link.register(NOW);
        link.register(NOW);
      },
      code: 'VALIDATION_ERROR',
      mensaje: 'El vínculo ya fue registrado.',
    },
    {
      nombre: 'reducir la capacidad debajo de los alumnos',
      run: () => makeCurso().changeCapacity(2, 3),
      code: 'VALIDATION_ERROR',
      mensaje: 'La capacidad no puede ser menor a la cantidad de alumnos.',
    },
    {
      nombre: 'cambiar el valor de una nota anulada sin motivo',
      run: () => makeCalificacion('anulada').changeValue('8' as DecimalString, actor.id),
      code: 'VALIDATION_ERROR',
      mensaje: 'Debe indicar un motivo para reemplazar una nota anulada.',
    },
    {
      nombre: 'rectificar una nota sin motivo',
      run: () => makeCalificacion('activa').rectify('8' as DecimalString, '   ', actor.id, NOW),
      code: 'VALIDATION_ERROR',
      mensaje: 'El motivo de rectificación es obligatorio.',
    },
    {
      nombre: 'enviar una versión desactualizada',
      run: () => assertVersion(1, 2),
      code: 'STALE_VERSION',
    },
  ];

  for (const caso of casos) {
    it(`${caso.nombre} -> ${caso.code}`, () => {
      expectDomainError(caso.run, caso.code, caso.mensaje);
    });
  }
});

describe('códigos de error en servicios', () => {
  it('curso duplicado responde CONFLICT', async () => {
    const service = buildService(AcademicService, {
      ciclos: { findById: async () => ({ isClosed: () => false }) },
      cursos: { findByAttributes: async () => makeCurso() },
    });
    await expect(
      service.createCurso(
        { curso: 1, division: 'A', turno: 'Mañana', ciclo_lectivo_id: 'ciclo-1' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('versión desactualizada al actualizar curso responde STALE_VERSION', async () => {
    const service = buildService(AcademicService, {
      cursos: { findById: async () => makeCurso() },
    });
    await expect(service.updateCurso(1, { version: 2 }, ctx)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
  });

  it('alta de alumno con curso lleno responde CAPACITY_EXCEEDED', async () => {
    const service = buildService(IdentityService, {
      cursos: { findById: async () => makeCurso() },
      alumnos: { countByCourse: async () => 3 },
    });
    await expect(
      service.createAlumno(
        {
          first_name: 'Ana',
          last_name: 'Pérez',
          dni: 40_123_456,
          fecha_nacimiento: '2010-05-12',
          curso_division_turno_id: 1,
          relationship: 'padre',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
  });

  it('username duplicado responde DUPLICATE_RESOURCE', async () => {
    const service = buildService(IdentityService, {
      users: { findByUsername: async () => ({ id: 'otro' }) },
    });
    await expect(
      service.createAdmin(
        { first_name: 'Nuevo', last_name: 'Admin', username: 'admin.nuevo', password: 'Admin1234' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_RESOURCE' });
  });

  it('código de tutor inválido responde INVALID_CODE', async () => {
    const service = buildService(IdentityService, {
      tutorAlumno: { findByCode: async () => null },
    });
    await expect(service.validateTutorCode('INEXISTENTE')).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
  });

  it('instancia en período cerrado responde CONFLICT', async () => {
    const service = buildService(GradingService, {
      materias: { findById: async () => ({ id: 10 }) },
      periodos: { findById: async () => makePeriodo() },
    });
    await expect(
      service.createInstancia(actor, {
        materia_id: 10,
        periodo_id: 'periodo-1',
        nombre: 'Parcial',
        tipo: 'parcial',
        peso: 50,
        fecha: '2026-02-15',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rectificar en período abierto responde CONFLICT', async () => {
    const service = buildService(GradingService, {
      calificaciones: { findById: async () => makeCalificacion('activa') },
      instancias: { findById: async () => ({ id: 'instancia-1', periodoId: 'periodo-1' }) },
      periodos: { findForUpdate: async () => makePeriodo('abierto') },
      uow: { transaction },
    });
    await expect(
      service.rectifyCalificacion(actor, 'nota-1', { valor: 9, motivo: 'Error' }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('asistencia en clase no dictada responde CONFLICT', async () => {
    const service = buildService(AttendanceService, {
      clases: {
        findById: async () => ({
          id: 'clase-1',
          materiaId: 10,
          canRegisterAttendance: () => false,
        }),
      },
      materias: { findById: async () => ({ id: 10, cursoDivisionTurnoId: 1 }) },
      alumnos: {
        findById: async () => ({
          id: 'alumno-1',
          user: { isActive: true },
          cursoDivisionTurnoId: 1,
        }),
      },
      asistencias: { findByClaseAndAlumno: async () => null },
    });
    await expect(
      service.create(actor, { clase_id: 'clase-1', alumno_id: 'alumno-1', estado: 'presente' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
