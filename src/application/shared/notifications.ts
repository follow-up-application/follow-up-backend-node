import type { AppContainer } from '../container.js';
import type { Instant, NotificationId, Tx } from '../../domain/shared/types.js';
import { Notificacion } from '../../domain/notifications/entities.js';

export async function enqueueTutorNotification(
  c: AppContainer,
  tx: Tx,
  input: {
    alumnoId: string;
    tipo: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<void> {
  const links = await c.tutorAlumno.findByAlumno(input.alumnoId, true, tx);
  if (links.length === 0) return;
  const now = c.clock.now() as Instant;
  for (const link of links) {
    await c.notificaciones.enqueue(
      Notificacion.reconstitute({
        id: c.ids.uuid() as NotificationId,
        destinatarioId: link.tutorId,
        tipo: input.tipo,
        payload: input.payload,
        estado: 'pendiente',
        intentos: 0,
        nextAttemptAt: now,
        lastError: null,
        dedupeKey: `${input.dedupeKey}:${link.tutorId}`,
        createdAt: now,
        sentAt: null,
      }),
      tx,
    );
  }
}
