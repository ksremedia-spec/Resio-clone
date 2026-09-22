import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { activityLog, approvals, invoices, messageThreads, projects, tasks, threadParticipants } from '../db/schema/index.js';
import type { RequestContext } from '../lib/context.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import type { ProjectService } from './project.service.js';
import { isClientPortal } from '../lib/portal.js';

const LINKS: Record<string, (projectId: string | null, id: string) => string> = {
  proposal: (p, id) => `/projects/${p}/proposals/${id}`,
  change_order: (p, id) => `/projects/${p}/change-orders/${id}`,
  selection: (p, id) => `/projects/${p}/selections/${id}`,
  invoice: (p, id) => `/projects/${p}/invoices/${id}`,
  time_entry: (p) => `/projects/${p}/time`,
};

/** What a homeowner sees when they open the app, and the approvals queue for everyone. */
export class PortalService {
  constructor(private readonly deps: Deps, private readonly projects: ProjectService) {}

  async listApprovals(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; status: string }) {
    if (!ctx.hasAnyApprovalRead()) ctx.require('change_orders.read');
    const { db } = this.deps;
    const conditions = [eq(approvals.organizationId, ctx.organizationId)];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(approvals.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? inArray(approvals.projectId, visible) : sql`false`); }
    const readable = (['proposal', 'change_order', 'selection', 'invoice'] as const).filter((t) => ctx.has(`${t === 'proposal' ? 'proposals' : t === 'change_order' ? 'change_orders' : t === 'selection' ? 'selections' : 'invoices'}.read` as any));
    conditions.push(inArray(approvals.objectType, ctx.has('time.approve') ? [...readable, 'time_entry'] : [...readable]));
    if (query.status === 'pending') conditions.push(eq(approvals.status, 'pending'));
    else if (query.status === 'decided') conditions.push(inArray(approvals.status, ['approved', 'declined']));
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${approvals.requestedAt}, ${approvals.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await db.select({ a: approvals, projectName: projects.name }).from(approvals).leftJoin(projects, eq(projects.id, approvals.projectId)).where(and(...conditions)).orderBy(desc(approvals.requestedAt), desc(approvals.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.a.requestedAt, id: r.a.id }));
    return { items: result.items.map((r) => serializeApproval(r.a, r.projectName)), nextCursor: result.nextCursor };
  }

  async overview(ctx: RequestContext): Promise<contracts.PortalOverview> {
    ctx.require('projects.read');
    const { db } = this.deps;
    const visible = await ctx.visibleProjectIds(db);
    const rows = await db.select().from(projects).where(and(eq(projects.organizationId, ctx.organizationId), isNull(projects.archivedAt), visible ? (visible.length ? inArray(projects.id, visible) : sql`false`) : sql`true`)).orderBy(asc(projects.number)).limit(50);
    const out: contracts.PortalOverview['projects'] = [];
    for (const p of rows) {
      const ts = await db.select({ status: tasks.status, isMilestone: tasks.isMilestone, name: tasks.name, startDate: tasks.startDate, endDate: tasks.endDate }).from(tasks).where(and(eq(tasks.projectId, p.id), isNull(tasks.archivedAt), eq(tasks.kind, 'schedule'), ctx.membership.external ? eq(tasks.clientVisible, true) : sql`true`)).orderBy(asc(tasks.startDate));
      const done = ts.filter((t) => t.status === 'complete').length;
      const next = ts.find((t) => t.isMilestone && t.status !== 'complete') ?? null;
      const [pend] = await db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(and(eq(approvals.projectId, p.id), eq(approvals.status, 'pending'), inArray(approvals.objectType, ['proposal', 'change_order', 'selection'])));
      const [unpaid] = await db.select({ n: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.paidCents}), 0)::bigint` }).from(invoices).where(and(eq(invoices.projectId, p.id), inArray(invoices.status, ['sent', 'viewed', 'partially_paid', 'overdue'])));
      const [unread] = await db.select({ n: sql<number>`count(*)::int` }).from(threadParticipants).innerJoin(messageThreads, eq(messageThreads.id, threadParticipants.threadId)).where(and(eq(messageThreads.projectId, p.id), eq(threadParticipants.userId, ctx.userId), sql`${messageThreads.lastMessageAt} is not null and (${threadParticipants.lastReadAt} is null or ${threadParticipants.lastReadAt} < ${messageThreads.lastMessageAt})`));
      const [last] = await db.select({ t: activityLog.occurredAt }).from(activityLog).where(and(eq(activityLog.projectId, p.id), ctx.membership.external ? eq(activityLog.clientVisible, true) : sql`true`)).orderBy(desc(activityLog.occurredAt)).limit(1);
      const fin = await this.projects.financials(db, p.id, p.contractValueCents);
      const a = p.address as any;
      out.push({ id: p.id, number: p.number, name: p.name, status: p.status, color: p.color, addressLine: [a?.line1, a?.city].filter(Boolean).join(', '), startDate: p.startDate, targetEndDate: p.targetEndDate, progressBp: ts.length ? Math.round((done / ts.length) * 10_000) : 0, nextMilestone: next ? { name: next.name, date: next.startDate } : null, pendingApprovals: pend?.n ?? 0, unpaidCents: Number(unpaid?.n ?? 0), unreadMessages: unread?.n ?? 0, lastUpdateAt: last?.t ?? null, contractValueCents: fin.contractValueCents, approvedChangesCents: fin.approvedChangesCents });
    }
    const approvalsList = await this.listApprovals(ctx, { limit: 20, status: 'pending' });
    const unpaid = ctx.has('invoices.read') ? await db.select({ i: invoices, projectName: projects.name }).from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId)).where(and(eq(invoices.organizationId, ctx.organizationId), inArray(invoices.status, ['sent', 'viewed', 'partially_paid', 'overdue']), visible ? (visible.length ? inArray(invoices.projectId, visible) : sql`false`) : sql`true`)).orderBy(asc(invoices.dueDate)).limit(20) : [];
    return { projects: out, approvals: approvalsList.items.filter((a) => !isClientPortal(ctx) || a.objectType !== 'time_entry'), unpaidInvoices: unpaid.map(({ i, projectName }) => ({ id: i.id, number: i.number, title: i.title, projectId: i.projectId, projectName, dueDate: i.dueDate, balanceCents: i.totalCents - i.paidCents, status: i.status })) };
  }
}

export function serializeApproval(a: typeof approvals.$inferSelect, projectName: string | null): contracts.ApprovalItem {
  return { id: a.id, objectType: a.objectType as contracts.ApprovalItem['objectType'], objectId: a.objectId, projectId: a.projectId, projectName, title: a.title, amountCents: a.amountCents, requestedAt: a.requestedAt, status: a.status as contracts.ApprovalItem['status'], decidedAt: a.decidedAt, decidedByName: a.decidedByName, link: (LINKS[a.objectType] ?? (() => '/'))(a.projectId, a.objectId) };
}

export type { DbOrTx };
