import type { Config } from '../config.js';
import type { Db } from '../db/pglite-shared.js';
import type { Providers } from '../providers/index.js';

/** Minimal logger both pino (Fastify) and the browser console satisfy. */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface Deps {
  db: Db;
  config: Config;
  providers: Providers;
  log: Logger;
}
