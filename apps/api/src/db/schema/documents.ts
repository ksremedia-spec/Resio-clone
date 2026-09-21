import { bigint, boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { archivable, tenantColumns, ts } from './_common.js';
import { users } from './identity.js';
import { projects } from './project.js';

export const folders = pgTable('folders', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('general'),
  clientVisible: boolean('client_visible').notNull().default(false),
  vendorVisible: boolean('vendor_visible').notNull().default(false),
}, (t) => [index('folders_project_idx').on(t.projectId, t.parentId), index('folders_org_idx').on(t.organizationId)]);

export const documents = pgTable('documents', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  kind: text('kind').notNull().default('other'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  clientVisible: boolean('client_visible').notNull().default(false),
  vendorVisible: boolean('vendor_visible').notNull().default(false),
  currentVersionId: uuid('current_version_id'),
  versionCount: integer('version_count').notNull().default(0),
  photo: jsonb('photo'),
  clientMutationId: text('client_mutation_id'),
  searchText: text('search_text').notNull().default(''),
}, (t) => [
  index('documents_project_idx').on(t.projectId, t.createdAt),
  index('documents_folder_idx').on(t.folderId),
  index('documents_org_updated_idx').on(t.organizationId, t.updatedAt),
  uniqueIndex('documents_client_mutation_idx').on(t.organizationId, t.clientMutationId),
]);

export const documentVersions = pgTable('document_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  storageKey: text('storage_key').notNull(),
  storageProvider: text('storage_provider').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  contentType: text('content_type').notNull(),
  checksumSha256: text('checksum_sha256').notNull(),
  note: text('note').notNull().default(''),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('document_versions_unique').on(t.documentId, t.versionNumber)]);

export const attachments = pgTable('attachments', {
  ...tenantColumns(),
  objectType: text('object_type').notNull(),
  objectId: uuid('object_id').notNull(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('attachment'), // attachment | photo | signature | avatar | logo
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('attachments_object_idx').on(t.objectType, t.objectId), uniqueIndex('attachments_unique').on(t.objectType, t.objectId, t.documentId)]);

export const comments = pgTable('comments', {
  ...tenantColumns(),
  objectType: text('object_type').notNull(),
  objectId: uuid('object_id').notNull(),
  body: text('body').notNull(),
  clientVisible: boolean('client_visible').notNull().default(false),
  deletedAt: ts('deleted_at'),
}, (t) => [index('comments_object_idx').on(t.objectType, t.objectId, t.createdAt)]);
