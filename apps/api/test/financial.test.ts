import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createProject, createTestApp, inviteMember, registerOrg, type Actor, type TestApp } from './helpers.js';

let app: TestApp;
let owner: Actor;
beforeAll(async () => { app = await createTestApp(); owner = await registerOrg(app, { org: 'Financial Co' }); });
afterAll(async () => { await app.close(); });

/** Build a small two-section estimate and lock it: returns the project, estimate and budget. */
async function estimateAndLock(actor: Actor, overrides: Record<string, unknown> = {}) {
  const c = api(app, actor);
  const project = await createProject(app, actor, { name: 'Estimate House', contractValueCents: 0, ...overrides });
  const est0 = await c.get(`/v1/projects/${project.id}/estimate`);
  expect(est0.status).toBe(200);
  expect(est0.body.status).toBe('draft');
  expect(est0.body.defaultMarkupBp).toBe(2000);
  await c.patch(`/v1/projects/${project.id}/estimate`, { taxBp: 825 });
  const demo = (await c.post(`/v1/projects/${project.id}/estimate/sections`, { name: 'Demolition' })).body.sections[0];
  const kitchen = (await c.post(`/v1/projects/${project.id}/estimate/sections`, { name: 'Kitchen' })).body.sections[1];
  await c.post(`/v1/projects/${project.id}/estimate/lines`, { sectionId: demo.id, name: 'Demo existing kitchen', unitCostCents: { labor: 250_000 } });
  await c.post(`/v1/projects/${project.id}/estimate/lines`, { sectionId: kitchen.id, name: 'Cabinets', quantityThousandths: 12_000, unit: 'lf', unitCostCents: { material: 45_000, labor: 8_000 }, taxable: true });
  const est = (await c.post(`/v1/projects/${project.id}/estimate/lines`, { sectionId: kitchen.id, name: 'Countertops allowance', unitCostCents: { material: 600_000 }, isAllowance: true })).body;
  return { project, estimate: est, sections: { demo, kitchen } };
}

