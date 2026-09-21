import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { applyRate, mulQuantity, sumCents, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { budgetLines, changeOrders, clients, invoiceLines, invoices, payments, projects } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import type { DocumentService } from './document.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import { nextNumber } from '../lib/numbering.js';
import { projectTeamUserIds } from '../lib/recipients.js';

type InvoiceRow = typeof invoices.$inferSelect;
const OPEN = ['sent', 'viewed', 'partially_paid', 'overdue'] as const;
const PAYABLE = ['sent', 'viewed', 'partially_paid', 'overdue'] as const;
const DEFAULT_TERMS_DAYS = 30;

/**
 * Client invoices: progress, milestone, change-order, cost-plus or final.
 * Lines can bill a percentage of a budget line's sell value or a whole
 * approved change order, so the invoice and the budget always agree.
 */
export class InvoiceService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService, private readonly documents: DocumentService) {}

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; clientId?: string; status: string; q?: string }) {
    ctx.require('invoices.read');
    const { db } = this.deps;
    const conditions = [eq(invoices.organizationId, ctx.organizationId), isNull(invoices.archivedAt)];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(invoices.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? inArray(invoices.projectId, visible) : sql`false`); }
    if (query.clientId) conditions.push(eq(invoices.clientId, query.clientId));
    if (query.status === 'open') conditions.push(inArray(invoices.status, [...OPEN]));
    else if (query.status === 'overdue') conditions.push(and(inArray(invoices.status, ['sent', 'viewed', 'partially_paid', 'overdue']), sql`${invoices.dueDate} < current_date`)!);
    else if (query.status !== 'all') conditions.push(eq(invoices.status, query.status));
    if (query.q) conditions.push(or(ilike(invoices.number, `%${query.q}%`), ilike(invoices.title, `%${query.q}%`), ilike(projects.name, `%${query.q}%`))!);
    const cursor = decodeCursor<{ k: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${invoices.number}, ${invoices.id}) < (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select({ i: invoices, projectName: projects.name, clientName: clients.displayName }).from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId)).leftJoin(clients, eq(clients.id, invoices.clientId)).where(and(...conditions)).orderBy(desc(invoices.number), desc(invoices.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: r.i.number, id: r.i.id }));
    const ids = result.items.map((r) => r.i.id);
    const [lines, pays] = await Promise.all([this.linesFor(db, ids), this.paymentsFor(db, ids)]);
    return { items: result.items.map((r) => serializeInvoice(r.i, r.projectName, r.clientName, lines.get(r.i.id) ?? [], pays.get(r.i.id) ?? [])), nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.Invoice> {
    ctx.require('invoices.read');
    const { db } = this.deps;
    const [r] = await db.select({ i: invoices, projectName: projects.name, clientName: clients.displayName }).from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId)).leftJoin(clients, eq(clients.id, invoices.clientId)).where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.organizationId))).limit(1);
    if (!r) throw AppError.notFound('Invoice');
    await ctx.requireProjectAccess(db, r.i.projectId, { allowArchived: true });
    const [lines, pays, attachments] = await Promise.all([this.linesFor(db, [id]), this.paymentsFor(db, [id]), this.documents.attachmentsFor(db, ctx, 'invoice', [id])]);
    return serializeInvoice(r.i, r.projectName, r.clientName, lines.get(id) ?? [], pays.get(id) ?? [], (attachments.get(id) ?? []).map((a) => a.document));
  }

  private async linesFor(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.Invoice['lines']>();
    if (!ids.length) return out;
    const rows = await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)).orderBy(asc(invoiceLines.sortOrder), asc(invoiceLines.createdAt));
    for (const l of rows) {
      if (!out.has(l.invoiceId)) out.set(l.invoiceId, []);
      out.get(l.invoiceId)!.push({ id: l.id, budgetLineId: l.budgetLineId, changeOrderId: l.changeOrderId, description: l.description, quantityThousandths: l.quantityThousandths, unitPriceCents: l.unitPriceCents, amountCents: l.amountCents, percentBp: l.percentBp, taxable: l.taxable, sortOrder: l.sortOrder });
    }
    return out;
  }

  private async paymentsFor(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.Payment[]>();
    if (!ids.length) return out;
    const rows = await db.select().from(payments).where(inArray(payments.invoiceId, ids)).orderBy(desc(payments.receivedAt));
    for (const p of rows) {
      if (!out.has(p.invoiceId!)) out.set(p.invoiceId!, []);
      out.get(p.invoiceId!)!.push(serializePayment(p));
    }
    return out;
  }

  async create(ctx: RequestContext, projectId: string, input: any): Promise<contracts.Invoice> {
    ctx.require('invoices.write');
    const id = await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const [project] = await tx.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, projectId)).limit(1);
      const number = await nextNumber(tx, invoices, ctx.organizationId, 'INV');
      const issueDate = input.issueDate ?? today();
      const [inv] = await tx.insert(invoices).values({ organizationId: ctx.organizationId, projectId, clientId: project?.clientId ?? null, number, title: input.title ?? '', billingType: input.billingType ?? 'progress', status: 'draft', issueDate, dueDate: input.dueDate === undefined ? addDays(issueDate, DEFAULT_TERMS_DAYS) : input.dueDate, subtotalCents: 0, taxCents: 0, retainageCents: 0, totalCents: 0, paidCents: 0, notes: input.notes ?? '', terms: input.terms ?? '', createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.replaceLines(tx, ctx, inv!, input.lines ?? [], input.changeOrderIds, { taxBp: input.taxBp ?? 0, retainageBp: input.retainageBp ?? 0 });
      if (input.attachmentDocumentIds?.length) await this.documents.attach(tx, ctx, 'invoice', inv!.id, input.attachmentDocumentIds);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'created', objectType: 'invoice', objectId: inv!.id, objectLabel: `${number}${input.title ? ` ${input.title}` : ''}` });
      return inv!.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, input: any): Promise<contracts.Invoice> {
    ctx.require('invoices.write');
    await this.deps.db.transaction(async (tx) => {
      const inv = await this.editable(tx, ctx, id);
      const { lines, changeOrderIds, attachmentDocumentIds, taxBp, retainageBp, ...patch } = input;
      const [after] = await tx.update(invoices).set({ ...patch, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${invoices.version} + 1` } as any).where(eq(invoices.id, id)).returning();
      const current = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.sortOrder));
      const taxable = sumCents(current.filter((l) => l.taxable).map((l) => l.amountCents));
      const rates = { taxBp: taxBp ?? rateOf(inv.taxCents, taxable), retainageBp: retainageBp ?? rateOf(inv.retainageCents, inv.subtotalCents) };
      const lineInputs = lines ?? current.filter((l) => !l.changeOrderId).map((l) => ({ id: l.id, budgetLineId: l.budgetLineId, description: l.description, quantityThousandths: l.quantityThousandths, unitPriceCents: l.unitPriceCents, percentBp: l.percentBp, taxable: l.taxable }));
      const coIds = changeOrderIds ?? current.filter((l) => l.changeOrderId).map((l) => l.changeOrderId!);
      await this.replaceLines(tx, ctx, after!, lineInputs, coIds, rates);
      if (attachmentDocumentIds) { await this.documents.detachAll(tx, ctx, 'invoice', id); await this.documents.attach(tx, ctx, 'invoice', id, attachmentDocumentIds); }
      const diff = diffRecords(inv as any, after as any, ['updatedAt', 'updatedBy', 'version', 'subtotalCents', 'taxCents', 'retainageCents', 'totalCents']);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: inv.projectId, verb: 'updated', objectType: 'invoice', objectId: id, objectLabel: inv.number, diff: diff ?? (lines ? { lines: { from: null, to: `${lines.length} lines` } } : null) });
    });
    return this.get(ctx, id);
  }

  private async editable(tx: DbOrTx, ctx: RequestContext, id: string): Promise<InvoiceRow> {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.organizationId))).limit(1);
    if (!inv) throw AppError.notFound('Invoice');
    await ctx.requireProjectAccess(tx, inv.projectId);
    if (inv.status !== 'draft') throw AppError.conflict('Only draft invoices can be edited. Void it and create a new one instead.');
    return inv;
  }

  /** Rebuild the lines: manual/percentage lines first, then one line per approved change order. */
  private async replaceLines(tx: DbOrTx, ctx: RequestContext, inv: InvoiceRow, lines: any[], changeOrderIds: string[] | undefined, rates: { taxBp: number; retainageBp: number }) {
    const wanted = [...new Set(lines.map((l) => l.budgetLineId).filter(Boolean))] as string[];
    const budget = new Map<string, typeof budgetLines.$inferSelect>();
    if (wanted.length) {
      const rows = await tx.select().from(budgetLines).where(and(eq(budgetLines.projectId, inv.projectId), inArray(budgetLines.id, wanted)));
      if (rows.length !== wanted.length) throw AppError.validation('One of the budget lines does not belong to this project.');
      for (const r of rows) budget.set(r.id, r);
    }
    const existing = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
    const keep = new Set(lines.map((l) => l.id).filter(Boolean));
    const values: Array<typeof invoiceLines.$inferInsert & { id?: string }> = [];
    for (const [i, l] of lines.entries()) {
      let amount: number;
      if (l.percentBp != null && l.budgetLineId) {
        const bl = budget.get(l.budgetLineId)!;
        amount = applyRate(bl.originalSellCents, l.percentBp);
      } else amount = mulQuantity(l.unitPriceCents ?? 0, l.quantityThousandths ?? 1000);
      values.push({ id: l.id, organizationId: ctx.organizationId, invoiceId: inv.id, budgetLineId: l.budgetLineId ?? null, changeOrderId: null, description: l.description, quantityThousandths: l.quantityThousandths ?? 1000, unitPriceCents: l.unitPriceCents ?? 0, amountCents: amount, percentBp: l.percentBp ?? null, taxable: !!l.taxable, sortOrder: i, createdBy: ctx.userId, updatedBy: ctx.userId });
    }
    // Change orders: only approved ones on this project, and not already billed on another live invoice.
    const coIds = [...new Set(changeOrderIds ?? [])];
    await tx.update(changeOrders).set({ invoiceId: null }).where(and(eq(changeOrders.invoiceId, inv.id), coIds.length ? sql`${changeOrders.id} not in ${coIds}` : sql`true`));
    if (coIds.length) {
      const cos = await tx.select().from(changeOrders).where(and(eq(changeOrders.projectId, inv.projectId), inArray(changeOrders.id, coIds)));
      if (cos.length !== coIds.length) throw AppError.validation('One of the change orders does not belong to this project.');
      for (const co of cos) {
        if (co.status !== 'approved') throw AppError.conflict(`Change order #${co.number} is not approved yet.`);
        if (co.invoiceId && co.invoiceId !== inv.id) throw AppError.conflict(`Change order #${co.number} is already on another invoice.`);
        const prior = existing.find((e) => e.changeOrderId === co.id);
        if (prior) keep.add(prior.id);
        values.push({ id: prior?.id, organizationId: ctx.organizationId, invoiceId: inv.id, budgetLineId: null, changeOrderId: co.id, description: `Change order #${co.number}: ${co.title}`, quantityThousandths: 1000, unitPriceCents: co.totalCents, amountCents: co.totalCents, percentBp: null, taxable: false, sortOrder: values.length, createdBy: ctx.userId, updatedBy: ctx.userId });
        await tx.update(changeOrders).set({ invoiceId: inv.id }).where(eq(changeOrders.id, co.id));
      }
    }
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (removed.length) await tx.delete(invoiceLines).where(inArray(invoiceLines.id, removed));
    for (const v of values) {
      const { id, ...rest } = v;
      if (id && existing.some((e) => e.id === id)) await tx.update(invoiceLines).set({ ...rest, updatedAt: sql`now()` }).where(eq(invoiceLines.id, id));
      else await tx.insert(invoiceLines).values(rest);
    }
    const subtotal = sumCents(values.map((v) => v.amountCents as number));
    const taxable = sumCents(values.filter((v) => v.taxable).map((v) => v.amountCents as number));
    const tax = applyRate(taxable, rates.taxBp);
    const retainage = applyRate(subtotal, rates.retainageBp);
    await tx.update(invoices).set({ subtotalCents: subtotal, taxCents: tax, retainageCents: retainage, totalCents: subtotal + tax - retainage }).where(eq(invoices.id, inv.id));
  }

  /** send: issues the invoice to the client (it now counts as billed). void / reopen reverse that. */
  async transition(ctx: RequestContext, id: string, action: 'send' | 'void' | 'reopen'): Promise<contracts.Invoice> {
    ctx.require('invoices.write');
    await this.deps.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.organizationId))).limit(1);
      if (!inv) throw AppError.notFound('Invoice');
      await ctx.requireProjectAccess(tx, inv.projectId);
      const rules: Record<string, { from: string[]; to: string; patch?: Record<string, unknown>; verb: string }> = {
        send: { from: ['draft'], to: 'sent', patch: { sentAt: sql`now()` }, verb: 'sent' },
        void: { from: ['draft', 'sent', 'viewed', 'overdue'], to: 'void', verb: 'voided' },
        reopen: { from: ['void'], to: 'draft', patch: { sentAt: null }, verb: 'reopened' },
      };
      const rule = rules[action]!;
      if (!rule.from.includes(inv.status)) throw AppError.conflict(`A ${inv.status.replace('_', ' ')} invoice cannot be ${rule.verb}.`);
      if (action === 'send' && inv.totalCents <= 0) throw AppError.conflict('Add at least one line before sending an invoice.');
      if (action === 'void' && inv.paidCents > 0) throw AppError.conflict('This invoice has payments recorded. Void the payments first.');
      await tx.update(invoices).set({ status: rule.to, ...(rule.patch ?? {}), updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${invoices.version} + 1` } as any).where(eq(invoices.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: inv.projectId, verb: rule.verb, objectType: 'invoice', objectId: id, objectLabel: `${inv.number}${inv.title ? ` ${inv.title}` : ''}`, clientVisible: action === 'send', metadata: { totalCents: inv.totalCents } });
      if (action === 'send') {
        const team = await projectTeamUserIds(tx, ctx.organizationId, inv.projectId);
        await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'system', title: `Invoice ${inv.number} sent`, body: `${ctx.actorName} sent an invoice for ${(inv.totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`, projectId: inv.projectId, objectType: 'invoice', objectId: id, link: `/projects/${inv.projectId}/invoices/${id}` });
      }
    });
    return this.get(ctx, id);
  }

  async recordPayment(ctx: RequestContext, id: string, input: { amountCents: number; method: string; reference?: string | null; receivedAt?: string; notes: string }): Promise<contracts.Invoice> {
    ctx.require('payments.write');
    await this.deps.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.organizationId))).limit(1);
      if (!inv) throw AppError.notFound('Invoice');
      await ctx.requireProjectAccess(tx, inv.projectId);
      if (!PAYABLE.includes(inv.status as any)) throw AppError.conflict('Send the invoice before recording a payment against it.');
      const remaining = inv.totalCents - inv.paidCents;
      if (input.amountCents > remaining) throw AppError.validation(`This invoice only has ${remaining} cents outstanding.`);
      await tx.insert(payments).values({ organizationId: ctx.organizationId, projectId: inv.projectId, invoiceId: id, direction: 'in', method: input.method, status: 'completed', amountCents: input.amountCents, feeCents: 0, receivedAt: input.receivedAt ?? new Date().toISOString(), reference: input.reference ?? null, notes: input.notes ?? '', createdBy: ctx.userId, updatedBy: ctx.userId });
      await this.applyPaidTotals(tx, ctx, inv, inv.paidCents + input.amountCents);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: inv.projectId, verb: 'paid', objectType: 'invoice', objectId: id, objectLabel: inv.number, clientVisible: true, metadata: { amountCents: input.amountCents, method: input.method } });
      if (inv.paidCents + input.amountCents >= inv.totalCents) {
        const team = await projectTeamUserIds(tx, ctx.organizationId, inv.projectId);
        await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'invoice.paid', title: `Invoice ${inv.number} paid in full`, body: `${ctx.actorName} recorded a ${input.method} payment.`, projectId: inv.projectId, objectType: 'invoice', objectId: id, link: `/projects/${inv.projectId}/invoices/${id}` });
      }
    });
    return this.get(ctx, id);
  }

  async voidPayment(ctx: RequestContext, invoiceId: string, paymentId: string): Promise<contracts.Invoice> {
    ctx.require('payments.write');
    await this.deps.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, ctx.organizationId))).limit(1);
      if (!inv) throw AppError.notFound('Invoice');
      await ctx.requireProjectAccess(tx, inv.projectId);
      const [p] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.invoiceId, invoiceId))).limit(1);
      if (!p) throw AppError.notFound('Payment');
      if (p.voidedAt) throw AppError.conflict('This payment is already void.');
      await tx.update(payments).set({ status: 'void', voidedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId }).where(eq(payments.id, paymentId));
      await this.applyPaidTotals(tx, ctx, inv, inv.paidCents - p.amountCents);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: inv.projectId, verb: 'voided', objectType: 'payment', objectId: paymentId, objectLabel: `${p.method} payment on ${inv.number}`, metadata: { amountCents: p.amountCents } });
    });
    return this.get(ctx, invoiceId);
  }

  private async applyPaidTotals(tx: DbOrTx, ctx: RequestContext, inv: InvoiceRow, paid: number) {
    const status = paid >= inv.totalCents && inv.totalCents > 0 ? 'paid' : paid > 0 ? 'partially_paid' : inv.status === 'paid' || inv.status === 'partially_paid' ? 'sent' : inv.status;
    await tx.update(invoices).set({ paidCents: paid, status, paidAt: status === 'paid' ? sql`now()` : null, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${invoices.version} + 1` }).where(eq(invoices.id, inv.id));
  }

  /** Start an online payment through the connected provider (used by the client portal). */
  async createPaymentIntent(ctx: RequestContext, id: string, method: 'card' | 'ach') {
    ctx.require('payments.write');
    const inv = await this.get(ctx, id);
    if (!PAYABLE.includes(inv.status as any)) throw AppError.conflict('This invoice is not open for payment.');
    return this.deps.providers.payments.createPaymentIntent({ organizationId: ctx.organizationId, invoiceId: id, amountCents: inv.balanceCents, currency: 'USD', method, payerEmail: ctx.user.email });
  }
}

