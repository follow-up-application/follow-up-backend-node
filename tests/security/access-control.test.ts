import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { env } from '../../src/config/env.js';
import { Argon2PasswordHasher } from '../../src/infra/security/password-hasher.js';
import { closePool, query } from '../../src/infra/db/client.js';
import { buildTestApp, enableSeedLogins, login, SEED } from '../helpers/http.js';
import { createForeignFixture, FOREIGN, type ForeignFixture } from '../helpers/fixtures.js';

let app: Express;
let foreign: ForeignFixture;
let adminToken: string;
let preceptorToken: string;
let docenteToken: string;
let alumnoToken: string;
let tutorToken: string;

beforeAll(async () => {
  app = buildTestApp();
  await enableSeedLogins();
  foreign = await createForeignFixture();
  adminToken = await login(app, 'admin', '10.20.0.1');
  preceptorToken = await login(app, 'preceptor', '10.20.0.2');
  docenteToken = await login(app, 'docente', '10.20.0.3');
  alumnoToken = await login(app, 'alumno', '10.20.0.4');
  tutorToken = await login(app, 'tutor', '10.20.0.5');
});

afterAll(async () => {
  await closePool();
});

function authed(token: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) {
  return request(app)[method](path).set('authorization', `Bearer ${token}`);
}

function idempotent(token: string, method: 'post' | 'put' | 'delete', path: string) {
  return authed(token, method, path).set('idempotency-key', randomUUID());
}

describe('autenticación y tokens', () => {
  it('rechaza pedidos protegidos sin token, con token falsificado, expirado o alterado', async () => {
    const noToken = await request(app).get('/api/v1/me');
    expect(noToken.status).toBe(401);
    expect(noToken.body.error.code).toBe('UNAUTHENTICATED');

    const forged = jwt.sign({ role: 'administrador', password_change_only: false }, 'otro-secreto-de-32-caracteres!!', {
      subject: SEED.adminId,
      expiresIn: 60,
      algorithm: 'HS256',
      jwtid: randomUUID(),
    });
    const forgedResponse = await request(app)
      .get('/api/v1/me')
      .set('authorization', `Bearer ${forged}`);
    expect(forgedResponse.status).toBe(401);
    expect(forgedResponse.body.error.code).toBe('UNAUTHENTICATED');

    const expired = jwt.sign(
      { role: 'administrador', password_change_only: false },
      env().JWT_SECRET,
      { subject: SEED.adminId, expiresIn: -10, algorithm: 'HS256', jwtid: randomUUID() },
    );
    const expiredResponse = await request(app)
      .get('/api/v1/me')
      .set('authorization', `Bearer ${expired}`);
    expect(expiredResponse.status).toBe(401);

    const tampered = `${adminToken.slice(0, -2)}xx`;
    const tamperedResponse = await request(app)
      .get('/api/v1/me')
      .set('authorization', `Bearer ${tampered}`);
    expect(tamperedResponse.status).toBe(401);
  });

  it('mantiene el acceso restringido hasta completar el cambio de contraseña', async () => {
    const hasher = new Argon2PasswordHasher();
    const password = 'Temporal1234!';
    const hash = await hasher.hash(password);
    const existing = await query<{ id: string }>('SELECT id FROM users WHERE dni = 30999003');
    const userId = existing.rows[0]?.id ?? randomUUID();
    const username = `temporal-${userId}`;
    if (existing.rows[0]) {
      await query(
        `UPDATE users
         SET first_name = 'Temporal', last_name = 'Restringido', username = $2, email = NULL,
             password_hash = $3, role = 'tutor', must_change_password = true, is_active = true
         WHERE id = $1`,
        [userId, username, hash],
      );
    } else {
      await query(
        `INSERT INTO users
           (id, first_name, last_name, dni, username, email, password_hash, role, must_change_password)
         VALUES ($1, 'Temporal', 'Restringido', 30999003, $2, NULL, $3, 'tutor', true)`,
        [userId, username, hash],
      );
    }
    await query(
      `INSERT INTO tutores (id, telephone) VALUES ($1, '3415559993')
       ON CONFLICT (id) DO UPDATE SET telephone = EXCLUDED.telephone`,
      [userId],
    );

    const firstLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('x-forwarded-for', '10.20.0.11')
      .send({ username: `temporal-${userId}`, password });
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.must_change_password).toBe(true);
    expect(firstLogin.body.refresh_token).toBeNull();
    const restrictedToken = firstLogin.body.access_token as string;

    const blocked = await authed(restrictedToken, 'get', '/api/v1/alumnos');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await authed(restrictedToken, 'get', '/api/v1/me');
    expect(me.status).toBe(200);

    const changed = await authed(restrictedToken, 'put', '/api/v1/password').send({
      current_password: password,
      new_password: 'Nueva1234!',
      new_password_confirmation: 'Nueva1234!',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.must_change_password).toBe(false);
    expect(typeof changed.body.refresh_token).toBe('string');

    const stillRestricted = await authed(restrictedToken, 'get', '/api/v1/alumnos');
    expect(stillRestricted.status).toBe(403);

    const secondLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('x-forwarded-for', '10.20.0.12')
      .send({ username: `temporal-${userId}`, password: 'Nueva1234!' });
    expect(secondLogin.status).toBe(200);
    const unrestricted = await authed(secondLogin.body.access_token as string, 'get', '/api/v1/alumnos');
    expect(unrestricted.status).toBe(200);
  });

  it('detecta reutilización de refresh tokens y revoca la familia', async () => {
    const first = await request(app)
      .post('/api/v1/auth/login')
      .set('x-forwarded-for', '10.20.0.13')
      .send({ username: 'laura@example.com', password: 'Tutor1234!' });
    expect(first.status).toBe(200);
    const oldRefresh = first.body.refresh_token as string;

    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: oldRefresh });
    expect(rotated.status).toBe(200);
    const newRefresh = rotated.body.refresh_token as string;

    const reused = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: oldRefresh });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    const revoked = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: newRefresh });
    expect(revoked.status).toBe(401);
  });
});

