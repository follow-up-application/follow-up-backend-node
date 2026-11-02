import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { closePool, query } from '../../src/infra/db/client.js';
import { buildTestApp, enableSeedLogins, login } from '../helpers/http.js';
import {
  createForeignFixture,
  createGradeFixture,
  createOpenPeriodFixture,
  FOREIGN,
} from '../helpers/fixtures.js';

let app: Express;
let adminToken: string;
let docenteToken: string;

beforeAll(async () => {
  app = buildTestApp();
  await enableSeedLogins();
  await createForeignFixture();
  adminToken = await login(app, 'admin', '10.30.0.1');
  docenteToken = await login(app, 'docente', '10.30.0.2');
});

afterAll(async () => {
  await closePool();
});

function closePeriodo(periodoId: string, token = adminToken) {
  return request(app)
    .post(`/api/v1/periodos/${periodoId}/cerrar`)
    .set('authorization', `Bearer ${token}`)
    .set('idempotency-key', randomUUID());
}

async function gradeState(calificacionId: string) {
  const result = await query<{ valor: string; version: number; periodo_estado: string }>(
    `SELECT c.valor::text AS valor, c.version, p.estado AS periodo_estado
       FROM calificaciones c
       JOIN instancias_evaluacion i ON i.id = c.instancia_id
       JOIN periodos p ON p.id = i.periodo_id
      WHERE c.id = $1`,
    [calificacionId],
  );
  return result.rows[0];
}

async function updateAuditCount(calificacionId: string): Promise<number> {
  const result = await query<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM auditoria
      WHERE entidad = 'calificaciones' AND entidad_id = $1 AND accion = 'actualizar'`,
    [calificacionId],
  );
  return result.rows[0]?.total ?? 0;
}

describe('carrera de calificaciones', () => {
  it('serializa cincuenta actualizaciones sin perder ninguna confirmada', async () => {
    const fixture = await createGradeFixture();
    const values = Array.from({ length: 50 }, (_, index) =>
      ((index % 10) + 1).toFixed(2),
    );

    const responses = await Promise.all(
      values.map((valor) =>
        request(app)
          .put(`/api/v1/calificaciones/${fixture.calificacionId}`)
          .set('authorization', `Bearer ${docenteToken}`)
          .send({ valor }),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);

    const state = await gradeState(fixture.calificacionId);
    expect(values).toContain(state?.valor);
    expect(state?.version).toBe(51);
    expect(await updateAuditCount(fixture.calificacionId)).toBe(values.length);
  });

  it('resuelve la carrera entre una actualización y el cierre del período', async () => {
    const fixture = await createGradeFixture();

    const [update, close] = await Promise.all([
      request(app)
        .put(`/api/v1/calificaciones/${fixture.calificacionId}`)
        .set('authorization', `Bearer ${docenteToken}`)
        .send({ valor: '9.00' }),
      closePeriodo(fixture.periodoId),
    ]);

    expect(close.status, JSON.stringify(close.body)).toBe(200);
    expect([200, 409]).toContain(update.status);
    if (update.status === 409) {
      expect(update.body.error.code).toBe('CONFLICT');
    }

    const state = await gradeState(fixture.calificacionId);
    expect(state?.periodo_estado).toBe('cerrado');
    expect(['5.00', '9.00']).toContain(state?.valor);

    const audits = await updateAuditCount(fixture.calificacionId);
    expect(audits).toBe(update.status === 200 ? 1 : 0);
    if (state?.valor === '9.00') expect(audits).toBe(1);
  });

  it('devuelve el mismo cierre ante dos cierres simultáneos', async () => {
    const periodoId = await createOpenPeriodFixture();

    const [first, second] = await Promise.all([
      closePeriodo(periodoId),
      closePeriodo(periodoId),
    ]);

    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(first.body.cierre?.id).toBeTruthy();
    expect(first.body.cierre?.id).toBe(second.body.cierre?.id);

    const cierres = await query<{ total: number }>(
      'SELECT count(*)::int AS total FROM periodo_cierres WHERE periodo_id = $1',
      [periodoId],
    );
    expect(cierres.rows[0]?.total).toBe(1);

    const periodos = await query<{ estado: string }>(
      'SELECT estado FROM periodos WHERE id = $1',
      [periodoId],
    );
    expect(periodos.rows[0]?.estado).toBe('cerrado');
  });

  it('rechaza a un docente no asignado a la materia', async () => {
    const response = await request(app)
      .post('/api/v1/calificaciones')
      .set('authorization', `Bearer ${docenteToken}`)
      .set('idempotency-key', randomUUID())
      .send({ instancia_id: FOREIGN.instanciaId, alumno_id: FOREIGN.alumnoId, valor: 10 });

    expect(response.status).toBe(404);
  });
});
