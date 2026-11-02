import { env } from '../../../config/env.js';
import { Argon2PasswordHasher } from '../../security/password-hasher.js';
import { pool } from '../client.js';

const INSTITUCION_ID = '11111111-1111-4111-8111-111111111111';
const CICLO_ID = '22222222-2222-4222-8222-222222222222';
const PERIODO_ID = '33333333-3333-4333-8333-333333333333';
const REGLA_ID = '88888888-8888-4888-8888-888888888888';
const TUTOR_ALUMNO_ID = '99999999-9999-4999-8999-999999999999';

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const PRECEPTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const DOCENTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const ALUMNO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const TUTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';

const INSTANCIA_PARCIAL_ID = '44444444-4444-4444-8444-444444444441';
const INSTANCIA_TP_ID = '44444444-4444-4444-8444-444444444442';
const CLASE_1_ID = '55555555-5555-4555-8555-555555555551';
const CLASE_2_ID = '55555555-5555-4555-8555-555555555552';
const CLASE_3_ID = '55555555-5555-4555-8555-555555555553';
const ASISTENCIA_1_ID = '66666666-6666-4666-8666-666666666661';
const ASISTENCIA_2_ID = '66666666-6666-4666-8666-666666666662';
const ASISTENCIA_3_ID = '66666666-6666-4666-8666-666666666663';
const CALIFICACION_1_ID = '77777777-7777-4777-8777-777777777771';
const PRECEPTOR_CURSO_1_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const PRECEPTOR_CURSO_2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

const CURSO_1_ID = 1;
const CURSO_2_ID = 2;
const MATERIA_MATEMATICA_ID = 1;
const MATERIA_LENGUA_ID = 2;
const MATERIA_HISTORIA_ID = 3;
const INSCRIPCION_MATEMATICA_ID = 1;
const INSCRIPCION_LENGUA_ID = 2;

