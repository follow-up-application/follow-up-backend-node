import type { Express } from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import { closePool, query } from '../../../src/infra/db/client.js';
import { auth, buildTestApp, enableSeedLogins, login, SEED } from '../../helpers/http.js';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface CrudSuite {
  app: Express;
  adminToken: string;
}

export interface CourseSlot {
  curso: number;
  division: string;
  turno: 'Mañana' | 'Tarde';
}

export interface CourseFixture {
  id: number;
  cicloLectivoId: string;
  division: string;
}

export interface AlumnoFixture {
  id: string;
  dni: number;
  tutorId: string;
  tutorLinkId: string;
}

export interface MateriaFixture {
  id: number;
  cursoId: number;
  docenteId: string;
}

export interface InscripcionFixture {
  id: number;
  alumnoId: string;
  materiaId: number;
}

export interface ClaseFixture {
  id: string;
  materiaId: number;
}

export interface PeriodoFixture {
  id: string;
}

export interface InstanciaFixture {
  id: string;
  materiaId: number;
  periodoId: string;
}

export interface AcademicChain {
  curso: CourseFixture;
  alumno: AlumnoFixture;
  materia: MateriaFixture;
  inscripcion: InscripcionFixture;
  clase: ClaseFixture;
  periodo: PeriodoFixture;
  instancia: InstanciaFixture;
}

export async function setupCrudSuite(): Promise<CrudSuite> {
  const app = buildTestApp();
  await enableSeedLogins();
  const adminToken = await login(app, 'admin', '10.70.0.1');
  return { app, adminToken };
}

export async function teardownCrudSuite(): Promise<void> {
  await closePool();
}

export function authed(app: Express, token: string, method: HttpMethod, path: string) {
  return auth(app, token)(method, path);
}

export function write(
  app: Express,
  token: string,
  method: Exclude<HttpMethod, 'get'>,
  path: string,
  body: Record<string, unknown>,
) {
  return authed(app, token, method, path)
    .set('content-type', 'application/json')
    .set('idempotency-key', randomUUID())
    .send(body);
}

