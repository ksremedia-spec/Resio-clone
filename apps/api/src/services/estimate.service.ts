import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { estimateCalc, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { budgetLines, budgets, costCatalogItems, costCodes, estimateLineItems, estimateSections, estimates, organizations, projects } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';

type EstimateRow = typeof estimates.$inferSelect;
type LineRow = typeof estimateLineItems.$inferSelect;

/**
 * Estimates: sections → line items with quantity × unit cost per cost type,
 * markup and tax computed with the shared engine (identical on the iPad).
 * Locking freezes the estimate and creates/refreshes the project budget.
 */
export class EstimateService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService) {}

  async getForProject(ctx: RequestContext, projectId: string): Promise<contracts.Estimate> {
    ctx.require('estimates.read');
    const { db } = this.deps;
    await ctx.requireProjectAccess(db, projectId, { allowArchived: true });
    let [est] = await db.select().from(estimates).where(and(eq(estimates.projectId, projectId), isNull(estimates.archivedAt))).orderBy(asc(estimates.createdAt)).limit(1);
    if (!est) {
      if (!ctx.has('estimates.write')) throw AppError.notFound('Estimate');
      const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
      [est] = await db.insert(estimates).values({ organizationId: ctx.organizationId, projectId, name: 'Estimate', defaultMarkupBp: org!.defaultMarkupBp, taxBp: org!.defaultTaxBp, totals: emptyTotals(), createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    }
    return this.serialize(db, est!);
  }

  private async loadEditable(tx: DbOrTx, ctx: RequestContext, projectId: string): Promise<EstimateRow> {
    ctx.require('estimates.write');
    await ctx.requireProjectAccess(tx, projectId);
    let [est] = await tx.select().from(estimates).where(and(eq(estimates.projectId, projectId), isNull(estimates.archivedAt))).orderBy(asc(estimates.createdAt)).limit(1);
    if (!est) {
      // First edit on a project: start the estimate with the company defaults.
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
      [est] = await tx.insert(estimates).values({ organizationId: ctx.organizationId, projectId, name: 'Estimate', defaultMarkupBp: org!.defaultMarkupBp, taxBp: org!.defaultTaxBp, totals: emptyTotals(), createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    }
    if (est!.status === 'locked') throw AppError.conflict('This estimate is locked. Unlock it to make changes.');
    return est!;
  }

  async update(ctx: RequestContext, projectId: string, input: Record<string, unknown>): Promise<contracts.Estimate> {
    await this.deps.db.transaction(async (tx) => {
      const est = await this.loadEditable(tx, ctx, projectId);
      const [after] = await tx.update(estimates).set({ ...input, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${estimates.version} + 1` } as any).where(eq(estimates.id, est.id)).returning();
      await this.recalculate(tx, after!);
      const diff = diffRecords(est as any, after as any, ['updatedAt', 'updatedBy', 'version', 'totals']);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'updated', objectType: 'estimate', objectId: est.id, objectLabel: est.name, diff });
    });
    return this.getForProject(ctx, projectId);
  }

  // ---------- sections ----------

  async createSection(ctx: RequestContext, projectId: string, input: any): Promise<contracts.Estimate> {
    await this.deps.db.transaction(async (tx) => {
      const est = await this.loadEditable(tx, ctx, projectId);
      const [mx] = await tx.select({ max: sql<number>`coalesce(max(${estimateSections.sortOrder}), -1)::int` }).from(estimateSections).where(eq(estimateSections.estimateId, est.id));
      const [row] = await tx.insert(estimateSections).values({ organizationId: ctx.organizationId, estimateId: est.id, parentId: input.parentId ?? null, name: input.name, description: input.description, costCodeId: input.costCodeId ?? null, sortOrder: input.sortOrder ?? (mx?.max ?? -1) + 1, clientVisible: input.clientVisible, totals: emptyTotals(), createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'added', objectType: 'estimate', objectId: est.id, objectLabel: `section ${row!.name}` });
    });
    return this.getForProject(ctx, projectId);
  }

  async updateSection(ctx: RequestContext, projectId: string, sectionId: string, input: Record<string, unknown>): Promise<contracts.Estimate> {
    await this.deps.db.transaction(async (tx) => {
      const est = await this.loadEditable(tx, ctx, projectId);
      const [row] = await tx.update(estimateSections).set({ ...input, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${estimateSections.version} + 1` } as any).where(and(eq(estimateSections.id, sectionId), eq(estimateSections.estimateId, est.id))).returning();
      if (!row) throw AppError.notFound('Section');
    });
    return this.getForProject(ctx, projectId);
  }

  async deleteSection(ctx: RequestContext, projectId: string, sectionId: string): Promise<contracts.Estimate> {
    await this.deps.db.transaction(async (tx) => {
      const est = await this.loadEditable(tx, ctx, projectId);
      const [row] = await tx.delete(estimateSections).where(and(eq(estimateSections.id, sectionId), eq(estimateSections.estimateId, est.id))).returning();
      if (!row) throw AppError.notFound('Section');
      await this.recalculate(tx, est);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'removed', objectType: 'estimate', objectId: est.id, objectLabel: `section ${row.name}` });
    });
    return this.getForProject(ctx, projectId);
  }

  // ---------- lines ----------

  async createLine(ctx: RequestContext, projectId: string, input: any): Promise<contracts.Estimate> {
    await this.deps.db.transaction(async (tx) => {
      const est = await this.loadEditable(tx, ctx, projectId);
      const [section] = await tx.select().from(estimateSections).where(and(eq(estimateSections.id, input.sectionId), eq(estimateSections.estimateId, est.id))).limit(1);
      if (!section) throw AppError.notFound('Section');
      let values: any = { ...input };
      if (input.catalogItemId) {
        const [item] = await tx.select().from(costCatalogItems).where(and(eq(costCatalogItems.id, input.catalogItemId), eq(costCatalogItems.organizationId, ctx.organizationId))).limit(1);
        if (!item) throw AppError.notFound('Catalog item');
        values = { ...values, name: input.name || item.name, description: input.description || item.description, unit: input.unit === 'ea' && item.unit ? item.unit : input.unit, unitCostCents: Object.keys(input.unitCostCents ?? {}).length ? input.unitCostCents : item.unitCostCents, markupBp: input.markupBp ?? item.markupBp ?? null, costCodeId: input.costCodeId ?? item.costCodeId, isAllowance: input.isAllowance || item.isAllowance };
      }
      if (!values.name) throw AppError.validation('Give the line a name or pick a catalog item.');
      const [mx] = await tx.select({ max: sql<number>`coalesce(max(${estimateLineItems.sortOrder}), -1)::int` }).from(estimateLineItems).where(eq(estimateLineItems.sectionId, section.id));
      await tx.insert(estimateLineItems).values({ organizationId: ctx.organizationId, estimateId: est.id, sectionId: section.id, parentLineId: values.parentLineId ?? null, costCodeId: values.costCodeId ?? null, catalogItemId: values.catalogItemId ?? null, name: values.name, description: values.description ?? '', quantityThousandths: values.quantityThousandths, unit: values.unit, unitCostCents: values.unitCostCents ?? {}, markupBp: values.markupBp ?? null, taxable: values.taxable, isAllowance: values.isAllowance, isOptional: values.isOptional, included: values.included, notes: values.notes ?? '', sortOrder: values.sortOrder ?? (mx?.max ?? -1) + 1, clientVisible: values.clientVisible, totals: {}, createdBy: ctx.userId, updatedBy: ctx.userId });
      await this.recalculate(tx, est);
    });
    return this.getForProject(ctx, projectId);
  }

  async updateLines(ctx: RequestContext, projectId: string, updates: Array<{ id: string } & Record<string, unknown>>): Promise<contracts.Estimate> {
    await this.deps.db.transaction(async (tx) => {
      const est = await this.loadEditable(tx, ctx, projectId);
      for (const { id, ...patch } of updates) {
        if (patch.sectionId) {
          const [section] = await tx.select({ id: estimateSections.id }).from(estimateSections).where(and(eq(estimateSections.id, patch.sectionId as string), eq(estimateSections.estimateId, est.id))).limit(1);
          if (!section) throw AppError.notFound('Section');
        }
        const [row] = await tx.update(estimateLineItems).set({ ...patch, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${estimateLineItems.version} + 1` } as any).where(and(eq(estimateLineItems.id, id), eq(estimateLineItems.estimateId, est.id))).returning({ id: estimateLineItems.id });
        if (!row) throw AppError.notFound('Line item');
      }
      await this.recalculate(tx, est);
    });
    return this.getForProject(ctx, projectId);
  }

  async deleteLine(ctx: RequestContext, projectId: string, lineId: string): Promise<contracts.Estimate> {
    await this.deps.db.transaction(async (tx) => {
      const est = await this.loadEditable(tx, ctx, projectId);
      const [row] = await tx.delete(estimateLineItems).where(and(eq(estimateLineItems.id, lineId), eq(estimateLineItems.estimateId, est.id))).returning();
      if (!row) throw AppError.notFound('Line item');
      await this.recalculate(tx, est);
    });
    return this.getForProject(ctx, projectId);
  }

  // ---------- lock / unlock ----------

  /** Lock the estimate, create or refresh the budget, and (optionally) set the contract value. */
  async lock(ctx: RequestContext, projectId: string, opts: { applyContractValue: boolean }): Promise<contracts.Estimate> {
    ctx.require('estimates.write');
    await this.deps.db.transaction(async (tx) => { await this.lockWithin(tx, ctx, projectId, opts); });
    return this.getForProject(ctx, projectId);
  }

  /** The locking work itself, without the permission gate: proposals lock the estimate when a client accepts. */
  async lockWithin(tx: DbOrTx, ctx: RequestContext, projectId: string, opts: { applyContractValue: boolean }): Promise<void> {
    {
      await ctx.requireProjectAccess(tx, projectId);
      const [est] = await tx.select().from(estimates).where(and(eq(estimates.projectId, projectId), isNull(estimates.archivedAt))).orderBy(asc(estimates.createdAt)).limit(1);
      if (!est) throw AppError.notFound('Estimate');
      const { lines, sections, totals } = await this.recalculate(tx, est);
      if (lines.length === 0) throw AppError.conflict('Add at least one line item before locking the estimate.');
      await tx.update(estimates).set({ status: 'locked', lockedAt: sql`now()`, lockedBy: ctx.userId, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${estimates.version} + 1` }).where(eq(estimates.id, est.id));
      // Budget: one per project; refresh lines that came from this estimate, add new ones, keep manual lines.
      let [budget] = await tx.select().from(budgets).where(eq(budgets.projectId, projectId)).limit(1);
      if (!budget) [budget] = await tx.insert(budgets).values({ organizationId: ctx.organizationId, projectId, sourceEstimateId: est.id, status: 'active', totals: {}, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      else await tx.update(budgets).set({ sourceEstimateId: est.id, updatedAt: sql`now()`, updatedBy: ctx.userId }).where(eq(budgets.id, budget.id));
      const existing = await tx.select().from(budgetLines).where(eq(budgetLines.budgetId, budget!.id));
      const byEstimateLine = new Map(existing.filter((b) => b.estimateLineId).map((b) => [b.estimateLineId!, b]));
      const sectionName = new Map(sections.map((s) => [s.id, s.name]));
      let sort = existing.length;
      for (const line of lines) {
        if (line.isOptional && !line.included) continue;
        const t = line.totals as contracts.EstimateLine['totals'];
        const found = byEstimateLine.get(line.id);
        const values = { name: line.name, sectionName: sectionName.get(line.sectionId) ?? '', costCodeId: line.costCodeId, originalCostCents: t.directCostCents, originalSellCents: t.sellCents, clientVisible: line.clientVisible, updatedAt: sql`now()`, updatedBy: ctx.userId };
        if (found) await tx.update(budgetLines).set({ ...values, version: sql`${budgetLines.version} + 1` }).where(eq(budgetLines.id, found.id));
        else await tx.insert(budgetLines).values({ organizationId: ctx.organizationId, budgetId: budget!.id, projectId, estimateLineId: line.id, sortOrder: sort++, ...values, createdBy: ctx.userId });
      }
      const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      if (opts.applyContractValue && project) {
        const before = project.contractValueCents;
        await tx.update(projects).set({ contractValueCents: totals.sellCents, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${projects.version} + 1` }).where(eq(projects.id, projectId));
        if (before !== totals.sellCents) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'updated', objectType: 'project', objectId: projectId, objectLabel: `${project.number} ${project.name}`, diff: { contractValueCents: { from: before, to: totals.sellCents } } });
      }
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'locked', objectType: 'estimate', objectId: est.id, objectLabel: `${est.name} (${lines.length} lines)`, metadata: { sellCents: totals.sellCents, costCents: totals.directCostCents } });
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'updated', objectType: 'budget', objectId: budget!.id, objectLabel: 'from locked estimate' });
      const managers = await tx.execute(sql`select user_id from project_members where project_id = ${projectId} and user_id is not null`);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: (Array.isArray(managers) ? managers : (managers as any).rows ?? []).map((m: any) => m.user_id), excludeUserId: ctx.userId, kind: 'system', title: `Estimate locked for ${project?.name ?? 'project'}`, body: `${ctx.actorName} locked the estimate; the budget is now live.`, projectId, objectType: 'budget', objectId: budget!.id, link: `/projects/${projectId}/budget` });
    }
  }

  async unlock(ctx: RequestContext, projectId: string): Promise<contracts.Estimate> {
    ctx.require('estimates.write');
    await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const [est] = await tx.update(estimates).set({ status: 'draft', lockedAt: null, lockedBy: null, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${estimates.version} + 1` }).where(and(eq(estimates.projectId, projectId), isNull(estimates.archivedAt))).returning();
      if (!est) throw AppError.notFound('Estimate');
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'unlocked', objectType: 'estimate', objectId: est.id, objectLabel: est.name });
    });
    return this.getForProject(ctx, projectId);
  }

  // ---------- calculation ----------

  /** Recompute every line, section and the estimate totals with the shared engine and persist them. */
  async recalculate(tx: DbOrTx, est: EstimateRow) {
    const lines = await tx.select().from(estimateLineItems).where(eq(estimateLineItems.estimateId, est.id)).orderBy(asc(estimateLineItems.sortOrder));
    const sections = await tx.select().from(estimateSections).where(eq(estimateSections.estimateId, est.id)).orderBy(asc(estimateSections.sortOrder));
    const markupByType = (est.markupByCostType ?? {}) as Partial<Record<estimateCalc.CostType, number>>;
    const computed = lines.map((line) => {
      const input: estimateCalc.LineItemInput = { quantityThousandths: line.quantityThousandths, unitCostCents: line.unitCostCents as any, markupBp: { ...markupByType, ...((line.markupBp as any) ?? {}) }, defaultMarkupBp: est.defaultMarkupBp, taxBp: line.taxable ? est.taxBp : 0, isAllowance: line.isAllowance, isOptional: line.isOptional, included: line.included };
      return { line, input, totals: estimateCalc.calculateLineItem(input) };
    });
    for (const c of computed) {
      const t = { directCostCents: c.totals.directCostCents, markupCents: c.totals.markupCents, sellBeforeTaxCents: c.totals.sellBeforeTaxCents, taxCents: c.totals.taxCents, sellCents: c.totals.sellCents, costByType: c.totals.costByType };
      if (JSON.stringify(c.line.totals) !== JSON.stringify(t)) await tx.update(estimateLineItems).set({ totals: t }).where(eq(estimateLineItems.id, c.line.id));
      c.line.totals = t;
    }
    const sectionTotals = new Map<string, estimateCalc.SectionTotals>();
    for (const s of sections) {
      const st = estimateCalc.sumLineItems(computed.filter((c) => c.line.sectionId === s.id).map((c) => ({ input: c.input, totals: c.totals })));
      sectionTotals.set(s.id, st);
      if (JSON.stringify(s.totals) !== JSON.stringify(st)) await tx.update(estimateSections).set({ totals: st }).where(eq(estimateSections.id, s.id));
      s.totals = st;
    }
    const merged = estimateCalc.mergeTotals([...sectionTotals.values()]);
    const totals = { ...merged, grossMarginBp: estimateCalc.grossMarginBp(merged) };
    if (JSON.stringify(est.totals) !== JSON.stringify(totals)) await tx.update(estimates).set({ totals }).where(eq(estimates.id, est.id));
    est.totals = totals;
    return { lines, sections, totals };
  }

  private async serialize(db: DbOrTx, est: EstimateRow): Promise<contracts.Estimate> {
    const [sections, lines] = await Promise.all([
      db.select().from(estimateSections).where(eq(estimateSections.estimateId, est.id)).orderBy(asc(estimateSections.sortOrder), asc(estimateSections.createdAt)),
      db.select({ l: estimateLineItems, code: costCodes.code }).from(estimateLineItems).leftJoin(costCodes, eq(costCodes.id, estimateLineItems.costCodeId)).where(eq(estimateLineItems.estimateId, est.id)).orderBy(asc(estimateLineItems.sortOrder), asc(estimateLineItems.createdAt)),
    ]);
    const totals = { ...emptyTotals(), ...(est.totals as object) } as contracts.Estimate['totals'];
    return {
      id: est.id, organizationId: est.organizationId, createdAt: est.createdAt, updatedAt: est.updatedAt, createdBy: est.createdBy, updatedBy: est.updatedBy, version: est.version,
      projectId: est.projectId, name: est.name, status: est.status as 'draft' | 'locked', defaultMarkupBp: est.defaultMarkupBp, markupByCostType: (est.markupByCostType as any) ?? {}, taxBp: est.taxBp, notes: est.notes, lockedAt: est.lockedAt, totals,
      sections: sections.map((s) => ({
        id: s.id, organizationId: s.organizationId, createdAt: s.createdAt, updatedAt: s.updatedAt, createdBy: s.createdBy, updatedBy: s.updatedBy, version: s.version, estimateId: s.estimateId, parentId: s.parentId, name: s.name, description: s.description, costCodeId: s.costCodeId, sortOrder: s.sortOrder, clientVisible: s.clientVisible,
        totals: { ...emptyTotals(), ...(s.totals as object) } as any,
        lines: lines.filter((r) => r.l.sectionId === s.id).map(({ l, code }) => serializeLine(l, code)),
      })),
    };
  }
}

function emptyTotals() { return { directCostCents: 0, markupCents: 0, sellBeforeTaxCents: 0, taxCents: 0, sellCents: 0, allowanceCents: 0, grossMarginBp: 0, costByType: { labor: 0, material: 0, subcontract: 0, equipment: 0, other: 0 } }; }

export function serializeLine(l: LineRow, code: string | null): contracts.EstimateLine {
  const t = (l.totals as any) ?? {};
  return { id: l.id, organizationId: l.organizationId, createdAt: l.createdAt, updatedAt: l.updatedAt, createdBy: l.createdBy, updatedBy: l.updatedBy, version: l.version, estimateId: l.estimateId, sectionId: l.sectionId, parentLineId: l.parentLineId, costCodeId: l.costCodeId, costCode: code, catalogItemId: l.catalogItemId, name: l.name, description: l.description, quantityThousandths: l.quantityThousandths, unit: l.unit, unitCostCents: l.unitCostCents as any, markupBp: (l.markupBp as any) ?? null, taxable: l.taxable, isAllowance: l.isAllowance, isOptional: l.isOptional, included: l.included, notes: l.notes, sortOrder: l.sortOrder, clientVisible: l.clientVisible, totals: { directCostCents: t.directCostCents ?? 0, markupCents: t.markupCents ?? 0, sellBeforeTaxCents: t.sellBeforeTaxCents ?? 0, taxCents: t.taxCents ?? 0, sellCents: t.sellCents ?? 0, costByType: t.costByType } };
}

