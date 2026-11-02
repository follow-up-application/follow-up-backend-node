import type { ImportErrorProps } from './entities.js';
import type { Relationship } from '../identity/entities.js';
import type { LocalDate } from '../shared/types.js';
import {
  assertNotFuture,
  nonEmptyString,
  parseLegacyDate,
  validateDni,
} from '../shared/value-objects.js';

export const ALUMNOS_REQUIRED_HEADERS = [
  'first_name',
  'last_name',
  'dni',
  'fecha_nacimiento',
  'curso',
  'division',
  'turno',
  'tutor_first_name',
  'tutor_last_name',
  'tutor_dni',
  'tutor_telephone',
  'relationship',
  'otra_relacion',
] as const;

export interface AlumnoImportPayload {
  first_name: string;
  last_name: string;
  dni: number;
  fecha_nacimiento: LocalDate;
  curso: number;
  division: string;
  turno: 'Mañana' | 'Tarde';
  tutor_first_name: string;
  tutor_last_name: string;
  tutor_dni: number;
  tutor_telephone: string;
  relationship: Relationship;
  otra_relacion: string | null;
}

export interface AlumnoImportRowResult {
  rowNumber: number;
  raw: Record<string, string>;
  payload: AlumnoImportPayload | null;
  errors: ImportErrorProps[];
}

export function validateAlumnoHeaders(headers: string[]): string | null {
  const present = new Set(headers);
  for (const header of ALUMNOS_REQUIRED_HEADERS) {
    if (!present.has(header)) {
      return `Falta la columna obligatoria ${header}.`;
    }
  }
  return null;
}

function parseTurno(value: string): 'Mañana' | 'Tarde' {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'manana') return 'Mañana';
  if (normalized === 'tarde') return 'Tarde';
  throw new Error('El turno debe ser "Mañana" o "Tarde".');
}

function parseRelationship(value: string): Relationship {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'padre' || normalized === 'madre' || normalized === 'otra') {
    return normalized;
  }
  throw new Error('relationship debe ser padre, madre u otra.');
}

function parseCurso(value: string): number {
  const curso = Number(value);
  if (!Number.isInteger(curso) || curso < 1 || curso > 7) {
    throw new Error('El curso debe ser un entero entre 1 y 7.');
  }
  return curso;
}

function parseDivision(value: string): string {
  const division = value.trim().toUpperCase();
  if (!/^[A-Z]$/.test(division)) {
    throw new Error('La división debe ser una letra de A a Z.');
  }
  return division;
}

export function validateAlumnoRow(
  raw: Record<string, string>,
  rowNumber: number,
): AlumnoImportRowResult {
  const errors: ImportErrorProps[] = [];
  const value = (column: string): string =>
    typeof raw[column] === 'string' ? raw[column].trim() : '';

  const add = (column: string, code: string, message: string): void => {
    errors.push({
      rowNumber,
      columnName: column,
      code,
      message,
      rawValue: typeof raw[column] === 'string' ? raw[column] : null,
    });
  };

  const capture = <T>(fn: () => T, column: string, code: string): T | undefined => {
    try {
      return fn();
    } catch (error) {
      add(column, code, error instanceof Error ? error.message : 'Valor inválido.');
      return undefined;
    }
  };

  const firstName = capture(
    () => nonEmptyString(value('first_name'), 'first_name', 100),
    'first_name',
    'REQUIRED',
  );
  const lastName = capture(
    () => nonEmptyString(value('last_name'), 'last_name', 100),
    'last_name',
    'REQUIRED',
  );
  const dni = capture(() => validateDni(value('dni')), 'dni', 'INVALID_DNI');
  const fechaNacimiento = capture(() => {
    const parsed = parseLegacyDate(value('fecha_nacimiento'), 'fecha_nacimiento');
    assertNotFuture(parsed, 'fecha_nacimiento');
    return parsed;
  }, 'fecha_nacimiento', 'INVALID_DATE');
  const curso = capture(() => parseCurso(value('curso')), 'curso', 'INVALID_COURSE');
  const division = capture(() => parseDivision(value('division')), 'division', 'INVALID_DIVISION');
  const turno = capture(() => parseTurno(value('turno')), 'turno', 'INVALID_TURNO');
  const tutorFirstName = capture(
    () => nonEmptyString(value('tutor_first_name'), 'tutor_first_name', 100),
    'tutor_first_name',
    'REQUIRED',
  );
  const tutorLastName = capture(
    () => nonEmptyString(value('tutor_last_name'), 'tutor_last_name', 100),
    'tutor_last_name',
    'REQUIRED',
  );
  const tutorDni = capture(
    () => validateDni(value('tutor_dni')),
    'tutor_dni',
    'INVALID_DNI',
  );
  const tutorTelephone = capture(
    () => nonEmptyString(value('tutor_telephone'), 'tutor_telephone', 20),
    'tutor_telephone',
    'REQUIRED',
  );
  const relationship = capture(
    () => parseRelationship(value('relationship')),
    'relationship',
    'INVALID_RELATIONSHIP',
  );

  let otraRelacion: string | null = null;
  if (relationship === 'otra') {
    otraRelacion =
      capture(
        () => nonEmptyString(value('otra_relacion'), 'otra_relacion', 100),
        'otra_relacion',
        'REQUIRED',
      ) ?? null;
  }

  if (dni !== undefined && tutorDni !== undefined && dni === tutorDni) {
    add(
      'tutor_dni',
      'SAME_DNI',
      'El DNI del tutor no puede ser igual al DNI del alumno.',
    );
  }

  if (
    errors.length > 0 ||
    firstName === undefined ||
    lastName === undefined ||
    dni === undefined ||
    fechaNacimiento === undefined ||
    curso === undefined ||
    division === undefined ||
    turno === undefined ||
    tutorFirstName === undefined ||
    tutorLastName === undefined ||
    tutorDni === undefined ||
    tutorTelephone === undefined ||
    relationship === undefined
  ) {
    return { rowNumber, raw, payload: null, errors };
  }

  return {
    rowNumber,
    raw,
    payload: {
      first_name: firstName,
      last_name: lastName,
      dni,
      fecha_nacimiento: fechaNacimiento,
      curso,
      division,
      turno,
      tutor_first_name: tutorFirstName,
      tutor_last_name: tutorLastName,
      tutor_dni: tutorDni,
      tutor_telephone: tutorTelephone,
      relationship,
      otra_relacion: otraRelacion,
    },
    errors,
  };
}

export function addDuplicateError(
  target: AlumnoImportRowResult,
  source: AlumnoImportRowResult,
  column: 'dni' | 'tutor_dni',
  code: string,
): void {
  const value = source.payload?.[column];
  if (
    target.errors.some(
      (error) => error.code === code && error.columnName === column,
    )
  ) {
    return;
  }
  target.errors.push({
    rowNumber: target.rowNumber,
    columnName: column,
    code,
    message: 'El DNI aparece más de una vez en el archivo.',
    rawValue: value === undefined ? null : String(value),
  });
}
