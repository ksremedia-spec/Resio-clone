import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const ok = z.object({ ok: z.literal(true) });
const tags = ['Messages'];
const pid = z.object({ id: z.uuid() });

export async function messageRoutes(app: AppInstance, s: Services) {
  app.get('/threads', { schema: { tags, querystring: contracts.listThreadsQuery, response: { 200: contracts.paginated(contracts.threadSchema) } } }, async (req) => s.messages.listThreads(req.requireCtx(), req.query));
  app.get('/projects/:id/threads', { schema: { tags, params: pid, querystring: contracts.listThreadsQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.threadSchema) } } }, async (req) => s.messages.listThreads(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/threads', { schema: { tags, body: contracts.createThreadBody, response: { 201: contracts.threadSchema } } }, async (req, reply) => reply.status(201).send(await s.messages.createThread(req.requireCtx(), req.body)));
  app.get('/threads/:id', { schema: { tags, params: pid, response: { 200: contracts.threadSchema } } }, async (req) => s.messages.getThread(req.requireCtx(), req.params.id));
  app.get('/threads/:id/messages', { schema: { tags, params: pid, querystring: contracts.listMessagesQuery, response: { 200: contracts.paginated(contracts.messageSchema) } } }, async (req) => s.messages.listMessages(req.requireCtx(), req.params.id, req.query));
  app.post('/threads/:id/messages', { schema: { tags, params: pid, body: contracts.sendMessageBody, response: { 201: contracts.messageSchema } } }, async (req, reply) => reply.status(201).send(await s.messages.send(req.requireCtx(), req.params.id, req.body)));
  app.post('/threads/:id/read', { schema: { tags, params: pid, response: { 200: ok } } }, async (req) => { await s.messages.markRead(req.requireCtx(), req.params.id); return { ok: true as const }; });
  app.delete('/threads/:id/messages/:messageId', { schema: { tags, params: z.object({ id: z.uuid(), messageId: z.uuid() }), response: { 200: ok } } }, async (req) => { await s.messages.deleteMessage(req.requireCtx(), req.params.id, req.params.messageId); return { ok: true as const }; });
}
