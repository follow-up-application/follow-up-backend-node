import pino from 'pino';
import { env } from '../../config/env.js';

export const logger = pino({
  level: env().LOG_LEVEL,
  base: { service: 'follow-up-backend' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["idempotency-key"]',
      'password',
      'password_hash',
      'passwordHash',
      'refresh_token',
      'access_token',
      '*.password',
      '*.password_hash',
      '*.refresh_token',
      '*.access_token',
    ],
    censor: '[REDACTED]',
  },
});
