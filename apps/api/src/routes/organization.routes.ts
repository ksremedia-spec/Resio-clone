import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const ok = z.object({ ok: z.literal(true) });

export async function organizationRoutes(app: AppInstance, s: Services) {
  app.get('/organization', { schema: { tags: ['Organization'], response: { 200: contracts.organizationDetail } } }, async (req) => s.organizations.get(req.requireCtx()));
  app.patch('/organization', { schema: { tags: ['Organization'], body: contracts.updateOrganizationBody, response: { 200: contracts.organizationDetail } } }, async (req) => s.organizations.update(req.requireCtx(), req.body));

  app.get('/roles', { schema: { tags: ['Roles'], response: { 200: z.array(contracts.roleSchema) } } }, async (req) => s.organizations.listRoles(req.requireCtx()));
  app.get('/permissions', { schema: { tags: ['Roles'], response: { 200: z.array(z.string()) } } }, async (req) => { req.requireCtx(); return [...contracts.PERMISSIONS_LIST]; });
  app.post('/roles', { schema: { tags: ['Roles'], body: contracts.createRoleBody, response: { 201: contracts.roleSchema } } }, async (req, reply) => reply.status(201).send(await s.organizations.createRole(req.requireCtx(), req.body)));
  app.patch('/roles/:id', { schema: { tags: ['Roles'], params: contracts.idParams, body: contracts.updateRoleBody, response: { 200: contracts.roleSchema } } }, async (req) => s.organizations.updateRole(req.requireCtx(), req.params.id, req.body));
  app.delete('/roles/:id', { schema: { tags: ['Roles'], params: contracts.idParams, response: { 200: ok } } }, async (req) => { await s.organizations.deleteRole(req.requireCtx(), req.params.id); return { ok: true as const }; });

  app.get('/members', { schema: { tags: ['Members'], response: { 200: z.array(contracts.memberSchema) } } }, async (req) => s.organizations.listMembers(req.requireCtx()));
  app.patch('/members/:id', { schema: { tags: ['Members'], params: contracts.idParams, body: contracts.updateMemberBody, response: { 200: contracts.memberSchema } } }, async (req) => s.organizations.updateMember(req.requireCtx(), req.params.id, req.body));

  app.get('/invitations', { schema: { tags: ['Members'], response: { 200: z.array(contracts.invitationSchema) } } }, async (req) => s.organizations.listInvitations(req.requireCtx()));
  app.post('/invitations', { schema: { tags: ['Members'], body: contracts.createInvitationBody, response: { 201: contracts.invitationSchema } } }, async (req, reply) => reply.status(201).send(await s.organizations.invite(req.requireCtx(), req.body)));
  app.delete('/invitations/:id', { schema: { tags: ['Members'], params: contracts.idParams, response: { 200: ok } } }, async (req) => { await s.organizations.revokeInvitation(req.requireCtx(), req.params.id); return { ok: true as const }; });
}
