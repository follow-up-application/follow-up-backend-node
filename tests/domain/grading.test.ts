import { describe, expect, it } from 'vitest';
import type { AppContainer } from '../../src/application/container.js';
import type { RequestContext } from '../../src/application/shared/context.js';
import { GradingService } from '../../src/application/grading-service.js';
import {
  Calificacion,
  CondicionAlumno,
  InstanciaEvaluacion,
  Periodo,
  PeriodoCierre,
  ReglaCondicion,
  calculateCondition,
  type CalificacionProps,
  type ConditionRule,
  type CondicionAlumnoProps,
  type InstanciaEvaluacionProps,
  type PeriodoCierreProps,
  type PeriodoProps,
  type ReglaCondicionProps,
} from '../../src/domain/grading/entities.js';
import {
  ConflictError,
  InvalidStateTransitionError,
  ValidationDomainError,
} from '../../src/domain/shared/errors.js';
import type {
  Actor,
  ConditionId,
  CycleId,
  Decimal as DecimalString,
  EvaluationId,
  GradeId,
  LocalDate,
  PeriodCloseId,
  PeriodId,
  SubjectId,
  Tx,
  UserId,
} from '../../src/domain/shared/types.js';

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

const rule: ConditionRule = {
  asistencia_minima_pct: 75,
  nota_minima_regular: 6,
  nota_minima_promocion: 8,
  condicion_sin_datos: 'no_aplica',
};

function expectValidation(run: () => unknown, message: string): void {
  expect(run).toThrow(ValidationDomainError);
  expect(run).toThrow(message);
}

function buildService(stubs: Record<string, unknown>): GradingService {
  return new GradingService(stubs as unknown as AppContainer);
}

function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return fn({ client: null });
}

function periodoProps(overrides: Partial<PeriodoProps> = {}): PeriodoProps {
  return {
    id: 'periodo-1' as PeriodId,
    cicloLectivoId: 'ciclo-1' as CycleId,
    nombre: 'Primer trimestre',
    tipo: 'trimestre',
    fechaInicio: '2026-01-01' as LocalDate,
    fechaFin: '2026-03-31' as LocalDate,
    estado: 'abierto',
    version: 1,
    ...overrides,
  };
}

function makePeriodo(overrides: Partial<PeriodoProps> = {}): Periodo {
  return Periodo.reconstitute(periodoProps(overrides));
}

function instanciaProps(
  overrides: Partial<InstanciaEvaluacionProps> = {},
): InstanciaEvaluacionProps {
  return {
    id: 'instancia-1' as EvaluationId,
    materiaId: 10 as SubjectId,
    periodoId: 'periodo-1' as PeriodId,
    nombre: 'Parcial 1',
    tipo: 'parcial',
    peso: '40.00' as DecimalString,
    fecha: '2026-02-15' as LocalDate,
    createdBy: 'docente-1' as UserId,
    version: 1,
    ...overrides,
  };
}

function makeInstancia(overrides: Partial<InstanciaEvaluacionProps> = {}): InstanciaEvaluacion {
  return InstanciaEvaluacion.reconstitute(instanciaProps(overrides));
}

