import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { clients, leadActivities, leads, projects, users } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import type { ProjectService } from './project.service.js';
import type { ClientService } from './client.service.js';

const emptyAddress = (): contracts.Address => ({ line1: '', line2: '', city: '', region: '', postalCode: '', country: 'US', latitude: null, longitude: null });
type LeadRow = typeof leads.$inferSelect;

/**
 * Leads / CRM. A lead is a prospective job; it moves through stages until it
 * is won (converted into a client + project) or lost. Every stage move and
 * touch point is recorded so the pipeline report has a history to work from.
 */
export class LeadService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly projectsService: ProjectService, private readonly clientsService: ClientService) {}

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; stage: string; q?: string; ownerUserId?: string; includeArchived: boolean }) {
    ctx.require('leads.read');
    const { db } = this.deps;
    const conditions = [eq(leads.organizationId, ctx.organizationId)];
    if (!query.includeArchived) conditions.push(isNull(leads.archivedAt));
    if (query.stage === 'open') conditions.push(inArray(leads.stage, [...contracts.OPEN_LEAD_STAGES]));
    else if (query.stage === 'closed') conditions.push(inArray(leads.stage, ['won', 'lost']));
    else if (query.stage !== 'all') conditions.push(eq(leads.stage, query.stage));
    if (query.ownerUserId) conditions.push(eq(leads.ownerUserId, query.ownerUserId));
    if (query.q) conditions.push(or(ilike(leads.name, `%${query.q}%`), ilike(leads.contactName, `%${query.q}%`), ilike(leads.contactEmail, `%${query.q}%`), ilike(leads.notes, `%${query.q}%`))!);
    const cursor = decodeCursor<{ k: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${leads.updatedAt}, ${leads.id}) < (${cursor.k}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await this.baseQuery(db).where(and(...conditions)).orderBy(desc(leads.updatedAt), desc(leads.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: r.l.updatedAt, id: r.l.id }));
    return { items: result.items.map((r) => serializeLead(r.l, r)), nextCursor: result.nextCursor };
  }

  /** Kanban view: every open lead grouped by stage, plus the won/lost columns for the last 90 days. */
  async board(ctx: RequestContext): Promise<{ columns: Array<{ stage: contracts.LeadStage; count: number; valueCents: number; leads: contracts.Lead[] }> }> {
    ctx.require('leads.read');
    const rows = await this.baseQuery(this.deps.db).where(and(eq(leads.organizationId, ctx.organizationId), isNull(leads.archivedAt), or(inArray(leads.stage, [...contracts.OPEN_LEAD_STAGES]), sql`${leads.updatedAt} > now() - interval '90 days'`)!)).orderBy(asc(leads.sortOrder), desc(leads.updatedAt));
    const columns = contracts.LEAD_STAGES.map((stage) => {
      const items = rows.filter((r) => r.l.stage === stage).map((r) => serializeLead(r.l, r));
      return { stage, count: items.length, valueCents: items.reduce((n, l) => n + (l.estimatedValueCents ?? 0), 0), leads: items };
    });
    return { columns };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.Lead> {
    ctx.require('leads.read');
    const { db } = this.deps;
    const [row] = await this.baseQuery(db).where(and(eq(leads.id, id), eq(leads.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Lead');
    const acts = await db.select({ a: leadActivities, firstName: users.firstName, lastName: users.lastName }).from(leadActivities).leftJoin(users, eq(users.id, leadActivities.createdBy)).where(eq(leadActivities.leadId, id)).orderBy(desc(leadActivities.occurredAt));
    return serializeLead(row.l, row, acts.map(({ a, firstName, lastName }) => ({ id: a.id, leadId: a.leadId, kind: a.kind as contracts.LeadActivity['kind'], body: a.body, occurredAt: a.occurredAt, dueAt: a.dueAt, completedAt: a.completedAt, createdBy: a.createdBy, createdByName: firstName ? `${firstName} ${lastName ?? ''}`.trim() : null })));
  }

  async create(ctx: RequestContext, input: Record<string, any>): Promise<contracts.Lead> {
    ctx.require('leads.write');
    const id = await this.deps.db.transaction(async (tx) => {
      if (input.clientId) await this.assertClient(tx, ctx, input.clientId);
      const [row] = await tx.insert(leads).values({
        organizationId: ctx.organizationId, name: input.name, clientId: input.clientId ?? null, contactName: input.contactName ?? null, contactEmail: input.contactEmail ?? null, contactPhone: input.contactPhone ?? null,
        address: { ...emptyAddress(), ...(input.address ?? {}) }, source: input.source ?? null, stage: input.stage ?? 'new', projectType: input.projectType ?? null,
        estimatedValueCents: input.estimatedValueCents ?? 0, budgetRangeLowCents: input.budgetRangeLowCents ?? 0, budgetRangeHighCents: input.budgetRangeHighCents ?? 0,
        targetStartDate: input.targetStartDate ?? null, ownerUserId: input.ownerUserId ?? ctx.userId, notes: input.notes ?? '', nextFollowUpAt: input.nextFollowUpAt ?? null,
        createdBy: ctx.userId, updatedBy: ctx.userId,
      }).returning();
      await tx.insert(leadActivities).values({ organizationId: ctx.organizationId, leadId: row!.id, kind: 'stage', body: `Lead created in stage ${humanStage(row!.stage)}.`, createdBy: ctx.userId, updatedBy: ctx.userId });
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'created', objectType: 'lead', objectId: row!.id, objectLabel: row!.name, metadata: { stage: row!.stage, estimatedValueCents: row!.estimatedValueCents } });
      return row!.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, input: Record<string, unknown>): Promise<contracts.Lead> {
    ctx.require('leads.write');
    await this.deps.db.transaction(async (tx) => {
      const before = await this.load(tx, ctx, id);
      if (input.clientId) await this.assertClient(tx, ctx, input.clientId as string);
      const { stage, ...rest } = input;
      const patch: Record<string, unknown> = { ...rest, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${leads.version} + 1` };
      for (const k of ['estimatedValueCents', 'budgetRangeLowCents', 'budgetRangeHighCents']) if (k in patch && patch[k] == null) patch[k] = 0;
      if (input.address) patch.address = { ...(before.address as object), ...(input.address as object) };
      const [after] = await tx.update(leads).set(patch as any).where(eq(leads.id, id)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'updated', objectType: 'lead', objectId: id, objectLabel: after!.name, diff });
      if (stage && stage !== before.stage) await this.moveTx(tx, ctx, after!, stage as contracts.LeadStage, undefined);
    });
    return this.get(ctx, id);
  }

  /** Move to another stage. Won leads must be converted (that sets the stage); lost leads take a reason. */
  async move(ctx: RequestContext, id: string, input: { stage: contracts.LeadStage; lostReason?: string }): Promise<contracts.Lead> {
    ctx.require('leads.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (input.stage === 'won' && !row.convertedProjectId) throw AppError.conflict('Convert the lead into a project to mark it won.');
      await this.moveTx(tx, ctx, row, input.stage, input.lostReason);
    });
    return this.get(ctx, id);
  }

  private async moveTx(tx: DbOrTx, ctx: RequestContext, row: LeadRow, stage: contracts.LeadStage, lostReason: string | undefined) {
    if (row.stage === stage) return;
    await tx.update(leads).set({ stage, lostReason: stage === 'lost' ? (lostReason ?? row.lostReason ?? null) : null, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${leads.version} + 1` }).where(eq(leads.id, row.id));
    await tx.insert(leadActivities).values({ organizationId: ctx.organizationId, leadId: row.id, kind: 'stage', body: `Moved from ${humanStage(row.stage)} to ${humanStage(stage)}${stage === 'lost' && lostReason ? ` — ${lostReason}` : ''}.`, createdBy: ctx.userId, updatedBy: ctx.userId });
    await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : 'moved', objectType: 'lead', objectId: row.id, objectLabel: row.name, diff: { stage: { from: row.stage, to: stage } }, metadata: { stage, estimatedValueCents: row.estimatedValueCents, lostReason: lostReason ?? null } });
  }

  async addActivity(ctx: RequestContext, id: string, input: { kind: string; body: string; dueAt?: string | null }): Promise<contracts.Lead> {
    ctx.require('leads.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      await tx.insert(leadActivities).values({ organizationId: ctx.organizationId, leadId: id, kind: input.kind, body: input.body, dueAt: input.dueAt ?? null, createdBy: ctx.userId, updatedBy: ctx.userId });
      const patch: Record<string, unknown> = { updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${leads.version} + 1` };
      if (input.dueAt) patch.nextFollowUpAt = input.dueAt;
      else if (row.nextFollowUpAt && new Date(row.nextFollowUpAt).getTime() <= Date.now()) patch.nextFollowUpAt = null;
      await tx.update(leads).set(patch as any).where(eq(leads.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'logged', objectType: 'lead', objectId: id, objectLabel: row.name, metadata: { kind: input.kind }, summary: `${ctx.actorName} logged a ${input.kind} on ${row.name}` });
    });
    return this.get(ctx, id);
  }

  async completeActivity(ctx: RequestContext, id: string, activityId: string): Promise<contracts.Lead> {
    ctx.require('leads.write');
    await this.deps.db.transaction(async (tx) => {
      await this.load(tx, ctx, id);
      const [a] = await tx.update(leadActivities).set({ completedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId }).where(and(eq(leadActivities.id, activityId), eq(leadActivities.leadId, id))).returning();
      if (!a) throw AppError.notFound('Activity');
    });
    return this.get(ctx, id);
  }

  /** Win the lead: create the client (unless one is chosen) and the project, link them, and mark the lead won. */
  async convert(ctx: RequestContext, id: string, input: { projectName?: string; clientId?: string | null; contractValueCents?: number; startDate?: string | null; type?: string }): Promise<{ lead: contracts.Lead; project: contracts.ProjectDetail }> {
    ctx.require('leads.write');
    ctx.require('projects.write');
    const { db } = this.deps;
    const row = await this.load(db, ctx, id);
    if (row.convertedProjectId) throw AppError.conflict('This lead has already been converted.');
    let clientId = input.clientId ?? row.clientId ?? null;
    if (!clientId) {
      ctx.require('clients.write');
      const [first, ...restName] = (row.contactName ?? row.name).split(/\s+/);
      const client = await this.clientsService.create(ctx, { displayName: row.contactName ?? row.name, email: row.contactEmail ?? null, phone: row.contactPhone ?? null, billingAddress: row.address as Partial<contracts.Address>, notes: row.notes ? `From lead: ${row.notes}` : '', contacts: row.contactName ? [{ firstName: first ?? row.contactName, lastName: restName.join(' '), email: row.contactEmail ?? null, phone: row.contactPhone ?? null, isPrimary: true, notes: '' }] : undefined });
      clientId = client.id;
    }
    const project = await this.projectsService.create(ctx, { name: input.projectName ?? row.name, status: 'pre_construction', type: normalizeType(input.type ?? row.projectType), contractType: 'fixed_price', clientId, address: row.address as Partial<contracts.Address>, description: row.notes, startDate: input.startDate ?? row.targetStartDate ?? null, contractValueCents: input.contractValueCents ?? row.estimatedValueCents ?? 0, memberUserIds: row.ownerUserId ? [row.ownerUserId] : [] });
    await db.transaction(async (tx) => {
      await tx.update(leads).set({ clientId, convertedProjectId: project.id, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${leads.version} + 1` }).where(eq(leads.id, id));
      await this.moveTx(tx, ctx, { ...row, convertedProjectId: project.id }, 'won', undefined);
    });
    return { lead: await this.get(ctx, id), project };
  }

  async archive(ctx: RequestContext, id: string, archived: boolean): Promise<contracts.Lead> {
    ctx.require('leads.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.load(tx, ctx, id);
      await tx.update(leads).set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${leads.version} + 1` }).where(eq(leads.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: archived ? 'archived' : 'restored', objectType: 'lead', objectId: id, objectLabel: row.name });
    });
    return this.get(ctx, id);
  }

  /** Leads whose follow-up is due, for the dashboard and the scheduled automation check. */
  async followUpsDue(db: DbOrTx, organizationId: string): Promise<LeadRow[]> {
    return db.select().from(leads).where(and(eq(leads.organizationId, organizationId), isNull(leads.archivedAt), inArray(leads.stage, [...contracts.OPEN_LEAD_STAGES]), sql`${leads.nextFollowUpAt} <= now()`));
  }

  private baseQuery(db: DbOrTx) {
    return db.select({ l: leads, clientName: clients.displayName, ownerFirst: users.firstName, ownerLast: users.lastName, projectName: projects.name, lastStageAt: sql<string | null>`(select max(occurred_at) from lead_activities la where la.lead_id = ${leads.id} and la.kind = 'stage')` })
      .from(leads).leftJoin(clients, eq(clients.id, leads.clientId)).leftJoin(users, eq(users.id, leads.ownerUserId)).leftJoin(projects, eq(projects.id, leads.convertedProjectId));
  }

  private async load(db: DbOrTx, ctx: RequestContext, id: string): Promise<LeadRow> {
    const [row] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Lead');
    return row;
  }

  private async assertClient(db: DbOrTx, ctx: RequestContext, clientId: string) {
    const [c] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.organizationId, ctx.organizationId))).limit(1);
    if (!c) throw AppError.notFound('Client');
  }
}

const humanStage = (s: string) => s.replace(/_/g, ' ');
function normalizeType(t: string | null | undefined): string {
  const allowed = ['remodel', 'new_construction', 'addition', 'commercial', 'service', 'other'];
  return t && allowed.includes(t) ? t : 'remodel';
}

export function serializeLead(row: LeadRow, extra: { clientName?: string | null; ownerFirst?: string | null; ownerLast?: string | null; projectName?: string | null; lastStageAt?: string | null }, activities?: contracts.LeadActivity[]): contracts.Lead {
  const since = extra.lastStageAt ?? row.createdAt;
  return {
    id: row.id, organizationId: row.organizationId, createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy, version: row.version,
    name: row.name, clientId: row.clientId, clientName: extra.clientName ?? null, contactName: row.contactName, contactEmail: row.contactEmail, contactPhone: row.contactPhone,
    address: { ...emptyAddress(), ...(row.address as object) }, source: row.source, stage: row.stage as contracts.LeadStage, projectType: row.projectType,
    estimatedValueCents: row.estimatedValueCents, budgetRangeLowCents: row.budgetRangeLowCents, budgetRangeHighCents: row.budgetRangeHighCents, targetStartDate: row.targetStartDate,
    ownerUserId: row.ownerUserId, ownerName: extra.ownerFirst ? `${extra.ownerFirst} ${extra.ownerLast ?? ''}`.trim() : null, notes: row.notes, nextFollowUpAt: row.nextFollowUpAt,
    convertedProjectId: row.convertedProjectId, convertedProjectName: extra.projectName ?? null, lostReason: row.lostReason, archivedAt: row.archivedAt,
    daysInStage: Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000)),
    ...(activities ? { activities } : {}),
  };
}
