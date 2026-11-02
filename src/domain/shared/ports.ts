export interface Clock {
  now(): string;
  today(): string;
}

export interface IdGenerator {
  uuid(): string;
}
