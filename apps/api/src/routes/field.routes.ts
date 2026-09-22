import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const pid = z.object({ id: z.uuid() });
const ok = z.object({ ok: z.literal(true) });

export async function fieldRoutes(app: AppInstance, s: Services) {
  // ---- time clock ----
  const t = ['Time'];
  app.get('/time/current', { schema: { tags: t, response: { 200: contracts.timeEntrySchema.nullable() } } }, async (req) => s.time.current(req.requireCtx()));
  app.post('/time/clock-in', { schema: { tags: t, body: contracts.clockInBody.nullish(), response: { 201: contracts.timeEntrySchema } } }, async (req, reply) => reply.status(201).send(await s.time.clockIn(req.requireCtx(), req.body ?? {})));
  app.post('/time/clock-out', { schema: { tags: t, body: contracts.clockOutBody.nullish(), response: { 200: contracts.timeEntrySchema } } }, async (req) => s.time.clockOut(req.requireCtx(), req.body ?? {}));
  app.post('/time/break/start', { schema: { tags: t, response: { 200: contracts.timeEntrySchema } } }, async (req) => s.time.startBreak(req.requireCtx()));
  app.post('/time/break/end', { schema: { tags: t, response: { 200: contracts.timeEntrySchema } } }, async (req) => s.time.endBreak(req.requireCtx()));
  app.get('/time/entries', { schema: { tags: t, querystring: contracts.listTimeQuery, response: { 200: contracts.paginated(contracts.timeEntrySchema) } } }, async (req) => s.time.list(req.requireCtx(), req.query));
  app.get('/projects/:id/time', { schema: { tags: t, params: pid, querystring: contracts.listTimeQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.timeEntrySchema) } } }, async (req) => s.time.list(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/time/entries', { schema: { tags: t, body: contracts.manualTimeEntryBody, response: { 201: contracts.timeEntrySchema } } }, async (req, reply) => reply.status(201).send(await s.time.create(req.requireCtx(), req.body)));
  app.get('/time/entries/:id', { schema: { tags: t, params: pid, response: { 200: contracts.timeEntrySchema } } }, async (req) => s.time.get(req.requireCtx(), req.params.id));
  app.patch('/time/entries/:id', { schema: { tags: t, params: pid, body: contracts.updateTimeEntryBody, response: { 200: contracts.timeEntrySchema } } }, async (req) => s.time.update(req.requireCtx(), req.params.id, req.body));
  app.post('/time/decide', { schema: { tags: t, body: contracts.timeDecisionBody, response: { 200: z.array(contracts.timeEntrySchema) } } }, async (req) => s.time.decide(req.requireCtx(), req.body));
  app.get('/time/timesheet', { schema: { tags: t, querystring: contracts.timesheetQuery, response: { 200: contracts.timesheetResponse } } }, async (req) => s.time.timesheet(req.requireCtx(), req.query));
  app.post('/time/payroll-export', { schema: { tags: t, body: contracts.payrollExportBody, response: { 200: z.object({ csv: z.string(), count: z.number().int() }) } } }, async (req) => s.time.payrollExport(req.requireCtx(), req.body));

  // ---- bid requests & vendor portal ----
  const b = ['Bids & vendor portal'];
  app.get('/bid-requests', { schema: { tags: b, querystring: contracts.listBidRequestsQuery, response: { 200: contracts.paginated(contracts.bidRequestSchema) } } }, async (req) => s.bids.list(req.requireCtx(), req.query));
  app.get('/projects/:id/bid-requests', { schema: { tags: b, params: pid, querystring: contracts.listBidRequestsQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.bidRequestSchema) } } }, async (req) => s.bids.list(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/projects/:id/bid-requests', { schema: { tags: b, params: pid, body: contracts.createBidRequestBody, response: { 201: contracts.bidRequestSchema } } }, async (req, reply) => reply.status(201).send(await s.bids.create(req.requireCtx(), req.params.id, req.body)));
  app.get('/bid-requests/:id', { schema: { tags: b, params: pid, response: { 200: contracts.bidRequestSchema } } }, async (req) => s.bids.get(req.requireCtx(), req.params.id));
  app.patch('/bid-requests/:id', { schema: { tags: b, params: pid, body: contracts.updateBidRequestBody, response: { 200: contracts.bidRequestSchema } } }, async (req) => s.bids.update(req.requireCtx(), req.params.id, req.body));
  app.post('/bid-requests/:id/send', { schema: { tags: b, params: pid, response: { 200: contracts.bidRequestSchema } } }, async (req) => s.bids.send(req.requireCtx(), req.params.id));
  app.post('/bid-requests/:id/bids', { schema: { tags: b, params: pid, body: contracts.submitBidBody.extend({ vendorId: z.uuid().optional() }), response: { 200: contracts.bidRequestSchema } } }, async (req) => s.bids.submitBid(req.requireCtx(), req.params.id, req.body));
  app.post('/bid-requests/:id/decline', { schema: { tags: b, params: pid, response: { 200: contracts.bidRequestSchema } } }, async (req) => s.bids.declineBid(req.requireCtx(), req.params.id));
  app.post('/bid-requests/:id/award', { schema: { tags: b, params: pid, body: contracts.awardBidBody, response: { 200: contracts.bidRequestSchema } } }, async (req) => s.bids.award(req.requireCtx(), req.params.id, req.body));
  app.post('/bid-requests/:id/close', { schema: { tags: b, params: pid, response: { 200: contracts.bidRequestSchema } } }, async (req) => s.bids.close(req.requireCtx(), req.params.id));
  app.get('/portal/vendor/overview', { schema: { tags: b, response: { 200: contracts.vendorOverview } } }, async (req) => s.bids.vendorOverview(req.requireCtx()));
  app.post('/purchase-orders/:id/acknowledge', { schema: { tags: b, params: pid, response: { 200: ok } } }, async (req) => s.bids.acknowledgePurchaseOrder(req.requireCtx(), req.params.id));
}
