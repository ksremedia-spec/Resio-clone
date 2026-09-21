import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import * as schema from './schema/index.js';

/**
 * Two database backends share one Drizzle API:
 *  - PostgreSQL 16 over the network (`postgres://…`) for real deployments and the test suite.
 *  - PGlite (`pglite://./some/dir`), Postgres compiled to WebAssembly and stored in a folder,
 *    for zero-install demos and single-user trials. Same SQL, same migrations, same behaviour.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function isPglite(url: string) { return url.startsWith('pglite:'); }
export function pgliteDir(url: string) { return url.replace(/^pglite:\/\//, '').replace(/^pglite:/, '') || './data/buildline'; }

/** "2026-09-21 21:25:27.104+00" → "2026-09-21T21:25:27.104Z" */
export function pgTimestampToIso(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(?:([+-]\d{2})(?::?(\d{2}))?)?$/.exec(value);
  if (!m) return value;
  const [, date, time, frac = '', offH, offM = '00'] = m;
  const ms = (frac + '000').slice(1, 4);
  const offset = offH ? `${offH}:${offM}` : '+00:00';
  return new Date(`${date}T${time}.${ms}${offset}`).toISOString();
}

const TIMESTAMP_OIDS = [1114, 1184];

export async function createDb(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (isPglite(url)) {
    const { PGlite } = await import('@electric-sql/pglite');
    mkdirSync(pgliteDir(url), { recursive: true });
    const client = new PGlite(pgliteDir(url));
    await client.waitReady;
    // Drizzle passes pass-through parsers per query; wrap query/transaction so timestamps become ISO strings.
    const normalise = (options: any) => ({ ...options, parsers: { ...(options?.parsers ?? {}), ...Object.fromEntries(TIMESTAMP_OIDS.map((oid) => [oid, (v: string) => pgTimestampToIso(v)])) } });
    const wrap = (target: any) => {
      const origQuery = target.query.bind(target);
      target.query = (q: string, params?: unknown[], options?: any) => origQuery(q, params, normalise(options));
      return target;
    };
    wrap(client);
    const origTx = client.transaction.bind(client);
    (client as any).transaction = (fn: (tx: any) => Promise<unknown>) => origTx(async (tx: any) => fn(wrap(tx)));
    const db = drizzlePglite(client, { schema }) as unknown as Db;
    return { db, close: () => client.close() };
  }
  const client = postgres(url, { max: 10, prepare: false, transform: { undefined: null } });
  const db = drizzlePostgres(client, { schema }) as unknown as Db;
  for (const oid of TIMESTAMP_OIDS) (client.options.parsers as Record<string, (v: string) => unknown>)[String(oid)] = pgTimestampToIso;
  return { db, close: () => client.end() };
}

/** Rows from `db.execute(sql…)` regardless of driver (postgres.js returns an array, PGlite `{ rows }`). */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r?.rows ?? [];
}

/**
 * Run `fn` inside a transaction with the tenant set for row-level security.
 * When orgId is null (auth routes) the RLS policies allow all rows for the
 * owner role; the service layer still scopes explicitly.
 */
export async function withTenantTx<T>(db: Db, orgId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (orgId) await tx.execute(sql`select set_config('app.organization_id', ${orgId}, true)`);
    return fn(tx);
  });
}

export { schema };
