import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema/index.js';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

/** "2026-09-21 21:25:27.104+00" → "2026-09-21T21:25:27.104Z" */
export function pgTimestampToIso(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(?:([+-]\d{2})(?::?(\d{2}))?)?$/.exec(value);
  if (!m) return value;
  const [, date, time, frac = '', offH, offM = '00'] = m;
  const ms = (frac + '000').slice(1, 4);
  const offset = offH ? `${offH}:${offM}` : '+00:00';
  return new Date(`${date}T${time}.${ms}${offset}`).toISOString();
}

export function createDb(url: string) {
  const client = postgres(url, { max: 10, prepare: false, transform: { undefined: null } });
  const db = drizzle(client, { schema });
  // Drizzle installs pass-through parsers for date/time types; normalise
  // timestamps to ISO-8601 strings so API responses are consistent everywhere.
  for (const oid of ['1184', '1114']) (client.options.parsers as Record<string, (v: string) => unknown>)[oid] = pgTimestampToIso;
  return { db, client };
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
