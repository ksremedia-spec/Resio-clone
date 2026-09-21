import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const ok = z.object({ ok: z.literal(true) });
const tags = ['Clients'];

export async function clientRoutes(app: AppInstance, s: Services) {
  app.get('/clients', { schema: { tags, querystring: contracts.listClientsQuery, response: { 200: contracts.paginated(contracts.clientSchema) } } }, async (req) => s.clients.list(req.requireCtx(), req.query));
  app.post('/clients', { schema: { tags, body: contracts.createClientBody, response: { 201: contracts.clientSchema } } }, async (req, reply) => reply.status(201).send(await s.clients.create(req.requireCtx(), req.body)));
  app.get('/clients/:id', { schema: { tags, params: contracts.idParams, response: { 200: contracts.clientSchema } } }, async (req) => s.clients.get(req.requireCtx(), req.params.id));
  app.patch('/clients/:id', { schema: { tags, params: contracts.idParams, body: contracts.updateClientBody, response: { 200: contracts.clientSchema } } }, async (req) => s.clients.update(req.requireCtx(), req.params.id, req.body));
  app.post('/clients/:id/archive', { schema: { tags, params: contracts.idParams, body: z.object({ archived: z.boolean().default(true) }).nullish(), response: { 200: contracts.clientSchema } } }, async (req) => s.clients.archive(req.requireCtx(), req.params.id, req.body?.archived ?? true));
  app.post('/clients/:id/contacts', { schema: { tags, params: contracts.idParams, body: contracts.createContactBody, response: { 201: contracts.contactSchema } } }, async (req, reply) => reply.status(201).send(await s.clients.addContact(req.requireCtx(), req.params.id, req.body)));
  app.patch('/clients/:id/contacts/:contactId', { schema: { tags, params: z.object({ id: z.uuid(), contactId: z.uuid() }), body: contracts.updateContactBody, response: { 200: contracts.contactSchema } } }, async (req) => s.clients.updateContact(req.requireCtx(), req.params.id, req.params.contactId, req.body));
  app.delete('/clients/:id/contacts/:contactId', { schema: { tags, params: z.object({ id: z.uuid(), contactId: z.uuid() }), response: { 200: ok } } }, async (req) => { await s.clients.deleteContact(req.requireCtx(), req.params.id, req.params.contactId); return { ok: true as const }; });
}
