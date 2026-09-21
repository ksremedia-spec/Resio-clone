import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const ok = z.object({ ok: z.literal(true) });
const tags = ['Daily Logs'];
const pid = z.object({ id: z.uuid() });

export async function dailyLogRoutes(app: AppInstance, s: Services) {
  app.get('/daily-logs', { schema: { tags, querystring: contracts.listDailyLogsQuery, response: { 200: contracts.paginated(contracts.dailyLogSchema) } } }, async (req) => s.dailyLogs.list(req.requireCtx(), req.query));
  app.get('/projects/:id/daily-logs', { schema: { tags, params: pid, querystring: contracts.listDailyLogsQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.dailyLogSchema) } } }, async (req) => s.dailyLogs.list(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/projects/:id/daily-logs', { schema: { tags, params: pid, body: contracts.createDailyLogBody, response: { 201: contracts.dailyLogSchema } } }, async (req, reply) => reply.status(201).send(await s.dailyLogs.create(req.requireCtx(), req.params.id, req.body)));
  app.get('/daily-logs/:id', { schema: { tags, params: pid, response: { 200: contracts.dailyLogSchema } } }, async (req) => s.dailyLogs.get(req.requireCtx(), req.params.id));
  app.patch('/daily-logs/:id', { schema: { tags, params: pid, body: contracts.updateDailyLogBody, response: { 200: contracts.dailyLogSchema } } }, async (req) => s.dailyLogs.update(req.requireCtx(), req.params.id, req.body));
  app.delete('/daily-logs/:id', { schema: { tags, params: pid, response: { 200: ok } } }, async (req) => { await s.dailyLogs.archive(req.requireCtx(), req.params.id); return { ok: true as const }; });
}
