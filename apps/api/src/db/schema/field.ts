import { boolean, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivable, tenantColumns, ts } from './_common.js';
import { users } from './identity.js';
import { projects, tasks } from './project.js';
import { vendors } from './crm.js';

export const dailyLogs = pgTable('daily_logs', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  logDate: date('log_date', { mode: 'string' }).notNull(),
  weather: jsonb('weather').notNull().default({}),
  summary: text('summary').notNull().default(''),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  clientVisible: boolean('client_visible').notNull().default(false),
  status: text('status').notNull().default('submitted'),
  submittedAt: ts('submitted_at'),
  searchText: text('search_text').notNull().default(''),
}, (t) => [index('daily_logs_project_date_idx').on(t.projectId, t.logDate), index('daily_logs_org_updated_idx').on(t.organizationId, t.updatedAt)]);

export const dailyLogEntries = pgTable('daily_log_entries', {
  ...tenantColumns(),
  dailyLogId: uuid('daily_log_id').notNull().references(() => dailyLogs.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  text: text('text').notNull().default(''),
  quantity: numeric('quantity', { precision: 14, scale: 3 }),
  unit: text('unit'),
  trade: text('trade'),
  headcount: integer('headcount'),
  hours: numeric('hours', { precision: 10, scale: 2 }),
  delayCause: text('delay_cause'),
  delayHours: numeric('delay_hours', { precision: 10, scale: 2 }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  documentId: uuid('document_id'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('daily_log_entries_log_idx').on(t.dailyLogId, t.sortOrder)]);

export const timeEntries = pgTable('time_entries', {
  ...tenantColumns(),
  ...archivable(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  costCodeId: uuid('cost_code_id'),
  clockInAt: ts('clock_in_at').notNull(),
  clockOutAt: ts('clock_out_at'),
  breakSeconds: integer('break_seconds').notNull().default(0),
  durationSeconds: integer('duration_seconds'),
  status: text('status').notNull().default('open'),
  notes: text('notes').notNull().default(''),
  clockInLocation: jsonb('clock_in_location'),
  clockOutLocation: jsonb('clock_out_location'),
  hourlyCostCents: integer('hourly_cost_cents'),
  laborCostCents: integer('labor_cost_cents'),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: ts('approved_at'),
  exportedAt: ts('exported_at'),
  correctionOfId: uuid('correction_of_id'),
  clientMutationId: text('client_mutation_id'),
}, (t) => [index('time_entries_user_idx').on(t.userId, t.clockInAt), index('time_entries_project_idx').on(t.projectId, t.clockInAt), uniqueIndex('time_entries_client_mutation_idx').on(t.organizationId, t.clientMutationId)]);

export const timeBreaks = pgTable('time_breaks', {
  ...tenantColumns(),
  timeEntryId: uuid('time_entry_id').notNull().references(() => timeEntries.id, { onDelete: 'cascade' }),
  startedAt: ts('started_at').notNull(),
  endedAt: ts('ended_at'),
}, (t) => [index('time_breaks_entry_idx').on(t.timeEntryId)]);
