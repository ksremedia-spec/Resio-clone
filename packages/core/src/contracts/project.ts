import { z } from 'zod';
import { addressSchema, auditFields, cents, colorHex, isoDate, isoDateTime, longText, paginationQuery, shortText, uuid, patchOf } from './common.js';

export const PROJECT_STATUSES = ['lead', 'pre_construction', 'active', 'on_hold', 'complete', 'archived'] as const;
export const PROJECT_TYPES = ['new_construction', 'remodel', 'addition', 'commercial', 'service', 'other'] as const;
export const CONTRACT_TYPES = ['fixed_price', 'cost_plus', 'time_and_materials'] as const;
export const PROJECT_ACCESS_LEVELS = ['manager', 'member', 'viewer', 'vendor'] as const;

export const projectSummary = auditFields.extend({
  number: z.string(),
  name: z.string(),
  status: z.enum(PROJECT_STATUSES),
  type: z.enum(PROJECT_TYPES),
  contractType: z.enum(CONTRACT_TYPES),
  clientId: uuid.nullable(),
  clientName: z.string().nullable(),
  address: addressSchema,
  color: z.string(),
  startDate: isoDate.nullable(),
  targetEndDate: isoDate.nullable(),
  actualEndDate: isoDate.nullable(),
  contractValueCents: cents,
  isFavorite: z.boolean(),
  archivedAt: isoDateTime.nullable(),
  lastActivityAt: isoDateTime.nullable(),
});
export type ProjectSummary = z.infer<typeof projectSummary>;

export const projectMemberSchema = z.object({
  id: uuid,
  projectId: uuid,
  userId: uuid.nullable(),
  contactId: uuid.nullable(),
  vendorId: uuid.nullable(),
  accessLevel: z.enum(PROJECT_ACCESS_LEVELS),
  displayName: z.string(),
  email: z.string().nullable(),
  roleName: z.string().nullable(),
  kind: z.enum(['user', 'client_contact', 'vendor']),
  createdAt: isoDateTime,
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const projectSharing = z.object({
  clientCanSeeSchedule: z.boolean(),
  clientCanSeeBudget: z.boolean(),
  clientCanSeeDailyLogs: z.boolean(),
  clientCanSeeDocuments: z.boolean(),
  clientCanMessage: z.boolean(),
});

export const projectDetail = projectSummary.extend({
  description: z.string(),
  sharing: projectSharing,
  members: z.array(projectMemberSchema),
  counts: z.object({
    openTasks: z.number().int(),
    overdueTasks: z.number().int(),
    dailyLogs: z.number().int(),
    documents: z.number().int(),
    unreadMessages: z.number().int(),
    pendingApprovals: z.number().int(),
  }),
  financials: z.object({
    contractValueCents: cents,
    approvedChangesCents: cents,
    revisedContractCents: cents,
    invoicedCents: cents,
    paidCents: cents,
    outstandingCents: cents,
    budgetOriginalCents: cents,
    budgetRevisedCents: cents,
    committedCents: cents,
    actualCents: cents,
  }),
});
export type ProjectDetail = z.infer<typeof projectDetail>;

export const createProjectBody = z.object({
  name: shortText,
  number: z.string().trim().max(40).optional(),
  status: z.enum(PROJECT_STATUSES).default('pre_construction'),
  type: z.enum(PROJECT_TYPES).default('remodel'),
  contractType: z.enum(CONTRACT_TYPES).default('fixed_price'),
  clientId: uuid.nullable().optional(),
  address: addressSchema.partial().optional(),
  color: colorHex.optional(),
  description: longText.default(''),
  startDate: isoDate.nullable().optional(),
  targetEndDate: isoDate.nullable().optional(),
  contractValueCents: cents.default(0),
  memberUserIds: z.array(uuid).max(100).optional(),
  sharing: projectSharing.partial().optional(),
});
export const updateProjectBody = patchOf(createProjectBody, ['memberUserIds']).extend({
  actualEndDate: isoDate.nullable().optional(),
});

export const addProjectMemberBody = z.object({
  userId: uuid.optional(),
  contactId: uuid.optional(),
  vendorId: uuid.optional(),
  accessLevel: z.enum(PROJECT_ACCESS_LEVELS).default('member'),
}).refine((v) => [v.userId, v.contactId, v.vendorId].filter(Boolean).length === 1, { message: 'exactly one of userId, contactId, vendorId is required' });

export const listProjectsQuery = paginationQuery.extend({
  q: z.string().max(200).optional(),
  status: z.enum([...PROJECT_STATUSES, 'open', 'all']).default('open'),
  clientId: uuid.optional(),
  favorites: z.coerce.boolean().optional(),
  sort: z.enum(['name:asc', 'updatedAt:desc', 'startDate:asc', 'startDate:desc', 'number:asc']).default('updatedAt:desc'),
});
