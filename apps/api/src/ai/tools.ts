import { z } from 'zod';
import { contracts, formatCents, type Permission } from '@buildline/core';
import type { RequestContext } from '../lib/context.js';
import type { Services } from '../services/index.js';
import { AppError } from '../lib/errors.js';

/**
 * The assistant can only touch the product through these tools, and every
 * tool goes through the same services (and permission checks) as the UI.
 * Read tools run immediately; write tools are staged until the person confirms.
 */
export interface ToolResult { output: unknown; summary: string; link?: string | null }
export interface ToolDef<I = any> {
  name: string;
  description: string;
  kind: 'read' | 'write';
  /** Shown only when the caller holds this permission; the service still enforces it. */
  permission: Permission | null;
  input: z.ZodObject<any>;
  summarize: (input: I) => string;
  run: (ctx: RequestContext, input: I) => Promise<ToolResult>;
}

const money = (c: number) => formatCents(c);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const projectId = z.string().uuid().describe('The project id (from list_projects or the conversation context).');

export function buildTools(s: Services): ToolDef[] {
  const projectName = async (ctx: RequestContext, id: string) => (await s.projects.get(ctx, id)).name;
  return [
    {
      name: 'list_projects', kind: 'read', permission: 'projects.read',
      description: 'List the projects the user can see, with number, name, status and client. Use it to resolve a project name to an id.',
      input: z.object({ query: z.string().optional().describe('Optional name fragment to filter by.'), status: z.enum(['open', 'all', 'active', 'complete']).default('open') }),
      summarize: (i) => i.query ? `looked up projects matching "${i.query}"` : 'listed projects',
      run: async (ctx, i) => {
        const res = await s.projects.list(ctx, contracts.listProjectsQuery.parse({ q: i.query, status: i.status, limit: 50 }));
        const items = res.items.map((p) => ({ id: p.id, number: p.number, name: p.name, status: p.status, clientName: p.clientName }));
        return { output: items, summary: items.length ? `${items.length} project${items.length === 1 ? '' : 's'}: ${items.map((p) => `${p.number} ${p.name} (${p.status.replace('_', ' ')})`).join('; ')}.` : 'No projects found.' };
      },
    },
    {
      name: 'project_overview', kind: 'read', permission: 'projects.read',
      description: 'Status of one project: dates, contract and billing totals, open and overdue tasks, next milestone, team.',
      input: z.object({ projectId }),
      summarize: () => 'checked the project overview',
      run: async (ctx, i) => {
        const p = await s.projects.get(ctx, i.projectId);
        const f = p.financials;
        const output = { id: p.id, number: p.number, name: p.name, status: p.status, clientName: p.clientName, startDate: p.startDate, targetEndDate: p.targetEndDate, contractValueCents: f.contractValueCents, approvedChangesCents: f.approvedChangesCents, revisedContractCents: f.revisedContractCents, invoicedCents: f.invoicedCents, paidCents: f.paidCents, outstandingCents: f.outstandingCents, openTasks: p.counts.openTasks, overdueTasks: p.counts.overdueTasks, pendingApprovals: p.counts.pendingApprovals, team: p.members.map((m) => m.displayName) };
        return { output, summary: `${p.number} ${p.name} is ${p.status.replace('_', ' ')}${p.clientName ? ` for ${p.clientName}` : ''}. Contract ${money(f.revisedContractCents)} (${money(f.approvedChangesCents)} in approved changes), invoiced ${money(f.invoicedCents)}, paid ${money(f.paidCents)}, outstanding ${money(f.outstandingCents)}. ${p.counts.openTasks} open task${p.counts.openTasks === 1 ? '' : 's'}${p.counts.overdueTasks ? `, ${p.counts.overdueTasks} overdue` : ''}${p.counts.pendingApprovals ? `, ${p.counts.pendingApprovals} approval${p.counts.pendingApprovals === 1 ? '' : 's'} pending` : ''}.`, link: `/projects/${p.id}` };
      },
    },
    {
      name: 'budget_status', kind: 'read', permission: 'budget.read',
      description: 'Job-cost health of a project: revised budget, committed, actual, projected, variance, and the lines that are over or close to over.',
      input: z.object({ projectId }),
      summarize: () => 'checked the budget',
      run: async (ctx, i) => {
        const b = await s.budget.get(ctx, i.projectId);
        const t = b.totals;
        const risky = b.lines.filter((l) => l.status === 'over' || l.status === 'warning').sort((a, c) => a.varianceCents - c.varianceCents).slice(0, 5);
        const output = { totals: t, contract: b.contract, riskyLines: risky.map((l) => ({ name: l.name, costCode: l.costCode, revisedCents: l.revisedCents, projectedCents: l.projectedCents, varianceCents: l.varianceCents, status: l.status })) };
        const name = await projectName(ctx, i.projectId);
        return { output, summary: b.lines.length === 0 ? `${name} has no budget yet (lock the estimate to create one).` : `${name}: revised budget ${money(t.revisedCents)}, committed ${money(t.committedCents)}, spent ${money(t.actualCents)}, projected ${money(t.projectedCents)} (${t.varianceCents >= 0 ? `${money(t.varianceCents)} under` : `${money(-t.varianceCents)} over`}). Projected margin ${money(b.contract.projectedMarginCents)}.${risky.length ? ` Watch: ${risky.map((l) => `${l.name} (${l.status === 'over' ? `${money(-l.varianceCents)} over` : `${Math.round(l.percentSpentBp / 100)}% used`})`).join(', ')}.` : ' No lines are over budget.'}`, link: `/projects/${i.projectId}/budget` };
      },
    },
    {
      name: 'overdue_tasks', kind: 'read', permission: 'tasks.read',
      description: 'Open tasks whose due or end date has passed, optionally for one project.',
      input: z.object({ projectId: projectId.optional() }),
      summarize: () => 'checked overdue tasks',
      run: async (ctx, i) => {
        const res = await s.schedule.listTasks(ctx, contracts.listTasksQuery.parse({ projectId: i.projectId, status: 'open', limit: 200, sort: 'dueDate:asc' }));
        const t = today();
        const items = res.items.filter((x) => (x.dueDate ?? x.endDate) && (x.dueDate ?? x.endDate)! < t).map((x) => ({ id: x.id, name: x.name, projectId: x.projectId, projectName: x.projectName, due: x.dueDate ?? x.endDate, assignees: x.assignees.map((a) => a.displayName), daysLate: Math.floor((Date.parse(t) - Date.parse((x.dueDate ?? x.endDate)!)) / 86_400_000) }));
        return { output: items, summary: items.length ? `${items.length} overdue: ${items.slice(0, 8).map((x) => `${x.name}${x.projectName ? ` (${x.projectName})` : ''}, ${x.daysLate} day${x.daysLate === 1 ? '' : 's'} late${x.assignees.length ? `, ${x.assignees.join(', ')}` : ''}`).join('; ')}${items.length > 8 ? '; …' : ''}.` : 'Nothing is overdue.', link: i.projectId ? `/projects/${i.projectId}/tasks` : '/tasks' };
      },
    },
    {
      name: 'upcoming_schedule', kind: 'read', permission: 'schedule.read',
      description: 'Scheduled tasks and milestones starting or finishing in the next N days for a project.',
      input: z.object({ projectId, days: z.number().int().min(1).max(90).default(14) }),
      summarize: (i) => `checked the next ${i.days} days of schedule`,
      run: async (ctx, i) => {
        const res = await s.schedule.listTasks(ctx, contracts.listTasksQuery.parse({ projectId: i.projectId, status: 'open', kind: 'schedule', limit: 200, sort: 'startDate:asc' }));
        const t = today(); const end = addDays(t, i.days);
        const items = res.items.filter((x) => x.startDate && x.endDate && x.startDate <= end && x.endDate >= t).map((x) => ({ id: x.id, name: x.name, startDate: x.startDate, endDate: x.endDate, isMilestone: x.isMilestone, status: x.status, assignees: x.assignees.map((a) => a.displayName) }));
        return { output: items, summary: items.length ? `${items.length} item${items.length === 1 ? '' : 's'} in the next ${i.days} days: ${items.slice(0, 10).map((x) => `${x.isMilestone ? '★ ' : ''}${x.name} (${x.startDate} → ${x.endDate})`).join('; ')}.` : `Nothing scheduled in the next ${i.days} days.`, link: `/projects/${i.projectId}/schedule` };
      },
    },
    {
      name: 'unpaid_invoices', kind: 'read', permission: 'invoices.read',
      description: 'Invoices that are sent but not fully paid, with balances and due dates, optionally for one project.',
      input: z.object({ projectId: projectId.optional() }),
      summarize: () => 'checked unpaid invoices',
      run: async (ctx, i) => {
        const res = await s.invoices.list(ctx, contracts.listInvoicesQuery.parse({ projectId: i.projectId, status: 'open', limit: 100 }));
        const items = res.items.map((x) => ({ id: x.id, number: x.number, title: x.title, projectId: x.projectId, projectName: x.projectName, clientName: x.clientName, dueDate: x.dueDate, balanceCents: x.balanceCents, status: x.status }));
        const total = items.reduce((n, x) => n + x.balanceCents, 0);
        return { output: items, summary: items.length ? `${money(total)} outstanding across ${items.length} invoice${items.length === 1 ? '' : 's'}: ${items.map((x) => `${x.number}${x.projectName ? ` (${x.projectName})` : ''} ${money(x.balanceCents)}${x.status === 'overdue' ? ' OVERDUE' : x.dueDate ? ` due ${x.dueDate}` : ''}`).join('; ')}.` : 'No unpaid invoices.', link: '/invoices' };
      },
    },
    {
      name: 'pending_approvals', kind: 'read', permission: 'change_orders.read',
      description: 'Proposals, change orders and selections waiting on a client decision.',
      input: z.object({ projectId: projectId.optional() }),
      summarize: () => 'checked pending approvals',
      run: async (ctx, i) => {
        const res = await s.portal.listApprovals(ctx, contracts.listApprovalsQuery.parse({ projectId: i.projectId, status: 'pending', limit: 50 }));
        const items = res.items.map((a) => ({ objectType: a.objectType, title: a.title, projectName: a.projectName, amountCents: a.amountCents, requestedAt: a.requestedAt, link: a.link }));
        return { output: items, summary: items.length ? `${items.length} waiting: ${items.map((a) => `${a.title}${a.projectName ? ` (${a.projectName})` : ''}${a.amountCents != null ? ` ${money(a.amountCents)}` : ''}`).join('; ')}.` : 'Nothing is waiting on a client decision.' };
      },
    },
    {
      name: 'recent_activity', kind: 'read', permission: 'activity.read',
      description: 'The latest things that happened on a project (or company-wide): who did what, when.',
      input: z.object({ projectId: projectId.optional(), limit: z.number().int().min(1).max(30).default(12) }),
      summarize: () => 'read the recent activity',
      run: async (ctx, i) => {
        const res = await s.activity.list(ctx, { projectId: i.projectId, limit: i.limit });
        const items = res.items.map((a) => ({ summary: a.summary, occurredAt: a.occurredAt }));
        return { output: items, summary: items.length ? items.map((a) => `${a.occurredAt.slice(0, 10)}: ${a.summary}`).join('; ') : 'No activity yet.', link: i.projectId ? `/projects/${i.projectId}/activity` : '/' };
      },
    },
    {
      name: 'daily_logs', kind: 'read', permission: 'daily_logs.read',
      description: 'Recent daily logs for a project: weather, crews, work done, delays.',
      input: z.object({ projectId, days: z.number().int().min(1).max(60).default(7) }),
      summarize: (i) => `read the last ${i.days} days of daily logs`,
      run: async (ctx, i) => {
        const res = await s.dailyLogs.list(ctx, { projectId: i.projectId, from: addDays(today(), -i.days), limit: 30 });
        const items = res.items.map((l) => ({ date: l.logDate, summary: l.summary, weather: l.weather?.conditions ?? null, delays: l.entries.filter((e) => e.type === 'delay').map((e) => `${e.text}${e.delayHours ? ` (${e.delayHours}h)` : ''}`), crews: l.entries.filter((e) => e.type === 'crew').map((e) => `${e.trade ?? 'crew'} ×${e.headcount ?? 0}`) }));
        return { output: items, summary: items.length ? items.map((l) => `${l.date}: ${l.summary}${l.delays.length ? ` Delays: ${l.delays.join('; ')}.` : ''}`).join(' ') : `No daily logs in the last ${i.days} days.`, link: `/projects/${i.projectId}/daily-logs` };
      },
    },
    {
      name: 'time_summary', kind: 'read', permission: 'time.clock',
      description: 'Hours worked per person for a date range (defaults to this week), optionally for one project.',
      input: z.object({ from: z.string().optional(), to: z.string().optional(), projectId: projectId.optional() }),
      summarize: () => 'checked the timesheet',
      run: async (ctx, i) => {
        const t = today(); const monday = addDays(t, -((new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7));
        const sheet = await s.time.timesheet(ctx, { from: i.from ?? monday, to: i.to ?? addDays(monday, 6), projectId: i.projectId });
        const rows = sheet.rows.map((r) => ({ name: r.userName, hours: Math.round(r.totalSeconds / 360) / 10, pendingHours: Math.round(r.pendingSeconds / 360) / 10 }));
        return { output: { from: sheet.from, to: sheet.to, rows, laborCostCents: sheet.laborCostCents }, summary: rows.length ? `${Math.round(sheet.totalSeconds / 360) / 10} hours from ${sheet.from} to ${sheet.to}: ${rows.map((r) => `${r.name} ${r.hours}h${r.pendingHours ? ` (${r.pendingHours}h awaiting approval)` : ''}`).join(', ')}.` : `No time recorded between ${sheet.from} and ${sheet.to}.`, link: '/time' };
      },
    },
    {
      name: 'search', kind: 'read', permission: 'projects.read',
      description: 'Full-text search across projects, tasks, documents, daily logs, messages and people.',
      input: z.object({ query: z.string().min(1).max(200) }),
      summarize: (i) => `searched for "${i.query}"`,
      run: async (ctx, i) => {
        const results = await s.search.search(ctx, { q: i.query, limit: 10 });
        const items = results.map((r) => ({ type: r.type, title: r.title, subtitle: r.subtitle, link: r.link }));
        return { output: items, summary: items.length ? `Found ${items.length}: ${items.map((r) => `${r.type} "${r.title}"`).join('; ')}.` : `Nothing matched "${i.query}".` };
      },
    },
    // ---- write tools (confirmed by the person before they run) ----
    {
      name: 'create_task', kind: 'write', permission: 'tasks.write',
      description: 'Create a to-do on a project, optionally with a due date and assignee (by name).',
      input: z.object({ projectId, name: z.string().min(1).max(200), dueDate: z.string().optional().describe('YYYY-MM-DD'), assigneeName: z.string().optional(), description: z.string().max(2000).optional() }),
      summarize: (i) => `create the to-do "${i.name}"${i.dueDate ? ` due ${i.dueDate}` : ''}${i.assigneeName ? ` for ${i.assigneeName}` : ''}`,
      run: async (ctx, i) => {
        let assigneeUserIds: string[] = [];
        if (i.assigneeName) {
          const members = await s.organizations.listMembers(ctx);
          const m = members.find((x) => `${x.firstName} ${x.lastName}`.toLowerCase().includes(i.assigneeName!.toLowerCase()) || x.firstName.toLowerCase() === i.assigneeName!.toLowerCase());
          if (!m) throw AppError.validation(`No team member called ${i.assigneeName}.`);
          assigneeUserIds = [m.userId];
        }
        const task = await s.schedule.createTask(ctx, i.projectId, contracts.createTaskBody.parse({ kind: 'todo', name: i.name, description: i.description ?? '', dueDate: i.dueDate ?? null, assigneeUserIds }));
        return { output: { id: task.id, name: task.name }, summary: `Created the to-do "${task.name}"${task.dueDate ? ` due ${task.dueDate}` : ''}.`, link: `/projects/${i.projectId}/tasks/${task.id}` };
      },
    },
    {
      name: 'post_message', kind: 'write', permission: 'messages.write',
      description: 'Start a message thread on a project with the team (or, if clientVisible, with the client too).',
      input: z.object({ projectId, subject: z.string().min(1).max(200), body: z.string().min(1).max(4000), clientVisible: z.boolean().default(false) }),
      summarize: (i) => `post "${i.subject}" to the ${i.clientVisible ? 'client and team' : 'team'}`,
      run: async (ctx, i) => {
        const thread = await s.messages.createThread(ctx, contracts.createThreadBody.parse({ projectId: i.projectId, kind: 'project', subject: i.subject, clientVisible: i.clientVisible, initialMessage: i.body }));
        return { output: { id: thread.id }, summary: `Posted "${thread.subject}".`, link: `/projects/${i.projectId}/messages/${thread.id}` };
      },
    },
    {
      name: 'create_change_order', kind: 'write', permission: 'change_orders.write',
      description: 'Draft a change order for extra work with a single priced line (client price, no further markup).',
      input: z.object({ projectId, title: z.string().min(1).max(200), amountCents: z.number().int().positive().describe('Client price in cents'), description: z.string().max(2000).optional(), reason: z.enum(['client_request', 'unforeseen_condition', 'design_change', 'code_requirement', 'allowance_overage', 'other']).default('client_request') }),
      summarize: (i) => `draft the change order "${i.title}" for ${money(i.amountCents)}`,
      run: async (ctx, i) => {
        const co = await s.changeOrders.create(ctx, i.projectId, { title: i.title, description: i.description ?? '', reason: i.reason, scheduleImpactDays: 0, lines: [{ name: i.title, description: '', quantityThousandths: 1000, unit: 'ea', unitCostCents: { other: i.amountCents }, markupBp: { other: 0 }, taxable: false }] });
        return { output: { id: co.id, number: co.number }, summary: `Drafted change order #${co.number} "${co.title}" for ${money(co.totalCents)}. Send it to the client from the Change Orders section.`, link: `/projects/${i.projectId}/change-orders/${co.id}` };
      },
    },
  ];
}

/** JSON schema the language model sees for a tool's input. */
export function toolInputSchema(t: ToolDef): Record<string, unknown> {
  const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
