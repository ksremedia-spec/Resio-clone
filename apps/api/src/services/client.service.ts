import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { one } from '../lib/rows.js';
import { clients, contacts, projects } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';

const emptyAddress = (): contracts.Address => ({ line1: '', line2: '', city: '', region: '', postalCode: '', country: 'US', latitude: null, longitude: null });

export class ClientService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService) {}

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; q?: string; status: 'active' | 'archived' | 'all'; sort: string }) {
    ctx.require('clients.read');
    const { db } = this.deps;
    const conditions = [eq(clients.organizationId, ctx.organizationId)];
    if (query.status === 'active') conditions.push(isNull(clients.archivedAt));
    if (query.status === 'archived') conditions.push(sql`${clients.archivedAt} IS NOT NULL`);
    if (query.q) conditions.push(or(ilike(clients.displayName, `%${query.q}%`), ilike(clients.companyName, `%${query.q}%`), ilike(clients.email, `%${query.q}%`))!);
    const cursor = decodeCursor<{ k: string; id: string }>(query.cursor);
    const [field, dir] = query.sort.split(':') as ['displayName' | 'updatedAt' | 'createdAt', 'asc' | 'desc'];
    const col = field === 'displayName' ? clients.displayName : field === 'createdAt' ? clients.createdAt : clients.updatedAt;
    if (cursor) conditions.push(dir === 'asc' ? sql`(${col}, ${clients.id}) > (${cursor.k}, ${cursor.id}::uuid)` : sql`(${col}, ${clients.id}) < (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select({ c: clients, projectCount: sql<number>`(select count(*) from projects p where p.client_id = clients.id and p.archived_at is null)::int` })
      .from(clients).where(and(...conditions)).orderBy(dir === 'asc' ? asc(col) : desc(col), dir === 'asc' ? asc(clients.id) : desc(clients.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: String((r.c as any)[field]), id: r.c.id }));
    return { items: result.items.map((r) => serializeClient(r.c, { projectCount: r.projectCount })), nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.Client> {
    ctx.require('clients.read');
    const { db } = this.deps;
    const [row] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Client');
    const contactRows = await db.select().from(contacts).where(eq(contacts.clientId, id)).orderBy(desc(contacts.isPrimary), asc(contacts.firstName));
    const { n } = one(await db.select({ n: count() }).from(projects).where(and(eq(projects.clientId, id), isNull(projects.archivedAt))));
    return serializeClient(row, { projectCount: n, contacts: contactRows.map(serializeContact) });
  }

  async create(ctx: RequestContext, input: { displayName: string; companyName?: string | null; email?: string | null; phone?: string | null; billingAddress?: Partial<contracts.Address>; notes: string; contacts?: Array<{ firstName: string; lastName: string; email?: string | null; phone?: string | null; title?: string | null; isPrimary: boolean; notes: string }> }): Promise<contracts.Client> {
    ctx.require('clients.write');
    return this.deps.db.transaction(async (tx) => {
      const [row] = await tx.insert(clients).values({ organizationId: ctx.organizationId, displayName: input.displayName, companyName: input.companyName ?? null, email: input.email ?? null, phone: input.phone ?? null, billingAddress: { ...emptyAddress(), ...(input.billingAddress ?? {}) }, notes: input.notes, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      const contactRows = input.contacts?.length
        ? await tx.insert(contacts).values(input.contacts.map((c) => ({ organizationId: ctx.organizationId, clientId: row!.id, firstName: c.firstName, lastName: c.lastName, email: c.email ?? null, phone: c.phone ?? null, title: c.title ?? null, isPrimary: c.isPrimary, notes: c.notes, createdBy: ctx.userId, updatedBy: ctx.userId }))).returning()
        : [];
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'created', objectType: 'client', objectId: row!.id, objectLabel: row!.displayName });
      return serializeClient(row!, { projectCount: 0, contacts: contactRows.map(serializeContact) });
    });
  }

  async update(ctx: RequestContext, id: string, input: Record<string, unknown>): Promise<contracts.Client> {
    ctx.require('clients.write');
    await this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(clients).where(and(eq(clients.id, id), eq(clients.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Client');
      const patch: Record<string, unknown> = { ...input, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${clients.version} + 1` };
      if (input.billingAddress) patch.billingAddress = { ...(before.billingAddress as object), ...(input.billingAddress as object) };
      const [after] = await tx.update(clients).set(patch as any).where(eq(clients.id, id)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'updated', objectType: 'client', objectId: id, objectLabel: after!.displayName, diff });
    });
    return this.get(ctx, id);
  }

  async archive(ctx: RequestContext, id: string, archived: boolean): Promise<contracts.Client> {
    ctx.require('clients.write');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.update(clients).set({ archivedAt: archived ? sql`now()` : null, status: archived ? 'archived' : 'active', updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${clients.version} + 1` }).where(and(eq(clients.id, id), eq(clients.organizationId, ctx.organizationId))).returning();
      if (!row) throw AppError.notFound('Client');
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: archived ? 'archived' : 'restored', objectType: 'client', objectId: id, objectLabel: row.displayName });
    });
    return this.get(ctx, id);
  }

  async addContact(ctx: RequestContext, clientId: string, input: { firstName: string; lastName: string; email?: string | null; phone?: string | null; title?: string | null; isPrimary: boolean; notes: string }): Promise<contracts.Contact> {
    ctx.require('clients.write');
    return this.deps.db.transaction(async (tx) => {
      const [client] = await tx.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.organizationId, ctx.organizationId))).limit(1);
      if (!client) throw AppError.notFound('Client');
      if (input.isPrimary) await tx.update(contacts).set({ isPrimary: false }).where(eq(contacts.clientId, clientId));
      const [row] = await tx.insert(contacts).values({ organizationId: ctx.organizationId, clientId, firstName: input.firstName, lastName: input.lastName, email: input.email ?? null, phone: input.phone ?? null, title: input.title ?? null, isPrimary: input.isPrimary, notes: input.notes, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'added', objectType: 'contact', objectId: row!.id, objectLabel: `${row!.firstName} ${row!.lastName} to ${client.displayName}` });
      return serializeContact(row!);
    });
  }

  async updateContact(ctx: RequestContext, clientId: string, contactId: string, input: Record<string, unknown>): Promise<contracts.Contact> {
    ctx.require('clients.write');
    return this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.clientId, clientId), eq(contacts.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Contact');
      if (input.isPrimary === true) await tx.update(contacts).set({ isPrimary: false }).where(eq(contacts.clientId, clientId));
      const [after] = await tx.update(contacts).set({ ...input, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${contacts.version} + 1` } as any).where(eq(contacts.id, contactId)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'updated', objectType: 'contact', objectId: contactId, objectLabel: `${after!.firstName} ${after!.lastName}`, diff });
      return serializeContact(after!);
    });
  }

  async deleteContact(ctx: RequestContext, clientId: string, contactId: string) {
    ctx.require('clients.write');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.delete(contacts).where(and(eq(contacts.id, contactId), eq(contacts.clientId, clientId), eq(contacts.organizationId, ctx.organizationId))).returning();
      if (!row) throw AppError.notFound('Contact');
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'removed', objectType: 'contact', objectId: contactId, objectLabel: `${row.firstName} ${row.lastName}` });
    });
  }

  async namesByIds(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.deps.db.select({ id: clients.id, name: clients.displayName }).from(clients).where(inArray(clients.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

export function serializeClient(row: typeof clients.$inferSelect, extra: { projectCount?: number; contacts?: contracts.Contact[] } = {}): contracts.Client {
  return {
    id: row.id, organizationId: row.organizationId, createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy, version: row.version,
    displayName: row.displayName, companyName: row.companyName, email: row.email, phone: row.phone,
    billingAddress: { ...emptyAddress(), ...(row.billingAddress as object) }, notes: row.notes, status: row.status as contracts.Client['status'], archivedAt: row.archivedAt,
    projectCount: extra.projectCount, contacts: extra.contacts,
  };
}

export function serializeContact(row: typeof contacts.$inferSelect): contracts.Contact {
  return { id: row.id, organizationId: row.organizationId, createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy, version: row.version, clientId: row.clientId, vendorId: row.vendorId, firstName: row.firstName, lastName: row.lastName, email: row.email, phone: row.phone, title: row.title, isPrimary: row.isPrimary, notes: row.notes, portalUserId: row.portalUserId };
}
