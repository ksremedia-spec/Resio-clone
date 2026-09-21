import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { mkdirSync } from 'node:fs';
import { isPglite, pgliteDir } from './client.js';
import { migratePglite } from './pglite-shared.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '..', '..', 'drizzle');

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}
function readMigration(file: string) {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(/--> statement-breakpoint/g, '');
}

export async function runMigrations(databaseUrl: string, log: (msg: string) => void = console.log) {
  if (isPglite(databaseUrl)) {
    const { PGlite } = await import('@electric-sql/pglite');
    mkdirSync(pgliteDir(databaseUrl), { recursive: true });
    const client = new PGlite(pgliteDir(databaseUrl));
    try {
      await client.waitReady;
      await migratePglite(client, migrationFiles().map((name) => ({ name, body: readMigration(name) })), log);
    } finally {
      await client.close();
    }
    return;
  }
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name as string));
    for (const file of migrationFiles()) {
      if (applied.has(file)) continue;
      log(`applying ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(readMigration(file));
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });
    }
    log('migrations up to date');
  } finally {
    await sql.end();
  }
}

/** Create the database if it does not exist (dev/test convenience). No-op for PGlite. */
export async function ensureDatabase(databaseUrl: string) {
  if (isPglite(databaseUrl)) return;
  const url = new URL(databaseUrl);
  const dbName = url.pathname.replace(/^\//, '');
  url.pathname = '/postgres';
  const sql = postgres(url.toString(), { max: 1 });
  try {
    const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { config } = await import('../config.js');
  await ensureDatabase(config.DATABASE_URL);
  await runMigrations(config.DATABASE_URL);
}
