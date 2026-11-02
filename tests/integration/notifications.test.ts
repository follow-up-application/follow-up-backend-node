import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildContainer } from '../../src/composition.js';
import { closePool, pool } from '../../src/infra/db/client.js';
import { InMemoryNotifier } from '../../src/infra/memory/in-memory-notifier.js';
import { NotificationWorker } from '../../src/infra/notifications/notification-worker.js';
import { Notificacion } from '../../src/domain/notifications/entities.js';
import type { Instant, NotificationId, UserId } from '../../src/domain/shared/types.js';

const TUTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const PREFIX = `test-notif-${randomUUID()}`;

const base = buildContainer();

function build(notifier: InMemoryNotifier): NotificationWorker {
  return new NotificationWorker({ ...base, notifier });
}

async function enqueue(dedupeKey: string): Promise<void> {
  const now = base.clock.now() as Instant;
  const dueAt = new Date(Date.now() - 60_000).toISOString() as Instant;
  const notification = Notificacion.reconstitute({
    id: base.ids.uuid() as NotificationId,
    destinatarioId: TUTOR_ID as UserId,
    tipo: 'ausencia_registrada',
    payload: { alumno_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4' },
    estado: 'pendiente',
    intentos: 0,
    nextAttemptAt: dueAt,
    lastError: null,
    dedupeKey,
    createdAt: now,
    sentAt: null,
  });
  await base.uow.transaction((tx) => base.notificaciones.enqueue(notification, tx));
}

async function status(dedupeKey: string): Promise<{
  estado: string;
  intentos: number;
  last_error: string | null;
}> {
  const result = await pool.query<{ estado: string; intentos: number; last_error: string | null }>(
    'SELECT estado, intentos, last_error FROM notificaciones WHERE dedupe_key = $1',
    [dedupeKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`No existe la notificación ${dedupeKey}`);
  return row;
}

beforeEach(async () => {
  await pool.query('DELETE FROM notificaciones');
});

afterAll(async () => {
  await pool.query('DELETE FROM notificaciones WHERE dedupe_key LIKE $1', [`${PREFIX}%`]);
  await closePool();
});

describe('NotificationWorker', () => {
  it('envía una notificación pendiente y la marca como enviada', async () => {
    const dedupeKey = `${PREFIX}-ok`;
    await enqueue(dedupeKey);
    const notifier = new InMemoryNotifier();
    const worker = build(notifier);

    const processed = await worker.runOnce();

    expect(processed).toBe(1);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.dedupeKey).toBe(dedupeKey);
    expect(await status(dedupeKey)).toMatchObject({ estado: 'enviada', last_error: null });
  });

  it('no vuelve a encolar una notificación con la misma dedupe key', async () => {
    const dedupeKey = `${PREFIX}-duplicada`;
    await enqueue(dedupeKey);
    await enqueue(dedupeKey);
    const result = await pool.query(
      'SELECT count(*)::int AS total FROM notificaciones WHERE dedupe_key = $1',
      [dedupeKey],
    );
    expect(result.rows[0]?.total).toBe(1);
  });

  it('reintenta con backoff y marca fallida al agotar los intentos', async () => {
    const dedupeKey = `${PREFIX}-falla`;
    await enqueue(dedupeKey);
    const notifier = new InMemoryNotifier();
    notifier.failNext(3);
    const worker = build(notifier);

    await worker.runOnce();
    expect(await status(dedupeKey)).toMatchObject({
      estado: 'pendiente',
      intentos: 1,
      last_error: 'Fallo simulado del notifier.',
    });

    await pool.query(
      'UPDATE notificaciones SET next_attempt_at = now() WHERE dedupe_key = $1',
      [dedupeKey],
    );
    await worker.runOnce();
    expect(await status(dedupeKey)).toMatchObject({ estado: 'pendiente', intentos: 2 });

    await pool.query(
      'UPDATE notificaciones SET next_attempt_at = now() WHERE dedupe_key = $1',
      [dedupeKey],
    );
    await worker.runOnce();
    expect(await status(dedupeKey)).toMatchObject({ estado: 'fallida', intentos: 3 });
    expect(notifier.sent).toHaveLength(0);
  });
});
