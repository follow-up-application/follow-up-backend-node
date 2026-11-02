import type { AppContainer } from '../../application/container.js';
import type { Notificacion } from '../../domain/notifications/entities.js';
import { logger } from '../logging/logger.js';

const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

function backoffDelay(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Error al enviar la notificación.').slice(0, 1000);
}

export class NotificationWorker {
  private started = false;
  private stopping = false;
  private looping = false;
  private timer?: NodeJS.Timeout;

  constructor(private readonly c: AppContainer) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.timer = setInterval(() => this.wake(), POLL_INTERVAL_MS);
    this.timer.unref();
    this.wake();
    logger.info('worker de notificaciones iniciado');
  }

  stop(): void {
    this.stopping = true;
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    logger.info('worker de notificaciones detenido');
  }

  async runOnce(): Promise<number> {
    let processed = 0;
    while (true) {
      const batch = await this.c.uow.transaction((tx) =>
        this.c.notificaciones.claimBatch(BATCH_SIZE, tx),
      );
      if (batch.length === 0) return processed;
      for (const notification of batch) {
        await this.process(notification);
        processed += 1;
        if (this.stopping) return processed;
      }
    }
  }

  private wake(): void {
    if (!this.started || this.stopping || this.looping) return;
    void this.loop();
  }

  private async loop(): Promise<void> {
    this.looping = true;
    try {
      while (this.started && !this.stopping) {
        const processed = await this.runOnce();
        if (processed === 0) break;
      }
    } catch (error) {
      logger.error({ err: error }, 'error en el bucle del worker de notificaciones');
    } finally {
      this.looping = false;
    }
  }

  private async process(notification: Notificacion): Promise<void> {
    try {
      await this.c.notifier.send(notification);
      await this.c.uow.transaction((tx) =>
        this.c.notificaciones.markSent(notification.id, this.c.clock.now(), tx),
      );
    } catch (error) {
      const attempts = notification.toProps().intentos;
      const delay = backoffDelay(attempts);
      const nextAttemptAt = new Date(Date.now() + delay).toISOString();
      await this.c.uow.transaction((tx) =>
        this.c.notificaciones.markFailed(notification.id, errorMessage(error), nextAttemptAt, tx),
      );
      logger.warn(
        { notificationId: notification.id, attempts, nextAttemptAt },
        attempts >= MAX_ATTEMPTS
          ? 'notificación marcada como fallida'
          : 'notificación reprogramada',
      );
    }
  }
}
