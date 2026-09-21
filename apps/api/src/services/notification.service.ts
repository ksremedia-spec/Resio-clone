import { and, desc, eq, inArray, isNull, sql, count } from 'drizzle-orm';
import { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { memberships, notificationDeliveries, notificationPreferences, notifications, pushTokens, users } from '../db/schema/index.js';
import type { RequestContext } from '../lib/context.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  kind: contracts.NotificationKind;
  title: string;
  body?: string;
  projectId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  link?: string | null;
  /** Never notify the actor about their own action. */
  excludeUserId?: string | null;
}

const DEFAULT_CHANNELS: Record<string, string[]> = {
  'message.new': ['in_app', 'push'],
  mention: ['in_app', 'push', 'email'],
  'task.assigned': ['in_app', 'push'],
  'task.overdue': ['in_app'],
  'task.due_soon': ['in_app'],
  'approval.requested': ['in_app', 'push', 'email'],
  'approval.decided': ['in_app', 'push', 'email'],
  'change_order.approved': ['in_app', 'push', 'email'],
  'change_order.declined': ['in_app', 'push', 'email'],
  'invoice.paid': ['in_app', 'email'],
  'invoice.overdue': ['in_app', 'email'],
  'schedule.changed': ['in_app'],
  'bid_request.new': ['in_app', 'email'],
  'daily_log.created': ['in_app'],
  'document.shared': ['in_app'],
  'member.joined': ['in_app'],
  'time.approved': ['in_app'],
  system: ['in_app'],
};

export class NotificationService {
  constructor(private readonly deps: Deps) {}

  /**
   * Create in-app notifications inside the caller's transaction and queue
   * deliveries on other channels according to each user's preferences.
   * Delivery happens after the transaction commits (best effort, logged).
   */
  async notify(tx: DbOrTx, input: NotifyInput): Promise<string[]> {
    const targets = [...new Set(input.userIds)].filter((id) => id !== input.excludeUserId);
    if (targets.length === 0) return [];
    const active = await tx.select({ userId: memberships.userId }).from(memberships)
      .where(and(eq(memberships.organizationId, input.organizationId), inArray(memberships.userId, targets), eq(memberships.status, 'active')));
    const activeIds = active.map((r) => r.userId);
    if (activeIds.length === 0) return [];
    const rows = await tx.insert(notifications).values(activeIds.map((userId) => ({
      organizationId: input.organizationId,
      userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? '',
      projectId: input.projectId ?? null,
      objectType: input.objectType ?? null,
      objectId: input.objectId ?? null,
      link: input.link ?? null,
    }))).returning({ id: notifications.id, userId: notifications.userId });

    const prefs = await tx.select().from(notificationPreferences)
      .where(and(eq(notificationPreferences.organizationId, input.organizationId), inArray(notificationPreferences.userId, activeIds), eq(notificationPreferences.kind, input.kind)));
    const prefByUser = new Map(prefs.map((p) => [p.userId, p.channels]));
    const deliveries: Array<typeof notificationDeliveries.$inferInsert> = [];
    for (const row of rows) {
      const channels = prefByUser.get(row.userId) ?? DEFAULT_CHANNELS[input.kind] ?? ['in_app'];
      for (const channel of channels) {
        if (channel === 'in_app') continue;
        deliveries.push({ notificationId: row.id, channel, status: 'queued' });
      }
    }
    if (deliveries.length) {
      const inserted = await tx.insert(notificationDeliveries).values(deliveries).returning({ id: notificationDeliveries.id });
      // Deliver after commit: schedule on next tick; failures are recorded, never thrown to the caller.
      setTimeout(() => { void this.deliver(inserted.map((d) => d.id)); }, 0);
    }
    return rows.map((r) => r.id);
  }