function calificacionProps(overrides: Partial<CalificacionProps> = {}): CalificacionProps {
  return {
    id: 'calificacion-1' as GradeId,
    instanciaId: 'instancia-1' as EvaluationId,
    alumnoId: 'alumno-1' as UserId,
    valor: '7.00' as DecimalString,
    estado: 'activa',
    version: 1,
    createdBy: 'docente-1' as UserId,
    updatedBy: 'docente-1' as UserId,
    rectificadaPor: null,
    rectificadaEn: null,
    motivoRectificacion: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeCalificacion(overrides: Partial<CalificacionProps> = {}): Calificacion {
  return Calificacion.reconstitute(calificacionProps(overrides));
}

describe('Período', () => {
  it('expone sus atributos e isOpen', () => {
    const periodo = makePeriodo();
    expect(periodo).toMatchObject({
      id: 'periodo-1',
      cicloLectivoId: 'ciclo-1',
      nombre: 'Primer trimestre',
      tipo: 'trimestre',
      fechaInicio: '2026-01-01',
      fechaFin: '2026-03-31',
      estado: 'abierto',
      version: 1,
    });
    expect(periodo.isOpen()).toBe(true);
  });

  it('close es idempotente y assertOpen rechaza el período cerrado', () => {
    const periodo = makePeriodo();
    periodo.close();
    periodo.close();
    expect(periodo.estado).toBe('cerrado');
    expect(periodo.isOpen()).toBe(false);
    expect(() => periodo.assertOpen()).toThrow(InvalidStateTransitionError);
    expect(() => periodo.assertOpen()).toThrow('El período está cerrado.');
  });
});

describe('Instancia de evaluación', () => {
  it('expone sus atributos', () => {
    expect(makeInstancia()).toMatchObject({
      id: 'instancia-1',
      materiaId: 10,
      periodoId: 'periodo-1',
      nombre: 'Parcial 1',
      tipo: 'parcial',
      peso: '40.00',
      fecha: '2026-02-15',
      createdBy: 'docente-1',
      version: 1,
    });
  });

  it('changeWeight normaliza el peso y valida rango y precisión', () => {
    const instancia = makeInstancia();
    instancia.changeWeight('25' as DecimalString);
    expect(instancia.peso).toBe('25.00');
    instancia.changeWeight('100' as DecimalString);
    expect(instancia.peso).toBe('100.00');

    expectValidation(
      () => instancia.changeWeight('0' as DecimalString),
      'El peso debe ser mayor a 0.',
    );
    expectValidation(
      () => instancia.changeWeight('100.01' as DecimalString),
      'peso debe estar entre 0 y 100.',
    );
    expectValidation(
      () => instancia.changeWeight('33.333' as DecimalString),
      'peso admite como máximo dos decimales.',
    );
    expectValidation(
      () => instancia.changeWeight('abc' as DecimalString),
      'peso debe ser un decimal válido.',
    );
  });

  it('createInstancia exige período abierto y fecha dentro del período', async () => {
    const service = buildService({
      materias: { findById: async () => ({ id: 10 }) },
      periodos: { findById: async () => makePeriodo() },
    });
    const input = {
      materia_id: 10,
      periodo_id: 'periodo-1',
      nombre: 'Parcial 2',
      tipo: 'parcial',
      peso: 50,
      fecha: '2026-02-20',
    };

    await expect(
      service.createInstancia(actor, {
        ...input,
        fecha: '2026-05-01',
      }),
    ).rejects.toThrow('La fecha debe estar dentro del período.');
    await expect(
      buildService({
        materias: { findById: async () => ({ id: 10 }) },
        periodos: { findById: async () => makePeriodo({ estado: 'cerrado' }) },
      }).createInstancia(actor, input),
    ).rejects.toThrow(ConflictError);
  });
});

describe('Condición de alumno', () => {
  it('ReglaCondicion y CondicionAlumno exponen sus atributos', () => {
    const regla = ReglaCondicion.reconstitute({
      id: 'regla-1',
      periodoId: 'periodo-1' as PeriodId,
      materiaId: null,
      nombre: 'Regla por defecto',
      config: rule,
      activa: true,
      version: 1,
    } satisfies ReglaCondicionProps);
    const condicion = CondicionAlumno.reconstitute({
      id: 'condicion-1' as ConditionId,
      periodoId: 'periodo-1' as PeriodId,
      alumnoId: 'alumno-1' as UserId,
      materiaId: 10 as SubjectId,
      condicion: 'regular',
      promedio: '7.00' as DecimalString,
      porcentajeAsistencia: '90.00' as DecimalString,
      detalle: { totalWeight: '100.00' },
      calculadaEn: NOW,
      cierreId: 'cierre-1' as PeriodCloseId,
      version: 1,
    } satisfies CondicionAlumnoProps);

    expect([regla.nombre, regla.activa, regla.config]).toEqual(['Regla por defecto', true, rule]);
    expect(condicion).toMatchObject({
      id: 'condicion-1',
      condicion: 'regular',
      promedio: '7.00',
      porcentajeAsistencia: '90.00',
      cierreId: 'cierre-1',
    });
    const props = condicion.toProps();
    props.condicion = 'libre';
    expect(condicion.condicion).toBe('regular');
  });

  it('calculateCondition aplica nota y asistencia mínima', () => {
    const base = {
      attendance: { present: 9, late: 0, justified: 0, absent: 1 },
      taughtClasses: 10,
      rule,
    };
    const grades = (value: string) => [
      {
        value: value as DecimalString,
        weight: '100.00' as DecimalString,
        status: 'activa' as const,
      },
    ];

    expect(calculateCondition({ ...base, grades: grades('8.00') })).toMatchObject({
      condition: 'promocionado',
      average: '8.00',
      attendancePercentage: '90.00',
    });
    expect(calculateCondition({ ...base, grades: grades('7.00') }).condition).toBe('regular');
    expect(calculateCondition({ ...base, grades: grades('5.00') }).condition).toBe('libre');
    expect(
      calculateCondition({
        ...base,
        grades: grades('9.00'),
        attendance: { present: 5, late: 0, justified: 0, absent: 5 },
      }),
    ).toMatchObject({ condition: 'libre', attendancePercentage: '50.00' });
  });

  it('calculateCondition pondera notas y marca no_aplica sin datos', () => {
    const weighted = calculateCondition({
      grades: [
        { value: '8.00' as DecimalString, weight: '40.00' as DecimalString, status: 'activa' },
        { value: '6.00' as DecimalString, weight: '60.00' as DecimalString, status: 'rectificada' },
      ],
      attendance: { present: 10, late: 0, justified: 0, absent: 0 },
      taughtClasses: 10,
      rule,
    });
    expect(weighted).toMatchObject({ condition: 'regular', average: '6.80' });
    expect(weighted.detail).toMatchObject({ totalWeight: '100.00' });

    expect(
      calculateCondition({
        grades: [],
        attendance: { present: 9, late: 0, justified: 0, absent: 1 },
        taughtClasses: 10,
        rule,
      }),
    ).toMatchObject({ condition: 'no_aplica', average: null, attendancePercentage: '90.00' });
    expect(
      calculateCondition({
        grades: [],
        attendance: { present: 0, late: 0, justified: 0, absent: 0 },
        taughtClasses: 0,
        rule,
      }),
    ).toMatchObject({ condition: 'no_aplica', attendancePercentage: '0.00' });
  });
});

describe('Cierre de período', () => {
  it('PeriodoCierre expone su resumen', () => {
    const cierre = PeriodoCierre.reconstitute({
      id: 'cierre-1' as PeriodCloseId,
      periodoId: 'periodo-1' as PeriodId,
      ejecutadoPor: 'admin-1' as UserId,
      ejecutadoEn: NOW,
      totalAlumnos: 3,
      totalCondiciones: 4,
      resumen: { por_condicion: { regular: 4 } },
    } satisfies PeriodoCierreProps);
    expect(cierre).toMatchObject({
      id: 'cierre-1',
      periodoId: 'periodo-1',
      ejecutadoPor: 'admin-1',
      ejecutadoEn: NOW,
      totalAlumnos: 3,
      totalCondiciones: 4,
      resumen: { por_condicion: { regular: 4 } },
    });
  });

  it('closePeriodo es idempotente cuando el período ya está cerrado', async () => {
    const cierre = PeriodoCierre.reconstitute({
      id: 'cierre-1' as PeriodCloseId,
      periodoId: 'periodo-1' as PeriodId,
      ejecutadoPor: 'admin-1' as UserId,
      ejecutadoEn: NOW,
      totalAlumnos: 2,
      totalCondiciones: 2,
      resumen: {},
    });
    const service = buildService({
      periodos: { findForUpdate: async () => makePeriodo({ estado: 'cerrado' }) },
      cierres: { findByPeriodo: async () => cierre },
      condiciones: { findByPeriodo: async () => [] },
      uow: { transaction },
    });

    const result = await service.closePeriodo('periodo-1', ctx);

    expect(result.cierre).toBe(cierre);
    expect(result.condiciones).toEqual([]);
  });
});

describe('Rectificación de calificación', () => {
  it('rectify registra valor, estado, motivo y auditoría de la nota', () => {
    const calificacion = makeCalificacion();
    calificacion.rectify('9' as DecimalString, '  Error de carga  ', 'admin-1' as UserId, NOW);
    expect(calificacion).toMatchObject({
      valor: '9.00',
      estado: 'rectificada',
      rectificadaPor: 'admin-1',
      rectificadaEn: NOW,
      motivoRectificacion: 'Error de carga',
      updatedBy: 'admin-1',
    });

    const larga = makeCalificacion();
    larga.rectify('9' as DecimalString, 'm'.repeat(600), 'admin-1' as UserId, NOW);
    expect(larga.motivoRectificacion).toBe('m'.repeat(500));
    expectValidation(
      () => makeCalificacion().rectify('9' as DecimalString, '   ', 'admin-1' as UserId, NOW),
      'El motivo de rectificación es obligatorio.',
    );
  });

  it('changeValue actualiza nota y responsable, pero no sobre una nota anulada', () => {
    const calificacion = makeCalificacion();
    calificacion.changeValue('8' as DecimalString, 'admin-1' as UserId);
    expect([calificacion.valor, calificacion.updatedBy]).toEqual(['8.00', 'admin-1']);

    const anulada = makeCalificacion({ estado: 'anulada' });
    expectValidation(
      () => anulada.changeValue('8' as DecimalString, 'admin-1' as UserId),
      'Debe indicar un motivo para reemplazar una nota anulada.',
    );
  });

  it('annul exige motivo y no permite anular dos veces', () => {
    const calificacion = makeCalificacion();
    expectValidation(
      () => calificacion.annul('   ', 'admin-1' as UserId),
      'El motivo de anulación es obligatorio.',
    );
    calificacion.annul('  Nota duplicada  ', 'admin-1' as UserId);
    expect(calificacion.estado).toBe('anulada');
    expect(calificacion.motivoRectificacion).toBe('Nota duplicada');
    expect(() => calificacion.annul('Otro motivo', 'admin-1' as UserId)).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('replaceAnnulled reactiva la nota con motivo', () => {
    const anulada = makeCalificacion({ estado: 'anulada' });
    expect(() =>
      anulada.replaceAnnulled('8' as DecimalString, 'motivo', 'admin-1' as UserId),
    ).not.toThrow();
    expect(anulada).toMatchObject({ valor: '8.00', estado: 'activa', updatedBy: 'admin-1' });

    const activa = makeCalificacion();
    expect(() =>
      activa.replaceAnnulled('8' as DecimalString, 'motivo', 'admin-1' as UserId),
    ).toThrow(InvalidStateTransitionError);
    expectValidation(
      () =>
        makeCalificacion({ estado: 'anulada' }).replaceAnnulled(
          '8' as DecimalString,
          '',
          'admin-1' as UserId,
        ),
      'El motivo es obligatorio para reemplazar una nota anulada.',
    );
  });

  it('rectifyCalificacion solo opera sobre períodos cerrados', async () => {
    const service = buildService({
      calificaciones: { findById: async () => makeCalificacion() },
      instancias: { findById: async () => makeInstancia() },
      periodos: { findForUpdate: async () => makePeriodo() },
      uow: { transaction },
    });

    await expect(
      service.rectifyCalificacion(actor, 'calificacion-1', { valor: 9, motivo: 'Error' }, ctx),
    ).rejects.toThrow(ConflictError);
  });

  it('rectifyCalificacion persiste la nota rectificada', async () => {
    let saved: Calificacion | null = null;
    const service = buildService({
      calificaciones: {
        findById: async () => saved ?? makeCalificacion(),
        findForUpdate: async () => makeCalificacion(),
        save: async (calificacion: Calificacion) => {
          saved = calificacion;
        },
      },
      instancias: { findById: async () => makeInstancia() },
      periodos: { findForUpdate: async () => makePeriodo({ estado: 'cerrado' }) },
      uow: { transaction },
      clock: { now: () => NOW },
      ids: { uuid: () => 'generado' },
      auditoria: { append: async () => undefined },
      tutorAlumno: { findByAlumno: async () => [] },
    });

    const result = await service.rectifyCalificacion(
      actor,
      'calificacion-1',
      { valor: 9, motivo: 'Error de carga' },
      ctx,
    );

    expect(result.valor).toBe('9.00');
    expect(result.estado).toBe('rectificada');
    expect(result.motivoRectificacion).toBe('Error de carga');
    expect(result.rectificadaEn).toBe(NOW);
    expect(saved).not.toBeNull();
  });
});
