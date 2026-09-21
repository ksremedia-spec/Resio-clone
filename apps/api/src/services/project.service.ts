import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, lt } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { approvals, budgetLines, budgets, changeOrders, clients, contacts, dailyLogs, documents, invoices, messageThreads, organizations, projectFavorites, projectMembers, projects, roles, memberships, tasks, threadParticipants, users, vendors, bills, purchaseOrders } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';

const emptyAddress = (): contracts.Address => ({ line1: '', line2: '', city: '', region: '', postalCode: '', country: 'US', latitude: null, longitude: null });
const defaultSharing = { clientCanSeeSchedule: true, clientCanSeeBudget: false, clientCanSeeDailyLogs: true, clientCanSeeDocuments: true, clientCanMessage: true };

export class ProjectService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService) {}

  private baseConditions(ctx: RequestContext, visible: string[] | null) {
    const conditions = [eq(projects.organizationId, ctx.organizationId)];
    if (visible) conditions.push(visible.length ? inArray(projects.id, visible) : sql`false`);
    return conditions;
  }

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; q?: string; status: string; clientId?: string; favorites?: boolean; sort: string }) {
    ctx.require('projects.read');
    const { db } = this.deps;
    const visible = await ctx.visibleProjectIds(db);
    const conditions = this.baseConditions(ctx, visible);
    if (query.status === 'open') conditions.push(inArray(projects.status, ['lead', 'pre_construction', 'active', 'on_hold']), isNull(projects.archivedAt));
    else if (query.status !== 'all') conditions.push(eq(projects.status, query.status));
    if (query.status !== 'archived' && query.status !== 'all') conditions.push(isNull(projects.archivedAt));
    if (query.clientId) conditions.push(eq(projects.clientId, query.clientId));
    if (query.q) conditions.push(or(ilike(projects.name, `%${query.q}%`), ilike(projects.number, `%${query.q}%`), sql`to_tsvector('simple', ${projects.searchText}) @@ plainto_tsquery('simple', ${query.q})`)!);
    if (query.favorites) conditions.push(sql`exists (select 1 from ${projectFavorites} where ${projectFavorites.projectId} = ${projects.id} and ${projectFavorites.userId} = ${ctx.userId})`);
    const [field, dir] = query.sort.split(':') as [string, 'asc' | 'desc'];
    const col = field === 'name' ? projects.name : field === 'number' ? projects.number : field === 'startDate' ? projects.startDate : projects.updatedAt;
    const cursor = decodeCursor<{ k: string | null; id: string }>(query.cursor);
    if (cursor) conditions.push(dir === 'asc' ? sql`(${col}, ${projects.id}) > (${cursor.k}, ${cursor.id}::uuid)` : sql`(${col}, ${projects.id}) < (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select({ p: projects, clientName: clients.displayName, isFavorite: sql<boolean>`exists (select 1 from ${projectFavorites} where ${projectFavorites.projectId} = ${projects.id} and ${projectFavorites.userId} = ${ctx.userId})` })
      .from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(and(...conditions))
      .orderBy(dir === 'asc' ? asc(col) : desc(col), dir === 'asc' ? asc(projects.id) : desc(projects.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: (r.p as any)[field] ?? null, id: r.p.id }));
    return { items: result.items.map((r) => serializeProjectSummary(r.p, r.clientName, r.isFavorite)), nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.ProjectDetail> {
    ctx.require('projects.read');
    const { db } = this.deps;
    await ctx.requireProjectAccess(db, id, { allowArchived: true });
    const [row] = await db.select({ p: projects, clientName: clients.displayName, isFavorite: sql<boolean>`exists (select 1 from ${projectFavorites} where ${projectFavorites.projectId} = ${projects.id} and ${projectFavorites.userId} = ${ctx.userId})` })
      .from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.id, id)).limit(1);
    if (!row) throw AppError.notFound('Project');
    const [members, counts, financials] = await Promise.all([this.members(db, id), this.counts(ctx, db, id), this.financials(db, id, row.p.contractValueCents)]);
    return { ...serializeProjectSummary(row.p, row.clientName, row.isFavorite), description: row.p.description, sharing: { ...defaultSharing, ...(row.p.sharing as object) }, members, counts, financials };
  }

  private async members(db: DbOrTx, projectId: string): Promise<contracts.ProjectMember[]> {
    const rows = await db.select({ pm: projectMembers, u: users, c: contacts, v: vendors, roleName: roles.name }).from(projectMembers)
      .leftJoin(users, eq(users.id, projectMembers.userId))
      .leftJoin(contacts, eq(contacts.id, projectMembers.contactId))
      .leftJoin(vendors, eq(vendors.id, projectMembers.vendorId))
      .leftJoin(memberships, and(eq(memberships.userId, projectMembers.userId), eq(memberships.organizationId, projectMembers.organizationId)))
      .leftJoin(roles, eq(roles.id, memberships.roleId))
      .where(eq(projectMembers.projectId, projectId)).orderBy(asc(projectMembers.createdAt));
    return rows.map(({ pm, u, c, v, roleName }) => ({
      id: pm.id, projectId: pm.projectId, userId: pm.userId, contactId: pm.contactId, vendorId: pm.vendorId, accessLevel: pm.accessLevel as contracts.ProjectMember['accessLevel'],
      displayName: u ? `${u.firstName} ${u.lastName}` : c ? `${c.firstName} ${c.lastName}`.trim() : v?.name ?? 'Unknown',
      email: u?.email ?? c?.email ?? v?.email ?? null, roleName: u ? roleName : c ? 'Client contact' : 'Vendor', kind: u ? 'user' : c ? 'client_contact' : 'vendor', createdAt: pm.createdAt,
    }));
  }

  private async counts(ctx: RequestContext, db: DbOrTx, projectId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const [t] = await db.select({ open: sql<number>`count(*) filter (where ${tasks.status} not in ('complete','cancelled'))::int`, overdue: sql<number>`count(*) filter (where ${tasks.status} not in ('complete','cancelled') and coalesce(${tasks.dueDate}, ${tasks.endDate}) < ${today})::int` }).from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt)));
    const [d] = await db.select({ n: count() }).from(dailyLogs).where(and(eq(dailyLogs.projectId, projectId), isNull(dailyLogs.archivedAt)));
    const [doc] = await db.select({ n: count() }).from(documents).where(and(eq(documents.projectId, projectId), isNull(documents.archivedAt)));
    const [a] = await db.select({ n: count() }).from(approvals).where(and(eq(approvals.projectId, projectId), eq(approvals.status, 'pending')));
    const [m] = await db.select({ n: sql<number>`coalesce(sum(case when ${threadParticipants.lastReadAt} is null or ${threadParticipants.lastReadAt} < ${messageThreads.lastMessageAt} then 1 else 0 end), 0)::int` })
      .from(threadParticipants).innerJoin(messageThreads, eq(messageThreads.id, threadParticipants.threadId))
      .where(and(eq(messageThreads.projectId, projectId), eq(threadParticipants.userId, ctx.userId), sql`${messageThreads.lastMessageAt} is not null`));
    return { openTasks: t?.open ?? 0, overdueTasks: t?.overdue ?? 0, dailyLogs: d?.n ?? 0, documents: doc?.n ?? 0, unreadMessages: m?.n ?? 0, pendingApprovals: a?.n ?? 0 };
  }

  async financials(db: DbOrTx, projectId: string, contractValueCents: number) {
    const [co] = await db.select({ n: sql<number>`coalesce(sum(${changeOrders.totalCents}), 0)::bigint` }).from(changeOrders).where(and(eq(changeOrders.projectId, projectId), eq(changeOrders.status, 'approved')));
    const [inv] = await db.select({ invoiced: sql<number>`coalesce(sum(${invoices.totalCents}), 0)::bigint`, paid: sql<number>`coalesce(sum(${invoices.paidCents}), 0)::bigint` }).from(invoices).where(and(eq(invoices.projectId, projectId), sql`${invoices.status} not in ('draft','void')`));
    const [b] = await db.select({ original: sql<number>`coalesce(sum(${budgetLines.originalCostCents}), 0)::bigint` }).from(budgetLines).where(eq(budgetLines.projectId, projectId));
    const [committed] = await db.select({ n: sql<number>`coalesce(sum(${purchaseOrders.totalCents} - ${purchaseOrders.billedCents}), 0)::bigint` }).from(purchaseOrders).where(and(eq(purchaseOrders.projectId, projectId), inArray(purchaseOrders.status, ['approved', 'committed', 'matched'])));
    const [actual] = await db.select({ n: sql<number>`coalesce(sum(${bills.totalCents}), 0)::bigint` }).from(bills).where(and(eq(bills.projectId, projectId), inArray(bills.status, ['approved', 'scheduled', 'paid'])));
    const approvedChanges = Number(co?.n ?? 0);
    const invoiced = Number(inv?.invoiced ?? 0);
    const paid = Number(inv?.paid ?? 0);
    const budgetOriginal = Number(b?.original ?? 0);
    return {
      contractValueCents, approvedChangesCents: approvedChanges, revisedContractCents: contractValueCents + approvedChanges,
      invoicedCents: invoiced, paidCents: paid, outstandingCents: invoiced - paid,
      budgetOriginalCents: budgetOriginal, budgetRevisedCents: budgetOriginal + approvedChanges, committedCents: Number(committed?.n ?? 0), actualCents: Number(actual?.n ?? 0),
    };
  }

  async create(ctx: RequestContext, input: { name: string; number?: string; status: string; type: string; contractType: string; clientId?: string | null; address?: Partial<contracts.Address>; color?: string; description: string; startDate?: string | null; targetEndDate?: string | null; contractValueCents: number; memberUserIds?: string[]; sharing?: Partial<typeof defaultSharing> }): Promise<contracts.ProjectDetail> {
    ctx.require('projects.write');
    const id = await this.deps.db.transaction(async (tx) => {
      if (input.clientId) {
        const [c] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.organizationId, ctx.organizationId))).limit(1);
        if (!c) throw AppError.notFound('Client');
      }
      let number = input.number?.trim();
      if (!number) {
        const [org] = await tx.update(organizations).set({ nextProjectNumber: sql`${organizations.nextProjectNumber} + 1` }).where(eq(organizations.id, ctx.organizationId)).returning({ n: organizations.nextProjectNumber });
        number = String(org!.n - 1);
      } else {
        const [clash] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.number, number))).limit(1);
        if (clash) throw AppError.conflict(`Project number ${number} is already in use.`);
      }
      const address = { ...emptyAddress(), ...(input.address ?? {}) };
      const [row] = await tx.insert(projects).values({
        organizationId: ctx.organizationId, number, name: input.name, status: input.status, type: input.type, contractType: input.contractType, clientId: input.clientId ?? null,
        address, color: input.color ?? pickColor(input.name), description: input.description, startDate: input.startDate ?? null, targetEndDate: input.targetEndDate ?? null,
        contractValueCents: input.contractValueCents, sharing: { ...defaultSharing, ...(input.sharing ?? {}) }, searchText: searchTextFor(input.name, number, address, input.description),
        createdBy: ctx.userId, updatedBy: ctx.userId, lastActivityAt: sql`now()`,
      }).returning();
      const memberIds = new Set([ctx.userId, ...(input.memberUserIds ?? [])]);
      const validMembers = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, ctx.organizationId), inArray(memberships.userId, [...memberIds])));
      await tx.insert(projectMembers).values(validMembers.map((m) => ({ organizationId: ctx.organizationId, projectId: row!.id, userId: m.userId, accessLevel: m.userId === ctx.userId ? 'manager' : 'member', createdBy: ctx.userId })));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row!.id, verb: 'created', objectType: 'project', objectId: row!.id, objectLabel: `${row!.number} ${row!.name}`, clientVisible: true });
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: validMembers.map((m) => m.userId), excludeUserId: ctx.userId, kind: 'member.joined', title: `You were added to ${row!.name}`, body: `${ctx.actorName} added you to project ${row!.number} ${row!.name}.`, projectId: row!.id, objectType: 'project', objectId: row!.id, link: `/projects/${row!.id}` });
      return row!.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, input: Record<string, unknown> & { expectedVersion?: number }): Promise<contracts.ProjectDetail> {
    ctx.require('projects.write');
    await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, id, { allowArchived: true });
      const [before] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
      if (!before) throw AppError.notFound('Project');
      if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) throw AppError.versionConflict({ currentVersion: before.version });
      const { expectedVersion: _v, ...rest } = input;
      const patch: Record<string, unknown> = { ...rest, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${projects.version} + 1` };
      if (rest.address) patch.address = { ...(before.address as object), ...(rest.address as object) };
      if (rest.sharing) patch.sharing = { ...(before.sharing as object), ...(rest.sharing as object) };
      if (rest.number !== undefined && rest.number !== before.number) {
        const [clash] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.number, String(rest.number)), sql`${projects.id} <> ${id}`)).limit(1);
        if (clash) throw AppError.conflict(`Project number ${rest.number} is already in use.`);
      }
      if (rest.clientId) {
        const [c] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, rest.clientId as string), eq(clients.organizationId, ctx.organizationId))).limit(1);
        if (!c) throw AppError.notFound('Client');
      }
      const merged = { ...before, ...patch } as typeof before;
      patch.searchText = searchTextFor(merged.name, merged.number, (patch.address as any) ?? before.address, merged.description);
      const [after] = await tx.update(projects).set(patch as any).where(eq(projects.id, id)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: id, verb: 'updated', objectType: 'project', objectId: id, objectLabel: `${after!.number} ${after!.name}`, diff, clientVisible: !!(diff.name || diff.startDate || diff.targetEndDate || diff.status) });
    });
    return this.get(ctx, id);
  }

  async archive(ctx: RequestContext, id: string, archived: boolean): Promise<contracts.ProjectDetail> {
    ctx.require('projects.archive');
    await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, id, { allowArchived: true });
      if (archived) {
        const [open] = await tx.select({ n: count() }).from(invoices).where(and(eq(invoices.projectId, id), inArray(invoices.status, ['sent', 'viewed', 'partially_paid', 'overdue'])));
        if ((open?.n ?? 0) > 0) throw AppError.conflict('This project has unpaid invoices. Resolve them before archiving.');
      }
      const [row] = await tx.update(projects).set({ archivedAt: archived ? sql`now()` : null, status: archived ? 'archived' : 'complete', updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${projects.version} + 1` }).where(eq(projects.id, id)).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: id, verb: archived ? 'archived' : 'restored', objectType: 'project', objectId: id, objectLabel: `${row!.number} ${row!.name}` });
    });
    return this.get(ctx, id);
  }

  async setFavorite(ctx: RequestContext, id: string, favorite: boolean) {
    ctx.require('projects.read');
    await ctx.requireProjectAccess(this.deps.db, id, { allowArchived: true });
    if (favorite) await this.deps.db.insert(projectFavorites).values({ userId: ctx.userId, projectId: id }).onConflictDoNothing();
    else await this.deps.db.delete(projectFavorites).where(and(eq(projectFavorites.userId, ctx.userId), eq(projectFavorites.projectId, id)));
    return { isFavorite: favorite };
  }

  async addMember(ctx: RequestContext, projectId: string, input: { userId?: string; contactId?: string; vendorId?: string; accessLevel: string }): Promise<contracts.ProjectMember[]> {
    ctx.require('projects.write');
    await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      let label = '';
      if (input.userId) {
        const [m] = await tx.select({ u: users }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, input.userId))).limit(1);
        if (!m) throw AppError.notFound('Member');
        label = `${m.u.firstName} ${m.u.lastName}`;
      } else if (input.contactId) {
        const [c] = await tx.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.organizationId, ctx.organizationId))).limit(1);
        if (!c) throw AppError.notFound('Contact');
        label = `${c.firstName} ${c.lastName}`;
      } else if (input.vendorId) {
        const [v] = await tx.select().from(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.organizationId, ctx.organizationId))).limit(1);
        if (!v) throw AppError.notFound('Vendor');
        label = v.name;
      }
      const [row] = await tx.insert(projectMembers).values({ organizationId: ctx.organizationId, projectId, userId: input.userId ?? null, contactId: input.contactId ?? null, vendorId: input.vendorId ?? null, accessLevel: input.accessLevel, createdBy: ctx.userId }).onConflictDoNothing().returning();
      if (row) {
        const [p] = await tx.select({ name: projects.name, number: projects.number }).from(projects).where(eq(projects.id, projectId)).limit(1);
        await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'added', objectType: 'project_member', objectId: row.id, objectLabel: label });
        if (input.userId) await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: [input.userId], excludeUserId: ctx.userId, kind: 'member.joined', title: `You were added to ${p!.name}`, body: `${ctx.actorName} added you to project ${p!.number} ${p!.name}.`, projectId, objectType: 'project', objectId: projectId, link: `/projects/${projectId}` });
      }
    });
    return this.members(this.deps.db, projectId);
  }

  async removeMember(ctx: RequestContext, projectId: string, memberId: string): Promise<contracts.ProjectMember[]> {
    ctx.require('projects.write');
    await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const [row] = await tx.delete(projectMembers).where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId))).returning();
      if (!row) throw AppError.notFound('Project member');
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'removed', objectType: 'project_member', objectId: memberId });
    });
    return this.members(this.deps.db, projectId);
  }

  /** Users who should be notified about project-level events (internal members). */
  async memberUserIds(db: DbOrTx, projectId: string): Promise<string[]> {
    const rows = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), sql`${projectMembers.userId} is not null`));
    return rows.map((r) => r.userId!) ;
  }
}

function pickColor(seed: string): string {
  const palette = ['#2F6FED', '#0F9D8A', '#D97706', '#7C3AED', '#DB2777', '#059669', '#DC2626', '#0891B2'];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}

function searchTextFor(name: string, number: string, address: Record<string, unknown>, description: string): string {
  return [name, number, address.line1, address.city, address.region, address.postalCode, description].filter(Boolean).join(' ');
}

export function serializeProjectSummary(p: typeof projects.$inferSelect, clientName: string | null, isFavorite: boolean): contracts.ProjectSummary {
  return {
    id: p.id, organizationId: p.organizationId, createdAt: p.createdAt, updatedAt: p.updatedAt, createdBy: p.createdBy, updatedBy: p.updatedBy, version: p.version,
    number: p.number, name: p.name, status: p.status as contracts.ProjectSummary['status'], type: p.type as contracts.ProjectSummary['type'], contractType: p.contractType as contracts.ProjectSummary['contractType'],
    clientId: p.clientId, clientName, address: { ...emptyAddress(), ...(p.address as object) }, color: p.color, startDate: p.startDate, targetEndDate: p.targetEndDate, actualEndDate: p.actualEndDate,
    contractValueCents: p.contractValueCents, isFavorite, archivedAt: p.archivedAt, lastActivityAt: p.lastActivityAt,
  };
}

export { lt, budgets };
