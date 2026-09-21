import { and, desc, eq, like } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';

/**
 * Next document number for an organization: PREFIX-0001, PREFIX-0002, …
 * The unique index on (organization_id, number) catches the rare race; the
 * caller surfaces that as a 409 and the user simply retries.
 */
export async function nextNumber(tx: DbOrTx, table: any, organizationId: string, prefix: string, width = 4): Promise<string> {
  const [row] = await tx.select({ number: table.number }).from(table).where(and(eq(table.organizationId, organizationId), like(table.number, `${prefix}-%`))).orderBy(desc(table.number)).limit(1);
  const last = row ? Number(String(row.number).slice(prefix.length + 1)) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}-${String(next).padStart(width, '0')}`;
}
