import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const cursos = (process.env.COURSES_CURSOS ?? '1,2,3,4,5,6,7')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const rawDivisiones = process.env.COURSES_DIVISIONES ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const divisiones = (rawDivisiones.includes(',') ? rawDivisiones.split(',') : rawDivisiones.split(''))
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const turno = process.env.COURSES_TURNO ?? 'Tarde';
const capacidad = Number(process.env.COURSES_CAPACITY ?? 200);

async function main(): Promise<void> {
  if (!connectionString) {
    throw new Error('DATABASE_URL es obligatoria.');
  }
  if (cursos.length === 0 || divisiones.length === 0) {
    throw new Error('COURSES_CURSOS y COURSES_DIVISIONES no pueden estar vacíos.');
  }
  if (cursos.some((value) => value < 1 || value > 7)) {
    throw new Error('COURSES_CURSOS debe usar valores entre 1 y 7.');
  }
  if (!Number.isInteger(capacidad) || capacidad < 1 || capacidad > 200) {
    throw new Error('COURSES_CAPACITY debe ser un entero entre 1 y 200.');
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const cycle = await client.query<{ id: string; anio: number }>(
      `SELECT id, anio FROM ciclos_lectivos WHERE estado = 'activo' ORDER BY anio DESC, id LIMIT 1`,
    );
    const active = cycle.rows[0];
    if (!active) {
      throw new Error('No hay un ciclo lectivo activo.');
    }

    let created = 0;
    for (const curso of cursos) {
      for (const division of divisiones) {
        const result = await client.query(
          `INSERT INTO curso_division_turno
             (ciclo_lectivo_id, curso, division, turno, capacidad_maxima)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (ciclo_lectivo_id, curso, division, turno)
           DO UPDATE SET capacidad_maxima = EXCLUDED.capacidad_maxima
           RETURNING id`,
          [active.id, curso, division, turno, capacidad],
        );
        if (result.rowCount === 1) created += 1;
      }
    }

    process.stdout.write(
      `Cursos preparados: ${created} (${cursos.length} cursos x ${divisiones.length} divisiones, turno ${turno}, capacidad ${capacidad}).\n`,
    );
    process.stdout.write(
      `Capacidad total: ${cursos.length * divisiones.length * capacidad} alumnos (ciclo ${active.anio}).\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
