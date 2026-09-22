import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { costCodes, memberships, projects, tasks, timeBreaks, timeEntries, users } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import { usersWithPermission } from '../lib/recipients.js';

type Row = typeof timeEntries.$inferSelect;

/**
 * Time clock. One open entry per person; breaks pause it; clocking out
 * computes hours and labour cost from the member's hourly cost so the budget
 * sees real labour the moment a supervisor approves the entry.
 */
export class TimeService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService) {}

  /** The caller's open entry, if any. */
  async current(ctx: RequestContext): Promise<contracts.TimeEntry | null> {
    ctx.require('time.clock');
    const [row] = await this.deps.db.select().from(timeEntries).where(and(eq(timeEntries.organizationId, ctx.organizationId), eq(timeEntries.userId, ctx.userId), eq(timeEntries.status, 'open'))).limit(1);
    return row ? this.load(this.deps.db, row.id) : null;
  }

  async clockIn(ctx: RequestContext, input: { projectId?: string | null; taskId?: string | null; costCodeId?: string | null; notes?: string; location?: contracts.TimeEntry['clockInLocation']; clientMutationId?: string }): Promise<contracts.TimeEntry> {
    ctx.require('time.clock');
    const id = await this.deps.db.transaction(async (tx) => {
      if (input.clientMutationId) {
        const [dup] = await tx.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.organizationId, ctx.organizationId), eq(timeEntries.clientMutationId, input.clientMutationId))).limit(1);
        if (dup) return dup.id;
      }
      const [open] = await tx.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.organizationId, ctx.organizationId), eq(timeEntries.userId, ctx.userId), eq(timeEntries.status, 'open'))).limit(1);
      if (open) throw AppError.conflict('You are already clocked in. Clock out first.');
      if (input.projectId) await ctx.requireProjectAccess(tx, input.projectId);
      if (input.taskId) { const [t] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.organizationId, ctx.organizationId))).limit(1); if (!t) throw AppError.notFound('Task'); }
      const rate = await this.rateFor(tx, ctx.organizationId, ctx.userId);
      const [row] = await tx.insert(timeEntries).values({ organizationId: ctx.organizationId, userId: ctx.userId, projectId: input.projectId ?? null, taskId: input.taskId ?? null, costCodeId: input.costCodeId ?? null, clockInAt: new Date().toISOString(), status: 'open', notes: input.notes ?? '', clockInLocation: input.location ?? null, hourlyCostCents: rate, clientMutationId: input.clientMutationId ?? null, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: input.projectId ?? null, verb: 'clocked_in', objectType: 'time_entry', objectId: row!.id, objectLabel: '' });
      return row!.id;
    });
    return this.load(this.deps.db, id);
  }

  async clockOut(ctx: RequestContext, input: { notes?: string; location?: contracts.TimeEntry['clockOutLocation'] } = {}): Promise<contracts.TimeEntry> {
    ctx.require('time.clock');
    const id = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(timeEntries).where(and(eq(timeEntries.organizationId, ctx.organizationId), eq(timeEntries.userId, ctx.userId), eq(timeEntries.status, 'open'))).limit(1);
      if (!row) throw AppError.conflict('You are not clocked in.');
      const now = new Date().toISOString();
      await tx.update(timeBreaks).set({ endedAt: now }).where(and(eq(timeBreaks.timeEntryId, row.id), isNull(timeBreaks.endedAt)));
      const breaks = await tx.select().from(timeBreaks).where(eq(timeBreaks.timeEntryId, row.id));
      const breakSeconds = breaks.reduce((n, b) => n + Math.max(0, Math.round((Date.parse(b.endedAt ?? now) - Date.parse(b.startedAt)) / 1000)), 0);
      const duration = Math.max(0, Math.round((Date.parse(now) - Date.parse(row.clockInAt)) / 1000) - breakSeconds);
      await tx.update(timeEntries).set({ clockOutAt: now, breakSeconds, durationSeconds: duration, laborCostCents: laborCost(duration, row.hourlyCostCents), status: 'submitted', notes: input.notes ?? row.notes, clockOutLocation: input.location ?? null, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${timeEntries.version} + 1` }).where(eq(timeEntries.id, row.id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'clocked_out', objectType: 'time_entry', objectId: row.id, objectLabel: `${(duration / 3600).toFixed(2)}h` });
      return row.id;
    });
    return this.load(this.deps.db, id);
  }

  async startBreak(ctx: RequestContext): Promise<contracts.TimeEntry> {
    ctx.require('time.clock');
    const id = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(timeEntries).where(and(eq(timeEntries.organizationId, ctx.organizationId), eq(timeEntries.userId, ctx.userId), eq(timeEntries.status, 'open'))).limit(1);
      if (!row) throw AppError.conflict('You are not clocked in.');
      const [open] = await tx.select({ id: timeBreaks.id }).from(timeBreaks).where(and(eq(timeBreaks.timeEntryId, row.id), isNull(timeBreaks.endedAt))).limit(1);
      if (open) throw AppError.conflict('You are already on a break.');
      await tx.insert(timeBreaks).values({ organizationId: ctx.organizationId, timeEntryId: row.id, startedAt: new Date().toISOString(), createdBy: ctx.userId, updatedBy: ctx.userId });
      return row.id;
    });
    return this.load(this.deps.db, id);
  }

  async endBreak(ctx: RequestContext): Promise<contracts.TimeEntry> {
    ctx.require('time.clock');
    const id = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(timeEntries).where(and(eq(timeEntries.organizationId, ctx.organizationId), eq(timeEntries.userId, ctx.userId), eq(timeEntries.status, 'open'))).limit(1);
      if (!row) throw AppError.conflict('You are not clocked in.');
      const [open] = await tx.update(timeBreaks).set({ endedAt: new Date().toISOString() }).where(and(eq(timeBreaks.timeEntryId, row.id), isNull(timeBreaks.endedAt))).returning();
      if (!open) throw AppError.conflict('You are not on a break.');
      return row.id;
    });
    return this.load(this.deps.db, id);
  }

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; userId?: string; from?: string; to?: string; status: string }) {
    ctx.requireAny('time.clock', 'time.manage', 'time.approve');
    const { db } = this.deps;
    const conditions = [eq(timeEntries.organizationId, ctx.organizationId), isNull(timeEntries.archivedAt)];
    const manager = ctx.has('time.manage') || ctx.has('time.approve');
    if (!manager || query.userId === ctx.userId) conditions.push(eq(timeEntries.userId, ctx.userId));
    else if (query.userId) conditions.push(eq(timeEntries.userId, query.userId));
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(timeEntries.projectId, query.projectId)); }
    else if (manager) { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? sql`(${timeEntries.projectId} is null or ${inArray(timeEntries.projectId, visible)})` : sql`${timeEntries.projectId} is null`); }
    if (query.from) conditions.push(gte(timeEntries.clockInAt, `${query.from}T00:00:00Z`));
    if (query.to) conditions.push(lte(timeEntries.clockInAt, `${query.to}T23:59:59Z`));
    if (query.status === 'pending') conditions.push(eq(timeEntries.status, 'submitted'));
    else if (query.status !== 'all') conditions.push(eq(timeEntries.status, query.status));
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${timeEntries.clockInAt}, ${timeEntries.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await db.select({ id: timeEntries.id, clockInAt: timeEntries.clockInAt }).from(timeEntries).where(and(...conditions)).orderBy(desc(timeEntries.clockInAt), desc(timeEntries.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.clockInAt, id: r.id }));
    const items = await this.loadMany(db, result.items.map((r) => r.id));
    return { items, nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.TimeEntry> {
    ctx.requireAny('time.clock', 'time.manage', 'time.approve');
    const [row] = await this.deps.db.select().from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Time entry');
    if (row.userId !== ctx.userId && !ctx.has('time.manage') && !ctx.has('time.approve')) throw AppError.notFound('Time entry');
    return this.load(this.deps.db, id);
  }

  /** Manual entry (forgot to clock in, or a manager entering time for someone). */
  async create(ctx: RequestContext, input: { userId?: string; projectId?: string | null; taskId?: string | null; costCodeId?: string | null; clockInAt: string; clockOutAt: string; breakSeconds: number; notes: string }): Promise<contracts.TimeEntry> {
    ctx.require('time.clock');
    const userId = input.userId ?? ctx.userId;
    if (userId !== ctx.userId) ctx.require('time.manage');
    if (Date.parse(input.clockOutAt) <= Date.parse(input.clockInAt)) throw AppError.validation('Clock out must be after clock in.');
    const id = await this.deps.db.transaction(async (tx) => {
      if (input.projectId) await ctx.requireProjectAccess(tx, input.projectId);
      const rate = await this.rateFor(tx, ctx.organizationId, userId);
      const duration = Math.max(0, Math.round((Date.parse(input.clockOutAt) - Date.parse(input.clockInAt)) / 1000) - input.breakSeconds);
      const [row] = await tx.insert(timeEntries).values({ organizationId: ctx.organizationId, userId, projectId: input.projectId ?? null, taskId: input.taskId ?? null, costCodeId: input.costCodeId ?? null, clockInAt: input.clockInAt, clockOutAt: input.clockOutAt, breakSeconds: input.breakSeconds, durationSeconds: duration, laborCostCents: laborCost(duration, rate), hourlyCostCents: rate, status: 'submitted', notes: input.notes, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: input.projectId ?? null, verb: 'logged', objectType: 'time_entry', objectId: row!.id, objectLabel: `${(duration / 3600).toFixed(2)}h${userId !== ctx.userId ? ' for a team member' : ''}` });
      return row!.id;
    });
    return this.load(this.deps.db, id);
  }

  async update(ctx: RequestContext, id: string, input: Record<string, any>): Promise<contracts.TimeEntry> {
    ctx.require('time.clock');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.organizationId, ctx.organizationId))).limit(1);
      if (!row) throw AppError.notFound('Time entry');
      if (row.userId !== ctx.userId) ctx.require('time.manage');
      if (['approved', 'exported'].includes(row.status) && !ctx.has('time.manage')) throw AppError.conflict('Approved time can only be changed by a manager.');
      if (row.status === 'open') throw AppError.conflict('Clock out before editing this entry.');
      const clockInAt = input.clockInAt ?? row.clockInAt;
      const clockOutAt = input.clockOutAt ?? row.clockOutAt!;
      const breakSeconds = input.breakSeconds ?? row.breakSeconds;
      if (Date.parse(clockOutAt) <= Date.parse(clockInAt)) throw AppError.validation('Clock out must be after clock in.');
      const duration = Math.max(0, Math.round((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 1000) - breakSeconds);
      const [after] = await tx.update(timeEntries).set({ ...input, clockInAt, clockOutAt, breakSeconds, durationSeconds: duration, laborCostCents: laborCost(duration, row.hourlyCostCents), status: row.status === 'rejected' ? 'submitted' : row.status, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${timeEntries.version} + 1` } as any).where(eq(timeEntries.id, id)).returning();
      const diff = diffRecords(row as any, after as any, ['updatedAt', 'updatedBy', 'version', 'laborCostCents', 'durationSeconds']);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: after!.projectId, verb: 'corrected', objectType: 'time_entry', objectId: id, objectLabel: `${(duration / 3600).toFixed(2)}h`, diff });
    });
    return this.load(this.deps.db, id);
  }

  async decide(ctx: RequestContext, input: { ids: string[]; decision: 'approved' | 'rejected'; note?: string }): Promise<contracts.TimeEntry[]> {
    ctx.require('time.approve');
    await this.deps.db.transaction(async (tx) => {
      const rows = await tx.select().from(timeEntries).where(and(eq(timeEntries.organizationId, ctx.organizationId), inArray(timeEntries.id, input.ids)));
      if (rows.length !== input.ids.length) throw AppError.notFound('Time entry');
      const visible = await ctx.visibleProjectIds(tx);
      for (const r of rows) {
        if (r.status === 'open') throw AppError.conflict('An open entry cannot be approved until the person clocks out.');
        if (visible && r.projectId && !visible.includes(r.projectId)) throw AppError.notFound('Time entry');
        await tx.update(timeEntries).set({ status: input.decision, approvedBy: input.decision === 'approved' ? ctx.userId : null, approvedAt: input.decision === 'approved' ? sql`now()` : null, notes: input.note ? `${r.notes}${r.notes ? '\n' : ''}${input.decision === 'rejected' ? 'Rejected' : 'Approved'}: ${input.note}` : r.notes, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${timeEntries.version} + 1` }).where(eq(timeEntries.id, r.id));
        await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: r.projectId, verb: input.decision, objectType: 'time_entry', objectId: r.id, objectLabel: `${((r.durationSeconds ?? 0) / 3600).toFixed(2)}h` });
      }
      const byUser = new Map<string, number>();
      for (const r of rows) byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + (r.durationSeconds ?? 0));
      for (const [userId, secs] of byUser) await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: [userId], excludeUserId: ctx.userId, kind: 'time.approved', title: `${(secs / 3600).toFixed(1)} hours ${input.decision}`, body: `${ctx.actorName} ${input.decision} your time${input.note ? `: ${input.note}` : '.'}`, link: '/time' });
    });
    return this.loadMany(this.deps.db, input.ids);
  }

  /** Hours per person per day for a period, for the approvals screen and payroll. */
  async timesheet(ctx: RequestContext, query: { from: string; to: string; projectId?: string }): Promise<contracts.TimesheetResponse> {
    ctx.requireAny('time.manage', 'time.approve', 'time.clock');
    const { db } = this.deps;
    const manager = ctx.has('time.manage') || ctx.has('time.approve');
    const conditions = [eq(timeEntries.organizationId, ctx.organizationId), isNull(timeEntries.archivedAt), gte(timeEntries.clockInAt, `${query.from}T00:00:00Z`), lte(timeEntries.clockInAt, `${query.to}T23:59:59Z`), sql`${timeEntries.status} <> 'open'`];
    if (!manager) conditions.push(eq(timeEntries.userId, ctx.userId));
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(timeEntries.projectId, query.projectId)); }
    else if (manager) { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? sql`(${timeEntries.projectId} is null or ${inArray(timeEntries.projectId, visible)})` : sql`${timeEntries.projectId} is null`); }
    const rows = await db.select({ t: timeEntries, firstName: users.firstName, lastName: users.lastName }).from(timeEntries).innerJoin(users, eq(users.id, timeEntries.userId)).where(and(...conditions)).orderBy(asc(timeEntries.clockInAt));
    const byUser = new Map<string, contracts.TimesheetResponse['rows'][number]>();
    for (const { t, firstName, lastName } of rows) {
      const key = t.userId;
      if (!byUser.has(key)) byUser.set(key, { userId: key, userName: `${firstName} ${lastName}`.trim(), hourlyCostCents: t.hourlyCostCents, days: {}, totalSeconds: 0, pendingSeconds: 0, approvedSeconds: 0, laborCostCents: 0, entryIds: [] });
      const r = byUser.get(key)!;
      const day = t.clockInAt.slice(0, 10);
      const secs = t.durationSeconds ?? 0;
      r.days[day] = (r.days[day] ?? 0) + secs;
      r.totalSeconds += secs;
      if (t.status === 'submitted') r.pendingSeconds += secs;
      if (t.status === 'approved' || t.status === 'exported') r.approvedSeconds += secs;
      if (t.status !== 'rejected') r.laborCostCents += t.laborCostCents ?? 0;
      r.entryIds.push(t.id);
    }
    const out = [...byUser.values()].sort((a, b) => a.userName.localeCompare(b.userName));
    return { from: query.from, to: query.to, rows: out, totalSeconds: out.reduce((n, r) => n + r.totalSeconds, 0), laborCostCents: out.reduce((n, r) => n + r.laborCostCents, 0) };
  }

  /** CSV of approved time for payroll; optionally marks the entries exported so they are not paid twice. */
  async payrollExport(ctx: RequestContext, input: { from: string; to: string; markExported: boolean }): Promise<{ csv: string; count: number }> {
    ctx.require('time.manage');
    const { db } = this.deps;
    const rows = await db.select({ t: timeEntries, email: users.email, firstName: users.firstName, lastName: users.lastName, projectNumber: projects.number, projectName: projects.name, code: costCodes.code }).from(timeEntries).innerJoin(users, eq(users.id, timeEntries.userId)).leftJoin(projects, eq(projects.id, timeEntries.projectId)).leftJoin(costCodes, eq(costCodes.id, timeEntries.costCodeId))
      .where(and(eq(timeEntries.organizationId, ctx.organizationId), inArray(timeEntries.status, ['approved']), gte(timeEntries.clockInAt, `${input.from}T00:00:00Z`), lte(timeEntries.clockInAt, `${input.to}T23:59:59Z`))).orderBy(asc(users.lastName), asc(timeEntries.clockInAt));
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Employee', 'Email', 'Date', 'Clock in', 'Clock out', 'Break (min)', 'Hours', 'Project', 'Cost code', 'Hourly cost', 'Labor cost', 'Notes'].map(esc).join(',')];
    for (const r of rows) lines.push([`${r.firstName} ${r.lastName}`, r.email, r.t.clockInAt.slice(0, 10), r.t.clockInAt, r.t.clockOutAt ?? '', Math.round(r.t.breakSeconds / 60), ((r.t.durationSeconds ?? 0) / 3600).toFixed(2), r.projectNumber ? `${r.projectNumber} ${r.projectName}` : '', r.code ?? '', ((r.t.hourlyCostCents ?? 0) / 100).toFixed(2), ((r.t.laborCostCents ?? 0) / 100).toFixed(2), r.t.notes].map(esc).join(','));
    if (input.markExported && rows.length) {
      await db.transaction(async (tx) => {
        await tx.update(timeEntries).set({ status: 'exported', exportedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId }).where(inArray(timeEntries.id, rows.map((r) => r.t.id)));
        await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'exported', objectType: 'time_entry', objectLabel: `${rows.length} entries for payroll (${input.from} to ${input.to})` });
      });
    }
    return { csv: lines.join('\n'), count: rows.length };
  }

  /** Managers to nudge when time needs approval (used by the field UI badge). */
  async approvers(db: DbOrTx, organizationId: string) { return usersWithPermission(db, organizationId, 'time.approve'); }

  private async rateFor(tx: DbOrTx, organizationId: string, userId: string): Promise<number | null> {
    const [m] = await tx.select({ rate: memberships.hourlyCostCents }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId))).limit(1);
    return m?.rate ?? null;
  }

  private async load(db: DbOrTx, id: string): Promise<contracts.TimeEntry> {
    const [row] = await this.loadMany(db, [id]);
    if (!row) throw AppError.notFound('Time entry');
    return row;
  }

  private async loadMany(db: DbOrTx, ids: string[]): Promise<contracts.TimeEntry[]> {
    if (!ids.length) return [];
    const rows = await db.select({ t: timeEntries, firstName: users.firstName, lastName: users.lastName, projectName: projects.name, taskName: tasks.name, code: costCodes.code }).from(timeEntries).innerJoin(users, eq(users.id, timeEntries.userId)).leftJoin(projects, eq(projects.id, timeEntries.projectId)).leftJoin(tasks, eq(tasks.id, timeEntries.taskId)).leftJoin(costCodes, eq(costCodes.id, timeEntries.costCodeId)).where(inArray(timeEntries.id, ids));
    const breaks = await db.select().from(timeBreaks).where(inArray(timeBreaks.timeEntryId, ids)).orderBy(asc(timeBreaks.startedAt));
    const byEntry = new Map<string, contracts.TimeEntry['breaks']>();
    for (const b of breaks) { if (!byEntry.has(b.timeEntryId)) byEntry.set(b.timeEntryId, []); byEntry.get(b.timeEntryId)!.push({ id: b.id, startedAt: b.startedAt, endedAt: b.endedAt }); }
    const order = new Map(ids.map((id, i) => [id, i]));
    return rows.sort((a, b) => order.get(a.t.id)! - order.get(b.t.id)!).map(({ t, firstName, lastName, projectName, taskName, code }) => serializeTime(t, `${firstName} ${lastName}`.trim(), projectName, taskName, code, byEntry.get(t.id) ?? []));
  }
}

function laborCost(durationSeconds: number, hourlyCostCents: number | null): number | null {
  return hourlyCostCents == null ? null : Math.round((durationSeconds / 3600) * hourlyCostCents);
}

export function serializeTime(t: Row, userName: string, projectName: string | null, taskName: string | null, code: string | null, breaks: contracts.TimeEntry['breaks']): contracts.TimeEntry {
  return { id: t.id, organizationId: t.organizationId, createdAt: t.createdAt, updatedAt: t.updatedAt, createdBy: t.createdBy, updatedBy: t.updatedBy, version: t.version, userId: t.userId, userName, projectId: t.projectId, projectName, taskId: t.taskId, taskName, costCodeId: t.costCodeId, costCode: code, clockInAt: t.clockInAt, clockOutAt: t.clockOutAt, breakSeconds: t.breakSeconds, durationSeconds: t.durationSeconds, status: t.status as contracts.TimeEntry['status'], notes: t.notes, clockInLocation: (t.clockInLocation as any) ?? null, clockOutLocation: (t.clockOutLocation as any) ?? null, hourlyCostCents: t.hourlyCostCents, laborCostCents: t.laborCostCents, approvedBy: t.approvedBy, approvedAt: t.approvedAt, exportedAt: t.exportedAt, breaks, onBreak: breaks.some((b) => !b.endedAt) };
}
