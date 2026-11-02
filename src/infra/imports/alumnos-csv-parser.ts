import { parse } from 'csv-parse/sync';
import {
  addDuplicateError,
  validateAlumnoHeaders,
  validateAlumnoRow,
  type AlumnoImportRowResult,
} from '../../domain/imports/alumnos-csv.js';

export interface AlumnosCsvParserInput {
  content: Uint8Array;
  maxRows: number;
  batchSize: number;
}

export interface AlumnosCsvParsedBatchRow {
  rowNumber: number;
  payload: Record<string, unknown>;
  status: 'valida' | 'invalida';
  errors: AlumnoImportRowResult['errors'];
}

export interface AlumnosCsvParserCallbacks {
  onStart(totalRows: number): void;
  onBatch(rows: AlumnosCsvParsedBatchRow[]): void | Promise<void>;
}

export interface AlumnosCsvParserResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
}

export type AlumnosCsvParseErrorKind = 'invalid' | 'limit';

export class AlumnosCsvParseError extends Error {
  constructor(
    readonly kind: AlumnosCsvParseErrorKind,
    message: string,
    readonly totalRows = 0,
  ) {
    super(message);
    this.name = 'AlumnosCsvParseError';
  }
}

function readHeaders(buffer: Buffer): string[] {
  const headerRows = parse(buffer, {
    bom: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false,
    to_line: 1,
  }) as string[][];
  return (headerRows[0] ?? []).map((header) => String(header).trim());
}

export async function parseAlumnosCsv(
  input: AlumnosCsvParserInput,
  callbacks: AlumnosCsvParserCallbacks,
): Promise<AlumnosCsvParserResult> {
  const buffer = Buffer.from(input.content);
  let records: Record<string, string>[];
  try {
    records = parse(buffer, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    }) as Record<string, string>[];
  } catch {
    throw new AlumnosCsvParseError('invalid', 'No se pudo interpretar el CSV.');
  }

  let headers: string[];
  try {
    headers = records[0] ? Object.keys(records[0]) : readHeaders(buffer);
  } catch {
    throw new AlumnosCsvParseError('invalid', 'No se pudo interpretar el CSV.');
  }

  const headerError = validateAlumnoHeaders(headers);
  if (headerError) {
    throw new AlumnosCsvParseError('invalid', headerError);
  }

  if (records.length > input.maxRows) {
    throw new AlumnosCsvParseError(
      'limit',
      `El CSV supera el máximo de ${input.maxRows} filas.`,
      records.length,
    );
  }

  callbacks.onStart(records.length);
  const results = records.map((record, index) => validateAlumnoRow(record, index + 2));
  const firstByStudentDni = new Map<number, AlumnoImportRowResult>();
  const firstByTutorDni = new Map<number, AlumnoImportRowResult>();

  for (const result of results) {
    if (!result.payload) continue;
    const student = firstByStudentDni.get(result.payload.dni);
    if (student) {
      addDuplicateError(student, result, 'dni', 'DUPLICATE_DNI');
      addDuplicateError(result, student, 'dni', 'DUPLICATE_DNI');
    } else {
      firstByStudentDni.set(result.payload.dni, result);
    }

    const tutor = firstByTutorDni.get(result.payload.tutor_dni);
    if (tutor) {
      addDuplicateError(tutor, result, 'tutor_dni', 'DUPLICATE_TUTOR_DNI');
      addDuplicateError(result, tutor, 'tutor_dni', 'DUPLICATE_TUTOR_DNI');
    } else {
      firstByTutorDni.set(result.payload.tutor_dni, result);
    }
  }

  const batchSize = Math.max(1, input.batchSize);
  for (let start = 0; start < results.length; start += batchSize) {
    const rows: AlumnosCsvParsedBatchRow[] = results
      .slice(start, start + batchSize)
      .map((result) => ({
        rowNumber: result.rowNumber,
        payload: (result.payload ?? result.raw) as unknown as Record<string, unknown>,
        status: result.errors.length > 0 ? 'invalida' : 'valida',
        errors: result.errors,
      }));
    await callbacks.onBatch(rows);
  }

  const validRows = results.filter((result) => result.errors.length === 0).length;
  return {
    totalRows: results.length,
    validRows,
    errorRows: results.length - validRows,
  };
}
