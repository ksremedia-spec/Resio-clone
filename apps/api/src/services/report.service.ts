import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { clients, invoices, leads, projects, timeEntries, users } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import type { BudgetService } from './budget.service.js';

type ReportQuery = { from?: string; to?: string; projectId?: string; status: 'open' | 'all'; format: 'json' | 'csv' };

/**
 * Reports are read-only views over the same tables the screens use, so a
 * number on a report always matches the screen it came from. Each report
 * checks the permission of the data it exposes on top of `reports.read`.
 */
export class ReportService {
  constructor(private readonly deps: Deps, private readonly budget: BudgetService) {}

  catalog(ctx: RequestContext): Array<{ key: contracts.ReportKey; name: string; description: string; permission: string }> {
    ctx.require('reports.read');
    const all: Array<{ key: contracts.ReportKey; name: string; description: string; permission: string }> = [
      { key: 'job_cost', name: 'Job cost', description: 'Budget vs. committed vs. actual for every project, with projected margin.', permission: 'budget.read' },
      { key: 'ar_aging', name: 'Receivables aging', description: 'Unpaid invoices by how long they have been outstanding.', permission: 'invoices.read' },
      { key: 'time_by_project', name: 'Time by project', description: 'Hours and labour cost per project and per person for a date range.', permission: 'time.manage' },
      { key: 'pipeline', name: 'Sales pipeline', description: 'Leads by stage and source, win rate and follow-ups due.', permission: 'leads.read' },
    ];
    return all.filter((r) => ctx.has(r.permission as any) || (r.key === 'time_by_project' && ctx.has('time.approve')));
  }

  async run(ctx: RequestContext, key: string, query: ReportQuery): Promise<{ json: unknown; csv: string; filename: string }> {
    ctx.require('reports.read');
    switch (key) {
      case 'job_cost': { const r = await this.jobCost(ctx, query); return { json: r, csv: toCsv(['Project #', 'Project', 'Client', 'Status', 'Original budget', 'Approved changes', 'Revised budget', 'Committed', 'Actual', 'Projected', 'Variance', 'Revised contract', 'Invoiced', 'Paid', 'Outstanding', 'Projected margin', 'Margin %', 'Health'], r.rows.map((x) => [x.number, x.name, x.clientName ?? '', x.status, ...[x.originalCents, x.approvedChangesCents, x.revisedCents, x.committedCents, x.actualCents, x.projectedCents, x.varianceCents, x.revisedContractCents, x.invoicedCents, x.paidCents, x.outstandingCents, x.projectedMarginCents].map(dollars), (x.projectedMarginBp / 100).toFixed(1), x.health])), filename: 'job-cost.csv' }; }
      case 'ar_aging': { const r = await this.arAging(ctx, query); return { json: r, csv: toCsv(['Invoice', 'Title', 'Project', 'Client', 'Issued', 'Due', 'Total', 'Paid', 'Balance', 'Days overdue', 'Bucket'], r.rows.map((x) => [x.number, x.title, x.projectName, x.clientName ?? '', x.issueDate ?? '', x.dueDate ?? '', dollars(x.totalCents), dollars(x.paidCents), dollars(x.balanceCents), String(x.daysOverdue), x.bucket])), filename: 'receivables-aging.csv' }; }
      case 'time_by_project': { const r = await this.timeByProject(ctx, query); const rows: string[][] = []; for (const p of r.rows) for (const person of p.people) rows.push([p.projectName, person.name, (person.seconds / 3600).toFixed(2), dollars(person.laborCostCents)]); return { json: r, csv: toCsv(['Project', 'Person', 'Hours', 'Labour cost'], rows), filename: `time-by-project-${r.from}-to-${r.to}.csv` }; }
      case 'pipeline': { const r = await this.pipeline(ctx); return { json: r, csv: toCsv(['Stage', 'Leads', 'Estimated value'], r.stages.map((s) => [s.stage, String(s.count), dollars(s.valueCents)])), filename: 'pipeline.csv' }; }
      default: throw AppError.notFound('Report');
    }
  }

