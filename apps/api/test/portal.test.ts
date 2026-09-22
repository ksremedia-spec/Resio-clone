import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createProject, createTestApp, inviteMember, registerOrg, type Actor, type TestApp } from './helpers.js';

let app: TestApp;
let owner: Actor;
beforeAll(async () => { app = await createTestApp(); owner = await registerOrg(app, { org: 'Portal Co' }); });
afterAll(async () => { await app.close(); });

/** A project with a client, a contact, an estimate and a homeowner signed in through the portal. */
async function projectWithClient(name: string) {
  const c = api(app, owner);
  const clientEmail = `homeowner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const client = (await c.post('/v1/clients', { displayName: 'Portal Family', contacts: [{ firstName: 'Pat', lastName: 'Portal', email: clientEmail, isPrimary: true }] })).body;
  const project = await createProject(app, owner, { name, clientId: client.id, contractValueCents: 0, status: 'pre_construction' });
  const section = (await c.post(`/v1/projects/${project.id}/estimate/sections`, { name: 'Kitchen' })).body.sections[0];
  await c.post(`/v1/projects/${project.id}/estimate/lines`, { sectionId: section.id, name: 'Cabinets', unitCostCents: { material: 1_000_000 } });
  await c.post(`/v1/projects/${project.id}/estimate/lines`, { sectionId: section.id, name: 'Internal note line', unitCostCents: { labor: 50_000 }, clientVisible: false });
  // Invite the homeowner as a client-portal user with the same email as the CRM contact.
  const roles = await c.get('/v1/roles');
  const role = roles.body.find((r: any) => r.key === 'client');
  const inv = await c.post('/v1/invitations', { email: clientEmail, roleId: role.id, projectIds: [project.id] });
  const token = new URL(inv.body.acceptUrl).searchParams.get('token')!;
  const accept = await app.fastify.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token, password: 'homeowner password 1', firstName: 'Pat', lastName: 'Portal' } });
  const body = accept.json();
  const homeowner: Actor = { token: body.session.token, orgId: body.organizationId, userId: body.session.user.id, email: clientEmail };
  return { client, project, homeowner };
}

describe('proposals', () => {
  it('snapshots the estimate, sends to the client, and acceptance locks the estimate and sets the contract', async () => {
    const c = api(app, owner);
    const { project, homeowner } = await projectWithClient('Proposal House');
    const h = api(app, homeowner);
    const p = await c.post(`/v1/projects/${project.id}/proposals`, { title: 'Kitchen remodel proposal', introduction: 'Thank you for the opportunity.', terms: '50% deposit.', validUntil: '2030-01-01' });
    expect(p.status).toBe(201);
    expect(p.body.number).toBe('PROP-0001');
    expect(p.body.status).toBe('draft');
    expect(p.body.totalCents).toBe(1_260_000); // 1,050,000 cost + 20% markup
    expect(p.body.snapshot.sections[0].lines.map((l: any) => l.name)).toEqual(['Cabinets']); // hidden line dropped
    expect(p.body.signers).toHaveLength(1);
    expect(p.body.signers[0].name).toBe('Pat Portal');
    // Not visible to the client until sent.
    expect((await h.get(`/v1/proposals/${p.body.id}`)).status).toBe(404);
    expect((await h.get(`/v1/projects/${project.id}/proposals`)).body.items).toHaveLength(0);
    const sent = await c.post(`/v1/proposals/${p.body.id}/send`, { message: 'Please review.' });
    expect(sent.body.status).toBe('sent');
    expect(app.email.sent.some((m) => m.to === homeowner.email && m.subject.includes('PROP-0001'))).toBe(true);
    // The client opens it: viewed, then accepts with a typed signature.
    const seen = await h.get(`/v1/proposals/${p.body.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.status).toBe('viewed');
    expect(seen.body.snapshot.sections[0].lines).toHaveLength(1);
    const overview = await h.get('/v1/portal/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.projects).toHaveLength(1);
    expect(overview.body.approvals.map((a: any) => a.objectType)).toContain('proposal');
    expect((await h.post(`/v1/proposals/${p.body.id}/decide`, { decision: 'accepted', signerName: 'Pat Portal', signatureText: 'Pat Portal' })).body.status).toBe('accepted');
    const detail = (await c.get(`/v1/projects/${project.id}`)).body;
    expect(detail.financials.contractValueCents).toBe(1_260_000);
    expect(detail.status).toBe('pre_construction');
    expect((await c.get(`/v1/projects/${project.id}/estimate`)).body.status).toBe('locked');
    expect((await c.get(`/v1/projects/${project.id}/budget`)).body.lines).toHaveLength(2);
    const approvals = await c.get(`/v1/approvals?status=decided&projectId=${project.id}`);
    expect(approvals.body.items[0]).toMatchObject({ objectType: 'proposal', status: 'approved', decidedByName: 'Pat Portal' });
    expect((await c.post(`/v1/proposals/${p.body.id}/void`)).status).toBe(409);
    // The homeowner cannot create proposals, see estimates or the budget.
    expect((await h.post(`/v1/projects/${project.id}/proposals`, { title: 'x' })).status).toBe(403);
    expect((await h.get(`/v1/projects/${project.id}/estimate`)).status).toBe(403);
    expect((await h.get(`/v1/projects/${project.id}/budget`)).status).toBe(403);
  });
});

