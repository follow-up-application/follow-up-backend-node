import type { ImportJobRepository } from '../../../domain/imports/ports.js';
import type { ImportErrorProps, ImportJob, ImportRowProps } from '../../../domain/imports/entities.js';
import type { Tx } from '../../../domain/shared/types.js';
import { clientOf } from '../client.js';
import { mapImportJob } from '../mappers.js';

export class PgImportJobRepository implements ImportJobRepository {
  async create(job: ImportJob, tx: Tx): Promise<void> {
    const props = job.toProps();
    await clientOf(tx).query(
      `INSERT INTO import_jobs
        (id, tipo, estado, file_name, file_hash, storage_path, total_rows, processed_rows,
         valid_rows, error_rows, created_by, started_at, finished_at, error_code, error_message,
         attempts, worker_token, heartbeat_at, lease_until, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        props.id,
        props.tipo,
        props.estado,
        props.fileName,
        props.fileHash,
        props.storagePath,
        props.totalRows,
        props.processedRows,
        props.validRows,
        props.errorRows,
        props.createdBy,
        props.startedAt,
        props.finishedAt,
        props.errorCode,
        props.errorMessage,
        props.attempts,
        props.workerToken,
        props.heartbeatAt,
        props.leaseUntil,
        props.createdAt,
      ],
    );
  }

  async findById(id: string, tx?: Tx): Promise<ImportJob | null> {
    const result = await clientOf(tx).query('SELECT * FROM import_jobs WHERE id = $1', [id]);
    return result.rows[0] ? mapImportJob(result.rows[0]) : null;
  }

  async findActiveByCreator(creatorId: string, tx?: Tx): Promise<ImportJob | null> {
    const result = await clientOf(tx).query(
      `SELECT * FROM import_jobs
       WHERE created_by = $1 AND estado IN ('pendiente', 'procesando')
       ORDER BY created_at DESC LIMIT 1`,
      [creatorId],
    );
    return result.rows[0] ? mapImportJob(result.rows[0]) : null;
  }

  async claimNext(workerToken: string, leaseSeconds: number, tx: Tx): Promise<ImportJob | null> {
    const result = await clientOf(tx).query(
      `WITH candidate AS (
         SELECT id FROM import_jobs
         WHERE estado = 'pendiente' OR (estado = 'procesando' AND lease_until < now())
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE import_jobs j
       SET estado = 'procesando',
           worker_token = $1,
           heartbeat_at = now(),
           lease_until = now() + ($2 || ' seconds')::interval,
           attempts = attempts + 1,
           started_at = COALESCE(started_at, now())
       FROM candidate c
       WHERE j.id = c.id
       RETURNING j.*`,
      [workerToken, String(leaseSeconds)],
    );
    return result.rows[0] ? mapImportJob(result.rows[0]) : null;
  }

  async heartbeat(id: string, workerToken: string, leaseSeconds: number, tx: Tx): Promise<boolean> {
    const result = await clientOf(tx).query(
      `UPDATE import_jobs SET heartbeat_at = now(),
         lease_until = now() + ($3 || ' seconds')::interval
       WHERE id = $1 AND worker_token = $2 AND estado = 'procesando'`,
      [id, workerToken, String(leaseSeconds)],
    );
    return Boolean(result.rowCount);
  }

  async recoverExpiredLeases(tx: Tx): Promise<number> {
    const result = await clientOf(tx).query(
      `UPDATE import_jobs SET estado = 'pendiente', worker_token = NULL, lease_until = NULL
       WHERE estado = 'procesando' AND lease_until < now()`,
    );
    return result.rowCount ?? 0;
  }

  async findOwnedForUpdate(id: string, workerToken: string, tx: Tx): Promise<ImportJob | null> {
    const result = await clientOf(tx).query(
      `SELECT * FROM import_jobs
       WHERE id = $1 AND worker_token = $2 AND estado = 'procesando' AND lease_until > now()
       FOR UPDATE`,
      [id, workerToken],
    );
    return result.rows[0] ? mapImportJob(result.rows[0]) : null;
  }

  async update(job: ImportJob, tx: Tx): Promise<void> {
    const props = job.toProps();
    await clientOf(tx).query(
      `UPDATE import_jobs SET estado = $2, total_rows = $3, processed_rows = $4,
         valid_rows = $5, error_rows = $6, started_at = $7, finished_at = $8,
         error_code = $9, error_message = $10, attempts = $11, worker_token = $12,
         heartbeat_at = $13, lease_until = $14
       WHERE id = $1`,
      [
        props.id,
        props.estado,
        props.totalRows,
        props.processedRows,
        props.validRows,
        props.errorRows,
        props.startedAt,
        props.finishedAt,
        props.errorCode,
        props.errorMessage,
        props.attempts,
        props.workerToken,
        props.heartbeatAt,
        props.leaseUntil,
      ],
    );
  }

  async updateProgress(
    id: string,
    workerToken: string,
    counters: {
      totalRows: number;
      processedRows: number;
      validRows: number;
      errorRows: number;
    },
    tx: Tx,
  ): Promise<boolean> {
    const result = await clientOf(tx).query(
      `UPDATE import_jobs SET total_rows = $3, processed_rows = $4, valid_rows = $5,
         error_rows = $6, heartbeat_at = now(), updated_at = now()
       WHERE id = $1 AND worker_token = $2 AND estado = 'procesando' AND lease_until > now()`,
      [
        id,
        workerToken,
        counters.totalRows,
        counters.processedRows,
        counters.validRows,
        counters.errorRows,
      ],
    );
    return Boolean(result.rowCount);
  }

  async appendRows(jobId: string, rows: ImportRowProps[], tx: Tx): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const placeholders = rows.map((row, index) => {
      const base = index * 4;
      values.push(jobId, row.rowNumber, JSON.stringify(row.payload), row.status);
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`;
    });
    await clientOf(tx).query(
      `INSERT INTO import_rows (import_job_id, row_number, payload, status)
       VALUES ${placeholders.join(',')}`,
      values,
    );
  }

