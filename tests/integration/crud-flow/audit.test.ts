import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../helpers/http.js';
import {
  authed,
  buildAcademicChain,
  createCourseFixture,
  createMateriaFixture,
  expectStatus,
  randomDni,
  randomEmail,
  setupCrudSuite,
  teardownCrudSuite,
  write,
} from './helpers.js';

interface AuditEntry {
  id: string;
  entidad: string;
  entidad_id: string;
  accion: string;
  actor_id: string | null;
  actor_role: string | null;
  motivo: string | null;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  ocurrido_en: string;
}

let app: Express;
let adminToken: string;

beforeAll(async () => {
  ({ app, adminToken } = await setupCrudSuite());
});

afterAll(async () => {
  await teardownCrudSuite();
});

async function auditOf(entidad: string, entidadId: string | number): Promise<AuditEntry[]> {
  const response = await authed(
    app,
    adminToken,
    'get',
    `/api/v1/auditoria?entidad=${entidad}&entidad_id=${entidadId}&limit=500&offset=0`,
  );
  expectStatus(response, 200);
  return response.body.data as AuditEntry[];
}

function expectAction(
  entries: AuditEntry[],
  accion: string,
  expected: { motivo?: string | null; antes?: boolean; despues?: boolean } = {},
): AuditEntry {
  const entry = entries.find((item) => item.accion === accion);
  if (!entry) {
    throw new Error(
      `No hay registro de auditoría con acción "${accion}": ${JSON.stringify(entries)}`,
    );
  }
  expect(entry.actor_id).toBe(SEED.adminId);
  expect(entry.actor_role).toBe('administrador');
  if ('motivo' in expected) expect(entry.motivo).toBe(expected.motivo);
  if (expected.antes) expect(entry.antes).not.toBeNull();
  if (expected.despues) expect(entry.despues).not.toBeNull();
  return entry;
}

