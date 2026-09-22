import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { activityLog, bidRequests, bids, costCodes, documents, projectMembers, projects, purchaseOrders, taskAssignees, tasks, vendors } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import type { DocumentService } from './document.service.js';
import type { ProcurementService } from './procurement.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import { projectTeamUserIds } from '../lib/recipients.js';
import { isVendorPortal, vendorIdFor } from '../lib/portal.js';

type RequestRow = typeof bidRequests.$inferSelect;

/**
 * Bid requests: invite vendors to price a scope, collect their bids in the
 * vendor portal, award one and turn it into a purchase order.
 */
export class BidService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService, private readonly documents: DocumentService, private readonly procurement: ProcurementService) {}

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; status: string }) {
    const { db } = this.deps;
    const vendorId = isVendorPortal(ctx) ? await vendorIdFor(db, ctx) : null;
    if (!vendorId) ctx.require('purchasing.read');
    const conditions = [eq(bidRequests.organizationId, ctx.organizationId), isNull(bidRequests.archivedAt)];
    if (vendorId) conditions.push(sql`exists (select 1 from ${bids} b where b.bid_request_id = ${bidRequests.id} and b.vendor_id = ${vendorId})`, sql`${bidRequests.status} <> 'draft'`);
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(bidRequests.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? inArray(bidRequests.projectId, visible) : sql`false`); }
    if (query.status !== 'all') conditions.push(eq(bidRequests.status, query.status));
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${bidRequests.createdAt}, ${bidRequests.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await db.select({ r: bidRequests, projectName: projects.name, code: costCodes.code }).from(bidRequests).innerJoin(projects, eq(projects.id, bidRequests.projectId)).leftJoin(costCodes, eq(costCodes.id, bidRequests.costCodeId)).where(and(...conditions)).orderBy(desc(bidRequests.createdAt), desc(bidRequests.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.r.createdAt, id: r.r.id }));
    const allBids = await this.bidsFor(db, result.items.map((r) => r.r.id), vendorId);
    return { items: result.items.map((r) => serializeRequest(r.r, r.projectName, r.code, allBids.get(r.r.id) ?? [])), nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.BidRequest> {
    const { db } = this.deps;
    const vendorId = isVendorPortal(ctx) ? await vendorIdFor(db, ctx) : null;
    if (!vendorId) ctx.require('purchasing.read');
    const [r] = await db.select({ r: bidRequests, projectName: projects.name, code: costCodes.code }).from(bidRequests).innerJoin(projects, eq(projects.id, bidRequests.projectId)).leftJoin(costCodes, eq(costCodes.id, bidRequests.costCodeId)).where(and(eq(bidRequests.id, id), eq(bidRequests.organizationId, ctx.organizationId))).limit(1);
    if (!r) throw AppError.notFound('Bid request');
    await ctx.requireProjectAccess(db, r.r.projectId, { allowArchived: true });
    const allBids = await this.bidsFor(db, [id], vendorId);
    if (vendorId && (r.r.status === 'draft' || !(allBids.get(id) ?? []).length)) throw AppError.notFound('Bid request');
    const attachments = await this.documents.attachmentsFor(db, ctx, 'bid_request', [id]);
    return serializeRequest(r.r, r.projectName, r.code, allBids.get(id) ?? [], (attachments.get(id) ?? []).map((a) => a.document));
  }

  /** Vendors only ever see their own bid; the office sees all of them. */
  private async bidsFor(db: DbOrTx, ids: string[], onlyVendorId: string | null) {
    const out = new Map<string, contracts.Bid[]>();
    if (!ids.length) return out;
    const rows = await db.select({ b: bids, vendorName: vendors.name, vendorTrade: vendors.trade }).from(bids).innerJoin(vendors, eq(vendors.id, bids.vendorId)).where(and(inArray(bids.bidRequestId, ids), onlyVendorId ? eq(bids.vendorId, onlyVendorId) : sql`true`)).orderBy(asc(bids.amountCents), asc(bids.createdAt));
    for (const { b, vendorName, vendorTrade } of rows) { if (!out.has(b.bidRequestId)) out.set(b.bidRequestId, []); out.get(b.bidRequestId)!.push({ id: b.id, bidRequestId: b.bidRequestId, vendorId: b.vendorId, vendorName, vendorTrade, status: b.status as contracts.Bid['status'], amountCents: b.status === 'invited' ? null : b.amountCents, notes: b.notes, submittedAt: b.submittedAt, validUntil: b.validUntil }); }
    return out;
  }

  async create(ctx: RequestContext, projectId: string, input: any): Promise<contracts.BidRequest> {
    ctx.require('purchasing.write');
    const id = await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const [row] = await tx.insert(bidRequests).values({ organizationId: ctx.organizationId, projectId, title: input.title, scope: input.scope ?? '', costCodeId: input.costCodeId ?? null, dueDate: input.dueDate ?? null, status: 'draft', createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.setVendors(tx, ctx, row!, input.vendorIds ?? []);
      if (input.attachmentDocumentIds?.length) await this.documents.attach(tx, ctx, 'bid_request', row!.id, input.attachmentDocumentIds);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'created', objectType: 'purchase_order', objectId: row!.id, objectLabel: `bid request ${row!.title}` });
      return row!.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, input: any): Promise<contracts.BidRequest> {
    ctx.require('purchasing.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status === 'awarded' || row.status === 'closed') throw AppError.conflict('This bid request is closed.');
      const { vendorIds, attachmentDocumentIds, ...patch } = input;
      const [after] = await tx.update(bidRequests).set({ ...patch, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${bidRequests.version} + 1` } as any).where(eq(bidRequests.id, id)).returning();
      if (vendorIds) await this.setVendors(tx, ctx, after!, vendorIds);
      if (attachmentDocumentIds) { await this.documents.detachAll(tx, ctx, 'bid_request', id); await this.documents.attach(tx, ctx, 'bid_request', id, attachmentDocumentIds); }
      const diff = diffRecords(row as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'updated', objectType: 'purchase_order', objectId: id, objectLabel: `bid request ${after!.title}`, diff });
    });
    return this.get(ctx, id);
  }

  private async load(tx: DbOrTx, ctx: RequestContext, id: string): Promise<RequestRow> {
    const [row] = await tx.select().from(bidRequests).where(and(eq(bidRequests.id, id), eq(bidRequests.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Bid request');
    await ctx.requireProjectAccess(tx, row.projectId);
    return row;
  }

  /** Invited vendors: add new ones as 'invited', keep those with bids, drop the rest. */
  private async setVendors(tx: DbOrTx, ctx: RequestContext, row: RequestRow, vendorIds: string[]) {
    const wanted = [...new Set(vendorIds)];
    if (wanted.length) {
      const valid = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.organizationId, ctx.organizationId), inArray(vendors.id, wanted)));
      if (valid.length !== wanted.length) throw AppError.validation('One of the vendors was not found.');
    }
    const existing = await tx.select().from(bids).where(eq(bids.bidRequestId, row.id));
    const removable = existing.filter((b) => !wanted.includes(b.vendorId) && b.status === 'invited').map((b) => b.id);
    if (removable.length) await tx.delete(bids).where(inArray(bids.id, removable));
    const have = new Set(existing.map((b) => b.vendorId));
    const fresh = wanted.filter((v) => !have.has(v));
    if (fresh.length) await tx.insert(bids).values(fresh.map((vendorId) => ({ organizationId: ctx.organizationId, bidRequestId: row.id, vendorId, status: 'invited', amountCents: 0, notes: '', createdBy: ctx.userId, updatedBy: ctx.userId })));
    // Vendors invited to bid get project membership so they can see shared plans and message the team.
    for (const vendorId of fresh) await tx.insert(projectMembers).values({ organizationId: ctx.organizationId, projectId: row.projectId, vendorId, accessLevel: 'vendor', createdBy: ctx.userId }).onConflictDoNothing();
  }

  /** A vendor's portal user needs a project membership row of their own (the vendor row carries no user). */
  private async ensureVendorMember(tx: DbOrTx, ctx: RequestContext, projectId: string, vendorId: string, userId: string) {
    const [existing] = await tx.select({ id: projectMembers.id }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId))).limit(1);
    if (existing) return;
    const [vendorRow] = await tx.select({ id: projectMembers.id, userId: projectMembers.userId }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.vendorId, vendorId))).limit(1);
    if (vendorRow && !vendorRow.userId) await tx.update(projectMembers).set({ userId, updatedAt: sql`now()` }).where(eq(projectMembers.id, vendorRow.id));
    else await tx.insert(projectMembers).values({ organizationId: ctx.organizationId, projectId, userId, accessLevel: 'vendor', createdBy: ctx.userId }).onConflictDoNothing();
  }

  /** Open the request: vendors are notified (email + portal) and can submit bids until it is awarded. */
  async send(ctx: RequestContext, id: string): Promise<contracts.BidRequest> {
    ctx.require('purchasing.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status !== 'draft') throw AppError.conflict('This bid request has already been sent.');
      const invited = await tx.select({ b: bids, v: vendors }).from(bids).innerJoin(vendors, eq(vendors.id, bids.vendorId)).where(eq(bids.bidRequestId, id));
      if (!invited.length) throw AppError.conflict('Invite at least one vendor before sending.');
      await tx.update(bidRequests).set({ status: 'open', updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${bidRequests.version} + 1` }).where(eq(bidRequests.id, id));
      const [project] = await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, row.projectId)).limit(1);
      const portalUsers: string[] = [];
      for (const { v } of invited) {
        if (v.email) await this.deps.providers.email.send({ to: v.email, subject: `Bid request: ${row.title} (${project?.name ?? 'project'})`, text: `${ctx.actorName} invited ${v.name} to bid on "${row.title}".\n\n${row.scope}\n\n${row.dueDate ? `Bids are due ${row.dueDate}.\n\n` : ''}Submit your bid in the vendor portal: ${this.deps.config.APP_URL}` });
        if (v.portalUserId) portalUsers.push(v.portalUserId);
        // Make sure portal users of invited vendors can open the project.
        if (v.portalUserId) await this.ensureVendorMember(tx, ctx, row.projectId, v.id, v.portalUserId);
      }
      if (portalUsers.length) await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: portalUsers, kind: 'bid_request.new', title: `New bid request: ${row.title}`, body: `${project?.name ?? 'A project'} · ${row.dueDate ? `due ${row.dueDate}` : 'no due date'}`, projectId: row.projectId, objectType: 'purchase_order', objectId: id, link: `/bids/${id}` });
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'sent', objectType: 'purchase_order', objectId: id, objectLabel: `bid request ${row.title} to ${invited.length} vendor${invited.length === 1 ? '' : 's'}` });
    });
    return this.get(ctx, id);
  }

  /** A vendor submits (or revises) their bid from the portal; the office can also key in a bid received by email. */
  async submitBid(ctx: RequestContext, id: string, input: { vendorId?: string; amountCents: number; notes: string; validUntil?: string | null; attachmentDocumentIds?: string[] }): Promise<contracts.BidRequest> {
    const myVendor = isVendorPortal(ctx) ? await vendorIdFor(this.deps.db, ctx) : null;
    if (!myVendor) ctx.require('purchasing.write');
    const vendorId = myVendor ?? input.vendorId;
    if (!vendorId) throw AppError.validation('vendorId is required.');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(bidRequests).where(and(eq(bidRequests.id, id), eq(bidRequests.organizationId, ctx.organizationId))).limit(1);
      if (!row) throw AppError.notFound('Bid request');
      if (row.status !== 'open') throw AppError.conflict(row.status === 'draft' ? 'This bid request has not been sent yet.' : 'Bidding has closed for this request.');
      const [bid] = await tx.select().from(bids).where(and(eq(bids.bidRequestId, id), eq(bids.vendorId, vendorId))).limit(1);
      if (!bid) throw AppError.notFound('Bid');
      await tx.update(bids).set({ status: 'submitted', amountCents: input.amountCents, notes: input.notes, validUntil: input.validUntil ?? null, submittedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${bids.version} + 1` }).where(eq(bids.id, bid.id));
      if (input.attachmentDocumentIds?.length) await this.documents.attach(tx, ctx, 'bid', bid.id, input.attachmentDocumentIds);
      const [v] = await tx.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
      await this.activity.record(tx, myVendor ? { organizationId: ctx.organizationId, userId: ctx.userId, name: `${ctx.actorName} (${v?.name})`, kind: 'vendor' } : ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'submitted', objectType: 'purchase_order', objectId: id, objectLabel: `bid of ${(input.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} on ${row.title}` });
      const team = await projectTeamUserIds(tx, ctx.organizationId, row.projectId, 'purchasing.read');
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'bid_request.new', title: `Bid received: ${row.title}`, body: `${v?.name ?? 'A vendor'} bid ${(input.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`, projectId: row.projectId, objectType: 'purchase_order', objectId: id, link: `/projects/${row.projectId}/purchasing?tab=bids&bid=${id}` });
    });
    return this.get(ctx, id);
  }

  async declineBid(ctx: RequestContext, id: string): Promise<contracts.BidRequest> {
    const myVendor = isVendorPortal(ctx) ? await vendorIdFor(this.deps.db, ctx) : null;
    if (!myVendor) throw AppError.forbidden('Only the invited vendor can decline.');
    const [bid] = await this.deps.db.update(bids).set({ status: 'declined', updatedAt: sql`now()`, updatedBy: ctx.userId }).where(and(eq(bids.bidRequestId, id), eq(bids.vendorId, myVendor), inArray(bids.status, ['invited', 'submitted']))).returning();
    if (!bid) throw AppError.notFound('Bid');
    return this.get(ctx, id);
  }

  /** Award a bid: the others are marked not selected and a draft PO is created for the winner. */
  async award(ctx: RequestContext, id: string, input: { bidId: string; createPurchaseOrder: boolean }): Promise<contracts.BidRequest> {
    ctx.require('purchasing.write');
    type PoInput = { projectId: string; vendorId: string; title: string; amountCents: number; costCodeId: string | null; notes: string };
    const state: { po: PoInput | null } = { po: null };
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status !== 'open') throw AppError.conflict('Only open bid requests can be awarded.');
      const [bid] = await tx.select().from(bids).where(and(eq(bids.id, input.bidId), eq(bids.bidRequestId, id))).limit(1);
      if (!bid || bid.status !== 'submitted') throw AppError.conflict('Pick a submitted bid to award.');
      await tx.update(bids).set({ status: 'not_selected', updatedAt: sql`now()` }).where(and(eq(bids.bidRequestId, id), sql`${bids.id} <> ${bid.id}`, inArray(bids.status, ['invited', 'submitted'])));
      await tx.update(bids).set({ status: 'awarded', updatedAt: sql`now()`, updatedBy: ctx.userId }).where(eq(bids.id, bid.id));
      await tx.update(bidRequests).set({ status: 'awarded', awardedBidId: bid.id, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${bidRequests.version} + 1` }).where(eq(bidRequests.id, id));
      const [v] = await tx.select().from(vendors).where(eq(vendors.id, bid.vendorId)).limit(1);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'awarded', objectType: 'purchase_order', objectId: id, objectLabel: `bid request ${row.title} to ${v?.name ?? 'vendor'}`, metadata: { amountCents: bid.amountCents } });
      if (v?.portalUserId) await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: [v.portalUserId], kind: 'bid_request.new', title: `You won the bid: ${row.title}`, body: `${ctx.actorName} awarded your bid of ${(bid.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`, projectId: row.projectId, objectType: 'purchase_order', objectId: id, link: `/bids/${id}` });
      if (input.createPurchaseOrder) state.po = { projectId: row.projectId, vendorId: bid.vendorId, title: row.title, amountCents: bid.amountCents, costCodeId: row.costCodeId, notes: `From bid request "${row.title}"${bid.notes ? `\n\nVendor notes: ${bid.notes}` : ''}` };
    });
    if (state.po) {
      const p = state.po;
      await this.procurement.createPurchaseOrder(ctx, p.projectId, { vendorId: p.vendorId, title: p.title, notes: p.notes, lines: [{ description: p.title, costCodeId: p.costCodeId, quantityThousandths: 1000, unit: 'ea', unitCostCents: p.amountCents }] });
    }
    return this.get(ctx, id);
  }

  async close(ctx: RequestContext, id: string): Promise<contracts.BidRequest> {
    ctx.require('purchasing.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      await tx.update(bids).set({ status: 'not_selected', updatedAt: sql`now()` }).where(and(eq(bids.bidRequestId, id), inArray(bids.status, ['invited', 'submitted'])));
      await tx.update(bidRequests).set({ status: 'closed', updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${bidRequests.version} + 1` }).where(eq(bidRequests.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'closed', objectType: 'purchase_order', objectId: id, objectLabel: `bid request ${row.title}` });
    });
    return this.get(ctx, id);
  }

  /** What a subcontractor sees when they sign in: their POs, open bid requests, assigned tasks and shared projects. */
  async vendorOverview(ctx: RequestContext): Promise<contracts.VendorOverview> {
    const { db } = this.deps;
    const vendorId = await vendorIdFor(db, ctx);
    if (!vendorId) return { vendor: null, purchaseOrders: [], bidRequests: [], tasks: [], projects: [] };
    const [v] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    const pos = await db.select({ po: purchaseOrders, projectName: projects.name }).from(purchaseOrders).innerJoin(projects, eq(projects.id, purchaseOrders.projectId)).where(and(eq(purchaseOrders.vendorId, vendorId), inArray(purchaseOrders.status, ['committed', 'matched', 'closed']))).orderBy(desc(purchaseOrders.issuedAt)).limit(50);
    const acks = pos.length ? await db.select({ objectId: activityLog.objectId, at: activityLog.occurredAt }).from(activityLog).where(and(eq(activityLog.organizationId, ctx.organizationId), eq(activityLog.objectType, 'purchase_order'), eq(activityLog.verb, 'acknowledged'), inArray(activityLog.objectId, pos.map((p) => p.po.id)))) : [];
    const ackAt = new Map(acks.map((a) => [a.objectId!, a.at]));
    const reqs = await db.select({ r: bidRequests, projectName: projects.name, b: bids }).from(bids).innerJoin(bidRequests, eq(bidRequests.id, bids.bidRequestId)).innerJoin(projects, eq(projects.id, bidRequests.projectId)).where(and(eq(bids.vendorId, vendorId), sql`${bidRequests.status} <> 'draft'`, isNull(bidRequests.archivedAt))).orderBy(desc(bidRequests.createdAt)).limit(50);
    const myTasks = await db.select({ t: tasks, projectName: projects.name }).from(taskAssignees).innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(eq(taskAssignees.vendorId, vendorId), isNull(tasks.archivedAt), sql`${tasks.status} <> 'complete'`)).orderBy(asc(tasks.startDate)).limit(50);
    const visible = await ctx.visibleProjectIds(db);
    const projs = await db.select().from(projects).where(and(eq(projects.organizationId, ctx.organizationId), isNull(projects.archivedAt), visible ? (visible.length ? inArray(projects.id, visible) : sql`false`) : sql`true`)).orderBy(asc(projects.number));
    return {
      vendor: v ? { id: v.id, name: v.name, trade: v.trade } : null,
      purchaseOrders: pos.map(({ po, projectName }) => ({ id: po.id, number: po.number, title: po.title, status: po.status, projectId: po.projectId, projectName, totalCents: po.totalCents, billedCents: po.billedCents, issuedAt: po.issuedAt, acknowledgedAt: ackAt.get(po.id) ?? null })),
      bidRequests: reqs.map(({ r, projectName, b }) => ({ id: r.id, title: r.title, projectId: r.projectId, projectName, dueDate: r.dueDate, status: r.status, myBid: { id: b.id, bidRequestId: b.bidRequestId, vendorId: b.vendorId, vendorName: v?.name ?? '', vendorTrade: v?.trade ?? null, status: b.status as contracts.Bid['status'], amountCents: b.status === 'invited' ? null : b.amountCents, notes: b.notes, submittedAt: b.submittedAt, validUntil: b.validUntil } })),
      tasks: myTasks.map(({ t, projectName }) => ({ id: t.id, name: t.name, projectId: t.projectId, projectName, startDate: t.startDate, endDate: t.endDate, status: t.status })),
      projects: projs.map((p) => { const a = p.address as any; return { id: p.id, number: p.number, name: p.name, addressLine: [a?.line1, a?.city].filter(Boolean).join(', ') }; }),
    };
  }

  /** The vendor confirms they have received an issued PO. */
  async acknowledgePurchaseOrder(ctx: RequestContext, poId: string): Promise<{ ok: true }> {
    const vendorId = await vendorIdFor(this.deps.db, ctx);
    if (!vendorId) throw AppError.forbidden('Only the vendor on the purchase order can acknowledge it.');
    await this.deps.db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.organizationId, ctx.organizationId), eq(purchaseOrders.vendorId, vendorId))).limit(1);
      if (!po) throw AppError.notFound('Purchase order');
      const [v] = await tx.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
      await this.activity.record(tx, { organizationId: ctx.organizationId, userId: ctx.userId, name: `${ctx.actorName} (${v?.name})`, kind: 'vendor' }, { projectId: po.projectId, verb: 'acknowledged', objectType: 'purchase_order', objectId: po.id, objectLabel: `${po.number} ${po.title}` });
      const team = await projectTeamUserIds(tx, ctx.organizationId, po.projectId, 'purchasing.read');
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'system', title: `${po.number} acknowledged`, body: `${v?.name ?? 'The vendor'} confirmed receipt of ${po.title}.`, projectId: po.projectId, objectType: 'purchase_order', objectId: po.id, link: `/projects/${po.projectId}/purchasing?po=${po.id}` });
    });
    return { ok: true };
  }
}

export function serializeRequest(r: RequestRow, projectName: string | undefined, code: string | null, bidList: contracts.Bid[], attachments?: contracts.Document[]): contracts.BidRequest {
  const submitted = bidList.filter((b) => b.amountCents != null && ['submitted', 'awarded', 'not_selected'].includes(b.status));
  return { id: r.id, organizationId: r.organizationId, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy, updatedBy: r.updatedBy, version: r.version, projectId: r.projectId, projectName, title: r.title, scope: r.scope, costCodeId: r.costCodeId, costCode: code, dueDate: r.dueDate, status: r.status as contracts.BidRequest['status'], awardedBidId: r.awardedBidId, bids: bidList, attachments, lowestCents: submitted.length ? Math.min(...submitted.map((b) => b.amountCents!)) : null, submittedCount: submitted.length };
}

export type { documents };
