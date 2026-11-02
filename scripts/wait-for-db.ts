import { Client } from 'pg';
import { env } from '../src/config/env.js';

const TIMEOUT_MS = 30_000;
const INTERVAL_MS = 1_000;

async function main(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const client = new Client({ connectionString: env().DATABASE_URL });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      process.stdout.write('PostgreSQL disponible.\n');
      return;
    } catch (error) {
      await client.end().catch(() => undefined);
      if (Date.now() >= deadline) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`PostgreSQL no respondió en ${TIMEOUT_MS} ms: ${message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
