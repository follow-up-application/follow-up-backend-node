import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../../src/infra/db/client.js';
import { createForeignFixture, FOREIGN } from '../../helpers/fixtures.js';
import { login, SEED } from '../../helpers/http.js';
import {
  authed,
  createAlumnoFixture,
  createCourseFixture,
  createMateriaFixture,
  expectStatus,
  randomDni,
  setupCrudSuite,
  teardownCrudSuite,
  write,
} from './helpers.js';

type Role = 'preceptor' | 'docente' | 'alumno' | 'tutor';

interface OwnFixture {
  cursoId: number;
  materiaId: number;
  alumnoId: string;
  inscripcionId: number;
  docenteId: string;
}

let app: Express;
let adminToken: string;
let tokens: Record<Role, string>;
let own: OwnFixture;
let foreignCursoId: number;
let foreignInscripcionId: number;
let seedInscripcionId: number;

function idsOf(body: unknown): number[] {
  const rows = Array.isArray(body) ? body : ((body as { data?: unknown[] } | null)?.data ?? []);
  return rows.map((row) => Number((row as { id: number | string }).id));
}

beforeAll(async () => {
  ({ app, adminToken } = await setupCrudSuite());
  tokens = {
    preceptor: await login(app, 'preceptor', '10.71.0.2'),
    docente: await login(app, 'docente', '10.71.0.3'),
    alumno: await login(app, 'alumno', '10.71.0.4'),
    tutor: await login(app, 'tutor', '10.71.0.5'),
  };

  foreignCursoId = (await createForeignFixture()).cursoId;

  const docente = await write(app, adminToken, 'post', '/api/v1/docentes', {
    first_name: 'Docente',
    last_name: 'Alcance',
    dni: randomDni(),
    telephone: '3815554444',
    fecha_ingreso: '2024-03-01',
  });
  expectStatus(docente, 201);
  const docenteId = String(docente.body.id);

  const curso = await createCourseFixture(app, adminToken);
  const materia = await createMateriaFixture(app, adminToken, curso.id, docenteId);
  const alumno = await createAlumnoFixture(app, adminToken, curso.id);
  const inscripcion = await write(app, adminToken, 'post', '/api/v1/inscripciones', {
    alumno_id: alumno.id,
    materia_id: materia.id,
    fecha_inscripcion: '2026-03-10',
  });
  expectStatus(inscripcion, 201);

  own = {
    cursoId: curso.id,
    materiaId: materia.id,
    alumnoId: alumno.id,
    inscripcionId: Number(inscripcion.body.id),
    docenteId,
  };

  const seedInscripcion = await query<{ id: number }>(
    `SELECT id FROM inscripciones
      WHERE alumno_id = $1 AND materia_id = $2
      ORDER BY id LIMIT 1`,
    [SEED.alumnoId, SEED.materiaMatematicaId],
  );
  seedInscripcionId = Number(seedInscripcion.rows[0]?.id);
  if (!seedInscripcionId) {
    throw new Error('No se encontró la inscripción del fixture semilla.');
  }

  const existingForeign = await query<{ id: number }>(
    `SELECT id FROM inscripciones
      WHERE alumno_id = $1 AND materia_id = $2 AND estado IN ('pendiente', 'aprobado')
      LIMIT 1`,
    [FOREIGN.alumnoId, FOREIGN.materiaId],
  );
  if (existingForeign.rows[0]) {
    foreignInscripcionId = Number(existingForeign.rows[0].id);
  } else {
    const inserted = await query<{ id: number }>(
      `INSERT INTO inscripciones (alumno_id, materia_id, fecha_inscripcion, estado)
       VALUES ($1, $2, '2026-03-10', 'pendiente')
       RETURNING id`,
      [FOREIGN.alumnoId, FOREIGN.materiaId],
    );
    foreignInscripcionId = Number(inserted.rows[0]?.id);
  }
  if (!foreignInscripcionId) {
    throw new Error('No se pudo crear la inscripción ajena del fixture.');
  }
});

afterAll(async () => {
  await teardownCrudSuite();
});

