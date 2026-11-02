import { randomUUID } from 'node:crypto';
import { query } from '../../src/infra/db/client.js';
import { SEED } from './http.js';

export const FOREIGN = {
  docenteId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  alumnoId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  materiaId: 9001,
  instanciaId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
  claseId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5',
} as const;

export interface ForeignFixture {
  cursoId: number;
}

export interface GradeFixture {
  periodoId: string;
  instanciaId: string;
  calificacionId: string;
}

export async function createOpenPeriodFixture(): Promise<string> {
  const periodoId = randomUUID();
  await query(
    `INSERT INTO periodos
       (id, ciclo_lectivo_id, nombre, tipo, fecha_inicio, fecha_fin, estado)
     VALUES ($1, $2, $3, 'trimestre', '2026-07-01', '2026-09-30', 'abierto')`,
    [periodoId, SEED.cicloId, `Fixture ${periodoId}`],
  );
  return periodoId;
}

export async function createGradeFixture(): Promise<GradeFixture> {
  const periodoId = await createOpenPeriodFixture();
  const instanciaId = randomUUID();
  const calificacionId = randomUUID();
  await query(
    `INSERT INTO instancias_evaluacion
       (id, materia_id, periodo_id, nombre, tipo, peso, fecha, created_by)
     VALUES ($1, $2, $3, $4, 'parcial', 100.00, '2026-08-01', $5)`,
    [instanciaId, SEED.materiaMatematicaId, periodoId, `Instancia ${instanciaId}`, SEED.docenteId],
  );
  await query(
    `INSERT INTO calificaciones
       (id, instancia_id, alumno_id, valor, estado, created_by, updated_by)
     VALUES ($1, $2, $3, 5.00, 'activa', $4, $4)`,
    [calificacionId, instanciaId, SEED.alumnoId, SEED.docenteId],
  );
  return { periodoId, instanciaId, calificacionId };
}

export async function createForeignFixture(): Promise<ForeignFixture> {
  const course = await query<{ id: number }>(
    `INSERT INTO curso_division_turno
       (ciclo_lectivo_id, curso, division, turno, capacidad_maxima)
     VALUES ($1, 7, 'Z', 'Tarde', 30)
     ON CONFLICT (ciclo_lectivo_id, curso, division, turno)
     DO UPDATE SET capacidad_maxima = EXCLUDED.capacidad_maxima
     RETURNING id`,
    [SEED.cicloId],
  );
  const cursoId = Number(course.rows[0]?.id);

  await query(
    `INSERT INTO users
       (id, first_name, last_name, dni, username, email, password_hash, role, must_change_password, is_active)
     VALUES ($1, 'Docente', 'Ajeno', 30999001, NULL, NULL, NULL, 'docente', false, true)
     ON CONFLICT (id) DO UPDATE SET is_active = true, role = 'docente'`,
    [FOREIGN.docenteId],
  );
  await query(
    `INSERT INTO docentes (id, telephone, fecha_ingreso, curso_division_turno_id)
     VALUES ($1, '3415559991', '2024-03-01', $2)
     ON CONFLICT (id) DO UPDATE SET curso_division_turno_id = EXCLUDED.curso_division_turno_id`,
    [FOREIGN.docenteId, cursoId],
  );

  await query(
    `INSERT INTO users
       (id, first_name, last_name, dni, username, email, password_hash, role, must_change_password, is_active)
     VALUES ($1, 'Alumno', 'Ajeno', 40999002, NULL, NULL, NULL, 'alumno', true, true)
     ON CONFLICT (id) DO UPDATE SET is_active = true, role = 'alumno'`,
    [FOREIGN.alumnoId],
  );
  await query(
    `INSERT INTO alumnos (id, fecha_nacimiento, curso_division_turno_id)
     VALUES ($1, '2010-05-10', $2)
     ON CONFLICT (id) DO UPDATE SET curso_division_turno_id = EXCLUDED.curso_division_turno_id`,
    [FOREIGN.alumnoId, cursoId],
  );

  await query(
    `INSERT INTO materias (id, nombre, descripcion, curso_division_turno_id, docente_id)
     VALUES ($1, 'Materia ajena', 'Fixture de acceso cruzado', $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       curso_division_turno_id = EXCLUDED.curso_division_turno_id,
       docente_id = EXCLUDED.docente_id`,
    [FOREIGN.materiaId, cursoId, FOREIGN.docenteId],
  );

  await query(
    `INSERT INTO clases (id, materia_id, fecha, hora_inicio, hora_fin, tema, estado, created_by)
     VALUES ($1, $2, '2026-04-02', '10:00', '11:00', 'Clase ajena', 'dictada', $3)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN.claseId, FOREIGN.materiaId, FOREIGN.docenteId],
  );

  await query(
    `INSERT INTO instancias_evaluacion
       (id, materia_id, periodo_id, nombre, tipo, peso, fecha, created_by)
     VALUES ($1, $2, $3, 'Instancia ajena', 'parcial', 100.00, '2026-04-20', $4)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN.instanciaId, FOREIGN.materiaId, SEED.periodoId, FOREIGN.docenteId],
  );

  return { cursoId };
}
