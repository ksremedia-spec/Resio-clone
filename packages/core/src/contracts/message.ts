import { z } from 'zod';
import { auditFields, isoDateTime, paginationQuery, uuid } from './common.js';
import { documentSchema } from './document.js';

export const THREAD_KINDS = ['project', 'direct', 'client', 'vendor', 'object'] as const;

export const threadParticipant = z.object({
  id: uuid,
  userId: uuid.nullable(),
  contactId: uuid.nullable(),
  vendorId: uuid.nullable(),
  displayName: z.string(),
  kind: z.enum(['user', 'client_contact', 'vendor']),
  lastReadAt: isoDateTime.nullable(),
});

export const messageSchema = z.object({
  id: uuid,
  threadId: uuid,
  authorUserId: uuid.nullable(),
  authorContactId: uuid.nullable(),
  authorName: z.string(),
  authorKind: z.enum(['user', 'client', 'vendor', 'system', 'ai']),
  body: z.string(),
  mentions: z.array(uuid),
  attachments: z.array(documentSchema),
  createdAt: isoDateTime,
  editedAt: isoDateTime.nullable(),
  deletedAt: isoDateTime.nullable(),
});
export type Message = z.infer<typeof messageSchema>;

export const threadSchema = auditFields.extend({
  projectId: uuid.nullable(),
  projectName: z.string().nullable(),
  kind: z.enum(THREAD_KINDS),
  subject: z.string(),
  objectType: z.string().nullable(),
  objectId: uuid.nullable(),
  objectLabel: z.string().nullable(),
  clientVisible: z.boolean(),
  vendorVisible: z.boolean(),
  participants: z.array(threadParticipant),
  lastMessage: messageSchema.nullable(),
  lastMessageAt: isoDateTime.nullable(),
  unreadCount: z.number().int(),
  messageCount: z.number().int(),
  archivedAt: isoDateTime.nullable(),
});
export type Thread = z.infer<typeof threadSchema>;

export const createThreadBody = z.object({
  projectId: uuid.nullable().optional(),
  kind: z.enum(THREAD_KINDS).default('project'),
  subject: z.string().trim().min(1).max(200),
  objectType: z.string().max(40).nullable().optional(),
  objectId: uuid.nullable().optional(),
  clientVisible: z.boolean().default(false),
  vendorVisible: z.boolean().default(false),
  participantUserIds: z.array(uuid).max(200).optional(),
  participantContactIds: z.array(uuid).max(50).optional(),
  participantVendorIds: z.array(uuid).max(50).optional(),
  initialMessage: z.string().max(20_000).optional(),
  attachmentDocumentIds: z.array(uuid).max(20).optional(),
  clientMutationId: z.string().max(64).optional(),
});

export const sendMessageBody = z.object({
  body: z.string().trim().min(1).max(20_000),
  mentions: z.array(uuid).max(50).default([]),
  attachmentDocumentIds: z.array(uuid).max(20).default([]),
  clientMutationId: z.string().max(64).optional(),
});

export const listThreadsQuery = paginationQuery.extend({
  projectId: uuid.optional(),
  kind: z.enum([...THREAD_KINDS, 'all']).default('all'),
  unreadOnly: z.coerce.boolean().default(false),
  q: z.string().max(200).optional(),
});
export const listMessagesQuery = paginationQuery.extend({ before: isoDateTime.optional() });
