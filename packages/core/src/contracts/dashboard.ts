import { z } from 'zod';
import { cents, isoDate, isoDateTime, uuid } from './common.js';
import { activityEntry } from './activity.js';

export const dashboardResponse = z.object({
  generatedAt: isoDateTime,
  activeProjects: z.object({
    count: z.number().int(),
    items: z.array(z.object({ id: uuid, number: z.string(), name: z.string(), status: z.string(), clientName: z.string().nullable(), color: z.string(), openTasks: z.number().int(), overdueTasks: z.number().int(), nextMilestone: z.object({ id: uuid, name: z.string(), date: isoDate }).nullable(), lastActivityAt: isoDateTime.nullable(), isFavorite: z.boolean() })),
  }),
  overdueTasks: z.object({ count: z.number().int(), items: z.array(z.object({ id: uuid, name: z.string(), projectId: uuid, projectName: z.string(), dueDate: isoDate, assigneeNames: z.array(z.string()), daysOverdue: z.number().int() })) }).optional(),
  upcomingDeadlines: z.object({ count: z.number().int(), items: z.array(z.object({ id: uuid, name: z.string(), projectId: uuid, projectName: z.string(), dueDate: isoDate, isMilestone: z.boolean() })) }).optional(),
  pendingApprovals: z.object({ count: z.number().int(), items: z.array(z.object({ id: uuid, objectType: z.string(), objectId: uuid, title: z.string(), projectId: uuid.nullable(), projectName: z.string().nullable(), requestedAt: isoDateTime, amountCents: cents.nullable() })) }).optional(),
  unpaidInvoices: z.object({ count: z.number().int(), totalCents: cents, items: z.array(z.object({ id: uuid, number: z.string(), projectId: uuid, projectName: z.string(), clientName: z.string().nullable(), dueDate: isoDate.nullable(), balanceCents: cents, status: z.string() })) }).optional(),
  budgetWarnings: z.object({ count: z.number().int(), items: z.array(z.object({ projectId: uuid, projectName: z.string(), costCode: z.string().nullable(), lineName: z.string(), revisedCents: cents, projectedCents: cents, varianceCents: cents, status: z.string() })) }).optional(),
  scheduleConflicts: z.object({ count: z.number().int(), items: z.array(z.object({ resourceType: z.string(), resourceName: z.string(), taskAName: z.string(), taskBName: z.string(), projectAName: z.string(), projectBName: z.string(), overlapStart: isoDate, overlapEnd: isoDate })) }).optional(),
  recentActivity: z.array(activityEntry),
  recentMessages: z.array(z.object({ threadId: uuid, projectId: uuid.nullable(), projectName: z.string().nullable(), subject: z.string(), lastMessagePreview: z.string(), lastMessageAt: isoDateTime, unread: z.boolean() })).optional(),
  unreadNotifications: z.number().int(),
});
export type DashboardResponse = z.infer<typeof dashboardResponse>;
