import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { contacts, costCatalogItems, costCodes, purchaseOrders, vendors } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';

/** A practical default cost-code list (NAHB-style divisions) seeded on first use. */
export const DEFAULT_COST_CODES: Array<[string, string, string, contracts.CostCode['defaultCostType']]> = [
  ['01-000', 'General Requirements', 'General', 'other'], ['01-100', 'Permits & Fees', 'General', 'other'], ['01-200', 'Supervision', 'General', 'labor'], ['01-300', 'Temporary Facilities', 'General', 'other'],
  ['02-000', 'Site Work', 'Site', 'subcontract'], ['02-100', 'Demolition', 'Site', 'labor'], ['02-200', 'Excavation & Grading', 'Site', 'subcontract'],
  ['03-000', 'Concrete', 'Structure', 'subcontract'], ['04-000', 'Masonry', 'Structure', 'subcontract'], ['05-000', 'Structural Steel', 'Structure', 'subcontract'],
  ['06-100', 'Rough Carpentry / Framing', 'Structure', 'labor'], ['06-200', 'Finish Carpentry', 'Finishes', 'labor'], ['06-400', 'Cabinets & Millwork', 'Finishes', 'material'],
  ['07-100', 'Waterproofing & Insulation', 'Envelope', 'subcontract'], ['07-300', 'Roofing', 'Envelope', 'subcontract'], ['07-400', 'Siding & Exterior Trim', 'Envelope', 'subcontract'],
  ['08-100', 'Doors', 'Openings', 'material'], ['08-500', 'Windows', 'Openings', 'material'],
  ['09-200', 'Drywall', 'Finishes', 'subcontract'], ['09-300', 'Tile', 'Finishes', 'subcontract'], ['09-600', 'Flooring', 'Finishes', 'subcontract'], ['09-900', 'Painting', 'Finishes', 'subcontract'],
  ['10-000', 'Specialties & Accessories', 'Finishes', 'material'], ['11-000', 'Appliances', 'Finishes', 'material'], ['12-300', 'Countertops', 'Finishes', 'material'],
  ['15-100', 'Plumbing', 'Mechanical', 'subcontract'], ['15-500', 'HVAC', 'Mechanical', 'subcontract'], ['16-000', 'Electrical', 'Mechanical', 'subcontract'],
  ['17-000', 'Landscaping & Hardscape', 'Site', 'subcontract'], ['18-000', 'Cleaning & Closeout', 'General', 'labor'], ['19-000', 'Allowances', 'Allowances', 'material'], ['20-000', 'Contingency', 'General', 'other'],
];

