import { and, asc, desc, eq, inArray, isNull, or, sql, ilike } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { rowsOf } from '../db/pglite-shared.js';
import type { DbOrTx } from '../db/client.js';
import { contacts, memberships, messageThreads, messages, projects, threadParticipants, users, vendors } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import type { DocumentService } from './document.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';

export class MessageService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService, private readonly documents: DocumentService) {}

  async listThreads(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; kind: string; unreadOnly: boolean; q?: string }) {
    ctx.require('messages.read');
    const { db } = this.deps;
    const conditions = [eq(messageThreads.organizationId, ctx.organizationId), isNull(messageThreads.archivedAt), sql`exists (select 1 from ${threadParticipants} tp where tp.thread_id = ${messageThreads.id} and tp.user_id = ${ctx.userId})`];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(messageThreads.projectId, query.projectId)); }
    if (query.kind !== 'all') conditions.push(eq(messageThreads.kind, query.kind));
    if (query.unreadOnly) conditions.push(sql`exists (select 1 from ${threadParticipants} tp where tp.thread_id = ${messageThreads.id} and tp.user_id = ${ctx.userId} and (tp.last_read_at is null or tp.last_read_at < ${messageThreads.lastMessageAt}))`);
    if (query.q) conditions.push(or(ilike(messageThreads.subject, `%${query.q}%`), ilike(messageThreads.lastMessagePreview, `%${query.q}%`))!);
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(coalesce(${messageThreads.lastMessageAt}, ${messageThreads.createdAt}), ${messageThreads.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await db.select().from(messageThreads).where(and(...conditions)).orderBy(desc(sql`coalesce(${messageThreads.lastMessageAt}, ${messageThreads.createdAt})`), desc(messageThreads.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.lastMessageAt ?? r.createdAt, id: r.id }));
    return { items: await this.serializeThreads(db, ctx, result.items), nextCursor: result.nextCursor };
  }

  async getThread(ctx: RequestContext, id: string): Promise<contracts.Thread> {
    ctx.require('messages.read');
    const row = await this.loadThread(ctx, id);
    const [t] = await this.serializeThreads(this.deps.db, ctx, [row]);
    return t!;
  }

  private async loadThread(ctx: RequestContext, id: string) {
    const [row] = await this.deps.db.select().from(messageThreads).where(and(eq(messageThreads.id, id), eq(messageThreads.organizationId, ctx.organizationId), isNull(messageThreads.archivedAt))).limit(1);
    if (!row) throw AppError.notFound('Thread');
    const [p] = await this.deps.db.select({ id: threadParticipants.id }).from(threadParticipants).where(and(eq(threadParticipants.threadId, id), eq(threadParticipants.userId, ctx.userId))).limit(1);
    if (!p) throw AppError.notFound('Thread');
    return row;
  }

  async createThread(ctx: RequestContext, input: any): Promise<contracts.Thread> {
    ctx.require('messages.write');
    const id = await this.deps.db.transaction(async (tx) => {
      if (input.clientMutationId) {
        const [dup] = await tx.select({ id: messageThreads.id }).from(messageThreads).where(and(eq(messageThreads.organizationId, ctx.organizationId), eq(messageThreads.clientMutationId, input.clientMutationId))).limit(1);
        if (dup) return dup.id;
      }
      if (input.projectId) await ctx.requireProjectAccess(tx, input.projectId);
      if (ctx.membership.external && !input.projectId) throw AppError.forbidden('External users can only message within a project.');
      const [thread] = await tx.insert(messageThreads).values({ organizationId: ctx.organizationId, projectId: input.projectId ?? null, kind: input.kind, subject: input.subject, objectType: input.objectType ?? null, objectId: input.objectId ?? null, clientVisible: input.clientVisible, vendorVisible: input.vendorVisible, clientMutationId: input.clientMutationId ?? null, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      const userIds = new Set<string>([ctx.userId, ...(input.participantUserIds ?? [])]);
      if (input.kind === 'project' && input.projectId && !(input.participantUserIds?.length)) {
        const members = await tx.execute(sql`select user_id from project_members where project_id = ${input.projectId} and user_id is not null`);
        for (const m of rowsOf<{ user_id: string }>(members)) userIds.add(m.user_id);
      }
      const validUsers = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, ctx.organizationId), inArray(memberships.userId, [...userIds]), eq(memberships.status, 'active')));
      const values: Array<typeof threadParticipants.$inferInsert> = validUsers.map((u) => ({ organizationId: ctx.organizationId, threadId: thread!.id, userId: u.userId, createdBy: ctx.userId, updatedBy: ctx.userId, lastReadAt: u.userId === ctx.userId ? sql`now()` as any : null }));
      if (input.participantContactIds?.length) {
        const cs = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.organizationId, ctx.organizationId), inArray(contacts.id, input.participantContactIds)));
        values.push(...cs.map((c) => ({ organizationId: ctx.organizationId, threadId: thread!.id, contactId: c.id, createdBy: ctx.userId, updatedBy: ctx.userId })));
      }
      if (input.participantVendorIds?.length) {
        const vs = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.organizationId, ctx.organizationId), inArray(vendors.id, input.participantVendorIds)));
        values.push(...vs.map((v) => ({ organizationId: ctx.organizationId, threadId: thread!.id, vendorId: v.id, createdBy: ctx.userId, updatedBy: ctx.userId })));
      }
      await tx.insert(threadParticipants).values(values).onConflictDoNothing();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: input.projectId ?? null, verb: 'started', objectType: 'thread', objectId: thread!.id, objectLabel: thread!.subject, clientVisible: thread!.clientVisible });
      if (input.initialMessage) await this.sendTx(tx, ctx, thread!, { body: input.initialMessage, mentions: [], attachmentDocumentIds: input.attachmentDocumentIds ?? [] });
      return thread!.id;
    });
    return this.getThread(ctx, id);
  }

  async listMessages(ctx: RequestContext, threadId: string, query: { cursor?: string; limit: number; before?: string }) {
    ctx.require('messages.read');
    await this.loadThread(ctx, threadId);
    const { db } = this.deps;
    const conditions = [eq(messages.threadId, threadId)];
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${messages.createdAt}, ${messages.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    if (query.before) conditions.push(sql`${messages.createdAt} < ${query.before}`);
    const rows = await db.select().from(messages).where(and(...conditions)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.createdAt, id: r.id }));
    const items = await this.serializeMessages(db, ctx, result.items);
    return { items: items.reverse(), nextCursor: result.nextCursor };
  }

  async send(ctx: RequestContext, threadId: string, input: { body: string; mentions: string[]; attachmentDocumentIds: string[]; clientMutationId?: string }): Promise<contracts.Message> {
    ctx.require('messages.write');
    const thread = await this.loadThread(ctx, threadId);
    const id = await this.deps.db.transaction(async (tx) => {
      if (input.clientMutationId) {
        const [dup] = await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.organizationId, ctx.organizationId), eq(messages.clientMutationId, input.clientMutationId))).limit(1);
        if (dup) return dup.id;
      }
      return (await this.sendTx(tx, ctx, thread, input)).id;
    });
    const [row] = await this.deps.db.select().from(messages).where(eq(messages.id, id)).limit(1);
    const [m] = await this.serializeMessages(this.deps.db, ctx, [row!]);
    return m!;
  }

  private async sendTx(tx: DbOrTx, ctx: RequestContext, thread: typeof messageThreads.$inferSelect, input: { body: string; mentions: string[]; attachmentDocumentIds: string[]; clientMutationId?: string }) {
    const [msg] = await tx.insert(messages).values({ organizationId: ctx.organizationId, threadId: thread.id, authorUserId: ctx.userId, authorKind: ctx.membership.external ? (ctx.membership.roleKey === 'vendor' ? 'vendor' : 'client') : 'user', body: input.body, mentions: input.mentions, clientMutationId: input.clientMutationId ?? null, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    await this.documents.attach(tx, ctx, 'message', msg!.id, input.attachmentDocumentIds, 'attachment');
    await tx.update(messageThreads).set({ lastMessageAt: msg!.createdAt, lastMessagePreview: input.body.slice(0, 140), messageCount: sql`${messageThreads.messageCount} + 1`, updatedAt: sql`now()`, version: sql`${messageThreads.version} + 1` }).where(eq(messageThreads.id, thread.id));
    await tx.update(threadParticipants).set({ lastReadAt: msg!.createdAt }).where(and(eq(threadParticipants.threadId, thread.id), eq(threadParticipants.userId, ctx.userId)));
    const participants = await tx.select({ userId: threadParticipants.userId, muted: threadParticipants.muted }).from(threadParticipants).where(and(eq(threadParticipants.threadId, thread.id), sql`${threadParticipants.userId} is not null`));
    const [p] = thread.projectId ? await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, thread.projectId)).limit(1) : [];
    const link = thread.projectId ? `/projects/${thread.projectId}/messages/${thread.id}` : `/messages/${thread.id}`;
    const mentioned = new Set(input.mentions);
    await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: participants.filter((x) => !x.muted && !mentioned.has(x.userId!)).map((x) => x.userId!), excludeUserId: ctx.userId, kind: 'message.new', title: `${ctx.actorName}${p ? ` · ${p.name}` : ''}: ${thread.subject}`, body: input.body.slice(0, 200), projectId: thread.projectId, objectType: 'thread', objectId: thread.id, link });
    if (mentioned.size) await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: [...mentioned], excludeUserId: ctx.userId, kind: 'mention', title: `${ctx.actorName} mentioned you in ${thread.subject}`, body: input.body.slice(0, 200), projectId: thread.projectId, objectType: 'thread', objectId: thread.id, link });
    await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: thread.projectId, verb: 'posted_in', objectType: 'message', objectId: msg!.id, objectLabel: thread.subject, clientVisible: thread.clientVisible, summary: `${ctx.actorName} posted in ${thread.subject}` });
    return msg!;
  }

  async markRead(ctx: RequestContext, threadId: string) {
    await this.loadThread(ctx, threadId);
    await this.deps.db.update(threadParticipants).set({ lastReadAt: sql`now()` }).where(and(eq(threadParticipants.threadId, threadId), eq(threadParticipants.userId, ctx.userId)));
  }

  async deleteMessage(ctx: RequestContext, threadId: string, messageId: string) {
    ctx.require('messages.write');
    await this.loadThread(ctx, threadId);
    await this.deps.db.transaction(async (tx) => {
      const [m] = await tx.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.threadId, threadId))).limit(1);
      if (!m) throw AppError.notFound('Message');
      if (m.authorUserId !== ctx.userId && !ctx.has('projects.write')) throw AppError.forbidden('You can only delete your own messages.');
      await tx.update(messages).set({ deletedAt: sql`now()`, body: '', updatedAt: sql`now()`, version: sql`${messages.version} + 1` }).where(eq(messages.id, messageId));
    });
  }

  private async serializeThreads(db: DbOrTx, ctx: RequestContext, rows: Array<typeof messageThreads.$inferSelect>): Promise<contracts.Thread[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const parts = await db.select({ p: threadParticipants, u: users, c: contacts, v: vendors }).from(threadParticipants).leftJoin(users, eq(users.id, threadParticipants.userId)).leftJoin(contacts, eq(contacts.id, threadParticipants.contactId)).leftJoin(vendors, eq(vendors.id, threadParticipants.vendorId)).where(inArray(threadParticipants.threadId, ids));
    const lastMsgs = await db.select().from(messages).where(and(inArray(messages.threadId, ids), sql`${messages.id} in (select id from ${messages} m2 where m2.thread_id = ${messages.threadId} order by m2.created_at desc limit 1)`));
    const lastSerialized = await this.serializeMessages(db, ctx, lastMsgs);
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter(Boolean))] as string[];
    const projs = projectIds.length ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, projectIds)) : [];
    const projName = new Map(projs.map((p) => [p.id, p.name]));
    return rows.map((t) => {
      const mine = parts.find((p) => p.p.threadId === t.id && p.p.userId === ctx.userId);
      const last = lastSerialized.find((m) => m.threadId === t.id) ?? null;
      const unreadCount = t.lastMessageAt && (!mine?.p.lastReadAt || mine.p.lastReadAt < t.lastMessageAt) ? 1 : 0;
      return {
        id: t.id, organizationId: t.organizationId, createdAt: t.createdAt, updatedAt: t.updatedAt, createdBy: t.createdBy, updatedBy: t.updatedBy, version: t.version,
        projectId: t.projectId, projectName: t.projectId ? projName.get(t.projectId) ?? null : null, kind: t.kind as contracts.Thread['kind'], subject: t.subject, objectType: t.objectType, objectId: t.objectId, objectLabel: null, clientVisible: t.clientVisible, vendorVisible: t.vendorVisible,
        participants: parts.filter((p) => p.p.threadId === t.id).map(({ p, u, c, v }) => ({ id: p.id, userId: p.userId, contactId: p.contactId, vendorId: p.vendorId, displayName: u ? `${u.firstName} ${u.lastName}` : c ? `${c.firstName} ${c.lastName}`.trim() : v?.name ?? 'Unknown', kind: u ? 'user' as const : c ? 'client_contact' as const : 'vendor' as const, lastReadAt: p.lastReadAt })),
        lastMessage: last, lastMessageAt: t.lastMessageAt, unreadCount, messageCount: t.messageCount, archivedAt: t.archivedAt,
      };
    });
  }

  private async serializeMessages(db: DbOrTx, ctx: RequestContext, rows: Array<typeof messages.$inferSelect>): Promise<contracts.Message[]> {
    if (!rows.length) return [];
    const authorIds = [...new Set(rows.map((r) => r.authorUserId).filter(Boolean))] as string[];
    const authors = authorIds.length ? await db.select().from(users).where(inArray(users.id, authorIds)) : [];
    const contactIds = [...new Set(rows.map((r) => r.authorContactId).filter(Boolean))] as string[];
    const cs = contactIds.length ? await db.select().from(contacts).where(inArray(contacts.id, contactIds)) : [];
    const attachmentsBy = await this.documents.attachmentsFor(db, ctx, 'message', rows.map((r) => r.id));
    return rows.map((m) => ({
      id: m.id, threadId: m.threadId, authorUserId: m.authorUserId, authorContactId: m.authorContactId,
      authorName: (() => { const u = authors.find((a) => a.id === m.authorUserId); if (u) return `${u.firstName} ${u.lastName}`; const c = cs.find((x) => x.id === m.authorContactId); return c ? `${c.firstName} ${c.lastName}`.trim() : m.authorKind === 'system' ? 'Buildline' : 'Unknown'; })(),
      authorKind: m.authorKind as contracts.Message['authorKind'], body: m.deletedAt ? '' : m.body, mentions: m.mentions, attachments: (attachmentsBy.get(m.id) ?? []).map((a) => a.document), createdAt: m.createdAt, editedAt: m.editedAt, deletedAt: m.deletedAt,
    }));
  }
}
