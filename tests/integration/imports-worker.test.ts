import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildContainer, buildHttpServices } from '../../src/composition.js';
import { closePool, query } from '../../src/infra/db/client.js';
import { createApp } from '../../src/infra/http/app.js';
import { ImportWorker } from '../../src/infra/imports/import-worker.js';
import { login, SEED } from '../helpers/http.js';

const HEADER = [
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
].join(',');

interface ImportRow {
  firstName: string;
  lastName: string;
  dni: number;
  fechaNacimiento: string;
  tutorFirstName: string;
  tutorLastName: string;
  tutorDni: number;
  tutorTelephone: string;
}

interface ImportJobBody {
  id: string;
  estado: string;
  total_rows: number;
  processed_rows: number;
  valid_rows: number;
  error_rows: number;
  error_code: string | null;
}

const container = buildContainer();
const app: Express = createApp(container, buildHttpServices(container));
let worker: ImportWorker;
let adminToken: string;
let cursoId: number;
let sinkCursoId: number;

function uniqueDni(): number {
  return randomInt(10_000_000, 99_999_999);
}

function makeRow(): ImportRow {
  const dni = uniqueDni();
  let tutorDni = uniqueDni();
  while (tutorDni === dni) tutorDni = uniqueDni();
  return {
    firstName: 'Alumno',
    lastName: `Importado ${dni}`,
    dni,
    fechaNacimiento: '2010-05-10',
    tutorFirstName: 'Tutor',
    tutorLastName: `Importado ${tutorDni}`,
    tutorDni,
    tutorTelephone: '3415550000',
  };
}

function toCsv(rows: ImportRow[]): string {
  const lines = rows.map((row) =>
    [
      row.firstName,
      row.lastName,
      row.dni,
      row.fechaNacimiento,
      7,
      'Y',
      'Tarde',
      row.tutorFirstName,
      row.tutorLastName,
      row.tutorDni,
      row.tutorTelephone,
      'padre',
      '',
    ].join(','),
  );
  return [HEADER, ...lines].join('\n');
}

function startImport(csv: string, key = randomUUID()) {
  return request(app)
    .post('/api/v1/imports/alumnos')
    .set('authorization', `Bearer ${adminToken}`)
    .set('idempotency-key', key)
    .set('content-type', 'text/csv')
    .send(csv);
}

async function waitForJob(id: string, timeoutMs = 20_000): Promise<ImportJobBody> {
  const deadline = Date.now() + timeoutMs;
  let last: ImportJobBody | undefined;
  while (Date.now() < deadline) {
    const response = await request(app)
      .get(`/api/v1/imports/${id}`)
      .set('authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    last = response.body as ImportJobBody;
    if (last.estado === 'completada' || last.estado === 'fallida') return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`La importación ${id} no terminó: ${JSON.stringify(last)}`);
}

async function waitForIdempotency(key: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await query<{ estado: string }>(
      'SELECT estado FROM idempotency_keys WHERE scope_key = $1 AND clave = $2',
      [`user:${SEED.adminId}`, key],
    );
    if (result.rows[0]?.estado === 'completada') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`La Idempotency-Key ${key} no terminó de procesarse.`);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('La condición no se cumplió a tiempo.');
}

beforeAll(async () => {
  const result = await query<{ id: number; division: string }>(
    `INSERT INTO curso_division_turno
       (ciclo_lectivo_id, curso, division, turno, capacidad_maxima)
     VALUES
       ($1, 7, 'Y', 'Tarde', 200),
       ($1, 7, 'X', 'Tarde', 200)
     ON CONFLICT (ciclo_lectivo_id, curso, division, turno)
     DO UPDATE SET capacidad_maxima = EXCLUDED.capacidad_maxima
     RETURNING id, division`,
    [SEED.cicloId],
  );
  cursoId = Number(result.rows.find((row) => row.division === 'Y')?.id);
  sinkCursoId = Number(result.rows.find((row) => row.division === 'X')?.id);
  adminToken = await login(app, 'admin', '10.50.0.1');
});

beforeEach(async () => {
  await query('DELETE FROM import_errors');
  await query('DELETE FROM import_jobs');
  await query(
    'UPDATE alumnos SET curso_division_turno_id = $1 WHERE curso_division_turno_id = $2',
    [sinkCursoId, cursoId],
  );
  worker = new ImportWorker(container);
  worker.start();
});

afterEach(() => {
  worker.stop();
});

afterAll(async () => {
  await closePool();
});

