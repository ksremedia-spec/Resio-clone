import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { one } from '../lib/rows.js';
import type { DbOrTx } from '../db/client.js';
import { attachments, documentVersions, documents, folders } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import { signDownload, verifyDownload } from '../providers/storage.js';

const KIND_BY_TYPE: Array<[RegExp, contracts.Document['kind']]> = [
  [/^image\/(heic|heif|jpeg|jpg|png|webp)$/i, 'photo'],
  [/^image\//i, 'image'],
  [/^application\/pdf$/i, 'pdf'],
  [/^video\//i, 'video'],
  [/^audio\//i, 'audio'],
  [/spreadsheet|excel|csv/i, 'spreadsheet'],
];

export function kindFor(contentType: string, name: string): contracts.Document['kind'] {
  for (const [re, kind] of KIND_BY_TYPE) if (re.test(contentType)) return kind;
  if (/\.(dwg|dxf|rvt)$/i.test(name)) return 'plan';
  return 'other';
}

export interface UploadInput {
  projectId?: string | null;
  folderId?: string | null;
  name?: string;
  description?: string;
  tags?: string[];
  clientVisible?: boolean;
  vendorVisible?: boolean;
  photo?: Partial<contracts.PhotoMetadata>;
  clientMutationId?: string;
  documentId?: string;
  versionNote?: string;
  kind?: contracts.Document['kind'];
}

export class DocumentService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService) {}

  // ---------- folders ----------

  async listFolders(ctx: RequestContext, query: { projectId?: string | null; parentId?: string | null }): Promise<contracts.Folder[]> {
    ctx.require('documents.read');
    const { db } = this.deps;
    const conditions = [eq(folders.organizationId, ctx.organizationId), isNull(folders.archivedAt)];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(folders.projectId, query.projectId)); }
    else if (query.projectId === null) conditions.push(isNull(folders.projectId));
    if (query.parentId) conditions.push(eq(folders.parentId, query.parentId));
    else if (query.parentId === null) conditions.push(isNull(folders.parentId));
    if (ctx.membership.external) conditions.push(ctx.membership.roleKey === 'vendor' ? eq(folders.vendorVisible, true) : eq(folders.clientVisible, true));
    const rows = await db.select({ f: folders, n: sql<number>`(select count(*) from documents d where d.folder_id = folders.id and d.archived_at is null)::int` }).from(folders).where(and(...conditions)).orderBy(asc(folders.kind), asc(folders.name));
    return rows.map((r) => serializeFolder(r.f, r.n));
  }

  async createFolder(ctx: RequestContext, input: { projectId?: string | null; parentId?: string | null; name: string; kind: contracts.Folder['kind']; clientVisible: boolean; vendorVisible: boolean }): Promise<contracts.Folder> {
    ctx.require('documents.write');
    return this.deps.db.transaction(async (tx) => {
      if (input.projectId) await ctx.requireProjectAccess(tx, input.projectId);
      if (input.parentId) {
        const [parent] = await tx.select().from(folders).where(and(eq(folders.id, input.parentId), eq(folders.organizationId, ctx.organizationId))).limit(1);
        if (!parent) throw AppError.notFound('Folder');
        if ((parent.projectId ?? null) !== (input.projectId ?? null)) throw AppError.validation('Parent folder belongs to a different project.');
      }
      const [row] = await tx.insert(folders).values({ organizationId: ctx.organizationId, projectId: input.projectId ?? null, parentId: input.parentId ?? null, name: input.name, kind: input.kind, clientVisible: input.clientVisible, vendorVisible: input.vendorVisible, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: input.projectId ?? null, verb: 'created', objectType: 'folder', objectId: row!.id, objectLabel: row!.name });
      return serializeFolder(row!, 0);
    });
  }

  async updateFolder(ctx: RequestContext, id: string, input: Record<string, unknown>): Promise<contracts.Folder> {
    ctx.require('documents.write');
    return this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(folders).where(and(eq(folders.id, id), eq(folders.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Folder');
      if (before.projectId) await ctx.requireProjectAccess(tx, before.projectId);
      if (input.parentId === id) throw AppError.validation('A folder cannot be its own parent.');
      const [after] = await tx.update(folders).set({ ...input, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${folders.version} + 1` } as any).where(eq(folders.id, id)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: before.projectId, verb: 'updated', objectType: 'folder', objectId: id, objectLabel: after!.name, diff });
      const { n } = one(await tx.select({ n: count() }).from(documents).where(and(eq(documents.folderId, id), isNull(documents.archivedAt))));
      return serializeFolder(after!, n);
    });
  }

  async archiveFolder(ctx: RequestContext, id: string) {
    ctx.require('documents.write');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.update(folders).set({ archivedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId }).where(and(eq(folders.id, id), eq(folders.organizationId, ctx.organizationId))).returning();
      if (!row) throw AppError.notFound('Folder');
      await tx.update(documents).set({ archivedAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(documents.folderId, id), isNull(documents.archivedAt)));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'archived', objectType: 'folder', objectId: id, objectLabel: row.name });
    });
  }

  /** Ensure the standard folders exist for a project (Photos, Plans, Contracts, ...). */
  async ensureProjectFolders(tx: DbOrTx, ctx: RequestContext, projectId: string) {
    const existing = await tx.select({ kind: folders.kind }).from(folders).where(and(eq(folders.projectId, projectId), isNull(folders.parentId), isNull(folders.archivedAt)));
    const have = new Set(existing.map((e) => e.kind));
    const wanted: Array<[contracts.Folder['kind'], string, boolean]> = [['photos', 'Photos', true], ['plans', 'Plans', true], ['contracts', 'Contracts', true], ['specifications', 'Specifications', true], ['invoices', 'Invoices', false], ['receipts', 'Receipts', false]];
    for (const [kind, name, clientVisible] of wanted) {
      if (!have.has(kind)) await tx.insert(folders).values({ organizationId: ctx.organizationId, projectId, name, kind, clientVisible, createdBy: ctx.userId, updatedBy: ctx.userId });
    }
  }

  // ---------- documents ----------

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; folderId?: string | null; kind?: string; q?: string; tag?: string; includeArchived: boolean; sort: string }) {
    ctx.require('documents.read');
    const { db } = this.deps;
    const conditions = [eq(documents.organizationId, ctx.organizationId)];
    if (!query.includeArchived) conditions.push(isNull(documents.archivedAt));
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(documents.projectId, query.projectId)); }
    else {
      const visible = await ctx.visibleProjectIds(db);
      if (visible) conditions.push(visible.length ? sql`(${documents.projectId} is null or ${inArray(documents.projectId, visible)})` : isNull(documents.projectId));
    }
    if (query.folderId) conditions.push(eq(documents.folderId, query.folderId));
    else if (query.folderId === null) conditions.push(isNull(documents.folderId));
    if (query.kind) conditions.push(eq(documents.kind, query.kind));
    if (query.tag) conditions.push(sql`${documents.tags} @> ${JSON.stringify([query.tag])}::jsonb`);
    if (query.q) conditions.push(sql`(${ilike(documents.name, `%${query.q}%`)} or to_tsvector('simple', ${documents.searchText}) @@ plainto_tsquery('simple', ${query.q}))`);
    if (ctx.membership.external) conditions.push(ctx.membership.roleKey === 'vendor' ? eq(documents.vendorVisible, true) : eq(documents.clientVisible, true));
    const [field, dir] = query.sort.split(':') as [string, 'asc' | 'desc'];
    const col = field === 'name' ? documents.name : field === 'updatedAt' ? documents.updatedAt : documents.createdAt;
    const cursor = decodeCursor<{ k: string; id: string }>(query.cursor);
    if (cursor) conditions.push(dir === 'asc' ? sql`(${col}, ${documents.id}) > (${cursor.k}, ${cursor.id}::uuid)` : sql`(${col}, ${documents.id}) < (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select().from(documents).where(and(...conditions)).orderBy(dir === 'asc' ? asc(col) : desc(col), dir === 'asc' ? asc(documents.id) : desc(documents.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: String((r as any)[field]), id: r.id }));
    return { items: result.items.map((r) => this.serialize(ctx, r)), nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.Document & { versions: unknown[] }> {
    ctx.require('documents.read');
    const row = await this.load(ctx, id);
    const versions = await this.deps.db.select().from(documentVersions).where(eq(documentVersions.documentId, id)).orderBy(desc(documentVersions.versionNumber));
    return { ...this.serialize(ctx, row), versions: versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, sizeBytes: v.sizeBytes, contentType: v.contentType, checksumSha256: v.checksumSha256, createdAt: v.createdAt, createdBy: v.createdBy, note: v.note })) };
  }

  private async load(ctx: RequestContext, id: string) {
    const [row] = await this.deps.db.select().from(documents).where(and(eq(documents.id, id), eq(documents.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Document');
    if (row.projectId) await ctx.requireProjectAccess(this.deps.db, row.projectId, { allowArchived: true });
    if (ctx.membership.external && !(ctx.membership.roleKey === 'vendor' ? row.vendorVisible : row.clientVisible)) throw AppError.notFound('Document');
    return row;
  }

  /**
   * Store a file and create a document (or a new version). The stream is
   * written to the storage provider first; the database row is created only
   * once the bytes are safely stored.
   */
  async upload(ctx: RequestContext, file: { stream: Readable | Buffer; filename: string; contentType: string }, input: UploadInput): Promise<contracts.Document> {
    ctx.require('documents.write');
    const { db, providers } = this.deps;
    if (input.projectId) await ctx.requireProjectAccess(db, input.projectId);
    if (input.clientMutationId) {
      const [dup] = await db.select().from(documents).where(and(eq(documents.organizationId, ctx.organizationId), eq(documents.clientMutationId, input.clientMutationId))).limit(1);
      if (dup) return this.serialize(ctx, dup);
    }
    let existing: typeof documents.$inferSelect | null = null;
    if (input.documentId) existing = await this.load(ctx, input.documentId);
    if (input.folderId) {
      const [folder] = await db.select().from(folders).where(and(eq(folders.id, input.folderId), eq(folders.organizationId, ctx.organizationId))).limit(1);
      if (!folder) throw AppError.notFound('Folder');
    }
    const versionId = randomUUID();
    const name = (input.name?.trim() || file.filename || 'untitled').slice(0, 255);
    const key = `org/${ctx.organizationId}/${input.projectId ?? 'company'}/${versionId}`;
    const stored = await providers.storage.put(key, file.stream, file.contentType);
    try {
      const row = await db.transaction(async (tx) => {
        let doc: typeof documents.$inferSelect;
        const kind = input.kind ?? kindFor(file.contentType, name);
        const photo = kind === 'photo' || input.photo ? { takenAt: null, latitude: null, longitude: null, width: null, height: null, device: null, orientation: null, ...(input.photo ?? {}) } : null;
        if (existing) {
          const [updated] = await tx.update(documents).set({ contentType: file.contentType, sizeBytes: stored.sizeBytes, versionCount: sql`${documents.versionCount} + 1`, currentVersionId: versionId, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${documents.version} + 1`, ...(input.description !== undefined ? { description: input.description } : {}) }).where(eq(documents.id, existing.id)).returning();
          doc = updated!;
        } else {
          const [created] = await tx.insert(documents).values({
            organizationId: ctx.organizationId, projectId: input.projectId ?? null, folderId: input.folderId ?? null, name, description: input.description ?? '', contentType: file.contentType, sizeBytes: stored.sizeBytes, kind,
            tags: input.tags ?? [], clientVisible: input.clientVisible ?? false, vendorVisible: input.vendorVisible ?? false, currentVersionId: versionId, versionCount: 1, photo, clientMutationId: input.clientMutationId ?? null,
            searchText: [name, input.description ?? '', ...(input.tags ?? [])].join(' '), createdBy: ctx.userId, updatedBy: ctx.userId,
          }).returning();
          doc = created!;
        }
        await tx.insert(documentVersions).values({ id: versionId, organizationId: ctx.organizationId, documentId: doc.id, versionNumber: doc.versionCount, storageKey: stored.key, storageProvider: providers.storage.name, sizeBytes: stored.sizeBytes, contentType: file.contentType, checksumSha256: stored.checksumSha256, note: input.versionNote ?? '', createdBy: ctx.userId });
        await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: doc.projectId, verb: existing ? 'uploaded_new_version_of' : 'uploaded', objectType: 'document', objectId: doc.id, objectLabel: doc.name, clientVisible: doc.clientVisible, metadata: { kind: doc.kind, sizeBytes: stored.sizeBytes } });
        return doc;
      });
      return this.serialize(ctx, row);
    } catch (err) {
      await providers.storage.delete(stored.key).catch(() => {});
      throw err;
    }
  }

  async update(ctx: RequestContext, id: string, input: Record<string, unknown>): Promise<contracts.Document> {
    ctx.require('documents.write');
    return this.deps.db.transaction(async (tx) => {
      const before = await this.load(ctx, id);
      if (input.folderId) {
        const [folder] = await tx.select().from(folders).where(and(eq(folders.id, input.folderId as string), eq(folders.organizationId, ctx.organizationId))).limit(1);
        if (!folder) throw AppError.notFound('Folder');
      }
      if ((input.clientVisible !== undefined || input.vendorVisible !== undefined) && !ctx.has('documents.share')) throw AppError.forbidden('Missing permission documents.share.');
      const merged = { ...before, ...input } as typeof before;
      const [after] = await tx.update(documents).set({ ...input, searchText: [merged.name, merged.description, ...(merged.tags ?? [])].join(' '), updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${documents.version} + 1` } as any).where(eq(documents.id, id)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: before.projectId, verb: diff.clientVisible ? 'shared' : 'updated', objectType: 'document', objectId: id, objectLabel: after!.name, diff });
      return this.serialize(ctx, after!);
    });
  }

  async archive(ctx: RequestContext, id: string, archived: boolean): Promise<contracts.Document> {
    ctx.require('documents.write');
    return this.deps.db.transaction(async (tx) => {
      const before = await this.load(ctx, id);
      const [after] = await tx.update(documents).set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${documents.version} + 1` }).where(eq(documents.id, id)).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: before.projectId, verb: archived ? 'archived' : 'restored', objectType: 'document', objectId: id, objectLabel: before.name });
      return this.serialize(ctx, after!);
    });
  }

  // ---------- download ----------

  signedUrl(ctx: { organizationId: string }, versionId: string, disposition: 'inline' | 'attachment' = 'inline', ttlMs = 15 * 60_000): string {
    const expiresAt = Date.now() + ttlMs;
    const sig = signDownload(this.deps.config.APP_SECRET, { versionId, orgId: ctx.organizationId, expiresAt, disposition });
    return `${this.deps.config.API_URL}/v1/files/${versionId}?org=${ctx.organizationId}&exp=${expiresAt}&d=${disposition}&sig=${sig}`;
  }

  /** Resolve a signed URL to a stream. No session is needed: the signature is the credential. */
  async openSigned(params: { versionId: string; orgId: string; expiresAt: number; disposition: string; signature: string }) {
    if (!verifyDownload(this.deps.config.APP_SECRET, params)) throw new AppError(403, 'token_invalid', 'This file link is invalid or has expired.');
    const [v] = await this.deps.db.select({ v: documentVersions, d: documents }).from(documentVersions).innerJoin(documents, eq(documents.id, documentVersions.documentId)).where(and(eq(documentVersions.id, params.versionId), eq(documentVersions.organizationId, params.orgId))).limit(1);
    if (!v) throw AppError.notFound('File');
    const stream = await this.deps.providers.storage.getStream(v.v.storageKey);
    return { stream, contentType: v.v.contentType, sizeBytes: v.v.sizeBytes, filename: v.d.name, disposition: params.disposition === 'attachment' ? 'attachment' : 'inline' };
  }

  // ---------- attachments ----------

  async attach(tx: DbOrTx, ctx: RequestContext, objectType: string, objectId: string, documentIds: string[], role = 'attachment') {
    if (!documentIds.length) return;
    const docs = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.organizationId, ctx.organizationId), inArray(documents.id, documentIds)));
    const valid = new Set(docs.map((d) => d.id));
    const values = documentIds.filter((id) => valid.has(id)).map((documentId, i) => ({ organizationId: ctx.organizationId, objectType, objectId, documentId, role, sortOrder: i, createdBy: ctx.userId, updatedBy: ctx.userId }));
    if (values.length) await tx.insert(attachments).values(values).onConflictDoNothing();
  }

  async detachAll(tx: DbOrTx, ctx: RequestContext, objectType: string, objectId: string, role?: string) {
    const conditions = [eq(attachments.organizationId, ctx.organizationId), eq(attachments.objectType, objectType), eq(attachments.objectId, objectId)];
    if (role) conditions.push(eq(attachments.role, role));
    await tx.delete(attachments).where(and(...conditions));
  }

  async attachmentsFor(db: DbOrTx, ctx: { organizationId: string }, objectType: string, objectIds: string[]): Promise<Map<string, Array<{ role: string; document: contracts.Document }>>> {
    const out = new Map<string, Array<{ role: string; document: contracts.Document }>>();
    if (!objectIds.length) return out;
    const rows = await db.select({ a: attachments, d: documents }).from(attachments).innerJoin(documents, eq(documents.id, attachments.documentId))
      .where(and(eq(attachments.organizationId, ctx.organizationId), eq(attachments.objectType, objectType), inArray(attachments.objectId, objectIds), isNull(documents.archivedAt))).orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
    for (const r of rows) {
      if (!out.has(r.a.objectId)) out.set(r.a.objectId, []);
      out.get(r.a.objectId)!.push({ role: r.a.role, document: this.serialize(ctx, r.d) });
    }
    return out;
  }

  serialize(ctx: { organizationId: string }, row: typeof documents.$inferSelect): contracts.Document {
    return {
      id: row.id, organizationId: row.organizationId, createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy, version: row.version,
      projectId: row.projectId, folderId: row.folderId, name: row.name, description: row.description, contentType: row.contentType, sizeBytes: row.sizeBytes, kind: row.kind as contracts.Document['kind'],
      tags: row.tags, clientVisible: row.clientVisible, vendorVisible: row.vendorVisible, currentVersionId: row.currentVersionId, versionCount: row.versionCount, photo: (row.photo as contracts.PhotoMetadata | null) ?? null, archivedAt: row.archivedAt,
      downloadUrl: row.currentVersionId ? this.signedUrl(ctx, row.currentVersionId) : undefined,
      thumbnailUrl: row.currentVersionId && (row.kind === 'photo' || row.kind === 'image') ? this.signedUrl(ctx, row.currentVersionId) : null,
    };
  }
}

export function serializeFolder(f: typeof folders.$inferSelect, documentCount: number): contracts.Folder {
  return { id: f.id, organizationId: f.organizationId, createdAt: f.createdAt, updatedAt: f.updatedAt, createdBy: f.createdBy, updatedBy: f.updatedBy, version: f.version, projectId: f.projectId, parentId: f.parentId, name: f.name, kind: f.kind as contracts.Folder['kind'], clientVisible: f.clientVisible, vendorVisible: f.vendorVisible, documentCount };
}
