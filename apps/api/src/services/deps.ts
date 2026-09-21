import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { Providers } from '../providers/index.js';

export interface Deps {
  db: Db;
  config: Config;
  providers: Providers;
  log: FastifyBaseLogger | Console;
}