describe('selections and change orders in the portal', () => {
  it('releases a selection, the client picks an option over allowance, and a change order is drafted, sent and approved by the client', async () => {
    const c = api(app, owner);
    const { project, homeowner } = await projectWithClient('Selection House');
    const h = api(app, homeowner);
    await c.post(`/v1/projects/${project.id}/estimate/lock`, {});
    const sel = await c.post(`/v1/projects/${project.id}/selections`, { category: 'Tile', room: 'Primary bath', name: 'Shower floor tile', allowanceCents: 80_000, dueDate: '2030-01-15', options: [
      { name: 'Standard porcelain', costCents: 60_000, priceCents: 80_000, isRecommended: true },
      { name: 'Marble mosaic', costCents: 120_000, priceCents: 150_000 },
    ] });
    expect(sel.status).toBe(201);
    expect(sel.body.status).toBe('pending');
    expect((await h.get(`/v1/selections/${sel.body.id}`)).status).toBe(404);
    const released = await c.post(`/v1/selections/${sel.body.id}/release`);
    expect(released.body.status).toBe('released');
    const mine = await h.get(`/v1/projects/${project.id}/selections?status=open`);
    expect(mine.body.items).toHaveLength(1);
    const marble = sel.body.options.find((o: any) => o.name === 'Marble mosaic');
    const decided = await h.post(`/v1/selections/${sel.body.id}/decide`, { optionId: marble.id, note: 'Love it' });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('decided');
    expect(decided.body.selectedOptionId).toBe(marble.id);
    expect(decided.body.overageCents).toBe(70_000);
    expect(decided.body.changeOrderId).toBeTruthy();
    expect(decided.body.approvals[0]).toMatchObject({ status: 'approved', decidedByName: 'Pat Portal', amountCents: 150_000 });
    const co = (await c.get(`/v1/change-orders/${decided.body.changeOrderId}`)).body;
    expect(co.status).toBe('draft');
    expect(co.reason).toBe('allowance_overage');
    expect(co.totalCents).toBe(70_000); // no markup on the overage, the price difference is the client's number
    // Hidden from the client until sent; then they view and approve it themselves.
    expect((await h.get(`/v1/change-orders/${co.id}`)).status).toBe(404);
    await c.post(`/v1/change-orders/${co.id}/send`, {});
    const view = await h.get(`/v1/change-orders/${co.id}`);
    expect(view.body.status).toBe('viewed');
    expect((await h.post(`/v1/change-orders/${co.id}/decide`, { decision: 'approved' })).body.status).toBe('approved');
    expect((await c.get(`/v1/change-orders/${co.id}`)).body.approvals[0].decidedByName).toBe('Pat Portal');
    expect((await c.get(`/v1/projects/${project.id}`)).body.financials.approvedChangesCents).toBe(70_000);
    // The client cannot approve a draft or edit anything.
    const draft = (await c.post(`/v1/projects/${project.id}/change-orders`, { title: 'Draft', lines: [{ name: 'x', unitCostCents: { labor: 100 } }] })).body;
    expect((await h.post(`/v1/change-orders/${draft.id}/decide`, { decision: 'approved' })).status).toBe(404);
    expect((await h.patch(`/v1/selections/${sel.body.id}`, { name: 'nope' })).status).toBe(403);
  });
});

