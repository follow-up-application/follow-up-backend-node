import type { NotificacionRepository } from '../../../domain/notifications/ports.js';
import type { Notificacion } from '../../../domain/notifications/entities.js';
import type { Tx } from '../../../domain/shared/types.js';
import { clientOf } from '../client.js';
import { mapNotificacion } from '../mappers.js';

export class PgNotificacionRepository implements NotificacionRepository {
  async enqueue(notification: Notificacion, tx: Tx): Promise<void> {
    const props = notification.toProps();
    await clientOf(tx).query(
      `INSERT INTO notificaciones (id, destinatario_id, tipo, payload, dedupe_key, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        props.id,
        props.destinatarioId,
        props.tipo,
        JSON.stringify(props.payload),
        props.dedupeKey,
        props.nextAttemptAt,
      ],
    );
  }

  async claimBatch(limit: number, tx: Tx): Promise<Notificacion[]> {
    const result = await clientOf(tx).query(
      `WITH candidate AS (
         SELECT id FROM notificaciones
         WHERE estado = 'pendiente' AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE notificaciones n
       SET intentos = intentos + 1,
           next_attempt_at = now() + interval '60 seconds'
       FROM candidate c
       WHERE n.id = c.id
       RETURNING n.*`,
      [limit],
    );
    return result.rows.map(mapNotificacion);
  }

  async markSent(id: string, at: string, tx: Tx): Promise<void> {
    await clientOf(tx).query(
      "UPDATE notificaciones SET estado = 'enviada', sent_at = $2, last_error = NULL WHERE id = $1",
      [id, at],
    );
  }

  async markFailed(id: string, error: string, nextAttemptAt: string, tx: Tx): Promise<void> {
    await clientOf(tx).query(
      `UPDATE notificaciones
       SET estado = CASE WHEN intentos >= 3 THEN 'fallida' ELSE 'pendiente' END,
           last_error = $2, next_attempt_at = $3
       WHERE id = $1`,
      [id, error, nextAttemptAt],
    );
  }
}
