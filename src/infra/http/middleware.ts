import { createHash, randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import type { AppContainer } from '../../application/container.js';
import type { RequestContext } from '../../application/shared/context.js';
import { env } from '../../config/env.js';
import { IdempotencyKey } from '../../domain/idempotency/entities.js';
import {
  ConflictError,
  DomainError,
  IdempotencyKeyRequiredError,
  IdempotencyKeyReusedError,
  PasswordChangeRequiredError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationDomainError,
} from '../../domain/shared/errors.js';
import type { Actor } from '../../domain/shared/types.js';
import { logger } from '../logging/logger.js';

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && incoming.length <= 128 && /^[\w.:-]+$/.test(incoming) ? incoming : randomUUID();
  (req as Request & { id: string }).id = id;
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function rejectPrototypePollution(req: Request, _res: Response, next: NextFunction): void {
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  const check = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(check);
    if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        if (forbidden.has(key)) return true;
        if (check(nested)) return true;
      }
    }
    return false;
  };
  if (check(req.body) || check(req.query) || check(req.params)) {
    next(new ValidationDomainError('La entrada contiene campos no permitidos.'));
    return;
  }
  next();
}

const PROTECTED_PREFIXES = [
  '/auth/logout',
  '/logout',
  '/me',
  '/password',
  '/users',
  '/admins',
  '/alumnos',
  '/docentes',
  '/tutores',
  '/tutor-alumno',
  '/preceptores',
  '/cursos',
  '/cursoDivisionTurno',
  '/materias',
  '/inscripciones',
  '/clases',
  '/asistencias',
  '/periodos',
  '/instancias-evaluacion',
  '/calificaciones',
  '/imports',
  '/auditoria',
];

function relativePath(req: Request): string {
  const base = req.baseUrl;
  if (base && req.path.startsWith(base)) return req.path.slice(base.length) || '/';
  return req.path;
}

function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function authenticate(c: AppContainer): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const path = relativePath(req);
      const header = req.header('authorization');
      if (!header || !header.startsWith('Bearer ')) {
        if (isProtectedPath(path)) throw new UnauthenticatedError();
        next();
        return;
      }
      const raw = header.slice('Bearer '.length).trim();
      if (!raw) throw new UnauthenticatedError();
      let claims;
      try {
        claims = await c.tokens.verifyAccess(raw);
      } catch {
        throw new UnauthenticatedError('Token inválido o expirado.');
      }
      const user = await c.users.findById(claims.sub);
      if (!user || !user.isActive) throw new UnauthenticatedError('Cuenta inactiva.');
      const actor: Actor = {
        id: user.id,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        passwordChangeOnly: claims.password_change_only,
      };
      const allowedWhenRestricted = new Set([
        'GET /me',
        'PUT /password',
        'POST /auth/logout',
        'POST /logout',
      ]);
      if (
        (claims.password_change_only || user.mustChangePassword) &&
        !allowedWhenRestricted.has(`${req.method} ${path}`)
      ) {
        throw new PasswordChangeRequiredError();
      }
      res.locals.actor = actor;
      next();
    })().catch(next);
  };
}

