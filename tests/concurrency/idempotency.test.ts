import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { closePool, query } from '../../src/infra/db/client.js';
import { buildTestApp, enableSeedLogins, login, SEED } from '../helpers/http.js';

let app: Express;
let adminToken: string;

beforeAll(async () => {
  app = buildTestApp();
  await enableSeedLogins();
  adminToken = await login(app, 'admin', '10.40.0.1');
});

afterAll(async () => {
  await closePool();
});

async function waitForCompletion(key: string): Promise<void> {
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

function createPeriodo(key: string, nombre: string) {
  return request(app)
    .post('/api/v1/periodos')
    .set('authorization', `Bearer ${adminToken}`)
    .set('idempotency-key', key)
    .send({
      ciclo_lectivo_id: SEED.cicloId,
      nombre,
      tipo: 'trimestre',
      fecha_inicio: '2026-10-01',
      fecha_fin: '2026-12-01',
    });
}

describe('idempotencia de pedidos', () => {
  it('reproduce la respuesta guardada sin repetir el efecto', async () => {
    const key = randomUUID();
    const nombre = `Idempotente ${randomUUID()}`;

    const first = await createPeriodo(key, nombre);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    await waitForCompletion(key);

    const second = await createPeriodo(key, nombre);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);

    const count = await query<{ total: number }>(
      'SELECT count(*)::int AS total FROM periodos WHERE ciclo_lectivo_id = $1 AND nombre = $2',
      [SEED.cicloId, nombre],
    );
    expect(count.rows[0]?.total).toBe(1);
  });

  it('rechaza la misma clave con un cuerpo distinto', async () => {
    const key = randomUUID();
    const nombre = `Original ${randomUUID()}`;

    const first = await createPeriodo(key, nombre);
    expect(first.status).toBe(201);
    await waitForCompletion(key);

    const different = await createPeriodo(key, `${nombre} distinto`);
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const count = await query<{ total: number }>(
      'SELECT count(*)::int AS total FROM periodos WHERE ciclo_lectivo_id = $1 AND nombre LIKE $2',
      [SEED.cicloId, `${nombre}%`],
    );
    expect(count.rows[0]?.total).toBe(1);
  });
});
