import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildContainer, buildHttpServices } from '../../src/composition.js';
import { closePool } from '../../src/infra/db/client.js';
import { createApp } from '../../src/infra/http/app.js';

const container = buildContainer();
const app = createApp(container, buildHttpServices(container));

afterAll(async () => {
  await closePool();
});

describe('salud y contrato base', () => {
  it('GET /health responde 200 sin tocar la base', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('GET /api/v1/ruta-inexistente responde 404 uniforme', async () => {
    const response = await request(app).get('/api/v1/ruta-inexistente');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.requestId).toBeTruthy();
  });

  it('GET /api/v1/me sin token responde 401 uniforme', async () => {
    const response = await request(app).get('/api/v1/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('POST /api/v1/tutores/register sin Idempotency-Key responde 400', async () => {
    const response = await request(app)
      .post('/api/v1/tutores/register')
      .send({
        codigo: 'ABC123',
        email: 'tutor@example.com',
        password: '123456',
        password_confirmation: '123456',
      });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
