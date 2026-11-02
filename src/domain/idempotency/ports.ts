import type { Tx } from '../shared/types.js';
import type { IdempotencyKey } from './entities.js';

export interface StoredResponse {
  statusCode: number;
  body: unknown;
  resourceId: string | null;
}

export interface IdempotencyRepository {
  tryInsert(key: IdempotencyKey, tx: Tx): Promise<'inserted' | 'exists'>;
  find(scopeKey: string, key: string, tx?: Tx): Promise<IdempotencyKey | null>;
  complete(scopeKey: string, key: string, response: StoredResponse, tx: Tx): Promise<void>;
  release(scopeKey: string, key: string, tx?: Tx): Promise<void>;
  deleteExpired(tx?: Tx): Promise<number>;
}