export function expectStatus(response: { status: number; body: unknown }, status: number): void {
  if (response.status !== status) {
    throw new Error(
      `Esperaba ${status} pero llegó ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
}

export function randomDni(): number {
  return randomInt(10_000_000, 99_999_999);
}

export function randomEmail(prefix = 'crud'): string {
  return `${prefix}.${randomUUID().slice(0, 8)}@example.com`;
}

export async function randomCourseSlot(): Promise<CourseSlot> {
  const result = await query<{ curso: number; division: string; turno: string }>(
    `SELECT curso, division, turno
       FROM curso_division_turno
      WHERE ciclo_lectivo_id = $1`,
    [SEED.cicloId],
  );
  const used = new Set(
    result.rows.map((row) => `${row.curso}:${row.division.trim()}:${row.turno}`),
  );
  const available: CourseSlot[] = [];
  for (const curso of [3, 4, 5, 6, 7]) {
    for (const turno of ['Mañana', 'Tarde'] as const) {
      for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        if (!used.has(`${curso}:${letter}:${turno}`)) {
          available.push({ curso, division: letter, turno });
        }
      }
    }
  }
  if (available.length === 0) {
    throw new Error('No hay combinaciones de curso disponibles para el fixture.');
  }
  return available[randomInt(0, available.length)] as CourseSlot;
}

export async function createCourseFixture(app: Express, token: string): Promise<CourseFixture> {
  const slot = await randomCourseSlot();
  const response = await write(app, token, 'post', '/api/v1/cursos', {
    ciclo_lectivo_id: SEED.cicloId,
    curso: slot.curso,
    division: slot.division,
    turno: slot.turno,
    capacidad_maxima: 40,
  });
  expectStatus(response, 201);
  return {
    id: Number(response.body.id),
    cicloLectivoId: String(response.body.ciclo_lectivo_id),
    division: String(response.body.division),
  };
}

export async function createAlumnoFixture(
  app: Express,
  token: string,
  cursoId: number,
): Promise<AlumnoFixture> {
  const dni = randomDni();
  const response = await write(app, token, 'post', '/api/v1/alumnos', {
    first_name: 'Alumno',
    last_name: 'Crud',
    dni,
    fecha_nacimiento: '2011-05-12',
    curso_division_turno_id: cursoId,
    relationship: 'madre',
    tutor_first_name: 'Tutor',
    tutor_last_name: 'Crud',
    tutor_dni: randomDni(),
    tutor_telephone: '3815550000',
  });
  expectStatus(response, 201);
  const alumnoId = String(response.body.id);
  const link = await query<{ id: string; tutor_id: string }>(
    `SELECT id, tutor_id
       FROM tutor_alumno
      WHERE alumno_id = $1 AND activa = true
      ORDER BY registered_at DESC
      LIMIT 1`,
    [alumnoId],
  );
  const row = link.rows[0];
  if (!row) {
    throw new Error('No se creó el vínculo tutor-alumno del fixture.');
  }
  return {
    id: alumnoId,
    dni,
    tutorId: String(row.tutor_id),
    tutorLinkId: String(row.id),
  };
}

export async function createMateriaFixture(
  app: Express,
  token: string,
  cursoId: number,
  docenteId: string = SEED.docenteId,
): Promise<MateriaFixture> {
  const suffix = randomUUID().slice(0, 8);
  const response = await write(app, token, 'post', '/api/v1/materias', {
    nombre: `Materia ${suffix}`,
    descripcion: `Materia creada por fixtures ${suffix}`,
    curso_division_turno_id: cursoId,
    docente_id: docenteId,
  });
  expectStatus(response, 201);
  return {
    id: Number(response.body.id),
    cursoId: Number(response.body.curso_division_turno_id),
    docenteId: String(response.body.docente_id),
  };
}

export async function createInscripcionFixture(
  app: Express,
  token: string,
  alumnoId: string,
  materiaId: number,
): Promise<InscripcionFixture> {
  const created = await write(app, token, 'post', '/api/v1/inscripciones', {
    alumno_id: alumnoId,
    materia_id: materiaId,
    fecha_inscripcion: '2026-03-10',
  });
  expectStatus(created, 201);
  const id = Number(created.body.id);
  const approved = await authed(app, token, 'put', `/api/v1/inscripciones/${id}/estado`).send({
    estado: 'aprobado',
  });
  expectStatus(approved, 200);
  return { id, alumnoId, materiaId };
}

export async function createClaseFixture(
  app: Express,
  token: string,
  materiaId: number,
): Promise<ClaseFixture> {
  const created = await write(app, token, 'post', '/api/v1/clases', {
    materia_id: materiaId,
    fecha: '2026-03-10',
    hora_inicio: '10:00',
    hora_fin: '11:00',
    tema: `Clase ${randomUUID().slice(0, 8)}`,
  });
  expectStatus(created, 201);
  const id = String(created.body.id);
  const dictated = await authed(app, token, 'put', `/api/v1/clases/${id}`).send({
    estado: 'dictada',
    version: created.body.version,
  });
  expectStatus(dictated, 200);
  return { id, materiaId };
}

export async function createPeriodoFixture(app: Express, token: string): Promise<PeriodoFixture> {
  const response = await write(app, token, 'post', '/api/v1/periodos', {
    ciclo_lectivo_id: SEED.cicloId,
    nombre: `Periodo ${randomUUID().slice(0, 8)}`,
    tipo: 'cuatrimestre',
    fecha_inicio: '2026-03-01',
    fecha_fin: '2026-06-30',
  });
  expectStatus(response, 201);
  return { id: String(response.body.id) };
}

export async function createInstanciaFixture(
  app: Express,
  token: string,
  materiaId: number,
  periodoId: string,
): Promise<InstanciaFixture> {
  const response = await write(app, token, 'post', '/api/v1/instancias-evaluacion', {
    materia_id: materiaId,
    periodo_id: periodoId,
    nombre: `Instancia ${randomUUID().slice(0, 8)}`,
    tipo: 'parcial',
    peso: 100,
    fecha: '2026-04-15',
  });
  expectStatus(response, 201);
  return { id: String(response.body.id), materiaId, periodoId };
}

export async function buildAcademicChain(app: Express, token: string): Promise<AcademicChain> {
  const curso = await createCourseFixture(app, token);
  const alumno = await createAlumnoFixture(app, token, curso.id);
  const materia = await createMateriaFixture(app, token, curso.id);
  const inscripcion = await createInscripcionFixture(app, token, alumno.id, materia.id);
  const clase = await createClaseFixture(app, token, materia.id);
  const periodo = await createPeriodoFixture(app, token);
  const instancia = await createInstanciaFixture(app, token, materia.id, periodo.id);
  return { curso, alumno, materia, inscripcion, clase, periodo, instancia };
}
