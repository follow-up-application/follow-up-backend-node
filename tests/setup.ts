import dotenv from 'dotenv';

dotenv.config();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  process.env.DATABASE_URL ??
  'postgres://follow:follow@localhost:5432/follow_test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-with-at-least-32-characters';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.IMPORT_STORAGE_DIR = 'tmp/test-imports';
process.env.IMPORT_RATE_LIMIT_MAX = '20';
