import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { contracts, ALL_SELECTION_SECTIONS, SELECTION_TEMPLATES } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { approvals, budgetLines, clients, folders, organizations, projects, selectionOptions, selectionSignoffs, selections } from '../db/schema/index.js';
import { renderSelectionSheetHtml } from '../lib/selectionSheetHtml.js';
import type { DocumentService } from './document.service.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import type { ChangeOrderService } from './changeOrder.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import { projectTeamUserIds } from '../lib/recipients.js';
import { contactIdFor, isClientPortal } from '../lib/portal.js';

type Row = typeof selections.$inferSelect;
const CLIENT_VISIBLE = ['released', 'decided'] as const;

/**
 * Selections: the choices a client has to make (tile, fixtures, paint…), each
 * with options priced against an allowance. Choosing an option over the
 * allowance drafts a change order for the difference automatically.
 */
export class SelectionService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService, private readonly changeOrders: ChangeOrderService, private readonly documents: DocumentService) {}

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; status: string }) {
    ctx.require('selections.read');
    const { db } = this.deps;
    const conditions = [eq(selections.organizationId, ctx.organizationId), isNull(selections.archivedAt)];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(selections.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? inArray(selections.projectId, visible) : sql`false`); }
    if (ctx.membership.external) conditions.push(inArray(selections.status, [...CLIENT_VISIBLE]));
    if (query.status === 'open') conditions.push(inArray(selections.status, ['pending', 'released']));
    else if (query.status !== 'all') conditions.push(eq(selections.status, query.status));
    const cursor = decodeCursor<{ k: number; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${selections.sortOrder}, ${selections.id}) > (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select({ s: selections, projectName: projects.name }).from(selections).innerJoin(projects, eq(projects.id, selections.projectId)).where(and(...conditions)).orderBy(asc(selections.sortOrder), asc(selections.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: r.s.sortOrder, id: r.s.id }));
    const ids = result.items.map((r) => r.s.id);
    const [opts, apps] = await Promise.all([this.optionsFor(db, ids), this.approvalsFor(db, ids)]);
    return { items: result.items.map((r) => serializeSelection(r.s, r.projectName, opts.get(r.s.id) ?? [], apps.get(r.s.id) ?? [])), nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.Selection> {
    ctx.require('selections.read');
    const { db } = this.deps;
    const [r] = await db.select({ s: selections, projectName: projects.name }).from(selections).innerJoin(projects, eq(projects.id, selections.projectId)).where(and(eq(selections.id, id), eq(selections.organizationId, ctx.organizationId))).limit(1);
    if (!r) throw AppError.notFound('Selection');
    await ctx.requireProjectAccess(db, r.s.projectId, { allowArchived: true });
    if (ctx.membership.external && !CLIENT_VISIBLE.includes(r.s.status as any)) throw AppError.notFound('Selection');
    const [opts, apps] = await Promise.all([this.optionsFor(db, [id]), this.approvalsFor(db, [id])]);
    return serializeSelection(r.s, r.projectName, opts.get(id) ?? [], apps.get(id) ?? []);
  }

  private async optionsFor(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.Selection['options']>();
    if (!ids.length) return out;
    const rows = await db.select().from(selectionOptions).where(inArray(selectionOptions.selectionId, ids)).orderBy(asc(selectionOptions.sortOrder), asc(selectionOptions.createdAt));
    for (const o of rows) { if (!out.has(o.selectionId)) out.set(o.selectionId, []); out.get(o.selectionId)!.push({ id: o.id, name: o.name, description: o.description, manufacturer: o.manufacturer, model: o.model, finish: o.finish, costCents: o.costCents, priceCents: o.priceCents, sourceUrl: o.sourceUrl, imageDocumentId: o.imageDocumentId, isRecommended: o.isRecommended, sortOrder: o.sortOrder }); }
    return out;
  }

  private async approvalsFor(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.Approval[]>();
    if (!ids.length) return out;
    const rows = await db.select().from(approvals).where(and(eq(approvals.objectType, 'selection'), inArray(approvals.objectId, ids))).orderBy(desc(approvals.requestedAt));
    for (const a of rows) { if (!out.has(a.objectId)) out.set(a.objectId, []); out.get(a.objectId)!.push({ id: a.id, objectType: a.objectType, objectId: a.objectId, status: a.status as contracts.Approval['status'], requestedAt: a.requestedAt, decidedAt: a.decidedAt, decidedByName: a.decidedByName, decisionNote: a.decisionNote, amountCents: a.amountCents, title: a.title }); }
    return out;
  }

  async create(ctx: RequestContext, projectId: string, input: any): Promise<contracts.Selection> {
    ctx.require('selections.write');
    const id = await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      await this.assertBudgetLine(tx, projectId, input.budgetLineId);
      const [mx] = await tx.select({ max: sql<number>`coalesce(max(${selections.sortOrder}), -1)::int` }).from(selections).where(eq(selections.projectId, projectId));
      const [row] = await tx.insert(selections).values({ organizationId: ctx.organizationId, projectId, category: input.category, room: input.room ?? null, name: input.name, description: input.description ?? '', status: 'pending', allowanceCents: input.allowanceCents ?? 0, dueDate: input.dueDate ?? null, budgetLineId: input.budgetLineId ?? null, estimateLineId: input.estimateLineId ?? null, sortOrder: input.sortOrder ?? (mx?.max ?? -1) + 1, section: input.section ?? null, templateKey: input.templateKey ?? null, areas: input.areas ?? [], fields: input.fields ?? [], defaultSpec: input.defaultSpec ?? '', byAllowance: !!input.byAllowance, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.replaceOptions(tx, ctx, row!, input.options ?? []);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'created', objectType: 'selection', objectId: row!.id, objectLabel: `${row!.category}: ${row!.name}` });
      return row!.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, input: any): Promise<contracts.Selection> {
    ctx.require('selections.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status === 'decided') throw AppError.conflict('This selection has been decided. Void it to start over.');
      const { options, ...patch } = input;
      if (patch.budgetLineId) await this.assertBudgetLine(tx, row.projectId, patch.budgetLineId);
      const [after] = await tx.update(selections).set({ ...patch, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${selections.version} + 1` } as any).where(eq(selections.id, id)).returning();
      if (options) await this.replaceOptions(tx, ctx, after!, options);
      const diff = diffRecords(row as any, after as any);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'updated', objectType: 'selection', objectId: id, objectLabel: `${after!.category}: ${after!.name}`, diff: diff ?? (options ? { options: { from: null, to: `${options.length} options` } } : null) });
    });
    return this.get(ctx, id);
  }

  private async load(tx: DbOrTx, ctx: RequestContext, id: string): Promise<Row> {
    const [row] = await tx.select().from(selections).where(and(eq(selections.id, id), eq(selections.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Selection');
    await ctx.requireProjectAccess(tx, row.projectId);
    return row;
  }

  private async assertBudgetLine(tx: DbOrTx, projectId: string, id: string | null | undefined) {
    if (!id) return;
    const [bl] = await tx.select({ id: budgetLines.id }).from(budgetLines).where(and(eq(budgetLines.id, id), eq(budgetLines.projectId, projectId))).limit(1);
    if (!bl) throw AppError.validation('The budget line does not belong to this project.');
  }

  private async replaceOptions(tx: DbOrTx, ctx: RequestContext, row: Row, options: any[]) {
    const existing = await tx.select().from(selectionOptions).where(eq(selectionOptions.selectionId, row.id));
    const keep = new Set(options.map((o) => o.id).filter(Boolean));
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (removed.length) await tx.delete(selectionOptions).where(inArray(selectionOptions.id, removed));
    for (const [i, o] of options.entries()) {
      const values = { name: o.name, description: o.description ?? '', manufacturer: o.manufacturer ?? null, model: o.model ?? null, finish: o.finish ?? null, costCents: o.costCents ?? 0, priceCents: o.priceCents ?? 0, sourceUrl: o.sourceUrl ?? null, imageDocumentId: o.imageDocumentId ?? null, isRecommended: !!o.isRecommended, sortOrder: i, updatedAt: sql`now()`, updatedBy: ctx.userId };
      if (o.id && existing.some((e) => e.id === o.id)) await tx.update(selectionOptions).set(values).where(eq(selectionOptions.id, o.id));
      else await tx.insert(selectionOptions).values({ organizationId: ctx.organizationId, selectionId: row.id, ...values, createdBy: ctx.userId });
    }
  }

  /** Release to the client: they can now see the options and decide in the portal. */
  async release(ctx: RequestContext, id: string): Promise<contracts.Selection> {
    ctx.require('selections.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status !== 'pending') throw AppError.conflict(`A ${row.status} selection cannot be released.`);
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(selectionOptions).where(eq(selectionOptions.selectionId, id));
      if (!n?.n) throw AppError.conflict('Add at least one option before releasing a selection.');
      await tx.insert(approvals).values({ organizationId: ctx.organizationId, projectId: row.projectId, objectType: 'selection', objectId: id, requestedBy: ctx.userId, status: 'pending', amountCents: row.allowanceCents, title: `${row.category}: ${row.name}` });
      await tx.update(selections).set({ status: 'released', releasedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${selections.version} + 1` }).where(eq(selections.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'released', objectType: 'selection', objectId: id, objectLabel: `${row.category}: ${row.name}`, clientVisible: true });
      const team = await projectTeamUserIds(tx, ctx.organizationId, row.projectId);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'approval.requested', title: `Selection released: ${row.name}`, body: `${ctx.actorName} asked the client to choose ${row.name}${row.dueDate ? ` by ${row.dueDate}` : ''}.`, projectId: row.projectId, objectType: 'selection', objectId: id, link: `/projects/${row.projectId}/selections/${id}` });
    });
    return this.get(ctx, id);
  }

  /** The client (or the team on their behalf) picks an option. Over-allowance picks draft a change order. */
  async decide(ctx: RequestContext, id: string, input: { optionId?: string; chosenAreas?: string[]; answers?: Record<string, string>; matchExisting?: boolean; decidedByName?: string; note?: string }): Promise<contracts.Selection> {
    const portal = isClientPortal(ctx);
    if (!portal) ctx.require('selections.write');
    let overageCoId: string | null = null;
    const projectIdRef = { id: '' };
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      projectIdRef.id = row.projectId;
      const allowed = portal ? ['released', 'decided'] : ['released', 'pending', 'decided'];
      if (!allowed.includes(row.status)) throw AppError.conflict(`A ${row.status} selection cannot be decided.`);
      const [pricing] = await tx.select({ n: sql<number>`count(*)::int`, priced: sql<number>`coalesce(sum(case when ${selectionOptions.priceCents} > 0 then 1 else 0 end), 0)::int` }).from(selectionOptions).where(eq(selectionOptions.selectionId, id));
      if (row.status === 'decided') {
        // Unpriced sheet items can be revised until the client signs; priced ones (with change orders) must be voided and redone.
        if ((pricing?.priced ?? 0) > 0 || row.allowanceCents > 0 || row.changeOrderId) throw AppError.conflict('This selection has been decided. Void it to start over.');
        const [signed] = await tx.select({ id: selectionSignoffs.id }).from(selectionSignoffs).where(and(eq(selectionSignoffs.projectId, row.projectId), sql`${selectionSignoffs.signedAt} >= ${row.decidedAt}`)).limit(1);
        if (signed) throw AppError.conflict('This choice is on a signed selections sheet. Ask your builder to reopen it.');
      }
      const optionCount = { n: pricing?.n ?? 0 };
      let option: typeof selectionOptions.$inferSelect | null = null;
      if (input.optionId) {
        [option = null] = await tx.select().from(selectionOptions).where(and(eq(selectionOptions.id, input.optionId), eq(selectionOptions.selectionId, id))).limit(1);
        if (!option) throw AppError.notFound('Option');
      } else if (optionCount?.n) {
        throw AppError.validation('Choose one of the options.');
      }
      const chosenAreas = (input.chosenAreas ?? []).filter((a) => (row.areas as string[]).includes(a));
      const answers: Record<string, string> = {};
      for (const [k, v] of Object.entries(input.answers ?? {})) if (v && v.trim()) answers[k.trim().slice(0, 120)] = v.trim();
      const matchExisting = !!input.matchExisting;
      if (!option && !chosenAreas.length && !Object.keys(answers).length && !matchExisting) throw AppError.validation('Choose an option, tick an item, or write in an answer.');
      const decidedByName = portal ? ctx.actorName : (input.decidedByName ?? ctx.actorName);
      const contactId = await contactIdFor(tx, ctx);
      let [approval] = await tx.select().from(approvals).where(and(eq(approvals.objectType, 'selection'), eq(approvals.objectId, id), eq(approvals.status, 'pending'))).limit(1);
      if (!approval) [approval] = await tx.insert(approvals).values({ organizationId: ctx.organizationId, projectId: row.projectId, objectType: 'selection', objectId: id, requestedBy: ctx.userId, status: 'pending', amountCents: row.allowanceCents, title: `${row.category}: ${row.name}` }).returning();
      const label = option ? option.name : chosenAreas.length ? chosenAreas.join(', ') : matchExisting ? 'match existing' : Object.values(answers).slice(0, 2).join(', ');
      await tx.update(approvals).set({ status: 'approved', decidedByUserId: ctx.userId, decidedByContactId: contactId, decidedByName, decidedAt: sql`now()`, decisionNote: input.note ?? null, amountCents: option?.priceCents ?? 0, ipAddress: ctx.meta.ip ?? null, userAgent: ctx.meta.userAgent ?? null, snapshot: { option: option ? { id: option.id, name: option.name, priceCents: option.priceCents } : null, chosenAreas, answers, matchExisting, allowanceCents: row.allowanceCents } }).where(eq(approvals.id, approval!.id));
      await tx.update(selections).set({ status: 'decided', selectedOptionId: option?.id ?? null, chosenAreas, answers, matchExisting, comment: input.note ?? row.comment, decidedAt: sql`now()`, decisionApprovalId: approval!.id, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${selections.version} + 1` }).where(eq(selections.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'decided', objectType: 'selection', objectId: id, objectLabel: `${row.name} → ${label}`, clientVisible: true, metadata: { optionId: option?.id ?? null, chosenAreas, priceCents: option?.priceCents ?? 0, allowanceCents: row.allowanceCents } });
      const team = await projectTeamUserIds(tx, ctx.organizationId, row.projectId);
      const priced = !!option && (option.priceCents > 0 || row.allowanceCents > 0);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'approval.decided', title: `Selection made: ${row.name}`, body: `${decidedByName} chose ${label}${priced ? ` (${(option!.priceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}${option!.priceCents > row.allowanceCents ? ', over allowance' : ''})` : ''}.`, projectId: row.projectId, objectType: 'selection', objectId: id, link: `/projects/${row.projectId}/selections/${id}` });
      overageCoId = option && option.priceCents > row.allowanceCents ? 'pending' : null;
    });
    if (overageCoId) {
      // Outside the decision transaction: the change order is its own numbered, audited record.
      const sel = await this.get(ctx, id);
      const option = sel.options.find((o) => o.id === input.optionId)!;
      const overage = option.priceCents - sel.allowanceCents;
      const co = await this.changeOrders.createInternal(ctx, sel.projectId, { title: `Selection over allowance: ${sel.name}`, description: `${option.name} was chosen for ${sel.name} at ${(option.priceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} against a ${(sel.allowanceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} allowance.`, reason: 'allowance_overage', scheduleImpactDays: 0, lines: [{ name: `${sel.name}: ${option.name} (over allowance)`, description: '', budgetLineId: sel.budgetLineId, estimateLineId: sel.estimateLineId, quantityThousandths: 1000, unit: 'ea', unitCostCents: { other: overage }, markupBp: { other: 0 }, taxable: false }] });
      await this.deps.db.update(selections).set({ changeOrderId: co.id }).where(eq(selections.id, id));
    }
    return this.get(ctx, id);
  }

  // ---- standard selections sheet ----

  /** The builder's standard selections checklist (flooring, stairs, doors … mechanical). */
  template(ctx: RequestContext) {
    ctx.require('selections.read');
    return { templates: SELECTION_TEMPLATES };
  }

  /** Add the standard checklist to a project. Items already on the project are skipped, so it is safe to run again. */
  async applyTemplate(ctx: RequestContext, projectId: string, input: { templateKey?: string; itemKeys?: string[]; release: boolean; dueDate?: string | null }): Promise<{ created: number; skipped: number; items: contracts.Selection[] }> {
    ctx.require('selections.write');
    const { db } = this.deps;
    await ctx.requireProjectAccess(db, projectId);
    const template = SELECTION_TEMPLATES.find((t) => t.key === (input.templateKey ?? 'checklist'));
    if (!template) throw AppError.notFound('Selections template');
    const wanted = template.sections.flatMap((sec) => sec.items.map((i) => ({ ...i, section: sec }))).filter((i) => !input.itemKeys || input.itemKeys.includes(i.key));
    const existing = new Set((await db.select({ k: selections.templateKey }).from(selections).where(and(eq(selections.projectId, projectId), isNull(selections.archivedAt), sql`${selections.status} <> 'void'`))).map((r) => r.k).filter(Boolean));
    const created: string[] = [];
    await db.transaction(async (tx) => {
      const [mx] = await tx.select({ max: sql<number>`coalesce(max(${selections.sortOrder}), -1)::int` }).from(selections).where(eq(selections.projectId, projectId));
      let sort = (mx?.max ?? -1) + 1;
      for (const i of wanted) {
        if (existing.has(i.key)) continue;
        const [row] = await tx.insert(selections).values({ organizationId: ctx.organizationId, projectId, category: i.section.label, room: null, name: i.name, description: i.note, status: 'pending', allowanceCents: 0, dueDate: input.dueDate ?? null, sortOrder: sort++, section: i.section.key, templateKey: i.key, areas: i.areas, fields: i.fields, defaultSpec: i.defaultSpec, byAllowance: i.byAllowance, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
        if (i.choices.length) await tx.insert(selectionOptions).values(i.choices.map((c, idx) => ({ organizationId: ctx.organizationId, selectionId: row!.id, name: c, description: '', costCents: 0, priceCents: 0, isRecommended: c === i.defaultChoice, sortOrder: idx, createdBy: ctx.userId, updatedBy: ctx.userId })));
        // Released sheet items do not each raise an approval: the client works through the sheet and signs it once.
        if (input.release) await tx.update(selections).set({ status: 'released', releasedAt: sql`now()` }).where(eq(selections.id, row!.id));
        created.push(row!.id);
      }
      if (created.length) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'added', objectType: 'selection', objectLabel: `${created.length} standard selections`, clientVisible: input.release, summary: `${ctx.actorName} added ${created.length} standard selection${created.length === 1 ? '' : 's'}${input.release ? ' and released them to the client' : ''}` });
      if (created.length && input.release) {
        const team = await projectTeamUserIds(tx, ctx.organizationId, projectId);
        await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'approval.requested', title: 'Selections sheet released', body: `${ctx.actorName} asked the client to complete ${created.length} selections.`, projectId, objectType: 'selection', objectId: null, link: `/projects/${projectId}/selections/sheet` });
      }
    });
    const list = await this.list(ctx, { limit: 200, projectId, status: 'all' });
    return { created: created.length, skipped: wanted.length - created.length, items: list.items.filter((s) => created.includes(s.id)) };
  }

  /** The printable selections sheet: every section with its items, what was chosen, and who signed. */
  async sheet(ctx: RequestContext, projectId: string): Promise<contracts.SelectionSheet> {
    ctx.require('selections.read');
    const { db } = this.deps;
    await ctx.requireProjectAccess(db, projectId, { allowArchived: true });
    const [p] = await db.select({ p: projects, clientName: clients.displayName }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.id, projectId)).limit(1);
    if (!p) throw AppError.notFound('Project');
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
    const { items } = await this.list(ctx, { limit: 200, projectId, status: 'all' });
    const live = items.filter((s) => s.status !== 'void');
    const sections = ALL_SELECTION_SECTIONS.map((sec) => ({ key: sec.key, label: sec.label, note: sec.note, items: live.filter((s) => s.section === sec.key).sort((a, b) => sec.items.findIndex((i) => i.key === a.templateKey) - sec.items.findIndex((i) => i.key === b.templateKey)) })).filter((sec) => sec.items.length);
    const other = live.filter((s) => !s.section || !ALL_SELECTION_SECTIONS.some((sec) => sec.key === s.section));
    if (other.length) sections.push({ key: 'other', label: 'Other selections', note: '', items: other });
    const addr = p.p.address as { line1?: string; city?: string; region?: string; postalCode?: string };
    const signoffs = await db.select().from(selectionSignoffs).where(eq(selectionSignoffs.projectId, projectId)).orderBy(desc(selectionSignoffs.signedAt));
    return {
      generatedAt: new Date().toISOString(), company: org?.name ?? 'Buildline',
      project: { id: p.p.id, number: p.p.number, name: p.p.name, clientName: p.clientName ?? null, addressLine: [addr.line1, [addr.city, addr.region].filter(Boolean).join(', '), addr.postalCode].filter(Boolean).join(' · '), startDate: p.p.startDate },
      sections,
      counts: { total: live.length, decided: live.filter((s) => s.status === 'decided').length, released: live.filter((s) => s.status === 'released').length, pending: live.filter((s) => s.status === 'pending').length },
      signoffs: signoffs.map((x) => ({ id: x.id, projectId: x.projectId, signerName: x.signerName, signatureText: x.signatureText, note: x.note, signedAt: x.signedAt, decidedCount: x.decidedCount, byClient: !!x.signedByContactId })),
    };
  }

  /** The client (in the portal) or the team (recording a wet signature) signs the sheet as it stands today. */
  async sign(ctx: RequestContext, projectId: string, input: { signerName: string; signatureText?: string; note?: string }): Promise<contracts.SelectionSheet> {
    const portal = isClientPortal(ctx);
    if (!portal) ctx.require('selections.write');
    const sheet = await this.sheet(ctx, projectId);
    if (sheet.counts.decided === 0) throw AppError.conflict('Nothing has been chosen yet, so there is nothing to sign.');
    const signerName = portal ? ctx.actorName : input.signerName;
    await this.deps.db.transaction(async (tx) => {
      const contactId = await contactIdFor(tx, ctx);
      const snapshot = { generatedAt: sheet.generatedAt, sections: sheet.sections.map((sec) => ({ key: sec.key, label: sec.label, items: sec.items.map((s) => ({ id: s.id, name: s.name, status: s.status, choice: s.options.find((o) => o.id === s.selectedOptionId)?.name ?? null, chosenAreas: s.chosenAreas, defaultSpec: s.defaultSpec })) })) };
      await tx.insert(selectionSignoffs).values({ organizationId: ctx.organizationId, projectId, signerName, signatureText: input.signatureText ?? null, note: input.note ?? '', signedByUserId: ctx.userId, signedByContactId: contactId, ipAddress: ctx.meta.ip ?? null, userAgent: ctx.meta.userAgent ?? null, decidedCount: sheet.counts.decided, snapshot });
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'signed', objectType: 'selection', objectLabel: 'selections sheet', clientVisible: true, summary: `${signerName} signed the selections sheet (${sheet.counts.decided} of ${sheet.counts.total} items decided)`, metadata: { decidedCount: sheet.counts.decided, total: sheet.counts.total } });
      const team = await projectTeamUserIds(tx, ctx.organizationId, projectId);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'approval.decided', title: 'Selections sheet signed', body: `${signerName} signed the selections sheet for ${sheet.project.name}.`, projectId, objectType: 'selection', objectId: null, link: `/projects/${projectId}/selections/sheet` });
    });
    return this.sheet(ctx, projectId);
  }

  /** Save the sheet as it stands into the project's Specifications folder, so the crew, the client and (optionally) subcontractors can read the finished picks. */
  async publish(ctx: RequestContext, projectId: string, input: { vendorVisible: boolean }): Promise<contracts.Document> {
    ctx.require('selections.read');
    ctx.require('documents.write');
    const sheet = await this.sheet(ctx, projectId);
    if (sheet.counts.total === 0) throw AppError.conflict('There are no selections to publish yet.');
    const { db } = this.deps;
    const folderId = await db.transaction(async (tx) => {
      await this.documents.ensureProjectFolders(tx, ctx, projectId);
      const [f] = await tx.select({ id: folders.id }).from(folders).where(and(eq(folders.projectId, projectId), eq(folders.kind, 'specifications'), isNull(folders.archivedAt))).limit(1);
      return f?.id ?? null;
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const html = renderSelectionSheetHtml(sheet);
    const doc = await this.documents.upload(ctx, { stream: new TextEncoder().encode(html), filename: `Selections sheet ${stamp}.html`, contentType: 'text/html' }, { projectId, folderId, name: `Selections sheet (${sheet.counts.decided} of ${sheet.counts.total} decided) ${stamp}`, description: 'Client selections as recorded on this date.', tags: ['selections'], clientVisible: true, vendorVisible: input.vendorVisible });
    await db.transaction(async (tx) => {
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'published', objectType: 'selection', objectLabel: 'selections sheet', clientVisible: true, summary: `${ctx.actorName} published the selections sheet to documents (${sheet.counts.decided} of ${sheet.counts.total} decided)` });
      const team = await projectTeamUserIds(tx, ctx.organizationId, projectId);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'document.shared', title: 'Selections sheet published', body: `${ctx.actorName} saved the client selections for ${sheet.project.name} to Documents → Specifications.`, projectId, objectType: 'document', objectId: doc.id, link: `/projects/${projectId}/documents` });
    });
    return doc;
  }

  async void(ctx: RequestContext, id: string): Promise<contracts.Selection> {
    ctx.require('selections.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      await tx.update(approvals).set({ status: 'cancelled' }).where(and(eq(approvals.objectType, 'selection'), eq(approvals.objectId, id), eq(approvals.status, 'pending')));
      await tx.update(selections).set({ status: 'void', updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${selections.version} + 1` }).where(eq(selections.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'voided', objectType: 'selection', objectId: id, objectLabel: `${row.category}: ${row.name}` });
    });
    return this.get(ctx, id);
  }
}