describe('worker de importación de alumnos', () => {
  it('procesa un CSV válido y crea alumnos, tutores y vínculos', async () => {
    const rows = [makeRow(), makeRow()];

    const response = await startImport(toCsv(rows));
    expect(response.status).toBe(202);
    const created = response.body as ImportJobBody;
    expect(created.estado).toBe('pendiente');

    const job = await waitForJob(created.id);
    expect(job).toMatchObject({
      estado: 'completada',
      total_rows: 2,
      processed_rows: 2,
      valid_rows: 2,
      error_rows: 0,
      error_code: null,
    });

    for (const row of rows) {
      const user = await query<{
        id: string;
        role: string;
        password_hash: string | null;
        must_change_password: boolean;
      }>(
        `SELECT id, role, password_hash, must_change_password
         FROM users WHERE dni = $1`,
        [row.dni],
      );
      expect(user.rowCount).toBe(1);
      expect(user.rows[0]?.role).toBe('alumno');
      expect(user.rows[0]?.password_hash).toMatch(/^\$argon2/);
      expect(user.rows[0]?.must_change_password).toBe(true);

      const alumno = await query<{ curso_division_turno_id: string }>(
        `SELECT a.curso_division_turno_id
         FROM alumnos a JOIN users u ON u.id = a.id
         WHERE u.dni = $1`,
        [row.dni],
      );
      expect(Number(alumno.rows[0]?.curso_division_turno_id)).toBe(cursoId);

      const tutor = await query<{ id: string; telephone: string }>(
        `SELECT t.id, t.telephone
         FROM tutores t JOIN users u ON u.id = t.id
         WHERE u.dni = $1`,
        [row.tutorDni],
      );
      expect(tutor.rowCount).toBe(1);
      expect(tutor.rows[0]?.telephone).toBe(row.tutorTelephone);

      const link = await query<{ total: number }>(
        `SELECT count(*)::int AS total FROM tutor_alumno
         WHERE alumno_id = $1 AND tutor_id = $2`,
        [user.rows[0]?.id, tutor.rows[0]?.id],
      );
      expect(link.rows[0]?.total).toBe(1);
    }

    const stored = await query<{ storage_path: string }>(
      'SELECT storage_path FROM import_jobs WHERE id = $1',
      [job.id],
    );
    await waitUntil(() => !existsSync(String(stored.rows[0]?.storage_path)));
  });

  it('falla el archivo completo y no inserta nada si una fila es inválida', async () => {
    const valid = makeRow();
    const invalid = { ...makeRow(), lastName: '' };

    const response = await startImport(toCsv([valid, invalid]));
    expect(response.status).toBe(202);
    const created = response.body as ImportJobBody;

    const job = await waitForJob(created.id);
    expect(job).toMatchObject({
      estado: 'fallida',
      total_rows: 2,
      valid_rows: 1,
      error_rows: 1,
      error_code: 'IMPORT_FAILED',
    });

    const errors = await request(app)
      .get(`/api/v1/imports/${job.id}/errores`)
      .set('authorization', `Bearer ${adminToken}`);
    expect(errors.status).toBe(200);
    expect(errors.body.data).toEqual([
      expect.objectContaining({
        row_number: 3,
        column_name: 'last_name',
        code: 'REQUIRED',
      }),
    ]);

    const users = await query<{ total: number }>(
      'SELECT count(*)::int AS total FROM users WHERE dni = ANY($1::int[])',
      [[valid.dni, valid.tutorDni, invalid.dni, invalid.tutorDni]],
    );
    expect(users.rows[0]?.total).toBe(0);

    const stored = await query<{ storage_path: string }>(
      'SELECT storage_path FROM import_jobs WHERE id = $1',
      [job.id],
    );
    await waitUntil(() => !existsSync(String(stored.rows[0]?.storage_path)));
  });

  it('reproduce la respuesta ante la misma Idempotency-Key y no duplica la importación', async () => {
    const row = makeRow();
    const csv = toCsv([row]);
    const key = randomUUID();

    const first = await startImport(csv, key);
    expect(first.status).toBe(202);
    const firstBody = first.body as ImportJobBody;
    await waitForIdempotency(key);

    const replay = await startImport(csv, key);
    expect(replay.status).toBe(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((replay.body as ImportJobBody).id).toBe(firstBody.id);

    const reused = await startImport(toCsv([makeRow()]), key);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const jobs = await query<{ total: number }>(
      'SELECT count(*)::int AS total FROM import_jobs',
    );
    expect(jobs.rows[0]?.total).toBe(1);

    const job = await waitForJob(firstBody.id);
    expect(job.estado).toBe('completada');

    const users = await query<{ total: number }>(
      'SELECT count(*)::int AS total FROM users WHERE dni = $1',
      [row.dni],
    );
    expect(users.rows[0]?.total).toBe(1);
  });
});
