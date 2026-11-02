import { execSync } from 'node:child_process';

function run(command: string): void {
  execSync(command, { stdio: 'inherit' });
}

try {
  process.stdout.write('Esperando a PostgreSQL...\n');
  run('npx tsx scripts/wait-for-db.ts');

  process.stdout.write('Aplicando migraciones...\n');
  run('npm run db:migrate');

  process.stdout.write('Cargando seeds...\n');
  run('npm run db:seed');

  process.stdout.write('Setup completado.\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