  async jobCost(ctx: RequestContext, query: ReportQuery) {
    ctx.require('budget.read');
    const { db } = this.deps;
    const overview = await this.budget.overview(ctx, { includeWithoutBudget: true });
    const clientNames = new Map((await db.select({ id: projects.id, name: clients.displayName }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.organizationId, ctx.organizationId))).map((r) => [r.id, r.name]));
    const closed = new Set(['complete', 'closed', 'cancelled', 'warranty']);
    const rows = overview.filter((p) => (query.status === 'all' || !closed.has(p.status)) && (!query.projectId || p.projectId === query.projectId)).map((p) => {
      const margin = p.contract.projectedMarginCents;
      const marginBp = p.contract.revisedContractCents ? Math.round((margin * 10_000) / p.contract.revisedContractCents) : 0;
      const st = p.totals.status as string;
      const health: 'on_track' | 'watch' | 'over' = st === 'over' ? 'over' : st === 'warning' || st === 'watch' ? 'watch' : 'on_track';
      return { projectId: p.projectId, number: p.projectNumber, name: p.projectName, status: p.status, clientName: clientNames.get(p.projectId) ?? null, originalCents: p.totals.originalCents, approvedChangesCents: p.totals.approvedChangesCents, revisedCents: p.totals.revisedCents, committedCents: p.totals.committedCents, actualCents: p.totals.actualCents, projectedCents: p.totals.projectedCents, varianceCents: p.totals.varianceCents, revisedContractCents: p.contract.revisedContractCents, invoicedCents: p.contract.invoicedCents, paidCents: p.contract.paidCents, outstandingCents: p.contract.outstandingCents, projectedMarginCents: margin, projectedMarginBp: marginBp, percentSpentBp: p.totals.percentSpentBp, health };
    });
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((n, r) => n + (r[k] as number), 0);
    const totals = { originalCents: sum('originalCents'), approvedChangesCents: sum('approvedChangesCents'), revisedCents: sum('revisedCents'), committedCents: sum('committedCents'), actualCents: sum('actualCents'), projectedCents: sum('projectedCents'), varianceCents: sum('varianceCents'), revisedContractCents: sum('revisedContractCents'), invoicedCents: sum('invoicedCents'), paidCents: sum('paidCents'), outstandingCents: sum('outstandingCents'), projectedMarginCents: sum('projectedMarginCents'), projectedMarginBp: 0, percentSpentBp: 0 };
    totals.projectedMarginBp = totals.revisedContractCents ? Math.round((totals.projectedMarginCents * 10_000) / totals.revisedContractCents) : 0;
    totals.percentSpentBp = totals.revisedCents ? Math.round((totals.actualCents * 10_000) / totals.revisedCents) : 0;
    return { generatedAt: new Date().toISOString(), rows, totals };
  }

  async arAging(ctx: RequestContext, query: ReportQuery) {
    ctx.require('invoices.read');
    const { db } = this.deps;
    const asOf = query.to ?? new Date().toISOString().slice(0, 10);
    const conditions = [eq(invoices.organizationId, ctx.organizationId), isNull(invoices.archivedAt), inArray(invoices.status, ['sent', 'viewed', 'partially_paid', 'overdue']), sql`${invoices.totalCents} - ${invoices.paidCents} > 0`];
    const visible = await ctx.visibleProjectIds(db);
    if (visible) conditions.push(visible.length ? inArray(invoices.projectId, visible) : sql`false`);
    if (query.projectId) conditions.push(eq(invoices.projectId, query.projectId));
    const rows = await db.select({ i: invoices, projectName: projects.name, clientName: clients.displayName }).from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId)).leftJoin(clients, eq(clients.id, invoices.clientId)).where(and(...conditions)).orderBy(asc(invoices.dueDate), asc(invoices.number));
    const asOfMs = new Date(`${asOf}T12:00:00Z`).getTime();
    const buckets: Record<(typeof contracts.AGING_BUCKETS)[number], number> = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 };
    const byClient = new Map<string, { balanceCents: number; overdueCents: number }>();
    const out = rows.map(({ i, projectName, clientName }) => {
      const balance = i.totalCents - i.paidCents;
      const due = i.dueDate ? new Date(`${i.dueDate}T12:00:00Z`).getTime() : asOfMs;
      const daysOverdue = Math.max(0, Math.floor((asOfMs - due) / 86_400_000));
      const bucket = daysOverdue === 0 ? 'current' : daysOverdue <= 30 ? 'days_1_30' : daysOverdue <= 60 ? 'days_31_60' : daysOverdue <= 90 ? 'days_61_90' : 'days_90_plus';
      buckets[bucket] += balance;
      const c = byClient.get(clientName ?? 'No client') ?? { balanceCents: 0, overdueCents: 0 };
      c.balanceCents += balance; if (daysOverdue > 0) c.overdueCents += balance; byClient.set(clientName ?? 'No client', c);
      return { invoiceId: i.id, number: i.number, title: i.title, projectId: i.projectId, projectName, clientName, issueDate: i.issueDate, dueDate: i.dueDate, totalCents: i.totalCents, paidCents: i.paidCents, balanceCents: balance, daysOverdue, bucket };
    });
    return { generatedAt: new Date().toISOString(), asOf, rows: out, buckets, totalCents: out.reduce((n, r) => n + r.balanceCents, 0), byClient: [...byClient.entries()].map(([clientName, v]) => ({ clientName, ...v })).sort((a, b) => b.balanceCents - a.balanceCents) };
  }

  async timeByProject(ctx: RequestContext, query: ReportQuery) {
    ctx.requireAny('time.manage', 'time.approve');
    const { db } = this.deps;
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const from = query.from ?? new Date(new Date(`${to}T12:00:00Z`).getTime() - 27 * 86_400_000).toISOString().slice(0, 10);
    const conditions = [eq(timeEntries.organizationId, ctx.organizationId), isNull(timeEntries.archivedAt), sql`${timeEntries.clockInAt} >= ${`${from}T00:00:00Z`}`, sql`${timeEntries.clockInAt} <= ${`${to}T23:59:59Z`}`, sql`${timeEntries.status} not in ('open', 'rejected')`];
    const visible = await ctx.visibleProjectIds(db);
    if (visible) conditions.push(visible.length ? sql`(${timeEntries.projectId} is null or ${inArray(timeEntries.projectId, visible)})` : sql`${timeEntries.projectId} is null`);
    if (query.projectId) conditions.push(eq(timeEntries.projectId, query.projectId));
    const rows = await db.select({ t: timeEntries, projectName: projects.name, firstName: users.firstName, lastName: users.lastName }).from(timeEntries).leftJoin(projects, eq(projects.id, timeEntries.projectId)).innerJoin(users, eq(users.id, timeEntries.userId)).where(and(...conditions));
    const byProject = new Map<string, { projectId: string | null; projectName: string; seconds: number; laborCostCents: number; entries: number; approvedSeconds: number; people: Map<string, { userId: string; name: string; seconds: number; laborCostCents: number }> }>();
    for (const { t, projectName, firstName, lastName } of rows) {
      const key = t.projectId ?? 'none';
      if (!byProject.has(key)) byProject.set(key, { projectId: t.projectId, projectName: projectName ?? 'No project', seconds: 0, laborCostCents: 0, entries: 0, approvedSeconds: 0, people: new Map() });
      const p = byProject.get(key)!;
      const secs = t.durationSeconds ?? 0;
      p.seconds += secs; p.laborCostCents += t.laborCostCents ?? 0; p.entries += 1; if (t.status === 'approved' || t.status === 'exported') p.approvedSeconds += secs;
      const person = p.people.get(t.userId) ?? { userId: t.userId, name: `${firstName} ${lastName}`.trim(), seconds: 0, laborCostCents: 0 };
      person.seconds += secs; person.laborCostCents += t.laborCostCents ?? 0; p.people.set(t.userId, person);
    }
    const out = [...byProject.values()].map((p) => ({ ...p, people: [...p.people.values()].sort((a, b) => b.seconds - a.seconds) })).sort((a, b) => b.seconds - a.seconds);
    return { generatedAt: new Date().toISOString(), from, to, rows: out, totals: { seconds: out.reduce((n, r) => n + r.seconds, 0), laborCostCents: out.reduce((n, r) => n + r.laborCostCents, 0), entries: out.reduce((n, r) => n + r.entries, 0), approvedSeconds: out.reduce((n, r) => n + r.approvedSeconds, 0) } };
  }

  async pipeline(ctx: RequestContext) {
    ctx.require('leads.read');
    const rows = await this.deps.db.select().from(leads).where(and(eq(leads.organizationId, ctx.organizationId), isNull(leads.archivedAt)));
    const stages = contracts.LEAD_STAGES.map((stage) => { const items = rows.filter((r) => r.stage === stage); return { stage, count: items.length, valueCents: items.reduce((n, r) => n + (r.estimatedValueCents ?? 0), 0) }; });
    const sources = new Map<string, { count: number; wonCount: number; valueCents: number }>();
    for (const r of rows) { const s = sources.get(r.source ?? 'unknown') ?? { count: 0, wonCount: 0, valueCents: 0 }; s.count += 1; if (r.stage === 'won') s.wonCount += 1; s.valueCents += r.estimatedValueCents ?? 0; sources.set(r.source ?? 'unknown', s); }
    const open = rows.filter((r) => (contracts.OPEN_LEAD_STAGES as readonly string[]).includes(r.stage));
    const won = rows.filter((r) => r.stage === 'won');
    const lost = rows.filter((r) => r.stage === 'lost');
    const now = Date.now();
    return {
      generatedAt: new Date().toISOString(), stages, sources: [...sources.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.count - a.count),
      openCount: open.length, openValueCents: open.reduce((n, r) => n + (r.estimatedValueCents ?? 0), 0), wonCount: won.length, wonValueCents: won.reduce((n, r) => n + (r.estimatedValueCents ?? 0), 0), lostCount: lost.length,
      winRateBp: won.length + lost.length ? Math.round((won.length * 10_000) / (won.length + lost.length)) : 0,
      followUpsDue: open.filter((r) => r.nextFollowUpAt && new Date(r.nextFollowUpAt).getTime() <= now).length,
    };
  }
}

const dollars = (c: number) => (c / 100).toFixed(2);
export function toCsv(header: string[], rows: string[][]): string {
  const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
