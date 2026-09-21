import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { buildApp } from '../app.js';
import { ensureDatabase, runMigrations } from './migrate.js';
import { seedDemo } from './seed-data.js';
export { DEMO_OWNER } from './seed-data.js';

export async function seed(opts: { log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const app = await buildApp(config, { logger: false });
  try {
    const db = (app.services as any).auth['deps'].db;
    await seedDemo(app.services, db, log);
  } finally {
    await app.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await ensureDatabase(config.DATABASE_URL);
  await runMigrations(config.DATABASE_URL);
  await seed();
}