describe('matriz de acceso por recurso', () => {
  it('rechaza accesos cruzados de alumno, docente, preceptor y tutor', async () => {
    const otroAlumno = await authed(alumnoToken, 'get', `/api/v1/alumnos/${FOREIGN.alumnoId}`);
    expect(otroAlumno.status).toBe(404);

    const notasAjenas = await authed(
      alumnoToken,
      'get',
      `/api/v1/calificaciones?alumno_id=${FOREIGN.alumnoId}`,
    );
    expect(notasAjenas.status).toBe(404);

    const inscripcionAjena = await idempotent(alumnoToken, 'post', '/api/v1/inscripciones').send({
      alumno_id: FOREIGN.alumnoId,
      materia_id: SEED.materiaMatematicaId,
    });
    expect(inscripcionAjena.status).toBe(403);
    expect(inscripcionAjena.body.error.code).toBe('FORBIDDEN');

    const notaMateriaAjena = await idempotent(docenteToken, 'post', '/api/v1/calificaciones').send({
      instancia_id: FOREIGN.instanciaId,
      alumno_id: FOREIGN.alumnoId,
      valor: 9,
    });
    expect(notaMateriaAjena.status).toBe(404);

    const asistenciaAjena = await authed(
      docenteToken,
      'get',
      `/api/v1/asistencias?clase_id=${FOREIGN.claseId}`,
    );
    expect(asistenciaAjena.status).toBe(404);

    const cursoAjeno = await authed(
      preceptorToken,
      'get',
      `/api/v1/alumnos?curso_division_turno_id=${foreign.cursoId}`,
    );
    expect(cursoAjeno.status).toBe(404);

    const alumnoNoVinculado = await authed(tutorToken, 'get', `/api/v1/alumnos/${FOREIGN.alumnoId}`);
    expect(alumnoNoVinculado.status).toBe(404);

    const condicionNoVinculada = await authed(
      tutorToken,
      'get',
      `/api/v1/alumnos/${FOREIGN.alumnoId}/condicion?periodo_id=${SEED.periodoId}`,
    );
    expect(condicionNoVinculada.status).toBe(404);
  });

  it('rechaza acciones fuera del rol y creación pública de administradores', async () => {
    const cerrar = await idempotent(alumnoToken, 'post', `/api/v1/periodos/${SEED.periodoId}/cerrar`);
    expect(cerrar.status).toBe(403);

    const rectificar = await idempotent(
      docenteToken,
      'post',
      `/api/v1/calificaciones/${SEED.calificacion1Id}/rectificar`,
    ).send({ valor: 9, motivo: 'Intento sin permiso' });
    expect(rectificar.status).toBe(403);

    const importar = await idempotent(preceptorToken, 'post', '/api/v1/imports/alumnos')
      .set('content-type', 'text/csv')
      .send('first_name,last_name,dni\nAna,Perez,40123456\n');
    expect(importar.status).toBe(403);

    const listarUsuarios = await authed(alumnoToken, 'get', '/api/v1/users');
    expect(listarUsuarios.status).toBe(403);

    const listarTutores = await authed(preceptorToken, 'get', '/api/v1/tutores');
    expect(listarTutores.status).toBe(403);

    const adminPublico = await request(app).post('/api/v1/admins').send({
      first_name: 'Admin',
      last_name: 'Público',
      username: 'admin-publico',
      password: 'Admin1234!',
    });
    expect(adminPublico.status).toBe(401);
  });
});

