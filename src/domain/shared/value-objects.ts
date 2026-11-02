import { Decimal } from 'decimal.js';
import { StaleVersionError, ValidationDomainError } from './errors.js';
import type { Decimal as DecimalString, LocalDate, LocalTime } from './types.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const LEGACY_DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function nonEmptyString(value: unknown, field: string, max = 255): string {
  if (typeof value !== 'string') {
    throw new ValidationDomainError(`${field} debe ser un texto.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationDomainError(`${field} no puede estar vacío.`);
  }
  if (trimmed.length > max) {
    throw new ValidationDomainError(`${field} supera el máximo de ${max} caracteres.`);
  }
  return trimmed;
}

export function optionalString(value: unknown, field: string, max = 255): string | null {
  if (value === null || value === undefined || value === '') return null;
  return nonEmptyString(value, field, max);
}

export function normalizeEmail(value: unknown): string {
  const email = nonEmptyString(value, 'email', 255).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new ValidationDomainError('El email no es válido.');
  }
  return email;
}

export function validateDni(value: unknown): number {
  const dni = typeof value === 'string' ? Number(value) : value;
  if (typeof dni !== 'number' || !Number.isInteger(dni)) {
    throw new ValidationDomainError('El DNI debe ser un número entero.');
  }
  if (dni < 1_000_000 || dni > 99_999_999) {
    throw new ValidationDomainError('El DNI debe tener 7 u 8 dígitos.');
  }
  return dni;
}

export function validateUsername(value: unknown): string {
  const username = nonEmptyString(value, 'username', 255);
  if (username.length < 3) {
    throw new ValidationDomainError('El username debe tener al menos 3 caracteres.');
  }
  return username;
}

export function validatePassword(value: unknown, min = 6, max = 128): string {
  if (typeof value !== 'string') {
    throw new ValidationDomainError('La contraseña debe ser un texto.');
  }
  if (value.length < min || value.length > max) {
    throw new ValidationDomainError(`La contraseña debe tener entre ${min} y ${max} caracteres.`);
  }
  return value;
}

export function isValidLocalDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseLocalDate(value: unknown, field = 'fecha'): LocalDate {
  if (typeof value !== 'string' || !isValidLocalDate(value)) {
    throw new ValidationDomainError(`${field} debe tener formato YYYY-MM-DD.`);
  }
  return value as LocalDate;
}

export function parseLegacyDate(value: unknown, field = 'fecha'): LocalDate {
  if (typeof value !== 'string') {
    throw new ValidationDomainError(`${field} debe ser una fecha.`);
  }
  if (DATE_RE.test(value)) return parseLocalDate(value, field);
  if (LEGACY_DATE_RE.test(value)) {
    const [day, month, year] = value.split('/');
    const iso = `${year}-${month}-${day}`;
    if (isValidLocalDate(iso)) return iso as LocalDate;
  }
  throw new ValidationDomainError(`${field} debe tener formato dd/mm/yyyy o YYYY-MM-DD.`);
}

export function formatLegacyDate(value: LocalDate | string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function parseLocalTime(value: unknown, field = 'hora'): LocalTime {
  if (typeof value !== 'string' || !TIME_RE.test(value)) {
    throw new ValidationDomainError(`${field} debe tener formato HH:mm.`);
  }
  return value as LocalTime;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function todayIso(): LocalDate {
  return new Date().toISOString().slice(0, 10) as LocalDate;
}

export function nowInstant(): string {
  return new Date().toISOString();
}

export function addDaysIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function assertNotFuture(value: LocalDate, field = 'fecha'): void {
  if (value > todayIso()) {
    throw new ValidationDomainError(`${field} no puede ser futura.`);
  }
}

export function assertVersion(current: number, expected?: number): void {
  if (expected !== undefined && current !== expected) {
    throw new StaleVersionError();
  }
}

export function decimalFrom(value: unknown, field = 'valor'): Decimal {
  try {
    const decimal = new Decimal(String(value));
    if (!decimal.isFinite()) throw new Error('not finite');
    return decimal;
  } catch {
    throw new ValidationDomainError(`${field} debe ser un decimal válido.`);
  }
}

export function parseGrade(value: unknown): DecimalString {
  const decimal = decimalFrom(value, 'valor');
  if (decimal.lessThan(0) || decimal.greaterThan(10)) {
    throw new ValidationDomainError('La nota debe estar entre 0.00 y 10.00.');
  }
  if (decimal.decimalPlaces() > 2) {
    throw new ValidationDomainError('La nota admite como máximo dos decimales.');
  }
  return decimal.toFixed(2) as DecimalString;
}

export function parsePercentage(value: unknown, field = 'peso'): DecimalString {
  const decimal = decimalFrom(value, field);
  if (decimal.lessThan(0) || decimal.greaterThan(100)) {
    throw new ValidationDomainError(`${field} debe estar entre 0 y 100.`);
  }
  if (decimal.decimalPlaces() > 2) {
    throw new ValidationDomainError(`${field} admite como máximo dos decimales.`);
  }
  return decimal.toFixed(2) as DecimalString;
}

export function roundHalfUp(value: Decimal, places = 2): Decimal {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

export function decimalToString(value: Decimal, places = 2): DecimalString {
  return roundHalfUp(value, places).toFixed(places) as DecimalString;
}

export function displayCourse(curso: number, division: string, turno: string): string {
  return `${curso}°${division} - ${turno}`;
}

export function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}
