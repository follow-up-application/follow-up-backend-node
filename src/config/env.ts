import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : ['1', 'true', 'yes'].includes(value.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  DATABASE_TEST_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(6).max(128).default(6),
  PASSWORD_MAX_LENGTH: z.coerce.number().int().min(6).max(128).default(128),
  ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  IMPORT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  INTERNAL_METRICS_TOKEN: z.string().min(1).default('local-metrics-token'),

  IMPORT_MAX_FILE_BYTES: z.coerce.number().int().positive().default(10485760),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(20000),
  IMPORT_LEASE_SECONDS: z.coerce.number().int().positive().default(120),
  IMPORT_HEARTBEAT_SECONDS: z.coerce.number().int().positive().default(30),
  IMPORT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  IMPORT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  IMPORT_STORAGE_DIR: z.string().default('storage/imports'),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),

  RUN_IMPORT_WORKER: booleanish.default(true),
  RUN_NOTIFICATION_WORKER: booleanish.default(true),
  IMPORT_NAIVE: booleanish.default(false),
});

export type Env = z.infer<typeof envSchema> & { corsOrigins: string[] };

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    process.stderr.write(
      `Configuración inválida. Corrija las siguientes variables de entorno:\n${formatIssues(parsed.error)}\n`,
    );
    process.exit(1);
  }
  const value = parsed.data;
  if (value.PASSWORD_MIN_LENGTH > value.PASSWORD_MAX_LENGTH) {
    process.stderr.write('Configuración inválida: PASSWORD_MIN_LENGTH no puede superar a PASSWORD_MAX_LENGTH.\n');
    process.exit(1);
  }
  return {
    ...value,
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

export function resetEnvForTests(): void {
  cached = undefined;
}
