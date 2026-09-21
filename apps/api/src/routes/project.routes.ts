import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const tags = ['Projects'];

export async function projectRoutes(app: AppInstance, s: Services) {
  app.get('/projects', { schema: { tags, querystring: contracts.listProjectsQuery, response: { 200: contracts.paginated(contracts.projectSummary) } } }, async (req) => s.projects.list(req.requireCtx(), req.query));
  app.post('/projects', { schema: { tags, body: contracts.createProjectBody, response: { 201: contracts.projectDetail } } }, async (req, reply) => reply.status(201).send(await s.projects.create(req.requireCtx(), req.body)));
  app.get('/projects/:id', { schema: { tags, params: contracts.idParams, response: { 200: contracts.projectDetail } } }, async (req) => s.projects.get(req.requireCtx(), req.params.id));
  app.patch('/projects/:id', { schema: { tags, params: contracts.idParams, body: contracts.updateProjectBody.extend({ expectedVersion: z.number().int().optional() }), response: { 200: contracts.projectDetail } } }, async (req) => s.projects.update(req.requireCtx(), req.params.id, req.body));
  app.post('/projects/:id/archive', { schema: { tags, params: contracts.idParams, body: z.object({ archived: z.boolean().default(true) }).nullish(), response: { 200: contracts.projectDetail } } }, async (req) => s.projects.archive(req.requireCtx(), req.params.id, req.body?.archived ?? true));
  app.post('/projects/:id/favorite', { schema: { tags, params: contracts.idParams, body: z.object({ favorite: z.boolean() }), response: { 200: z.object({ isFavorite: z.boolean() }) } } }, async (req) => s.projects.setFavorite(req.requireCtx(), req.params.id, req.body.favorite));
  app.post('/projects/:id/members', { schema: { tags, params: contracts.idParams, body: contracts.addProjectMemberBody, response: { 200: z.array(contracts.projectMemberSchema) } } }, async (req) => s.projects.addMember(req.requireCtx(), req.params.id, req.body));
  app.delete('/projects/:id/members/:memberId', { schema: { tags, params: z.object({ id: z.uuid(), memberId: z.uuid() }), response: { 200: z.array(contracts.projectMemberSchema) } } }, async (req) => s.projects.removeMember(req.requireCtx(), req.params.id, req.params.memberId));
  app.get('/projects/:id/activity', { schema: { tags, params: contracts.idParams, querystring: contracts.listActivityQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.activityEntry) } } }, async (req) => s.activity.list(req.requireCtx(), { ...req.query, projectId: req.params.id }));
}
