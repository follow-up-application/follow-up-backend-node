import type { Notificacion } from '../../domain/notifications/entities.js';
import type { Notifier } from '../../domain/notifications/ports.js';

export class InMemoryNotifier implements Notifier {
  readonly sent: Notificacion[] = [];
  private failuresRemaining = 0;

  failNext(count = 1): void {
    this.failuresRemaining = count;
  }

  clear(): void {
    this.sent.length = 0;
    this.failuresRemaining = 0;
  }

  async send(notification: Notificacion): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('Fallo simulado del notifier.');
    }
    this.sent.push(notification);
  }
}
