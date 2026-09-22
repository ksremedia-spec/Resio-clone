import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createProject, createTestApp, inviteMember, registerOrg, type Actor, type TestApp } from './helpers.js';

let app: TestApp;
let owner: Actor;
beforeAll(async () => { app = await createTestApp(); owner = await registerOrg(app, { org: 'Field Co' }); });
afterAll(async () => { await app.close(); });

describe('time clock', () => {
  it('clocks in and out with breaks, computes labour cost from the hourly rate, and approved time lands on the budget', async () => {
    const c = api(app, owner);
    const project = await createProject(app, owner, { name: 'Time House' });
    const crew = await inviteMember(app, owner, 'field_crew', { projectIds: [project.id] });
    const supervisor = await inviteMember(app, owner, 'field_supervisor', { projectIds: [project.id] });
    const members = (await c.get('/v1/members')).body;
    const crewMember = members.find((m: any) => m.userId === crew.userId);
    await c.patch(`/v1/members/${crewMember.id}`, { hourlyCostCents: 3_600 });
    const codes = (await c.get('/v1/cost-codes')).body;
    const framing = codes.find((x: any) => x.name.startsWith('Rough Carpentry'));
    // Budget line on the framing cost code so labour rolls up to it.
    const section = (await c.post(`/v1/projects/${project.id}/estimate/sections`, { name: 'Framing' })).body.sections[0];
    await c.post(`/v1/projects/${project.id}/estimate/lines`, { sectionId: section.id, name: 'Framing labor', costCodeId: framing.id, unitCostCents: { labor: 100_000 } });
    await c.post(`/v1/projects/${project.id}/estimate/lock`, {});

    const j = api(app, crew);
    expect((await j.get('/v1/time/current')).body).toBeNull();
    const started = await j.post('/v1/time/clock-in', { projectId: project.id, costCodeId: framing.id, location: { latitude: 30.2, longitude: -97.7 } });
    expect(started.status).toBe(201);
    expect(started.body.status).toBe('open');
    expect(started.body.hourlyCostCents).toBe(3_600);
    expect((await j.post('/v1/time/clock-in', { projectId: project.id })).status).toBe(409);
    expect((await j.get('/v1/time/current')).body.id).toBe(started.body.id);
    expect((await j.post('/v1/time/break/start')).body.onBreak).toBe(true);
    expect((await j.post('/v1/time/break/start')).status).toBe(409);
    expect((await j.post('/v1/time/break/end')).body.onBreak).toBe(false);
    const done = await j.post('/v1/time/clock-out', { notes: 'Framed the north wall.' });
    expect(done.body.status).toBe('submitted');
    expect(done.body.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(done.body.breaks).toHaveLength(1);
    expect((await j.get('/v1/time/current')).body).toBeNull();

    // A manual entry for yesterday: 8h minus 30 min break at $36/h = $270.
    const manual = await j.post('/v1/time/entries', { projectId: project.id, costCodeId: framing.id, clockInAt: '2026-09-14T13:00:00Z', clockOutAt: '2026-09-14T21:00:00Z', breakSeconds: 1800, notes: 'Forgot to clock in' });
    expect(manual.status).toBe(201);
    expect(manual.body.durationSeconds).toBe(27_000);
    expect(manual.body.laborCostCents).toBe(27_000);
    // Crew only see their own time; the supervisor sees the project's time and approves it.
    expect((await j.get('/v1/time/entries?status=all')).body.items).toHaveLength(2);
    expect((await j.post('/v1/time/decide', { ids: [manual.body.id], decision: 'approved' })).status).toBe(403);
    const s = api(app, supervisor);
    const sheet = await s.get('/v1/time/timesheet?from=2026-09-14&to=2026-09-14&projectId=' + project.id);
    expect(sheet.body.rows).toHaveLength(1);
    expect(sheet.body.rows[0].pendingSeconds).toBe(27_000);
    const approved = await s.post('/v1/time/decide', { ids: [manual.body.id], decision: 'approved' });
    expect(approved.status).toBe(200);
    expect(approved.body[0].status).toBe('approved');
    expect(approved.body[0].approvedBy).toBe(supervisor.userId);
    const budget = (await c.get(`/v1/projects/${project.id}/budget`)).body;
    expect(budget.lines[0].actualCents).toBe(27_000);
    const detail = await c.get(`/v1/projects/${project.id}/budget/lines/${budget.lines[0].id}`);
    expect(detail.body.transactions.some((t: any) => t.kind === 'time_entry' && t.amountCents === 27_000)).toBe(true);
    // Rejected entries can be corrected and resubmitted; approved ones are locked for the crew.
    const rejected = await s.post('/v1/time/decide', { ids: [done.body.id], decision: 'rejected', note: 'Wrong project' });
    expect(rejected.body[0].status).toBe('rejected');
    expect((await j.patch(`/v1/time/entries/${done.body.id}`, { notes: 'Corrected' })).body.status).toBe('submitted');
    expect((await j.patch(`/v1/time/entries/${manual.body.id}`, { notes: 'x' })).status).toBe(409);
    // Payroll export as CSV marks entries exported so they are never paid twice.
    const csv = await c.post('/v1/time/payroll-export', { from: '2026-09-01', to: '2026-09-30', markExported: true });
    expect(csv.status).toBe(200);
    expect(csv.body.count).toBe(1);
    expect(csv.body.csv.split('\n')[0]).toContain('Employee');
    expect(csv.body.csv).toContain('7.50');
    expect((await j.get(`/v1/time/entries/${manual.body.id}`)).body.status).toBe('exported');
    expect((await c.post('/v1/time/payroll-export', { from: '2026-09-01', to: '2026-09-30' })).body.count).toBe(0);
    expect((await api(app, crew).post('/v1/time/payroll-export', { from: '2026-09-01', to: '2026-09-30' })).status).toBe(403);
  });
});

describe('vendor portal', () => {
  it('invites vendors to bid, the vendor submits from the portal, the award creates a PO which the vendor acknowledges', async () => {
    const c = api(app, owner);
    const project = await createProject(app, owner, { name: 'Bid House' });
    const vendorEmail = `sub-${Date.now()}@example.test`;
    const plumber = (await c.post('/v1/vendors', { name: 'Bid Plumbing', trade: 'Plumbing', email: vendorEmail })).body;
    const other = (await c.post('/v1/vendors', { name: 'Other Plumbing', trade: 'Plumbing' })).body;
    const roles = (await c.get('/v1/roles')).body;
    const inv = await c.post('/v1/invitations', { email: vendorEmail, roleId: roles.find((r: any) => r.key === 'vendor').id, projectIds: [] });
    const token = new URL(inv.body.acceptUrl).searchParams.get('token')!;
    const accept = (await app.fastify.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token, password: 'plumber password 1', firstName: 'Pat', lastName: 'Plumber' } })).json();
    const vendor: Actor = { token: accept.session.token, orgId: accept.organizationId, userId: accept.session.user.id, email: vendorEmail };
    const v = api(app, vendor);
    expect((await v.get('/v1/portal/vendor/overview')).body.vendor.name).toBe('Bid Plumbing');

    const req = await c.post(`/v1/projects/${project.id}/bid-requests`, { title: 'Plumbing rough-in', scope: '3 fixtures', dueDate: '2030-01-01', vendorIds: [plumber.id, other.id] });
    expect(req.status).toBe(201);
    expect(req.body.bids).toHaveLength(2);
    // Drafts are invisible to vendors; sending makes it appear in their portal.
    expect((await v.get(`/v1/bid-requests/${req.body.id}`)).status).toBe(404);
    expect((await c.post(`/v1/bid-requests/${req.body.id}/send`)).body.status).toBe('open');
    expect(app.email.sent.some((m) => m.to === vendorEmail && m.subject.includes('Plumbing rough-in'))).toBe(true);
    const mine = await v.get('/v1/portal/vendor/overview');
    expect(mine.body.bidRequests).toHaveLength(1);
    expect(mine.body.bidRequests[0].myBid.status).toBe('invited');
    const seen = await v.get(`/v1/bid-requests/${req.body.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.bids).toHaveLength(1); // only their own bid, never the competition
    const bid = await v.post(`/v1/bid-requests/${req.body.id}/bids`, { amountCents: 480_000, notes: 'Two weeks out.' });
    expect(bid.status).toBe(200);
    expect(bid.body.bids[0].status).toBe('submitted');
    expect(bid.body.bids[0].amountCents).toBe(480_000);
    // The office keys in the other vendor's emailed bid and awards the lower one.
    await c.post(`/v1/bid-requests/${req.body.id}/bids`, { vendorId: other.id, amountCents: 520_000, notes: 'By email' });
    const full = (await c.get(`/v1/bid-requests/${req.body.id}`)).body;
    expect(full.submittedCount).toBe(2);
    expect(full.lowestCents).toBe(480_000);
    expect((await v.post(`/v1/bid-requests/${req.body.id}/award`, { bidId: bid.body.bids[0].id })).status).toBe(403);
    const awarded = await c.post(`/v1/bid-requests/${req.body.id}/award`, { bidId: full.bids.find((b: any) => b.vendorId === plumber.id).id });
    expect(awarded.body.status).toBe('awarded');
    expect(awarded.body.bids.find((b: any) => b.vendorId === other.id).status).toBe('not_selected');
    const pos = (await c.get(`/v1/projects/${project.id}/purchase-orders?status=all`)).body.items;
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({ vendorId: plumber.id, totalCents: 480_000, status: 'draft' });
    // Vendors only see POs once issued to them.
    expect((await v.get('/v1/purchase-orders?status=all')).body.items).toHaveLength(0);
    await c.post(`/v1/purchase-orders/${pos[0].id}/transition`, { action: 'approve' });
    await c.post(`/v1/purchase-orders/${pos[0].id}/transition`, { action: 'issue' });
    expect((await v.get('/v1/purchase-orders?status=all')).body.items).toHaveLength(1);
    expect((await v.post(`/v1/purchase-orders/${pos[0].id}/acknowledge`)).status).toBe(200);
    expect((await v.get('/v1/portal/vendor/overview')).body.purchaseOrders[0].acknowledgedAt).toBeTruthy();
    // No bills, budgets or estimates for vendors.
    expect((await v.get('/v1/bills')).status).toBe(403);
    expect((await v.get(`/v1/projects/${project.id}/budget`)).status).toBe(403);
    expect((await v.get(`/v1/projects/${project.id}/change-orders`)).status).toBe(403);
  });
});
