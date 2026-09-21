/**
 * Drizzle over PGlite, shared by the Node backend (pglite://dir) and the
 * browser-only demo (idb://name). No Node imports here.
 */
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema/index.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** "2026-09-21 21:25:27.104+00" → "2026-09-21T21:25:27.104Z" */
export function pgTimestampToIso(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(?:([+-]\d{2})(?::?(\d{2}))?)?$/.exec(value);
  if (!m) return value;
  const [, date, time, frac = '', offH, offM = '00'] = m;
  const ms = (frac + '000').slice(1, 4);
  const offset = offH ? `${offH}:${offM}` : '+00:00';
  return new Date(`${date}T${time}.${ms}${offset}`).toISOString();
}

export const TIMESTAMP_OIDS = [1114, 1184];

/** Wrap a PGlite client so timestamps come back as ISO strings through Drizzle's pass-through parsers. */
export function drizzleFromPglite(client: any): Db {
  const normalise = (options: any) => ({ ...options, parsers: { ...(options?.parsers ?? {}), ...Object.fromEntries(TIMESTAMP_OIDS.map((oid) => [oid, (v: string) => pgTimestampToIso(v)])) } });
  const wrap = (target: any) => {
    const origQuery = target.query.bind(target);
    target.query = (q: string, params?: unknown[], options?: any) => origQuery(q, params, normalise(options));
    return target;
  };
  wrap(client);
  const origTx = client.transaction.bind(client);
  client.transaction = (fn: (tx: any) => Promise<unknown>) => origTx(async (tx: any) => fn(wrap(tx)));
  return drizzlePglite(client, { schema }) as unknown as Db;
}

export interface MigrationFile { name: string; body: string }

/** Apply migrations to a raw PGlite client (used by both runtimes). */
export async function migratePglite(client: any, files: MigrationFile[], log: (m: string) => void = () => {}) {
  await client.exec('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set(((await client.query('SELECT name FROM _migrations')).rows as Array<{ name: string }>).map((r) => r.name));
  for (const file of files.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    if (applied.has(file.name)) continue;
    log(`applying ${file.name}`);
    await client.exec(`BEGIN; ${file.body.replace(/--> statement-breakpoint/g, '')}; INSERT INTO _migrations (name) VALUES ('${file.name}'); COMMIT;`);
  }
  log('migrations up to date');
}

/** Rows from `db.execute(sql…)` regardless of driver (postgres.js returns an array, PGlite `{ rows }`). */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r?.rows ?? [];
}

export { schema };
