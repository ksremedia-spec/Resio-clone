import { z } from 'zod';
import { isoDateTime, paginationQuery, uuid } from './common.js';

export const NOTIFICATION_KINDS = [
  'message.new', 'mention', 'task.assigned', 'task.overdue', 'task.due_soon', 'approval.requested', 'approval.decided',
  'change_order.approved', 'change_order.declined', 'invoice.paid', 'invoice.overdue', 'schedule.changed',
  'bid_request.new', 'daily_log.created', 'document.shared', 'member.joined', 'time.approved', 'system',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationSchema = z.object({
  id: uuid,
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  projectId: uuid.nullable(),
  objectType: z.string().nullable(),
  objectId: uuid.nullable(),
  link: z.string().nullable(),
  readAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsQuery = paginationQuery.extend({ unreadOnly: z.coerce.boolean().default(false) });

export const CHANNELS = ['in_app', 'push', 'email', 'sms'] as const;
export const notificationPreference = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  channels: z.array(z.enum(CHANNELS)),
});
export const notificationPreferences = z.object({ preferences: z.array(notificationPreference) });
export type NotificationPreferences = z.infer<typeof notificationPreferences>;

export const registerPushTokenBody = z.object({ platform: z.enum(['ios', 'macos', 'web']), token: z.string().min(10).max(500) });