export function getContext(c: AppContainer, req: Request, res: Response): RequestContext {
  const actor = res.locals.actor as Actor | undefined;
  if (!actor) throw new UnauthenticatedError();
  return {
    actor,
    requestId: String(res.locals.requestId ?? c.ids.uuid()),
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

export function getActor(res: Response): Actor {
  const actor = res.locals.actor as Actor | undefined;
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

function canonicalize(value: unknown): string {
  if (Buffer.isBuffer(value)) return JSON.stringify(`buf:${createHash('sha256').update(value).digest('hex')}`);
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`).join(',')}}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface IdempotencyOptions {
  publicScope?: (req: Request) => string | Promise<string>;
  extraHash?: (req: Request, res: Response) => string | null;
}

function extractResourceId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const id = (body as Record<string, unknown>).id;
  return typeof id === 'string' ? id : null;
}

export function idempotency(c: AppContainer, options: IdempotencyOptions = {}): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const key = req.header('idempotency-key');
      if (!key || key.length < 8 || key.length > 255) throw new IdempotencyKeyRequiredError();
      const actor = res.locals.actor as Actor | undefined;
      let scopeKey: string;
      if (actor) scopeKey = `user:${actor.id}`;
      else if (options.publicScope) scopeKey = await options.publicScope(req);
      else throw new UnauthenticatedError();

      const extra = options.extraHash?.(req, res) ?? '';
      const requestHash = sha256(
        `${req.method} ${req.baseUrl}${req.path} ${canonicalize(req.body)} ${extra}`,
      );

      const handleExisting = (existing: IdempotencyKey): boolean => {
        if (existing.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
        if (existing.estado === 'completada') {
          res.setHeader('Idempotent-Replayed', 'true');
          res.status(existing.statusCode ?? 200).json(existing.responseBody);
          return true;
        }
        throw new ConflictError('La operación con esa Idempotency-Key todavía está en proceso.');
      };

      const existing = await c.idempotency.find(scopeKey, key);
      if (existing) {
        if (new Date(existing.expiresAt).getTime() > Date.now()) {
          if (handleExisting(existing)) return;
        } else {
          await c.idempotency.release(scopeKey, key);
        }
      }

      const now = c.clock.now();
      const expiresAt = new Date(
        Date.now() + env().IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000,
      ).toISOString();
      const inserted = await c.uow.transaction((tx) =>
        c.idempotency.tryInsert(
          IdempotencyKey.reconstitute({
            id: c.ids.uuid(),
            actorId: actor?.id ?? null,
            scopeKey,
            clave: key,
            requestHash,
            metodo: req.method,
            ruta: `${req.baseUrl}${req.path}`,
            estado: 'procesando',
            statusCode: null,
            responseBody: null,
            resourceId: null,
            createdAt: now,
            expiresAt,
          }),
          tx,
        ),
      );
      if (inserted === 'exists') {
        const raced = await c.idempotency.find(scopeKey, key);
        if (raced && handleExisting(raced)) return;
        throw new ConflictError('No se pudo reservar la Idempotency-Key.');
      }

      let responseBody: unknown;
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        responseBody = body;
        return originalJson(body);
      }) as Response['json'];

      res.on('finish', () => {
        void (async () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              await c.uow.transaction((tx) =>
                c.idempotency.complete(
                  scopeKey,
                  key,
                  {
                    statusCode: res.statusCode,
                    body: responseBody ?? null,
                    resourceId: extractResourceId(responseBody),
                  },
                  tx,
                ),
              );
            } else {
              await c.idempotency.release(scopeKey, key);
            }
          } catch (error) {
            logger.error({ err: error }, 'No se pudo finalizar la Idempotency-Key.');
          }
        })();
      });
      next();
    })().catch(next);
  };
}

export function rateLimiter(max: number): RequestHandler {
  return rateLimit({
    windowMs: env().RATE_LIMIT_WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      const error = new RateLimitedError();
      const requestId = String(res.locals.requestId ?? '');
      res.status(error.httpStatus).json({
        error: { code: error.code, message: error.message },
        message: error.message,
        requestId,
      });
    },
  });
}

function isPgError(error: unknown): error is { code: string; constraint?: string; detail?: string } {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string';
}

export function notFoundHandler(req: Request, res: Response): void {
  const requestId = String(res.locals.requestId ?? '');
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' },
    message: 'Ruta no encontrada.',
    requestId,
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = String(res.locals.requestId ?? '');
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Error interno del servidor.';
  let details: unknown;

  if (error instanceof DomainError) {
    status = error.httpStatus;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'La entrada no es válida.';
    details = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    }));
  } else if (isPgError(error) && error.code === '23505') {
    status = 409;
    code = 'DUPLICATE_RESOURCE';
    message = 'El recurso ya existe.';
    details = error.constraint ? [{ path: error.constraint, code: 'unique', message: 'Valor duplicado.' }] : undefined;
  } else if (isPgError(error) && (error.code === '23503' || error.code === '23514')) {
    status = 409;
    code = 'CONFLICT';
    message = 'La operación entra en conflicto con el estado actual.';
  } else if (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: string }).type === 'entity.parse.failed'
  ) {
    status = 400;
    code = 'MALFORMED_JSON';
    message = 'El cuerpo JSON no es válido.';
  } else if (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: string }).type === 'entity.too.large'
  ) {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'El cuerpo del pedido es demasiado grande.';
  }

  if (status >= 500) {
    logger.error({ err: error, requestId }, 'Error no controlado.');
  }

  res.status(status).json({
    error: details === undefined ? { code, message } : { code, message, details },
    message,
    requestId,
  });
}
