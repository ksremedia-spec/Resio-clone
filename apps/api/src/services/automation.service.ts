import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { activityLog, automationRuns, automations, clients, invoices, leads, memberships, organizations, projectMembers, projects, roles, taskAssignees, tasks, users } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, type Actor } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import { usersWithPermission } from '../lib/recipients.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';

type AutomationRow = typeof automations.$inferSelect;
type ActivityRow = typeof activityLog.$inferSelect;

/** Which activity entries mean which automation event. */
const ACTIVITY_EVENTS: Record<string, contracts.AutomationEvent> = {
  'daily_log:posted': 'daily_log.posted',
  'task:completed': 'task.completed',
  'task:created': 'task.created',
  'change_order:approved': 'change_order.approved',
  'change_order:declined': 'change_order.declined',
  'invoice:paid': 'invoice.paid',
  'invoice:sent': 'invoice.sent',
  'proposal:accepted': 'proposal.accepted',
  'selection:decided': 'selection.decided',
  'purchase_order:submitted': 'bid.received',
  'purchase_order:acknowledged': 'purchase_order.acknowledged',
  'document:uploaded': 'document.uploaded',
  'project:created': 'project.created',
  'lead:created': 'lead.created',
  'lead:won': 'lead.won',
  'lead:lost': 'lead.lost',
  'time_entry:approved': 'time_entry.approved',
};

const EVENT_LABELS: Record<contracts.AutomationEvent, string> = {
  'daily_log.posted': 'A daily log is posted', 'task.completed': 'A task is completed', 'task.created': 'A task is created', 'change_order.approved': 'A change order is approved', 'change_order.declined': 'A change order is declined',
  'invoice.paid': 'An invoice is paid', 'invoice.sent': 'An invoice is sent', 'proposal.accepted': 'A proposal is accepted', 'selection.decided': 'A selection is decided', 'bid.received': 'A bid comes in', 'purchase_order.acknowledged': 'A vendor acknowledges a purchase order',
  'document.uploaded': 'A document is uploaded', 'project.created': 'A project is created', 'lead.created': 'A lead is created', 'lead.won': 'A lead is won', 'lead.lost': 'A lead is lost', 'time_entry.approved': 'Time is approved',
  'invoice.overdue': 'An invoice becomes overdue (daily check)', 'task.overdue': 'A task becomes overdue (daily check)', 'lead.follow_up_due': 'A lead follow-up is due (daily check)',
};

const TEMPLATES: Array<{ key: string; name: string; description: string; trigger: contracts.Automation['trigger']; actions: contracts.AutomationAction[] }> = [
  { key: 'co_approved_task', name: 'Change order approved → schedule the work', description: 'When a client approves a change order, create a to-do for the project managers to update the schedule and purchase orders.', trigger: { event: 'change_order.approved', projectId: null }, actions: [{ type: 'create_task', name: 'Update schedule and POs for {{object}}', description: 'Approved change order: {{summary}}', daysUntilDue: 2, priority: 'high', assignTo: 'project_managers' }] },
  { key: 'daily_log_notify', name: 'Daily log posted → tell the office', description: 'Notify the office role whenever a daily log is posted so billing stays current.', trigger: { event: 'daily_log.posted', projectId: null }, actions: [{ type: 'notify', to: 'role', roleKey: 'office', title: 'Daily log posted on {{project}}', body: '{{summary}}' }] },
  { key: 'invoice_overdue', name: 'Invoice overdue → follow up', description: 'The day an invoice goes past due, create a follow-up to-do and email the client a reminder.', trigger: { event: 'invoice.overdue', projectId: null }, actions: [{ type: 'create_task', name: 'Follow up on overdue {{object}}', description: '{{summary}}', daysUntilDue: 1, priority: 'high', assignTo: 'project_managers' }, { type: 'email', to: 'client', subject: 'Reminder: {{object}} is past due', body: 'Hello,\n\nOur records show {{object}} for {{project}} is past its due date. Please let us know if you have any questions or have already sent payment.\n\nThank you,\n{{company}}' }] },
  { key: 'invoice_paid_thanks', name: 'Invoice paid → thank the client', description: 'Send a thank-you email when a payment is recorded.', trigger: { event: 'invoice.paid', projectId: null }, actions: [{ type: 'email', to: 'client', subject: 'Thank you — payment received for {{project}}', body: 'Hello,\n\nWe have received your payment on {{object}}. Thank you!\n\n{{company}}' }] },
  { key: 'lead_created_followup', name: 'New lead → first call to-do', description: 'When a lead is created, remind its owner to make first contact the next day.', trigger: { event: 'lead.created', projectId: null }, actions: [{ type: 'notify', to: 'actor', title: 'Follow up with {{object}}', body: 'Call or email the new lead within one business day.' }] },
  { key: 'bid_received', name: 'Bid received → notify the estimator', description: 'Let estimators know the moment a vendor submits a bid.', trigger: { event: 'bid.received', projectId: null }, actions: [{ type: 'notify', to: 'role', roleKey: 'estimator', title: 'New bid on {{project}}', body: '{{summary}}' }] },
  { key: 'task_overdue', name: 'Task overdue → nudge the project team', description: 'Each morning, notify the project team about to-dos that slipped past their due date.', trigger: { event: 'task.overdue', projectId: null }, actions: [{ type: 'notify', to: 'project_team', title: 'Overdue: {{object}}', body: '{{summary}}' }] },
];

