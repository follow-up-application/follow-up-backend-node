import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/shared/ports.js';
import type { LocalDate } from '../../domain/shared/types.js';

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }

  today(): string {
    return new Date().toISOString().slice(0, 10) as LocalDate;
  }
}

export class UuidGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}
