import { describe, expect, it } from 'vitest';
import {
  ALUMNOS_REQUIRED_HEADERS,
  addDuplicateError,
  validateAlumnoHeaders,
  validateAlumnoRow,
} from '../../src/domain/imports/alumnos-csv.js';

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    first_name: 'Ana',
    last_name: 'Pérez',
    dni: '40123456',
    fecha_nacimiento: '12/05/2010',
    curso: '1',
    division: 'a',
    turno: 'manana',
    tutor_first_name: 'María',
    tutor_last_name: 'Pérez',
    tutor_dni: '30111222',
    tutor_telephone: '3415550000',
    relationship: 'madre',
    otra_relacion: '',
    ...overrides,
  };
}

describe('validación de CSV de alumnos', () => {
  it('acepta la cabecera completa en cualquier orden', () => {
    expect(validateAlumnoHeaders([...ALUMNOS_REQUIRED_HEADERS].reverse())).toBeNull();
  });

  it('reporta la primera columna obligatoria faltante', () => {
    expect(validateAlumnoHeaders(ALUMNOS_REQUIRED_HEADERS.filter((h) => h !== 'turno'))).toBe(
      'Falta la columna obligatoria turno.',
    );
  });

  it('normaliza una fila válida', () => {
    const result = validateAlumnoRow(row(), 2);
    expect(result.errors).toEqual([]);
    expect(result.payload).toMatchObject({
      first_name: 'Ana',
      dni: 40123456,
      fecha_nacimiento: '2010-05-12',
      curso: 1,
      division: 'A',
      turno: 'Mañana',
      relationship: 'madre',
      otra_relacion: null,
    });
  });

  it('acumula errores por campo', () => {
    const result = validateAlumnoRow(
      row({ dni: '123', turno: 'noche', relationship: 'otra', otra_relacion: '' }),
      3,
    );
    expect(result.payload).toBeNull();
    expect(result.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['INVALID_DNI', 'INVALID_TURNO', 'REQUIRED']),
    );
    expect(result.errors.find((e) => e.columnName === 'otra_relacion')?.code).toBe('REQUIRED');
  });

  it('rechaza DNI de alumno y tutor iguales', () => {
    const result = validateAlumnoRow(row({ tutor_dni: '40123456' }), 4);
    expect(result.payload).toBeNull();
    expect(result.errors.some((e) => e.code === 'SAME_DNI')).toBe(true);
  });

  it('agrega el error de duplicado una sola vez', () => {
    const first = validateAlumnoRow(row(), 5);
    const second = validateAlumnoRow(row(), 6);
    addDuplicateError(second, first, 'dni', 'DUPLICATE_DNI');
    addDuplicateError(second, first, 'dni', 'DUPLICATE_DNI');
    expect(second.errors).toHaveLength(1);
    expect(second.errors[0]).toMatchObject({
      rowNumber: 6,
      columnName: 'dni',
      code: 'DUPLICATE_DNI',
      rawValue: '40123456',
    });
  });
});
