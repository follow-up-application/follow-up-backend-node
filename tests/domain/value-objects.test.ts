import { Decimal } from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationDomainError } from '../../src/domain/shared/errors.js';
import {
  addDaysIso,
  assertNotFuture,
  decimalFrom,
  decimalToString,
  formatLegacyDate,
  isValidLocalDate,
  normalizeEmail,
  parseGrade,
  parseLegacyDate,
  parseLocalDate,
  parseLocalTime,
  parsePercentage,
  roundHalfUp,
  timeToMinutes,
  todayIso,
  validateDni,
  validatePassword,
  validateUsername,
} from '../../src/domain/shared/value-objects.js';

function expectValidation(run: () => unknown, message: string): void {
  expect(run).toThrow(ValidationDomainError);
  expect(run).toThrow(message);
}

describe('DNI', () => {
  it('acepta números de 7 y 8 dígitos en los límites', () => {
    expect(validateDni(1_000_000)).toBe(1_000_000);
    expect(validateDni(99_999_999)).toBe(99_999_999);
  });

  it('convierte strings numéricos a número', () => {
    expect(validateDni('40123456')).toBe(40_123_456);
  });

  it('rechaza valores fuera de rango', () => {
    expectValidation(() => validateDni(999_999), 'El DNI debe tener 7 u 8 dígitos.');
    expectValidation(() => validateDni(100_000_000), 'El DNI debe tener 7 u 8 dígitos.');
    expectValidation(() => validateDni(''), 'El DNI debe tener 7 u 8 dígitos.');
  });

  it('rechaza no enteros y valores no numéricos', () => {
    expectValidation(() => validateDni(12_345_678.5), 'El DNI debe ser un número entero.');
    expectValidation(() => validateDni('abc'), 'El DNI debe ser un número entero.');
    expectValidation(() => validateDni(null), 'El DNI debe ser un número entero.');
    expectValidation(() => validateDni(undefined), 'El DNI debe ser un número entero.');
    expectValidation(() => validateDni(true), 'El DNI debe ser un número entero.');
  });
});

describe('email', () => {
  it('normaliza a minúsculas y recorta espacios', () => {
    expect(normalizeEmail('  Juan.Perez@Example.COM  ')).toBe('juan.perez@example.com');
  });

  it('rechaza formatos inválidos', () => {
    for (const value of [
      'no-es-un-email',
      'usuario@',
      '@ejemplo.com',
      'usuario@ejemplo',
      'usuario @@ejemplo.com',
      'usuario@ejemplo .com',
    ]) {
      expectValidation(() => normalizeEmail(value), 'El email no es válido.');
    }
  });

  it('rechaza vacíos, no strings y exceso de longitud', () => {
    expectValidation(() => normalizeEmail('   '), 'email no puede estar vacío.');
    expectValidation(() => normalizeEmail(123), 'email debe ser un texto.');
    expectValidation(
      () => normalizeEmail(`${'a'.repeat(250)}@ejemplo.com`),
      'email supera el máximo de 255 caracteres.',
    );
  });
});

describe('username', () => {
  it('recorta espacios y acepta 3 o más caracteres', () => {
    expect(validateUsername('  ana  ')).toBe('ana');
    expect(validateUsername('abc')).toBe('abc');
  });

  it('rechaza menos de 3 caracteres', () => {
    expectValidation(() => validateUsername('ab'), 'El username debe tener al menos 3 caracteres.');
    expectValidation(() => validateUsername('   '), 'username no puede estar vacío.');
  });

  it('rechaza no strings y exceso de longitud', () => {
    expectValidation(() => validateUsername(123), 'username debe ser un texto.');
    expectValidation(
      () => validateUsername('a'.repeat(256)),
      'username supera el máximo de 255 caracteres.',
    );
  });
});

describe('contraseña', () => {
  it('acepta longitudes límite sin recortar espacios', () => {
    expect(validatePassword('123456')).toBe('123456');
    expect(validatePassword('x'.repeat(128))).toBe('x'.repeat(128));
    expect(validatePassword('  abc  ')).toBe('  abc  ');
  });

  it('rechaza longitudes fuera del rango', () => {
    expectValidation(
      () => validatePassword('12345'),
      'La contraseña debe tener entre 6 y 128 caracteres.',
    );
    expectValidation(
      () => validatePassword('x'.repeat(129)),
      'La contraseña debe tener entre 6 y 128 caracteres.',
    );
  });

  it('permite personalizar los límites', () => {
    expect(validatePassword('abcd', 4, 8)).toBe('abcd');
    expectValidation(
      () => validatePassword('abc', 4, 8),
      'La contraseña debe tener entre 4 y 8 caracteres.',
    );
  });

  it('rechaza valores no string', () => {
    expectValidation(() => validatePassword(123456), 'La contraseña debe ser un texto.');
  });
});

