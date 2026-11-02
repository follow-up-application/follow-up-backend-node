import { createServer } from 'node:http';
import { buildContainer, buildHttpServices, buildWorkers } from './composition.js';
import { env } from './config/env.js';
import { closePool } from './infra/db/client.js';
import { createApp } from './infra/http/app.js';
import { logger } from './infra/logging/logger.js';
import { startEventLoopMonitor } from './infra/metrics/event-loop.js';

const config = env();
startEventLoopMonitor();
const container = buildContainer();
const services = buildHttpServices(container);
const workers = buildWorkers(container);
const app = createApp(container, services);
const server = createServer(app);

if (config.RUN_IMPORT_WORKER) workers.importWorker.start();
if (config.RUN_NOTIFICATION_WORKER) workers.notificationWorker.start();

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'servidor escuchando');
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'apagando servidor');

  const forceExit = setTimeout(() => {
    logger.error({ timeoutMs: config.SHUTDOWN_TIMEOUT_MS }, 'tiempo de apagado excedido; saliendo de todos modos');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  workers.importWorker.stop();
  workers.notificationWorker.stop();

  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'error al cerrar el servidor HTTP');
    try {
      await closePool();
    } catch (poolError) {
      logger.error({ err: poolError }, 'error al cerrar el pool de PostgreSQL');
    }
    clearTimeout(forceExit);
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'promesa rechazada sin manejar');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'excepción no capturada; apagando');
  void shutdown('uncaughtException');
});
