import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const pid = z.object({ id: z.uuid() });
const ok = z.object({ ok: z.literal(true) });

export async function aiRoutes(app: AppInstance, s: Services) {
  const tags = ['AI assistant'];
  app.get('/ai/status', { schema: { tags, response: { 200: contracts.aiStatus } } }, async (req) => s.ai.status(req.requireCtx()));
  app.get('/ai/conversations', { schema: { tags, response: { 200: z.array(contracts.aiConversationSchema) } } }, async (req) => s.ai.listConversations(req.requireCtx()));
  app.post('/ai/conversations', { schema: { tags, body: contracts.createConversationBody.nullish(), response: { 201: contracts.aiConversationSchema } } }, async (req, reply) => reply.status(201).send(await s.ai.create(req.requireCtx(), req.body ?? {})));
  app.get('/ai/conversations/:id', { schema: { tags, params: pid, response: { 200: contracts.aiConversationSchema } } }, async (req) => s.ai.get(req.requireCtx(), req.params.id));
  app.delete('/ai/conversations/:id', { schema: { tags, params: pid, response: { 200: ok } } }, async (req) => { await s.ai.remove(req.requireCtx(), req.params.id); return { ok: true as const }; });
  app.post('/ai/conversations/:id/messages', { schema: { tags, params: pid, body: contracts.sendAiMessageBody, response: { 200: contracts.aiConversationSchema } } }, async (req) => s.ai.send(req.requireCtx(), req.params.id, req.body.content));
  app.post('/ai/conversations/:id/confirm', { schema: { tags, params: pid, body: contracts.confirmAiActionBody, response: { 200: contracts.aiConversationSchema } } }, async (req) => s.ai.confirm(req.requireCtx(), req.params.id, req.body));
}
