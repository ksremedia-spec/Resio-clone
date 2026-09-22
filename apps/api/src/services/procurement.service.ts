import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { mulQuantity, sumCents, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { billLines, bills, budgetLines, payments, projects, purchaseOrderLines, purchaseOrders, vendors } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import type { DocumentService } from './document.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import { nextNumber } from '../lib/numbering.js';
import { usersWithPermission } from '../lib/recipients.js';
import { vendorIdFor } from '../lib/portal.js';

type PoRow = typeof purchaseOrders.$inferSelect;
type BillRow = typeof bills.$inferSelect;

const PO_OPEN = ['draft', 'awaiting_approval', 'approved', 'committed', 'matched'] as const;
const PO_COMMITS = ['approved', 'committed', 'matched'] as const;
const BILL_OPEN = ['draft', 'approved', 'scheduled'] as const;
const BILL_COUNTS = ['approved', 'scheduled', 'paid'] as const;

/**
 * Purchasing: purchase orders commit money against budget lines, bills turn
 * commitments into actual cost, and every bill can be matched back to its PO
 * so over-billing is caught before it is approved.
 */
export class ProcurementService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService, private readonly documents: DocumentService) {}

  // ---------- purchase orders ----------

  async listPurchaseOrders(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; vendorId?: string; status: string; q?: string }) {
    ctx.require('purchasing.read');
    const { db } = this.deps;
    const conditions = [eq(purchaseOrders.organizationId, ctx.organizationId), isNull(purchaseOrders.archivedAt)];
    if (ctx.membership.external) { const mine = await vendorIdFor(db, ctx); conditions.push(mine ? eq(purchaseOrders.vendorId, mine) : sql`false`, inArray(purchaseOrders.status, ['committed', 'matched', 'closed'])); }
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(purchaseOrders.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? inArray(purchaseOrders.projectId, visible) : sql`false`); }
    if (query.vendorId) conditions.push(eq(purchaseOrders.vendorId, query.vendorId));
    if (query.status === 'open') conditions.push(inArray(purchaseOrders.status, [...PO_OPEN]));
    else if (query.status !== 'all') conditions.push(eq(purchaseOrders.status, query.status));
    if (query.q) conditions.push(or(ilike(purchaseOrders.title, `%${query.q}%`), ilike(purchaseOrders.number, `%${query.q}%`), ilike(vendors.name, `%${query.q}%`))!);
    const cursor = decodeCursor<{ k: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${purchaseOrders.number}, ${purchaseOrders.id}) < (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select({ po: purchaseOrders, vendorName: vendors.name, projectName: projects.name }).from(purchaseOrders).leftJoin(vendors, eq(vendors.id, purchaseOrders.vendorId)).innerJoin(projects, eq(projects.id, purchaseOrders.projectId)).where(and(...conditions)).orderBy(desc(purchaseOrders.number), desc(purchaseOrders.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: r.po.number, id: r.po.id }));
    const lines = await this.poLines(db, result.items.map((r) => r.po.id));
    return { items: result.items.map((r) => serializePo(r.po, r.vendorName, r.projectName, lines.get(r.po.id) ?? [])), nextCursor: result.nextCursor };
  }

  async getPurchaseOrder(ctx: RequestContext, id: string): Promise<contracts.PurchaseOrder> {
    ctx.require('purchasing.read');
    return this.loadPo(this.deps.db, ctx, id);
  }

  private async loadPo(db: DbOrTx, ctx: RequestContext, id: string): Promise<contracts.PurchaseOrder> {
    const [r] = await db.select({ po: purchaseOrders, vendorName: vendors.name, projectName: projects.name }).from(purchaseOrders).leftJoin(vendors, eq(vendors.id, purchaseOrders.vendorId)).innerJoin(projects, eq(projects.id, purchaseOrders.projectId)).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
    if (!r) throw AppError.notFound('Purchase order');
    await ctx.requireProjectAccess(db, r.po.projectId, { allowArchived: true });
    if (ctx.membership.external) { const mine = await vendorIdFor(db, ctx); if (!mine || r.po.vendorId !== mine || !['committed', 'matched', 'closed'].includes(r.po.status)) throw AppError.notFound('Purchase order'); }
    const lines = await this.poLines(db, [id]);
    const attachments = await this.documents.attachmentsFor(db, ctx, 'purchase_order', [id]);
    return serializePo(r.po, r.vendorName, r.projectName, lines.get(id) ?? [], (attachments.get(id) ?? []).map((a) => a.document));
  }

  private async poLines(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.PurchaseOrder['lines']>();
    if (!ids.length) return out;
    const rows = await db.select({ l: purchaseOrderLines, budgetLineName: budgetLines.name }).from(purchaseOrderLines).leftJoin(budgetLines, eq(budgetLines.id, purchaseOrderLines.budgetLineId)).where(inArray(purchaseOrderLines.purchaseOrderId, ids)).orderBy(asc(purchaseOrderLines.sortOrder), asc(purchaseOrderLines.createdAt));
    for (const { l, budgetLineName } of rows) {
      if (!out.has(l.purchaseOrderId)) out.set(l.purchaseOrderId, []);
      out.get(l.purchaseOrderId)!.push({ id: l.id, budgetLineId: l.budgetLineId, budgetLineName, costCodeId: l.costCodeId, description: l.description, quantityThousandths: l.quantityThousandths, unit: l.unit, unitCostCents: l.unitCostCents, amountCents: l.amountCents, billedCents: l.billedCents, sortOrder: l.sortOrder });
    }
    return out;
  }

  async createPurchaseOrder(ctx: RequestContext, projectId: string, input: any): Promise<contracts.PurchaseOrder> {
    ctx.require('purchasing.write');
    const id = await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      await this.assertVendor(tx, ctx, input.vendorId);
      const number = await nextNumber(tx, purchaseOrders, ctx.organizationId, 'PO');
      const [po] = await tx.insert(purchaseOrders).values({ organizationId: ctx.organizationId, projectId, vendorId: input.vendorId ?? null, number, title: input.title, notes: input.notes ?? '', status: 'draft', totalCents: 0, billedCents: 0, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.replacePoLines(tx, ctx, po!, input.lines ?? []);
      if (input.attachmentDocumentIds?.length) await this.documents.attach(tx, ctx, 'purchase_order', po!.id, input.attachmentDocumentIds);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'created', objectType: 'purchase_order', objectId: po!.id, objectLabel: `${number} ${input.title}` });
      return po!.id;
    });
    return this.getPurchaseOrder(ctx, id);
  }

  async updatePurchaseOrder(ctx: RequestContext, id: string, input: any): Promise<contracts.PurchaseOrder> {
    ctx.require('purchasing.write');
    await this.deps.db.transaction(async (tx) => {
      const po = await this.editablePo(tx, ctx, id);
      const { lines, attachmentDocumentIds, ...patch } = input;
      if (patch.vendorId !== undefined) await this.assertVendor(tx, ctx, patch.vendorId);
      const [after] = await tx.update(purchaseOrders).set({ ...patch, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${purchaseOrders.version} + 1` } as any).where(eq(purchaseOrders.id, id)).returning();
      if (lines) await this.replacePoLines(tx, ctx, after!, lines);
      if (attachmentDocumentIds) { await this.documents.detachAll(tx, ctx, 'purchase_order', id); await this.documents.attach(tx, ctx, 'purchase_order', id, attachmentDocumentIds); }
      const diff = diffRecords(po as any, after as any, ['updatedAt', 'updatedBy', 'version', 'totalCents']);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: po.projectId, verb: 'updated', objectType: 'purchase_order', objectId: id, objectLabel: po.number, diff: diff ?? (lines ? { lines: { from: null, to: `${lines.length} lines` } } : null) });
    });
    return this.getPurchaseOrder(ctx, id);
  }

  /** Move a PO through its life: draft → awaiting_approval → approved → committed (issued to the vendor) → matched/closed. */
  async transitionPurchaseOrder(ctx: RequestContext, id: string, action: 'submit' | 'approve' | 'issue' | 'close' | 'void' | 'reopen'): Promise<contracts.PurchaseOrder> {
    ctx.require('purchasing.write');
    await this.deps.db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
      if (!po) throw AppError.notFound('Purchase order');
      await ctx.requireProjectAccess(tx, po.projectId);
      const rules: Record<string, { from: string[]; to: string; patch?: Record<string, unknown>; verb: string }> = {
        submit: { from: ['draft'], to: 'awaiting_approval', verb: 'submitted' },
        approve: { from: ['draft', 'awaiting_approval'], to: 'approved', patch: { approvedBy: ctx.userId, approvedAt: sql`now()` }, verb: 'approved' },
        issue: { from: ['approved'], to: 'committed', patch: { issuedAt: sql`now()` }, verb: 'issued' },
        close: { from: ['committed', 'matched'], to: 'closed', patch: { closedAt: sql`now()` }, verb: 'closed' },
        void: { from: ['draft', 'awaiting_approval', 'approved', 'committed', 'matched'], to: 'void', patch: { closedAt: sql`now()` }, verb: 'voided' },
        reopen: { from: ['closed', 'void'], to: po.issuedAt ? 'committed' : 'draft', patch: { closedAt: null }, verb: 'reopened' },
      };
      const rule = rules[action]!;
      if (!rule.from.includes(po.status)) throw AppError.conflict(`A ${po.status.replace('_', ' ')} purchase order cannot be ${rule.verb}.`);
      if (action === 'approve' || action === 'issue') {
        const n = await tx.select({ n: sql<number>`count(*)::int` }).from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
        if (!n[0]?.n) throw AppError.conflict('Add at least one line before approving a purchase order.');
      }
      if (action === 'void') {
        const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(bills).where(and(eq(bills.purchaseOrderId, id), inArray(bills.status, [...BILL_COUNTS])));
        if (open?.n) throw AppError.conflict('This purchase order has approved bills against it. Void those bills first.');
      }
      await tx.update(purchaseOrders).set({ status: rule.to, ...(rule.patch ?? {}), updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${purchaseOrders.version} + 1` } as any).where(eq(purchaseOrders.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: po.projectId, verb: rule.verb, objectType: 'purchase_order', objectId: id, objectLabel: `${po.number} ${po.title}`, metadata: { totalCents: po.totalCents } });
      if (action === 'submit') {
        const ids = await usersWithPermission(tx, ctx.organizationId, 'purchasing.write');
        await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: ids, excludeUserId: ctx.userId, kind: 'approval.requested', title: `${po.number} needs approval`, body: `${ctx.actorName} submitted ${po.title} for approval.`, projectId: po.projectId, objectType: 'purchase_order', objectId: id, link: `/projects/${po.projectId}/purchasing?po=${id}` });
      }
    });
    return this.getPurchaseOrder(ctx, id);
  }

  private async editablePo(tx: DbOrTx, ctx: RequestContext, id: string): Promise<PoRow> {
    const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
    if (!po) throw AppError.notFound('Purchase order');
    await ctx.requireProjectAccess(tx, po.projectId);
    if (!['draft', 'awaiting_approval'].includes(po.status)) throw AppError.conflict('Only draft purchase orders can be edited. Void it and create a new one instead.');
    return po;
  }

  private async assertVendor(tx: DbOrTx, ctx: RequestContext, vendorId: string | null | undefined) {
    if (!vendorId) return;
    const [v] = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, ctx.organizationId))).limit(1);
    if (!v) throw AppError.notFound('Vendor');
  }

  private async assertBudgetLines(tx: DbOrTx, projectId: string, ids: Array<string | null | undefined>) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return;
    const rows = await tx.select({ id: budgetLines.id }).from(budgetLines).where(and(eq(budgetLines.projectId, projectId), inArray(budgetLines.id, wanted)));
    if (rows.length !== wanted.length) throw AppError.validation('One of the budget lines does not belong to this project.');
  }

  /** Replace the PO's lines with the given list (ids are kept where supplied so billing links survive edits). */
  private async replacePoLines(tx: DbOrTx, ctx: RequestContext, po: PoRow, lines: any[]) {
    await this.assertBudgetLines(tx, po.projectId, lines.map((l) => l.budgetLineId));
    const existing = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    const keep = new Set(lines.map((l) => l.id).filter(Boolean));
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (removed.length) await tx.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.id, removed));
    let total = 0;
    for (const [i, l] of lines.entries()) {
      const amountCents = mulQuantity(l.unitCostCents ?? 0, l.quantityThousandths ?? 1000);
      total += amountCents;
      const values = { budgetLineId: l.budgetLineId ?? null, costCodeId: l.costCodeId ?? null, description: l.description, quantityThousandths: l.quantityThousandths ?? 1000, unit: l.unit ?? 'ea', unitCostCents: l.unitCostCents ?? 0, amountCents, sortOrder: i, updatedAt: sql`now()`, updatedBy: ctx.userId };
      if (l.id && existing.some((e) => e.id === l.id)) await tx.update(purchaseOrderLines).set(values).where(eq(purchaseOrderLines.id, l.id));
      else await tx.insert(purchaseOrderLines).values({ organizationId: ctx.organizationId, purchaseOrderId: po.id, ...values, billedCents: 0, createdBy: ctx.userId });
    }
    await tx.update(purchaseOrders).set({ totalCents: total }).where(eq(purchaseOrders.id, po.id));
  }

  // ---------- bills ----------

  async listBills(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; vendorId?: string; status: string; q?: string }) {
    ctx.require('bills.read');
    const { db } = this.deps;
    const conditions = [eq(bills.organizationId, ctx.organizationId), isNull(bills.archivedAt)];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(bills.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? sql`(${bills.projectId} is null or ${inArray(bills.projectId, visible)})` : sql`${bills.projectId} is null`); }
    if (query.vendorId) conditions.push(eq(bills.vendorId, query.vendorId));
    if (query.status === 'open') conditions.push(inArray(bills.status, [...BILL_OPEN]));
    else if (query.status === 'unmatched') conditions.push(and(isNull(bills.purchaseOrderId), inArray(bills.status, [...BILL_OPEN]))!);
    else if (query.status !== 'all') conditions.push(eq(bills.status, query.status));
    if (query.q) conditions.push(or(ilike(bills.number, `%${query.q}%`), ilike(bills.vendorReference, `%${query.q}%`), ilike(vendors.name, `%${query.q}%`))!);
    const cursor = decodeCursor<{ k: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${bills.number}, ${bills.id}) < (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select({ b: bills, vendorName: vendors.name, projectName: projects.name, poNumber: purchaseOrders.number, poTotal: purchaseOrders.totalCents, poBilled: purchaseOrders.billedCents }).from(bills).leftJoin(vendors, eq(vendors.id, bills.vendorId)).leftJoin(projects, eq(projects.id, bills.projectId)).leftJoin(purchaseOrders, eq(purchaseOrders.id, bills.purchaseOrderId)).where(and(...conditions)).orderBy(desc(bills.number), desc(bills.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: r.b.number, id: r.b.id }));
    const lines = await this.billLines(db, result.items.map((r) => r.b.id));
    return { items: result.items.map((r) => serializeBill(r.b, r, lines.get(r.b.id) ?? [])), nextCursor: result.nextCursor };
  }

  async getBill(ctx: RequestContext, id: string): Promise<contracts.Bill> {
    ctx.require('bills.read');
    return this.loadBill(this.deps.db, ctx, id);
  }

  private async loadBill(db: DbOrTx, ctx: RequestContext, id: string): Promise<contracts.Bill> {
    const [r] = await db.select({ b: bills, vendorName: vendors.name, projectName: projects.name, poNumber: purchaseOrders.number, poTotal: purchaseOrders.totalCents, poBilled: purchaseOrders.billedCents }).from(bills).leftJoin(vendors, eq(vendors.id, bills.vendorId)).leftJoin(projects, eq(projects.id, bills.projectId)).leftJoin(purchaseOrders, eq(purchaseOrders.id, bills.purchaseOrderId)).where(and(eq(bills.id, id), eq(bills.organizationId, ctx.organizationId))).limit(1);
    if (!r) throw AppError.notFound('Bill');
    if (r.b.projectId) await ctx.requireProjectAccess(db, r.b.projectId, { allowArchived: true });
    const lines = await this.billLines(db, [id]);
    const attachments = await this.documents.attachmentsFor(db, ctx, 'bill', [id]);
    return serializeBill(r.b, r, lines.get(id) ?? [], (attachments.get(id) ?? []).map((a) => a.document));
  }

  private async billLines(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.Bill['lines']>();
    if (!ids.length) return out;
    const rows = await db.select({ l: billLines, budgetLineName: budgetLines.name }).from(billLines).leftJoin(budgetLines, eq(budgetLines.id, billLines.budgetLineId)).where(inArray(billLines.billId, ids)).orderBy(asc(billLines.sortOrder), asc(billLines.createdAt));
    for (const { l, budgetLineName } of rows) {
      if (!out.has(l.billId)) out.set(l.billId, []);
      out.get(l.billId)!.push({ id: l.id, budgetLineId: l.budgetLineId, budgetLineName, costCodeId: l.costCodeId, purchaseOrderLineId: l.purchaseOrderLineId, description: l.description, amountCents: l.amountCents, sortOrder: l.sortOrder });
    }
    return out;
  }

  async createBill(ctx: RequestContext, input: any): Promise<contracts.Bill> {
    ctx.require('bills.write');
    const id = await this.deps.db.transaction(async (tx) => {
      let { projectId = null, vendorId = null, purchaseOrderId = null, lines = [] } = input;
      let po: PoRow | undefined;
      if (purchaseOrderId) {
        [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
        if (!po) throw AppError.notFound('Purchase order');
        if (!PO_COMMITS.includes(po.status as any)) throw AppError.conflict('Bills can only be matched to approved or issued purchase orders.');
        projectId = projectId ?? po.projectId;
        vendorId = vendorId ?? po.vendorId;
        if (projectId !== po.projectId) throw AppError.validation('The bill must belong to the same project as its purchase order.');
        // Default the bill lines to whatever is still unbilled on the PO.
        if (!lines.length) {
          const poLines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)).orderBy(asc(purchaseOrderLines.sortOrder));
          lines = poLines.filter((l) => l.amountCents - l.billedCents > 0).map((l) => ({ budgetLineId: l.budgetLineId, costCodeId: l.costCodeId, purchaseOrderLineId: l.id, description: l.description, amountCents: l.amountCents - l.billedCents }));
        }
      }
      if (projectId) await ctx.requireProjectAccess(tx, projectId);
      await this.assertVendor(tx, ctx, vendorId);
      const number = await nextNumber(tx, bills, ctx.organizationId, 'BILL');
      const [bill] = await tx.insert(bills).values({ organizationId: ctx.organizationId, projectId, vendorId, purchaseOrderId, number, vendorReference: input.vendorReference ?? null, status: 'draft', billDate: input.billDate ?? new Date().toISOString().slice(0, 10), dueDate: input.dueDate ?? null, subtotalCents: 0, taxCents: input.taxCents ?? 0, totalCents: 0, paidCents: 0, notes: input.notes ?? '', createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.replaceBillLines(tx, ctx, bill!, lines, po);
      if (input.attachmentDocumentIds?.length) await this.documents.attach(tx, ctx, 'bill', bill!.id, input.attachmentDocumentIds);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'created', objectType: 'bill', objectId: bill!.id, objectLabel: `${number}${input.vendorReference ? ` (${input.vendorReference})` : ''}` });
      return bill!.id;
    });
    return this.getBill(ctx, id);
  }

  async updateBill(ctx: RequestContext, id: string, input: any): Promise<contracts.Bill> {
    ctx.require('bills.write');
    await this.deps.db.transaction(async (tx) => {
      const bill = await this.editableBill(tx, ctx, id);
      const { lines, attachmentDocumentIds, ...patch } = input;
      if (patch.projectId) await ctx.requireProjectAccess(tx, patch.projectId);
      if (patch.vendorId !== undefined) await this.assertVendor(tx, ctx, patch.vendorId);
      let po: PoRow | undefined;
      const poId = patch.purchaseOrderId === undefined ? bill.purchaseOrderId : patch.purchaseOrderId;
      if (poId) {
        [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
        if (!po) throw AppError.notFound('Purchase order');
      }
      const [after] = await tx.update(bills).set({ ...patch, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${bills.version} + 1` } as any).where(eq(bills.id, id)).returning();
      await this.replaceBillLines(tx, ctx, after!, lines ?? (await this.currentBillLineInputs(tx, id)), po);
      if (attachmentDocumentIds) { await this.documents.detachAll(tx, ctx, 'bill', id); await this.documents.attach(tx, ctx, 'bill', id, attachmentDocumentIds); }
      const diff = diffRecords(bill as any, after as any, ['updatedAt', 'updatedBy', 'version', 'subtotalCents', 'totalCents']);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: after!.projectId, verb: 'updated', objectType: 'bill', objectId: id, objectLabel: bill.number, diff: diff ?? (lines ? { lines: { from: null, to: `${lines.length} lines` } } : null) });
    });
    return this.getBill(ctx, id);
  }

  private async currentBillLineInputs(tx: DbOrTx, billId: string) {
    const rows = await tx.select().from(billLines).where(eq(billLines.billId, billId)).orderBy(asc(billLines.sortOrder));
    return rows.map((l) => ({ id: l.id, budgetLineId: l.budgetLineId, costCodeId: l.costCodeId, purchaseOrderLineId: l.purchaseOrderLineId, description: l.description, amountCents: l.amountCents }));
  }

  private async replaceBillLines(tx: DbOrTx, ctx: RequestContext, bill: BillRow, lines: any[], po?: PoRow) {
    if (bill.projectId) await this.assertBudgetLines(tx, bill.projectId, lines.map((l) => l.budgetLineId));
    if (po) {
      const poLines = await tx.select({ id: purchaseOrderLines.id }).from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
      const valid = new Set(poLines.map((l) => l.id));
      for (const l of lines) if (l.purchaseOrderLineId && !valid.has(l.purchaseOrderLineId)) throw AppError.validation('One of the lines points at a different purchase order.');
    } else {
      for (const l of lines) l.purchaseOrderLineId = null;
    }
    const existing = await tx.select().from(billLines).where(eq(billLines.billId, bill.id));
    const keep = new Set(lines.map((l) => l.id).filter(Boolean));
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (removed.length) await tx.delete(billLines).where(inArray(billLines.id, removed));
    for (const [i, l] of lines.entries()) {
      const values = { budgetLineId: l.budgetLineId ?? null, costCodeId: l.costCodeId ?? null, purchaseOrderLineId: l.purchaseOrderLineId ?? null, description: l.description, amountCents: l.amountCents, sortOrder: i, updatedAt: sql`now()`, updatedBy: ctx.userId };
      if (l.id && existing.some((e) => e.id === l.id)) await tx.update(billLines).set(values).where(eq(billLines.id, l.id));
      else await tx.insert(billLines).values({ organizationId: ctx.organizationId, billId: bill.id, ...values, createdBy: ctx.userId });
    }
    const subtotal = sumCents(lines.map((l) => l.amountCents as number));
    await tx.update(bills).set({ subtotalCents: subtotal, totalCents: subtotal + bill.taxCents }).where(eq(bills.id, bill.id));
  }

  private async editableBill(tx: DbOrTx, ctx: RequestContext, id: string): Promise<BillRow> {
    const [bill] = await tx.select().from(bills).where(and(eq(bills.id, id), eq(bills.organizationId, ctx.organizationId))).limit(1);
    if (!bill) throw AppError.notFound('Bill');
    if (bill.projectId) await ctx.requireProjectAccess(tx, bill.projectId);
    if (bill.status !== 'draft') throw AppError.conflict('Only draft bills can be edited. Void it and enter it again instead.');
    return bill;
  }

  /** approve: counts against the budget and the PO. schedule: queued for payment. void/reopen: reverse. */
  async transitionBill(ctx: RequestContext, id: string, action: 'approve' | 'schedule' | 'void' | 'reopen'): Promise<contracts.Bill> {
    ctx.require('bills.write');
    await this.deps.db.transaction(async (tx) => {
      const [bill] = await tx.select().from(bills).where(and(eq(bills.id, id), eq(bills.organizationId, ctx.organizationId))).limit(1);
      if (!bill) throw AppError.notFound('Bill');
      if (bill.projectId) await ctx.requireProjectAccess(tx, bill.projectId);
      const rules: Record<string, { from: string[]; to: string; verb: string }> = {
        approve: { from: ['draft'], to: 'approved', verb: 'approved' },
        schedule: { from: ['approved'], to: 'scheduled', verb: 'scheduled' },
        void: { from: ['draft', 'approved', 'scheduled'], to: 'void', verb: 'voided' },
        reopen: { from: ['void'], to: 'draft', verb: 'reopened' },
      };
      const rule = rules[action]!;
      if (!rule.from.includes(bill.status)) throw AppError.conflict(`A ${bill.status} bill cannot be ${rule.verb}.`);
      if (action === 'void' && bill.paidCents > 0) throw AppError.conflict('This bill has payments recorded. Void the payments first.');
      if (action === 'approve' && bill.totalCents <= 0) throw AppError.conflict('Add at least one line before approving a bill.');
      const wasCounted = BILL_COUNTS.includes(bill.status as any);
      const willCount = BILL_COUNTS.includes(rule.to as any);
      if (bill.purchaseOrderId && wasCounted !== willCount) await this.applyBillToPo(tx, ctx, bill, willCount ? 1 : -1);
      await tx.update(bills).set({ status: rule.to, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${bills.version} + 1` }).where(eq(bills.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: bill.projectId, verb: rule.verb, objectType: 'bill', objectId: id, objectLabel: `${bill.number} ${bill.vendorReference ?? ''}`.trim(), metadata: { totalCents: bill.totalCents } });
    });
    return this.getBill(ctx, id);
  }

  /** Roll this bill's line amounts into (or out of) the purchase order's billed totals and re-derive its matched state. */
  private async applyBillToPo(tx: DbOrTx, ctx: RequestContext, bill: BillRow, sign: 1 | -1) {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, bill.purchaseOrderId!)).limit(1);
    if (!po) return;
    const lines = await tx.select().from(billLines).where(eq(billLines.billId, bill.id));
    for (const l of lines) {
      if (!l.purchaseOrderLineId) continue;
      await tx.update(purchaseOrderLines).set({ billedCents: sql`${purchaseOrderLines.billedCents} + ${sign * l.amountCents}`, updatedAt: sql`now()` }).where(eq(purchaseOrderLines.id, l.purchaseOrderLineId));
    }
    const billed = Math.max(0, po.billedCents + sign * bill.totalCents);
    let status = po.status;
    if (sign === 1 && ['approved', 'committed'].includes(po.status) && billed >= po.totalCents) status = 'matched';
    if (sign === -1 && po.status === 'matched' && billed < po.totalCents) status = po.issuedAt ? 'committed' : 'approved';
    await tx.update(purchaseOrders).set({ billedCents: billed, status, updatedAt: sql`now()`, updatedBy: ctx.userId }).where(eq(purchaseOrders.id, po.id));
    if (status !== po.status) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: po.projectId, verb: status === 'matched' ? 'matched' : 'reopened', objectType: 'purchase_order', objectId: po.id, objectLabel: `${po.number} ${po.title}`, metadata: { billedCents: billed, totalCents: po.totalCents } });
  }

  async recordBillPayment(ctx: RequestContext, id: string, input: { amountCents: number; method: string; reference?: string | null; receivedAt?: string; notes: string }): Promise<contracts.Bill> {
    ctx.requireAny('bills.write', 'payments.write');
    await this.deps.db.transaction(async (tx) => {
      const [bill] = await tx.select().from(bills).where(and(eq(bills.id, id), eq(bills.organizationId, ctx.organizationId))).limit(1);
      if (!bill) throw AppError.notFound('Bill');
      if (bill.projectId) await ctx.requireProjectAccess(tx, bill.projectId);
      if (!['approved', 'scheduled'].includes(bill.status)) throw AppError.conflict('Approve the bill before recording a payment.');
      const remaining = bill.totalCents - bill.paidCents;
      if (input.amountCents > remaining) throw AppError.validation(`This bill only has ${remaining} cents outstanding.`);
      await tx.insert(payments).values({ organizationId: ctx.organizationId, projectId: bill.projectId, billId: id, direction: 'out', method: input.method, status: 'completed', amountCents: input.amountCents, feeCents: 0, receivedAt: input.receivedAt ?? new Date().toISOString(), reference: input.reference ?? null, notes: input.notes ?? '', createdBy: ctx.userId, updatedBy: ctx.userId });
      const paid = bill.paidCents + input.amountCents;
      await tx.update(bills).set({ paidCents: paid, status: paid >= bill.totalCents ? 'paid' : bill.status, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${bills.version} + 1` }).where(eq(bills.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: bill.projectId, verb: 'paid', objectType: 'bill', objectId: id, objectLabel: bill.number, metadata: { amountCents: input.amountCents, method: input.method } });
    });
    return this.getBill(ctx, id);
  }
}

export function serializePo(po: PoRow, vendorName: string | null, projectName: string | null, lines: contracts.PurchaseOrder['lines'], attachments?: contracts.Document[]): contracts.PurchaseOrder {
  return { id: po.id, organizationId: po.organizationId, createdAt: po.createdAt, updatedAt: po.updatedAt, createdBy: po.createdBy, updatedBy: po.updatedBy, version: po.version, projectId: po.projectId, projectName: projectName ?? undefined, vendorId: po.vendorId, vendorName, number: po.number, title: po.title, status: po.status as contracts.PurchaseOrder['status'], notes: po.notes, totalCents: po.totalCents, billedCents: po.billedCents, approvedAt: po.approvedAt, issuedAt: po.issuedAt, closedAt: po.closedAt, lines, attachments };
}

export function serializeBill(b: BillRow, ctxRow: { vendorName: string | null; projectName: string | null; poNumber: string | null; poTotal: number | null; poBilled: number | null }, lines: contracts.Bill['lines'], attachments?: contracts.Document[]): contracts.Bill {
  // How far this bill would push the PO past its total (counting bills already approved against it).
  let overPoCents: number | null = null;
  if (b.purchaseOrderId && ctxRow.poTotal != null) {
    const alreadyCounted = BILL_COUNTS.includes(b.status as any);
    const projected = (ctxRow.poBilled ?? 0) + (alreadyCounted ? 0 : b.totalCents);
    overPoCents = Math.max(0, projected - ctxRow.poTotal);
  }
  return { id: b.id, organizationId: b.organizationId, createdAt: b.createdAt, updatedAt: b.updatedAt, createdBy: b.createdBy, updatedBy: b.updatedBy, version: b.version, projectId: b.projectId, projectName: ctxRow.projectName, vendorId: b.vendorId, vendorName: ctxRow.vendorName, purchaseOrderId: b.purchaseOrderId, purchaseOrderNumber: ctxRow.poNumber, number: b.number, vendorReference: b.vendorReference, status: b.status as contracts.Bill['status'], billDate: b.billDate, dueDate: b.dueDate, subtotalCents: b.subtotalCents, taxCents: b.taxCents, totalCents: b.totalCents, paidCents: b.paidCents, notes: b.notes, lines, overPoCents, attachments };
}