const PLACEHOLDERS = [
  { key: '{{project}}', description: 'Project name (blank for company-level events)' },
  { key: '{{object}}', description: 'What the event was about, e.g. the invoice number or task name' },
  { key: '{{actor}}', description: 'Who did it' },
  { key: '{{summary}}', description: 'The activity line as shown in the feed' },
  { key: '{{date}}', description: "Today's date" },
  { key: '{{company}}', description: 'Your company name' },
];

/**
 * Automations: "when X happens, do Y". Activity events are handled inside the
 * transaction that wrote the activity, so an automation can never fire for a
 * change that rolled back. Scheduled events are evaluated by the daily check.
 * Actions run as the system, never as the person, and everything they do is
 * itself recorded in the activity feed (with actor kind `system`).
 */
export class AutomationService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService) {
    activity.onRecord((tx, actor, row) => this.onActivity(tx, actor, row));
  }

  // ---- CRUD ----

  async list(ctx: RequestContext): Promise<contracts.Automation[]> {
    ctx.require('automations.manage');
    const rows = await this.deps.db.select({ a: automations, projectName: projects.name, runCount: sql<number>`(select count(*) from automation_runs r where r.automation_id = ${automations.id})::int` }).from(automations).leftJoin(projects, sql`${projects.id} = (${automations.trigger}->>'projectId')::uuid`).where(eq(automations.organizationId, ctx.organizationId)).orderBy(desc(automations.enabled), automations.name);
    return rows.map((r) => serialize(r.a, r.projectName, r.runCount));
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.Automation> {
    ctx.require('automations.manage');
    const [r] = await this.deps.db.select({ a: automations, projectName: projects.name, runCount: sql<number>`(select count(*) from automation_runs r where r.automation_id = ${automations.id})::int` }).from(automations).leftJoin(projects, sql`${projects.id} = (${automations.trigger}->>'projectId')::uuid`).where(and(eq(automations.id, id), eq(automations.organizationId, ctx.organizationId))).limit(1);
    if (!r) throw AppError.notFound('Automation');
    return serialize(r.a, r.projectName, r.runCount);
  }

  async create(ctx: RequestContext, input: { name: string; description: string; trigger: contracts.Automation['trigger']; actions: contracts.AutomationAction[]; enabled: boolean }): Promise<contracts.Automation> {
    ctx.require('automations.manage');
    const id = await this.deps.db.transaction(async (tx) => {
      if (input.trigger.projectId) await ctx.requireProjectAccess(tx, input.trigger.projectId);
      const [row] = await tx.insert(automations).values({ organizationId: ctx.organizationId, name: input.name, description: input.description, trigger: input.trigger, actions: input.actions, enabled: input.enabled, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'created', objectType: 'automation', objectId: row!.id, objectLabel: row!.name });
      return row!.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, input: Partial<{ name: string; description: string; trigger: contracts.Automation['trigger']; actions: contracts.AutomationAction[]; enabled: boolean }>): Promise<contracts.Automation> {
    ctx.require('automations.manage');
    await this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(automations).where(and(eq(automations.id, id), eq(automations.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Automation');
      if (input.trigger?.projectId) await ctx.requireProjectAccess(tx, input.trigger.projectId);
      const [after] = await tx.update(automations).set({ ...input, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${automations.version} + 1` } as any).where(eq(automations.id, id)).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: input.enabled === false && before.enabled ? 'paused' : input.enabled === true && !before.enabled ? 'resumed' : 'updated', objectType: 'automation', objectId: id, objectLabel: after!.name });
    });
    return this.get(ctx, id);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    ctx.require('automations.manage');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.delete(automations).where(and(eq(automations.id, id), eq(automations.organizationId, ctx.organizationId))).returning();
      if (!row) throw AppError.notFound('Automation');
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'deleted', objectType: 'automation', objectId: id, objectLabel: row.name });
    });
  }

  async listRuns(ctx: RequestContext, query: { cursor?: string; limit: number; automationId?: string }) {
    ctx.require('automations.manage');
    const conditions = [eq(automationRuns.organizationId, ctx.organizationId)];
    if (query.automationId) conditions.push(eq(automationRuns.automationId, query.automationId));
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${automationRuns.startedAt}, ${automationRuns.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await this.deps.db.select({ r: automationRuns, name: automations.name }).from(automationRuns).innerJoin(automations, eq(automations.id, automationRuns.automationId)).where(and(...conditions)).orderBy(desc(automationRuns.startedAt), desc(automationRuns.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.r.startedAt, id: r.r.id }));
    return { items: result.items.map(({ r, name }) => ({ id: r.id, automationId: r.automationId, automationName: name, status: r.status as contracts.AutomationRun['status'], startedAt: r.startedAt, finishedAt: r.finishedAt, input: r.input as contracts.AutomationRun['input'], output: (r.output as contracts.AutomationRun['output']) ?? null, error: r.error })), nextCursor: result.nextCursor };
  }

  catalog(ctx: RequestContext) {
    ctx.require('automations.manage');
    return { events: contracts.AUTOMATION_EVENTS.map((key) => ({ key, label: EVENT_LABELS[key], scheduled: contracts.SCHEDULED_EVENTS.includes(key) })), templates: TEMPLATES, placeholders: PLACEHOLDERS };
  }

  // ---- activity-driven events ----

  private async onActivity(tx: DbOrTx, actor: Actor, row: ActivityRow) {
    if (actor.kind === 'system') return; // never react to our own actions
    const event = ACTIVITY_EVENTS[`${row.objectType}:${row.verb}`];
    if (!event) return;
    const candidates = await tx.select().from(automations).where(and(eq(automations.organizationId, row.organizationId), eq(automations.enabled, true), sql`${automations.trigger}->>'event' = ${event}`));
    for (const a of candidates) {
      const trig = a.trigger as contracts.Automation['trigger'];
      if (trig.projectId && trig.projectId !== row.projectId) continue;
      await this.fire(tx, a, { event, summary: row.summary, projectId: row.projectId, objectType: row.objectType, objectId: row.objectId, objectLabel: row.objectLabel, actorName: actor.name, actorUserId: actor.userId });
    }
  }

  // ---- scheduled events ----

  /** Evaluate the time-based triggers for one organization. Each object fires an automation at most once. */
  async runScheduled(ctx: RequestContext): Promise<{ evaluated: number; fired: number }> {
    ctx.require('automations.manage');
    return this.runScheduledForOrganization(ctx.organizationId);
  }

  async runScheduledForOrganization(organizationId: string): Promise<{ evaluated: number; fired: number }> {
    const { db } = this.deps;
    const rows = await db.select().from(automations).where(and(eq(automations.organizationId, organizationId), eq(automations.enabled, true), inArray(sql`${automations.trigger}->>'event'`, [...contracts.SCHEDULED_EVENTS])));
    let evaluated = 0; let fired = 0;
    for (const a of rows) {
      const trig = a.trigger as contracts.Automation['trigger'];
      const subjects = await this.scheduledSubjects(db, organizationId, trig);
      for (const s of subjects) {
        evaluated += 1;
        const [already] = await db.select({ id: automationRuns.id }).from(automationRuns).where(and(eq(automationRuns.automationId, a.id), sql`${automationRuns.input}->>'objectId' = ${s.objectId}`)).limit(1);
        if (already) continue;
        await db.transaction(async (tx) => { await this.fire(tx, a, { event: trig.event, ...s, actorName: 'Buildline', actorUserId: null }); });
        fired += 1;
      }
    }
    return { evaluated, fired };
  }

  /** For the server's hourly tick: every organization with scheduled automations. */
  async runScheduledEverywhere(): Promise<void> {
    const orgs = await this.deps.db.selectDistinct({ id: automations.organizationId }).from(automations).where(and(eq(automations.enabled, true), inArray(sql`${automations.trigger}->>'event'`, [...contracts.SCHEDULED_EVENTS])));
    for (const o of orgs) { try { await this.runScheduledForOrganization(o.id); } catch (err) { this.deps.log.error({ err, organizationId: o.id }, 'scheduled automations failed'); } }
  }

  private async scheduledSubjects(db: DbOrTx, organizationId: string, trig: contracts.Automation['trigger']): Promise<Array<{ summary: string; projectId: string | null; objectType: string; objectId: string; objectLabel: string }>> {
    const projectCond = (col: any) => trig.projectId ? eq(col, trig.projectId) : sql`true`;
    if (trig.event === 'invoice.overdue') {
      const rows = await db.select({ i: invoices, projectName: projects.name }).from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId)).where(and(eq(invoices.organizationId, organizationId), isNull(invoices.archivedAt), inArray(invoices.status, ['sent', 'viewed', 'partially_paid', 'overdue']), sql`${invoices.dueDate} < current_date`, sql`${invoices.totalCents} - ${invoices.paidCents} > 0`, projectCond(invoices.projectId)));
      return rows.map(({ i, projectName }) => ({ summary: `Invoice ${i.number} on ${projectName} is ${Math.floor((Date.now() - new Date(`${i.dueDate}T12:00:00Z`).getTime()) / 86_400_000)} days past due (${((i.totalCents - i.paidCents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} outstanding)`, projectId: i.projectId, objectType: 'invoice', objectId: i.id, objectLabel: i.number }));
    }
    if (trig.event === 'task.overdue') {
      const rows = await db.select({ t: tasks, projectName: projects.name }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(eq(tasks.organizationId, organizationId), isNull(tasks.archivedAt), isNull(projects.archivedAt), sql`${tasks.status} not in ('complete', 'cancelled')`, sql`coalesce(${tasks.dueDate}, ${tasks.endDate}) < current_date`, projectCond(tasks.projectId)));
      return rows.map(({ t, projectName }) => ({ summary: `${t.name} on ${projectName} was due ${t.dueDate ?? t.endDate}`, projectId: t.projectId, objectType: 'task', objectId: t.id, objectLabel: t.name }));
    }
    if (trig.event === 'lead.follow_up_due') {
      const rows = await db.select().from(leads).where(and(eq(leads.organizationId, organizationId), isNull(leads.archivedAt), inArray(leads.stage, [...contracts.OPEN_LEAD_STAGES]), sql`${leads.nextFollowUpAt} <= now()`));
      return rows.map((l) => ({ summary: `Follow-up due for lead ${l.name}`, projectId: null, objectType: 'lead', objectId: l.id, objectLabel: l.name }));
    }
    return [];
  }

  // ---- running actions ----

  private async fire(tx: DbOrTx, a: AutomationRow, ev: { event: string; summary: string; projectId: string | null; objectType: string | null; objectId: string | null; objectLabel: string; actorName: string; actorUserId: string | null }) {
    const [run] = await tx.insert(automationRuns).values({ organizationId: a.organizationId, automationId: a.id, status: 'running', input: { event: ev.event, summary: ev.summary, projectId: ev.projectId, objectType: ev.objectType, objectId: ev.objectId, actorName: ev.actorName } }).returning();
    const output: Array<{ action: string; result: string }> = [];
    let error: string | null = null;
    try {
      const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, a.organizationId)).limit(1);
      const project = ev.projectId ? (await tx.select({ id: projects.id, name: projects.name, clientId: projects.clientId }).from(projects).where(eq(projects.id, ev.projectId)).limit(1))[0] ?? null : null;
      const vars: Record<string, string> = { project: project?.name ?? '', object: ev.objectLabel, actor: ev.actorName, summary: ev.summary, date: new Date().toISOString().slice(0, 10), company: org?.name ?? 'Buildline' };
      const fill = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
      for (const action of a.actions as contracts.AutomationAction[]) {
        try { output.push({ action: action.type, result: await this.runAction(tx, a, action, ev, project, fill) }); }
        catch (err) { output.push({ action: action.type, result: `failed: ${(err as Error).message}` }); error = (err as Error).message; }
      }
    } catch (err) { error = (err as Error).message; }
    await tx.update(automationRuns).set({ status: error ? 'failed' : 'succeeded', finishedAt: sql`now()`, output, error }).where(eq(automationRuns.id, run!.id));
    await tx.update(automations).set({ lastRunAt: sql`now()` }).where(eq(automations.id, a.id));
  }

  private async runAction(tx: DbOrTx, a: AutomationRow, action: contracts.AutomationAction, ev: { projectId: string | null; objectType: string | null; objectId: string | null; objectLabel: string; actorUserId: string | null; actorName: string }, project: { id: string; name: string; clientId: string | null } | null, fill: (s: string) => string): Promise<string> {
    const system: Actor = { organizationId: a.organizationId, userId: null, name: `Automation: ${a.name}`, kind: 'system' };
    const link = ev.projectId ? (ev.objectType === 'task' ? `/projects/${ev.projectId}/tasks/${ev.objectId}` : ev.objectType === 'invoice' ? `/invoices/${ev.objectId}` : ev.objectType === 'daily_log' ? `/projects/${ev.projectId}/logs` : ev.objectType === 'change_order' ? `/projects/${ev.projectId}/change-orders` : `/projects/${ev.projectId}`) : ev.objectType === 'lead' ? `/leads/${ev.objectId}` : null;
    switch (action.type) {
      case 'notify': {
        const userIds = await this.recipients(tx, a.organizationId, ev.projectId, action.to, action.roleKey, ev.actorUserId);
        if (!userIds.length) return 'nobody to notify';
        const sent = await this.notifications.notify(tx, { organizationId: a.organizationId, userIds, kind: 'system', title: fill(action.title), body: fill(action.body), projectId: ev.projectId, objectType: ev.objectType, objectId: ev.objectId, link });
        return `notified ${sent.length} ${sent.length === 1 ? 'person' : 'people'}`;
      }
      case 'create_task': {
        if (!ev.projectId) return 'skipped: no project for this event';
        const due = new Date(Date.now() + action.daysUntilDue * 86_400_000).toISOString().slice(0, 10);
        const [mx] = await tx.select({ max: sql<number>`coalesce(max(${tasks.sortOrder}), -1)::int` }).from(tasks).where(eq(tasks.projectId, ev.projectId));
        const max = mx?.max ?? -1;
        const [task] = await tx.insert(tasks).values({ organizationId: a.organizationId, projectId: ev.projectId, kind: 'todo', name: fill(action.name).slice(0, 200), description: fill(action.description), status: 'not_started', priority: action.priority, dueDate: due, durationDays: 1, sortOrder: (max ?? -1) + 1, clientVisible: false }).returning();
        const assignees = action.assignTo === 'nobody' ? [] : await this.recipients(tx, a.organizationId, ev.projectId, action.assignTo, action.roleKey, ev.actorUserId);
        if (assignees.length) {
          await tx.insert(taskAssignees).values(assignees.map((userId) => ({ organizationId: a.organizationId, taskId: task!.id, userId }))).onConflictDoNothing();
          await this.notifications.notify(tx, { organizationId: a.organizationId, userIds: assignees, kind: 'task.assigned', title: `New to-do: ${task!.name}`, body: `Created by the automation "${a.name}". Due ${due}.`, projectId: ev.projectId, objectType: 'task', objectId: task!.id, link: `/projects/${ev.projectId}/tasks/${task!.id}` });
        }
        await this.activity.record(tx, system, { projectId: ev.projectId, verb: 'created', objectType: 'task', objectId: task!.id, objectLabel: task!.name });
        return `created to-do "${task!.name}" due ${due}${assignees.length ? ` for ${assignees.length} ${assignees.length === 1 ? 'person' : 'people'}` : ''}`;
      }
      case 'email': {
        let to: string | null = action.to === 'address' ? (action.address ?? null) : null;
        if (action.to === 'client') { if (!project?.clientId) return 'skipped: no client on this project'; const [c] = await tx.select({ email: clients.email }).from(clients).where(eq(clients.id, project.clientId)).limit(1); to = c?.email ?? null; }
        if (action.to === 'actor' && ev.actorUserId) { const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, ev.actorUserId)).limit(1); to = u?.email ?? null; }
        if (!to) return 'skipped: no email address';
        await this.deps.providers.email.send({ to, subject: fill(action.subject), text: fill(action.body), template: 'automation', data: { automationId: a.id } });
        await this.activity.record(tx, system, { projectId: ev.projectId, verb: 'emailed', objectType: 'automation', objectId: a.id, objectLabel: a.name, summary: `${a.name} emailed ${to}: ${fill(action.subject)}` });
        return `emailed ${to}`;
      }
    }
  }

  private async recipients(tx: DbOrTx, organizationId: string, projectId: string | null, to: 'project_team' | 'role' | 'actor' | 'project_managers', roleKey: string | undefined, actorUserId: string | null): Promise<string[]> {
    if (to === 'actor') return actorUserId ? [actorUserId] : [];
    if (to === 'role') {
      if (!roleKey) return [];
      const rows = await tx.select({ userId: memberships.userId }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, 'active'), eq(roles.key, roleKey)));
      return rows.map((r) => r.userId);
    }
    if (!projectId) return to === 'project_managers' ? usersWithPermission(tx, organizationId, 'projects.write') : [];
    const members = await tx.select({ userId: projectMembers.userId, accessLevel: projectMembers.accessLevel }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), sql`${projectMembers.userId} is not null`, isNull(projectMembers.contactId), isNull(projectMembers.vendorId)));
    const ids = members.map((m) => m.userId!).filter(Boolean);
    if (to === 'project_team') return [...new Set(ids)];
    const managers = members.filter((m) => m.accessLevel === 'manager').map((m) => m.userId!);
    return managers.length ? [...new Set(managers)] : [...new Set(ids)];
  }
}

function serialize(a: AutomationRow, projectName: string | null, runCount: number): contracts.Automation {
  return { id: a.id, organizationId: a.organizationId, createdAt: a.createdAt, updatedAt: a.updatedAt, createdBy: a.createdBy, updatedBy: a.updatedBy, version: a.version, name: a.name, description: a.description, trigger: a.trigger as contracts.Automation['trigger'], actions: a.actions as contracts.AutomationAction[], enabled: a.enabled, lastRunAt: a.lastRunAt, runCount, projectName };
}