describe('client payments', () => {
  it('lets the homeowner pay an open invoice online and hides drafts from them', async () => {
    const c = api(app, owner);
    const { project, homeowner } = await projectWithClient('Payment House');
    const h = api(app, homeowner);
    const draft = (await c.post(`/v1/projects/${project.id}/invoices`, { title: 'Deposit', lines: [{ description: 'Deposit', unitPriceCents: 500_000 }] })).body;
    expect((await h.get(`/v1/projects/${project.id}/invoices`)).body.items).toHaveLength(0);
    expect((await h.get(`/v1/invoices/${draft.id}`)).status).toBe(404);
    await c.post(`/v1/invoices/${draft.id}/transition`, { action: 'send' });
    const seen = await h.get(`/v1/invoices/${draft.id}`);
    expect(seen.body.status).toBe('viewed');
    expect(seen.body.balanceCents).toBe(500_000);
    expect((await h.get('/v1/portal/overview')).body.unpaidInvoices.map((i: any) => i.id)).toContain(draft.id);
    const paid = await h.post(`/v1/invoices/${draft.id}/pay`, { method: 'card' });
    expect(paid.status).toBe(200);
    expect(paid.body.paid).toBe(true);
    const after = (await c.get(`/v1/invoices/${draft.id}`)).body;
    expect(after.status).toBe('paid');
    expect(after.payments[0]).toMatchObject({ method: 'card', provider: 'demo', amountCents: 500_000 });
    expect((await h.post(`/v1/invoices/${draft.id}/pay`, { method: 'card' })).status).toBe(409);
    // Manual payment recording stays an office-only action.
    expect((await h.post(`/v1/invoices/${draft.id}/payments`, { amountCents: 100, method: 'cash' })).status).toBe(403);
    const estimator = await inviteMember(app, owner, 'estimator', { projectIds: [project.id] });
    expect((await api(app, estimator).post(`/v1/invoices/${draft.id}/pay`, { method: 'card' })).status).toBe(403);
  });
});

