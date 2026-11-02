import { execSync } from 'node:child_process';
import { env } from '../src/config/env.js';
import { pool } from '../src/infra/db/client.js';

async function main(): Promise<void> {
  if (env().NODE_ENV === 'production') {
    throw new Error('db:reset no se ejecuta en producción.');
  }

  process.stdout.write('Eliminando el esquema public...\n');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.end();

  process.stdout.write('Aplicando migraciones...\n');
  execSync('npm run db:migrate', { stdio: 'inherit' });

  process.stdout.write('Cargando seeds...\n');
  execSync('npm run db:seed', { stdio: 'inherit' });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
