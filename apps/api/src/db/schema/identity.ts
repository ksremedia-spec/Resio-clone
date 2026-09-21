import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  avatarDocumentId: uuid('avatar_document_id'),
  emailVerifiedAt: ts('email_verified_at'),
  lastActiveAt: ts('last_active_at'),
  passwordChangedAt: ts('password_changed_at'),
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_idx').on(t.email)]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  legalName: text('legal_name'),
  email: text('email'),
  phone: text('phone'),
  website: text('website'),
  address: jsonb('address').notNull().default({}),
  timezone: text('timezone').notNull().default('America/New_York'),
  currency: text('currency').notNull().default('USD'),
  logoDocumentId: uuid('logo_document_id'),
  defaultMarkupBp: integer('default_markup_bp').notNull().default(2000),
  defaultTaxBp: integer('default_tax_bp').notNull().default(0),
  workingDays: jsonb('working_days').$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  settings: jsonb('settings').notNull().default({}),
  nextProjectNumber: integer('next_project_number').notNull().default(1001),
  createdBy: uuid('created_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  archivedAt: ts('archived_at'),
}, (t) => [uniqueIndex('organizations_slug_idx').on(t.slug)]);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  key: text('key'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  isSystem: boolean('is_system').notNull().default(false),
  restrictToAssignedProjects: boolean('restrict_to_assigned_projects').notNull().default(true),
  external: boolean('external').notNull().default(false),
  defaultMode: text('default_mode').notNull().default('office'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('roles_org_key_idx').on(t.organizationId, t.key), index('roles_org_idx').on(t.organizationId)]);

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull(),
}, (t) => [uniqueIndex('role_permissions_pk').on(t.roleId, t.permission)]);

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  status: text('status').notNull().default('active'),
  title: text('title'),
  hourlyCostCents: integer('hourly_cost_cents'),
  joinedAt: ts('joined_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('memberships_org_user_idx').on(t.organizationId, t.userId), index('memberships_user_idx').on(t.userId)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  activeOrganizationId: uuid('active_organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  deviceName: text('device_name'),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  expiresAt: ts('expires_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('sessions_token_idx').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]);

/** One-time tokens: password reset, email verification, invitations, portal magic links. */
export const oneTimeTokens = pgTable('one_time_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  kind: text('kind').notNull(), // password_reset | email_verify | invitation | portal_client | portal_vendor
  tokenHash: text('token_hash').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id'),
  payload: jsonb('payload').notNull().default({}),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('one_time_tokens_hash_idx').on(t.tokenHash), index('one_time_tokens_subject_idx').on(t.kind, t.subjectId)]);

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  projectIds: jsonb('project_ids').$type<string[]>().notNull().default([]),
  message: text('message'),
  status: text('status').notNull().default('pending'),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('invitations_org_idx').on(t.organizationId, t.status), index('invitations_email_idx').on(t.email)]);

export const pushTokens = pgTable('push_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  token: text('token').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastUsedAt: ts('last_used_at'),
}, (t) => [uniqueIndex('push_tokens_token_idx').on(t.token)]);
