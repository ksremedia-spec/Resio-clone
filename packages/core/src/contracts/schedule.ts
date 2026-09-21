import { z } from 'zod';
import { auditFields, isoDate, isoDateTime, longText, paginationQuery, shortText, uuid, patchOf } from './common.js';

export const TASK_STATUSES = ['not_started', 'in_progress', 'blocked', 'complete', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export const TASK_KINDS = ['schedule', 'todo'] as const;
export const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;

export const phaseSchema = auditFields.extend({
  projectId: uuid,
  name: z.string(),
  sortOrder: z.number().int(),
  color: z.string().nullable(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  clientVisible: z.boolean(),
  taskCount: z.number().int().optional(),
  completeCount: z.number().int().optional(),
});
export type Phase = z.infer<typeof phaseSchema>;

export const createPhaseBody = z.object({
  name: shortText,
  sortOrder: z.number().int().optional(),
  color: z.string().nullable().optional(),
  clientVisible: z.boolean().default(true),
});
export const updatePhaseBody = patchOf(createPhaseBody);

export const taskAssigneeSchema = z.object({
  id: uuid,
  userId: uuid.nullable(),
  vendorId: uuid.nullable(),
  displayName: z.string(),
  kind: z.enum(['user', 'vendor']),
  accepted: z.boolean().nullable(),
});

export const taskDependencySchema = z.object({
  id: uuid,
  predecessorId: uuid,
  successorId: uuid,
  type: z.enum(DEPENDENCY_TYPES),
  lagDays: z.number().int(),
});
export type TaskDependency = z.infer<typeof taskDependencySchema>;

export const taskSchema = auditFields.extend({
  projectId: uuid,
  projectName: z.string().optional(),
  phaseId: uuid.nullable(),
  parentTaskId: uuid.nullable(),
  kind: z.enum(TASK_KINDS),
  name: z.string(),
  description: z.string(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  isMilestone: z.boolean(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  durationDays: z.number().int(),
  percentComplete: z.number().int().min(0).max(100),
  sortOrder: z.number().int(),
  locked: z.boolean(),
  clientVisible: z.boolean(),
  color: z.string().nullable(),
  costCodeId: uuid.nullable(),
  completedAt: isoDateTime.nullable(),
  assignees: z.array(taskAssigneeSchema),
  predecessors: z.array(taskDependencySchema),
  successors: z.array(taskDependencySchema),
  checklist: z.array(z.object({ id: uuid, text: z.string(), done: z.boolean(), sortOrder: z.number().int() })),
  attachmentCount: z.number().int(),
  isCritical: z.boolean().optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const createTaskBody = z.object({
  /** Optional client-generated id so offline creates are idempotent. */
  id: uuid.optional(),
  kind: z.enum(TASK_KINDS).default('schedule'),
  phaseId: uuid.nullable().optional(),
  parentTaskId: uuid.nullable().optional(),
  name: shortText,
  description: longText.default(''),
  status: z.enum(TASK_STATUSES).default('not_started'),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  isMilestone: z.boolean().default(false),
  startDate: isoDate.nullable().optional(),
  durationDays: z.number().int().min(0).max(3650).optional(),
  endDate: isoDate.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  clientVisible: z.boolean().default(false),
  color: z.string().nullable().optional(),
  costCodeId: uuid.nullable().optional(),
  assigneeUserIds: z.array(uuid).max(50).optional(),
  assigneeVendorIds: z.array(uuid).max(50).optional(),
  checklist: z.array(z.string().max(300)).max(100).optional(),
  predecessors: z.array(z.object({ taskId: uuid, type: z.enum(DEPENDENCY_TYPES).default('FS'), lagDays: z.number().int().min(-365).max(365).default(0) })).max(50).optional(),
  sortOrder: z.number().int().optional(),
  clientMutationId: z.string().max(64).optional(),
});
export const updateTaskBody = patchOf(createTaskBody, ['id', 'kind', 'clientMutationId', 'predecessors', 'checklist']).extend({
  percentComplete: z.number().int().min(0).max(100).optional(),
  locked: z.boolean().optional(),
  checklist: z.array(z.object({ id: uuid.optional(), text: z.string().max(300), done: z.boolean().default(false) })).max(100).optional(),
  expectedVersion: z.number().int().optional(),
});

export const moveTaskBody = z.object({
  startDate: isoDate.optional(),
  durationDays: z.number().int().min(0).max(3650).optional(),
  /** When false (default) returns a preview without persisting. */
  commit: z.boolean().default(false),
});

export const moveTaskResponse = z.object({
  changes: z.array(z.object({ id: uuid, name: z.string(), from: z.object({ startDate: isoDate, endDate: isoDate }), to: z.object({ startDate: isoDate, endDate: isoDate }) })),
  criticalPath: z.array(uuid),
  committed: z.boolean(),
});

export const addDependencyBody = z.object({
  predecessorId: uuid,
  type: z.enum(DEPENDENCY_TYPES).default('FS'),
  lagDays: z.number().int().min(-365).max(365).default(0),
});

export const listTasksQuery = paginationQuery.extend({
  projectId: uuid.optional(),
  phaseId: uuid.optional(),
  status: z.enum([...TASK_STATUSES, 'open', 'all']).default('open'),
  kind: z.enum([...TASK_KINDS, 'all']).default('all'),
  assigneeUserId: uuid.optional(),
  mine: z.coerce.boolean().optional(),
  dueBefore: isoDate.optional(),
  dueAfter: isoDate.optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(['sortOrder:asc', 'startDate:asc', 'dueDate:asc', 'updatedAt:desc']).default('sortOrder:asc'),
});

export const scheduleResponse = z.object({
  phases: z.array(phaseSchema),
  tasks: z.array(taskSchema),
  dependencies: z.array(taskDependencySchema),
  criticalPath: z.array(uuid),
  conflicts: z.array(z.object({ resourceType: z.string(), resourceId: z.string(), resourceName: z.string(), taskIds: z.array(uuid), overlapStart: isoDate, overlapEnd: isoDate })),
  workingDays: z.array(z.number().int()),
});
export type ScheduleResponse = z.infer<typeof scheduleResponse>;
