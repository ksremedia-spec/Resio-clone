import { z } from 'zod';
import { auditFields, isoDateTime, paginationQuery, shortText, uuid, patchOf } from './common.js';

export const folderSchema = auditFields.extend({
  projectId: uuid.nullable(),
  parentId: uuid.nullable(),
  name: z.string(),
  kind: z.enum(['general', 'photos', 'plans', 'contracts', 'invoices', 'receipts', 'specifications', 'system']),
  clientVisible: z.boolean(),
  vendorVisible: z.boolean(),
  documentCount: z.number().int().optional(),
});
export type Folder = z.infer<typeof folderSchema>;

export const createFolderBody = z.object({
  projectId: uuid.nullable().optional(),
  parentId: uuid.nullable().optional(),
  name: shortText,
  kind: folderSchema.shape.kind.default('general'),
  clientVisible: z.boolean().default(false),
  vendorVisible: z.boolean().default(false),
});
export const updateFolderBody = patchOf(createFolderBody, ['projectId']);

export const photoMetadata = z.object({
  takenAt: isoDateTime.nullable().default(null),
  latitude: z.number().nullable().default(null),
  longitude: z.number().nullable().default(null),
  width: z.number().int().nullable().default(null),
  height: z.number().int().nullable().default(null),
  device: z.string().max(120).nullable().default(null),
  orientation: z.number().int().nullable().default(null),
});
export type PhotoMetadata = z.infer<typeof photoMetadata>;

export const documentVersionSchema = z.object({
  id: uuid,
  versionNumber: z.number().int(),
  sizeBytes: z.number().int(),
  contentType: z.string(),
  checksumSha256: z.string(),
  createdAt: isoDateTime,
  createdBy: uuid.nullable(),
  note: z.string(),
});

export const documentSchema = auditFields.extend({
  projectId: uuid.nullable(),
  folderId: uuid.nullable(),
  name: z.string(),
  description: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  kind: z.enum(['photo', 'pdf', 'plan', 'contract', 'invoice', 'receipt', 'spreadsheet', 'image', 'video', 'audio', 'other']),
  tags: z.array(z.string()),
  clientVisible: z.boolean(),
  vendorVisible: z.boolean(),
  currentVersionId: uuid.nullable(),
  versionCount: z.number().int(),
  photo: photoMetadata.nullable(),
  archivedAt: isoDateTime.nullable(),
  downloadUrl: z.string().optional(),
  thumbnailUrl: z.string().nullable().optional(),
});
export type Document = z.infer<typeof documentSchema>;

export const documentDetail = documentSchema.extend({ versions: z.array(documentVersionSchema) });

export const uploadDocumentFields = z.object({
  projectId: uuid.nullable().optional(),
  folderId: uuid.nullable().optional(),
  name: z.string().trim().max(255).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  clientVisible: z.boolean().optional(),
  vendorVisible: z.boolean().optional(),
  photo: photoMetadata.partial().optional(),
  /** Client-generated id for offline idempotency. */
  clientMutationId: z.string().max(64).optional(),
  /** When set, upload as a new version of an existing document. */
  documentId: uuid.optional(),
  versionNote: z.string().max(500).optional(),
});

export const updateDocumentBody = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  folderId: uuid.nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  clientVisible: z.boolean().optional(),
  vendorVisible: z.boolean().optional(),
});

export const listDocumentsQuery = paginationQuery.extend({
  projectId: uuid.optional(),
  folderId: uuid.nullable().optional(),
  kind: documentSchema.shape.kind.optional(),
  q: z.string().max(200).optional(),
  tag: z.string().max(40).optional(),
  includeArchived: z.coerce.boolean().default(false),
  sort: z.enum(['name:asc', 'createdAt:desc', 'updatedAt:desc']).default('createdAt:desc'),
});

export const attachmentSchema = z.object({
  id: uuid,
  objectType: z.string(),
  objectId: uuid,
  document: documentSchema,
  createdAt: isoDateTime,
});
