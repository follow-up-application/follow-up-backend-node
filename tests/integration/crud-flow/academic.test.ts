import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authed,
  createAlumnoFixture,
  createClaseFixture,
  createCourseFixture,
  createMateriaFixture,
  expectStatus,
  randomCourseSlot,
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

describe('CRUD académico', () => {
  it('crea, consulta, actualiza y elimina un curso', async () => {
    const slot = await randomCourseSlot();
    const created = await write(app, adminToken, 'post', '/api/v1/cursos', {
      curso: slot.curso,
      division: slot.division,
      turno: slot.turno,
      capacidad_maxima: 25,
    });
    expectStatus(created, 201);
    const cursoId = Number(created.body.id);
    expect(created.body.version).toBe(1);

    const found = await authed(app, adminToken, 'get', `/api/v1/cursos/${cursoId}`);
    expect(found.status).toBe(200);
    expect(found.body.division).toBe(slot.division);

    const list = await authed(app, adminToken, 'get', '/api/v1/cursos?limit=500&offset=0');
    expect(list.status).toBe(200);
    expect(list.body.data.map((item: { id: number }) => item.id)).toContain(cursoId);

    const alias = await authed(
      app,
      adminToken,
      'get',
      '/api/v1/cursoDivisionTurno?limit=500&offset=0',
    );
    expect(alias.status).toBe(200);
    expect(alias.body.data.map((item: { id: number }) => item.id)).toContain(cursoId);

    const updated = await write(app, adminToken, 'put', `/api/v1/cursos/${cursoId}`, {
      capacidad_maxima: 35,
      version: created.body.version,
    });
    expectStatus(updated, 200);
    expect(updated.body.capacidad_maxima).toBe(35);
    expect(updated.body.version).toBe(2);

    const removed = await write(app, adminToken, 'delete', `/api/v1/cursos/${cursoId}`, {});
    expect(removed.status).toBe(204);
  });

  it('crea, consulta, actualiza y elimina una materia', async () => {
    const curso = await createCourseFixture(app, adminToken);
    const materia = await createMateriaFixture(app, adminToken, curso.id);

    const found = await authed(app, adminToken, 'get', `/api/v1/materias/${materia.id}`);
    expect(found.status).toBe(200);
    expect(found.body.curso_division_turno_id).toBe(curso.id);
    expect(found.body.docente_id).toBe(materia.docenteId);

    const byCourse = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/materias?curso_division_turno_id=${curso.id}&limit=500&offset=0`,
    );
    expect(byCourse.status).toBe(200);
    expect(byCourse.body.map((item: { id: number }) => item.id)).toContain(materia.id);

    const fromCourse = await authed(app, adminToken, 'get', `/api/v1/cursos/${curso.id}/materias`);
    expect(fromCourse.status).toBe(200);
    expect(fromCourse.body.map((item: { id: number }) => item.id)).toContain(materia.id);

    const updated = await write(app, adminToken, 'put', `/api/v1/materias/${materia.id}`, {
      nombre: 'Materia actualizada',
      version: found.body.version,
    });
    expectStatus(updated, 200);
    expect(updated.body.nombre).toBe('Materia actualizada');

    const removed = await write(app, adminToken, 'delete', `/api/v1/materias/${materia.id}`, {});
    expect(removed.status).toBe(204);
  });

  it('crea, consulta, aprueba y cancela una inscripción', async () => {
    const curso = await createCourseFixture(app, adminToken);
    const alumno = await createAlumnoFixture(app, adminToken, curso.id);
    const materia = await createMateriaFixture(app, adminToken, curso.id);

    const created = await write(app, adminToken, 'post', '/api/v1/inscripciones', {
      alumno_id: alumno.id,
      materia_id: materia.id,
      fecha_inscripcion: '2026-03-10',
    });
    expectStatus(created, 201);
    const inscripcionId = Number(created.body.id);
    expect(created.body.estado).toBe('pendiente');

    const found = await authed(app, adminToken, 'get', `/api/v1/inscripciones/${inscripcionId}`);
    expect(found.status).toBe(200);
    expect(found.body.alumno_id).toBe(alumno.id);

    const approved = await authed(
      app,
      adminToken,
      'put',
      `/api/v1/inscripciones/${inscripcionId}/estado`,
    ).send({ estado: 'aprobado' });
    expectStatus(approved, 200);
    expect(approved.body.estado).toBe('aprobado');

    const byMateria = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/materias/${materia.id}/inscripciones`,
    );
    expect(byMateria.status).toBe(200);
    expect(byMateria.body.map((item: { id: number }) => item.id)).toContain(inscripcionId);

    const byAlumno = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/alumnos/${alumno.id}/inscripciones?estado=aprobado`,
    );
    expect(byAlumno.status).toBe(200);
    expect(byAlumno.body.map((item: { id: number }) => item.id)).toContain(inscripcionId);

    const removed = await write(
      app,
      adminToken,
      'delete',
      `/api/v1/inscripciones/${inscripcionId}`,
      {},
    );
    expect(removed.status).toBe(204);
    const cancelled = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/inscripciones/${inscripcionId}`,
    );
    expect(cancelled.body.estado).toBe('cancelado');
  });

  it('crea, consulta y actualiza una clase', async () => {
    const curso = await createCourseFixture(app, adminToken);
    const materia = await createMateriaFixture(app, adminToken, curso.id);
    const clase = await createClaseFixture(app, adminToken, materia.id);

    const found = await authed(app, adminToken, 'get', `/api/v1/clases/${clase.id}`);
    expect(found.status).toBe(200);
    expect(found.body.materia_id).toBe(materia.id);
    expect(found.body.estado).toBe('dictada');

    const list = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/clases?materia_id=${materia.id}&limit=500&offset=0`,
    );
    expect(list.status).toBe(200);
    expect(list.body.data.map((item: { id: string }) => item.id)).toContain(clase.id);

    const updated = await write(app, adminToken, 'put', `/api/v1/clases/${clase.id}`, {
      tema: 'Clase actualizada',
      version: found.body.version,
    });
    expectStatus(updated, 200);
    expect(updated.body.tema).toBe('Clase actualizada');
  });
});
