import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { AppContainer } from '../../application/container.js';
import type { ImportErrorProps, ImportJob, ImportRowProps } from '../../domain/imports/entities.js';
import { ImportJob as ImportJobEntity } from '../../domain/imports/entities.js';
import type { AlumnoImportPayload } from '../../domain/imports/alumnos-csv.js';
import type { CursoDivisionTurno } from '../../domain/academic/entities.js';
import { Alumno, Tutor, TutorAlumno, User } from '../../domain/identity/entities.js';
import type { CourseId, UserId } from '../../domain/shared/types.js';
import { writeAudit } from '../../application/shared/context.js';
import { env } from '../../config/env.js';
import { logger } from '../logging/logger.js';
import { AlumnosCsvParseError, parseAlumnosCsv } from './alumnos-csv-parser.js';

const POLL_INTERVAL_MS = 1000;
const RECOVERY_INTERVAL_MS = 10_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 500;
const WORKER_TIMEOUT_MS = 10 * 60 * 1000;
const PASSWORD_HASH_CONCURRENCY = 4;

interface ParsedBatchRow {
  rowNumber: number;
  payload: Record<string, unknown>;
  status: 'valida' | 'invalida';
  errors: ImportErrorProps[];
}

interface ValidRow {
  rowNumber: number;
  payload: AlumnoImportPayload;
}

type WorkerMessage =
  | { type: 'start'; totalRows: number }
  | { type: 'batch'; rows: ParsedBatchRow[] }
  | { type: 'done'; totalRows: number; validRows: number; errorRows: number }
  | { type: 'limit'; totalRows: number }
  | { type: 'fatal'; message: string };

class TerminalImportError extends Error {
  constructor(
    readonly code: 'IMPORT_INVALID_FILE' | 'IMPORT_LIMIT_EXCEEDED',
    message: string,
    readonly totalRows = 0,
  ) {
    super(message);
    this.name = 'TerminalImportError';
  }
}

class LeaseLostError extends Error {
  constructor() {
    super('El lease de la importación ya no pertenece a este worker.');
    this.name = 'LeaseLostError';
  }
}

function currentYear(): number {
  return new Date().getUTCFullYear();
}

function generateCode(): string {
  return randomBytes(8).toString('hex').toUpperCase();
}

function courseKey(curso: number, division: string, turno: string): string {
  return `${curso}:${division.trim().toUpperCase()}:${turno}`;
}

export class ImportWorker {
  private started = false;
  private stopping = false;
  private looping = false;
  private pollTimer?: NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private activeWorker: Worker | null = null;
  private lastCleanupAt = 0;

  constructor(private readonly c: AppContainer) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.unsubscribe = this.c.importQueue.subscribe(() => this.wake());
    this.pollTimer = setInterval(() => this.wake(), POLL_INTERVAL_MS);
    this.pollTimer.unref();
    this.recoveryTimer = setInterval(() => void this.recover(), RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref();
    void this.recover();
    this.wake();
    logger.info('worker de importación iniciado');
  }

  stop(): void {
    this.stopping = true;
    this.started = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.pollTimer = undefined;
    this.recoveryTimer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    void this.activeWorker?.terminate();
    this.activeWorker = null;
    logger.info('worker de importación detenido');
  }

  private wake(): void {
    if (!this.started || this.stopping || this.looping) return;
    void this.loop();
  }

  private async loop(): Promise<void> {
    this.looping = true;
    try {
      while (this.started && !this.stopping) {
        const claimed = await this.claim();
        if (!claimed) break;
        await this.processClaimed(claimed.job, claimed.token);
      }
    } catch (error) {
      logger.error({ err: error }, 'error en el bucle del worker de importación');
    } finally {
      this.looping = false;
    }
  }

  private async claim(): Promise<{ job: ImportJob; token: string } | null> {
    const token = randomUUID();
    const job = await this.c.uow.transaction((tx) =>
      this.c.importJobs.claimNext(token, env().IMPORT_LEASE_SECONDS, tx),
    );
    if (job) {
      logger.info({ jobId: job.id, attempts: job.attempts }, 'importación reclamada');
    }
    return job ? { job, token } : null;
  }

