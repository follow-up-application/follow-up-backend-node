import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const rows = Number(process.env.CSV_ROWS ?? 5000);
const output = resolve(process.env.CSV_OUTPUT ?? `tmp/alumnos-${rows}.csv`);
const curso = Number(process.env.CSV_CURSO ?? 1);
const division = process.env.CSV_DIVISION ?? 'A';
const turno = process.env.CSV_TURNO ?? 'Mañana';
const dniBase = Number(process.env.CSV_DNI_BASE ?? 10_000_000);
const distribute = ['1', 'true', 'yes'].includes(String(process.env.CSV_DISTRIBUTE ?? 'false').toLowerCase());
const cursos = (process.env.CSV_CURSOS ?? '1,2,3,4,5,6,7')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const rawDivisiones = process.env.CSV_DIVISIONES ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const divisiones = (rawDivisiones.includes(',') ? rawDivisiones.split(',') : rawDivisiones.split(''))
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);

const HEADER = [
  'first_name',
  'last_name',
  'dni',
  'fecha_nacimiento',
  'curso',
  'division',
  'turno',
  'tutor_first_name',
  'tutor_last_name',
  'tutor_dni',
  'tutor_telephone',
  'relationship',
  'otra_relacion',
];

function escape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function courseFor(index: number): { curso: number; division: string } {
  if (!distribute) return { curso, division };
  if (cursos.length === 0 || divisiones.length === 0) {
    throw new Error('CSV_CURSOS y CSV_DIVISIONES no pueden estar vacíos cuando CSV_DISTRIBUTE=true.');
  }
  const position = index - 1;
  return {
    curso: cursos[Math.floor(position / divisiones.length) % cursos.length] as number,
    division: divisiones[position % divisiones.length] as string,
  };
}

function main(): void {
  if (!Number.isInteger(rows) || rows < 1 || rows > 20_000) {
    throw new Error('CSV_ROWS debe ser un entero entre 1 y 20000.');
  }
  if (cursos.some((value) => value < 1 || value > 7)) {
    throw new Error('CSV_CURSOS debe usar valores entre 1 y 7.');
  }

  const lines = [HEADER.join(',')];
  const counts = new Map<string, number>();
  for (let i = 1; i <= rows; i += 1) {
    const alumnoDni = dniBase + i;
    const tutorDni = dniBase + rows + i;
    const course = courseFor(i);
    const key = `${course.curso}°${course.division}-${turno}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    lines.push(
      [
        `Alumno${i}`,
        `Apellido${i}`,
        String(alumnoDni),
        '12/05/2010',
        String(course.curso),
        course.division,
        turno,
        `Tutor${i}`,
        `ApellidoTutor${i}`,
        String(tutorDni),
        `341555${String(i % 10_000).padStart(4, '0')}`,
        'madre',
        '',
      ]
        .map((value) => escape(value))
        .join(','),
    );
  }

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`CSV generado: ${output} (${rows} filas)\n`);
  process.stdout.write(
    `Destino: ${distribute ? `${counts.size} cursos (máximo ${Math.max(...counts.values())} filas por curso)` : `${curso}° ${division} - ${turno}`}; DNIs ${dniBase + 1}..${dniBase + rows * 2}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
