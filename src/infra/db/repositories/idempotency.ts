import type { IdempotencyRepository, StoredResponse } from '../../../domain/idempotency/ports.js';
import type { IdempotencyKey } from '../../../domain/idempotency/entities.js';
import type { Tx } from '../../../domain/shared/types.js';
import { clientOf } from '../client.js';
import { mapIdempotency } from '../mappers.js';

export class PgIdempotencyRepository implements IdempotencyRepository {
  async tryInsert(key: IdempotencyKey, tx: Tx): Promise<'inserted' | 'exists'> {
    const result = await clientOf(tx).query(
      `INSERT INTO idempotency_keys
        (id, actor_id, scope_key, clave, request_hash, metodo, ruta, estado, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (scope_key, clave) DO NOTHING
       RETURNING id`,
      [
        key.id,
        key.actorId,
        key.scopeKey,
        key.clave,
        key.requestHash,
        key.metodo,
        key.ruta,
        key.estado,
        key.expiresAt,
      ],
    );
    return result.rowCount ? 'inserted' : 'exists';
  }

  async find(scopeKey: string, key: string, tx?: Tx): Promise<IdempotencyKey | null> {
    const result = await clientOf(tx).query(
      'SELECT * FROM idempotency_keys WHERE scope_key = $1 AND clave = $2',
      [scopeKey, key],
    );
    return result.rows[0] ? mapIdempotency(result.rows[0]) : null;
  }

  async complete(scopeKey: string, key: string, response: StoredResponse, tx: Tx): Promise<void> {
    await clientOf(tx).query(
      `UPDATE idempotency_keys SET estado = 'completada', status_code = $3,
         response_body = $4, resource_id = $5
       WHERE scope_key = $1 AND clave = $2`,
      [
        scopeKey,
        key,
        response.statusCode,
        response.body === undefined ? null : JSON.stringify(response.body),
        response.resourceId,
      ],
    );
  }

  async release(scopeKey: string, key: string, tx?: Tx): Promise<void> {
    await clientOf(tx).query(
      'DELETE FROM idempotency_keys WHERE scope_key = $1 AND clave = $2',
      [scopeKey, key],
    );
  }

  async deleteExpired(tx?: Tx): Promise<number> {
    const result = await clientOf(tx).query(
      "DELETE FROM idempotency_keys WHERE expires_at < now()",
    );
    return result.rowCount ?? 0;
  }
}