describe('auditoría de las operaciones principales', () => {
  it('audita altas, modificaciones y bajas de identidad', async () => {
    const username = `audit.admin.${randomUUID().slice(0, 8)}`;
    const admin = await write(app, adminToken, 'post', '/api/v1/admins', {
      first_name: 'Auditoría',
      last_name: 'Admin',
      username,
      password: 'Admin1234!',
    });
    expectStatus(admin, 201);
    const adminId = String(admin.body.id);

    const createdAdmin = expectAction(await auditOf('users', adminId), 'crear', {
      despues: true,
    });
    expect(createdAdmin.despues).toMatchObject({ role: 'administrador', username });

    const updatedAdmin = await write(app, adminToken, 'put', `/api/v1/admins/${adminId}`, {
      first_name: 'Nombre actualizado',
    });
    expectStatus(updatedAdmin, 200);
    expectAction(await auditOf('users', adminId), 'actualizar', { antes: true, despues: true });

    const deactivatedAdmin = await authed(
      app,
      adminToken,
      'patch',
      `/api/v1/users/${adminId}/estado`,
    ).send({ is_active: false, motivo: 'Auditoría de baja' });
    expectStatus(deactivatedAdmin, 200);
    expectAction(await auditOf('users', adminId), 'desactivar', {
      motivo: 'Auditoría de baja',
    });

    const curso = await createCourseFixture(app, adminToken);

    const docenteDni = randomDni();
    const docente = await write(app, adminToken, 'post', '/api/v1/docentes', {
      first_name: 'Auditoría',
      last_name: 'Docente',
      dni: docenteDni,
      telephone: '3815550001',
      fecha_ingreso: '2024-03-01',
      curso_division_turno_id: curso.id,
    });
    expectStatus(docente, 201);
    const docenteId = String(docente.body.id);
    expectAction(await auditOf('docentes', docenteId), 'crear', { despues: true });

    const docenteUpdated = await write(app, adminToken, 'put', `/api/v1/docentes/${docenteId}`, {
      telephone: '3815550002',
    });
    expectStatus(docenteUpdated, 200);
    expectAction(await auditOf('docentes', docenteId), 'actualizar', {
      antes: true,
      despues: true,
    });

    const docenteRemoved = await write(
      app,
      adminToken,
      'delete',
      `/api/v1/docentes/${docenteId}`,
      { motivo: 'Auditoría de baja de docente' },
    );
    expectStatus(docenteRemoved, 204);
    expectAction(await auditOf('users', docenteId), 'desactivar', {
      motivo: 'Auditoría de baja de docente',
    });

    const tutorDni = randomDni();
    const tutor = await write(app, adminToken, 'post', '/api/v1/tutores', {
      first_name: 'Auditoría',
      last_name: 'Tutor',
      dni: tutorDni,
      telephone: '3815550003',
      email: randomEmail('audit.tutor'),
      password: 'Tutor1234!',
    });
    expectStatus(tutor, 201);
    const tutorId = String(tutor.body.id);
    expectAction(await auditOf('tutores', tutorId), 'crear', { despues: true });

    const tutorUpdated = await write(app, adminToken, 'put', `/api/v1/tutores/${tutorId}`, {
      telephone: '3815550004',
    });
    expectStatus(tutorUpdated, 200);
    expectAction(await auditOf('tutores', tutorId), 'actualizar', { antes: true, despues: true });

    const tutorRemoved = await write(app, adminToken, 'delete', `/api/v1/tutores/${tutorId}`, {
      motivo: 'Auditoría de baja de tutor',
    });
    expectStatus(tutorRemoved, 204);
    expectAction(await auditOf('users', tutorId), 'desactivar', {
      motivo: 'Auditoría de baja de tutor',
    });

    const preceptor = await write(app, adminToken, 'post', '/api/v1/preceptores', {
      first_name: 'Auditoría',
      last_name: 'Preceptor',
      dni: randomDni(),
      telephone: '3815550005',
      employee_code: `AUD-${randomUUID().slice(0, 8)}`,
      cursos: [curso.id],
    });
    expectStatus(preceptor, 201);
    const preceptorId = String(preceptor.body.id);
    expectAction(await auditOf('preceptores', preceptorId), 'crear', { despues: true });

    const otherCourse = await createCourseFixture(app, adminToken);
    const preceptorCourses = await write(
      app,
      adminToken,
      'put',
      `/api/v1/preceptores/${preceptorId}/cursos`,
      { cursos: [otherCourse.id] },
    );
    expectStatus(preceptorCourses, 200);
    expectAction(await auditOf('preceptores', preceptorId), 'actualizar', {
      antes: true,
      despues: true,
    });

    const preceptorRemoved = await write(
      app,
      adminToken,
      'delete',
      `/api/v1/preceptores/${preceptorId}`,
      { motivo: 'Auditoría de baja de preceptor' },
    );
    expectStatus(preceptorRemoved, 204);
    expectAction(await auditOf('users', preceptorId), 'desactivar', {
      motivo: 'Auditoría de baja de preceptor',
    });
  });

  it('audita las operaciones académicas principales', async () => {
    const chain = await buildAcademicChain(app, adminToken);

    expectAction(await auditOf('curso_division_turno', chain.curso.id), 'crear', {
      despues: true,
    });
    expectAction(await auditOf('alumnos', chain.alumno.id), 'crear', { despues: true });
    expectAction(await auditOf('materias', chain.materia.id), 'crear', { despues: true });
    expectAction(await auditOf('inscripciones', chain.inscripcion.id), 'crear', {
      despues: true,
    });
    expectAction(await auditOf('inscripciones', chain.inscripcion.id), 'actualizar', {
      antes: true,
      despues: true,
    });
    expectAction(await auditOf('clases', chain.clase.id), 'crear', { despues: true });
    expectAction(await auditOf('clases', chain.clase.id), 'actualizar', {
      antes: true,
      despues: true,
    });
    expectAction(await auditOf('periodos', chain.periodo.id), 'crear', { despues: true });
    expectAction(await auditOf('instancias_evaluacion', chain.instancia.id), 'crear', {
      despues: true,
    });

    const materiaUpdated = await write(
      app,
      adminToken,
      'put',
      `/api/v1/materias/${chain.materia.id}`,
      { nombre: `Materia auditada ${randomUUID().slice(0, 6)}` },
    );
    expectStatus(materiaUpdated, 200);
    expectAction(await auditOf('materias', chain.materia.id), 'actualizar', {
      antes: true,
      despues: true,
    });

    const inscripcionRemoved = await write(
      app,
      adminToken,
      'delete',
      `/api/v1/inscripciones/${chain.inscripcion.id}`,
      {},
    );
    expectStatus(inscripcionRemoved, 204);
    expectAction(await auditOf('inscripciones', chain.inscripcion.id), 'desactivar', {
      antes: true,
      despues: true,
    });

    const emptyCourse = await createCourseFixture(app, adminToken);
    const emptyMateria = await createMateriaFixture(app, adminToken, emptyCourse.id);
    const materiaRemoved = await write(
      app,
      adminToken,
      'delete',
      `/api/v1/materias/${emptyMateria.id}`,
      {},
    );
    expectStatus(materiaRemoved, 204);
    expectAction(await auditOf('materias', emptyMateria.id), 'eliminar', { antes: true });

    const courseRemoved = await write(
      app,
      adminToken,
      'delete',
      `/api/v1/cursos/${emptyCourse.id}`,
      {},
    );
    expectStatus(courseRemoved, 204);
    expectAction(await auditOf('curso_division_turno', emptyCourse.id), 'eliminar', {
      antes: true,
    });
  });

  it('audita asistencias y calificaciones', async () => {
    const chain = await buildAcademicChain(app, adminToken);

    const asistencia = await write(app, adminToken, 'post', '/api/v1/asistencias', {
      clase_id: chain.clase.id,
      alumno_id: chain.alumno.id,
      estado: 'ausente',
    });
    expectStatus(asistencia, 201);
    const asistenciaId = String(asistencia.body.id);
    expectAction(await auditOf('asistencias', asistenciaId), 'crear', { despues: true });

    const asistenciaJustified = await write(
      app,
      adminToken,
      'put',
      `/api/v1/asistencias/${asistenciaId}/justificacion`,
      { justificacion: 'Certificado médico' },
    );
    expectStatus(asistenciaJustified, 200);
    expectAction(await auditOf('asistencias', asistenciaId), 'justificar', {
      motivo: 'Certificado médico',
      antes: true,
      despues: true,
    });

    const asistenciaUpdated = await write(
      app,
      adminToken,
      'put',
      `/api/v1/asistencias/${asistenciaId}`,
      {
        estado: 'presente',
        motivo: 'Corrección de asistencia',
        version: asistenciaJustified.body.version,
      },
    );
    expectStatus(asistenciaUpdated, 200);
    expectAction(await auditOf('asistencias', asistenciaId), 'actualizar', {
      motivo: 'Corrección de asistencia',
      antes: true,
      despues: true,
    });

    const calificacion = await write(app, adminToken, 'post', '/api/v1/calificaciones', {
      instancia_id: chain.instancia.id,
      alumno_id: chain.alumno.id,
      valor: '8.50',
    });
    expectStatus(calificacion, 201);
    const calificacionId = String(calificacion.body.id);
    expectAction(await auditOf('calificaciones', calificacionId), 'crear', { despues: true });

    const calificacionUpdated = await write(
      app,
      adminToken,
      'put',
      `/api/v1/calificaciones/${calificacionId}`,
      { valor: '9.00', motivo: 'Ajuste de nota', version: calificacion.body.version },
    );
    expectStatus(calificacionUpdated, 200);
    expectAction(await auditOf('calificaciones', calificacionId), 'actualizar', {
      motivo: 'Ajuste de nota',
      antes: true,
      despues: true,
    });

    const calificacionAnnulled = await write(
      app,
      adminToken,
      'post',
      `/api/v1/calificaciones/${calificacionId}/anular`,
      { motivo: 'Carga por error' },
    );
    expectStatus(calificacionAnnulled, 200);
    expectAction(await auditOf('calificaciones', calificacionId), 'actualizar', {
      motivo: 'Carga por error',
      antes: true,
      despues: true,
    });
  });
});