function today() { return new Date().toISOString().slice(0, 10); }
function addDays(isoDate: string, days: number) { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function rateOf(part: number, whole: number) { return whole > 0 ? Math.round((part / whole) * 10_000) : 0; }

export function serializePayment(p: typeof payments.$inferSelect): contracts.Payment {
  return { id: p.id, invoiceId: p.invoiceId, billId: p.billId, direction: p.direction as 'in' | 'out', method: p.method, status: p.status, amountCents: p.amountCents, feeCents: p.feeCents, receivedAt: p.receivedAt, reference: p.reference, notes: p.notes, provider: p.provider, voidedAt: p.voidedAt };
}

export function serializeInvoice(i: InvoiceRow, projectName: string | undefined, clientName: string | null, lines: contracts.Invoice['lines'], pays: contracts.Payment[], attachments?: contracts.Document[]): contracts.Invoice {
  // "overdue" is a view of an unpaid invoice past its due date, never a stored state, so it can never go stale.
  const overdue = ['sent', 'viewed', 'partially_paid'].includes(i.status) && !!i.dueDate && i.dueDate < today();
  return { id: i.id, organizationId: i.organizationId, createdAt: i.createdAt, updatedAt: i.updatedAt, createdBy: i.createdBy, updatedBy: i.updatedBy, version: i.version, projectId: i.projectId, projectName, clientId: i.clientId, clientName, number: i.number, title: i.title, billingType: i.billingType as contracts.Invoice['billingType'], status: (overdue ? 'overdue' : i.status) as contracts.Invoice['status'], issueDate: i.issueDate, dueDate: i.dueDate, subtotalCents: i.subtotalCents, taxCents: i.taxCents, retainageCents: i.retainageCents, totalCents: i.totalCents, paidCents: i.paidCents, balanceCents: i.totalCents - i.paidCents, notes: i.notes, terms: i.terms, sentAt: i.sentAt, viewedAt: i.viewedAt, paidAt: i.paidAt, lines, payments: pays, attachments };
}
