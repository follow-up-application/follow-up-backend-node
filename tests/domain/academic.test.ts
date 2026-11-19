import { describe, expect, it } from 'vitest';
import { AcademicService } from '../../src/application/academic-service.js';
import type { AppContainer } from '../../src/application/container.js';
import type { RequestContext } from '../../src/application/shared/context.js';
import { IdentityService } from '../../src/application/identity-service.js';
import {
  CursoDivisionTurno,
  Inscripcion,
  Materia,
  type CursoDivisionTurnoProps,
  type InscripcionProps,
  type MateriaProps,
} from '../../src/domain/academic/entities.js';
import {
  CapacityExceededError,
  InvalidStateTransitionError,
  ValidationDomainError,
} from '../../src/domain/shared/errors.js';
import type {
  CourseId,
  CycleId,
  EnrollmentId,
  LocalDate,
  SubjectId,
  Tx,
  UserId,
} from '../../src/domain/shared/types.js';

const NOW = '2026-01-15T12:00:00.000Z';

const ctx: RequestContext = {
  actor: {
    id: 'admin-1' as UserId,
    role: 'administrador',
    mustChangePassword: false,
    passwordChangeOnly: false,
  },
  requestId: 'req-1',
  ip: null,
  userAgent: null,
};

function expectValidation(run: () => unknown, message: string): void {
  expect(run).toThrow(ValidationDomainError);
  expect(run).toThrow(message);
}

function cursoProps(overrides: Partial<CursoDivisionTurnoProps> = {}): CursoDivisionTurnoProps {
  return {
    id: 1 as CourseId,
    cicloLectivoId: 'ciclo-1' as CycleId,
    curso: 3,
    division: ' A ',
    turno: 'Mañana',
    capacidadMaxima: 30,
    version: 1,
    ...overrides,
  };
}

function makeCurso(overrides: Partial<CursoDivisionTurnoProps> = {}): CursoDivisionTurno {
  return CursoDivisionTurno.reconstitute(cursoProps(overrides));
}

describe('CursoDivisionTurno', () => {
  it('reconstituye recortando la división y expone sus atributos', () => {
    const curso = makeCurso();
    expect(curso).toMatchObject({
      id: 1,
      cicloLectivoId: 'ciclo-1',
      curso: 3,
      division: 'A',
      turno: 'Mañana',
      capacidadMaxima: 30,
      version: 1,
    });
  });

  it('displayName compone curso, división y turno', () => {
    expect(makeCurso().displayName()).toBe('3°A - Mañana');
  });
});

describe('Materia', () => {
  function makeMateria(overrides: Partial<MateriaProps> = {}): Materia {
    return Materia.reconstitute({
      id: 10 as SubjectId,
      nombre: 'Matemática',
      descripcion: 'Álgebra y geometría',
      cursoDivisionTurnoId: 1 as CourseId,
      docenteId: 'docente-1' as UserId,
      version: 1,
      ...overrides,
    });
  }

  it('expone sus atributos', () => {
    expect(makeMateria()).toMatchObject({
      id: 10,
      nombre: 'Matemática',
      descripcion: 'Álgebra y geometría',
      cursoDivisionTurnoId: 1,
      docenteId: 'docente-1',
      version: 1,
    });
  });

  it('rename normaliza y limita el nombre a 150 caracteres', () => {
    const materia = makeMateria();
    materia.rename('  Física  ');
    expect(materia.nombre).toBe('Física');
    materia.rename('m'.repeat(200));
    expect(materia.nombre).toBe('m'.repeat(150));
    expectValidation(() => materia.rename('   '), 'El nombre es obligatorio.');
  });

  it('changeDescription normaliza y limita la descripción a 1000 caracteres', () => {
    const materia = makeMateria();
    materia.changeDescription('  Nueva descripción  ');
    expect(materia.descripcion).toBe('Nueva descripción');
    materia.changeDescription('d'.repeat(1200));
    expect(materia.descripcion).toBe('d'.repeat(1000));
    expectValidation(() => materia.changeDescription(''), 'La descripción es obligatoria.');
  });

  it('permite reasignar docente y curso', () => {
    const materia = makeMateria();
    materia.assignTeacher('docente-2' as UserId);
    materia.changeCourse(2 as CourseId);
    expect([materia.docenteId, materia.cursoDivisionTurnoId]).toEqual(['docente-2', 2]);
  });
});