async function seed(): Promise<void> {
  if (env().NODE_ENV === 'production') {
    throw new Error('Los seeds no se ejecutan en producción.');
  }

  const hasher = new Argon2PasswordHasher();
  const adminHash = await hasher.hash('Admin1234!');
  const preceptorHash = await hasher.hash('30111222');
  const docenteHash = await hasher.hash('30222333');
  const alumnoHash = await hasher.hash('40123456');
  const tutorHash = await hasher.hash('Tutor1234!');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO instituciones (id, nombre, cue, direccion, telefono, email)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [INSTITUCION_ID, 'Escuela Técnica N° 1', '123456789', 'Av. Siempre Viva 742', '3415550000', 'escuela@example.com'],
    );

    await client.query(
      `INSERT INTO ciclos_lectivos (id, institucion_id, anio, fecha_inicio, fecha_fin, estado)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [CICLO_ID, INSTITUCION_ID, 2026, '2026-03-01', '2026-12-15', 'activo'],
    );

    const users: Array<{
      id: string;
      firstName: string;
      lastName: string;
      dni: number;
      username: string;
      email: string | null;
      passwordHash: string;
      role: string;
      mustChangePassword: boolean;
    }> = [
      {
        id: ADMIN_ID,
        firstName: 'Administrador',
        lastName: 'Demo',
        dni: 30000001,
        username: 'admin',
        email: 'admin@example.com',
        passwordHash: adminHash,
        role: 'administrador',
        mustChangePassword: false,
      },
      {
        id: PRECEPTOR_ID,
        firstName: 'Paula',
        lastName: 'Preceptora',
        dni: 30111222,
        username: 'PRE-30111222-2026',
        email: 'preceptor@example.com',
        passwordHash: preceptorHash,
        role: 'preceptor',
        mustChangePassword: true,
      },
      {
        id: DOCENTE_ID,
        firstName: 'Diego',
        lastName: 'Docente',
        dni: 30222333,
        username: 'DOC-30222333-2024',
        email: 'docente@example.com',
        passwordHash: docenteHash,
        role: 'docente',
        mustChangePassword: true,
      },
      {
        id: ALUMNO_ID,
        firstName: 'Ana',
        lastName: 'Pérez',
        dni: 40123456,
        username: 'EST-40123456-2026',
        email: null,
        passwordHash: alumnoHash,
        role: 'alumno',
        mustChangePassword: true,
      },
      {
        id: TUTOR_ID,
        firstName: 'Laura',
        lastName: 'Pérez',
        dni: 30123456,
        username: 'laura@example.com',
        email: 'laura@example.com',
        passwordHash: tutorHash,
        role: 'tutor',
        mustChangePassword: false,
      },
    ];

    for (const user of users) {
      await client.query(
        `INSERT INTO users
           (id, first_name, last_name, dni, username, email, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          user.id,
          user.firstName,
          user.lastName,
          user.dni,
          user.username,
          user.email,
          user.passwordHash,
          user.role,
          user.mustChangePassword,
        ],
      );
    }

    await client.query(
      `INSERT INTO curso_division_turno (id, ciclo_lectivo_id, curso, division, turno, capacidad_maxima)
       VALUES ($1, $2, $3, $4, $5, $6), ($7, $2, $8, $9, $10, $6)
       ON CONFLICT (id) DO NOTHING`,
      [CURSO_1_ID, CICLO_ID, 1, 'A', 'Mañana', 30, CURSO_2_ID, 2, 'B', 'Tarde'],
    );

    await client.query(
      `INSERT INTO alumnos (id, fecha_nacimiento, curso_division_turno_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [ALUMNO_ID, '2010-03-12', CURSO_1_ID],
    );

    await client.query(
      `INSERT INTO docentes (id, telephone, fecha_ingreso, curso_division_turno_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [DOCENTE_ID, '3415553333', '2024-03-01', CURSO_1_ID],
    );

    await client.query(
      `INSERT INTO tutores (id, telephone)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [TUTOR_ID, '3415551234'],
    );

    await client.query(
      `INSERT INTO preceptores (id, telephone, employee_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [PRECEPTOR_ID, '3415552222', 'PRE-001'],
    );

    await client.query(
      `INSERT INTO tutor_alumno
         (id, alumno_id, tutor_id, relationship, codigo_institucional, estado_registro, registered_at)
       VALUES ($1, $2, $3, 'madre', 'SEED-TUTOR-0001', 'registrado', now())
       ON CONFLICT (id) DO NOTHING`,
      [TUTOR_ALUMNO_ID, ALUMNO_ID, TUTOR_ID],
    );

    await client.query(
      `INSERT INTO preceptor_curso (id, preceptor_id, curso_division_turno_id, activo)
       VALUES ($1, $2, $3, true), ($4, $2, $5, true)
       ON CONFLICT (id) DO NOTHING`,
      [PRECEPTOR_CURSO_1_ID, PRECEPTOR_ID, CURSO_1_ID, PRECEPTOR_CURSO_2_ID, CURSO_2_ID],
    );

    await client.query(
      `INSERT INTO materias (id, nombre, descripcion, curso_division_turno_id, docente_id)
       VALUES
         ($1, 'Matemática', 'Matemática de primer año', $4, $6),
         ($2, 'Lengua', 'Lengua y literatura de primer año', $4, $6),
         ($3, 'Historia', 'Historia de segundo año', $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        MATERIA_MATEMATICA_ID,
        MATERIA_LENGUA_ID,
        MATERIA_HISTORIA_ID,
        CURSO_1_ID,
        CURSO_2_ID,
        DOCENTE_ID,
      ],
    );

    await client.query(
      `INSERT INTO inscripciones (id, alumno_id, materia_id, fecha_inscripcion, estado)
       VALUES ($1, $2, $3, $4, 'aprobado'), ($5, $2, $6, $4, 'aprobado')
       ON CONFLICT (id) DO NOTHING`,
      [INSCRIPCION_MATEMATICA_ID, ALUMNO_ID, MATERIA_MATEMATICA_ID, '2026-03-05', INSCRIPCION_LENGUA_ID, MATERIA_LENGUA_ID],
    );

    await client.query(
      `INSERT INTO periodos (id, ciclo_lectivo_id, nombre, tipo, fecha_inicio, fecha_fin, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'abierto')
       ON CONFLICT (id) DO NOTHING`,
      [PERIODO_ID, CICLO_ID, 'Primer trimestre', 'trimestre', '2026-03-01', '2026-06-30'],
    );

    await client.query(
      `INSERT INTO reglas_condicion (id, periodo_id, materia_id, nombre, config, activa)
       VALUES ($1, $2, NULL, $3, $4::jsonb, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        REGLA_ID,
        PERIODO_ID,
        'Regla por defecto',
        JSON.stringify({
          asistencia_minima_pct: 75,
          nota_minima_regular: 6,
          nota_minima_promocion: 7,
          condicion_sin_datos: 'libre',
        }),
      ],
    );

    await client.query(
      `INSERT INTO instancias_evaluacion
         (id, materia_id, periodo_id, nombre, tipo, peso, fecha, created_by)
       VALUES ($1, $3, $4, 'Parcial 1', 'parcial', 50.00, '2026-04-15', $5),
              ($2, $3, $4, 'TP 1', 'tp', 50.00, '2026-05-15', $5)
       ON CONFLICT (id) DO NOTHING`,
      [INSTANCIA_PARCIAL_ID, INSTANCIA_TP_ID, MATERIA_MATEMATICA_ID, PERIODO_ID, DOCENTE_ID],
    );

    await client.query(
      `INSERT INTO clases (id, materia_id, fecha, hora_inicio, hora_fin, tema, estado, created_by)
       VALUES
         ($1, $4, '2026-04-01', '08:00', '09:00', 'Números enteros', 'dictada', $5),
         ($2, $4, '2026-04-08', '08:00', '09:00', 'Fracciones', 'dictada', $5),
         ($3, $4, '2026-04-15', '08:00', '09:00', 'Repaso y parcial', 'dictada', $5)
       ON CONFLICT (id) DO NOTHING`,
      [CLASE_1_ID, CLASE_2_ID, CLASE_3_ID, MATERIA_MATEMATICA_ID, DOCENTE_ID],
    );

    await client.query(
      `INSERT INTO asistencias (id, clase_id, alumno_id, estado, registrada_por)
       VALUES ($1, $4, $7, 'presente', $8),
              ($2, $5, $7, 'ausente', $8),
              ($3, $6, $7, 'presente', $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        ASISTENCIA_1_ID,
        ASISTENCIA_2_ID,
        ASISTENCIA_3_ID,
        CLASE_1_ID,
        CLASE_2_ID,
        CLASE_3_ID,
        ALUMNO_ID,
        DOCENTE_ID,
      ],
    );

    await client.query(
      `INSERT INTO calificaciones
         (id, instancia_id, alumno_id, valor, estado, created_by, updated_by)
       VALUES ($1, $2, $3, 8.50, 'activa', $4, $4)
       ON CONFLICT (id) DO NOTHING`,
      [CALIFICACION_1_ID, INSTANCIA_PARCIAL_ID, ALUMNO_ID, DOCENTE_ID],
    );

    for (const table of ['curso_division_turno', 'materias', 'inscripciones']) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`,
        [table],
      );
    }

    await client.query('COMMIT');
    process.stdout.write('Seed completado: institución, ciclo, cinco roles, cursos, materias, período, clases, asistencias y notas.\n');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .then(() => pool.end())
  .catch((error: unknown) => {
    process.stderr.write(`Error al ejecutar el seed: ${error instanceof Error ? error.message : String(error)}\n`);
    void pool.end().finally(() => process.exit(1));
  });