  private async deliver(deliveryIds: string[]) {
    const { db, providers, log } = this.deps;
    for (const id of deliveryIds) {
      try {
        const [d] = await db.select({ delivery: notificationDeliveries, notification: notifications, user: users }).from(notificationDeliveries)
          .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
          .innerJoin(users, eq(users.id, notifications.userId))
          .where(eq(notificationDeliveries.id, id)).limit(1);
        if (!d || d.delivery.status !== 'queued') continue;
        let providerMessageId: string | null = null;
        if (d.delivery.channel === 'email') {
          const res = await providers.email.send({ to: d.user.email, subject: d.notification.title, text: `${d.notification.body}\n\n${d.notification.link ? `${this.deps.config.APP_URL}${d.notification.link}` : ''}`.trim(), template: d.notification.kind });
          providerMessageId = res.id;
        } else if (d.delivery.channel === 'push') {
          const tokens = await db.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, d.user.id));
          if (tokens.length) await providers.push.send(tokens.map((t) => t.token), { title: d.notification.title, body: d.notification.body, data: d.notification.link ? { link: d.notification.link } : undefined });
        } else if (d.delivery.channel === 'sms') {
          if (d.user.phone) await providers.sms.send(d.user.phone, `${d.notification.title}: ${d.notification.body}`);
        }
        await db.update(notificationDeliveries).set({ status: 'sent', provider: d.delivery.channel === 'email' ? providers.email.name : d.delivery.channel, providerMessageId, sentAt: sql`now()`, attempts: sql`${notificationDeliveries.attempts} + 1` }).where(eq(notificationDeliveries.id, id));
      } catch (err) {
        log.warn({ err, deliveryId: id }, 'notification delivery failed');
        await db.update(notificationDeliveries).set({ status: 'failed', error: String((err as Error).message ?? err), attempts: sql`${notificationDeliveries.attempts} + 1` }).where(eq(notificationDeliveries.id, id)).catch(() => {});
      }
    }
  }

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; unreadOnly: boolean }) {
    const { db } = this.deps;
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    const conditions = [eq(notifications.organizationId, ctx.organizationId), eq(notifications.userId, ctx.userId)];
    if (query.unreadOnly) conditions.push(isNull(notifications.readAt));
    if (cursor) conditions.push(sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await db.select().from(notifications).where(and(...conditions)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.createdAt, id: r.id }));
    return { items: result.items.map(serializeNotification), nextCursor: result.nextCursor };
  }

  async unreadCount(ctx: RequestContext): Promise<number> {
    const [row] = await this.deps.db.select({ n: count() }).from(notifications).where(and(eq(notifications.organizationId, ctx.organizationId), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  }

  async markRead(ctx: RequestContext, id: string | 'all') {
    const { db } = this.deps;
    const conditions = [eq(notifications.organizationId, ctx.organizationId), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)];
    if (id !== 'all') conditions.push(eq(notifications.id, id));
    await db.update(notifications).set({ readAt: sql`now()`, updatedAt: sql`now()`, version: sql`${notifications.version} + 1` }).where(and(...conditions));
  }

  async getPreferences(ctx: RequestContext): Promise<contracts.NotificationPreferences> {
    const rows = await this.deps.db.select().from(notificationPreferences).where(and(eq(notificationPreferences.organizationId, ctx.organizationId), eq(notificationPreferences.userId, ctx.userId)));
    const byKind = new Map(rows.map((r) => [r.kind, r.channels]));
    return { preferences: contracts.NOTIFICATION_KINDS.map((kind) => ({ kind, channels: (byKind.get(kind) ?? DEFAULT_CHANNELS[kind] ?? ['in_app']) as contracts.NotificationPreferences['preferences'][number]['channels'] })) };
  }

  async setPreferences(ctx: RequestContext, input: contracts.NotificationPreferences): Promise<contracts.NotificationPreferences> {
    const { db } = this.deps;
    await db.transaction(async (tx) => {
      for (const pref of input.preferences) {
        await tx.insert(notificationPreferences).values({ organizationId: ctx.organizationId, userId: ctx.userId, kind: pref.kind, channels: pref.channels })
          .onConflictDoUpdate({ target: [notificationPreferences.organizationId, notificationPreferences.userId, notificationPreferences.kind], set: { channels: pref.channels, updatedAt: sql`now()` } });
      }
    });
    return this.getPreferences(ctx);
  }

  async registerPushToken(ctx: RequestContext, input: { platform: string; token: string }) {
    await this.deps.db.insert(pushTokens).values({ userId: ctx.userId, platform: input.platform, token: input.token })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId: ctx.userId, platform: input.platform, lastUsedAt: sql`now()` } });
  }
}

export function serializeNotification(row: typeof notifications.$inferSelect): contracts.Notification {
  return { id: row.id, kind: row.kind as contracts.NotificationKind, title: row.title, body: row.body, projectId: row.projectId, objectType: row.objectType, objectId: row.objectId, link: row.link, readAt: row.readAt, createdAt: row.createdAt };
}
