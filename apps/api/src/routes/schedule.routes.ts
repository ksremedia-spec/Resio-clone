import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const ok = z.object({ ok: z.literal(true) });
const tags = ['Schedule & Tasks'];
const pid = z.object({ id: z.uuid() });

export async function scheduleRoutes(app: AppInstance, s: Services) {
  app.get('/projects/:id/schedule', { schema: { tags, params: pid, response: { 200: contracts.scheduleResponse } } }, async (req) => s.schedule.schedule(req.requireCtx(), req.params.id));
  app.get('/projects/:id/phases', { schema: { tags, params: pid, response: { 200: z.array(contracts.phaseSchema) } } }, async (req) => s.schedule.listPhases(req.requireCtx(), req.params.id));
  app.post('/projects/:id/phases', { schema: { tags, params: pid, body: contracts.createPhaseBody, response: { 201: contracts.phaseSchema } } }, async (req, reply) => reply.status(201).send(await s.schedule.createPhase(req.requireCtx(), req.params.id, req.body)));
  app.patch('/projects/:id/phases/:phaseId', { schema: { tags, params: z.object({ id: z.uuid(), phaseId: z.uuid() }), body: contracts.updatePhaseBody, response: { 200: contracts.phaseSchema } } }, async (req) => s.schedule.updatePhase(req.requireCtx(), req.params.id, req.params.phaseId, req.body));
  app.delete('/projects/:id/phases/:phaseId', { schema: { tags, params: z.object({ id: z.uuid(), phaseId: z.uuid() }), response: { 200: ok } } }, async (req) => { await s.schedule.deletePhase(req.requireCtx(), req.params.id, req.params.phaseId); return { ok: true as const }; });

  app.get('/tasks', { schema: { tags, querystring: contracts.listTasksQuery, response: { 200: contracts.paginated(contracts.taskSchema) } } }, async (req) => s.schedule.listTasks(req.requireCtx(), req.query));
  app.get('/projects/:id/tasks', { schema: { tags, params: pid, querystring: contracts.listTasksQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.taskSchema) } } }, async (req) => s.schedule.listTasks(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/projects/:id/tasks', { schema: { tags, params: pid, body: contracts.createTaskBody, response: { 201: contracts.taskSchema } } }, async (req, reply) => reply.status(201).send(await s.schedule.createTask(req.requireCtx(), req.params.id, req.body)));
  app.get('/tasks/:id', { schema: { tags, params: pid, response: { 200: contracts.taskSchema } } }, async (req) => s.schedule.getTask(req.requireCtx(), req.params.id));
  app.patch('/tasks/:id', { schema: { tags, params: pid, body: contracts.updateTaskBody, response: { 200: contracts.taskSchema } } }, async (req) => s.schedule.updateTask(req.requireCtx(), req.params.id, req.body));
  app.delete('/tasks/:id', { schema: { tags, params: pid, response: { 200: ok } } }, async (req) => { await s.schedule.archiveTask(req.requireCtx(), req.params.id); return { ok: true as const }; });
  app.post('/tasks/:id/move', { schema: { tags, params: pid, body: contracts.moveTaskBody, response: { 200: contracts.moveTaskResponse } } }, async (req) => s.schedule.moveTask(req.requireCtx(), req.params.id, req.body));
  app.post('/tasks/:id/dependencies', { schema: { tags, params: pid, body: contracts.addDependencyBody, response: { 200: contracts.taskSchema } } }, async (req) => s.schedule.addDependency(req.requireCtx(), req.params.id, req.body));
  app.delete('/tasks/:id/dependencies/:depId', { schema: { tags, params: z.object({ id: z.uuid(), depId: z.uuid() }), response: { 200: contracts.taskSchema } } }, async (req) => s.schedule.removeDependency(req.requireCtx(), req.params.id, req.params.depId));
}
