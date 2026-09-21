import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { rowsOf } from '../db/client.js';
import type { DbOrTx } from '../db/client.js';
import { dailyLogEntries, dailyLogs, projects, users } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import type { DocumentService } from './document.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';

const emptyWeather = (): contracts.DailyLog['weather'] => ({ conditions: null, temperatureHighF: null, temperatureLowF: null, precipitationIn: null, windMph: null, source: 'manual' });

export class DailyLogService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService, private readonly documents: DocumentService) {}

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; from?: string; to?: string; tag?: string; clientVisibleOnly?: boolean; q?: string }) {
    ctx.require('daily_logs.read');
    const { db } = this.deps;
    const conditions = [eq(dailyLogs.organizationId, ctx.organizationId), isNull(dailyLogs.archivedAt)];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(dailyLogs.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? inArray(dailyLogs.projectId, visible) : sql`false`); }
    if (query.from) conditions.push(sql`${dailyLogs.logDate} >= ${query.from}`);
    if (query.to) conditions.push(sql`${dailyLogs.logDate} <= ${query.to}`);
    if (query.tag) conditions.push(sql`${dailyLogs.tags} @> ${JSON.stringify([query.tag])}::jsonb`);
    if (query.clientVisibleOnly || ctx.membership.external) conditions.push(eq(dailyLogs.clientVisible, true));
    if (query.q) conditions.push(sql`to_tsvector('simple', ${dailyLogs.searchText}) @@ plainto_tsquery('simple', ${query.q})`);
    const cursor = decodeCursor<{ d: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${dailyLogs.logDate}, ${dailyLogs.id}) < (${cursor.d}::date, ${cursor.id}::uuid)`);
    const rows = await db.select({ l: dailyLogs, projectName: projects.name }).from(dailyLogs).innerJoin(projects, eq(projects.id, dailyLogs.projectId)).where(and(...conditions)).orderBy(desc(dailyLogs.logDate), desc(dailyLogs.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ d: r.l.logDate, id: r.l.id }));
    const items = await this.serializeMany(db, ctx, result.items.map((r) => r.l));
    const nameById = new Map(result.items.map((r) => [r.l.id, r.projectName]));
    for (const i of items) i.projectName = nameById.get(i.id);
    return { items, nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.DailyLog> {
    ctx.require('daily_logs.read');
    const { db } = this.deps;
    const [row] = await db.select({ l: dailyLogs, projectName: projects.name }).from(dailyLogs).innerJoin(projects, eq(projects.id, dailyLogs.projectId)).where(and(eq(dailyLogs.id, id), eq(dailyLogs.organizationId, ctx.organizationId), isNull(dailyLogs.archivedAt))).limit(1);
    if (!row) throw AppError.notFound('Daily log');
    await ctx.requireProjectAccess(db, row.l.projectId, { allowArchived: true });
    if (ctx.membership.external && !row.l.clientVisible) throw AppError.notFound('Daily log');
    const [out] = await this.serializeMany(db, ctx, [row.l]);
    out!.projectName = row.projectName;
    return out!;
  }

  async create(ctx: RequestContext, projectId: string, input: any & { id?: string }): Promise<contracts.DailyLog> {
    ctx.require('daily_logs.write');
    const id = await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      if (input.id) {
        const [dup] = await tx.select({ id: dailyLogs.id }).from(dailyLogs).where(and(eq(dailyLogs.id, input.id), eq(dailyLogs.organizationId, ctx.organizationId))).limit(1);
        if (dup) return dup.id;
      }
      let weather = { ...emptyWeather(), ...(input.weather ?? {}) };
      if (!input.weather?.conditions) {
        const [p] = await tx.select({ address: projects.address }).from(projects).where(eq(projects.id, projectId)).limit(1);
        const addr = p?.address as { latitude?: number | null; longitude?: number | null };
        if (addr?.latitude != null && addr?.longitude != null) {
          const auto = await this.deps.providers.weather.forDate(addr.latitude, addr.longitude, input.logDate).catch(() => null);
          if (auto) weather = { ...auto, source: 'auto' as const };
        }
      }
      const [row] = await tx.insert(dailyLogs).values({ ...(input.id ? { id: input.id } : {}), organizationId: ctx.organizationId, projectId, logDate: input.logDate, weather, summary: input.summary, tags: input.tags, clientVisible: input.clientVisible, status: input.status, submittedAt: input.status === 'submitted' ? sql`now()` : null, searchText: searchText(input), createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.writeEntries(tx, ctx, row!.id, input.entries ?? []);
      await this.documents.attach(tx, ctx, 'daily_log', row!.id, input.photoDocumentIds ?? [], 'photo');
      await this.documents.attach(tx, ctx, 'daily_log', row!.id, input.attachmentDocumentIds ?? [], 'attachment');
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'posted', objectType: 'daily_log', objectId: row!.id, objectLabel: `for ${row!.logDate}`, clientVisible: row!.clientVisible, metadata: { photos: (input.photoDocumentIds ?? []).length } });
      if (input.status === 'submitted') {
        const managers = await tx.execute(sql`select pm.user_id from project_members pm where pm.project_id = ${projectId} and pm.user_id is not null and pm.access_level = 'manager'`);
        const [p] = await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1);
        await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: rowsOf<{ user_id: string }>(managers).map((m) => m.user_id), excludeUserId: ctx.userId, kind: 'daily_log.created', title: `Daily log posted for ${p!.name}`, body: `${ctx.actorName} posted the log for ${row!.logDate}.`, projectId, objectType: 'daily_log', objectId: row!.id, link: `/projects/${projectId}/daily-logs/${row!.id}` });
      }
      return row!.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, input: any): Promise<contracts.DailyLog> {
    ctx.require('daily_logs.write');
    await this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(dailyLogs).where(and(eq(dailyLogs.id, id), eq(dailyLogs.organizationId, ctx.organizationId), isNull(dailyLogs.archivedAt))).limit(1);
      if (!before) throw AppError.notFound('Daily log');
      await ctx.requireProjectAccess(tx, before.projectId);
      if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) throw AppError.versionConflict({ current: before });
      const { entries, photoDocumentIds, attachmentDocumentIds, expectedVersion: _v, ...rest } = input;
      const patch: Record<string, unknown> = { ...rest, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${dailyLogs.version} + 1` };
      if (rest.weather) patch.weather = { ...(before.weather as object), ...rest.weather };
      if (rest.status === 'submitted' && before.status !== 'submitted') patch.submittedAt = sql`now()`;
      patch.searchText = searchText({ ...before, ...rest, entries: entries ?? (await tx.select().from(dailyLogEntries).where(eq(dailyLogEntries.dailyLogId, id))) });
      const [after] = await tx.update(dailyLogs).set(patch as any).where(eq(dailyLogs.id, id)).returning();
      if (entries) { await tx.delete(dailyLogEntries).where(eq(dailyLogEntries.dailyLogId, id)); await this.writeEntries(tx, ctx, id, entries); }
      if (photoDocumentIds) { await this.documents.detachAll(tx, ctx, 'daily_log', id, 'photo'); await this.documents.attach(tx, ctx, 'daily_log', id, photoDocumentIds, 'photo'); }
      if (attachmentDocumentIds) { await this.documents.detachAll(tx, ctx, 'daily_log', id, 'attachment'); await this.documents.attach(tx, ctx, 'daily_log', id, attachmentDocumentIds, 'attachment'); }
      const diff = diffRecords(before as any, after as any);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: before.projectId, verb: 'updated', objectType: 'daily_log', objectId: id, objectLabel: `for ${after!.logDate}`, diff: diff ?? (entries ? { entries: { from: 'previous', to: `${entries.length} entries` } } : null), clientVisible: after!.clientVisible });
    });
    return this.get(ctx, id);
  }

  async archive(ctx: RequestContext, id: string) {
    ctx.require('daily_logs.write');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(dailyLogs).where(and(eq(dailyLogs.id, id), eq(dailyLogs.organizationId, ctx.organizationId))).limit(1);
      if (!row) throw AppError.notFound('Daily log');
      await ctx.requireProjectAccess(tx, row.projectId);
      if (!ctx.has('projects.write') && row.createdBy !== ctx.userId) throw AppError.forbidden('Only the author or a project manager can remove a daily log.');
      await tx.update(dailyLogs).set({ archivedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${dailyLogs.version} + 1` }).where(eq(dailyLogs.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'archived', objectType: 'daily_log', objectId: id, objectLabel: `for ${row.logDate}` });
    });
  }

  private async writeEntries(tx: DbOrTx, ctx: RequestContext, dailyLogId: string, entries: any[]) {
    if (!entries.length) return;
    await tx.insert(dailyLogEntries).values(entries.map((e, i) => ({ ...(e.id ? { id: e.id } : {}), organizationId: ctx.organizationId, dailyLogId, type: e.type, text: e.text ?? '', quantity: e.quantity != null ? String(e.quantity) : null, unit: e.unit ?? null, trade: e.trade ?? null, headcount: e.headcount ?? null, hours: e.hours != null ? String(e.hours) : null, delayCause: e.delayCause ?? null, delayHours: e.delayHours != null ? String(e.delayHours) : null, taskId: e.taskId ?? null, vendorId: e.vendorId ?? null, documentId: e.documentId ?? null, sortOrder: i, createdBy: ctx.userId, updatedBy: ctx.userId })));
  }

  private async serializeMany(db: DbOrTx, ctx: RequestContext, rows: Array<typeof dailyLogs.$inferSelect>): Promise<contracts.DailyLog[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const entries = await db.select().from(dailyLogEntries).where(inArray(dailyLogEntries.dailyLogId, ids)).orderBy(asc(dailyLogEntries.sortOrder));
    const attachmentsBy = await this.documents.attachmentsFor(db, ctx, 'daily_log', ids);
    const authorIds = [...new Set(rows.map((r) => r.createdBy).filter(Boolean))] as string[];
    const authors = authorIds.length ? await db.select().from(users).where(inArray(users.id, authorIds)) : [];
    const authorName = new Map(authors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
    return rows.map((l) => {
      const es = entries.filter((e) => e.dailyLogId === l.id).map((e): contracts.DailyLogEntry => ({ id: e.id, type: e.type as contracts.DailyLogEntry['type'], text: e.text, quantity: e.quantity != null ? Number(e.quantity) : null, unit: e.unit, trade: e.trade, headcount: e.headcount, hours: e.hours != null ? Number(e.hours) : null, delayCause: e.delayCause as contracts.DailyLogEntry['delayCause'], delayHours: e.delayHours != null ? Number(e.delayHours) : null, taskId: e.taskId, vendorId: e.vendorId, documentId: e.documentId, sortOrder: e.sortOrder }));
      const atts = attachmentsBy.get(l.id) ?? [];
      const photos = atts.filter((a) => a.role === 'photo').map((a) => a.document);
      return {
        id: l.id, organizationId: l.organizationId, createdAt: l.createdAt, updatedAt: l.updatedAt, createdBy: l.createdBy, updatedBy: l.updatedBy, version: l.version,
        projectId: l.projectId, logDate: l.logDate, authorName: (l.createdBy && authorName.get(l.createdBy)) || 'Unknown', weather: { ...emptyWeather(), ...(l.weather as object) }, summary: l.summary, tags: l.tags, clientVisible: l.clientVisible, status: l.status as contracts.DailyLog['status'], submittedAt: l.submittedAt,
        entries: es, photos, attachments: atts.filter((a) => a.role === 'attachment').map((a) => a.document),
        totals: { headcount: es.reduce((n, e) => n + (e.headcount ?? 0), 0), laborHours: es.reduce((n, e) => n + (e.hours ?? 0) * (e.headcount ?? 1), 0), delayHours: es.reduce((n, e) => n + (e.delayHours ?? 0), 0), photoCount: photos.length },
      };
    });
  }
}

function searchText(input: { summary?: string; tags?: string[]; entries?: Array<{ text?: string; trade?: string | null }> }): string {
  return [input.summary ?? '', ...(input.tags ?? []), ...(input.entries ?? []).map((e) => `${e.trade ?? ''} ${e.text ?? ''}`)].join(' ');
}
