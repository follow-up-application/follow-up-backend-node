import express from 'express';
import type { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppContainer } from '../../application/container.js';
import { env } from '../../config/env.js';
import { pool, query } from '../db/client.js';
import { ForbiddenError } from '../../domain/shared/errors.js';
import { logger } from '../logging/logger.js';
import { eventLoopLag, resetEventLoopMonitor } from '../metrics/event-loop.js';
import {
  asyncHandler,
  errorHandler,
  notFoundHandler,
  rateLimiter,
  rejectPrototypePollution,
  requestId,
} from './middleware.js';
import { buildProtectedRouter, buildPublicRouter } from './routes.js';
import type { HttpServices } from './routes.js';

function isLoopback(req: Request): boolean {
  const ip = req.ip ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function metricsAuthorized(req: Request): boolean {
  if (isLoopback(req)) return true;
  const header = req.header('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  const token = req.header('x-internal-token') ?? bearer;
  return token.length > 0 && token === env().INTERNAL_METRICS_TOKEN;
}

async function checkReady(): Promise<{ database: boolean; migrations: boolean }> {
  try {
    await query('SELECT 1');
  } catch {
    return { database: false, migrations: false };
  }
  try {
    const result = await query('SELECT count(*)::int AS count FROM pgmigrations');
    const count = Number((result.rows[0] as { count?: number } | undefined)?.count ?? 0);
    return { database: true, migrations: count > 0 };
  } catch {
    return { database: true, migrations: false };
  }
}

export function createApp(c: AppContainer, services: HttpServices): Express {
  const app = express();
  app.set('trust proxy', env().TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request & { id?: string }).id ?? '',
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/ready',
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env().corsOrigins,
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(rejectPrototypePollution);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      const status = await checkReady();
      if (status.database && status.migrations) {
        res.json({ status: 'ok', ...status });
        return;
      }
      res.status(503).json({
        status: 'unavailable',
        ...status,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'La base de datos o las migraciones no están disponibles.' },
        requestId: String(res.locals.requestId ?? ''),
      });
    }),
  );

  app.get('/internal/metrics', (req: Request, res: Response) => {
    if (!metricsAuthorized(req)) {
      const error = new ForbiddenError();
      res.status(error.httpStatus).json({
        error: { code: error.code, message: error.message },
        message: error.message,
        requestId: String(res.locals.requestId ?? ''),
      });
      return;
    }
    res.json({
      uptime_seconds: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      event_loop: eventLoopLag(),
      db_pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        max: env().DB_POOL_MAX,
      },
      pid: process.pid,
      node: process.version,
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/internal/metrics/reset', (req: Request, res: Response) => {
    if (!metricsAuthorized(req)) {
      const error = new ForbiddenError();
      res.status(error.httpStatus).json({
        error: { code: error.code, message: error.message },
        message: error.message,
        requestId: String(res.locals.requestId ?? ''),
      });
      return;
    }
    resetEventLoopMonitor();
    res.status(204).end();
  });

  app.use('/api/v1', rateLimiter(env().RATE_LIMIT_MAX));
  app.use('/api/v1', buildPublicRouter(c, services));
  app.use('/api/v1', buildProtectedRouter(c, services));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
