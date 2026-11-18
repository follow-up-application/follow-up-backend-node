import { createHash, randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closePool, query } from '../../src/infra/db/client.js';
import { buildTestApp, SEED } from '../helpers/http.js';

const app = buildTestApp();

interface PendingFixture {
  alumnoId: string;
  tutorId: string;
  linkId: string;
  code: string;
  alumnoFirstName: string;
  alumnoLastName: string;
  cursoDivision: string;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueDni(): number {
  return randomInt(10_000_000, 99_999_999);
}

async function insertPendingFixture(
  options: {
    code?: string;
    expiresAt?: Date;
    createdAt?: Date;
    activa?: boolean;
  } = {},
): Promise<PendingFixture> {
  const alumnoId = randomUUID();
  const tutorId = randomUUID();
  const linkId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const alumnoDni = uniqueDni();
  let tutorDni = uniqueDni();
  while (tutorDni === alumnoDni) tutorDni = uniqueDni();
  const code = options.code ?? `TUT-${randomUUID()}`;
  const createdAt = options.createdAt ?? new Date();
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const alumnoFirstName = 'Alumno';
  const alumnoLastName = `Publico ${suffix}`;

  await query(
    `INSERT INTO users (id, first_name, last_name, dni, role, must_change_password)
     VALUES ($1, $2, $3, $4, 'alumno', false),
            ($5, $6, $7, $8, 'tutor', false)`,
    [
      alumnoId,
      alumnoFirstName,
      alumnoLastName,
      alumnoDni,
      tutorId,
      'Tutor',
      `Pendiente ${suffix}`,
      tutorDni,
    ],
  );
  await query(
    `INSERT INTO alumnos (id, fecha_nacimiento, curso_division_turno_id)
     VALUES ($1, '2011-05-12', $2)`,
    [alumnoId, SEED.curso1Id],
  );
  await query('INSERT INTO tutores (id, telephone) VALUES ($1, $2)', [tutorId, '3815550000']);
  await query(
    `INSERT INTO tutor_alumno
       (id, alumno_id, tutor_id, relationship, codigo_institucional, estado_registro,
        activa, created_at, codigo_expira_en)
     VALUES ($1, $2, $3, 'padre', $4, 'pendiente', $5, $6, $7)`,
    [
      linkId,
      alumnoId,
      tutorId,
      code,
      options.activa ?? true,
      createdAt.toISOString(),
      expiresAt.toISOString(),
    ],
  );

  const course = await query<{ curso: number; division: string; turno: string }>(
    'SELECT curso, division, turno FROM curso_division_turno WHERE id = $1',
    [SEED.curso1Id],
  );
  const courseRow = course.rows[0];
  if (!courseRow) {
    throw new Error('No se encontró el curso del fixture.');
  }
  return {
    alumnoId,
    tutorId,
    linkId,
    code,
    alumnoFirstName,
    alumnoLastName,
    cursoDivision: `${courseRow.curso}°${courseRow.division.trim()} - ${courseRow.turno}`,
  };
}

function register(
  codigo: string,
  overrides: Partial<{ email: string; password: string; password_confirmation: string }> = {},
  key = randomUUID(),
) {
  const password = 'Publico1234!';
  return request(app)
    .post('/api/v1/tutores/register')
    .set('idempotency-key', key)
    .send({
      codigo,
      email: overrides.email ?? `tutor.publico.${randomUUID().slice(0, 8)}@example.com`,
      password: overrides.password ?? password,
      password_confirmation: overrides.password_confirmation ?? password,
    });
}

async function waitForIdempotency(codigo: string, key: string): Promise<void> {
  const scopeKey = `public:tutor-code:${hash(codigo)}`;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await query<{ estado: string }>(
      'SELECT estado FROM idempotency_keys WHERE scope_key = $1 AND clave = $2',
      [scopeKey, key],
    );
    if (result.rows[0]?.estado === 'completada') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('La Idempotency-Key pública no terminó de procesarse.');
}

afterAll(async () => {
  await closePool();
});

describe('validación y registro público de tutores por código institucional', () => {
  it('valida un código pendiente sin autenticación', async () => {
    const fixture = await insertPendingFixture();

    const response = await request(app).get(`/api/v1/tutores/validarCodigo/${fixture.code}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      alumno: {
        first_name: fixture.alumnoFirstName,
        last_name: fixture.alumnoLastName,
        curso_division: fixture.cursoDivision,
      },
    });
  });

  it('rechaza códigos inexistentes, vencidos, inactivos y ya registrados', async () => {
    const day = 24 * 60 * 60 * 1000;
    const expired = await insertPendingFixture({
      createdAt: new Date(Date.now() - 2 * day),
      expiresAt: new Date(Date.now() - day),
    });
    const inactive = await insertPendingFixture({ activa: false });
    const registered = await query<{ codigo_institucional: string }>(
      "SELECT codigo_institucional FROM tutor_alumno WHERE estado_registro = 'registrado' LIMIT 1",
    );
    const registeredCode = registered.rows[0]?.codigo_institucional;
    if (!registeredCode) {
      throw new Error('No hay un código registrado en el fixture.');
    }

    for (const codigo of ['NO-EXISTE-0001', expired.code, inactive.code, registeredCode]) {
      const response = await request(app).get(`/api/v1/tutores/validarCodigo/${codigo}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_CODE');
    }
  });

  it('registra un tutor, marca el vínculo y permite iniciar sesión', async () => {
    const fixture = await insertPendingFixture();
    const email = `tutor.publico.${randomUUID().slice(0, 8)}@example.com`;
    const password = 'Publico1234!';
    const key = randomUUID();

    const response = await register(
      fixture.code,
      { email, password, password_confirmation: password },
      key,
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: fixture.tutorId,
      first_name: 'Tutor',
      last_name: expect.any(String),
      email,
      username: email,
      role: 'tutor',
      is_active: true,
      must_change_password: false,
    });

    const link = await query<{ estado_registro: string; registered_at: string | null }>(
      'SELECT estado_registro, registered_at FROM tutor_alumno WHERE id = $1',
      [fixture.linkId],
    );
    expect(link.rows[0]?.estado_registro).toBe('registrado');
    expect(link.rows[0]?.registered_at).toBeTruthy();

    const user = await query<{ password_hash: string | null }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [fixture.tutorId],
    );
    expect(user.rows[0]?.password_hash).toMatch(/^\$argon2/);

    const audit = await query<{ total: number }>(
      `SELECT count(*)::int AS total FROM auditoria
        WHERE entidad = 'tutores' AND entidad_id = $1 AND accion = 'registrar'`,
      [fixture.tutorId],
    );
    expect(audit.rows[0]?.total).toBe(1);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('x-forwarded-for', '10.80.0.1')
      .send({ username: email, password });
    expect(login.status).toBe(200);
    expect(login.body.access_token).toBeTruthy();

    await waitForIdempotency(fixture.code, key);

    const replay = await register(
      fixture.code,
      { email, password, password_confirmation: password },
      key,
    );
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(fixture.tutorId);

    const reused = await register(
      fixture.code,
      {
        email: `otro.tutor.${randomUUID().slice(0, 8)}@example.com`,
        password,
        password_confirmation: password,
      },
      key,
    );
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rechaza registros inválidos sin modificar el vínculo', async () => {
    const fixture = await insertPendingFixture();
    const email = `tutor.rechazado.${randomUUID().slice(0, 8)}@example.com`;
    const password = 'Publico1234!';

    const invalidCode = await register('NO-EXISTE-0002', {
      email,
      password,
      password_confirmation: password,
    });
    expect(invalidCode.status).toBe(400);
    expect(invalidCode.body.error.code).toBe('INVALID_CODE');

    const mismatch = await register(fixture.code, {
      email,
      password,
      password_confirmation: 'Otra1234!',
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('VALIDATION_ERROR');

    const duplicated = await register(fixture.code, {
      email: 'laura@example.com',
      password,
      password_confirmation: password,
    });
    expect(duplicated.status).toBe(409);
    expect(duplicated.body.error.code).toBe('DUPLICATE_RESOURCE');

    const link = await query<{ estado_registro: string; registered_at: string | null }>(
      'SELECT estado_registro, registered_at FROM tutor_alumno WHERE id = $1',
      [fixture.linkId],
    );
    expect(link.rows[0]).toMatchObject({ estado_registro: 'pendiente', registered_at: null });

    const user = await query<{
      email: string | null;
      username: string | null;
      password_hash: string | null;
    }>('SELECT email, username, password_hash FROM users WHERE id = $1', [fixture.tutorId]);
    expect(user.rows[0]).toMatchObject({
      email: null,
      username: null,
      password_hash: null,
    });
  });
});
