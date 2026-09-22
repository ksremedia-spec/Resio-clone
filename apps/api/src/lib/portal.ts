import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { contacts, vendors } from '../db/schema/index.js';
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

/** The vendor record behind a vendor-portal user (linked when the invitation was accepted). */
export async function vendorIdFor(db: DbOrTx, ctx: RequestContext): Promise<string | null> {
  if (!isVendorPortal(ctx)) return null;
  const [v] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.organizationId, ctx.organizationId), eq(vendors.portalUserId, ctx.userId))).limit(1);
  if (v) return v.id;
  const [c] = await db.select({ vendorId: contacts.vendorId }).from(contacts).where(and(eq(contacts.organizationId, ctx.organizationId), eq(contacts.portalUserId, ctx.userId))).limit(1);
  return c?.vendorId ?? null;
}
