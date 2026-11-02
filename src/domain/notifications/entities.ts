import type { Instant, NotificationId, UserId } from '../shared/types.js';

export interface NotificacionProps {
  id: NotificationId;
  destinatarioId: UserId;
  tipo: string;
  payload: Record<string, unknown>;
  estado: 'pendiente' | 'enviada' | 'fallida';
  intentos: number;
  nextAttemptAt: Instant;
  lastError: string | null;
  dedupeKey: string;
  createdAt: Instant;
  sentAt: Instant | null;
}

export class Notificacion {
  private constructor(private props: NotificacionProps) {}
  static reconstitute(props: NotificacionProps): Notificacion {
    return new Notificacion(props);
  }
  get id(): NotificationId {
    return this.props.id;
  }
  get destinatarioId(): UserId {
    return this.props.destinatarioId;
  }
  get tipo(): string {
    return this.props.tipo;
  }
  get payload(): Record<string, unknown> {
    return this.props.payload;
  }
  get dedupeKey(): string {
    return this.props.dedupeKey;
  }
  toProps(): NotificacionProps {
    return { ...this.props };
  }
}
