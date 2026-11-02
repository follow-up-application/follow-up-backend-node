import { parse } from 'csv-parse/sync';
import type { AppContainer } from './container.js';
import type { Actor, ImportJobId, UserId } from '../domain/shared/types.js';
import {
  ImportAlreadyRunningError,
  ImportInvalidFileError,
  NotFoundError,
  PayloadTooLargeError,
} from '../domain/shared/errors.js';
import { ImportJob } from '../domain/imports/entities.js';
import { validateAlumnoHeaders } from '../domain/imports/alumnos-csv.js';
import { env } from '../config/env.js';
import { requireRole, writeAudit, type RequestContext } from './shared/context.js';

export class ImportsService {
  constructor(private readonly c: AppContainer) {}

  async startAlumnosImport(
    actor: Actor,
    input: { content: Buffer; fileName: string },
    ctx: RequestContext,
  ): Promise<ImportJob> {
    requireRole(actor, 'administrador');
    if (input.content.byteLength === 0) throw new ImportInvalidFileError('El archivo CSV está vacío.');
    if (input.content.byteLength > env().IMPORT_MAX_FILE_BYTES) {
      throw new PayloadTooLargeError();
    }
    let headers: string[];
    try {
      const headerRows = parse(input.content, {
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false,
        to_line: 1,
      }) as string[][];
      headers = (headerRows[0] ?? []).map((header) => String(header).trim());
    } catch {
      throw new ImportInvalidFileError('No se pudo interpretar el CSV o el header es inválido.');
    }
    const headerError = validateAlumnoHeaders(headers);
    if (headerError) throw new ImportInvalidFileError(headerError);
    const active = await this.c.importJobs.findActiveByCreator(actor.id);
    if (active) throw new ImportAlreadyRunningError();
    const stored = await this.c.storage.saveTemp(input.content, input.fileName);
    try {
      const job = await this.c.uow.transaction(async (tx) => {
        const created = ImportJob.reconstitute({
          id: this.c.ids.uuid() as ImportJobId,
          tipo: 'alumnos',
          estado: 'pendiente',
          fileName: input.fileName,
          fileHash: stored.hash,
          storagePath: stored.path,
          totalRows: 0,
          processedRows: 0,
          validRows: 0,
          errorRows: 0,
          createdBy: actor.id as UserId,
          startedAt: null,
          finishedAt: null,
          errorCode: null,
          errorMessage: null,
          attempts: 0,
          workerToken: null,
          heartbeatAt: null,
          leaseUntil: null,
          createdAt: this.c.clock.now(),
        });
        await this.c.importJobs.create(created, tx);
        await writeAudit(this.c, tx, {
          entidad: 'import_jobs',
          entidadId: created.id,
          accion: 'crear',
          actor,
          despues: {
            file_name: created.fileName,
            file_hash: created.fileHash,
            total_rows: created.totalRows,
          },
          requestId: ctx.requestId,
        });
        return created;
      });
      this.c.importQueue.notify();
      return job;
    } catch (error) {
      await this.c.storage.delete(stored.path).catch(() => undefined);
      throw error;
    }
  }

  async getJob(actor: Actor, id: string): Promise<ImportJob> {
    requireRole(actor, 'administrador');
    const job = await this.c.importJobs.findById(id);
    if (!job) throw new NotFoundError('Importación');
    return job;
  }

  async listErrors(actor: Actor, id: string, limit: number, offset: number) {
    requireRole(actor, 'administrador');
    const job = await this.c.importJobs.findById(id);
    if (!job) throw new NotFoundError('Importación');
    return this.c.importJobs.listErrors(id, limit, offset);
  }
}