describe('standard selections sheet', () => {
  it('applies the standard checklist once, records ticks and choices, prints as a sheet, and takes the client signature', async () => {
    const c = api(app, owner);
    const { project, homeowner } = await projectWithClient('Sheet House');
    const h = api(app, homeowner);
    const template = await c.get('/v1/selections/template');
    expect(template.status).toBe(200);
    expect(template.body.templates.map((t: any) => t.key)).toEqual(['checklist', 'schematic']);
    const checklist = template.body.templates[0];
    expect(checklist.sections.map((s: any) => s.key)).toEqual(expect.arrayContaining(['flooring', 'stairs', 'doors', 'cabinetry', 'plumbing', 'trim', 'fireplace', 'walls', 'electrical', 'exterior', 'windows', 'mechanical']));
    const total = checklist.sections.reduce((n: number, s: any) => n + s.items.length, 0);

    // Apply everything, released to the client. Re-applying adds nothing.
    const applied = await c.post(`/v1/projects/${project.id}/selections/apply-template`, { release: true });
    expect(applied.status).toBe(200);
    expect(applied.body.created).toBe(total);
    const again = await c.post(`/v1/projects/${project.id}/selections/apply-template`, { release: true });
    expect(again.body.created).toBe(0);
    expect(again.body.skipped).toBe(total);
    const wood = applied.body.items.find((s: any) => s.templateKey === 'flooring.wood');
    expect(wood.status).toBe('released');
    expect(wood.section).toBe('flooring');
    expect(wood.options.map((o: any) => o.name)).toContain('Red Oak');
    expect(wood.options.find((o: any) => o.name === 'Red Oak').isRecommended).toBe(true);
    expect(wood.defaultSpec).toMatch(/Red Oak/);
    const hardware = applied.body.items.find((s: any) => s.templateKey === 'doors.hardware');
    expect(hardware.options).toHaveLength(0);
    expect(hardware.areas).toEqual(['Door Knobs', 'Hinges', 'Accessories']);

    // The client sees the sheet and fills it in: a single choice, a choice with areas, and a tick-all-that-apply item.
    const sheet = await h.get(`/v1/projects/${project.id}/selections/sheet`);
    expect(sheet.status).toBe(200);
    expect(sheet.body.counts).toMatchObject({ total, decided: 0, released: total });
    expect(sheet.body.sections[0].label).toBe('Flooring');
    const oak = wood.options.find((o: any) => o.name === 'White Oak');
    expect((await h.post(`/v1/selections/${wood.id}/decide`, { optionId: oak.id })).body.selectedOptionId).toBe(oak.id);
    const tile = applied.body.items.find((s: any) => s.templateKey === 'flooring.tile');
    const ceramic = tile.options.find((o: any) => o.name === 'Ceramic');
    const tiled = await h.post(`/v1/selections/${tile.id}/decide`, { optionId: ceramic.id, chosenAreas: ['Laundry', 'Master Bath', 'Not a real area'] });
    expect(tiled.body.chosenAreas).toEqual(['Laundry', 'Master Bath']);
    expect(tiled.body.decidedByName).toBe('Pat Portal');
    expect(tiled.body.changeOrderId).toBeNull(); // unpriced choices never draft change orders
    expect((await h.post(`/v1/selections/${hardware.id}/decide`, {})).status).toBe(400);
    expect((await h.post(`/v1/selections/${hardware.id}/decide`, { chosenAreas: ['Door Knobs'] })).body.status).toBe('decided');
    // Unpriced sheet items can be revised until the sheet is signed.
    const maple = wood.options.find((o: any) => o.name === 'Maple');
    expect((await h.post(`/v1/selections/${wood.id}/decide`, { optionId: maple.id })).body.selectedOptionId).toBe(maple.id);

    // The written-in list: fill-in answers, "match existing", and a comment; both lists share one sheet.
    const sch = await c.post(`/v1/projects/${project.id}/selections/apply-template`, { templateKey: 'schematic', release: true });
    expect(sch.body.created).toBeGreaterThan(20);
    const roofing = sch.body.items.find((s: any) => s.templateKey === 'sch.roofing');
    expect(roofing.fields).toEqual(['Shingle color']);
    const asphalt = roofing.options.find((o: any) => o.name === 'Asphalt');
    const roofed = await h.post(`/v1/selections/${roofing.id}/decide`, { optionId: asphalt.id, answers: { 'Shingle color': 'Weathered Wood', Ignored: '  ' }, note: 'Match the garage' });
    expect(roofed.body.answers).toEqual({ 'Shingle color': 'Weathered Wood' });
    expect(roofed.body.comment).toBe('Match the garage');
    const paint = sch.body.items.find((s: any) => s.templateKey === 'sch.paint');
    expect((await h.post(`/v1/selections/${paint.id}/decide`, { matchExisting: true })).body.matchExisting).toBe(true);
    const merged = await h.get(`/v1/projects/${project.id}/selections/sheet`);
    expect(merged.body.sections.map((x: any) => x.key)).toEqual(expect.arrayContaining(['flooring', 'sch_exterior', 'sch_interior']));
    expect(merged.body.counts.decided).toBe(5);

    // Signing snapshots the sheet as it stands; the record is append-only and shows on the sheet.
    const signed = await h.post(`/v1/projects/${project.id}/selections/sign`, { signerName: 'ignored for portal users', signatureText: 'Pat Portal' });
    expect(signed.status).toBe(200);
    expect(signed.body.signoffs).toHaveLength(1);
    expect(signed.body.signoffs[0]).toMatchObject({ signerName: 'Pat Portal', decidedCount: 5, byClient: true });
    expect((await h.post(`/v1/selections/${wood.id}/decide`, { optionId: oak.id })).status).toBe(409); // signed: frozen
    const teamView = await c.get(`/v1/projects/${project.id}/selections/sheet`);
    expect(teamView.body.counts.decided).toBe(5);
    expect(teamView.body.project.clientName).toBeTruthy();
    const activity = await c.get(`/v1/projects/${project.id}/activity`);
    expect(activity.body.items.some((a: any) => a.summary.includes('signed the selections sheet'))).toBe(true);
    // Publishing saves the sheet to Documents → Specifications where the crew and subcontractors can read it.
    const published = await c.post(`/v1/projects/${project.id}/selections/publish`, { vendorVisible: true });
    expect(published.status).toBe(201);
    expect(published.body.contentType).toBe('text/html');
    expect(published.body.vendorVisible).toBe(true);
    expect(published.body.name).toContain('5 of');
    const crew = await inviteMember(app, owner, 'field_crew', { projectIds: [project.id] });
    const crewSheet = await api(app, crew).get(`/v1/projects/${project.id}/selections/sheet`);
    expect(crewSheet.status).toBe(200);
    expect(crewSheet.body.counts.decided).toBe(5);
    expect((await api(app, crew).post(`/v1/projects/${project.id}/selections/sign`, { signerName: 'Nope' })).status).toBe(403);
    // Nothing to sign on an empty project.
    const empty = await createProject(app, owner, { name: 'Empty' });
    expect((await c.post(`/v1/projects/${empty.id}/selections/sign`, { signerName: 'Olivia' })).status).toBe(409);
    expect((await c.post(`/v1/projects/${empty.id}/selections/publish`, {})).status).toBe(409);
  });
});
