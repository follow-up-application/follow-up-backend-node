import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const baseUrl = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const csvPath = resolve(process.env.CSV_PATH ?? 'tmp/alumnos-5000.csv');
const username = process.env.ADMIN_USERNAME ?? 'admin';
const password = process.env.ADMIN_PASSWORD ?? 'Admin1234!';

interface Job {
  id: string;
  estado: 'pendiente' | 'procesando' | 'completada' | 'fallida';
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  error_code: string | null;
  error_message: string | null;
}

async function login(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = (await response.json()) as { access_token?: string; error?: { message?: string } };
  if (!response.ok || !body.access_token) {
    throw new Error(`Login falló (${response.status}): ${body.error?.message ?? 'sin token'}`);
  }
  return body.access_token;
}

async function main(): Promise<void> {
  const content = readFileSync(csvPath);
  const token = await login();
  const startedAt = performance.now();

  const response = await fetch(`${baseUrl}/api/v1/imports/alumnos`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'text/csv',
      'idempotency-key': randomUUID(),
      'x-file-name': csvPath.split(/[\\/]/).pop() ?? 'alumnos.csv',
    },
    body: content,
  });
  const accepted = (await response.json()) as Job & { error?: { message?: string } };
  if (response.status !== 202) {
    throw new Error(`Importación rechazada (${response.status}): ${accepted.error?.message ?? ''}`);
  }

  let job = accepted;
  while (job.estado === 'pendiente' || job.estado === 'procesando') {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    const statusResponse = await fetch(`${baseUrl}/api/v1/imports/${job.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    job = (await statusResponse.json()) as Job;
    if (performance.now() - startedAt > 10 * 60 * 1000) {
      throw new Error('La importación superó los 10 minutos de espera.');
    }
  }

  const elapsedMs = performance.now() - startedAt;
  process.stdout.write(
    `${JSON.stringify(
      {
        job_id: job.id,
        estado: job.estado,
        total_rows: job.total_rows,
        valid_rows: job.valid_rows,
        error_rows: job.error_rows,
        error_code: job.error_code,
        error_message: job.error_message,
        elapsed_ms: Math.round(elapsedMs),
        rows_per_second: Math.round((job.total_rows / elapsedMs) * 1000),
      },
      null,
      2,
    )}\n`,
  );

  if (job.estado !== 'completada') process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
