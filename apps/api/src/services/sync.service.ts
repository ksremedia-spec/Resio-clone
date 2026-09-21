import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { clients, dailyLogs, documents, folders, messageThreads, messages, notifications, projectPhases, projects, syncMutations, tasks, threadParticipants, timeEntries } from '../db/schema/index.js';
import type { RequestContext } from '../lib/context.js';
import { AppError } from '../lib/errors.js';

type Mutation = contracts.SyncMutation;
type PulledRow = { id: string; version: number; updatedAt: string; deleted: boolean; data: Record<string, unknown> | null };
type Puller = (ctx: RequestContext, since: string | null, projectIds: string[] | null, limit: number) => Promise<PulledRow[]>;
type MutationResult = ReturnType<typeof contracts.syncMutationResult.parse>;

/** A handler applies one mutation and returns the resulting record (or null for deletes). */
export type MutationHandler = (ctx: RequestContext, mutation: Mutation) => Promise<{ version: number | null; data: Record<string, unknown> | null }>;

/**
 * Offline sync. Pull returns rows changed since a cursor for entities the
 * caller may read (each entity's list is scoped exactly like the REST route).
 * Push applies mutations through the normal services via registered handlers,
 * with an idempotency ledger so replays are safe.
 */
export class SyncService {
  private handlers = new Map<string, MutationHandler>();
  private pullers = new Map<contracts.SyncEntity, Puller>();

