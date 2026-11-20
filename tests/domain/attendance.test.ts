import { describe, expect, it, vi } from 'vitest';
import type { AppContainer } from '../../src/application/container.js';
import type { RequestContext } from '../../src/application/shared/context.js';
import { AttendanceService } from '../../src/application/attendance-service.js';
import type { Clase, Materia } from '../../src/domain/academic/entities.js';
import { Asistencia, type AsistenciaProps } from '../../src/domain/attendance/entities.js';
import type { Alumno } from '../../src/domain/identity/entities.js';
import {
  InvalidStateTransitionError,
  NotFoundError,
  ValidationDomainError,
} from '../../src/domain/shared/errors.js';
import type { Actor, AttendanceId, ClassId, UserId } from '../../src/domain/shared/types.js';

const NOW = '2026-01-15T12:00:00.000Z';

const actor: Actor = {
  id: 'docente-1' as UserId,
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

const clase = { id: 'clase-1', materiaId: 10 } as unknown as Clase;
const materia = { id: 10, cursoDivisionTurnoId: 1 } as unknown as Materia;

function expectValidation(run: () => unknown, message: string): void {
  expect(run).toThrow(ValidationDomainError);
  expect(run).toThrow(message);
}

function asistenciaProps(overrides: Partial<AsistenciaProps> = {}): AsistenciaProps {
  return {
    id: 'asistencia-1' as AttendanceId,
    claseId: 'clase-1' as ClassId,
    alumnoId: 'alumno-1' as UserId,
    estado: 'ausente',
    justificacion: null,
    registradaPor: 'docente-1' as UserId,
    version: 1,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeAsistencia(overrides: Partial<AsistenciaProps> = {}): Asistencia {
  return Asistencia.reconstitute(asistenciaProps(overrides));
}

function buildService(stubs: Record<string, unknown>): AttendanceService {
  return new AttendanceService(stubs as unknown as AppContainer);
}

describe('Asistencia: estados', () => {
  it('expone sus atributos', () => {
    expect(makeAsistencia()).toMatchObject({
      id: 'asistencia-1',
      claseId: 'clase-1',
      alumnoId: 'alumno-1',
      estado: 'ausente',
      justificacion: null,
      registradaPor: 'docente-1',
      version: 1,
      updatedAt: NOW,
    });
  });

  it('changeStatus aplica el estado justificada con justificación', () => {
    const asistencia = makeAsistencia();
    asistencia.changeStatus('justificada', '  Enfermedad  ');
    expect(asistencia.estado).toBe('justificada');
    expect(asistencia.justificacion).toBe('Enfermedad');

    asistencia.changeStatus('justificada', 'x'.repeat(600));
    expect(asistencia.justificacion).toBe('x'.repeat(500));
  });

  it('changeStatus exige justificación para el estado justificada', () => {
    const asistencia = makeAsistencia();
    for (const value of [null, '', '   ']) {
      expectValidation(
        () => asistencia.changeStatus('justificada', value),
        'La justificación es obligatoria para el estado justificada.',
      );
    }
  });

  it('changeStatus limpia la justificación en los demás estados', () => {
    const asistencia = makeAsistencia({ justificacion: 'Motivo previo' });
    for (const estado of ['presente', 'ausente', 'tarde'] as const) {
      asistencia.changeStatus(estado, 'Motivo ignorado');
      expect(asistencia.estado).toBe(estado);
      expect(asistencia.justificacion).toBeNull();
    }
  });
});

describe('Asistencia: justificación', () => {
  it('justify convierte una ausencia en justificada', () => {
    const asistencia = makeAsistencia();
    asistencia.justify('  Certificado médico  ');
    expect(asistencia.estado).toBe('justificada');
    expect(asistencia.justificacion).toBe('Certificado médico');

    const truncada = makeAsistencia();
    truncada.justify('y'.repeat(600));
    expect(truncada.justificacion).toBe('y'.repeat(500));
  });

  it('justify solo aplica a ausencias', () => {
    for (const estado of ['presente', 'tarde', 'justificada'] as const) {
      const asistencia = makeAsistencia({ estado });
      expect(() => asistencia.justify('Motivo')).toThrow(InvalidStateTransitionError);
      expect(() => asistencia.justify('Motivo')).toThrow('Solo una ausencia puede justificarse.');
    }
  });

  it('justify rechaza textos vacíos', () => {
    expectValidation(() => makeAsistencia().justify('   '), 'La justificación es obligatoria.');
  });

  it('create rechaza registrar el estado justificada directamente', async () => {
    const service = buildService({
      clases: { findById: async () => ({ ...clase, canRegisterAttendance: () => true }) },
      materias: { findById: async () => materia },
      alumnos: {
        findById: async () => ({
          id: 'alumno-1' as UserId,
          user: { isActive: true },
          cursoDivisionTurnoId: 1,
        }),
      },
      asistencias: { findByClaseAndAlumno: async () => null },
    });

    await expect(
      service.create(actor, {
        clase_id: 'clase-1',
        alumno_id: 'alumno-1',
        estado: 'justificada',
      }),
    ).rejects.toThrow('Para justificar use PUT /asistencias/:id/justificacion.');
  });

  it('update exige motivo al pasar a justificada', async () => {
    const service = buildService({
      asistencias: {
        findById: async () => makeAsistencia({ updatedAt: new Date().toISOString() }),
      },
      clases: { findById: async () => clase },
      materias: { findById: async () => materia },
    });

    await expect(
      service.update(actor, 'asistencia-1', { estado: 'justificada', version: 1 }, ctx),
    ).rejects.toThrow('La justificación es obligatoria para el estado justificada.');
  });
});

describe('Consulta de asistencia por clase', () => {
  it('empareja cada alumno del curso con su asistencia, o null si no tiene', async () => {
    const findByClase = vi.fn(async () => [
      makeAsistencia({ alumnoId: 'alumno-1' as UserId, estado: 'presente' }),
    ]);
    const listAlumnos = vi.fn(async () => [
      { id: 'alumno-1' } as unknown as Alumno,
      { id: 'alumno-2' } as unknown as Alumno,
    ]);
    const service = buildService({
      clases: { findById: async () => clase },
      materias: { findById: async () => materia },
      alumnos: { list: listAlumnos },
      asistencias: { findByClase },
    });

    const result = await service.listByClase(actor, 'clase-1');

    expect(result.clase).toBe(clase);
    expect(result.alumnos.map((item) => item.alumno.id)).toEqual(['alumno-1', 'alumno-2']);
    expect(result.alumnos.map((item) => item.asistencia?.estado ?? null)).toEqual([
      'presente',
      null,
    ]);
    expect(findByClase).toHaveBeenCalledWith('clase-1');
    expect(listAlumnos).toHaveBeenCalledWith({ courseId: 1, limit: 500, offset: 0 });
  });

  it('falla si la clase no existe', async () => {
    const service = buildService({ clases: { findById: async () => null } });
    await expect(service.listByClase(actor, 'inexistente')).rejects.toThrow(NotFoundError);
  });

  it('falla si la materia de la clase no existe', async () => {
    const service = buildService({
      clases: { findById: async () => clase },
      materias: { findById: async () => null },
    });
    await expect(service.listByClase(actor, 'clase-1')).rejects.toThrow(NotFoundError);
  });

  it('list por clase delega el filtro al repositorio', async () => {
    const list = vi.fn(async () => []);
    const service = buildService({
      clases: { findById: async () => clase },
      materias: { findById: async () => materia },
      asistencias: { list },
    });

    await service.list(actor, { claseId: 'clase-1', limit: 10, offset: 0 });

    expect(list).toHaveBeenCalledWith({ claseId: 'clase-1', limit: 10, offset: 0 });
  });
});
