import postgres from 'postgres';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';
import { isPglite, pgliteDir } from './client.js';

export async function resetDatabase(databaseUrl: string) {
  if (isPglite(databaseUrl)) {
    rmSync(pgliteDir(databaseUrl), { recursive: true, force: true });
  } else {
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    } finally {
      await sql.end();
    }
  }
  await runMigrations(databaseUrl, () => {});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { config } = await import('../config.js');
  if (config.NODE_ENV === 'production') throw new Error('refusing to reset a production database');
  await resetDatabase(config.DATABASE_URL);
  console.log('database reset');
}