describe('estimates → budget', () => {
  it('prices lines with markup and tax, then locking creates the budget and sets the contract value', async () => {
    const c = api(app, owner);
    const { project, estimate } = await estimateAndLock(owner);
    // Demo: 2,500 labor × 20% markup = 3,000 sell, no tax.
    const demoLine = estimate.sections[0].lines[0];
    expect(demoLine.totals).toMatchObject({ directCostCents: 250_000, markupCents: 50_000, sellBeforeTaxCents: 300_000, taxCents: 0, sellCents: 300_000 });
    // Cabinets: 12 lf × (450 + 80) = 6,360 cost; +20% = 7,632; tax 8.25% = 629.64 → 63,0 cents rounding half up.
    const cab = estimate.sections[1].lines[0];
    expect(cab.totals.directCostCents).toBe(636_000);
    expect(cab.totals.markupCents).toBe(127_200);
    expect(cab.totals.taxCents).toBe(62_964);
    expect(cab.totals.sellCents).toBe(826_164);
    expect(estimate.totals.directCostCents).toBe(250_000 + 636_000 + 600_000);
    expect(estimate.totals.allowanceCents).toBe(720_000);
    expect(estimate.totals.grossMarginBp).toBeGreaterThan(1600);

    const locked = await c.post(`/v1/projects/${project.id}/estimate/lock`, { applyContractValue: true });
    expect(locked.status).toBe(200);
    expect(locked.body.status).toBe('locked');
    const detail = await c.get(`/v1/projects/${project.id}`);
    expect(detail.body.financials.contractValueCents).toBe(locked.body.totals.sellCents);

    const budget = await c.get(`/v1/projects/${project.id}/budget`);
    expect(budget.status).toBe(200);
    expect(budget.body.lines).toHaveLength(3);
    expect(budget.body.lines.map((l: any) => l.sectionName)).toEqual(['Demolition', 'Kitchen', 'Kitchen']);
    expect(budget.body.totals.originalCents).toBe(1_486_000);
    expect(budget.body.totals.revisedCents).toBe(1_486_000);
    expect(budget.body.totals.status).toBe('under');
    expect(budget.body.contract.revisedContractCents).toBe(locked.body.totals.sellCents);

    // Locked estimates are read-only until unlocked; re-locking refreshes the same budget lines instead of duplicating them.
    const blocked = await c.post(`/v1/projects/${project.id}/estimate/lines`, { sectionId: estimate.sections[0].id, name: 'Late add', unitCostCents: { labor: 100 } });
    expect(blocked.status).toBe(409);
    await c.post(`/v1/projects/${project.id}/estimate/unlock`);
    await c.patch(`/v1/projects/${project.id}/estimate/lines/${demoLine.id}`, { unitCostCents: { labor: 300_000 } });
    await c.post(`/v1/projects/${project.id}/estimate/lock`, { applyContractValue: false });
    const budget2 = await c.get(`/v1/projects/${project.id}/budget`);
    expect(budget2.body.lines).toHaveLength(3);
    expect(budget2.body.totals.originalCents).toBe(1_536_000);
    expect((await c.get(`/v1/projects/${project.id}`)).body.financials.contractValueCents).toBe(locked.body.totals.sellCents);
    const activity = await c.get(`/v1/projects/${project.id}/activity`);
    expect(activity.body.items.some((a: any) => a.summary.includes('locked estimate'))).toBe(true);
  });

  it('copies catalog items into lines and seeds default cost codes on first use', async () => {
    const c = api(app, owner);
    const codes = await c.get('/v1/cost-codes');
    expect(codes.status).toBe(200);
    expect(codes.body.length).toBeGreaterThan(20);
    const plumbing = codes.body.find((x: any) => x.name === 'Plumbing');
    const item = await c.post('/v1/catalog', { name: 'Pot filler rough-in', costCodeId: plumbing.id, unit: 'ea', unitCostCents: { labor: 35_000, material: 12_000 }, tags: ['plumbing'] });
    expect(item.status).toBe(201);
    expect(item.body.costCode).toBe(plumbing.code);
    const found = await c.get('/v1/catalog?q=pot');
    expect(found.body.items.map((i: any) => i.id)).toContain(item.body.id);
    const project = await createProject(app, owner, { name: 'Catalog House' });
    const section = (await c.post(`/v1/projects/${project.id}/estimate/sections`, { name: 'Plumbing' })).body.sections[0];
    const est = await c.post(`/v1/projects/${project.id}/estimate/lines`, { sectionId: section.id, catalogItemId: item.body.id });
    expect(est.status, JSON.stringify(est.body)).toBe(201);
    const line = est.body.sections[0].lines[0];
    expect(line.name).toBe('Pot filler rough-in');
    expect(line.costCode).toBe(plumbing.code);
    expect(line.totals.directCostCents).toBe(47_000);
  });
});

