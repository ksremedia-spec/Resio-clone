import { config } from './config.js';
import { buildApp } from './app.js';
import { ensureDatabase, runMigrations } from './db/migrate.js';

await ensureDatabase(config.DATABASE_URL);
await runMigrations(config.DATABASE_URL);
const app = await buildApp(config);
await app.fastify.listen({ port: config.PORT, host: config.HOST });
app.fastify.log.info(`Buildline API listening on ${config.API_URL} (docs at ${config.API_URL}/docs)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => { await app.close(); process.exit(0); });
}