export function serializeSelection(s: Row, projectName: string | undefined, options: contracts.Selection['options'], apps: contracts.Approval[]): contracts.Selection {
  const chosen = options.find((o) => o.id === s.selectedOptionId);
  const decidedBy = apps.find((a) => a.status === 'approved')?.decidedByName ?? null;
  return { id: s.id, organizationId: s.organizationId, createdAt: s.createdAt, updatedAt: s.updatedAt, createdBy: s.createdBy, updatedBy: s.updatedBy, version: s.version, projectId: s.projectId, projectName, category: s.category, room: s.room, name: s.name, description: s.description, status: s.status as contracts.Selection['status'], allowanceCents: s.allowanceCents, selectedOptionId: s.selectedOptionId, dueDate: s.dueDate, releasedAt: s.releasedAt, decidedAt: s.decidedAt, changeOrderId: s.changeOrderId, budgetLineId: s.budgetLineId, estimateLineId: s.estimateLineId, sortOrder: s.sortOrder, options, overageCents: chosen ? Math.max(0, chosen.priceCents - s.allowanceCents) : 0, approvals: apps,
    section: s.section, templateKey: s.templateKey, areas: (s.areas as string[]) ?? [], chosenAreas: (s.chosenAreas as string[]) ?? [], fields: (s.fields as string[]) ?? [], answers: (s.answers as Record<string, string>) ?? {}, matchExisting: s.matchExisting, comment: s.comment, defaultSpec: s.defaultSpec, byAllowance: s.byAllowance, decidedByName: decidedBy };
}
