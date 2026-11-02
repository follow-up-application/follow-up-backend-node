import type { UserId, UserRole } from '../shared/types.js';

export interface RegistroAuditoriaProps {
  id: string;
  entidad: string;
  entidadId: string;
  accion:
    | 'crear'
    | 'actualizar'
    | 'eliminar'
    | 'desactivar'
    | 'reactivar'
    | 'rectificar'
    | 'cerrar'
    | 'recalcular_condicion'
    | 'registrar'
    | 'justificar';
  actorId: UserId | null;
  actorRole: UserRole | null;
  motivo: string | null;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  requestId: string | null;
  ocurridoEn: string;
}

export class RegistroAuditoria {
  private constructor(private props: RegistroAuditoriaProps) {}
  static reconstitute(props: RegistroAuditoriaProps): RegistroAuditoria {
    return new RegistroAuditoria(props);
  }
  toProps(): RegistroAuditoriaProps {
    return { ...this.props };
  }
}
