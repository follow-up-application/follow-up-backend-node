import type { Express } from 'express';
import request from 'supertest';
import { buildContainer, buildHttpServices } from '../../src/composition.js';
import { query } from '../../src/infra/db/client.js';
import { createApp } from '../../src/infra/http/app.js';

export const SEED = {
  cicloId: '22222222-2222-4222-8222-222222222222',
  periodoId: '33333333-3333-4333-8333-333333333333',
  curso1Id: 1,
  curso2Id: 2,
  materiaMatematicaId: 1,
  materiaLenguaId: 2,
  instanciaParcialId: '44444444-4444-4444-8444-444444444441',
  instanciaTpId: '44444444-4444-4444-8444-444444444442',
  clase1Id: '55555555-5555-4555-8555-555555555551',
  asistencia1Id: '66666666-6666-4666-8666-666666666661',
  calificacion1Id: '77777777-7777-4777-8777-777777777771',
  adminId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  preceptorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  docenteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  alumnoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  tutorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
} as const;

export const CREDENTIALS = {
  admin: { username: 'admin', password: 'Admin1234!' },
  preceptor: { username: 'PRE-30111222-2026', password: '30111222' },
  docente: { username: 'DOC-30222333-2024', password: '30222333' },
  alumno: { username: 'EST-40123456-2026', password: '40123456' },
  tutor: { username: 'laura@example.com', password: 'Tutor1234!' },
} as const;

export function buildTestApp(): Express {
  const container = buildContainer();
  return createApp(container, buildHttpServices(container));
}

export async function enableSeedLogins(): Promise<void> {
  await query(
    `UPDATE users
     SET must_change_password = false
     WHERE id = ANY($1::uuid[])`,
    [[SEED.preceptorId, SEED.docenteId, SEED.alumnoId]],
  );
}

export async function login(
  app: Express,
  role: keyof typeof CREDENTIALS,
  ip = '10.10.0.1',
): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('x-forwarded-for', ip)
    .send(CREDENTIALS[role]);
  if (response.status !== 200 || typeof response.body.access_token !== 'string') {
    throw new Error(`Login ${role} falló: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.access_token as string;
}

export function auth(app: Express, token: string) {
  return (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
    request(app)[method](path).set('authorization', `Bearer ${token}`);
}
