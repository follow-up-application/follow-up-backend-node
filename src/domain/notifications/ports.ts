import type { Tx } from '../shared/types.js';
import type { Notificacion } from './entities.js';

export interface NotificacionRepository {
  enqueue(notification: Notificacion, tx: Tx): Promise<void>;
  claimBatch(limit: number, tx: Tx): Promise<Notificacion[]>;
  markSent(id: string, at: string, tx: Tx): Promise<void>;
  markFailed(id: string, error: string, nextAttemptAt: string, tx: Tx): Promise<void>;
}

export interface Notifier {
  send(notification: Notificacion): Promise<void>;
}
