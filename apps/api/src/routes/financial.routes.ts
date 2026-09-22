import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const ok = z.object({ ok: z.literal(true) });
const pid = z.object({ id: z.uuid() });
const archiveBody = z.object({ archived: z.boolean().default(true) }).nullish();
const includeArchived = z.object({ includeArchived: z.coerce.boolean().default(false) });

export async function financialRoutes(app: AppInstance, s: Services) {
  // ---- cost codes, catalog, vendors ----
  const est = ['Estimating'];
  app.get('/cost-codes', { schema: { tags: est, querystring: includeArchived, response: { 200: z.array(contracts.costCodeSchema) } } }, async (req) => s.catalog.listCostCodes(req.requireCtx(), req.query.includeArchived));
  app.post('/cost-codes', { schema: { tags: est, body: contracts.createCostCodeBody, response: { 201: contracts.costCodeSchema } } }, async (req, reply) => reply.status(201).send(await s.catalog.createCostCode(req.requireCtx(), req.body)));
  app.patch('/cost-codes/:id', { schema: { tags: est, params: pid, body: contracts.updateCostCodeBody, response: { 200: contracts.costCodeSchema } } }, async (req) => s.catalog.updateCostCode(req.requireCtx(), req.params.id, req.body));
  app.post('/cost-codes/:id/archive', { schema: { tags: est, params: pid, body: archiveBody, response: { 200: contracts.costCodeSchema } } }, async (req) => s.catalog.archiveCostCode(req.requireCtx(), req.params.id, req.body?.archived ?? true));
  app.get('/catalog', { schema: { tags: est, querystring: contracts.listCatalogQuery, response: { 200: contracts.paginated(contracts.catalogItemSchema) } } }, async (req) => s.catalog.listCatalog(req.requireCtx(), req.query));
  app.post('/catalog', { schema: { tags: est, body: contracts.createCatalogItemBody, response: { 201: contracts.catalogItemSchema } } }, async (req, reply) => reply.status(201).send(await s.catalog.createCatalogItem(req.requireCtx(), req.body)));
  app.patch('/catalog/:id', { schema: { tags: est, params: pid, body: contracts.updateCatalogItemBody, response: { 200: contracts.catalogItemSchema } } }, async (req) => s.catalog.updateCatalogItem(req.requireCtx(), req.params.id, req.body));
  app.post('/catalog/:id/archive', { schema: { tags: est, params: pid, body: archiveBody, response: { 200: contracts.catalogItemSchema } } }, async (req) => s.catalog.archiveCatalogItem(req.requireCtx(), req.params.id, req.body?.archived ?? true));
  const ven = ['Vendors'];
  app.get('/vendors', { schema: { tags: ven, querystring: contracts.listVendorsQuery, response: { 200: contracts.paginated(contracts.vendorSchema) } } }, async (req) => s.catalog.listVendors(req.requireCtx(), req.query));
  app.post('/vendors', { schema: { tags: ven, body: contracts.createVendorBody, response: { 201: contracts.vendorSchema } } }, async (req, reply) => reply.status(201).send(await s.catalog.createVendor(req.requireCtx(), req.body)));
  app.get('/vendors/:id', { schema: { tags: ven, params: pid, response: { 200: contracts.vendorSchema } } }, async (req) => s.catalog.getVendor(req.requireCtx(), req.params.id));
  app.patch('/vendors/:id', { schema: { tags: ven, params: pid, body: contracts.updateVendorBody, response: { 200: contracts.vendorSchema } } }, async (req) => s.catalog.updateVendor(req.requireCtx(), req.params.id, req.body));
  app.post('/vendors/:id/archive', { schema: { tags: ven, params: pid, body: archiveBody, response: { 200: contracts.vendorSchema } } }, async (req) => s.catalog.archiveVendor(req.requireCtx(), req.params.id, req.body?.archived ?? true));

  // ---- estimates ----
  app.get('/projects/:id/estimate', { schema: { tags: est, params: pid, response: { 200: contracts.estimateSchema } } }, async (req) => s.estimates.getForProject(req.requireCtx(), req.params.id));
  app.patch('/projects/:id/estimate', { schema: { tags: est, params: pid, body: contracts.updateEstimateBody, response: { 200: contracts.estimateSchema } } }, async (req) => s.estimates.update(req.requireCtx(), req.params.id, req.body));
  app.post('/projects/:id/estimate/sections', { schema: { tags: est, params: pid, body: contracts.createSectionBody, response: { 201: contracts.estimateSchema } } }, async (req, reply) => reply.status(201).send(await s.estimates.createSection(req.requireCtx(), req.params.id, req.body)));
  app.patch('/projects/:id/estimate/sections/:sectionId', { schema: { tags: est, params: z.object({ id: z.uuid(), sectionId: z.uuid() }), body: contracts.updateSectionBody, response: { 200: contracts.estimateSchema } } }, async (req) => s.estimates.updateSection(req.requireCtx(), req.params.id, req.params.sectionId, req.body));
  app.delete('/projects/:id/estimate/sections/:sectionId', { schema: { tags: est, params: z.object({ id: z.uuid(), sectionId: z.uuid() }), response: { 200: contracts.estimateSchema } } }, async (req) => s.estimates.deleteSection(req.requireCtx(), req.params.id, req.params.sectionId));
  app.post('/projects/:id/estimate/lines', { schema: { tags: est, params: pid, body: contracts.createLineBody, response: { 201: contracts.estimateSchema } } }, async (req, reply) => reply.status(201).send(await s.estimates.createLine(req.requireCtx(), req.params.id, req.body)));
  app.patch('/projects/:id/estimate/lines', { schema: { tags: est, params: pid, body: contracts.bulkLinesBody, response: { 200: contracts.estimateSchema } } }, async (req) => s.estimates.updateLines(req.requireCtx(), req.params.id, req.body.lines as Array<{ id: string } & Record<string, unknown>>));
  app.patch('/projects/:id/estimate/lines/:lineId', { schema: { tags: est, params: z.object({ id: z.uuid(), lineId: z.uuid() }), body: contracts.updateLineBody, response: { 200: contracts.estimateSchema } } }, async (req) => s.estimates.updateLines(req.requireCtx(), req.params.id, [{ id: req.params.lineId, ...req.body }]));
  app.delete('/projects/:id/estimate/lines/:lineId', { schema: { tags: est, params: z.object({ id: z.uuid(), lineId: z.uuid() }), response: { 200: contracts.estimateSchema } } }, async (req) => s.estimates.deleteLine(req.requireCtx(), req.params.id, req.params.lineId));
  app.post('/projects/:id/estimate/lock', { schema: { tags: est, params: pid, body: contracts.lockEstimateBody.nullish(), response: { 200: contracts.estimateSchema } } }, async (req) => s.estimates.lock(req.requireCtx(), req.params.id, { applyContractValue: req.body?.applyContractValue ?? true }));
  app.post('/projects/:id/estimate/unlock', { schema: { tags: est, params: pid, response: { 200: contracts.estimateSchema } } }, async (req) => s.estimates.unlock(req.requireCtx(), req.params.id));

  // ---- budget ----
  const bud = ['Budget'];
  app.get('/budget/overview', { schema: { tags: bud, response: { 200: z.array(z.object({ projectId: z.uuid(), projectNumber: z.string(), projectName: z.string(), status: z.string(), totals: contracts.budgetSchema.shape.totals, contract: contracts.budgetSchema.shape.contract })) } } }, async (req) => s.budget.overview(req.requireCtx()));
  app.get('/projects/:id/budget', { schema: { tags: bud, params: pid, response: { 200: contracts.budgetSchema } } }, async (req) => s.budget.get(req.requireCtx(), req.params.id));
  app.post('/projects/:id/budget/lines', { schema: { tags: bud, params: pid, body: contracts.createBudgetLineBody, response: { 201: contracts.budgetSchema } } }, async (req, reply) => reply.status(201).send(await s.budget.createLine(req.requireCtx(), req.params.id, req.body)));
  app.patch('/projects/:id/budget/lines/:lineId', { schema: { tags: bud, params: z.object({ id: z.uuid(), lineId: z.uuid() }), body: contracts.updateBudgetLineBody, response: { 200: contracts.budgetSchema } } }, async (req) => s.budget.updateLine(req.requireCtx(), req.params.id, req.params.lineId, req.body));
  app.get('/projects/:id/budget/lines/:lineId', { schema: { tags: bud, params: z.object({ id: z.uuid(), lineId: z.uuid() }), response: { 200: contracts.budgetLineDetail } } }, async (req) => s.budget.lineDetail(req.requireCtx(), req.params.id, req.params.lineId));

  // ---- purchase orders & bills ----
  const pur = ['Purchasing'];
  app.get('/purchase-orders', { schema: { tags: pur, querystring: contracts.listPurchaseOrdersQuery, response: { 200: contracts.paginated(contracts.purchaseOrderSchema) } } }, async (req) => s.procurement.listPurchaseOrders(req.requireCtx(), req.query));
  app.get('/projects/:id/purchase-orders', { schema: { tags: pur, params: pid, querystring: contracts.listPurchaseOrdersQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.purchaseOrderSchema) } } }, async (req) => s.procurement.listPurchaseOrders(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/projects/:id/purchase-orders', { schema: { tags: pur, params: pid, body: contracts.createPurchaseOrderBody, response: { 201: contracts.purchaseOrderSchema } } }, async (req, reply) => reply.status(201).send(await s.procurement.createPurchaseOrder(req.requireCtx(), req.params.id, req.body)));
  app.get('/purchase-orders/:id', { schema: { tags: pur, params: pid, response: { 200: contracts.purchaseOrderSchema } } }, async (req) => s.procurement.getPurchaseOrder(req.requireCtx(), req.params.id));
  app.patch('/purchase-orders/:id', { schema: { tags: pur, params: pid, body: contracts.updatePurchaseOrderBody, response: { 200: contracts.purchaseOrderSchema } } }, async (req) => s.procurement.updatePurchaseOrder(req.requireCtx(), req.params.id, req.body));
  app.post('/purchase-orders/:id/transition', { schema: { tags: pur, params: pid, body: contracts.poTransitionBody, response: { 200: contracts.purchaseOrderSchema } } }, async (req) => s.procurement.transitionPurchaseOrder(req.requireCtx(), req.params.id, req.body.action));
  app.get('/bills', { schema: { tags: pur, querystring: contracts.listBillsQuery, response: { 200: contracts.paginated(contracts.billSchema) } } }, async (req) => s.procurement.listBills(req.requireCtx(), req.query));
  app.get('/projects/:id/bills', { schema: { tags: pur, params: pid, querystring: contracts.listBillsQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.billSchema) } } }, async (req) => s.procurement.listBills(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/bills', { schema: { tags: pur, body: contracts.createBillBody, response: { 201: contracts.billSchema } } }, async (req, reply) => reply.status(201).send(await s.procurement.createBill(req.requireCtx(), req.body)));
  app.get('/bills/:id', { schema: { tags: pur, params: pid, response: { 200: contracts.billSchema } } }, async (req) => s.procurement.getBill(req.requireCtx(), req.params.id));
  app.patch('/bills/:id', { schema: { tags: pur, params: pid, body: contracts.updateBillBody, response: { 200: contracts.billSchema } } }, async (req) => s.procurement.updateBill(req.requireCtx(), req.params.id, req.body));
  app.post('/bills/:id/transition', { schema: { tags: pur, params: pid, body: contracts.billTransitionBody, response: { 200: contracts.billSchema } } }, async (req) => s.procurement.transitionBill(req.requireCtx(), req.params.id, req.body.action));
  app.post('/bills/:id/payments', { schema: { tags: pur, params: pid, body: contracts.recordBillPaymentBody, response: { 201: contracts.billSchema } } }, async (req, reply) => reply.status(201).send(await s.procurement.recordBillPayment(req.requireCtx(), req.params.id, req.body)));

  // ---- change orders ----
  const co = ['Change Orders'];
  app.get('/change-orders', { schema: { tags: co, querystring: contracts.listChangeOrdersQuery, response: { 200: contracts.paginated(contracts.changeOrderSchema) } } }, async (req) => s.changeOrders.list(req.requireCtx(), req.query));
  app.get('/projects/:id/change-orders', { schema: { tags: co, params: pid, querystring: contracts.listChangeOrdersQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.changeOrderSchema) } } }, async (req) => s.changeOrders.list(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/projects/:id/change-orders', { schema: { tags: co, params: pid, body: contracts.createChangeOrderBody, response: { 201: contracts.changeOrderSchema } } }, async (req, reply) => reply.status(201).send(await s.changeOrders.create(req.requireCtx(), req.params.id, req.body)));
  app.get('/change-orders/:id', { schema: { tags: co, params: pid, response: { 200: contracts.changeOrderSchema } } }, async (req) => s.changeOrders.get(req.requireCtx(), req.params.id));
  app.patch('/change-orders/:id', { schema: { tags: co, params: pid, body: contracts.updateChangeOrderBody, response: { 200: contracts.changeOrderSchema } } }, async (req) => s.changeOrders.update(req.requireCtx(), req.params.id, req.body));
  app.post('/change-orders/:id/send', { schema: { tags: co, params: pid, body: contracts.sendChangeOrderBody.nullish(), response: { 200: contracts.changeOrderSchema } } }, async (req) => s.changeOrders.send(req.requireCtx(), req.params.id, req.body ?? {}));
  app.post('/change-orders/:id/decide', { schema: { tags: co, params: pid, body: contracts.decideChangeOrderBody, response: { 200: contracts.changeOrderSchema } } }, async (req) => s.changeOrders.decide(req.requireCtx(), req.params.id, req.body));
  app.post('/change-orders/:id/void', { schema: { tags: co, params: pid, response: { 200: contracts.changeOrderSchema } } }, async (req) => s.changeOrders.void(req.requireCtx(), req.params.id));

  // ---- invoices & payments ----
  const inv = ['Invoices'];
  app.get('/invoices', { schema: { tags: inv, querystring: contracts.listInvoicesQuery, response: { 200: contracts.paginated(contracts.invoiceSchema) } } }, async (req) => s.invoices.list(req.requireCtx(), req.query));
  app.get('/projects/:id/invoices', { schema: { tags: inv, params: pid, querystring: contracts.listInvoicesQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.invoiceSchema) } } }, async (req) => s.invoices.list(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/projects/:id/invoices', { schema: { tags: inv, params: pid, body: contracts.createInvoiceBody, response: { 201: contracts.invoiceSchema } } }, async (req, reply) => reply.status(201).send(await s.invoices.create(req.requireCtx(), req.params.id, req.body)));
  app.get('/invoices/:id', { schema: { tags: inv, params: pid, response: { 200: contracts.invoiceSchema } } }, async (req) => s.invoices.get(req.requireCtx(), req.params.id));
  app.patch('/invoices/:id', { schema: { tags: inv, params: pid, body: contracts.updateInvoiceBody, response: { 200: contracts.invoiceSchema } } }, async (req) => s.invoices.update(req.requireCtx(), req.params.id, req.body));
  app.post('/invoices/:id/transition', { schema: { tags: inv, params: pid, body: contracts.invoiceTransitionBody, response: { 200: contracts.invoiceSchema } } }, async (req) => s.invoices.transition(req.requireCtx(), req.params.id, req.body.action));
  app.post('/invoices/:id/payments', { schema: { tags: inv, params: pid, body: contracts.recordPaymentBody, response: { 201: contracts.invoiceSchema } } }, async (req, reply) => reply.status(201).send(await s.invoices.recordPayment(req.requireCtx(), req.params.id, req.body)));
  app.delete('/invoices/:id/payments/:paymentId', { schema: { tags: inv, params: z.object({ id: z.uuid(), paymentId: z.uuid() }), response: { 200: contracts.invoiceSchema } } }, async (req) => s.invoices.voidPayment(req.requireCtx(), req.params.id, req.params.paymentId));
  app.post('/invoices/:id/pay', { schema: { tags: inv, params: pid, body: contracts.payInvoiceBody.nullish(), response: { 200: contracts.paymentIntentResponse } } }, async (req) => s.invoices.payOnline(req.requireCtx(), req.params.id, req.body?.method ?? 'card'));

  // ---- proposals, selections, approvals, portal ----
  const por = ['Client experience'];
  app.get('/proposals', { schema: { tags: por, querystring: contracts.listProposalsQuery, response: { 200: contracts.paginated(contracts.proposalSchema) } } }, async (req) => s.proposals.list(req.requireCtx(), req.query));
  app.get('/projects/:id/proposals', { schema: { tags: por, params: pid, querystring: contracts.listProposalsQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.proposalSchema) } } }, async (req) => s.proposals.list(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/projects/:id/proposals', { schema: { tags: por, params: pid, body: contracts.createProposalBody, response: { 201: contracts.proposalSchema } } }, async (req, reply) => reply.status(201).send(await s.proposals.create(req.requireCtx(), req.params.id, req.body)));
  app.get('/proposals/:id', { schema: { tags: por, params: pid, response: { 200: contracts.proposalSchema } } }, async (req) => s.proposals.get(req.requireCtx(), req.params.id));
  app.patch('/proposals/:id', { schema: { tags: por, params: pid, body: contracts.updateProposalBody.extend({ refreshSnapshot: z.boolean().optional() }), response: { 200: contracts.proposalSchema } } }, async (req) => s.proposals.update(req.requireCtx(), req.params.id, req.body));
  app.post('/proposals/:id/send', { schema: { tags: por, params: pid, body: contracts.sendProposalBody.nullish(), response: { 200: contracts.proposalSchema } } }, async (req) => s.proposals.send(req.requireCtx(), req.params.id, req.body ?? {}));
  app.post('/proposals/:id/decide', { schema: { tags: por, params: pid, body: contracts.decideProposalBody, response: { 200: contracts.proposalSchema } } }, async (req) => s.proposals.decide(req.requireCtx(), req.params.id, req.body));
  app.post('/proposals/:id/void', { schema: { tags: por, params: pid, response: { 200: contracts.proposalSchema } } }, async (req) => s.proposals.void(req.requireCtx(), req.params.id));
  app.get('/selections', { schema: { tags: por, querystring: contracts.listSelectionsQuery, response: { 200: contracts.paginated(contracts.selectionSchema) } } }, async (req) => s.selections.list(req.requireCtx(), req.query));
  app.get('/projects/:id/selections', { schema: { tags: por, params: pid, querystring: contracts.listSelectionsQuery.omit({ projectId: true }), response: { 200: contracts.paginated(contracts.selectionSchema) } } }, async (req) => s.selections.list(req.requireCtx(), { ...req.query, projectId: req.params.id }));
  app.post('/projects/:id/selections', { schema: { tags: por, params: pid, body: contracts.createSelectionBody, response: { 201: contracts.selectionSchema } } }, async (req, reply) => reply.status(201).send(await s.selections.create(req.requireCtx(), req.params.id, req.body)));
  app.get('/selections/:id', { schema: { tags: por, params: pid, response: { 200: contracts.selectionSchema } } }, async (req) => s.selections.get(req.requireCtx(), req.params.id));
  app.patch('/selections/:id', { schema: { tags: por, params: pid, body: contracts.updateSelectionBody, response: { 200: contracts.selectionSchema } } }, async (req) => s.selections.update(req.requireCtx(), req.params.id, req.body));
  app.post('/selections/:id/release', { schema: { tags: por, params: pid, response: { 200: contracts.selectionSchema } } }, async (req) => s.selections.release(req.requireCtx(), req.params.id));
  app.post('/selections/:id/decide', { schema: { tags: por, params: pid, body: contracts.decideSelectionBody, response: { 200: contracts.selectionSchema } } }, async (req) => s.selections.decide(req.requireCtx(), req.params.id, req.body));
  app.post('/selections/:id/void', { schema: { tags: por, params: pid, response: { 200: contracts.selectionSchema } } }, async (req) => s.selections.void(req.requireCtx(), req.params.id));
  app.get('/approvals', { schema: { tags: por, querystring: contracts.listApprovalsQuery, response: { 200: contracts.paginated(contracts.approvalItem) } } }, async (req) => s.portal.listApprovals(req.requireCtx(), req.query));
  app.get('/portal/overview', { schema: { tags: por, response: { 200: contracts.portalOverview } } }, async (req) => s.portal.overview(req.requireCtx()));
  void ok;
}