export class CatalogService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService) {}

  // ---------- cost codes ----------

  async listCostCodes(ctx: RequestContext, includeArchived = false): Promise<contracts.CostCode[]> {
    ctx.requireAny('estimates.read', 'budget.read', 'purchasing.read', 'bills.read', 'time.clock');
    const { db } = this.deps;
    let rows = await db.select().from(costCodes).where(and(eq(costCodes.organizationId, ctx.organizationId), includeArchived ? sql`true` : isNull(costCodes.archivedAt))).orderBy(asc(costCodes.code));
    if (rows.length === 0 && ctx.has('estimates.write')) { await this.seedDefaults(ctx); rows = await db.select().from(costCodes).where(eq(costCodes.organizationId, ctx.organizationId)).orderBy(asc(costCodes.code)); }
    return rows.map(serializeCostCode);
  }

  async seedDefaults(ctx: RequestContext) {
    await this.deps.db.insert(costCodes).values(DEFAULT_COST_CODES.map(([code, name, category, defaultCostType], i) => ({ organizationId: ctx.organizationId, code, name, category, defaultCostType, sortOrder: i, createdBy: ctx.userId, updatedBy: ctx.userId }))).onConflictDoNothing();
  }

  async createCostCode(ctx: RequestContext, input: contracts.CostCode extends never ? never : { code: string; name: string; parentId?: string | null; category?: string | null; defaultCostType: contracts.CostCode['defaultCostType']; sortOrder?: number }): Promise<contracts.CostCode> {
    ctx.require('estimates.write');
    return this.deps.db.transaction(async (tx) => {
      const [clash] = await tx.select({ id: costCodes.id }).from(costCodes).where(and(eq(costCodes.organizationId, ctx.organizationId), eq(costCodes.code, input.code))).limit(1);
      if (clash) throw AppError.conflict(`Cost code ${input.code} already exists.`);
      const [row] = await tx.insert(costCodes).values({ organizationId: ctx.organizationId, code: input.code, name: input.name, parentId: input.parentId ?? null, category: input.category ?? null, defaultCostType: input.defaultCostType, sortOrder: input.sortOrder ?? 0, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'created', objectType: 'estimate', objectId: row!.id, objectLabel: `cost code ${row!.code} ${row!.name}` });
      return serializeCostCode(row!);
    });
  }

  async updateCostCode(ctx: RequestContext, id: string, input: Record<string, unknown>): Promise<contracts.CostCode> {
    ctx.require('estimates.write');
    return this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(costCodes).where(and(eq(costCodes.id, id), eq(costCodes.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Cost code');
      const [after] = await tx.update(costCodes).set({ ...input, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${costCodes.version} + 1` } as any).where(eq(costCodes.id, id)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'updated', objectType: 'estimate', objectId: id, objectLabel: `cost code ${after!.code}`, diff });
      return serializeCostCode(after!);
    });
  }

  async archiveCostCode(ctx: RequestContext, id: string, archived: boolean): Promise<contracts.CostCode> {
    ctx.require('estimates.write');
    const [row] = await this.deps.db.update(costCodes).set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()`, updatedBy: ctx.userId }).where(and(eq(costCodes.id, id), eq(costCodes.organizationId, ctx.organizationId))).returning();
    if (!row) throw AppError.notFound('Cost code');
    return serializeCostCode(row);
  }

  // ---------- catalog ----------

  async listCatalog(ctx: RequestContext, query: { cursor?: string; limit: number; q?: string; costCodeId?: string; includeArchived: boolean }) {
    ctx.require('estimates.read');
    const { db } = this.deps;
    const conditions = [eq(costCatalogItems.organizationId, ctx.organizationId)];
    if (!query.includeArchived) conditions.push(isNull(costCatalogItems.archivedAt));
    if (query.costCodeId) conditions.push(eq(costCatalogItems.costCodeId, query.costCodeId));
    if (query.q) conditions.push(or(ilike(costCatalogItems.name, `%${query.q}%`), sql`to_tsvector('simple', ${costCatalogItems.searchText}) @@ plainto_tsquery('simple', ${query.q})`)!);
    const cursor = decodeCursor<{ k: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${costCatalogItems.name}, ${costCatalogItems.id}) > (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select({ i: costCatalogItems, code: costCodes.code }).from(costCatalogItems).leftJoin(costCodes, eq(costCodes.id, costCatalogItems.costCodeId)).where(and(...conditions)).orderBy(asc(costCatalogItems.name), asc(costCatalogItems.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: r.i.name, id: r.i.id }));
    return { items: result.items.map((r) => serializeCatalogItem(r.i, r.code)), nextCursor: result.nextCursor };
  }

  async createCatalogItem(ctx: RequestContext, input: any): Promise<contracts.CatalogItem> {
    ctx.require('estimates.write');
    return this.deps.db.transaction(async (tx) => {
      const [row] = await tx.insert(costCatalogItems).values({ organizationId: ctx.organizationId, costCodeId: input.costCodeId ?? null, name: input.name, description: input.description, unit: input.unit, unitCostCents: input.unitCostCents, markupBp: input.markupBp ?? null, vendorId: input.vendorId ?? null, isAllowance: input.isAllowance, tags: input.tags, sourceUrl: input.sourceUrl ?? null, searchText: [input.name, input.description, ...(input.tags ?? [])].join(' '), createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'created', objectType: 'estimate', objectId: row!.id, objectLabel: `catalog item ${row!.name}` });
      const [code] = row!.costCodeId ? await tx.select({ code: costCodes.code }).from(costCodes).where(eq(costCodes.id, row!.costCodeId)).limit(1) : [];
      return serializeCatalogItem(row!, code?.code ?? null);
    });
  }

  async updateCatalogItem(ctx: RequestContext, id: string, input: Record<string, any>): Promise<contracts.CatalogItem> {
    ctx.require('estimates.write');
    return this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(costCatalogItems).where(and(eq(costCatalogItems.id, id), eq(costCatalogItems.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Catalog item');
      const merged = { ...before, ...input };
      const [after] = await tx.update(costCatalogItems).set({ ...input, searchText: [merged.name, merged.description, ...(merged.tags ?? [])].join(' '), updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${costCatalogItems.version} + 1` } as any).where(eq(costCatalogItems.id, id)).returning();
      const [code] = after!.costCodeId ? await tx.select({ code: costCodes.code }).from(costCodes).where(eq(costCodes.id, after!.costCodeId)).limit(1) : [];
      return serializeCatalogItem(after!, code?.code ?? null);
    });
  }

  async archiveCatalogItem(ctx: RequestContext, id: string, archived: boolean) {
    ctx.require('estimates.write');
    const [row] = await this.deps.db.update(costCatalogItems).set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` }).where(and(eq(costCatalogItems.id, id), eq(costCatalogItems.organizationId, ctx.organizationId))).returning();
    if (!row) throw AppError.notFound('Catalog item');
    return serializeCatalogItem(row, null);
  }

  // ---------- vendors ----------

  async listVendors(ctx: RequestContext, query: { cursor?: string; limit: number; q?: string; trade?: string; includeArchived: boolean }) {
    ctx.require('vendors.read');
    const { db } = this.deps;
    const conditions = [eq(vendors.organizationId, ctx.organizationId)];
    if (!query.includeArchived) conditions.push(isNull(vendors.archivedAt));
    if (query.trade) conditions.push(eq(vendors.trade, query.trade));
    if (query.q) conditions.push(or(ilike(vendors.name, `%${query.q}%`), ilike(vendors.trade, `%${query.q}%`), ilike(vendors.email, `%${query.q}%`))!);
    const cursor = decodeCursor<{ k: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${vendors.name}, ${vendors.id}) > (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select({ v: vendors, openPo: sql<number>`coalesce((select sum(po.total_cents - po.billed_cents) from purchase_orders po where po.vendor_id = vendors.id and po.status in ('approved','committed','matched')), 0)::bigint` }).from(vendors).where(and(...conditions)).orderBy(asc(vendors.name), asc(vendors.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: r.v.name, id: r.v.id }));
    return { items: result.items.map((r) => serializeVendor(r.v, { openPoCents: Number(r.openPo) })), nextCursor: result.nextCursor };
  }

  async getVendor(ctx: RequestContext, id: string): Promise<contracts.Vendor> {
    ctx.require('vendors.read');
    const [row] = await this.deps.db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Vendor');
    const cs = await this.deps.db.select().from(contacts).where(eq(contacts.vendorId, id)).orderBy(desc(contacts.isPrimary), asc(contacts.firstName));
    const [po] = await this.deps.db.select({ n: sql<number>`coalesce(sum(${purchaseOrders.totalCents} - ${purchaseOrders.billedCents}), 0)::bigint` }).from(purchaseOrders).where(and(eq(purchaseOrders.vendorId, id), sql`${purchaseOrders.status} in ('approved','committed','matched')`));
    return serializeVendor(row, { openPoCents: Number(po?.n ?? 0), contacts: cs.map((c) => ({ id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, title: c.title, isPrimary: c.isPrimary })) });
  }

  async createVendor(ctx: RequestContext, input: any): Promise<contracts.Vendor> {
    ctx.require('vendors.write');
    return this.deps.db.transaction(async (tx) => {
      const [row] = await tx.insert(vendors).values({ organizationId: ctx.organizationId, name: input.name, trade: input.trade ?? null, email: input.email ?? null, phone: input.phone ?? null, website: input.website ?? null, notes: input.notes, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'created', objectType: 'vendor', objectId: row!.id, objectLabel: row!.name });
      return serializeVendor(row!, { openPoCents: 0, contacts: [] });
    });
  }

  async updateVendor(ctx: RequestContext, id: string, input: Record<string, unknown>): Promise<contracts.Vendor> {
    ctx.require('vendors.write');
    await this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Vendor');
      const [after] = await tx.update(vendors).set({ ...input, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${vendors.version} + 1` } as any).where(eq(vendors.id, id)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'updated', objectType: 'vendor', objectId: id, objectLabel: after!.name, diff });
    });
    return this.getVendor(ctx, id);
  }

  async archiveVendor(ctx: RequestContext, id: string, archived: boolean): Promise<contracts.Vendor> {
    ctx.require('vendors.write');
    const [row] = await this.deps.db.update(vendors).set({ archivedAt: archived ? sql`now()` : null, status: archived ? 'archived' : 'active', updatedAt: sql`now()`, updatedBy: ctx.userId }).where(and(eq(vendors.id, id), eq(vendors.organizationId, ctx.organizationId))).returning();
    if (!row) throw AppError.notFound('Vendor');
    return this.getVendor(ctx, id);
  }
}

export function serializeCostCode(r: typeof costCodes.$inferSelect): contracts.CostCode {
  return { id: r.id, organizationId: r.organizationId, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy, updatedBy: r.updatedBy, version: r.version, code: r.code, name: r.name, parentId: r.parentId, category: r.category, defaultCostType: r.defaultCostType as contracts.CostCode['defaultCostType'], sortOrder: r.sortOrder, archivedAt: r.archivedAt };
}
export function serializeCatalogItem(r: typeof costCatalogItems.$inferSelect, costCode: string | null): contracts.CatalogItem {
  return { id: r.id, organizationId: r.organizationId, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy, updatedBy: r.updatedBy, version: r.version, costCodeId: r.costCodeId, costCode, name: r.name, description: r.description, unit: r.unit, unitCostCents: r.unitCostCents as any, markupBp: (r.markupBp as any) ?? null, vendorId: r.vendorId, isAllowance: r.isAllowance, tags: r.tags, sourceUrl: r.sourceUrl, archivedAt: r.archivedAt };
}
export function serializeVendor(r: typeof vendors.$inferSelect, extra: { openPoCents?: number; contacts?: contracts.Vendor['contacts'] } = {}): contracts.Vendor {
  return { id: r.id, organizationId: r.organizationId, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy, updatedBy: r.updatedBy, version: r.version, name: r.name, trade: r.trade, email: r.email, phone: r.phone, website: r.website, notes: r.notes, status: r.status, archivedAt: r.archivedAt, openPoCents: extra.openPoCents, contacts: extra.contacts };
}