describe('Inscripción', () => {
  function makeInscripcion(overrides: Partial<InscripcionProps> = {}): Inscripcion {
    return Inscripcion.reconstitute({
      id: 100 as EnrollmentId,
      alumnoId: 'alumno-1' as UserId,
      materiaId: 10 as SubjectId,
      fechaInscripcion: '2026-03-01' as LocalDate,
      estado: 'pendiente',
      version: 1,
      ...overrides,
    });
  }

  it('expone sus atributos', () => {
    expect(makeInscripcion()).toMatchObject({
      id: 100,
      alumnoId: 'alumno-1',
      materiaId: 10,
      fechaInscripcion: '2026-03-01',
      estado: 'pendiente',
      version: 1,
    });
  });

  it('aprueba o rechaza solo inscripciones pendientes', () => {
    const aprobada = makeInscripcion();
    aprobada.approve();
    expect(aprobada.estado).toBe('aprobado');

    const rechazada = makeInscripcion();
    rechazada.reject();
    expect(rechazada.estado).toBe('rechazado');

    expect(() => aprobada.reject()).toThrow(InvalidStateTransitionError);
    expect(() => aprobada.reject()).toThrow('Solo una inscripción pendiente puede rechazarse.');
    expect(() => rechazada.approve()).toThrow(InvalidStateTransitionError);
    expect(() => rechazada.approve()).toThrow('Solo una inscripción pendiente puede aprobarse.');
  });

  it('cancela desde pendiente o aprobado y es idempotente', () => {
    const pendiente = makeInscripcion();
    pendiente.cancel();
    expect(pendiente.estado).toBe('cancelado');
    expect(() => pendiente.cancel()).not.toThrow();

    const aprobada = makeInscripcion({ estado: 'aprobado' });
    aprobada.cancel();
    expect(aprobada.estado).toBe('cancelado');
  });

  it('no permite cancelar una inscripción rechazada', () => {
    const rechazada = makeInscripcion({ estado: 'rechazado' });
    expect(() => rechazada.cancel()).toThrow(InvalidStateTransitionError);
    expect(() => rechazada.cancel()).toThrow('Una inscripción rechazada no puede cancelarse.');
  });
});

describe('Capacidad del curso', () => {
  it('changeCapacity no baja de la cantidad de alumnos actual', () => {
    const curso = makeCurso();
    curso.changeCapacity(40, 30);
    expect(curso.capacidadMaxima).toBe(40);
    curso.changeCapacity(30, 30);
    expect(curso.capacidadMaxima).toBe(30);
    expectValidation(
      () => curso.changeCapacity(29, 30),
      'La capacidad no puede ser menor a la cantidad de alumnos.',
    );
    expect(curso.capacidadMaxima).toBe(30);
  });

  it('rechaza crear un curso con capacidad fuera de 1..100', async () => {
    const service = new AcademicService({
      ciclos: { findById: async () => ({ isClosed: () => false }) },
    } as unknown as AppContainer);

    for (const value of [0, 101, 1.5, 'abc'] as unknown[]) {
      await expect(
        service.createCurso(
          {
            ciclo_lectivo_id: 'ciclo-1',
            curso: 1,
            division: 'A',
            turno: 'Mañana',
            capacidad_maxima: value as number,
          },
          ctx,
        ),
      ).rejects.toThrow('La capacidad máxima debe estar entre 1 y 100.');
    }
  });

  it('rechaza reducir la capacidad por debajo de los alumnos inscriptos', async () => {
    const service = new AcademicService({
      cursos: { findById: async () => makeCurso(), countStudents: async () => 10 },
      ciclos: { findById: async () => ({ isClosed: () => false }) },
    } as unknown as AppContainer);

    await expect(service.updateCurso(1, { capacidad_maxima: 9, version: 1 }, ctx)).rejects.toThrow(
      'La capacidad no puede ser menor a la cantidad de alumnos.',
    );
  });

  function identityService(curso: CursoDivisionTurno, students: number): IdentityService {
    return new IdentityService({
      cursos: { findById: async () => curso },
      alumnos: { countByCourse: async () => students, save: async () => undefined },
      users: {
        findByDni: async () => null,
        save: async () => undefined,
      },
      hasher: { hash: async () => 'hash' },
      ids: { uuid: () => 'generado' },
      clock: { now: () => NOW },
      uow: {
        transaction: async <T>(fn: (tx: Tx) => Promise<T>) => fn({ client: null }),
      },
    } as unknown as AppContainer);
  }

  const alumnoInput = {
    first_name: 'Ana',
    last_name: 'Pérez',
    dni: 40_123_456,
    fecha_nacimiento: '2010-05-12',
    curso_division_turno_id: 1,
    relationship: 'padre' as const,
  };

  it('rechaza crear un alumno cuando el curso está lleno', async () => {
    const service = identityService(makeCurso({ capacidadMaxima: 2 }), 2);
    await expect(service.createAlumno(alumnoInput, ctx)).rejects.toThrow(CapacityExceededError);
  });

  it('permite continuar con la creación cuando hay cupo disponible', async () => {
    const service = identityService(makeCurso({ capacidadMaxima: 2 }), 1);
    await expect(service.createAlumno(alumnoInput, ctx)).rejects.toThrow(
      'Debe indicar tutor_id o los datos del tutor.',
    );
  });
});
