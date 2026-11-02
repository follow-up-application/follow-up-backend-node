import { InvalidStateTransitionError, ValidationDomainError } from '../shared/errors.js';
import type { AttendanceId, AttendanceStatus, ClassId, UserId } from '../shared/types.js';

export interface AsistenciaProps {
  id: AttendanceId;
  claseId: ClassId;
  alumnoId: UserId;
  estado: AttendanceStatus;
  justificacion: string | null;
  registradaPor: UserId;
  version: number;
  updatedAt: string;
}

export class Asistencia {
  private constructor(private props: AsistenciaProps) {}

  static reconstitute(props: AsistenciaProps): Asistencia {
    return new Asistencia(props);
  }

  get id(): AttendanceId {
    return this.props.id;
  }
  get claseId(): ClassId {
    return this.props.claseId;
  }
  get alumnoId(): UserId {
    return this.props.alumnoId;
  }
  get estado(): AttendanceStatus {
    return this.props.estado;
  }
  get justificacion(): string | null {
    return this.props.justificacion;
  }
  get registradaPor(): UserId {
    return this.props.registradaPor;
  }
  get version(): number {
    return this.props.version;
  }
  get updatedAt(): string {
    return this.props.updatedAt;
  }

  changeStatus(status: AttendanceStatus, justification: string | null): void {
    if (status === 'justificada') {
      if (!justification || !justification.trim()) {
        throw new ValidationDomainError('La justificación es obligatoria para el estado justificada.');
      }
      this.props.justificacion = justification.trim().slice(0, 500);
    } else {
      this.props.justificacion = null;
    }
    this.props.estado = status;
  }

  justify(text: string): void {
    if (this.props.estado !== 'ausente') {
      throw new InvalidStateTransitionError('Solo una ausencia puede justificarse.');
    }
    if (!text.trim()) {
      throw new ValidationDomainError('La justificación es obligatoria.');
    }
    this.props.estado = 'justificada';
    this.props.justificacion = text.trim().slice(0, 500);
  }
}
