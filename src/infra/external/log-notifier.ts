import type { Notifier } from '../../domain/notifications/ports.js';
import type { Notificacion } from '../../domain/notifications/entities.js';
import { logger } from '../logging/logger.js';

export class LogNotifier implements Notifier {
  async send(notification: Notificacion): Promise<void> {
    logger.info(
      { notificationId: notification.id, tipo: notification.tipo },
      'notificación procesada por el notifier local',
    );
  }
}
