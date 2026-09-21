import { boolean, index, integer, jsonb, pgTable, text, uuid, date } from 'drizzle-orm/pg-core';
import { archivable, money, tenantColumns, ts } from './_common.js';
import { users } from './identity.js';

export const clients = pgTable('clients', {
  ...tenantColumns(),
  ...archivable(),
  displayName: text('display_name').notNull(),
  companyName: text('company_name'),
  email: text('email'),
  phone: text('phone'),
  billingAddress: jsonb('billing_address').notNull().default({}),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('active'),
}, (t) => [index('clients_org_name_idx').on(t.organizationId, t.displayName), index('clients_org_updated_idx').on(t.organizationId, t.updatedAt)]);

export const vendors = pgTable('vendors', {
  ...tenantColumns(),
  ...archivable(),
  name: text('name').notNull(),
  trade: text('trade'),
  email: text('email'),
  phone: text('phone'),
  website: text('website'),
  address: jsonb('address').notNull().default({}),
  notes: text('notes').notNull().default(''),
  taxId: text('tax_id'),
  defaultCostCodeId: uuid('default_cost_code_id'),
  status: text('status').notNull().default('active'),
  portalUserId: uuid('portal_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [index('vendors_org_name_idx').on(t.organizationId, t.name)]);

export const contacts = pgTable('contacts', {
  ...tenantColumns(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull().default(''),
  email: text('email'),
  phone: text('phone'),
  title: text('title'),
  isPrimary: boolean('is_primary').notNull().default(false),
  notes: text('notes').notNull().default(''),
  portalUserId: uuid('portal_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [index('contacts_client_idx').on(t.clientId), index('contacts_vendor_idx').on(t.vendorId), index('contacts_org_idx').on(t.organizationId)]);

export const vendorComplianceDocs = pgTable('vendor_compliance_docs', {
  ...tenantColumns(),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // insurance | license | w9 | other
  name: text('name').notNull(),
  documentId: uuid('document_id'),
  expiresAt: date('expires_at', { mode: 'string' }),
  status: text('status').notNull().default('pending'),
}, (t) => [index('vendor_compliance_vendor_idx').on(t.vendorId)]);

export const leads = pgTable('leads', {
  ...tenantColumns(),
  ...archivable(),
  name: text('name').notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  address: jsonb('address').notNull().default({}),
  source: text('source'),
  stage: text('stage').notNull().default('new'),
  projectType: text('project_type'),
  estimatedValueCents: money('estimated_value_cents'),
  budgetRangeLowCents: money('budget_range_low_cents'),
  budgetRangeHighCents: money('budget_range_high_cents'),
  targetStartDate: date('target_start_date', { mode: 'string' }),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes').notNull().default(''),
  nextFollowUpAt: ts('next_follow_up_at'),
  convertedProjectId: uuid('converted_project_id'),
  lostReason: text('lost_reason'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('leads_org_stage_idx').on(t.organizationId, t.stage), index('leads_org_updated_idx').on(t.organizationId, t.updatedAt)]);

export const leadActivities = pgTable('lead_activities', {
  ...tenantColumns(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // call | email | note | meeting | task
  body: text('body').notNull().default(''),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  dueAt: ts('due_at'),
  completedAt: ts('completed_at'),
}, (t) => [index('lead_activities_lead_idx').on(t.leadId, t.occurredAt)]);
