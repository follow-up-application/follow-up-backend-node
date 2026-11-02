import type { UnitOfWork } from '../../application/shared/unit-of-work.js';
import type { Tx } from '../../domain/shared/types.js';
import { StaleVersionError } from '../../domain/shared/errors.js';

export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: { connect(): Promise<import('pg').PoolClient> }) {}

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: Tx = { client };
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // El error original es más relevante.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export function assertUpdated(rowCount: number | null | undefined): void {
  if (!rowCount) throw new StaleVersionError();
}