  async appendErrors(jobId: string, errors: ImportErrorProps[], tx: Tx): Promise<void> {
    if (errors.length === 0) return;
    const values: unknown[] = [];
    const placeholders = errors.map((error, index) => {
      const base = index * 6;
      values.push(
        jobId,
        error.rowNumber,
        error.columnName,
        error.code,
        error.message,
        error.rawValue,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
    });
    await clientOf(tx).query(
      `INSERT INTO import_errors (import_job_id, row_number, column_name, code, message, raw_value)
       VALUES ${placeholders.join(',')}`,
      values,
    );
  }

  async listErrors(
    jobId: string,
    limit: number,
    offset: number,
    tx?: Tx,
  ): Promise<ImportErrorProps[]> {
    const result = await clientOf(tx).query(
      `SELECT row_number, column_name, code, message, raw_value FROM import_errors
       WHERE import_job_id = $1 ORDER BY row_number, id LIMIT $2 OFFSET $3`,
      [jobId, limit, offset],
    );
    return result.rows.map((row) => ({
      rowNumber: Number(row.row_number),
      columnName: row.column_name,
      code: row.code,
      message: row.message,
      rawValue: row.raw_value,
    }));
  }

  async clearRows(jobId: string, tx: Tx): Promise<void> {
    await clientOf(tx).query('DELETE FROM import_rows WHERE import_job_id = $1', [jobId]);
  }

  async clearStaging(jobId: string, tx: Tx): Promise<void> {
    const client = clientOf(tx);
    await client.query('DELETE FROM import_errors WHERE import_job_id = $1', [jobId]);
    await client.query('DELETE FROM import_rows WHERE import_job_id = $1', [jobId]);
  }

  async findExpired(cutoff: string, limit: number, tx: Tx): Promise<ImportJob[]> {
    const result = await clientOf(tx).query(
      `SELECT * FROM import_jobs
       WHERE estado IN ('completada', 'fallida') AND finished_at < $1
       ORDER BY finished_at
       LIMIT $2`,
      [cutoff, limit],
    );
    return result.rows.map(mapImportJob);
  }

  async deleteJob(jobId: string, tx: Tx): Promise<void> {
    await clientOf(tx).query('DELETE FROM import_jobs WHERE id = $1', [jobId]);
  }
}
