import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivable, tenantColumns, ts } from './_common.js';
import { users } from './identity.js';
import { projects } from './project.js';
import { contacts, vendors } from './crm.js';

export const messageThreads = pgTable('message_threads', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('project'),
  subject: text('subject').notNull(),
  objectType: text('object_type'),
  objectId: uuid('object_id'),
  clientVisible: boolean('client_visible').notNull().default(false),
  vendorVisible: boolean('vendor_visible').notNull().default(false),
  lastMessageAt: ts('last_message_at'),
  lastMessagePreview: text('last_message_preview').notNull().default(''),
  messageCount: integer('message_count').notNull().default(0),
  clientMutationId: text('client_mutation_id'),
}, (t) => [index('threads_project_idx').on(t.projectId, t.lastMessageAt), index('threads_org_updated_idx').on(t.organizationId, t.updatedAt), uniqueIndex('threads_client_mutation_idx').on(t.organizationId, t.clientMutationId)]);

export const threadParticipants = pgTable('thread_participants', {
  ...tenantColumns(),
  threadId: uuid('thread_id').notNull().references(() => messageThreads.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'cascade' }),
  lastReadAt: ts('last_read_at'),
  muted: boolean('muted').notNull().default(false),
}, (t) => [index('thread_participants_thread_idx').on(t.threadId), index('thread_participants_user_idx').on(t.userId), uniqueIndex('thread_participants_user_unique').on(t.threadId, t.userId), uniqueIndex('thread_participants_contact_unique').on(t.threadId, t.contactId), uniqueIndex('thread_participants_vendor_unique').on(t.threadId, t.vendorId)]);

export const messages = pgTable('messages', {
  ...tenantColumns(),
  threadId: uuid('thread_id').notNull().references(() => messageThreads.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  authorContactId: uuid('author_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  authorKind: text('author_kind').notNull().default('user'),
  body: text('body').notNull(),
  mentions: jsonb('mentions').$type<string[]>().notNull().default([]),
  editedAt: ts('edited_at'),
  deletedAt: ts('deleted_at'),
  clientMutationId: text('client_mutation_id'),
}, (t) => [index('messages_thread_idx').on(t.threadId, t.createdAt), index('messages_org_updated_idx').on(t.organizationId, t.updatedAt), uniqueIndex('messages_client_mutation_idx').on(t.organizationId, t.clientMutationId)]);
