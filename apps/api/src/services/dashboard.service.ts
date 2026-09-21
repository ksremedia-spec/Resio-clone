import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { budgetCalc, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { one } from '../lib/rows.js';
import { approvals, budgetLines, changeOrders, clients, costCodes, invoices, messageThreads, projectFavorites, projects, taskAssignees, tasks, threadParticipants, users, bills, purchaseOrderLines, purchaseOrders, billLines } from '../db/schema/index.js';
import type { RequestContext } from '../lib/context.js';
import type { ActivityService } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import { serializeActivity } from './activity.service.js';
import { activityLog } from '../db/schema/index.js';

export class DashboardService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService) {}

  async get(ctx: RequestContext): Promise<contracts.DashboardResponse> {
    const { db } = this.deps;
    const visible = await ctx.visibleProjectIds(db);
    const projectScope = visible ? (visible.length ? inArray(projects.id, visible) : sql`false`) : sql`true`;
    const today = new Date().toISOString().slice(0, 10);
    const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    const activeRows = ctx.has('projects.read') ? await db.select({
      p: projects, clientName: clients.displayName,
      isFavorite: sql<boolean>`exists (select 1 from ${projectFavorites} where ${projectFavorites.projectId} = ${projects.id} and ${projectFavorites.userId} = ${ctx.userId})`,
      openTasks: sql<number>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.archivedAt} is null and ${tasks.status} not in ('complete','cancelled'))::int`,
      overdueTasks: sql<number>`(select count(*) from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.archivedAt} is null and ${tasks.status} not in ('complete','cancelled') and coalesce(${tasks.dueDate}, ${tasks.endDate}) < ${today})::int`,
    }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId))
      .where(and(eq(projects.organizationId, ctx.organizationId), isNull(projects.archivedAt), inArray(projects.status, ['active', 'pre_construction', 'on_hold']), projectScope))
      .orderBy(desc(sql`exists (select 1 from ${projectFavorites} where ${projectFavorites.projectId} = ${projects.id} and ${projectFavorites.userId} = ${ctx.userId})`), desc(projects.lastActivityAt)).limit(12) : [];
    const activeIds = activeRows.map((r) => r.p.id);
    const milestones = activeIds.length ? await db.select({ id: tasks.id, projectId: tasks.projectId, name: tasks.name, date: sql<string>`coalesce(${tasks.startDate}, ${tasks.dueDate})` }).from(tasks)
      .where(and(inArray(tasks.projectId, activeIds), eq(tasks.isMilestone, true), isNull(tasks.archivedAt), sql`${tasks.status} not in ('complete','cancelled')`, sql`coalesce(${tasks.startDate}, ${tasks.dueDate}) >= ${today}`)).orderBy(asc(sql`coalesce(${tasks.startDate}, ${tasks.dueDate})`)) : [];
    const nextMilestone = new Map<string, { id: string; name: string; date: string }>();
    for (const m of milestones) if (!nextMilestone.has(m.projectId)) nextMilestone.set(m.projectId, { id: m.id, name: m.name, date: m.date });

    const { activeCount } = one(await db.select({ activeCount: sql<number>`count(*)::int` }).from(projects).where(and(eq(projects.organizationId, ctx.organizationId), isNull(projects.archivedAt), inArray(projects.status, ['active', 'pre_construction', 'on_hold']), projectScope)));

    const response: contracts.DashboardResponse = {
      generatedAt: new Date().toISOString(),
      activeProjects: { count: activeCount, items: activeRows.map((r) => ({ id: r.p.id, number: r.p.number, name: r.p.name, status: r.p.status, clientName: r.clientName, color: r.p.color, openTasks: r.openTasks, overdueTasks: r.overdueTasks, nextMilestone: nextMilestone.get(r.p.id) ?? null, lastActivityAt: r.p.lastActivityAt, isFavorite: r.isFavorite })) },
      recentActivity: [],
      unreadNotifications: await this.notifications.unreadCount(ctx),
    };

    if (ctx.has('tasks.read')) {
      const taskScope = [eq(tasks.organizationId, ctx.organizationId), isNull(tasks.archivedAt), sql`${tasks.status} not in ('complete','cancelled')`, visible ? (visible.length ? inArray(tasks.projectId, visible) : sql`false`) : sql`true`];
      if (ctx.membership.roleKey === 'field_crew') taskScope.push(sql`exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.userId} = ${ctx.userId})`);
      const overdue = await db.select({ t: tasks, projectName: projects.name }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(...taskScope, sql`coalesce(${tasks.dueDate}, ${tasks.endDate}) < ${today}`)).orderBy(asc(sql`coalesce(${tasks.dueDate}, ${tasks.endDate})`)).limit(10);
      const { overdueCount } = one(await db.select({ overdueCount: sql<number>`count(*)::int` }).from(tasks).where(and(...taskScope, sql`coalesce(${tasks.dueDate}, ${tasks.endDate}) < ${today}`)));
      const upcoming = await db.select({ t: tasks, projectName: projects.name }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(...taskScope, sql`coalesce(${tasks.dueDate}, ${tasks.endDate}) between ${today} and ${weekOut}`)).orderBy(asc(sql`coalesce(${tasks.dueDate}, ${tasks.endDate})`)).limit(10);
      const { upcomingCount } = one(await db.select({ upcomingCount: sql<number>`count(*)::int` }).from(tasks).where(and(...taskScope, sql`coalesce(${tasks.dueDate}, ${tasks.endDate}) between ${today} and ${weekOut}`)));
      const assigneeRows = overdue.length ? await db.select({ taskId: taskAssignees.taskId, name: sql<string>`${users.firstName} || ' ' || ${users.lastName}` }).from(taskAssignees).innerJoin(users, eq(users.id, taskAssignees.userId)).where(inArray(taskAssignees.taskId, overdue.map((o) => o.t.id))) : [];
      response.overdueTasks = { count: overdueCount, items: overdue.map(({ t, projectName }) => { const due = (t.dueDate ?? t.endDate)!; return { id: t.id, name: t.name, projectId: t.projectId, projectName, dueDate: due, assigneeNames: assigneeRows.filter((a) => a.taskId === t.id).map((a) => a.name), daysOverdue: Math.floor((Date.parse(today) - Date.parse(due)) / 86_400_000) }; }) };
      response.upcomingDeadlines = { count: upcomingCount, items: upcoming.map(({ t, projectName }) => ({ id: t.id, name: t.name, projectId: t.projectId, projectName, dueDate: (t.dueDate ?? t.endDate)!, isMilestone: t.isMilestone })) };
    }

    if (ctx.hasAnyApprovalRead()) {
      const rows = await db.select({ a: approvals, projectName: projects.name }).from(approvals).leftJoin(projects, eq(projects.id, approvals.projectId))
        .where(and(eq(approvals.organizationId, ctx.organizationId), eq(approvals.status, 'pending'), visible ? (visible.length ? sql`(${approvals.projectId} is null or ${inArray(approvals.projectId, visible)})` : sql`${approvals.projectId} is null`) : sql`true`)).orderBy(asc(approvals.requestedAt)).limit(10);
      const { n } = one(await db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(and(eq(approvals.organizationId, ctx.organizationId), eq(approvals.status, 'pending'))));
      response.pendingApprovals = { count: n, items: rows.map(({ a, projectName }) => ({ id: a.id, objectType: a.objectType, objectId: a.objectId, title: a.title, projectId: a.projectId, projectName: projectName ?? null, requestedAt: a.requestedAt, amountCents: a.amountCents })) };
    }

    if (ctx.has('invoices.read')) {
      const rows = await db.select({ i: invoices, projectName: projects.name, clientName: clients.displayName }).from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId)).leftJoin(clients, eq(clients.id, invoices.clientId))
        .where(and(eq(invoices.organizationId, ctx.organizationId), inArray(invoices.status, ['sent', 'viewed', 'partially_paid', 'overdue']), visible ? (visible.length ? inArray(invoices.projectId, visible) : sql`false`) : sql`true`)).orderBy(asc(invoices.dueDate)).limit(10);
      const { n, total } = one(await db.select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.paidCents}), 0)::bigint` }).from(invoices).where(and(eq(invoices.organizationId, ctx.organizationId), inArray(invoices.status, ['sent', 'viewed', 'partially_paid', 'overdue']))));
      response.unpaidInvoices = { count: n, totalCents: Number(total), items: rows.map(({ i, projectName, clientName }) => ({ id: i.id, number: i.number, projectId: i.projectId, projectName, clientName, dueDate: i.dueDate, balanceCents: i.totalCents - i.paidCents, status: i.status })) };
    }

    if (ctx.has('budget.read')) {
      const lines = await db.select({
        l: budgetLines, projectName: projects.name, code: costCodes.code,
        approved: sql<number>`coalesce((select sum(col.sell_cents) from change_order_lines col join change_orders co on co.id = col.change_order_id where col.budget_line_id = ${budgetLines.id} and co.status = 'approved'), 0)::bigint`,
        committed: sql<number>`coalesce((select sum(pol.amount_cents - pol.billed_cents) from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id where pol.budget_line_id = ${budgetLines.id} and po.status in ('approved','committed','matched')), 0)::bigint`,
        actual: sql<number>`coalesce((select sum(bl.amount_cents) from bill_lines bl join bills b on b.id = bl.bill_id where bl.budget_line_id = ${budgetLines.id} and b.status in ('approved','scheduled','paid')), 0)::bigint`,
      }).from(budgetLines).innerJoin(projects, eq(projects.id, budgetLines.projectId)).leftJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
        .where(and(eq(budgetLines.organizationId, ctx.organizationId), isNull(projects.archivedAt), visible ? (visible.length ? inArray(budgetLines.projectId, visible) : sql`false`) : sql`true`)).limit(2000);
      const warnings = lines.map((r) => ({ r, t: budgetCalc.rollupBudgetLine({ originalCents: r.l.originalCostCents, approvedChangesCents: Number(r.approved), committedCents: Number(r.committed), actualCents: Number(r.actual), projectedExtraCents: r.l.projectedExtraCents, invoicedCents: 0, paidCents: 0 }) }))
        .filter(({ t }) => t.status === 'over' || t.status === 'warning').sort((a, b) => a.t.varianceCents - b.t.varianceCents);
      response.budgetWarnings = { count: warnings.length, items: warnings.slice(0, 10).map(({ r, t }) => ({ projectId: r.l.projectId, projectName: r.projectName, costCode: r.code, lineName: r.l.name, revisedCents: t.revisedCents, projectedCents: t.projectedCents, varianceCents: t.varianceCents, status: t.status })) };
    }

    if (ctx.has('schedule.read')) {
      const conflictRows = await db.execute(sql`
        select a.resource_type, a.resource_name, ta.name as task_a, tb.name as task_b, pa.name as project_a, pb.name as project_b,
               greatest(ta.start_date, tb.start_date) as overlap_start, least(ta.end_date, tb.end_date) as overlap_end
        from (
          select x.task_id, 'user' as resource_type, x.user_id as resource_id, u.first_name || ' ' || u.last_name as resource_name from task_assignees x join users u on u.id = x.user_id where x.user_id is not null and x.organization_id = ${ctx.organizationId}
          union all
          select x.task_id, 'vendor', x.vendor_id, v.name from task_assignees x join vendors v on v.id = x.vendor_id where x.vendor_id is not null and x.organization_id = ${ctx.organizationId}
        ) a join (
          select x.task_id, 'user' as resource_type, x.user_id as resource_id from task_assignees x where x.user_id is not null and x.organization_id = ${ctx.organizationId}
          union all
          select x.task_id, 'vendor', x.vendor_id from task_assignees x where x.vendor_id is not null and x.organization_id = ${ctx.organizationId}
        ) b on a.resource_type = b.resource_type and a.resource_id = b.resource_id and a.task_id < b.task_id
        join tasks ta on ta.id = a.task_id join tasks tb on tb.id = b.task_id
        join projects pa on pa.id = ta.project_id join projects pb on pb.id = tb.project_id
        where ta.archived_at is null and tb.archived_at is null and ta.status not in ('complete','cancelled') and tb.status not in ('complete','cancelled')
          and ta.start_date is not null and tb.start_date is not null and ta.start_date <= tb.end_date and tb.start_date <= ta.end_date
          and ta.end_date >= ${today}
        order by overlap_start limit 10`);
      const rows = conflictRows as unknown as Array<Record<string, string>>;
      response.scheduleConflicts = { count: rows.length, items: rows.map((r) => ({ resourceType: r.resource_type!, resourceName: r.resource_name!, taskAName: r.task_a!, taskBName: r.task_b!, projectAName: r.project_a!, projectBName: r.project_b!, overlapStart: String(r.overlap_start).slice(0, 10), overlapEnd: String(r.overlap_end).slice(0, 10) })) };
    }

    if (ctx.has('activity.read')) {
      const rows = await db.select().from(activityLog).where(and(eq(activityLog.organizationId, ctx.organizationId), visible ? (visible.length ? sql`(${activityLog.projectId} is null or ${inArray(activityLog.projectId, visible)})` : isNull(activityLog.projectId)) : sql`true`)).orderBy(desc(activityLog.occurredAt)).limit(15);
      response.recentActivity = rows.map(serializeActivity);
    }

    if (ctx.has('messages.read')) {
      const rows = await db.select({ t: messageThreads, projectName: projects.name, lastReadAt: threadParticipants.lastReadAt }).from(threadParticipants).innerJoin(messageThreads, eq(messageThreads.id, threadParticipants.threadId)).leftJoin(projects, eq(projects.id, messageThreads.projectId))
        .where(and(eq(threadParticipants.userId, ctx.userId), eq(messageThreads.organizationId, ctx.organizationId), isNull(messageThreads.archivedAt), sql`${messageThreads.lastMessageAt} is not null`)).orderBy(desc(messageThreads.lastMessageAt)).limit(8);
      response.recentMessages = rows.map(({ t, projectName, lastReadAt }) => ({ threadId: t.id, projectId: t.projectId, projectName: projectName ?? null, subject: t.subject, lastMessagePreview: t.lastMessagePreview, lastMessageAt: t.lastMessageAt!, unread: !lastReadAt || lastReadAt < t.lastMessageAt! }));
    }

    return response;
  }
}

export { changeOrders, bills, purchaseOrderLines, purchaseOrders, billLines };
