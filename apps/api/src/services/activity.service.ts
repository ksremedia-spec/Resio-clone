import { and, desc, eq, lt, sql, inArray } from 'drizzle-orm';
import { formatActivity, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { activityLog, projects } from '../db/schema/index.js';
import type { RequestContext } from '../lib/context.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';

export interface ActivityInput {
  projectId?: string | null;
  verb: string;
  objectType: contracts.ActivityObjectType;
  objectId?: string | null;
  objectLabel?: string;
  diff?: Record<string, { from: unknown; to: unknown }> | null;
  clientVisible?: boolean;
  metadata?: Record<string, unknown>;
  summary?: string;
}

export interface Actor {
  organizationId: string;
  userId: string | null;
  contactId?: string | null;
  name: string;
  kind: 'user' | 'client' | 'vendor' | 'system' | 'ai';
}

/** Computes a field-level diff between two plain objects (only changed keys). */
export function diffRecords(before: Record<string, unknown>, after: Record<string, unknown>, ignore: string[] = ['updatedAt', 'updatedBy', 'version', 'searchText', 'lastActivityAt']): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (ignore.includes(key)) continue;
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[key] = { from: a ?? null, to: b ?? null };
  }
  return Object.keys(diff).length ? diff : null;
}

export class ActivityService {
  constructor(private readonly deps: Deps) {}

  static actorFrom(ctx: RequestContext): Actor {
    return { organizationId: ctx.organizationId, userId: ctx.userId, name: ctx.actorName, kind: 'user' };
  }

  /** Write an immutable activity entry inside the caller's transaction. */
  async record(tx: DbOrTx, actor: Actor, input: ActivityInput) {
    const summary = input.summary ?? formatActivity({ actorName: actor.name, verb: input.verb, objectType: input.objectType, objectLabel: input.objectLabel ?? '', diff: input.diff ?? null });
    const [row] = await tx.insert(activityLog).values({
      organizationId: actor.organizationId,
      projectId: input.projectId ?? null,
      actorUserId: actor.userId,
      actorContactId: actor.contactId ?? null,
      actorName: actor.name,
      actorKind: actor.kind,
      verb: input.verb,
      objectType: input.objectType,
      objectId: input.objectId ?? null,
      objectLabel: input.objectLabel ?? '',
      summary,
      diff: input.diff ?? null,
      metadata: input.metadata ?? {},
      clientVisible: input.clientVisible ?? false,
    }).returning();
    if (input.projectId) {
      await tx.update(projects).set({ lastActivityAt: sql`now()` }).where(eq(projects.id, input.projectId));
    }
    return row!;
  }

  async list(ctx: RequestContext, query: contracts.PaginationQuery & { projectId?: string; objectType?: string; objectId?: string; actorUserId?: string; since?: string }) {
    ctx.require('activity.read');
    const { db } = this.deps;
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    const conditions = [eq(activityLog.organizationId, ctx.organizationId)];
    if (query.projectId) {
      await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true });
      conditions.push(eq(activityLog.projectId, query.projectId));
    } else {
      const visible = await ctx.visibleProjectIds(db);
      if (visible) conditions.push(visible.length ? sql`(${activityLog.projectId} IS NULL OR ${inArray(activityLog.projectId, visible)})` : sql`${activityLog.projectId} IS NULL`);
    }
    if (ctx.membership.external) conditions.push(eq(activityLog.clientVisible, true));
    if (query.objectType) conditions.push(eq(activityLog.objectType, query.objectType));
    if (query.objectId) conditions.push(eq(activityLog.objectId, query.objectId));
    if (query.actorUserId) conditions.push(eq(activityLog.actorUserId, query.actorUserId));
    if (query.since) conditions.push(sql`${activityLog.occurredAt} > ${query.since}`);
    if (cursor) conditions.push(sql`(${activityLog.occurredAt}, ${activityLog.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await db.select().from(activityLog).where(and(...conditions)).orderBy(desc(activityLog.occurredAt), desc(activityLog.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.occurredAt, id: r.id }));
    return { items: result.items.map(serializeActivity), nextCursor: result.nextCursor };
  }
}

export function serializeActivity(row: typeof activityLog.$inferSelect): contracts.ActivityEntry {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    actorKind: row.actorKind as contracts.ActivityEntry['actorKind'],
    verb: row.verb,
    objectType: row.objectType as contracts.ActivityObjectType,
    objectId: row.objectId,
    objectLabel: row.objectLabel,
    summary: row.summary,
    diff: (row.diff as contracts.ActivityEntry['diff']) ?? null,
    clientVisible: row.clientVisible,
    occurredAt: row.occurredAt,
  };
}

export { lt };
