import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../../src/infra/db/client.js';
import {
  authed,
  createAlumnoFixture,
  createCourseFixture,
  expectStatus,
  randomDni,
  randomEmail,
  setupCrudSuite,
  teardownCrudSuite,
  write,
} from './helpers.js';

let app: Express;
let adminToken: string;

beforeAll(async () => {
  ({ app, adminToken } = await setupCrudSuite());
});

afterAll(async () => {
  await teardownCrudSuite();
});

describe('CRUD de identidad', () => {
  it('crea, consulta, actualiza y desactiva un administrador', async () => {
    const username = `admin.${randomUUID().slice(0, 8)}`;
    const created = await write(app, adminToken, 'post', '/api/v1/admins', {
      first_name: 'Nuevo',
      last_name: 'Admin',
      username,
      password: 'Admin1234!',
    });
    expectStatus(created, 201);
    const adminId = String(created.body.id);
    expect(created.body).toMatchObject({
      username,
      role: 'administrador',
      is_active: true,
      must_change_password: true,
    });

    const found = await authed(app, adminToken, 'get', `/api/v1/admins/${adminId}`);
    expect(found.status).toBe(200);
    expect(found.body.id).toBe(adminId);

    const updated = await write(app, adminToken, 'put', `/api/v1/admins/${adminId}`, {
      first_name: 'Actualizado',
    });
    expectStatus(updated, 200);
    expect(updated.body.first_name).toBe('Actualizado');

    const list = await authed(app, adminToken, 'get', '/api/v1/admins?limit=500&offset=0');
    expect(list.status).toBe(200);
    expect(list.body.map((item: { id: string }) => item.id)).toContain(adminId);

    const deactivated = await authed(
      app,
      adminToken,
      'patch',
      `/api/v1/users/${adminId}/estado`,
    ).send({ is_active: false, motivo: 'Prueba CRUD' });
    expectStatus(deactivated, 200);
    expect(deactivated.body.is_active).toBe(false);

    const removed = await write(app, adminToken, 'delete', `/api/v1/admins/${adminId}`, {
      motivo: 'Prueba CRUD',
    });
    expect(removed.status).toBe(204);
  });

  it('crea, consulta, actualiza y da de baja un alumno con su vínculo de tutor', async () => {
    const curso = await createCourseFixture(app, adminToken);
    const alumno = await createAlumnoFixture(app, adminToken, curso.id);

    const found = await authed(app, adminToken, 'get', `/api/v1/alumnos/${alumno.id}`);
    expect(found.status).toBe(200);
    expect(found.body.dni).toBe(alumno.dni);
    expect(found.body.curso_division_turno_id).toBe(curso.id);

    const byCourse = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/alumnos?curso_division_turno_id=${curso.id}&limit=500&offset=0`,
    );
    expect(byCourse.status).toBe(200);
    expect(byCourse.body.map((item: { id: string }) => item.id)).toContain(alumno.id);

    const tutorAlumnos = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/tutores/${alumno.tutorId}/alumnos`,
    );
    expect(tutorAlumnos.status).toBe(200);
    expect(tutorAlumnos.body.map((item: { id: string }) => item.id)).toContain(alumno.id);

    const updated = await write(app, adminToken, 'put', `/api/v1/alumnos/${alumno.id}`, {
      first_name: 'AlumnoActualizado',
    });
    expectStatus(updated, 200);
    expect(updated.body.first_name).toBe('AlumnoActualizado');

    const inscripciones = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/alumnos/${alumno.id}/inscripciones`,
    );
    expect(inscripciones.status).toBe(200);
    expect(Array.isArray(inscripciones.body)).toBe(true);

    const unlinked = await write(
      app,
      adminToken,
      'delete',
      `/api/v1/tutor-alumno/${alumno.tutorLinkId}`,
      {},
    );
    expect(unlinked.status).toBe(204);

    const removed = await write(app, adminToken, 'delete', `/api/v1/alumnos/${alumno.id}`, {
      motivo: 'Baja de prueba',
    });
    expect(removed.status).toBe(204);
    const state = await query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [
      alumno.id,
    ]);
    expect(state.rows[0]?.is_active).toBe(false);
  });

  it('crea un alumno vinculando un tutor existente por DNI', async () => {
    const curso = await createCourseFixture(app, adminToken);
    const tutorDni = randomDni();
    const tutor = await write(app, adminToken, 'post', '/api/v1/tutores', {
      first_name: 'Tutor',
      last_name: 'Existente',
      dni: tutorDni,
      telephone: '3815557777',
      email: randomEmail('tutor.existente'),
      password: 'Tutor1234!',
    });
    expectStatus(tutor, 201);
    const tutorId = String(tutor.body.id);

    const byDni = await authed(app, adminToken, 'get', `/api/v1/tutores/dni/${tutorDni}`);
    expect(byDni.status).toBe(200);
    expect(byDni.body.id).toBe(tutorId);

    const created = await write(app, adminToken, 'post', '/api/v1/alumnos', {
      first_name: 'Alumno',
      last_name: 'ConTutorExistente',
      dni: randomDni(),
      fecha_nacimiento: '2011-04-18',
      curso_division_turno_id: curso.id,
      relationship: 'padre',
      tutor_id: byDni.body.id,
    });
    expectStatus(created, 201);
    const alumnoId = String(created.body.id);

    const link = await query<{ id: string; tutor_id: string }>(
      'SELECT id, tutor_id FROM tutor_alumno WHERE alumno_id = $1 AND activa = true',
      [alumnoId],
    );
    const linkRow = link.rows[0];
    if (!linkRow) {
      throw new Error('No se creó el vínculo con el tutor existente.');
    }
    expect(linkRow.tutor_id).toBe(tutorId);

    const tutors = await query<{ total: number }>(
      'SELECT count(*)::int AS total FROM users WHERE dni = $1 AND role = $2',
      [tutorDni, 'tutor'],
    );
    expect(tutors.rows[0]?.total).toBe(1);

    await write(app, adminToken, 'delete', `/api/v1/tutor-alumno/${linkRow.id}`, {});
    await write(app, adminToken, 'delete', `/api/v1/alumnos/${alumnoId}`, {
      motivo: 'Baja de prueba',
    });
    await write(app, adminToken, 'delete', `/api/v1/tutores/${tutorId}`, {
      motivo: 'Baja de prueba',
    });
  });

  it('crea, consulta, actualiza y da de baja un docente', async () => {
    const curso = await createCourseFixture(app, adminToken);
    const dni = randomDni();
    const created = await write(app, adminToken, 'post', '/api/v1/docentes', {
      first_name: 'Docente',
      last_name: 'Crud',
      dni,
      telephone: '3815551111',
      fecha_ingreso: '2024-03-01',
      curso_division_turno_id: curso.id,
    });
    expectStatus(created, 201);
    const docenteId = String(created.body.id);
    expect(created.body.curso_division_turno_id).toBe(curso.id);

    const found = await authed(app, adminToken, 'get', `/api/v1/docentes/${docenteId}`);
    expect(found.status).toBe(200);
    expect(found.body.dni).toBe(dni);

    const byCourse = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/docentes?curso_division_turno_id=${curso.id}&limit=500&offset=0`,
    );
    expect(byCourse.status).toBe(200);
    expect(byCourse.body.map((item: { id: string }) => item.id)).toContain(docenteId);

    const materias = await authed(app, adminToken, 'get', `/api/v1/docentes/${docenteId}/materias`);
    expect(materias.status).toBe(200);
    expect(Array.isArray(materias.body)).toBe(true);

    const updated = await write(app, adminToken, 'put', `/api/v1/docentes/${docenteId}`, {
      telephone: '3815552222',
    });
    expectStatus(updated, 200);
    expect(updated.body.telephone).toBe('3815552222');

    const removed = await write(app, adminToken, 'delete', `/api/v1/docentes/${docenteId}`, {
      motivo: 'Baja de prueba',
    });
    expect(removed.status).toBe(204);
    const state = await query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [
      docenteId,
    ]);
    expect(state.rows[0]?.is_active).toBe(false);
  });

  it('crea, consulta, actualiza y da de baja un tutor', async () => {
    const dni = randomDni();
    const email = randomEmail('tutor.crud');
    const created = await write(app, adminToken, 'post', '/api/v1/tutores', {
      first_name: 'Tutor',
      last_name: 'Crud',
      dni,
      telephone: '3815553333',
      email,
      password: 'Tutor1234!',
    });
    expectStatus(created, 201);
    const tutorId = String(created.body.id);

    const found = await authed(app, adminToken, 'get', `/api/v1/tutores/${tutorId}`);
    expect(found.status).toBe(200);
    expect(found.body.email).toBe(email);

    const byDni = await authed(app, adminToken, 'get', `/api/v1/tutores/dni/${dni}`);
    expect(byDni.status).toBe(200);
    expect(byDni.body.id).toBe(tutorId);

    const list = await authed(app, adminToken, 'get', '/api/v1/tutores?limit=500&offset=0');
    expect(list.status).toBe(200);
    expect(list.body.map((item: { id: string }) => item.id)).toContain(tutorId);

    const updated = await write(app, adminToken, 'put', `/api/v1/tutores/${tutorId}`, {
      telephone: '3815554444',
    });
    expectStatus(updated, 200);
    expect(updated.body.telephone).toBe('3815554444');

    const removed = await write(app, adminToken, 'delete', `/api/v1/tutores/${tutorId}`, {
      motivo: 'Baja de prueba',
    });
    expect(removed.status).toBe(204);
    const state = await query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [
      tutorId,
    ]);
    expect(state.rows[0]?.is_active).toBe(false);
  });

  it('crea, consulta, reasigna cursos y da de baja un preceptor', async () => {
    const cursoA = await createCourseFixture(app, adminToken);
    const cursoB = await createCourseFixture(app, adminToken);
    const created = await write(app, adminToken, 'post', '/api/v1/preceptores', {
      first_name: 'Preceptor',
      last_name: 'Crud',
      dni: randomDni(),
      telephone: '3815555555',
      employee_code: `PRE-${randomUUID().slice(0, 8)}`,
      cursos: [cursoA.id],
    });
    expectStatus(created, 201);
    const preceptorId = String(created.body.id);
    expect(created.body.cursos.map((curso: { id: number }) => curso.id)).toContain(cursoA.id);

    const found = await authed(app, adminToken, 'get', `/api/v1/preceptores/${preceptorId}`);
    expect(found.status).toBe(200);
    expect(found.body.id).toBe(preceptorId);

    const byCourse = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/preceptores?curso_division_turno_id=${cursoA.id}&limit=500&offset=0`,
    );
    expect(byCourse.status).toBe(200);
    expect(byCourse.body.data.map((item: { id: string }) => item.id)).toContain(preceptorId);

    const reassigned = await write(
      app,
      adminToken,
      'put',
      `/api/v1/preceptores/${preceptorId}/cursos`,
      { cursos: [cursoB.id] },
    );
    expectStatus(reassigned, 200);
    expect(reassigned.body.cursos.map((curso: { id: number }) => curso.id)).toEqual([cursoB.id]);

    const updated = await write(app, adminToken, 'put', `/api/v1/preceptores/${preceptorId}`, {
      telephone: '3815556666',
    });
    expectStatus(updated, 200);
    expect(updated.body.telephone).toBe('3815556666');

    const removed = await write(app, adminToken, 'delete', `/api/v1/preceptores/${preceptorId}`, {
      motivo: 'Baja de prueba',
    });
    expect(removed.status).toBe(204);
    const state = await query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [
      preceptorId,
    ]);
    expect(state.rows[0]?.is_active).toBe(false);
  });
});
