import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const pid = z.object({ id: z.uuid() });
const ok = z.object({ ok: z.literal(true) });

export async function advancedRoutes(app: AppInstance, s: Services) {
  // ---- leads / CRM ----
  const l = ['Leads'];
  app.get('/leads', { schema: { tags: l, querystring: contracts.listLeadsQuery, response: { 200: contracts.paginated(contracts.leadSchema) } } }, async (req) => s.leads.list(req.requireCtx(), req.query));
  app.get('/leads/board', { schema: { tags: l, response: { 200: contracts.leadBoardResponse } } }, async (req) => s.leads.board(req.requireCtx()));
  app.post('/leads', { schema: { tags: l, body: contracts.createLeadBody, response: { 201: contracts.leadSchema } } }, async (req, reply) => reply.status(201).send(await s.leads.create(req.requireCtx(), req.body)));
  app.get('/leads/:id', { schema: { tags: l, params: pid, response: { 200: contracts.leadSchema } } }, async (req) => s.leads.get(req.requireCtx(), req.params.id));
  app.patch('/leads/:id', { schema: { tags: l, params: pid, body: contracts.updateLeadBody, response: { 200: contracts.leadSchema } } }, async (req) => s.leads.update(req.requireCtx(), req.params.id, req.body));
  app.post('/leads/:id/move', { schema: { tags: l, params: pid, body: contracts.moveLeadBody, response: { 200: contracts.leadSchema } } }, async (req) => s.leads.move(req.requireCtx(), req.params.id, req.body));
  app.post('/leads/:id/activities', { schema: { tags: l, params: pid, body: contracts.leadActivityBody, response: { 201: contracts.leadSchema } } }, async (req, reply) => reply.status(201).send(await s.leads.addActivity(req.requireCtx(), req.params.id, req.body)));
  app.post('/leads/:id/activities/:activityId/complete', { schema: { tags: l, params: z.object({ id: z.uuid(), activityId: z.uuid() }), response: { 200: contracts.leadSchema } } }, async (req) => s.leads.completeActivity(req.requireCtx(), req.params.id, req.params.activityId));
  app.post('/leads/:id/convert', { schema: { tags: l, params: pid, body: contracts.convertLeadBody.nullish(), response: { 200: z.object({ lead: contracts.leadSchema, project: contracts.projectDetail }) } } }, async (req) => s.leads.convert(req.requireCtx(), req.params.id, req.body ?? {}));
  app.post('/leads/:id/archive', { schema: { tags: l, params: pid, body: z.object({ archived: z.boolean().default(true) }).nullish(), response: { 200: contracts.leadSchema } } }, async (req) => s.leads.archive(req.requireCtx(), req.params.id, req.body?.archived ?? true));

  // ---- reports ----
  const r = ['Reports'];
  app.get('/reports', { schema: { tags: r, response: { 200: z.array(contracts.reportCatalogEntry) } } }, async (req) => s.reports.catalog(req.requireCtx()));
  app.get('/reports/:key', { schema: { tags: r, params: z.object({ key: z.enum(contracts.REPORT_KEYS) }), querystring: contracts.reportQuery } }, async (req, reply) => {
    const out = await s.reports.run(req.requireCtx(), req.params.key, req.query);
    if (req.query.format === 'csv') return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${out.filename}"`).send(out.csv);
    return out.json;
  });

  // ---- automations ----
  const a = ['Automations'];
  app.get('/automations', { schema: { tags: a, response: { 200: z.array(contracts.automationSchema) } } }, async (req) => s.automations.list(req.requireCtx()));
  app.get('/automations/catalog', { schema: { tags: a, response: { 200: contracts.automationCatalog } } }, async (req) => s.automations.catalog(req.requireCtx()));
  app.get('/automations/runs', { schema: { tags: a, querystring: contracts.listAutomationRunsQuery, response: { 200: contracts.paginated(contracts.automationRunSchema) } } }, async (req) => s.automations.listRuns(req.requireCtx(), req.query));
  app.post('/automations/run-scheduled', { schema: { tags: a, response: { 200: contracts.runScheduledResponse } } }, async (req) => s.automations.runScheduled(req.requireCtx()));
  app.post('/automations', { schema: { tags: a, body: contracts.createAutomationBody, response: { 201: contracts.automationSchema } } }, async (req, reply) => reply.status(201).send(await s.automations.create(req.requireCtx(), req.body)));
  app.get('/automations/:id', { schema: { tags: a, params: pid, response: { 200: contracts.automationSchema } } }, async (req) => s.automations.get(req.requireCtx(), req.params.id));
  app.patch('/automations/:id', { schema: { tags: a, params: pid, body: contracts.updateAutomationBody, response: { 200: contracts.automationSchema } } }, async (req) => s.automations.update(req.requireCtx(), req.params.id, req.body));
  app.delete('/automations/:id', { schema: { tags: a, params: pid, response: { 200: ok } } }, async (req) => { await s.automations.remove(req.requireCtx(), req.params.id); return { ok: true as const }; });
}
