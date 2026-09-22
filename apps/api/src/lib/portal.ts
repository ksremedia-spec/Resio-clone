import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { contacts } from '../db/schema/index.js';
import type { RequestContext } from './context.js';

/** True for a homeowner signed in through the client portal role. */
export function isClientPortal(ctx: RequestContext): boolean {
  return ctx.membership.external && ctx.membership.roleKey === 'client';
}

/** True for a subcontractor or supplier signed in through the vendor portal role. */
export function isVendorPortal(ctx: RequestContext): boolean {
  return ctx.membership.external && ctx.membership.roleKey === 'vendor';
}

/** The CRM contact record behind a portal user, if the invitation linked one. */
export async function contactIdFor(db: DbOrTx, ctx: RequestContext): Promise<string | null> {
  if (!ctx.membership.external) return null;
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.organizationId, ctx.organizationId), eq(contacts.portalUserId, ctx.userId))).limit(1);
  return c?.id ?? null;
}
