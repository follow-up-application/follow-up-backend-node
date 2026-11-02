import type { Tx } from '../shared/types.js';
import type { ImportErrorProps, ImportJob, ImportRowProps } from './entities.js';

export interface ImportJobRepository {
  create(job: ImportJob, tx: Tx): Promise<void>;
  findById(id: string, tx?: Tx): Promise<ImportJob | null>;
  findActiveByCreator(creatorId: string, tx?: Tx): Promise<ImportJob | null>;
  claimNext(workerToken: string, leaseSeconds: number, tx: Tx): Promise<ImportJob | null>;
  heartbeat(id: string, workerToken: string, leaseSeconds: number, tx: Tx): Promise<boolean>;
  recoverExpiredLeases(tx: Tx): Promise<number>;
  findOwnedForUpdate(id: string, workerToken: string, tx: Tx): Promise<ImportJob | null>;
  update(job: ImportJob, tx: Tx): Promise<void>;
  updateProgress(
    id: string,
    workerToken: string,
    counters: {
      totalRows: number;
      processedRows: number;
      validRows: number;
      errorRows: number;
    },
    tx: Tx,
  ): Promise<boolean>;
  appendRows(jobId: string, rows: ImportRowProps[], tx: Tx): Promise<void>;
  appendErrors(jobId: string, errors: ImportErrorProps[], tx: Tx): Promise<void>;
  listErrors(
    jobId: string,
    limit: number,
    offset: number,
    tx?: Tx,
  ): Promise<ImportErrorProps[]>;
  clearRows(jobId: string, tx: Tx): Promise<void>;
  clearStaging(jobId: string, tx: Tx): Promise<void>;
  findExpired(cutoff: string, limit: number, tx: Tx): Promise<ImportJob[]>;
  deleteJob(jobId: string, tx: Tx): Promise<void>;
}

export interface FileStorage {
  saveTemp(content: Buffer, fileName: string): Promise<{ path: string; hash: string }>;
  read(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
}

export interface ImportWorkerQueue {
  notify(): void;
  subscribe(listener: () => void): () => void;
}