  constructor(private readonly deps: Deps) {
    this.registerPuller('project', async (ctx, since, projectIds, limit) => {
      if (!ctx.has('projects.read')) return [];
      const visible = await ctx.visibleProjectIds(deps.db);
      const cond = [eq(projects.organizationId, ctx.organizationId), since ? gt(projects.updatedAt, since) : sql`true`];
      if (visible) cond.push(visible.length ? inArray(projects.id, visible) : sql`false`);
      if (projectIds) cond.push(inArray(projects.id, projectIds));
      const rows = await deps.db.select().from(projects).where(and(...cond)).orderBy(asc(projects.updatedAt)).limit(limit);
      return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: !!r.archivedAt, data: r.archivedAt ? null : { ...r, searchText: undefined } }));
    });
    this.registerPuller('client', async (ctx, since, _p, limit) => {
      if (!ctx.has('clients.read')) return [];
      const rows = await deps.db.select().from(clients).where(and(eq(clients.organizationId, ctx.organizationId), since ? gt(clients.updatedAt, since) : sql`true`)).orderBy(asc(clients.updatedAt)).limit(limit);
      return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: !!r.archivedAt, data: r.archivedAt ? null : r }));
    });
    this.registerPuller('notification', async (ctx, since, _p, limit) => {
      const rows = await deps.db.select().from(notifications).where(and(eq(notifications.organizationId, ctx.organizationId), eq(notifications.userId, ctx.userId), since ? gt(notifications.updatedAt, since) : sql`true`)).orderBy(asc(notifications.updatedAt)).limit(limit);
      return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: false, data: r }));
    });
    const projectScoped = <T extends { id: string; version: number; updatedAt: string; archivedAt?: string | null; projectId: string | null }>(table: any, permission: any, transform?: (r: T) => Record<string, unknown>): Puller =>
      async (ctx, since, projectIds, limit) => {
        if (!ctx.has(permission)) return [];
        const visible = await ctx.visibleProjectIds(deps.db);
        const cond = [eq(table.organizationId, ctx.organizationId), since ? gt(table.updatedAt, since) : sql`true`];
        if (visible) cond.push(visible.length ? inArray(table.projectId, visible) : sql`false`);
        if (projectIds) cond.push(inArray(table.projectId, projectIds));
        const rows = (await deps.db.select().from(table).where(and(...cond)).orderBy(asc(table.updatedAt)).limit(limit)) as T[];
        return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: !!r.archivedAt, data: r.archivedAt ? null : (transform ? transform(r) : (r as Record<string, unknown>)) }));
      };
    this.registerPuller('task', projectScoped(tasks, 'tasks.read'));
    this.registerPuller('phase', projectScoped(projectPhases, 'schedule.read'));
    this.registerPuller('daily_log', projectScoped(dailyLogs, 'daily_logs.read', (r: any) => ({ ...r, searchText: undefined })));
    this.registerPuller('document', async (ctx, since, projectIds, limit) => {
      if (!ctx.has('documents.read')) return [];
      const visible = await ctx.visibleProjectIds(deps.db);
      const cond = [eq(documents.organizationId, ctx.organizationId), since ? gt(documents.updatedAt, since) : sql`true`];
      if (visible) cond.push(visible.length ? or(isNull(documents.projectId), inArray(documents.projectId, visible))! : isNull(documents.projectId));
      if (projectIds) cond.push(inArray(documents.projectId, projectIds));
      const rows = await deps.db.select().from(documents).where(and(...cond)).orderBy(asc(documents.updatedAt)).limit(limit);
      return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: !!r.archivedAt, data: r.archivedAt ? null : { ...r, searchText: undefined } }));
    });
    this.registerPuller('folder', async (ctx, since, projectIds, limit) => {
      if (!ctx.has('documents.read')) return [];
      const cond = [eq(folders.organizationId, ctx.organizationId), since ? gt(folders.updatedAt, since) : sql`true`];
      if (projectIds) cond.push(inArray(folders.projectId, projectIds));
      const rows = await deps.db.select().from(folders).where(and(...cond)).orderBy(asc(folders.updatedAt)).limit(limit);
      return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: !!r.archivedAt, data: r.archivedAt ? null : r }));
    });
    this.registerPuller('thread', async (ctx, since, projectIds, limit) => {
      if (!ctx.has('messages.read')) return [];
      const cond = [eq(messageThreads.organizationId, ctx.organizationId), since ? gt(messageThreads.updatedAt, since) : sql`true`, sql`exists (select 1 from ${threadParticipants} where ${threadParticipants.threadId} = ${messageThreads.id} and ${threadParticipants.userId} = ${ctx.userId})`];
      if (projectIds) cond.push(inArray(messageThreads.projectId, projectIds));
      const rows = await deps.db.select().from(messageThreads).where(and(...cond)).orderBy(asc(messageThreads.updatedAt)).limit(limit);
      return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: !!r.archivedAt, data: r.archivedAt ? null : r }));
    });
    this.registerPuller('message', async (ctx, since, projectIds, limit) => {
      if (!ctx.has('messages.read')) return [];
      const cond = [eq(messages.organizationId, ctx.organizationId), since ? gt(messages.updatedAt, since) : sql`true`, sql`exists (select 1 from ${threadParticipants} where ${threadParticipants.threadId} = ${messages.threadId} and ${threadParticipants.userId} = ${ctx.userId})`];
      if (projectIds) cond.push(sql`${messages.threadId} in (select id from ${messageThreads} where ${inArray(messageThreads.projectId, projectIds)})`);
      const rows = await deps.db.select().from(messages).where(and(...cond)).orderBy(asc(messages.updatedAt)).limit(limit);
      return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: !!r.deletedAt, data: r.deletedAt ? null : r }));
    });
    this.registerPuller('time_entry', async (ctx, since, _p, limit) => {
      if (!ctx.has('time.clock')) return [];
      const cond = [eq(timeEntries.organizationId, ctx.organizationId), since ? gt(timeEntries.updatedAt, since) : sql`true`];
      if (!ctx.has('time.manage')) cond.push(eq(timeEntries.userId, ctx.userId));
      const rows = await deps.db.select().from(timeEntries).where(and(...cond)).orderBy(asc(timeEntries.updatedAt)).limit(limit);
      return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: !!r.archivedAt, data: r.archivedAt ? null : r }));
    });
  }

  registerPuller(entity: contracts.SyncEntity, fn: Puller) { this.pullers.set(entity, fn); }
  registerHandler(entity: contracts.SyncEntity, operation: Mutation['operation'], handler: MutationHandler) { this.handlers.set(`${entity}:${operation}`, handler); }

  async pull(ctx: RequestContext, query: { since?: string; entities?: string; projectIds?: string; limit: number }) {
    const entities = (query.entities ? query.entities.split(',') : [...contracts.SYNC_ENTITIES]).filter((e): e is contracts.SyncEntity => (contracts.SYNC_ENTITIES as readonly string[]).includes(e));
    const projectIds = query.projectIds ? query.projectIds.split(',').filter(Boolean) : null;
    const since = query.since ?? null;
    const changes: Array<ReturnType<typeof contracts.syncChange.parse>> = [];
    let hasMore = false;
    let cursor = since ?? '1970-01-01T00:00:00.000Z';
    const perEntity = Math.max(20, Math.floor(query.limit / entities.length));
    for (const entity of entities) {
      const puller = this.pullers.get(entity);
      if (!puller) continue;
      const rows = await puller(ctx, since, projectIds, perEntity + 1);
      if (rows.length > perEntity) { hasMore = true; rows.length = perEntity; }
      for (const r of rows) {
        changes.push({ entity, id: r.id, version: r.version, updatedAt: r.updatedAt, deleted: r.deleted, data: r.data });
        if (r.updatedAt > cursor) cursor = r.updatedAt;
      }
    }
    // Cursor advances only to the latest change seen; when hasMore the client calls again with this cursor.
    if (!hasMore) cursor = new Date().toISOString();
    return { changes, cursor, hasMore };
  }

  async push(ctx: RequestContext, mutations: Mutation[]): Promise<MutationResult[]> {
    const results: MutationResult[] = [];
    for (const m of mutations) {
      const [seen] = await this.deps.db.select().from(syncMutations).where(and(eq(syncMutations.organizationId, ctx.organizationId), eq(syncMutations.userId, ctx.userId), eq(syncMutations.clientMutationId, m.clientMutationId))).limit(1);
      if (seen) { results.push({ ...(seen.result as MutationResult), status: 'duplicate' }); continue; }
      const handler = this.handlers.get(`${m.entity}:${m.operation}`);
      let result: MutationResult;
      if (!handler) {
        result = { clientMutationId: m.clientMutationId, status: 'rejected', entity: m.entity, id: m.id, version: null, data: null, error: { code: 'unsupported', message: `Offline ${m.operation} of ${m.entity} is not supported.` }, serverData: null };
      } else {
        try {
          const out = await handler(ctx, m);
          result = { clientMutationId: m.clientMutationId, status: 'applied', entity: m.entity, id: m.id, version: out.version, data: out.data, error: null, serverData: null };
        } catch (err) {
          if (err instanceof AppError && err.code === 'version_conflict') {
            const details = (err.details ?? {}) as { current?: Record<string, unknown> };
            result = { clientMutationId: m.clientMutationId, status: 'conflict', entity: m.entity, id: m.id, version: null, data: null, error: { code: err.code, message: err.message }, serverData: details.current ?? null };
          } else if (err instanceof AppError) {
            result = { clientMutationId: m.clientMutationId, status: 'rejected', entity: m.entity, id: m.id, version: null, data: null, error: { code: err.code, message: err.message }, serverData: null };
          } else {
            this.deps.log.error({ err, mutation: m.clientMutationId }, 'sync mutation failed');
            result = { clientMutationId: m.clientMutationId, status: 'rejected', entity: m.entity, id: m.id, version: null, data: null, error: { code: 'internal', message: 'The change could not be applied. It has been kept on your device.' }, serverData: null };
          }
        }
      }
      // Only successful applications and explicit rejections are recorded; conflicts may be retried after merge.
      if (result.status !== 'conflict') await this.deps.db.insert(syncMutations).values({ organizationId: ctx.organizationId, userId: ctx.userId, clientMutationId: m.clientMutationId, entity: m.entity, operation: m.operation, entityId: m.id, status: result.status, result }).onConflictDoNothing();
      results.push(result);
    }
    return results;
  }
}
