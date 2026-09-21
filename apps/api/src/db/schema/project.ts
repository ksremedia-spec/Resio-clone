import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { archivable, money, tenantColumns, ts } from './_common.js';
import { users } from './identity.js';
import { clients, contacts, vendors } from './crm.js';

export const projects = pgTable('projects', {
  ...tenantColumns(),
  ...archivable(),
  number: text('number').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('pre_construction'),
  type: text('type').notNull().default('remodel'),
  contractType: text('contract_type').notNull().default('fixed_price'),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id'),
  address: jsonb('address').notNull().default({}),
  color: text('color').notNull().default('#2F6FED'),
  description: text('description').notNull().default(''),
  startDate: date('start_date', { mode: 'string' }),
  targetEndDate: date('target_end_date', { mode: 'string' }),
  actualEndDate: date('actual_end_date', { mode: 'string' }),
  contractValueCents: money('contract_value_cents'),
  sharing: jsonb('sharing').$type<Record<string, boolean>>().notNull().default({ clientCanSeeSchedule: true, clientCanSeeBudget: false, clientCanSeeDailyLogs: true, clientCanSeeDocuments: true, clientCanMessage: true }),
  lastActivityAt: ts('last_activity_at'),
  searchText: text('search_text').notNull().default(''),
}, (t) => [
  uniqueIndex('projects_org_number_idx').on(t.organizationId, t.number),
  index('projects_org_status_idx').on(t.organizationId, t.status),
  index('projects_org_updated_idx').on(t.organizationId, t.updatedAt),
  index('projects_client_idx').on(t.clientId),
]);

export const projectMembers = pgTable('project_members', {
  ...tenantColumns(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'cascade' }),
  accessLevel: text('access_level').notNull().default('member'),
}, (t) => [
  index('project_members_project_idx').on(t.projectId),
  index('project_members_user_idx').on(t.userId),
  uniqueIndex('project_members_unique_user').on(t.projectId, t.userId),
  uniqueIndex('project_members_unique_contact').on(t.projectId, t.contactId),
  uniqueIndex('project_members_unique_vendor').on(t.projectId, t.vendorId),
]);

export const projectFavorites = pgTable('project_favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('project_favorites_pk').on(t.userId, t.projectId)]);

export const projectPhases = pgTable('project_phases', {
  ...tenantColumns(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  color: text('color'),
  clientVisible: boolean('client_visible').notNull().default(true),
}, (t) => [index('project_phases_project_idx').on(t.projectId, t.sortOrder)]);

export const tasks = pgTable('tasks', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  phaseId: uuid('phase_id').references(() => projectPhases.id, { onDelete: 'set null' }),
  parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
  kind: text('kind').notNull().default('schedule'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('not_started'),
  priority: text('priority').notNull().default('medium'),
  isMilestone: boolean('is_milestone').notNull().default(false),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
  dueDate: date('due_date', { mode: 'string' }),
  durationDays: integer('duration_days').notNull().default(1),
  percentComplete: integer('percent_complete').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  locked: boolean('locked').notNull().default(false),
  clientVisible: boolean('client_visible').notNull().default(false),
  color: text('color'),
  costCodeId: uuid('cost_code_id'),
  baselineStartDate: date('baseline_start_date', { mode: 'string' }),
  baselineEndDate: date('baseline_end_date', { mode: 'string' }),
  completedAt: ts('completed_at'),
  completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [
  index('tasks_project_sort_idx').on(t.projectId, t.sortOrder),
  index('tasks_project_dates_idx').on(t.projectId, t.startDate, t.endDate),
  index('tasks_org_due_idx').on(t.organizationId, t.dueDate),
  index('tasks_org_updated_idx').on(t.organizationId, t.updatedAt),
]);

export const taskDependencies = pgTable('task_dependencies', {
  ...tenantColumns(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  predecessorId: uuid('predecessor_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  successorId: uuid('successor_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('FS'),
  lagDays: integer('lag_days').notNull().default(0),
}, (t) => [uniqueIndex('task_dependencies_unique').on(t.predecessorId, t.successorId), index('task_dependencies_project_idx').on(t.projectId)]);

export const taskAssignees = pgTable('task_assignees', {
  ...tenantColumns(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'cascade' }),
  crewId: uuid('crew_id'),
  accepted: boolean('accepted'),
  acceptedAt: ts('accepted_at'),
}, (t) => [index('task_assignees_task_idx').on(t.taskId), index('task_assignees_user_idx').on(t.userId), uniqueIndex('task_assignees_user_unique').on(t.taskId, t.userId), uniqueIndex('task_assignees_vendor_unique').on(t.taskId, t.vendorId)]);

export const checklists = pgTable('checklists', {
  ...tenantColumns(),
  objectType: text('object_type').notNull(),
  objectId: uuid('object_id').notNull(),
  name: text('name').notNull().default('Checklist'),
}, (t) => [index('checklists_object_idx').on(t.objectType, t.objectId)]);

export const checklistItems = pgTable('checklist_items', {
  ...tenantColumns(),
  checklistId: uuid('checklist_id').notNull().references(() => checklists.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
  doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
  doneAt: ts('done_at'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('checklist_items_checklist_idx').on(t.checklistId, t.sortOrder)]);

export const crews = pgTable('crews', {
  ...tenantColumns(),
  ...archivable(),
  name: text('name').notNull(),
  leadUserId: uuid('lead_user_id').references(() => users.id, { onDelete: 'set null' }),
  memberUserIds: jsonb('member_user_ids').$type<string[]>().notNull().default([]),
}, (t) => [index('crews_org_idx').on(t.organizationId)]);

export const equipment = pgTable('equipment', {
  ...tenantColumns(),
  ...archivable(),
  name: text('name').notNull(),
  kind: text('kind'),
  notes: text('notes').notNull().default(''),
}, (t) => [index('equipment_org_idx').on(t.organizationId)]);
