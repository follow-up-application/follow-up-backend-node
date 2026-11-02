import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { pool } from '../../src/infra/db/client.js';
import {
  addDuplicateError,
  validateAlumnoHeaders,
  validateAlumnoRow,
} from '../../src/domain/imports/alumnos-csv.js';
import type { AlumnoImportRowResult } from '../../src/domain/imports/alumnos-csv.js';
import { Argon2PasswordHasher } from '../../src/infra/security/password-hasher.js';

const csvPath = resolve(process.env.CSV_PATH ?? 'tmp/alumnos-5000.csv');

async function main(): Promise<void> {
  const startedAt = performance.now();
  const content = readFileSync(csvPath, 'utf8');
  const records = parse(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const headers = records[0] ? Object.keys(records[0]) : [];
  const headerError = validateAlumnoHeaders(headers);
  if (headerError) throw new Error(headerError);

  const results: AlumnoImportRowResult[] = records.map((record, index) =>
    validateAlumnoRow(record, index + 2),
  );
  const byDni = new Map<number, AlumnoImportRowResult>();
  const byTutorDni = new Map<number, AlumnoImportRowResult>();
  for (const result of results) {
    const payload = result.payload;
    if (!payload) continue;
    const previousStudent = byDni.get(payload.dni);
    if (previousStudent) {
      addDuplicateError(previousStudent, result, 'dni', 'DUPLICATE_DNI');
      addDuplicateError(result, previousStudent, 'dni', 'DUPLICATE_DNI');
    } else {
      byDni.set(payload.dni, result);
    }
    const previousTutor = byTutorDni.get(payload.tutor_dni);
    if (previousTutor) {
      addDuplicateError(previousTutor, result, 'tutor_dni', 'DUPLICATE_TUTOR_DNI');
      addDuplicateError(result, previousTutor, 'tutor_dni', 'DUPLICATE_TUTOR_DNI');
    } else {
      byTutorDni.set(payload.tutor_dni, result);
    }
  }

  const valid = results.filter((result) => result.payload !== null && result.errors.length === 0);
  const invalid = results.filter((result) => result.payload === null || result.errors.length > 0);
  if (invalid.length > 0) {
    process.stdout.write(`Filas inválidas: ${invalid.length}; no se inserta nada.\n`);
    process.exitCode = 1;
    return;
  }

  const parsedAt = performance.now();
  const hasher = new Argon2PasswordHasher();
  const sharedHash = await hasher.hash('30111222');
  const client = await pool.connect();
  const ids = { ciclo: null as string | null, curso: null as number | null };

  try {
    await client.query('BEGIN');
    const first = valid[0]?.payload;
    if (!first) throw new Error('El CSV no tiene filas.');
    const courseResult = await client.query<{ id: number; ciclo: string }>(
      `SELECT cdt.id, cdt.ciclo_lectivo_id AS ciclo
       FROM curso_division_turno cdt
       JOIN ciclos_lectivos cl ON cl.id = cdt.ciclo_lectivo_id
       WHERE cl.estado = 'activo'
         AND cdt.curso = $1
         AND upper(cdt.division) = upper($2)
         AND cdt.turno = $3
       LIMIT 1`,
      [first.curso, first.division, first.turno],
    );
    const course = courseResult.rows[0];
    if (!course) throw new Error('El curso destino no existe en el ciclo activo.');
    ids.curso = course.id;
    ids.ciclo = course.ciclo;

    const dnis = valid.flatMap((result) =>
      result.payload ? [result.payload.dni, result.payload.tutor_dni] : [],
    );
    const existing = await client.query<{ dni: number }>(
      'SELECT dni FROM users WHERE dni = ANY($1::int[])',
      [dnis],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error(`Hay ${existing.rowCount} DNI ya existentes; la versión ingenua no los reutiliza.`);
    }

    for (const result of valid) {
      const payload = result.payload;
      if (!payload) continue;
      const alumnoId = randomUUID();
      const tutorId = randomUUID();
      await client.query(
        `INSERT INTO users
           (id, first_name, last_name, dni, username, email, password_hash, role, must_change_password)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,'alumno',true)`,
        [
          alumnoId,
          payload.first_name,
          payload.last_name,
          payload.dni,
          `EST-${payload.dni}-${new Date().getUTCFullYear()}`,
          sharedHash,
        ],
      );
      await client.query(
        `INSERT INTO alumnos (id, fecha_nacimiento, curso_division_turno_id)
         VALUES ($1,$2,$3)`,
        [alumnoId, payload.fecha_nacimiento, course.id],
      );
      await client.query(
        `INSERT INTO users
           (id, first_name, last_name, dni, username, email, password_hash, role, must_change_password)
         VALUES ($1,$2,$3,$4,NULL,NULL,NULL,'tutor',false)`,
        [tutorId, payload.tutor_first_name, payload.tutor_last_name, payload.tutor_dni],
      );
      await client.query('INSERT INTO tutores (id, telephone) VALUES ($1,$2)', [
        tutorId,
        payload.tutor_telephone,
      ]);
      await client.query(
        `INSERT INTO tutor_alumno
           (id, alumno_id, tutor_id, relationship, otra_relacion, codigo_institucional)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          alumnoId,
          tutorId,
          payload.relationship,
          payload.otra_relacion,
          `IMP-${payload.dni}-${randomUUID().slice(0, 8)}`,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const finishedAt = performance.now();
  process.stdout.write(
    `${JSON.stringify(
      {
        version: 'naive',
        csv: csvPath,
        rows: records.length,
        parse_validate_ms: Math.round(parsedAt - startedAt),
        insert_ms: Math.round(finishedAt - parsedAt),
        total_ms: Math.round(finishedAt - startedAt),
        rows_per_second: Math.round((records.length / (finishedAt - startedAt)) * 1000),
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        curso: ids.curso,
        ciclo: ids.ciclo,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
