import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../../src/infra/db/client.js';
import { SEED } from '../../helpers/http.js';
import {
  authed,
  createAlumnoFixture,
  createCourseFixture,
  createInscripcionFixture,
  createMateriaFixture,
  expectStatus,
  setupCrudSuite,
  teardownCrudSuite,
  write,
} from './helpers.js';

interface AsistenciaResumen {
  id: string;
  estado: string;
  justificacion: string | null;
}

interface ConsultaPorClase {
  clase: { id: string };
  alumnos: Array<{
    alumno: { id: string };
    asistencia: AsistenciaResumen | null;
  }>;
}

let app: Express;
let adminToken: string;
let cursoId: number;
let alumnoId: string;
let materiaId: number;
let claseId: string;
let asistenciaId: string;

function asistenciaDe(body: ConsultaPorClase, id: string): AsistenciaResumen | null {
  return body.alumnos.find((item) => item.alumno.id === id)?.asistencia ?? null;
}

beforeAll(async () => {
  ({ app, adminToken } = await setupCrudSuite());

  const curso = await createCourseFixture(app, adminToken);
  cursoId = curso.id;
  const alumno = await createAlumnoFixture(app, adminToken, curso.id);
  alumnoId = alumno.id;
  const materia = await createMateriaFixture(app, adminToken, curso.id);
  materiaId = materia.id;
  await createInscripcionFixture(app, adminToken, alumno.id, materia.id);

  const clase = await write(app, adminToken, 'post', '/api/v1/clases', {
    materia_id: materia.id,
    fecha: '2026-03-10',
    hora_inicio: '09:00',
    hora_fin: '10:00',
    tema: `Clase de asistencia ${randomUUID().slice(0, 8)}`,
  });
  expectStatus(clase, 201);
  claseId = String(clase.body.id);

  const dictada = await write(app, adminToken, 'put', `/api/v1/clases/${claseId}`, {
    estado: 'dictada',
    version: clase.body.version,
  });
  expectStatus(dictada, 200);

  const asistencia = await write(app, adminToken, 'post', '/api/v1/asistencias', {
    clase_id: claseId,
    alumno_id: alumno.id,
    estado: 'ausente',
  });
  expectStatus(asistencia, 201);
  asistenciaId = String(asistencia.body.id);
});

afterAll(async () => {
  await teardownCrudSuite();
});

describe('flujo HTTP de clases, asistencias y justificación', () => {
  it('da de alta una clase, registra la asistencia y la justifica con consulta por clase', async () => {
    const encontrada = await authed(app, adminToken, 'get', `/api/v1/clases/${claseId}`);
    expect(encontrada.status).toBe(200);
    expect(encontrada.body).toMatchObject({
      id: claseId,
      materia_id: materiaId,
      estado: 'dictada',
    });

    const listado = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/clases?materia_id=${materiaId}&curso_division_turno_id=${cursoId}&desde=2026-03-01&hasta=2026-03-31&limit=500&offset=0`,
    );
    expect(listado.status).toBe(200);
    expect(listado.body.data.map((item: { id: string }) => item.id)).toContain(claseId);

    const porClase = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/asistencias?clase_id=${claseId}`,
    );
    expect(porClase.status).toBe(200);
    expect(porClase.body.clase.id).toBe(claseId);
    expect(asistenciaDe(porClase.body as ConsultaPorClase, alumnoId)).toMatchObject({
      id: asistenciaId,
      estado: 'ausente',
      justificacion: null,
    });

    const justificada = await write(
      app,
      adminToken,
      'put',
      `/api/v1/asistencias/${asistenciaId}/justificacion`,
      { justificacion: 'Certificado médico' },
    );
    expectStatus(justificada, 200);
    expect(justificada.body).toMatchObject({
      id: asistenciaId,
      clase_id: claseId,
      alumno_id: alumnoId,
      estado: 'justificada',
      justificacion: 'Certificado médico',
      registrada_por: SEED.adminId,
    });
    expect(justificada.body.version).toBe(2);

    const porClaseActualizada = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/asistencias?clase_id=${claseId}`,
    );
    expect(porClaseActualizada.status).toBe(200);
    expect(asistenciaDe(porClaseActualizada.body as ConsultaPorClase, alumnoId)).toMatchObject({
      id: asistenciaId,
      estado: 'justificada',
      justificacion: 'Certificado médico',
    });

    const auditoriaClase = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/auditoria?entidad=clases&entidad_id=${claseId}&limit=500&offset=0`,
    );
    expect(auditoriaClase.status).toBe(200);
    expect(auditoriaClase.body.data.map((entry: { accion: string }) => entry.accion)).toContain(
      'crear',
    );

    const auditoriaAsistencia = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/auditoria?entidad=asistencias&entidad_id=${asistenciaId}&limit=500&offset=0`,
    );
    expect(auditoriaAsistencia.status).toBe(200);
    const acciones = auditoriaAsistencia.body.data.map((entry: { accion: string }) => entry.accion);
    expect(acciones).toContain('crear');
    expect(acciones).toContain('justificar');
  });

  it('rechaza accesos y datos inválidos en el flujo de asistencia', async () => {
    const sinToken = await request(app).get(`/api/v1/asistencias?clase_id=${claseId}`);
    expect(sinToken.status).toBe(401);
    expect(sinToken.body.error.code).toBe('UNAUTHENTICATED');

    const duplicada = await write(app, adminToken, 'post', '/api/v1/asistencias', {
      clase_id: claseId,
      alumno_id: alumnoId,
      estado: 'ausente',
    });
    expect(duplicada.status).toBe(409);
    expect(duplicada.body.error.code).toBe('CONFLICT');

    const justificacionVacia = await write(
      app,
      adminToken,
      'put',
      `/api/v1/asistencias/${asistenciaId}/justificacion`,
      { justificacion: '' },
    );
    expect(justificacionVacia.status).toBe(422);
    expect(justificacionVacia.body.error.code).toBe('VALIDATION_ERROR');

    await query('UPDATE users SET must_change_password = true WHERE id = $1', [SEED.adminId]);
    try {
      const restringido = await authed(
        app,
        adminToken,
        'get',
        `/api/v1/asistencias?clase_id=${claseId}`,
      );
      expect(restringido.status).toBe(403);
      expect(restringido.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    } finally {
      await query('UPDATE users SET must_change_password = false WHERE id = $1', [SEED.adminId]);
    }
  });
});
