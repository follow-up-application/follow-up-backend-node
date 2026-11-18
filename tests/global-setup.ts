import { execSync } from 'node:child_process';
import dotenv from 'dotenv';

const SUBCOMMANDS = new Set(['run', 'watch', 'dev', 'bench', 'related']);

function needsDatabase(): boolean {
  const filters = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith('-') && !SUBCOMMANDS.has(arg));
  if (filters.length === 0) {
    return true;
  }
  return filters.some((filter) => /integration|security|concurrency/.test(filter));
}

export default function globalSetup(): void {
  if (!needsDatabase()) {
    return;
  }

  dotenv.config();
  const testUrl = process.env.DATABASE_TEST_URL;
  if (!testUrl) {
    throw new Error('DATABASE_TEST_URL es obligatoria para ejecutar la suite de integración.');
  }

  process.stdout.write('Reiniciando la base de datos de test para una corrida repetible...\n');
  execSync('npx tsx scripts/db-reset.ts', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: testUrl },
  });
}