  private async recover(): Promise<void> {
    if (!this.started || this.stopping) return;
    try {
      const recovered = await this.c.uow.transaction((tx) =>
        this.c.importJobs.recoverExpiredLeases(tx),
      );
      if (recovered > 0) {
        logger.warn({ recovered }, 'leases de importación vencidos recuperados');
        this.wake();
      }
      await this.cleanupExpired();
    } catch (error) {
      logger.error({ err: error }, 'error al recuperar leases de importación');
    }
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) return;
    this.lastCleanupAt = now;
    const cutoff = new Date(now - env().IMPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const expired = await this.c.uow.transaction((tx) =>
      this.c.importJobs.findExpired(cutoff, 100, tx),
    );
    for (const job of expired) {
      await this.c.uow.transaction(async (tx) => {
        await this.c.importJobs.clearStaging(job.id, tx);
        await this.c.importJobs.deleteJob(job.id, tx);
      });
      await this.c.storage.delete(job.storagePath).catch(() => undefined);
    }
    if (expired.length > 0) {
      logger.info({ count: expired.length }, 'importaciones vencidas eliminadas');
    }
  }

  private async processClaimed(job: ImportJob, token: string): Promise<void> {
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.c.uow
        .transaction((tx) =>
          this.c.importJobs.heartbeat(job.id, token, env().IMPORT_LEASE_SECONDS, tx),
        )
        .then((owned) => {
          if (!owned) {
            leaseLost = true;
            void this.activeWorker?.terminate();
          }
        })
        .catch((error) => {
          logger.warn({ err: error, jobId: job.id }, 'falló el heartbeat de importación');
        });
    }, env().IMPORT_HEARTBEAT_SECONDS * 1000);
    heartbeat.unref();

    try {
      await this.c.uow.transaction((tx) => this.c.importJobs.clearStaging(job.id, tx));
      const content = env().IMPORT_NAIVE
        ? readFileSync(job.storagePath)
        : await this.c.storage.read(job.storagePath);
      const result = await this.processContent(job, token, content, () => leaseLost);
      if (!result || leaseLost || this.stopping) return;
      await this.finalize(job, token, result.rows, result.totalRows, () => leaseLost);
    } catch (error) {
      if (this.stopping) return;
      if (error instanceof LeaseLostError) {
        logger.warn({ jobId: job.id }, 'importación abandonada por pérdida de lease');
        return;
      }
      if (error instanceof TerminalImportError) {
        await this.failTerminal(
          job,
          token,
          error.code,
          error.message,
          error.totalRows,
          0,
          error.totalRows,
        );
        return;
      }
      logger.error({ err: error, jobId: job.id }, 'falló el procesamiento de la importación');
      await this.handleTransientFailure(job, token);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async processContent(
    job: ImportJob,
    token: string,
    content: Buffer,
    leaseLost: () => boolean,
  ): Promise<{ rows: ValidRow[]; totalRows: number } | null> {
    const validRows: ValidRow[] = [];
    let totalRows = 0;
    let processedRows = 0;
    let validCount = 0;
    let errorCount = 0;

    const result = await this.runParser(
      job,
      content,
      (total) => {
        totalRows = total;
      },
      async (batch) => {
        if (leaseLost() || this.stopping) throw new LeaseLostError();
        const dbRows: ImportRowProps[] = batch.map((row) => ({
          rowNumber: row.rowNumber,
          payload: row.payload,
          status: row.status,
        }));
        const errors = batch.flatMap((row) => row.errors);
        processedRows += batch.length;
        validCount += batch.filter((row) => row.status === 'valida').length;
        errorCount += batch.filter((row) => row.status === 'invalida').length;
        await this.c.uow.transaction(async (tx) => {
          await this.c.importJobs.appendRows(job.id, dbRows, tx);
          await this.c.importJobs.appendErrors(job.id, errors, tx);
          const owned = await this.c.importJobs.updateProgress(
            job.id,
            token,
            { totalRows, processedRows, validRows: validCount, errorRows: errorCount },
            tx,
          );
          if (!owned) throw new LeaseLostError();
        });
        for (const row of batch) {
          if (row.status === 'valida') {
            validRows.push({
              rowNumber: row.rowNumber,
              payload: row.payload as unknown as AlumnoImportPayload,
            });
          }
        }
      },
    );

    if (leaseLost()) return null;
    if (result.errorRows > 0) {
      await this.failTerminal(
        job,
        token,
        'IMPORT_FAILED',
        'El archivo contiene errores de validación.',
        result.totalRows,
        result.validRows,
        result.errorRows,
      );
      return null;
    }
    return { rows: validRows, totalRows: result.totalRows };
  }

  private runParser(
    job: ImportJob,
    content: Buffer,
    onStart: (totalRows: number) => void,
    onBatch: (rows: ParsedBatchRow[]) => Promise<void>,
  ): Promise<{ totalRows: number; validRows: number; errorRows: number }> {
    if (env().IMPORT_NAIVE) {
      return this.runParserInline(content, onStart, onBatch);
    }
    return this.runParserInWorker(content, onStart, onBatch);
  }

  private async runParserInline(
    content: Buffer,
    onStart: (totalRows: number) => void,
    onBatch: (rows: ParsedBatchRow[]) => Promise<void>,
  ): Promise<{ totalRows: number; validRows: number; errorRows: number }> {
    try {
      return await parseAlumnosCsv(
        { content, maxRows: env().IMPORT_MAX_ROWS, batchSize: BATCH_SIZE },
        { onStart, onBatch },
      );
    } catch (error) {
      if (error instanceof AlumnosCsvParseError) {
        throw new TerminalImportError(
          error.kind === 'limit' ? 'IMPORT_LIMIT_EXCEEDED' : 'IMPORT_INVALID_FILE',
          error.message,
          error.totalRows,
        );
      }
      throw error;
    }
  }

  private runParserInWorker(
    content: Buffer,
    onStart: (totalRows: number) => void,
    onBatch: (rows: ParsedBatchRow[]) => Promise<void>,
  ): Promise<{ totalRows: number; validRows: number; errorRows: number }> {
    return new Promise((resolve, reject) => {
      const isTypeScript = import.meta.url.endsWith('.ts');
      const workerUrl = new URL(
        isTypeScript ? './alumnos-csv.worker.ts' : './alumnos-csv.worker.js',
        import.meta.url,
      );
      const worker = new Worker(workerUrl, {
        workerData: { content, maxRows: env().IMPORT_MAX_ROWS, batchSize: BATCH_SIZE },
        ...(isTypeScript ? { execArgv: ['--import', 'tsx'] } : {}),
      });
      this.activeWorker = worker;

      let settled = false;
      let chain: Promise<void> = Promise.resolve();
      let done: { totalRows: number; validRows: number; errorRows: number } | null = null;

      const timeout = setTimeout(() => {
        void worker.terminate();
        settleReject(new Error('El worker de importación no respondió a tiempo.'));
      }, WORKER_TIMEOUT_MS);
      timeout.unref();

      const cleanup = (): void => {
        clearTimeout(timeout);
        if (this.activeWorker === worker) this.activeWorker = null;
      };
      const settleResolve = (value: {
        totalRows: number;
        validRows: number;
        errorRows: number;
      }): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const settleReject = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      worker.on('message', (message: WorkerMessage) => {
        if (settled) return;
        if (message.type === 'start') {
          onStart(message.totalRows);
          return;
        }
        if (message.type === 'batch') {
          chain = chain.then(() => onBatch(message.rows)).catch((error) => {
            void worker.terminate();
            settleReject(error);
          });
          return;
        }
        if (message.type === 'done') {
          done = message;
          chain
            .then(() => settleResolve(message))
            .catch((error) => settleReject(error));
          return;
        }
        if (message.type === 'limit') {
          void worker.terminate();
          settleReject(
            new TerminalImportError(
              'IMPORT_LIMIT_EXCEEDED',
              `El CSV supera el máximo de ${env().IMPORT_MAX_ROWS} filas.`,
              message.totalRows,
            ),
          );
          return;
        }
        void worker.terminate();
        settleReject(new TerminalImportError('IMPORT_INVALID_FILE', message.message));
      });

      worker.on('error', (error) => settleReject(error));
      worker.on('exit', (code) => {
        if (settled) return;
        if (done) {
          chain
            .then(() => settleResolve(done as { totalRows: number; validRows: number; errorRows: number }))
            .catch((error) => settleReject(error));
          return;
        }
        settleReject(new Error(`El worker de importación finalizó con código ${code}.`));
      });
    });
  }

  private async validateRows(rows: ValidRow[]): Promise<{
    errors: ImportErrorProps[];
    coursesByKey: Map<string, CursoDivisionTurno>;
  }> {
    const errors: ImportErrorProps[] = [];
    const coursesByKey = new Map<string, CursoDivisionTurno>();
    const ciclo = await this.c.ciclos.findActive();
    if (!ciclo) {
      for (const row of rows) {
        errors.push({
          rowNumber: row.rowNumber,
          columnName: null,
          code: 'NO_ACTIVE_CYCLE',
          message: 'No hay un ciclo lectivo activo.',
          rawValue: null,
        });
      }
      return { errors, coursesByKey };
    }

    const courses = await this.c.cursos.list({
      cicloId: ciclo.id,
      limit: 10_000,
      offset: 0,
    });
    for (const course of courses) {
      coursesByKey.set(courseKey(course.curso, course.division, course.turno), course);
    }

    const requestedByCourse = new Map<number, number>();
    for (const row of rows) {
      const course = coursesByKey.get(
        courseKey(row.payload.curso, row.payload.division, row.payload.turno),
      );
      if (course) {
        requestedByCourse.set(course.id, (requestedByCourse.get(course.id) ?? 0) + 1);
      }
    }
    const currentByCourse = new Map<number, number>(
      await Promise.all(
        [...requestedByCourse.keys()].map(async (courseId) => [
          courseId,
          await this.c.alumnos.countByCourse(courseId),
        ] as const),
      ),
    );

    const studentDnis = [...new Set(rows.map((row) => row.payload.dni))];
    const tutorDnis = [...new Set(rows.map((row) => row.payload.tutor_dni))];
    const users = await this.c.users.findByDnis([...new Set([...studentDnis, ...tutorDnis])]);
    const tutores = await this.c.tutores.findByDnis(tutorDnis);
    const usersByDni = new Map(users.filter((user) => user.dni !== null).map((user) => [user.dni as number, user]));
    const tutorsByDni = new Map(
      tutores.filter((tutor) => tutor.user.dni !== null).map((tutor) => [tutor.user.dni as number, tutor]),
    );

    const add = (
      row: ValidRow,
      column: string | null,
      code: string,
      message: string,
      rawValue: string | null,
    ): void => {
      errors.push({ rowNumber: row.rowNumber, columnName: column, code, message, rawValue });
    };

    for (const row of rows) {
      const payload = row.payload;
      const course = coursesByKey.get(
        courseKey(payload.curso, payload.division, payload.turno),
      );
      if (!course) {
        add(
          row,
          'curso',
          'COURSE_NOT_FOUND',
          'El curso no existe en el ciclo lectivo activo.',
          `${payload.curso}°${payload.division} - ${payload.turno}`,
        );
      } else {
        const current = currentByCourse.get(course.id) ?? 0;
        const requested = requestedByCourse.get(course.id) ?? 0;
        if (current + requested > course.capacidadMaxima) {
          add(
            row,
            null,
            'CAPACITY_EXCEEDED',
            'El curso no tiene cupo suficiente para todas las filas del archivo.',
            String(course.id),
          );
        }
      }

      if (usersByDni.has(payload.dni)) {
        add(
          row,
          'dni',
          'DNI_IN_USE',
          'El DNI del alumno ya está registrado.',
          String(payload.dni),
        );
      }

      const tutorUser = usersByDni.get(payload.tutor_dni);
      if (tutorUser && tutorUser.role !== 'tutor') {
        add(
          row,
          'tutor_dni',
          'TUTOR_DNI_IN_USE',
          'El DNI del tutor pertenece a un usuario que no es tutor.',
          String(payload.tutor_dni),
        );
      } else if (tutorUser && !tutorsByDni.has(payload.tutor_dni)) {
        add(
          row,
          'tutor_dni',
          'TUTOR_PROFILE_MISSING',
          'El usuario tutor no tiene perfil de tutor.',
          String(payload.tutor_dni),
        );
      }
    }

    return { errors, coursesByKey };
  }

  private async finalize(
    job: ImportJob,
    token: string,
    rows: ValidRow[],
    totalRows: number,
    leaseLost: () => boolean,
  ): Promise<void> {
    const validation = await this.validateRows(rows);
    if (leaseLost() || this.stopping) throw new LeaseLostError();

    if (validation.errors.length > 0) {
      const errorRows = new Set(validation.errors.map((error) => error.rowNumber)).size;
      await this.c.uow.transaction(async (tx) => {
        await this.c.importJobs.appendErrors(job.id, validation.errors, tx);
        const owned = await this.c.importJobs.updateProgress(
          job.id,
          token,
          {
            totalRows,
            processedRows: totalRows,
            validRows: totalRows - errorRows,
            errorRows,
          },
          tx,
        );
        if (!owned) throw new LeaseLostError();
      });
      await this.failTerminal(
        job,
        token,
        'IMPORT_FAILED',
        'El archivo contiene errores de validación.',
        totalRows,
        totalRows - errorRows,
        errorRows,
      );
      return;
    }

    const hashes = await this.hashPasswords(
      rows.map((row) => row.payload.dni),
      leaseLost,
    );
    if (leaseLost() || this.stopping) throw new LeaseLostError();

    const now = this.c.clock.now();
    const actor = {
      id: job.createdBy,
      role: 'administrador' as const,
      mustChangePassword: false,
      passwordChangeOnly: false,
    };

    const committed = await this.c.uow.transaction(async (tx) => {
      const locked = await this.c.importJobs.findOwnedForUpdate(job.id, token, tx);
      if (!locked) return false;

      const studentDnis = [...new Set(rows.map((row) => row.payload.dni))];
      const tutorDnis = [...new Set(rows.map((row) => row.payload.tutor_dni))];
      const existingUsers = await this.c.users.findByDnis(
        [...new Set([...studentDnis, ...tutorDnis])],
        tx,
      );
      const existingTutors = await this.c.tutores.findByDnis(tutorDnis, tx);
      const usersByDni = new Map(
        existingUsers
          .filter((user) => user.dni !== null)
          .map((user) => [user.dni as number, user]),
      );
      const tutorsByDni = new Map(
        existingTutors
          .filter((tutor) => tutor.user.dni !== null)
          .map((tutor) => [tutor.user.dni as number, tutor]),
      );

      for (const row of rows) {
        const payload = row.payload;
        if (usersByDni.has(payload.dni) || usersByDni.has(payload.tutor_dni)) {
          throw new Error('Un DNI del archivo ya fue registrado durante la importación.');
        }
        const course = validation.coursesByKey.get(
          courseKey(payload.curso, payload.division, payload.turno),
        );
        if (!course) {
          throw new Error('El curso dejó de estar disponible durante la importación.');
        }

        let tutor = tutorsByDni.get(payload.tutor_dni);
        if (!tutor) {
          const tutorUser = User.reconstitute({
            id: this.c.ids.uuid() as UserId,
            firstName: payload.tutor_first_name,
            lastName: payload.tutor_last_name,
            dni: payload.tutor_dni,
            username: null,
            email: null,
            passwordHash: null,
            role: 'tutor',
            mustChangePassword: false,
            isActive: true,
            lastLoginAt: null,
            createdAt: now,
            updatedAt: now,
            version: 1,
          });
          await this.c.users.save(tutorUser, tx);
          tutor = Tutor.reconstitute({
            user: tutorUser,
            telephone: payload.tutor_telephone,
            version: 1,
          });
          await this.c.tutores.save(tutor, tx);
          tutorsByDni.set(payload.tutor_dni, tutor);
          usersByDni.set(payload.tutor_dni, tutorUser);
          await writeAudit(this.c, tx, {
            entidad: 'tutores',
            entidadId: tutor.id,
            accion: 'crear',
            actor,
            despues: { dni: payload.tutor_dni, telephone: tutor.telephone },
            requestId: null,
          });
        }

        const studentUser = User.reconstitute({
          id: this.c.ids.uuid() as UserId,
          firstName: payload.first_name,
          lastName: payload.last_name,
          dni: payload.dni,
          username: `EST-${payload.dni}-${currentYear()}`,
          email: null,
          passwordHash: hashes.get(payload.dni) ?? null,
          role: 'alumno',
          mustChangePassword: true,
          isActive: true,
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
        await this.c.users.save(studentUser, tx);
        usersByDni.set(payload.dni, studentUser);

        const alumno = Alumno.reconstitute({
          user: studentUser,
          fechaNacimiento: payload.fecha_nacimiento,
          cursoDivisionTurnoId: course.id as CourseId,
          version: 1,
        });
        await this.c.alumnos.save(alumno, tx);

        await this.c.tutorAlumno.save(
          TutorAlumno.reconstitute({
            id: this.c.ids.uuid(),
            alumnoId: alumno.id,
            tutorId: tutor.id,
            relationship: payload.relationship,
            otraRelacion:
              payload.relationship === 'otra' ? payload.otra_relacion : null,
            codigoInstitucional: generateCode(),
            estadoRegistro: 'pendiente',
            activa: true,
            codigoExpiraEn: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            registeredAt: null,
            version: 1,
          }),
          tx,
        );

        await writeAudit(this.c, tx, {
          entidad: 'alumnos',
          entidadId: alumno.id,
          accion: 'crear',
          actor,
          despues: {
            dni: payload.dni,
            curso_division_turno_id: course.id,
            tutor_id: tutor.id,
          },
          requestId: null,
        });
      }

      const completed = ImportJobEntity.reconstitute({
        ...locked.toProps(),
        estado: 'completada',
        totalRows,
        processedRows: totalRows,
        validRows: totalRows,
        errorRows: 0,
        finishedAt: now,
        errorCode: null,
        errorMessage: null,
        workerToken: null,
        heartbeatAt: null,
        leaseUntil: null,
      });
      await this.c.importJobs.update(completed, tx);
      await this.c.importJobs.clearRows(job.id, tx);
      await writeAudit(this.c, tx, {
        entidad: 'import_jobs',
        entidadId: job.id,
        accion: 'actualizar',
        actor,
        despues: {
          estado: 'completada',
          total_rows: totalRows,
          valid_rows: totalRows,
          error_rows: 0,
        },
        requestId: null,
      });
      return true;
    });

    if (!committed) {
      logger.warn({ jobId: job.id }, 'importación no confirmada por pérdida de lease');
      return;
    }
    await this.c.storage.delete(job.storagePath).catch(() => undefined);
    logger.info({ jobId: job.id, totalRows }, 'importación completada');
  }

  private async hashPasswords(
    dnis: number[],
    leaseLost: () => boolean,
  ): Promise<Map<number, string>> {
    const unique = [...new Set(dnis)];
    const hashes = new Map<number, string>();
    let next = 0;
    const workers = Array.from(
      { length: Math.min(PASSWORD_HASH_CONCURRENCY, unique.length) },
      async () => {
        while (true) {
          if (leaseLost() || this.stopping) throw new LeaseLostError();
          const index = next++;
          if (index >= unique.length) return;
          const dni = unique[index] as number;
          hashes.set(dni, await this.c.hasher.hash(String(dni)));
        }
      },
    );
    await Promise.all(workers);
    return hashes;
  }

  private async failTerminal(
    job: ImportJob,
    token: string,
    code: string,
    message: string,
    totalRows: number,
    validRows: number,
    errorRows: number,
  ): Promise<void> {
    const updated = await this.c.uow.transaction(async (tx) => {
      const locked = await this.c.importJobs.findOwnedForUpdate(job.id, token, tx);
      if (!locked) return false;
      await this.c.importJobs.clearRows(job.id, tx);
      const failed = ImportJobEntity.reconstitute({
        ...locked.toProps(),
        estado: 'fallida',
        totalRows,
        processedRows: totalRows,
        validRows,
        errorRows,
        finishedAt: this.c.clock.now(),
        errorCode: code,
        errorMessage: message.slice(0, 1000),
        workerToken: null,
        heartbeatAt: null,
        leaseUntil: null,
      });
      await this.c.importJobs.update(failed, tx);
      await writeAudit(this.c, tx, {
        entidad: 'import_jobs',
        entidadId: job.id,
        accion: 'actualizar',
        actor: {
          id: job.createdBy,
          role: 'administrador',
          mustChangePassword: false,
          passwordChangeOnly: false,
        },
        despues: {
          estado: 'fallida',
          error_code: code,
          total_rows: totalRows,
          error_rows: errorRows,
        },
        requestId: null,
      });
      return true;
    });

    if (updated) {
      await this.c.storage.delete(job.storagePath).catch(() => undefined);
      logger.warn({ jobId: job.id, code, message }, 'importación finalizada con error');
    }
  }

  private async handleTransientFailure(job: ImportJob, token: string): Promise<void> {
    if (job.attempts >= env().IMPORT_MAX_ATTEMPTS) {
      await this.failTerminal(
        job,
        token,
        'IMPORT_WORKER_FAILED',
        'La importación falló tras agotar los reintentos.',
        job.totalRows,
        0,
        job.errorRows,
      );
      return;
    }

    const released = await this.c.uow.transaction(async (tx) => {
      const locked = await this.c.importJobs.findOwnedForUpdate(job.id, token, tx);
      if (!locked) return false;
      const pending = ImportJobEntity.reconstitute({
        ...locked.toProps(),
        estado: 'pendiente',
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        workerToken: null,
        heartbeatAt: null,
        leaseUntil: null,
      });
      await this.c.importJobs.update(pending, tx);
      return true;
    });
    if (released) {
      logger.info({ jobId: job.id, attempts: job.attempts }, 'importación reprogramada');
      this.wake();
    }
  }
}