describe('endurecimiento de entradas y datos sensibles', () => {
  it('no expone hashes, tokens internos ni trazas de stack', async () => {
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .set('x-forwarded-for', '10.20.0.21')
      .send({ username: 'admin', password: 'Admin1234!' });
    expect(loginResponse.status).toBe(200);
    expect(JSON.stringify(loginResponse.body)).not.toContain('password_hash');
    expect(JSON.stringify(loginResponse.body)).not.toContain('$argon2');

    const users = await authed(adminToken, 'get', '/api/v1/users?limit=100');
    expect(users.status).toBe(200);
    expect(JSON.stringify(users.body)).not.toContain('password_hash');
    expect(JSON.stringify(users.body)).not.toContain('$argon2');

    const notFound = await authed(adminToken, 'get', `/api/v1/alumnos/${randomUUID()}`);
    expect(notFound.status).toBe(404);
    expect(JSON.stringify(notFound.body)).not.toContain('at ');
    expect(notFound.body.error.code).toBe('NOT_FOUND');
    expect(notFound.body.requestId).toBeTruthy();
  });

  it('rechaza prototype pollution y no contamina objetos globales', async () => {
    const payload = '{"username":"admin","password":"x","__proto__":{"polluted":true}}';
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .set('x-forwarded-for', '10.20.0.22')
      .send(payload);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const nested = await authed(adminToken, 'post', '/api/v1/alumnos')
      .set('idempotency-key', randomUUID())
      .send({
        first_name: 'Contaminado',
        last_name: 'Prueba',
        dni: 30999004,
        fecha_nacimiento: '12/05/2010',
        curso_division_turno_id: SEED.curso1Id,
        relationship: 'madre',
        constructor: { prototype: { polluted: true } },
      });
    expect(nested.status).toBe(422);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('neutraliza inyección SQL y rechaza campos desconocidos', async () => {
    const injection = await request(app)
      .post('/api/v1/auth/login')
      .set('x-forwarded-for', '10.20.0.23')
      .send({ username: "' OR 1=1 --", password: 'cualquiera' });
    expect(injection.status).toBe(401);
    expect(injection.body.error.code).toBe('INVALID_CREDENTIALS');

    const filterInjection = await authed(
      adminToken,
      'get',
      "/api/v1/users?role=administrador'%20OR%20'1'='1",
    );
    expect(filterInjection.status).toBe(422);
    expect(filterInjection.body.error.code).toBe('VALIDATION_ERROR');

    const unknownField = await request(app)
      .post('/api/v1/auth/login')
      .set('x-forwarded-for', '10.20.0.24')
      .send({ username: 'admin', password: 'Admin1234!', is_admin: true });
    expect(unknownField.status).toBe(422);
    expect(unknownField.body.error.code).toBe('VALIDATION_ERROR');

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
  });

  it('aplica rate limit al login y devuelve Retry-After', async () => {
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await request(app)
        .post('/api/v1/auth/login')
        .set('x-forwarded-for', '10.20.0.99')
        .send({ username: 'admin', password: `incorrecta-${attempt}` });
    }
    expect(last?.status).toBe(429);
    expect(last?.body.error.code).toBe('RATE_LIMITED');
    expect(last?.headers['retry-after']).toBeTruthy();
  });
});
