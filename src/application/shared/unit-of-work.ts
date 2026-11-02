import type { Tx } from '../../domain/shared/types.js';

export interface UnitOfWork {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
