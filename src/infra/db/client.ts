import pg from 'pg';
import { env } from '../../config/env.js';
import type { Tx } from '../../domain/shared/types.js';

const { Pool, types } = pg;

types.setTypeParser(1082, (value: string) => value);
types.setTypeParser(1114, (value: string) => new Date(`${value}Z`).toISOString());
types.setTypeParser(1184, (value: string) => new Date(value).toISOString());

export const pool = new Pool({
  connectionString: env().DATABASE_URL,
  max: env().DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (error) => {
  process.stderr.write(`[pg] error inesperado en cliente idle: ${error.message}\n`);
});

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<pg.QueryResult>;
}

export function clientOf(tx?: Tx): Queryable {
  return (tx?.client as pg.PoolClient | undefined) ?? pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