describe('alta y consulta académica por rol', () => {
  it('da de alta curso, materia e inscripción y los consulta como administrador', async () => {
    const curso = await authed(app, adminToken, 'get', `/api/v1/cursos/${own.cursoId}`);
    expect(curso.status).toBe(200);
    expect(Number(curso.body.id)).toBe(own.cursoId);

    const cursos = await authed(app, adminToken, 'get', '/api/v1/cursos?limit=500&offset=0');
    expect(cursos.status).toBe(200);
    expect(idsOf(cursos.body)).toContain(own.cursoId);

    const materia = await authed(app, adminToken, 'get', `/api/v1/materias/${own.materiaId}`);
    expect(materia.status).toBe(200);
    expect(materia.body.docente_id).toBe(own.docenteId);

    const materias = await authed(app, adminToken, 'get', '/api/v1/materias?limit=500&offset=0');
    expect(materias.status).toBe(200);
    expect(idsOf(materias.body)).toContain(own.materiaId);

    const inscripcion = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/inscripciones/${own.inscripcionId}`,
    );
    expect(inscripcion.status).toBe(200);
    expect(inscripcion.body).toMatchObject({
      alumno_id: own.alumnoId,
      materia_id: own.materiaId,
    });

    const inscripciones = await authed(
      app,
      adminToken,
      'get',
      '/api/v1/inscripciones?limit=500&offset=0',
    );
    expect(inscripciones.status).toBe(200);
    expect(idsOf(inscripciones.body)).toContain(own.inscripcionId);
  });

  it('lista cursos y materias según el ámbito de cada rol', async () => {
    const roles: Role[] = ['preceptor', 'docente', 'alumno', 'tutor'];

    for (const role of roles) {
      const token = tokens[role];

      const cursos = await authed(app, token, 'get', '/api/v1/cursos?limit=500&offset=0');
      expect(cursos.status).toBe(200);
      expect(idsOf(cursos.body)).toContain(SEED.curso1Id);
      expect(idsOf(cursos.body)).not.toContain(own.cursoId);
      expect(idsOf(cursos.body)).not.toContain(foreignCursoId);

      const visibleCurso = await authed(app, token, 'get', `/api/v1/cursos/${SEED.curso1Id}`);
      expect(visibleCurso.status).toBe(200);

      const hiddenCurso = await authed(app, token, 'get', `/api/v1/cursos/${own.cursoId}`);
      expect(hiddenCurso.status).toBe(404);

      const hiddenForeignCurso = await authed(
        app,
        token,
        'get',
        `/api/v1/cursos/${foreignCursoId}`,
      );
      expect(hiddenForeignCurso.status).toBe(404);

      const materias = await authed(app, token, 'get', '/api/v1/materias?limit=500&offset=0');
      expect(materias.status).toBe(200);
      expect(idsOf(materias.body)).toContain(SEED.materiaMatematicaId);
      expect(idsOf(materias.body)).not.toContain(own.materiaId);
      expect(idsOf(materias.body)).not.toContain(FOREIGN.materiaId);

      const cursoMaterias = await authed(
        app,
        token,
        'get',
        `/api/v1/cursos/${SEED.curso1Id}/materias`,
      );
      expect(cursoMaterias.status).toBe(200);
      expect(idsOf(cursoMaterias.body)).toContain(SEED.materiaMatematicaId);

      const hiddenCursoMaterias = await authed(
        app,
        token,
        'get',
        `/api/v1/cursos/${own.cursoId}/materias`,
      );
      expect(hiddenCursoMaterias.status).toBe(404);
    }
  });

  it('limita el listado y la consulta de inscripciones por alumno, docente, tutor y rol', async () => {
    const adminList = await authed(
      app,
      adminToken,
      'get',
      '/api/v1/inscripciones?limit=500&offset=0',
    );
    expect(adminList.status).toBe(200);
    expect(idsOf(adminList.body)).toContain(seedInscripcionId);
    expect(idsOf(adminList.body)).toContain(own.inscripcionId);
    expect(idsOf(adminList.body)).toContain(foreignInscripcionId);

    const docenteList = await authed(
      app,
      tokens.docente,
      'get',
      '/api/v1/inscripciones?limit=500&offset=0',
    );
    expect(docenteList.status).toBe(200);
    expect(idsOf(docenteList.body)).toContain(seedInscripcionId);
    expect(idsOf(docenteList.body)).not.toContain(own.inscripcionId);
    expect(idsOf(docenteList.body)).not.toContain(foreignInscripcionId);

    for (const role of ['alumno', 'tutor'] as const) {
      const list = await authed(
        app,
        tokens[role],
        'get',
        '/api/v1/inscripciones?limit=500&offset=0',
      );
      expect(list.status).toBe(200);
      expect(idsOf(list.body)).toContain(seedInscripcionId);
      expect(idsOf(list.body)).not.toContain(own.inscripcionId);
      expect(idsOf(list.body)).not.toContain(foreignInscripcionId);
    }

    const preceptorList = await authed(
      app,
      tokens.preceptor,
      'get',
      '/api/v1/inscripciones?limit=500&offset=0',
    );
    expect(preceptorList.status).toBe(403);
    expect(preceptorList.body.error.code).toBe('FORBIDDEN');

    for (const role of ['alumno', 'docente', 'tutor'] as const) {
      const visible = await authed(
        app,
        tokens[role],
        'get',
        `/api/v1/inscripciones/${seedInscripcionId}`,
      );
      expect(visible.status).toBe(200);
    }

    for (const role of ['preceptor', 'docente', 'alumno', 'tutor'] as const) {
      const hidden = await authed(
        app,
        tokens[role],
        'get',
        `/api/v1/inscripciones/${own.inscripcionId}`,
      );
      expect(hidden.status).toBe(404);
    }
  });

  it('restrinje las inscripciones por materia al docente titular', async () => {
    const byAdmin = await authed(
      app,
      adminToken,
      'get',
      `/api/v1/materias/${own.materiaId}/inscripciones`,
    );
    expect(byAdmin.status).toBe(200);
    expect(idsOf(byAdmin.body)).toContain(own.inscripcionId);

    const byOwner = await authed(
      app,
      tokens.docente,
      'get',
      `/api/v1/materias/${SEED.materiaMatematicaId}/inscripciones`,
    );
    expect(byOwner.status).toBe(200);
    expect(idsOf(byOwner.body)).toContain(seedInscripcionId);

    const byOtherTeacher = await authed(
      app,
      tokens.docente,
      'get',
      `/api/v1/materias/${own.materiaId}/inscripciones`,
    );
    expect(byOtherTeacher.status).toBe(404);

    for (const role of ['preceptor', 'alumno', 'tutor'] as const) {
      const denied = await authed(
        app,
        tokens[role],
        'get',
        `/api/v1/materias/${SEED.materiaMatematicaId}/inscripciones`,
      );
      expect(denied.status).toBe(404);
    }
  });

  it('permite la inscripción propia y rechaza altas fuera del rol', async () => {
    const materia = await createMateriaFixture(app, adminToken, SEED.curso1Id, own.docenteId);

    const self = await write(app, tokens.alumno, 'post', '/api/v1/inscripciones', {
      alumno_id: SEED.alumnoId,
      materia_id: materia.id,
    });
    expectStatus(self, 201);

    const cross = await write(app, tokens.alumno, 'post', '/api/v1/inscripciones', {
      alumno_id: own.alumnoId,
      materia_id: materia.id,
    });
    expect(cross.status).toBe(403);

    for (const role of ['preceptor', 'docente', 'tutor'] as const) {
      const denied = await write(app, tokens[role], 'post', '/api/v1/inscripciones', {
        alumno_id: SEED.alumnoId,
        materia_id: materia.id,
      });
      expect(denied.status).toBe(403);
    }

    for (const role of ['preceptor', 'docente', 'alumno', 'tutor'] as const) {
      const curso = await write(app, tokens[role], 'post', '/api/v1/cursos', {
        curso: 6,
        division: 'Q',
        turno: 'Tarde',
      });
      expect(curso.status).toBe(403);

      const materiaDenied = await write(app, tokens[role], 'post', '/api/v1/materias', {
        nombre: 'Materia no autorizada',
        descripcion: 'Intento fuera del rol',
        curso_division_turno_id: own.cursoId,
        docente_id: own.docenteId,
      });
      expect(materiaDenied.status).toBe(403);
    }
  });

  it('devuelve 401, 409 y 422 en el flujo académico', async () => {
    const noToken = await request(app).get('/api/v1/cursos');
    expect(noToken.status).toBe(401);
    expect(noToken.body.error.code).toBe('UNAUTHENTICATED');

    const duplicate = await write(app, adminToken, 'post', '/api/v1/inscripciones', {
      alumno_id: own.alumnoId,
      materia_id: own.materiaId,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const invalid = await write(app, adminToken, 'post', '/api/v1/cursos', {
      curso: 9,
      division: 'Q',
      turno: 'Tarde',
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });
});
