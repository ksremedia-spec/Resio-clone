import { and, asc, eq, sql } from 'drizzle-orm';
import { budgetCalc, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { billLines, bills, budgetLines, budgets, changeOrderLines, changeOrders, costCodes, invoiceLines, invoices, projects, purchaseOrderLines, purchaseOrders, timeEntries } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { ProjectService } from './project.service.js';
import { rowsOf } from '../db/pglite-shared.js';

/**
 * Budget / job costing. Nothing is stored twice: every column except the
 * original amounts is derived from change orders, purchase orders, bills,
 * time entries and invoices, so the numbers can never drift.
 */
export class BudgetService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly projectsService: ProjectService) {}

  async get(ctx: RequestContext, projectId: string): Promise<contracts.Budget> {
    ctx.require('budget.read');
    const { db } = this.deps;
    await ctx.requireProjectAccess(db, projectId, { allowArchived: true });
    const [budget] = await db.select().from(budgets).where(eq(budgets.projectId, projectId)).limit(1);
    const lines = budget ? await this.computeLines(db, budget.id) : [];
    const totals = budgetCalc.rollupBudget(lines.map((l) => ({ originalCents: l.originalCents, approvedChangesCents: l.approvedChangesCents, committedCents: l.committedCents, actualCents: l.actualCents, projectedExtraCents: l.projectedExtraCents, invoicedCents: l.invoicedCents, paidCents: 0 })));
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const fin = await this.projectsService.financials(db, projectId, project!.contractValueCents);
    return {
      id: budget?.id ?? null, projectId, status: budget?.status ?? 'none', sourceEstimateId: budget?.sourceEstimateId ?? null, lines,
      totals: { originalCents: totals.originalCents, approvedChangesCents: totals.approvedChangesCents, revisedCents: totals.revisedCents, committedCents: totals.committedCents, actualCents: totals.actualCents, projectedCents: totals.projectedCents, invoicedCents: totals.invoicedCents, varianceCents: totals.varianceCents, remainingCents: totals.remainingCents, percentSpentBp: totals.percentSpentBp, status: totals.status },
      contract: { contractValueCents: fin.contractValueCents, approvedChangesCents: fin.approvedChangesCents, revisedContractCents: fin.revisedContractCents, invoicedCents: fin.invoicedCents, paidCents: fin.paidCents, outstandingCents: fin.outstandingCents, projectedMarginCents: fin.revisedContractCents - totals.projectedCents },
    };
  }

  async computeLines(db: DbOrTx, budgetId: string): Promise<contracts.BudgetLine[]> {
    const rows = await db.select({
      l: budgetLines, code: costCodes.code,
      approved: sql<number>`coalesce((select sum(col.cost_cents) from change_order_lines col join change_orders co on co.id = col.change_order_id where col.budget_line_id = budget_lines.id and co.status = 'approved'), 0)::bigint`,
      committed: sql<number>`coalesce((select sum(greatest(pol.amount_cents - pol.billed_cents, 0)) from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id where pol.budget_line_id = budget_lines.id and po.status in ('approved','committed','matched')), 0)::bigint`,
      billed: sql<number>`coalesce((select sum(bl.amount_cents) from bill_lines bl join bills b on b.id = bl.bill_id where bl.budget_line_id = budget_lines.id and b.status in ('approved','scheduled','paid')), 0)::bigint`,
      labor: sql<number>`coalesce((select sum(te.labor_cost_cents) from time_entries te where te.project_id = budget_lines.project_id and te.cost_code_id is not null and te.cost_code_id = budget_lines.cost_code_id and te.status in ('approved','exported')), 0)::bigint`,
      invoiced: sql<number>`coalesce((select sum(il.amount_cents) from invoice_lines il join invoices i on i.id = il.invoice_id where il.budget_line_id = budget_lines.id and i.status not in ('draft','void')), 0)::bigint`,
    }).from(budgetLines).leftJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId)).where(eq(budgetLines.budgetId, budgetId)).orderBy(asc(budgetLines.sortOrder), asc(budgetLines.createdAt));
    return rows.map(({ l, code, approved, committed, billed, labor, invoiced }) => {
      const roll = budgetCalc.rollupBudgetLine({ originalCents: l.originalCostCents, approvedChangesCents: Number(approved), committedCents: Number(committed), actualCents: Number(billed) + Number(labor), projectedExtraCents: l.projectedExtraCents, invoicedCents: Number(invoiced), paidCents: 0 });
      return { id: l.id, budgetId: l.budgetId, projectId: l.projectId, costCodeId: l.costCodeId, costCode: code, estimateLineId: l.estimateLineId, sectionName: l.sectionName, name: l.name, clientVisible: l.clientVisible, sortOrder: l.sortOrder, version: l.version, originalCents: roll.originalCents, originalSellCents: l.originalSellCents, approvedChangesCents: roll.approvedChangesCents, revisedCents: roll.revisedCents, committedCents: roll.committedCents, actualCents: roll.actualCents, projectedExtraCents: l.projectedExtraCents, projectedCents: roll.projectedCents, invoicedCents: roll.invoicedCents, varianceCents: roll.varianceCents, remainingCents: roll.remainingCents, percentSpentBp: roll.percentSpentBp, status: roll.status };
    });
  }

  /** Drill-down: every transaction that touches a budget line. */
  async lineDetail(ctx: RequestContext, projectId: string, lineId: string): Promise<{ line: contracts.BudgetLine; transactions: Array<{ kind: 'change_order' | 'purchase_order' | 'bill' | 'time_entry' | 'invoice'; id: string; number: string; title: string; status: string; date: string | null; amountCents: number; link: string }> }> {
    ctx.require('budget.read');
    const { db } = this.deps;
    await ctx.requireProjectAccess(db, projectId, { allowArchived: true });
    const [budget] = await db.select().from(budgets).where(eq(budgets.projectId, projectId)).limit(1);
    if (!budget) throw AppError.notFound('Budget');
    const line = (await this.computeLines(db, budget.id)).find((l) => l.id === lineId);
    if (!line) throw AppError.notFound('Budget line');
    const tx: Array<any> = [];
    const cos = await db.select({ co: changeOrders, cost: changeOrderLines.costCents }).from(changeOrderLines).innerJoin(changeOrders, eq(changeOrders.id, changeOrderLines.changeOrderId)).where(eq(changeOrderLines.budgetLineId, lineId));
    for (const r of cos) tx.push({ kind: 'change_order', id: r.co.id, number: `CO #${r.co.number}`, title: r.co.title, status: r.co.status, date: r.co.decidedAt?.slice(0, 10) ?? r.co.createdAt.slice(0, 10), amountCents: r.cost, link: `/projects/${projectId}/change-orders/${r.co.id}` });
    const pos = await db.select({ po: purchaseOrders, amount: purchaseOrderLines.amountCents, billed: purchaseOrderLines.billedCents }).from(purchaseOrderLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId)).where(eq(purchaseOrderLines.budgetLineId, lineId));
    for (const r of pos) tx.push({ kind: 'purchase_order', id: r.po.id, number: r.po.number, title: r.po.title, status: r.po.status, date: r.po.issuedAt?.slice(0, 10) ?? r.po.createdAt.slice(0, 10), amountCents: r.amount, link: `/projects/${projectId}/purchasing?po=${r.po.id}` });
    const bs = await db.select({ b: bills, amount: billLines.amountCents }).from(billLines).innerJoin(bills, eq(bills.id, billLines.billId)).where(eq(billLines.budgetLineId, lineId));
    for (const r of bs) tx.push({ kind: 'bill', id: r.b.id, number: r.b.number, title: r.b.vendorReference ?? r.b.number, status: r.b.status, date: r.b.billDate, amountCents: r.amount, link: `/projects/${projectId}/purchasing?bill=${r.b.id}` });
    if (line.costCodeId) {
      const tes = await db.select().from(timeEntries).where(and(eq(timeEntries.projectId, projectId), eq(timeEntries.costCodeId, line.costCodeId), sql`${timeEntries.status} in ('approved','exported')`));
      for (const t of tes) tx.push({ kind: 'time_entry', id: t.id, number: 'Time', title: `${Math.round((t.durationSeconds ?? 0) / 360) / 10}h`, status: t.status, date: t.clockInAt.slice(0, 10), amountCents: t.laborCostCents ?? 0, link: `/projects/${projectId}/time` });
    }
    const invs = await db.select({ i: invoices, amount: invoiceLines.amountCents }).from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId)).where(eq(invoiceLines.budgetLineId, lineId));
    for (const r of invs) tx.push({ kind: 'invoice', id: r.i.id, number: r.i.number, title: r.i.title || r.i.number, status: r.i.status, date: r.i.issueDate, amountCents: r.amount, link: `/projects/${projectId}/invoices/${r.i.id}` });
    tx.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    return { line, transactions: tx };
  }

  async createLine(ctx: RequestContext, projectId: string, input: { name: string; sectionName: string; costCodeId?: string | null; originalCents: number; originalSellCents: number; clientVisible: boolean }): Promise<contracts.Budget> {
    ctx.require('budget.write');
    await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      let [budget] = await tx.select().from(budgets).where(eq(budgets.projectId, projectId)).limit(1);
      if (!budget) [budget] = await tx.insert(budgets).values({ organizationId: ctx.organizationId, projectId, status: 'active', totals: {}, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      const [mx] = await tx.select({ max: sql<number>`coalesce(max(${budgetLines.sortOrder}), -1)::int` }).from(budgetLines).where(eq(budgetLines.budgetId, budget!.id));
      const [row] = await tx.insert(budgetLines).values({ organizationId: ctx.organizationId, budgetId: budget!.id, projectId, name: input.name, sectionName: input.sectionName, costCodeId: input.costCodeId ?? null, originalCostCents: input.originalCents, originalSellCents: input.originalSellCents, clientVisible: input.clientVisible, sortOrder: (mx?.max ?? -1) + 1, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'added', objectType: 'budget_line', objectId: row!.id, objectLabel: row!.name, metadata: { originalCents: input.originalCents } });
    });
    return this.get(ctx, projectId);
  }

  async updateLine(ctx: RequestContext, projectId: string, lineId: string, input: Record<string, unknown>): Promise<contracts.Budget> {
    ctx.require('budget.write');
    await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const [before] = await tx.select().from(budgetLines).where(and(eq(budgetLines.id, lineId), eq(budgetLines.projectId, projectId))).limit(1);
      if (!before) throw AppError.notFound('Budget line');
      const { originalCents, ...rest } = input as any;
      const patch: Record<string, unknown> = { ...rest, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${budgetLines.version} + 1` };
      if (originalCents !== undefined) patch.originalCostCents = originalCents;
      const [after] = await tx.update(budgetLines).set(patch as any).where(eq(budgetLines.id, lineId)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'updated', objectType: 'budget_line', objectId: lineId, objectLabel: after!.name, diff });
    });
    return this.get(ctx, projectId);
  }

  /** Company-wide budget health for the Budget page. */
  async overview(ctx: RequestContext): Promise<Array<{ projectId: string; projectNumber: string; projectName: string; status: string; totals: contracts.Budget['totals']; contract: contracts.Budget['contract'] }>> {
    ctx.require('budget.read');
    const { db } = this.deps;
    const visible = await ctx.visibleProjectIds(db);
    const rows = await db.select({ p: projects, b: budgets }).from(projects).innerJoin(budgets, eq(budgets.projectId, projects.id)).where(and(eq(projects.organizationId, ctx.organizationId), sql`${projects.archivedAt} is null`, visible ? (visible.length ? sql`${projects.id} in ${visible}` : sql`false`) : sql`true`)).orderBy(asc(projects.number));
    const out = [];
    for (const { p, b } of rows) {
      const lines = await this.computeLines(db, b.id);
      const t = budgetCalc.rollupBudget(lines.map((l) => ({ originalCents: l.originalCents, approvedChangesCents: l.approvedChangesCents, committedCents: l.committedCents, actualCents: l.actualCents, projectedExtraCents: l.projectedExtraCents, invoicedCents: l.invoicedCents, paidCents: 0 })));
      const fin = await this.projectsService.financials(db, p.id, p.contractValueCents);
      out.push({ projectId: p.id, projectNumber: p.number, projectName: p.name, status: p.status, totals: { originalCents: t.originalCents, approvedChangesCents: t.approvedChangesCents, revisedCents: t.revisedCents, committedCents: t.committedCents, actualCents: t.actualCents, projectedCents: t.projectedCents, invoicedCents: t.invoicedCents, varianceCents: t.varianceCents, remainingCents: t.remainingCents, percentSpentBp: t.percentSpentBp, status: t.status }, contract: { contractValueCents: fin.contractValueCents, approvedChangesCents: fin.approvedChangesCents, revisedContractCents: fin.revisedContractCents, invoicedCents: fin.invoicedCents, paidCents: fin.paidCents, outstandingCents: fin.outstandingCents, projectedMarginCents: fin.revisedContractCents - t.projectedCents } });
    }
    return out;
  }
}

export { rowsOf };
