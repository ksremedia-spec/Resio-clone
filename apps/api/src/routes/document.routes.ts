import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';
import { AppError } from '../lib/errors.js';

const ok = z.object({ ok: z.literal(true) });
const tags = ['Documents'];

export async function documentRoutes(app: AppInstance, s: Services) {
  app.get('/folders', { schema: { tags, querystring: z.object({ projectId: z.uuid().optional(), parentId: z.uuid().optional(), root: z.coerce.boolean().optional(), company: z.coerce.boolean().optional() }), response: { 200: z.array(contracts.folderSchema) } } }, async (req) =>
    s.documents.listFolders(req.requireCtx(), { projectId: req.query.company ? null : req.query.projectId, parentId: req.query.root ? null : req.query.parentId }));
  app.post('/folders', { schema: { tags, body: contracts.createFolderBody, response: { 201: contracts.folderSchema } } }, async (req, reply) => reply.status(201).send(await s.documents.createFolder(req.requireCtx(), req.body)));
  app.patch('/folders/:id', { schema: { tags, params: contracts.idParams, body: contracts.updateFolderBody, response: { 200: contracts.folderSchema } } }, async (req) => s.documents.updateFolder(req.requireCtx(), req.params.id, req.body));
  app.delete('/folders/:id', { schema: { tags, params: contracts.idParams, response: { 200: ok } } }, async (req) => { await s.documents.archiveFolder(req.requireCtx(), req.params.id); return { ok: true as const }; });

  app.get('/documents', { schema: { tags, querystring: contracts.listDocumentsQuery, response: { 200: contracts.paginated(contracts.documentSchema) } } }, async (req) => s.documents.list(req.requireCtx(), req.query));
  app.get('/documents/:id', { schema: { tags, params: contracts.idParams, response: { 200: contracts.documentDetail } } }, async (req) => s.documents.get(req.requireCtx(), req.params.id) as any);
  app.patch('/documents/:id', { schema: { tags, params: contracts.idParams, body: contracts.updateDocumentBody, response: { 200: contracts.documentSchema } } }, async (req) => s.documents.update(req.requireCtx(), req.params.id, req.body));
  app.post('/documents/:id/archive', { schema: { tags, params: contracts.idParams, body: z.object({ archived: z.boolean().default(true) }).nullish(), response: { 200: contracts.documentSchema } } }, async (req) => s.documents.archive(req.requireCtx(), req.params.id, req.body?.archived ?? true));

  /**
   * Multipart upload: one `file` part plus an optional `meta` JSON part
   * (fields of uploadDocumentFields). Streams straight to storage.
   */
  app.post('/documents/upload', { schema: { tags, consumes: ['multipart/form-data'], response: { 201: contracts.documentSchema } } }, async (req, reply) => {
    const ctx = req.requireCtx();
    let meta: Record<string, unknown> = {};
    let result: contracts.Document | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'field' && part.fieldname === 'meta') {
        try { meta = JSON.parse(String(part.value)); } catch { throw AppError.validation('meta must be valid JSON'); }
      } else if (part.type === 'file') {
        const parsed = contracts.uploadDocumentFields.safeParse(meta);
        if (!parsed.success) throw AppError.validation('Invalid upload metadata', parsed.error.issues);
        result = await s.documents.upload(ctx, { stream: part.file, filename: part.filename, contentType: part.mimetype || 'application/octet-stream' }, parsed.data);
      }
    }
    if (!result) throw AppError.validation('No file was uploaded.');
    return reply.status(201).send(result);
  });

  /** Signed download URL target; the signature is the credential (works from <img> tags and Quick Look). */
  app.get('/files/:versionId', { schema: { tags, security: [], hide: true, params: z.object({ versionId: z.uuid() }), querystring: z.object({ org: z.uuid(), exp: z.coerce.number(), d: z.string().default('inline'), sig: z.string() }) } }, async (req, reply) => {
    const file = await s.documents.openSigned({ versionId: req.params.versionId, orgId: req.query.org, expiresAt: req.query.exp, disposition: req.query.d, signature: req.query.sig });
    reply.header('content-type', file.contentType);
    reply.header('content-length', String(file.sizeBytes));
    reply.header('content-disposition', `${file.disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    reply.header('cache-control', 'private, max-age=900');
    const { Readable } = await import('node:stream');
    return reply.send(Readable.from(file.stream));
  });
}
