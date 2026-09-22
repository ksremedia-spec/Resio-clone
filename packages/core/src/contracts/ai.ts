import { z } from 'zod';
import { auditFields, isoDateTime, uuid } from './common.js';

export const aiToolCall = z.object({ id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()), summary: z.string() });
export const aiToolResult = z.object({ toolUseId: z.string(), name: z.string(), ok: z.boolean(), summary: z.string(), output: z.unknown().optional(), link: z.string().nullable().optional() });
export const aiPendingAction = z.object({ toolUseId: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()), summary: z.string(), status: z.enum(['pending', 'confirmed', 'cancelled', 'failed']), resultSummary: z.string().nullable(), link: z.string().nullable(), decidedAt: isoDateTime.nullable() });
export type AiPendingAction = z.infer<typeof aiPendingAction>;
export const aiMessageSchema = z.object({ id: uuid, conversationId: uuid, role: z.enum(['user', 'assistant']), content: z.string(), toolCalls: z.array(aiToolCall).nullable(), toolResults: z.array(aiToolResult).nullable(), pendingAction: aiPendingAction.nullable(), createdAt: isoDateTime });
export type AiMessage = z.infer<typeof aiMessageSchema>;
export const aiConversationSchema = auditFields.extend({ userId: uuid, projectId: uuid.nullable(), projectName: z.string().nullable(), title: z.string(), lastMessageAt: isoDateTime.nullable(), messages: z.array(aiMessageSchema).optional() });
export type AiConversation = z.infer<typeof aiConversationSchema>;
export const createConversationBody = z.object({ projectId: uuid.nullable().optional(), message: z.string().trim().min(1).max(4000).optional() });
export const sendAiMessageBody = z.object({ content: z.string().trim().min(1).max(4000) });
export const confirmAiActionBody = z.object({ messageId: uuid, approve: z.boolean() });
export const aiToolInfo = z.object({ name: z.string(), description: z.string(), kind: z.enum(['read', 'write']) });
export const aiStatus = z.object({ provider: z.string(), model: z.string().nullable(), tools: z.array(aiToolInfo), suggestions: z.array(z.string()) });
export type AiStatus = z.infer<typeof aiStatus>;