describe('change orders', () => {
  it('prices, sends, approves and lands on the budget and contract', async () => {
    const c = api(app, owner);
    const { project } = await estimateAndLock(owner, { name: 'CO House' });
    await c.post(`/v1/projects/${project.id}/estimate/lock`, {});
    const budget = (await c.get(`/v1/projects/${project.id}/budget`)).body;
    const cabinets = budget.lines.find((l: any) => l.name === 'Cabinets');
    const before = (await c.get(`/v1/projects/${project.id}`)).body.financials;

    const co = await c.post(`/v1/projects/${project.id}/change-orders`, { title: 'Add pantry cabinets', reason: 'client_request', scheduleImpactDays: 3, lines: [
      { name: 'Pantry cabinets', budgetLineId: cabinets.id, quantityThousandths: 4_000, unit: 'lf', unitCostCents: { material: 45_000, labor: 8_000 }, taxable: true },
      { name: 'Electrical outlet for pantry', unitCostCents: { subcontract: 30_000 } },
    ] });
    expect(co.status).toBe(201);
    expect(co.body.number).toBe(1);
    expect(co.body.status).toBe('draft');
    expect(co.body.costCents).toBe(212_000 + 30_000);
    expect(co.body.markupCents).toBe(42_400 + 6_000);
    expect(co.body.taxCents).toBe(20_988);
    expect(co.body.totalCents).toBe(254_400 + 20_988 + 36_000);

    const sent = await c.post(`/v1/change-orders/${co.body.id}/send`, { message: 'Please review' });
    expect(sent.body.status).toBe('sent');
    expect(sent.body.approvals[0].status).toBe('pending');
    const pending = await c.get('/v1/dashboard');
    expect(pending.body.pendingApprovals.items.some((a: any) => a.objectId === co.body.id)).toBe(true);
    const edit = await c.patch(`/v1/change-orders/${co.body.id}`, { title: 'nope' });
    expect(edit.status).toBe(409);

    const approved = await c.post(`/v1/change-orders/${co.body.id}/decide`, { decision: 'approved', decidedByName: 'Jane Smith', note: 'Go ahead' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.approvals[0]).toMatchObject({ status: 'approved', decidedByName: 'Jane Smith', decisionNote: 'Go ahead' });
    // Every line now points at a budget line (a new one was created for the electrical work).
    expect(approved.body.lines.every((l: any) => l.budgetLineId)).toBe(true);

    const after = (await c.get(`/v1/projects/${project.id}`)).body.financials;
    expect(after.approvedChangesCents).toBe(co.body.totalCents);
    expect(after.revisedContractCents).toBe(before.contractValueCents + co.body.totalCents);
    const budget2 = (await c.get(`/v1/projects/${project.id}/budget`)).body;
    const cab2 = budget2.lines.find((l: any) => l.id === cabinets.id);
    expect(cab2.approvedChangesCents).toBe(212_000);
    expect(cab2.revisedCents).toBe(cabinets.originalCents + 212_000);
    const electrical = budget2.lines.find((l: any) => l.sectionName === 'Change order #1');
    expect(electrical.approvedChangesCents).toBe(30_000);
    expect(budget2.totals.approvedChangesCents).toBe(242_000);
    const detail = await c.get(`/v1/projects/${project.id}/budget/lines/${cabinets.id}`);
    expect(detail.body.transactions[0]).toMatchObject({ kind: 'change_order', amountCents: 212_000, status: 'approved' });

    const voided = await c.post(`/v1/change-orders/${co.body.id}/void`);
    expect(voided.status).toBe(409);
    const declined = await c.post(`/v1/projects/${project.id}/change-orders`, { title: 'Skylight', lines: [{ name: 'Skylight', unitCostCents: { material: 90_000 } }] });
    const d = await c.post(`/v1/change-orders/${declined.body.id}/decide`, { decision: 'declined', decidedByName: 'Jane Smith' });
    expect(d.body.status).toBe('declined');
    expect((await c.get(`/v1/projects/${project.id}`)).body.financials.approvedChangesCents).toBe(co.body.totalCents);
    const list = await c.get(`/v1/projects/${project.id}/change-orders?status=approved`);
    expect(list.body.items.map((x: any) => x.number)).toEqual([1]);
  });
});

describe('purchase orders and bills', () => {
  it('commits a PO, bills against it, matches it and shows actual cost on the budget', async () => {
    const c = api(app, owner);
    const { project } = await estimateAndLock(owner, { name: 'PO House' });
    await c.post(`/v1/projects/${project.id}/estimate/lock`, {});
    const budget = (await c.get(`/v1/projects/${project.id}/budget`)).body;
    const cabinets = budget.lines.find((l: any) => l.name === 'Cabinets');
    const vendor = await c.post('/v1/vendors', { name: 'Hill Country Cabinets', trade: 'Cabinetry', email: 'orders@hcc.example' });
    expect(vendor.status).toBe(201);

    const po = await c.post(`/v1/projects/${project.id}/purchase-orders`, { vendorId: vendor.body.id, title: 'Kitchen cabinets', lines: [
      { budgetLineId: cabinets.id, description: 'Shaker cabinets, 12 lf', quantityThousandths: 12_000, unit: 'lf', unitCostCents: 45_000 },
      { budgetLineId: cabinets.id, description: 'Delivery', unitCostCents: 25_000 },
    ] });
    expect(po.status).toBe(201);
    expect(po.body.number).toBe('PO-0001');
    expect(po.body.totalCents).toBe(540_000 + 25_000);
    expect(po.body.vendorName).toBe('Hill Country Cabinets');
    // A draft PO does not commit money yet.
    expect((await c.get(`/v1/projects/${project.id}/budget`)).body.totals.committedCents).toBe(0);
    const approved = await c.post(`/v1/purchase-orders/${po.body.id}/transition`, { action: 'approve' });
    expect(approved.body.status).toBe('approved');
    const issued = await c.post(`/v1/purchase-orders/${po.body.id}/transition`, { action: 'issue' });
    expect(issued.body.status).toBe('committed');
    expect(issued.body.issuedAt).toBeTruthy();
    const b1 = (await c.get(`/v1/projects/${project.id}/budget`)).body;
    expect(b1.lines.find((l: any) => l.id === cabinets.id).committedCents).toBe(565_000);
    expect((await c.get(`/v1/vendors/${vendor.body.id}`)).body.openPoCents).toBe(565_000);

    // Bill the cabinets (defaults to the unbilled PO lines) and warn when a bill would overrun the PO.
    const bill = await c.post('/v1/bills', { purchaseOrderId: po.body.id, vendorReference: 'HCC-4471', billDate: '2026-10-01', dueDate: '2026-10-31' });
    expect(bill.status).toBe(201);
    expect(bill.body.number).toBe('BILL-0001');
    expect(bill.body.projectId).toBe(project.id);
    expect(bill.body.vendorId).toBe(vendor.body.id);
    expect(bill.body.lines).toHaveLength(2);
    expect(bill.body.totalCents).toBe(565_000);
    expect(bill.body.overPoCents).toBe(0);
    const partial = await c.patch(`/v1/bills/${bill.body.id}`, { lines: [{ ...bill.body.lines[0], amountCents: 300_000 }] });
    expect(partial.body.totalCents).toBe(300_000);
    const approvedBill = await c.post(`/v1/bills/${bill.body.id}/transition`, { action: 'approve' });
    expect(approvedBill.body.status).toBe('approved');
    const b2 = (await c.get(`/v1/projects/${project.id}/budget`)).body;
    const cab2 = b2.lines.find((l: any) => l.id === cabinets.id);
    expect(cab2.actualCents).toBe(300_000);
    expect(cab2.committedCents).toBe(265_000);
    // Projected cost = what is spent plus what is committed (the PO balance), so the line is still under its revised amount.
    expect(cab2.projectedCents).toBe(565_000);
    expect(cab2.status).toBe('on_track');
    const po2 = (await c.get(`/v1/purchase-orders/${po.body.id}`)).body;
    expect(po2.billedCents).toBe(300_000);
    expect(po2.status).toBe('committed');
    expect(po2.lines[0].billedCents).toBe(300_000);

    const over = await c.post('/v1/bills', { purchaseOrderId: po.body.id, vendorReference: 'HCC-4499', lines: [{ purchaseOrderLineId: po.body.lines[0].id, budgetLineId: cabinets.id, description: 'Balance + extras', amountCents: 400_000 }] });
    expect(over.body.overPoCents).toBe(135_000);
    const unmatched = await c.get('/v1/bills?status=unmatched');
    expect(unmatched.body.items).toHaveLength(0);
    await c.patch(`/v1/bills/${over.body.id}`, { lines: [{ ...over.body.lines[0], amountCents: 265_000 }] });
    await c.post(`/v1/bills/${over.body.id}/transition`, { action: 'approve' });
    const po3 = (await c.get(`/v1/purchase-orders/${po.body.id}`)).body;
    expect(po3.status).toBe('matched');
    expect(po3.billedCents).toBe(565_000);
    const fin = (await c.get(`/v1/projects/${project.id}`)).body.financials;
    expect(fin.committedCents).toBe(0);
    expect(fin.actualCents).toBe(565_000);

    // Pay the first bill and void the PO guard.
    const paid = await c.post(`/v1/bills/${bill.body.id}/payments`, { amountCents: 300_000, method: 'ach', reference: 'ACH 5521' });
    expect(paid.status).toBe(201);
    expect(paid.body.status).toBe('paid');
    const voidPo = await c.post(`/v1/purchase-orders/${po.body.id}/transition`, { action: 'void' });
    expect(voidPo.status).toBe(409);
    const detail = await c.get(`/v1/projects/${project.id}/budget/lines/${cabinets.id}`);
    expect(detail.body.transactions.filter((t: any) => t.kind === 'bill')).toHaveLength(2);
    expect(detail.body.transactions.some((t: any) => t.kind === 'purchase_order')).toBe(true);
    const overview = await c.get('/v1/budget/overview');
    expect(overview.body.find((p: any) => p.projectId === project.id).totals.actualCents).toBe(565_000);
  });
});

describe('invoices and payments', () => {
  it('bills a percentage of the budget plus an approved change order, records payments, and updates project financials', async () => {
    const c = api(app, owner);
    const { project } = await estimateAndLock(owner, { name: 'Invoice House' });
    await c.post(`/v1/projects/${project.id}/estimate/lock`, {});
    const budget = (await c.get(`/v1/projects/${project.id}/budget`)).body;
    const cabinets = budget.lines.find((l: any) => l.name === 'Cabinets');
    const co = (await c.post(`/v1/projects/${project.id}/change-orders`, { title: 'Extra outlet', lines: [{ name: 'Outlet', unitCostCents: { subcontract: 10_000 } }] })).body;
    await c.post(`/v1/change-orders/${co.id}/decide`, { decision: 'approved', decidedByName: 'Jane' });

    const draftCo = (await c.post(`/v1/projects/${project.id}/change-orders`, { title: 'Not yet', lines: [{ name: 'x', unitCostCents: { labor: 100 } }] })).body;
    const bad = await c.post(`/v1/projects/${project.id}/invoices`, { title: 'Bad', changeOrderIds: [draftCo.id] });
    expect(bad.status).toBe(409);

    const inv = await c.post(`/v1/projects/${project.id}/invoices`, { title: 'Progress draw 1', billingType: 'progress', issueDate: '2026-10-01', taxBp: 825, lines: [
      { budgetLineId: cabinets.id, description: 'Cabinets – 50%', percentBp: 5_000, taxable: true },
      { description: 'Mobilization', unitPriceCents: 150_000 },
    ], changeOrderIds: [co.id] });
    expect(inv.status).toBe(201);
    expect(inv.body.number).toBe('INV-0001');
    expect(inv.body.dueDate).toBe('2026-10-31');
    expect(inv.body.clientId).toBeNull();
    expect(inv.body.lines).toHaveLength(3);
    const half = Math.round(cabinets.originalSellCents / 2);
    expect(inv.body.lines[0].amountCents).toBe(half);
    expect(inv.body.lines[2]).toMatchObject({ changeOrderId: co.id, amountCents: co.totalCents });
    expect(inv.body.subtotalCents).toBe(half + 150_000 + co.totalCents);
    expect(inv.body.taxCents).toBe(Math.round(half * 0.0825));
    expect(inv.body.totalCents).toBe(inv.body.subtotalCents + inv.body.taxCents);
    expect(inv.body.balanceCents).toBe(inv.body.totalCents);
    // A draft invoice is not yet billed.
    expect((await c.get(`/v1/projects/${project.id}`)).body.financials.invoicedCents).toBe(0);

    const tooEarly = await c.post(`/v1/invoices/${inv.body.id}/payments`, { amountCents: 100, method: 'check' });
    expect(tooEarly.status).toBe(409);
    const sent = await c.post(`/v1/invoices/${inv.body.id}/transition`, { action: 'send' });
    expect(sent.body.status).toBe('sent');
    expect((await c.get(`/v1/projects/${project.id}`)).body.financials.invoicedCents).toBe(inv.body.totalCents);
    expect((await c.get('/v1/dashboard')).body.unpaidInvoices.items.map((i: any) => i.id)).toContain(inv.body.id);
    const locked = await c.patch(`/v1/invoices/${inv.body.id}`, { title: 'nope' });
    expect(locked.status).toBe(409);

    const p1 = await c.post(`/v1/invoices/${inv.body.id}/payments`, { amountCents: 100_000, method: 'check', reference: '1042' });
    expect(p1.status).toBe(201);
    expect(p1.body.status).toBe('partially_paid');
    expect(p1.body.paidCents).toBe(100_000);
    const tooMuch = await c.post(`/v1/invoices/${inv.body.id}/payments`, { amountCents: inv.body.totalCents, method: 'card' });
    expect(tooMuch.status).toBe(400);
    const p2 = await c.post(`/v1/invoices/${inv.body.id}/payments`, { amountCents: inv.body.totalCents - 100_000, method: 'ach' });
    expect(p2.body.status).toBe('paid');
    expect(p2.body.paidAt).toBeTruthy();
    expect(p2.body.payments).toHaveLength(2);
    const fin = (await c.get(`/v1/projects/${project.id}`)).body.financials;
    expect(fin.paidCents).toBe(inv.body.totalCents);
    expect(fin.outstandingCents).toBe(0);
    const b = (await c.get(`/v1/projects/${project.id}/budget`)).body;
    expect(b.lines.find((l: any) => l.id === cabinets.id).invoicedCents).toBe(half);
    expect(b.contract.paidCents).toBe(inv.body.totalCents);

    // Voiding a payment reopens the balance; a change order cannot be billed twice.
    const voided = await c.delete(`/v1/invoices/${inv.body.id}/payments/${p2.body.payments[0].id}`);
    expect(voided.body.status).toBe('partially_paid');
    expect(voided.body.balanceCents).toBe(inv.body.totalCents - 100_000);
    const dup = await c.post(`/v1/projects/${project.id}/invoices`, { title: 'Dup CO', changeOrderIds: [co.id] });
    expect(dup.status).toBe(409);
    const overdue = await c.post(`/v1/projects/${project.id}/invoices`, { title: 'Old', issueDate: '2026-01-01', dueDate: '2026-01-15', lines: [{ description: 'x', unitPriceCents: 1_000 }] });
    await c.post(`/v1/invoices/${overdue.body.id}/transition`, { action: 'send' });
    expect((await c.get(`/v1/invoices/${overdue.body.id}`)).body.status).toBe('overdue');
    expect((await c.get('/v1/invoices?status=overdue')).body.items.map((i: any) => i.id)).toEqual([overdue.body.id]);
  });
});

describe('financial permissions and isolation', () => {
  it('estimators cannot approve bills or record payments; field crew cannot see budgets; other tenants see nothing', async () => {
    const c = api(app, owner);
    const { project } = await estimateAndLock(owner, { name: 'Perm House' });
    await c.post(`/v1/projects/${project.id}/estimate/lock`, {});
    const estimator = await inviteMember(app, owner, 'estimator', { projectIds: [project.id] });
    const crew = await inviteMember(app, owner, 'field_crew', { projectIds: [project.id] });
    const bookkeeper = await inviteMember(app, owner, 'office', { projectIds: [project.id] });
    const stranger = await registerOrg(app, { org: 'Other Co' });

    expect((await api(app, estimator).get(`/v1/projects/${project.id}/estimate`)).status).toBe(200);
    expect((await api(app, estimator).get(`/v1/projects/${project.id}/budget`)).status).toBe(200);
    expect((await api(app, crew).get(`/v1/projects/${project.id}/budget`)).status).toBe(403);
    expect((await api(app, crew).get(`/v1/projects/${project.id}/estimate`)).status).toBe(403);
    expect((await api(app, crew).get('/v1/invoices')).status).toBe(403);

    const bill = await c.post('/v1/bills', { projectId: project.id, vendorReference: 'X-1', lines: [{ description: 'Lumber', amountCents: 50_000 }] });
    expect((await api(app, estimator).post(`/v1/bills/${bill.body.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await api(app, bookkeeper).post(`/v1/bills/${bill.body.id}/transition`, { action: 'approve' })).status).toBe(200);
    const inv = (await c.post(`/v1/projects/${project.id}/invoices`, { lines: [{ description: 'Draw', unitPriceCents: 10_000 }] })).body;
    await c.post(`/v1/invoices/${inv.id}/transition`, { action: 'send' });
    expect((await api(app, estimator).post(`/v1/invoices/${inv.id}/payments`, { amountCents: 100, method: 'cash' })).status).toBe(403);
    expect((await api(app, bookkeeper).post(`/v1/invoices/${inv.id}/payments`, { amountCents: 100, method: 'cash' })).status).toBe(201);

    // Tenant isolation: ids from another organization are simply not found.
    expect((await api(app, stranger).get(`/v1/projects/${project.id}/budget`)).status).toBe(404);
    expect((await api(app, stranger).get(`/v1/invoices/${inv.id}`)).status).toBe(404);
    expect((await api(app, stranger).get(`/v1/bills/${bill.body.id}`)).status).toBe(404);
    expect((await api(app, stranger).post(`/v1/invoices/${inv.id}/payments`, { amountCents: 100, method: 'cash' })).status).toBe(404);
    expect((await api(app, stranger).get('/v1/invoices')).body.items).toHaveLength(0);
    expect((await api(app, stranger).get('/v1/cost-codes')).body.length).toBeGreaterThan(0);
  });
});
