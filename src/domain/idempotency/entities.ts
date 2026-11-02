export interface IdempotencyKeyProps {
  id: string;
  actorId: string | null;
  scopeKey: string;
  clave: string;
  requestHash: string;
  metodo: string;
  ruta: string;
  estado: 'procesando' | 'completada';
  statusCode: number | null;
  responseBody: unknown;
  resourceId: string | null;
  createdAt: string;
  expiresAt: string;
}

export class IdempotencyKey {
  private constructor(private props: IdempotencyKeyProps) {}
  static reconstitute(props: IdempotencyKeyProps): IdempotencyKey {
    return new IdempotencyKey(props);
  }
  get id(): string {
    return this.props.id;
  }
  get actorId(): string | null {
    return this.props.actorId;
  }
  get metodo(): string {
    return this.props.metodo;
  }
  get ruta(): string {
    return this.props.ruta;
  }
  get scopeKey(): string {
    return this.props.scopeKey;
  }
  get clave(): string {
    return this.props.clave;
  }
  get requestHash(): string {
    return this.props.requestHash;
  }
  get estado(): 'procesando' | 'completada' {
    return this.props.estado;
  }
  get statusCode(): number | null {
    return this.props.statusCode;
  }
  get responseBody(): unknown {
    return this.props.responseBody;
  }
  get resourceId(): string | null {
    return this.props.resourceId;
  }
  get expiresAt(): string {
    return this.props.expiresAt;
  }
}
