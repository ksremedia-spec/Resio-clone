import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import * as schema from './schema/index.js';
import { drizzleFromPglite, pgTimestampToIso, rowsOf, TIMESTAMP_OIDS, type Db } from './pglite-shared.js';

/**
 * Two database backends share one Drizzle API:
 *  - PostgreSQL 16 over the network (`postgres://…`) for real deployments and the test suite.
 *  - PGlite (`pglite://./some/dir`), Postgres compiled to WebAssembly and stored in a folder,
 *    for zero-install demos and single-user trials. Same SQL, same migrations, same behaviour.
 */
export type { Db };
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function isPglite(url: string) { return url.startsWith('pglite:'); }
export function pgliteDir(url: string) { return url.replace(/^pglite:\/\//, '').replace(/^pglite:/, '') || './data/buildline'; }

export async function createDb(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (isPglite(url)) {
    const { PGlite } = await import('@electric-sql/pglite');
    mkdirSync(pgliteDir(url), { recursive: true });
    const client = new PGlite(pgliteDir(url));
    await client.waitReady;
    return { db: drizzleFromPglite(client), close: () => client.close() };
  }
  const client = postgres(url, { max: 10, prepare: false, transform: { undefined: null } });
  const db = drizzlePostgres(client, { schema }) as unknown as Db;
  for (const oid of TIMESTAMP_OIDS) (client.options.parsers as Record<string, (v: string) => unknown>)[String(oid)] = pgTimestampToIso;
  return { db, close: () => client.end() };
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

export { schema, rowsOf, pgTimestampToIso };