describe('notas y porcentajes', () => {
  it('parseGrade normaliza a dos decimales', () => {
    expect(parseGrade(0)).toBe('0.00');
    expect(parseGrade('7')).toBe('7.00');
    expect(parseGrade('7.5')).toBe('7.50');
    expect(parseGrade(10)).toBe('10.00');
  });

  it('rechaza notas fuera de rango', () => {
    expectValidation(() => parseGrade(-0.01), 'La nota debe estar entre 0.00 y 10.00.');
    expectValidation(() => parseGrade(10.01), 'La nota debe estar entre 0.00 y 10.00.');
  });

  it('rechaza más de dos decimales', () => {
    expectValidation(() => parseGrade('9.999'), 'La nota admite como máximo dos decimales.');
  });

  it('rechaza decimales inválidos', () => {
    for (const value of ['abc', '', null, undefined, 'NaN', 'Infinity', '1,5']) {
      expectValidation(() => parseGrade(value), 'valor debe ser un decimal válido.');
    }
  });

  it('parsePercentage valida rango, precisión y nombre de campo', () => {
    expect(parsePercentage(0)).toBe('0.00');
    expect(parsePercentage('25.5')).toBe('25.50');
    expect(parsePercentage(100)).toBe('100.00');
    expectValidation(() => parsePercentage(-0.01), 'peso debe estar entre 0 y 100.');
    expectValidation(() => parsePercentage(100.01), 'peso debe estar entre 0 y 100.');
    expectValidation(() => parsePercentage('12.345'), 'peso admite como máximo dos decimales.');
    expectValidation(
      () => parsePercentage('abc', 'asistencia'),
      'asistencia debe ser un decimal válido.',
    );
  });

  it('decimalFrom, roundHalfUp y decimalToString redondean HALF_UP', () => {
    expect(decimalFrom('3.14').toString()).toBe('3.14');
    expectValidation(() => decimalFrom('nope'), 'valor debe ser un decimal válido.');
    expect(roundHalfUp(new Decimal('2.345')).toString()).toBe('2.35');
    expect(roundHalfUp(new Decimal('2.344')).toString()).toBe('2.34');
    expect(roundHalfUp(new Decimal('-2.345')).toString()).toBe('-2.35');
    expect(decimalToString(new Decimal('1.005'))).toBe('1.01');
    expect(decimalToString(new Decimal('1.999'), 1)).toBe('2.0');
  });
});

describe('fechas', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('isValidLocalDate valida el calendario real', () => {
    expect(isValidLocalDate('2024-02-29')).toBe(true);
    expect(isValidLocalDate('2023-02-29')).toBe(false);
    expect(isValidLocalDate('2024-13-01')).toBe(false);
    expect(isValidLocalDate('2024-04-31')).toBe(false);
    expect(isValidLocalDate('2024-1-01')).toBe(false);
    expect(isValidLocalDate('12/05/2010')).toBe(false);
  });

  it('parseLocalDate exige formato ISO', () => {
    expect(parseLocalDate('2010-05-12')).toBe('2010-05-12');
    expectValidation(() => parseLocalDate('12/05/2010'), 'fecha debe tener formato YYYY-MM-DD.');
    expectValidation(
      () => parseLocalDate('2023-02-29', 'nacimiento'),
      'nacimiento debe tener formato YYYY-MM-DD.',
    );
    expectValidation(() => parseLocalDate(20100512), 'fecha debe tener formato YYYY-MM-DD.');
  });

  it('parseLegacyDate acepta ambos formatos y convierte a ISO', () => {
    expect(parseLegacyDate('12/05/2010')).toBe('2010-05-12');
    expect(parseLegacyDate('2010-05-12')).toBe('2010-05-12');
    expectValidation(
      () => parseLegacyDate('31/02/2010'),
      'fecha debe tener formato dd/mm/yyyy o YYYY-MM-DD.',
    );
    expectValidation(
      () => parseLegacyDate('12-05-2010', 'inicio'),
      'inicio debe tener formato dd/mm/yyyy o YYYY-MM-DD.',
    );
    expectValidation(() => parseLegacyDate(null), 'fecha debe ser una fecha.');
  });

  it('formatLegacyDate convierte ISO a dd/mm/yyyy', () => {
    expect(formatLegacyDate('2010-05-12')).toBe('12/05/2010');
  });

  it('todayIso y addDaysIso trabajan en UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T23:30:00.000Z'));
    expect(todayIso()).toBe('2024-01-15');
    expect(addDaysIso(3)).toBe('2024-01-18T23:30:00.000Z');
    expect(addDaysIso(-1)).toBe('2024-01-14T23:30:00.000Z');
  });

  it('assertNotFuture rechaza solo fechas posteriores a hoy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
    expect(() => assertNotFuture(parseLocalDate('2024-01-15'))).not.toThrow();
    expect(() => assertNotFuture(parseLocalDate('2024-01-14'))).not.toThrow();
    expectValidation(
      () => assertNotFuture(parseLocalDate('2024-01-16')),
      'fecha no puede ser futura.',
    );
    expectValidation(
      () => assertNotFuture(parseLocalDate('2024-01-16'), 'nacimiento'),
      'nacimiento no puede ser futura.',
    );
  });
});

describe('horas', () => {
  it('parseLocalTime acepta HH:mm en formato de 24 horas', () => {
    expect(parseLocalTime('08:30')).toBe('08:30');
    expect(parseLocalTime('00:00')).toBe('00:00');
    expect(parseLocalTime('23:59')).toBe('23:59');
  });

  it('parseLocalTime rechaza formatos y horas inválidas', () => {
    for (const value of ['24:00', '08:60', '8:30', '08:30:00', 'abc', '']) {
      expectValidation(() => parseLocalTime(value), 'hora debe tener formato HH:mm.');
    }
    expectValidation(() => parseLocalTime('25:00', 'inicio'), 'inicio debe tener formato HH:mm.');
  });

  it('timeToMinutes convierte a minutos desde medianoche', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('23:59')).toBe(1439);
  });
});
