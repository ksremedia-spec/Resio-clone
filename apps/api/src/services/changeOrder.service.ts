import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { estimateCalc, sumCents, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { approvals, budgetLines, budgets, changeOrderLines, changeOrders, estimates, organizations, projects } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import type { DocumentService } from './document.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import { projectTeamUserIds } from '../lib/recipients.js';
import { contactIdFor, isClientPortal } from '../lib/portal.js';

type CoRow = typeof changeOrders.$inferSelect;
const CO_OPEN = ['draft', 'pending_internal', 'sent', 'viewed'] as const;
const EDITABLE = ['draft', 'pending_internal'] as const;
const CLIENT_VISIBLE = ['sent', 'viewed', 'approved', 'declined'] as const;

/**
 * Change orders price extra (or removed) work with the same cost/markup/tax
 * engine as the estimate. Once approved they raise the contract value and
 * land on the budget as approved changes; nothing is copied by hand.
 */
export class ChangeOrderService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService, private readonly documents: DocumentService) {}

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; status: string }) {
    ctx.require('change_orders.read');
    const { db } = this.deps;
    const conditions = [eq(changeOrders.organizationId, ctx.organizationId), isNull(changeOrders.archivedAt)];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(changeOrders.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? inArray(changeOrders.projectId, visible) : sql`false`); }
    if (ctx.membership.external) conditions.push(inArray(changeOrders.status, [...CLIENT_VISIBLE]));
    if (query.status === 'open') conditions.push(inArray(changeOrders.status, [...CO_OPEN]));
    else if (query.status !== 'all') conditions.push(eq(changeOrders.status, query.status));
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${changeOrders.createdAt}, ${changeOrders.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await db.select({ co: changeOrders, projectName: projects.name }).from(changeOrders).innerJoin(projects, eq(projects.id, changeOrders.projectId)).where(and(...conditions)).orderBy(desc(changeOrders.createdAt), desc(changeOrders.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.co.createdAt, id: r.co.id }));
    const ids = result.items.map((r) => r.co.id);
    const [lines, apps] = await Promise.all([this.linesFor(db, ids), this.approvalsFor(db, ids)]);
    return { items: result.items.map((r) => serializeCo(r.co, r.projectName, lines.get(r.co.id) ?? [], apps.get(r.co.id) ?? [])), nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.ChangeOrder> {
    ctx.require('change_orders.read');
    const { db } = this.deps;
    const [r] = await db.select({ co: changeOrders, projectName: projects.name }).from(changeOrders).innerJoin(projects, eq(projects.id, changeOrders.projectId)).where(and(eq(changeOrders.id, id), eq(changeOrders.organizationId, ctx.organizationId))).limit(1);
    if (!r) throw AppError.notFound('Change order');
    await ctx.requireProjectAccess(db, r.co.projectId, { allowArchived: true });
    if (ctx.membership.external && !CLIENT_VISIBLE.includes(r.co.status as any)) throw AppError.notFound('Change order');
    if (isClientPortal(ctx) && r.co.status === 'sent') {
      await db.transaction(async (tx) => {
        await tx.update(changeOrders).set({ status: 'viewed', viewedAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(changeOrders.id, id), eq(changeOrders.status, 'sent')));
        await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: r.co.projectId, verb: 'viewed', objectType: 'change_order', objectId: id, objectLabel: `#${r.co.number} ${r.co.title}`, clientVisible: true });
      });
      r.co.status = 'viewed';
    }
    const [lines, apps, attachments] = await Promise.all([this.linesFor(db, [id]), this.approvalsFor(db, [id]), this.documents.attachmentsFor(db, ctx, 'change_order', [id])]);
    return serializeCo(r.co, r.projectName, lines.get(id) ?? [], apps.get(id) ?? [], (attachments.get(id) ?? []).map((a) => a.document));
  }

  private async linesFor(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.ChangeOrder['lines']>();
    if (!ids.length) return out;
    const rows = await db.select({ l: changeOrderLines, budgetLineName: budgetLines.name }).from(changeOrderLines).leftJoin(budgetLines, eq(budgetLines.id, changeOrderLines.budgetLineId)).where(inArray(changeOrderLines.changeOrderId, ids)).orderBy(asc(changeOrderLines.sortOrder), asc(changeOrderLines.createdAt));
    for (const { l, budgetLineName } of rows) {
      if (!out.has(l.changeOrderId)) out.set(l.changeOrderId, []);
      out.get(l.changeOrderId)!.push({ id: l.id, budgetLineId: l.budgetLineId, budgetLineName, costCodeId: l.costCodeId, estimateLineId: l.estimateLineId, name: l.name, description: l.description, quantityThousandths: l.quantityThousandths, unit: l.unit, unitCostCents: l.unitCostCents as any, markupBp: (l.markupBp as any) ?? null, taxable: l.taxable, costCents: l.costCents, sellCents: l.sellCents, sortOrder: l.sortOrder });
    }
    return out;
  }

  async approvalsFor(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.Approval[]>();
    if (!ids.length) return out;
    const rows = await db.select().from(approvals).where(and(eq(approvals.objectType, 'change_order'), inArray(approvals.objectId, ids))).orderBy(desc(approvals.requestedAt));
    for (const a of rows) {
      if (!out.has(a.objectId)) out.set(a.objectId, []);
      out.get(a.objectId)!.push({ id: a.id, objectType: a.objectType, objectId: a.objectId, status: a.status as contracts.Approval['status'], requestedAt: a.requestedAt, decidedAt: a.decidedAt, decidedByName: a.decidedByName, decisionNote: a.decisionNote, amountCents: a.amountCents, title: a.title });
    }
    return out;
  }

  async create(ctx: RequestContext, projectId: string, input: any): Promise<contracts.ChangeOrder> {
    ctx.require('change_orders.write');
    return this.createInternal(ctx, projectId, input);
  }

  /** Create without the permission gate: selections draft an overage change order on the client's behalf. */
  async createInternal(ctx: RequestContext, projectId: string, input: any): Promise<contracts.ChangeOrder> {
    const id = await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const [mx] = await tx.select({ max: sql<number>`coalesce(max(${changeOrders.number}), 0)::int` }).from(changeOrders).where(eq(changeOrders.projectId, projectId));
      const [co] = await tx.insert(changeOrders).values({ organizationId: ctx.organizationId, projectId, number: (mx?.max ?? 0) + 1, title: input.title, description: input.description ?? '', reason: input.reason ?? null, status: 'draft', scheduleImpactDays: input.scheduleImpactDays ?? 0, costCents: 0, markupCents: 0, taxCents: 0, totalCents: 0, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.replaceLines(tx, ctx, co!, input.lines ?? []);
      if (input.attachmentDocumentIds?.length) await this.documents.attach(tx, ctx, 'change_order', co!.id, input.attachmentDocumentIds);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'created', objectType: 'change_order', objectId: co!.id, objectLabel: `#${co!.number} ${co!.title}` });
      return co!.id;
    });
    return this.getInternal(id);
  }

  private async getInternal(id: string): Promise<contracts.ChangeOrder> {
    const { db } = this.deps;
    const [r] = await db.select({ co: changeOrders, projectName: projects.name }).from(changeOrders).innerJoin(projects, eq(projects.id, changeOrders.projectId)).where(eq(changeOrders.id, id)).limit(1);
    const [lines, apps] = await Promise.all([this.linesFor(db, [id]), this.approvalsFor(db, [id])]);
    return serializeCo(r!.co, r!.projectName, lines.get(id) ?? [], apps.get(id) ?? []);
  }

  async update(ctx: RequestContext, id: string, input: any): Promise<contracts.ChangeOrder> {
    ctx.require('change_orders.write');
    await this.deps.db.transaction(async (tx) => {
      const co = await this.editable(tx, ctx, id);
      const { lines, attachmentDocumentIds, ...patch } = input;
      const [after] = await tx.update(changeOrders).set({ ...patch, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${changeOrders.version} + 1` } as any).where(eq(changeOrders.id, id)).returning();
      if (lines) await this.replaceLines(tx, ctx, after!, lines);
      if (attachmentDocumentIds) { await this.documents.detachAll(tx, ctx, 'change_order', id); await this.documents.attach(tx, ctx, 'change_order', id, attachmentDocumentIds); }
      const diff = diffRecords(co as any, after as any, ['updatedAt', 'updatedBy', 'version', 'costCents', 'markupCents', 'taxCents', 'totalCents']);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: co.projectId, verb: 'updated', objectType: 'change_order', objectId: id, objectLabel: `#${co.number} ${after!.title}`, diff: diff ?? (lines ? { lines: { from: null, to: `${lines.length} lines` } } : null) });
    });
    return this.get(ctx, id);
  }

  private async editable(tx: DbOrTx, ctx: RequestContext, id: string): Promise<CoRow> {
    const [co] = await tx.select().from(changeOrders).where(and(eq(changeOrders.id, id), eq(changeOrders.organizationId, ctx.organizationId))).limit(1);
    if (!co) throw AppError.notFound('Change order');
    await ctx.requireProjectAccess(tx, co.projectId);
    if (!EDITABLE.includes(co.status as any)) throw AppError.conflict(`A ${co.status.replace('_', ' ')} change order cannot be edited.`);
    return co;
  }

  /** Price every line with the project's estimate settings (falling back to the company defaults). */
  private async replaceLines(tx: DbOrTx, ctx: RequestContext, co: CoRow, lines: any[]) {
    const [est] = await tx.select({ defaultMarkupBp: estimates.defaultMarkupBp, markupByCostType: estimates.markupByCostType, taxBp: estimates.taxBp }).from(estimates).where(and(eq(estimates.projectId, co.projectId), isNull(estimates.archivedAt))).orderBy(asc(estimates.createdAt)).limit(1);
    const [org] = await tx.select({ defaultMarkupBp: organizations.defaultMarkupBp, defaultTaxBp: organizations.defaultTaxBp }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
    const defaultMarkupBp = est?.defaultMarkupBp ?? org!.defaultMarkupBp;
    const taxBp = est?.taxBp ?? org!.defaultTaxBp;
    const markupByType = (est?.markupByCostType ?? {}) as Partial<Record<estimateCalc.CostType, number>>;
    const wanted = [...new Set(lines.map((l) => l.budgetLineId).filter(Boolean))] as string[];
    if (wanted.length) {
      const rows = await tx.select({ id: budgetLines.id }).from(budgetLines).where(and(eq(budgetLines.projectId, co.projectId), inArray(budgetLines.id, wanted)));
      if (rows.length !== wanted.length) throw AppError.validation('One of the budget lines does not belong to this project.');
    }
    const existing = await tx.select().from(changeOrderLines).where(eq(changeOrderLines.changeOrderId, co.id));
    const keep = new Set(lines.map((l) => l.id).filter(Boolean));
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (removed.length) await tx.delete(changeOrderLines).where(inArray(changeOrderLines.id, removed));
    const totals: estimateCalc.LineItemTotals[] = [];
    for (const [i, l] of lines.entries()) {
      const t = estimateCalc.calculateLineItem({ quantityThousandths: l.quantityThousandths ?? 1000, unitCostCents: l.unitCostCents ?? {}, markupBp: { ...markupByType, ...(l.markupBp ?? {}) }, defaultMarkupBp, taxBp: l.taxable ? taxBp : 0 });
      totals.push(t);
      const values = { budgetLineId: l.budgetLineId ?? null, costCodeId: l.costCodeId ?? null, estimateLineId: l.estimateLineId ?? null, name: l.name, description: l.description ?? '', quantityThousandths: l.quantityThousandths ?? 1000, unit: l.unit ?? 'ea', unitCostCents: l.unitCostCents ?? {}, markupBp: l.markupBp ?? null, taxable: !!l.taxable, costCents: t.directCostCents, sellCents: t.sellCents, sortOrder: i, updatedAt: sql`now()`, updatedBy: ctx.userId };
      if (l.id && existing.some((e) => e.id === l.id)) await tx.update(changeOrderLines).set(values).where(eq(changeOrderLines.id, l.id));
      else await tx.insert(changeOrderLines).values({ organizationId: ctx.organizationId, changeOrderId: co.id, ...values, createdBy: ctx.userId });
    }
    await tx.update(changeOrders).set({ costCents: sumCents(totals.map((t) => t.directCostCents)), markupCents: sumCents(totals.map((t) => t.markupCents)), taxCents: sumCents(totals.map((t) => t.taxCents)), totalCents: sumCents(totals.map((t) => t.sellCents)) }).where(eq(changeOrders.id, co.id));
  }

  /** Send to the client for a decision: opens a pending approval and notifies the project team. */
  async send(ctx: RequestContext, id: string, input: { message?: string }): Promise<contracts.ChangeOrder> {
    ctx.require('change_orders.write');
    await this.deps.db.transaction(async (tx) => {
      const [co] = await tx.select().from(changeOrders).where(and(eq(changeOrders.id, id), eq(changeOrders.organizationId, ctx.organizationId))).limit(1);
      if (!co) throw AppError.notFound('Change order');
      await ctx.requireProjectAccess(tx, co.projectId);
      if (!EDITABLE.includes(co.status as any)) throw AppError.conflict(`A ${co.status.replace('_', ' ')} change order cannot be sent.`);
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(changeOrderLines).where(eq(changeOrderLines.changeOrderId, id));
      if (!n?.n) throw AppError.conflict('Add at least one line before sending a change order.');
      await tx.update(approvals).set({ status: 'cancelled' }).where(and(eq(approvals.objectType, 'change_order'), eq(approvals.objectId, id), eq(approvals.status, 'pending')));
      await tx.insert(approvals).values({ organizationId: ctx.organizationId, projectId: co.projectId, objectType: 'change_order', objectId: id, requestedBy: ctx.userId, status: 'pending', amountCents: co.totalCents, title: `CO #${co.number} ${co.title}`, snapshot: { totalCents: co.totalCents, message: input.message ?? null } });
      await tx.update(changeOrders).set({ status: 'sent', sentAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${changeOrders.version} + 1` }).where(eq(changeOrders.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: co.projectId, verb: 'sent', objectType: 'change_order', objectId: id, objectLabel: `#${co.number} ${co.title}`, clientVisible: true, metadata: { totalCents: co.totalCents } });
      const team = await projectTeamUserIds(tx, ctx.organizationId, co.projectId);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'approval.requested', title: `Change order #${co.number} sent to the client`, body: `${ctx.actorName} sent "${co.title}" for approval.`, projectId: co.projectId, objectType: 'change_order', objectId: id, link: `/projects/${co.projectId}/change-orders/${id}` });
    });
    return this.get(ctx, id);
  }

  /** Record the client's decision (or an internal decision on their behalf, e.g. a signed paper copy). */
  async decide(ctx: RequestContext, id: string, input: { decision: 'approved' | 'declined'; decidedByName?: string; note?: string; signatureDocumentId?: string }): Promise<contracts.ChangeOrder> {
    const portal = isClientPortal(ctx);
    if (!portal) ctx.require('change_orders.write');
    await this.deps.db.transaction(async (tx) => {
      const [co] = await tx.select().from(changeOrders).where(and(eq(changeOrders.id, id), eq(changeOrders.organizationId, ctx.organizationId))).limit(1);
      if (!co) throw AppError.notFound('Change order');
      await ctx.requireProjectAccess(tx, co.projectId);
      if (portal && !CLIENT_VISIBLE.includes(co.status as any)) throw AppError.notFound('Change order');
      const allowed = portal ? ['sent', 'viewed'] : ['sent', 'viewed', 'draft', 'pending_internal'];
      if (!allowed.includes(co.status)) throw AppError.conflict(`A ${co.status} change order cannot be decided again.`);
      const decidedByName = portal ? ctx.actorName : (input.decidedByName ?? ctx.actorName);
      const contactId = await contactIdFor(tx, ctx);
      input = { ...input, decidedByName };
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(changeOrderLines).where(eq(changeOrderLines.changeOrderId, id));
      if (!n?.n) throw AppError.conflict('Add at least one line before approving a change order.');
      let [approval] = await tx.select().from(approvals).where(and(eq(approvals.objectType, 'change_order'), eq(approvals.objectId, id), eq(approvals.status, 'pending'))).limit(1);
      if (!approval) [approval] = await tx.insert(approvals).values({ organizationId: ctx.organizationId, projectId: co.projectId, objectType: 'change_order', objectId: id, requestedBy: ctx.userId, status: 'pending', amountCents: co.totalCents, title: `CO #${co.number} ${co.title}` }).returning();
      await tx.update(approvals).set({ status: input.decision, decidedByUserId: ctx.userId, decidedByContactId: contactId, decidedByName: input.decidedByName, decidedAt: sql`now()`, decisionNote: input.note ?? null, signatureDocumentId: input.signatureDocumentId ?? null, ipAddress: ctx.meta.ip ?? null, userAgent: ctx.meta.userAgent ?? null, snapshot: { totalCents: co.totalCents, costCents: co.costCents } }).where(eq(approvals.id, approval!.id));
      await tx.update(changeOrders).set({ status: input.decision, decidedAt: sql`now()`, decisionApprovalId: approval!.id, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${changeOrders.version} + 1` }).where(eq(changeOrders.id, id));
      const [project] = await tx.select().from(projects).where(eq(projects.id, co.projectId)).limit(1);
      if (input.decision === 'approved') {
        await this.landOnBudget(tx, ctx, co);
        await tx.update(projects).set({ updatedAt: sql`now()`, updatedBy: ctx.userId }).where(eq(projects.id, co.projectId));
      }
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: co.projectId, verb: input.decision, objectType: 'change_order', objectId: id, objectLabel: `#${co.number} ${co.title}`, clientVisible: true, metadata: { totalCents: co.totalCents, decidedByName: input.decidedByName, note: input.note ?? null } });
      const team = await projectTeamUserIds(tx, ctx.organizationId, co.projectId);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: input.decision === 'approved' ? 'change_order.approved' : 'change_order.declined', title: `Change order #${co.number} ${input.decision}`, body: `${input.decidedByName} ${input.decision} "${co.title}" on ${project?.name ?? 'the project'}.`, projectId: co.projectId, objectType: 'change_order', objectId: id, link: `/projects/${co.projectId}/change-orders/${id}` });
    });
    return this.get(ctx, id);
  }

  /** Every approved CO line must be attached to a budget line so job costing sees it; create lines for the ones that are not. */
  private async landOnBudget(tx: DbOrTx, ctx: RequestContext, co: CoRow) {
    const lines = await tx.select().from(changeOrderLines).where(and(eq(changeOrderLines.changeOrderId, co.id), isNull(changeOrderLines.budgetLineId)));
    if (!lines.length) return;
    let [budget] = await tx.select().from(budgets).where(eq(budgets.projectId, co.projectId)).limit(1);
    if (!budget) [budget] = await tx.insert(budgets).values({ organizationId: ctx.organizationId, projectId: co.projectId, status: 'active', totals: {}, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    const [mx] = await tx.select({ max: sql<number>`coalesce(max(${budgetLines.sortOrder}), -1)::int` }).from(budgetLines).where(eq(budgetLines.budgetId, budget!.id));
    let sort = (mx?.max ?? -1) + 1;
    for (const l of lines) {
      const [bl] = await tx.insert(budgetLines).values({ organizationId: ctx.organizationId, budgetId: budget!.id, projectId: co.projectId, costCodeId: l.costCodeId, estimateLineId: l.estimateLineId, sectionName: `Change order #${co.number}`, name: l.name, originalCostCents: 0, originalSellCents: 0, sortOrder: sort++, clientVisible: false, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await tx.update(changeOrderLines).set({ budgetLineId: bl!.id }).where(eq(changeOrderLines.id, l.id));
    }
  }

  async void(ctx: RequestContext, id: string): Promise<contracts.ChangeOrder> {
    ctx.require('change_orders.write');
    await this.deps.db.transaction(async (tx) => {
      const [co] = await tx.select().from(changeOrders).where(and(eq(changeOrders.id, id), eq(changeOrders.organizationId, ctx.organizationId))).limit(1);
      if (!co) throw AppError.notFound('Change order');
      await ctx.requireProjectAccess(tx, co.projectId);
      if (co.status === 'approved') throw AppError.conflict('An approved change order cannot be voided. Create a reversing change order instead.');
      if (co.status === 'void') throw AppError.conflict('This change order is already void.');
      await tx.update(approvals).set({ status: 'cancelled' }).where(and(eq(approvals.objectType, 'change_order'), eq(approvals.objectId, id), eq(approvals.status, 'pending')));
      await tx.update(changeOrders).set({ status: 'void', updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${changeOrders.version} + 1` }).where(eq(changeOrders.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: co.projectId, verb: 'voided', objectType: 'change_order', objectId: id, objectLabel: `#${co.number} ${co.title}` });
    });
    return this.get(ctx, id);
  }
}

export function serializeCo(co: CoRow, projectName: string | undefined, lines: contracts.ChangeOrder['lines'], approvalRows: contracts.Approval[], attachments?: contracts.Document[]): contracts.ChangeOrder {
  return { id: co.id, organizationId: co.organizationId, createdAt: co.createdAt, updatedAt: co.updatedAt, createdBy: co.createdBy, updatedBy: co.updatedBy, version: co.version, projectId: co.projectId, projectName, number: co.number, title: co.title, description: co.description, reason: co.reason, status: co.status as contracts.ChangeOrder['status'], costCents: co.costCents, markupCents: co.markupCents, taxCents: co.taxCents, totalCents: co.totalCents, scheduleImpactDays: co.scheduleImpactDays, sentAt: co.sentAt, viewedAt: co.viewedAt, decidedAt: co.decidedAt, lines, approvals: approvalRows, attachments, invoiceId: co.invoiceId };
}
