import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantColumns, ts } from './_common.js';
import { organizations, users } from './identity.js';
import { projects } from './project.js';
import { contacts } from './crm.js';

/** Append-only. No UPDATE/DELETE privileges are granted on this table in production. */
export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorContactId: uuid('actor_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  actorName: text('actor_name').notNull(),
  actorKind: text('actor_kind').notNull().default('user'),
  verb: text('verb').notNull(),
  objectType: text('object_type').notNull(),
  objectId: uuid('object_id'),
  objectLabel: text('object_label').notNull().default(''),
  summary: text('summary').notNull(),
  diff: jsonb('diff'),
  metadata: jsonb('metadata').notNull().default({}),
  clientVisible: boolean('client_visible').notNull().default(false),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
}, (t) => [
  index('activity_org_time_idx').on(t.organizationId, t.occurredAt),
  index('activity_project_time_idx').on(t.projectId, t.occurredAt),
  index('activity_object_idx').on(t.objectType, t.objectId),
]);

/** Append-only record of every approval decision (proposals, change orders, selections, invoices, time). */
export const approvals = pgTable('approvals', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  objectType: text('object_type').notNull(),
  objectId: uuid('object_id').notNull(),
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  requestedAt: ts('requested_at').notNull().defaultNow(),
  status: text('status').notNull().default('pending'), // pending | approved | declined | cancelled
  decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  decidedByContactId: uuid('decided_by_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  decidedByName: text('decided_by_name'),
  decidedAt: ts('decided_at'),
  decisionNote: text('decision_note'),
  signatureDocumentId: uuid('signature_document_id'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  amountCents: integer('amount_cents'),
  snapshot: jsonb('snapshot'),
  title: text('title').notNull().default(''),
}, (t) => [index('approvals_object_idx').on(t.objectType, t.objectId), index('approvals_org_status_idx').on(t.organizationId, t.status)]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  objectType: text('object_type'),
  objectId: uuid('object_id'),
  link: text('link'),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, (t) => [index('notifications_user_idx').on(t.userId, t.createdAt), index('notifications_user_unread_idx').on(t.userId, t.readAt)]);

export const notificationDeliveries = pgTable('notification_deliveries', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  notificationId: uuid('notification_id').notNull().references(() => notifications.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  status: text('status').notNull().default('queued'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  sentAt: ts('sent_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('notification_deliveries_status_idx').on(t.status, t.createdAt)]);

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  channels: jsonb('channels').$type<string[]>().notNull().default(['in_app']),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('notification_preferences_unique').on(t.organizationId, t.userId, t.kind)]);

export const automations = pgTable('automations', {
  ...tenantColumns(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  trigger: jsonb('trigger').notNull(),
  actions: jsonb('actions').notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  allowedRoleIds: jsonb('allowed_role_ids').$type<string[]>().notNull().default([]),
  lastRunAt: ts('last_run_at'),
}, (t) => [index('automations_org_idx').on(t.organizationId)]);

export const automationRuns = pgTable('automation_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  automationId: uuid('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('running'),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  input: jsonb('input').notNull().default({}),
  output: jsonb('output'),
  error: text('error'),
}, (t) => [index('automation_runs_automation_idx').on(t.automationId, t.startedAt)]);

export const aiConversations = pgTable('ai_conversations', {
  ...tenantColumns(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull().default('New conversation'),
  lastMessageAt: ts('last_message_at'),
}, (t) => [index('ai_conversations_user_idx').on(t.userId, t.lastMessageAt)]);

export const aiMessages = pgTable('ai_messages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant | tool
  content: text('content').notNull().default(''),
  toolCalls: jsonb('tool_calls'),
  toolResults: jsonb('tool_results'),
  pendingAction: jsonb('pending_action'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('ai_messages_conversation_idx').on(t.conversationId, t.createdAt)]);

/** Idempotency ledger for offline sync mutations. */
export const syncMutations = pgTable('sync_mutations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientMutationId: text('client_mutation_id').notNull(),
  entity: text('entity').notNull(),
  operation: text('operation').notNull(),
  entityId: uuid('entity_id').notNull(),
  status: text('status').notNull(),
  result: jsonb('result'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('sync_mutations_unique').on(t.organizationId, t.userId, t.clientMutationId)]);

export const integrationConnections = pgTable('integration_connections', {
  ...tenantColumns(),
  provider: text('provider').notNull(), // quickbooks | stripe | google_calendar | ...
  status: text('status').notNull().default('disconnected'),
  externalAccountId: text('external_account_id'),
  credentials: jsonb('credentials'),
  settings: jsonb('settings').notNull().default({}),
  lastSyncAt: ts('last_sync_at'),
}, (t) => [uniqueIndex('integration_connections_unique').on(t.organizationId, t.provider)]);
