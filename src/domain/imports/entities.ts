import type { ImportJobId, ImportStatus, UserId } from '../shared/types.js';

export interface ImportJobProps {
  id: ImportJobId;
  tipo: 'alumnos';
  estado: ImportStatus;
  fileName: string;
  fileHash: string;
  storagePath: string;
  totalRows: number;
  processedRows: number;
  validRows: number;
  errorRows: number;
  createdBy: UserId;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  workerToken: string | null;
  heartbeatAt: string | null;
  leaseUntil: string | null;
  createdAt: string;
}

export class ImportJob {
  private constructor(private props: ImportJobProps) {}
  static reconstitute(props: ImportJobProps): ImportJob {
    return new ImportJob({ ...props });
  }
  get id(): ImportJobId {
    return this.props.id;
  }
  get tipo(): 'alumnos' {
    return this.props.tipo;
  }
  get estado(): ImportStatus {
    return this.props.estado;
  }
  get fileName(): string {
    return this.props.fileName;
  }
  get fileHash(): string {
    return this.props.fileHash;
  }
  get storagePath(): string {
    return this.props.storagePath;
  }
  get totalRows(): number {
    return this.props.totalRows;
  }
  get processedRows(): number {
    return this.props.processedRows;
  }
  get validRows(): number {
    return this.props.validRows;
  }
  get errorRows(): number {
    return this.props.errorRows;
  }
  get createdBy(): UserId {
    return this.props.createdBy;
  }
  get startedAt(): string | null {
    return this.props.startedAt;
  }
  get finishedAt(): string | null {
    return this.props.finishedAt;
  }
  get errorCode(): string | null {
    return this.props.errorCode;
  }
  get errorMessage(): string | null {
    return this.props.errorMessage;
  }
  get attempts(): number {
    return this.props.attempts;
  }
  get workerToken(): string | null {
    return this.props.workerToken;
  }
  get heartbeatAt(): string | null {
    return this.props.heartbeatAt;
  }
  get leaseUntil(): string | null {
    return this.props.leaseUntil;
  }
  get createdAt(): string {
    return this.props.createdAt;
  }
  toProps(): ImportJobProps {
    return { ...this.props };
  }
}

export interface ImportRowProps {
  rowNumber: number;
  payload: Record<string, unknown>;
  status: 'pendiente' | 'valida' | 'invalida';
}

export interface ImportErrorProps {
  rowNumber: number;
  columnName: string | null;
  code: string;
  message: string;
  rawValue: string | null;
}
