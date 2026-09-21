import { z } from 'zod';
import { isoDateTime, paginationQuery, uuid } from './common.js';

export const ACTIVITY_OBJECT_TYPES = [
  'organization', 'member', 'role', 'invitation', 'client', 'contact', 'lead', 'vendor', 'project', 'project_member',
  'phase', 'task', 'task_dependency', 'daily_log', 'document', 'folder', 'message', 'thread', 'estimate',
  'estimate_line', 'proposal', 'budget', 'budget_line', 'change_order', 'purchase_order', 'bill', 'invoice',
  'payment', 'selection', 'time_entry', 'approval', 'notification', 'automation', 'ai_conversation',
] as const;
export type ActivityObjectType = (typeof ACTIVITY_OBJECT_TYPES)[number];

export const activityEntry = z.object({
  id: uuid,
  organizationId: uuid,
  projectId: uuid.nullable(),
  actorUserId: uuid.nullable(),
  actorName: z.string(),
  actorKind: z.enum(['user', 'client', 'vendor', 'system', 'ai']),
  verb: z.string(),
  objectType: z.enum(ACTIVITY_OBJECT_TYPES),
  objectId: uuid.nullable(),
  objectLabel: z.string(),
  summary: z.string(),
  diff: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })).nullable(),
  clientVisible: z.boolean(),
  occurredAt: isoDateTime,
});
export type ActivityEntry = z.infer<typeof activityEntry>;

export const listActivityQuery = paginationQuery.extend({
  projectId: uuid.optional(),
  objectType: z.enum(ACTIVITY_OBJECT_TYPES).optional(),
  objectId: uuid.optional(),
  actorUserId: uuid.optional(),
  since: isoDateTime.optional(),
});
