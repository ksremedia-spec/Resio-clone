/**
 * Demo/seed data: one organization with a full team, clients, projects,
 * schedules, daily logs, documents and messages. Runs through the services
 * so every record is created exactly as the app would create it (with audit
 * entries and notifications). Safe to run repeatedly: it skips when the demo
 * owner already exists. Shared by the Node seed script and the browser demo.
 */
import { eq } from 'drizzle-orm';
import type { Services } from '../services/index.js';
import type { Db } from './pglite-shared.js';
import { users } from './schema/index.js';

export const DEMO_OWNER = { email: 'owner@demo.buildline.app', password: 'demo-password-123' };

export async function seedDemo(services: Services, db: Db, log: (m: string) => void = () => {}): Promise<boolean> {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_OWNER.email)).limit(1);
    if (existing) { log('demo data already present; skipping'); return false; }

    const session = await services.auth.register({ email: DEMO_OWNER.email, password: DEMO_OWNER.password, firstName: 'Dana', lastName: 'Ortiz', organizationName: 'Ridgeline Builders' });
    const auth = await services.auth.authenticate(session.token);
    const owner = (await services.auth.buildContext(auth!, session.activeOrganizationId, {}))!;
    log(`organization ${owner.organizationId} created (owner ${DEMO_OWNER.email} / ${DEMO_OWNER.password})`);

    const roles = await services.organizations.listRoles(owner);
    const roleId = (key: string) => roles.find((r) => r.key === key)!.id;
    const people = [
      { key: 'project_manager', firstName: 'Marcus', lastName: 'Lee', email: 'marcus@demo.buildline.app' },
      { key: 'estimator', firstName: 'Priya', lastName: 'Shah', email: 'priya@demo.buildline.app' },
      { key: 'office', firstName: 'Tom', lastName: 'Nguyen', email: 'tom@demo.buildline.app' },
      { key: 'field_supervisor', firstName: 'Rosa', lastName: 'Martinez', email: 'rosa@demo.buildline.app' },
      { key: 'field_crew', firstName: 'Jake', lastName: 'Miller', email: 'jake@demo.buildline.app' },
    ];
    const members: Record<string, string> = {};
    for (const p of people) {
      const inv = await services.organizations.invite(owner, { email: p.email, roleId: roleId(p.key), firstName: p.firstName, lastName: p.lastName });
      const token = new URL(inv.acceptUrl!).searchParams.get('token')!;
      const res = await services.organizations.acceptInvitation({ token, password: DEMO_OWNER.password, firstName: p.firstName, lastName: p.lastName }, null);
      members[p.key] = res.userId;
    }
    log(`invited ${people.length} team members (password ${DEMO_OWNER.password})`);

    const smith = await services.clients.create(owner, { displayName: 'Jane & John Smith', email: 'smiths@example.com', phone: '512-555-0142', billingAddress: { line1: '412 Oak Hollow Dr', city: 'Austin', region: 'TX', postalCode: '78704' }, notes: 'Referred by the Bakers. Prefers evening calls.', contacts: [{ firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', isPrimary: true, notes: '' }, { firstName: 'John', lastName: 'Smith', phone: '512-555-0143', isPrimary: false, notes: '' }] });
    const baker = await services.clients.create(owner, { displayName: 'Baker Family', email: 'bakers@example.com', notes: '', billingAddress: { line1: '88 Cedar Ln', city: 'Round Rock', region: 'TX' } });
    const harbor = await services.clients.create(owner, { displayName: 'Harbor Point HOA', companyName: 'Harbor Point HOA', email: 'board@harborpoint.example', notes: 'Board approves everything over $5k.' });

    const smithProject = await services.projects.create(owner, { name: 'Smith Residence — Kitchen & Primary Suite', status: 'active', type: 'remodel', contractType: 'fixed_price', clientId: smith.id, address: { line1: '412 Oak Hollow Dr', city: 'Austin', region: 'TX', postalCode: '78704', latitude: 30.245, longitude: -97.77 }, description: 'Full kitchen gut and primary bathroom expansion with new roofline over the addition.', startDate: '2026-09-01', targetEndDate: '2027-01-30', contractValueCents: 24_850_000, memberUserIds: [members.project_manager!, members.field_supervisor!, members.field_crew!, members.estimator!, members.office!] });
    const bakerProject = await services.projects.create(owner, { name: 'Baker Addition', status: 'pre_construction', type: 'addition', contractType: 'cost_plus', clientId: baker.id, address: { line1: '88 Cedar Ln', city: 'Round Rock', region: 'TX' }, description: '600 sq ft family room addition.', startDate: '2026-11-02', targetEndDate: '2027-03-15', contractValueCents: 14_200_000, memberUserIds: [members.project_manager!, members.estimator!] });
    const harborProject = await services.projects.create(owner, { name: 'Harbor Point Clubhouse Refresh', status: 'active', type: 'commercial', contractType: 'time_and_materials', clientId: harbor.id, address: { line1: '1 Harbor Point Way', city: 'Austin', region: 'TX' }, startDate: '2026-08-10', targetEndDate: '2026-11-20', contractValueCents: 9_600_000, memberUserIds: [members.project_manager!, members.field_supervisor!], description: '' });
    await services.projects.setFavorite(owner, smithProject.id, true);
    log('created 3 clients and 3 projects');

    const pm = (await services.auth.buildContext({ sessionId: null as unknown as string, user: (await db.select().from(users).where(eq(users.id, members.project_manager!)))[0]!, activeOrganizationId: owner.organizationId }, owner.organizationId, {}))!;
    const sup = (await services.auth.buildContext({ sessionId: null as unknown as string, user: (await db.select().from(users).where(eq(users.id, members.field_supervisor!)))[0]!, activeOrganizationId: owner.organizationId }, owner.organizationId, {}))!;

    // Schedule with phases, dependencies and assignments.
    const phases: Record<string, string> = {};
    for (const name of ['Demolition', 'Rough-in', 'Framing & Roof', 'Finishes']) phases[name] = (await services.schedule.createPhase(pm, smithProject.id, { name, clientVisible: true })).id;
    const demo = await services.schedule.createTask(pm, smithProject.id, { kind: 'schedule', name: 'Demo existing kitchen', phaseId: phases['Demolition'], startDate: '2026-09-14', durationDays: 3, status: 'complete', priority: 'medium', isMilestone: false, description: '', clientVisible: true, assigneeUserIds: [members.field_crew!] });
    const plumbing = await services.schedule.createTask(pm, smithProject.id, { kind: 'schedule', name: 'Plumbing rough-in', phaseId: phases['Rough-in'], startDate: '2026-09-17', durationDays: 4, status: 'in_progress', priority: 'high', isMilestone: false, description: 'Relocate sink and add pot filler.', clientVisible: true, predecessors: [{ taskId: demo.id, type: 'FS', lagDays: 0 }], assigneeUserIds: [members.field_supervisor!] });
    const electrical = await services.schedule.createTask(pm, smithProject.id, { kind: 'schedule', name: 'Electrical rough-in', phaseId: phases['Rough-in'], startDate: '2026-09-21', durationDays: 3, status: 'not_started', priority: 'high', isMilestone: false, description: '', clientVisible: true, predecessors: [{ taskId: plumbing.id, type: 'SS', lagDays: 2 }], assigneeUserIds: [members.field_crew!] });
    const framing = await services.schedule.createTask(pm, smithProject.id, { kind: 'schedule', name: 'Frame addition & roof', phaseId: phases['Framing & Roof'], startDate: '2026-09-24', durationDays: 8, status: 'not_started', priority: 'high', isMilestone: false, description: '', clientVisible: true, predecessors: [{ taskId: plumbing.id, type: 'FS', lagDays: 0 }], assigneeUserIds: [members.field_crew!, members.field_supervisor!] });
    const inspection = await services.schedule.createTask(pm, smithProject.id, { kind: 'schedule', name: 'Framing inspection', phaseId: phases['Framing & Roof'], startDate: '2026-10-06', durationDays: 0, status: 'not_started', priority: 'medium', isMilestone: true, description: '', clientVisible: true, predecessors: [{ taskId: framing.id, type: 'FS', lagDays: 0 }] });
    await services.schedule.createTask(pm, smithProject.id, { kind: 'schedule', name: 'Drywall & paint', phaseId: phases['Finishes'], startDate: '2026-10-07', durationDays: 7, status: 'not_started', priority: 'medium', isMilestone: false, description: '', clientVisible: true, predecessors: [{ taskId: inspection.id, type: 'FS', lagDays: 1 }, { taskId: electrical.id, type: 'FS', lagDays: 0 }] });
    await services.schedule.createTask(pm, smithProject.id, { kind: 'schedule', name: 'Cabinet install', phaseId: phases['Finishes'], startDate: '2026-10-19', durationDays: 4, status: 'not_started', priority: 'medium', isMilestone: false, description: 'Cabinets on site 10/16.', clientVisible: true, assigneeUserIds: [members.field_crew!] });
    await services.schedule.createTask(pm, smithProject.id, { kind: 'todo', name: 'Order pot filler', dueDate: '2026-09-19', status: 'not_started', priority: 'high', isMilestone: false, description: 'Client chose brushed nickel.', clientVisible: false, assigneeUserIds: [members.project_manager!] });
    await services.schedule.createTask(pm, smithProject.id, { kind: 'todo', name: 'Confirm tile delivery window', dueDate: '2026-09-25', status: 'not_started', priority: 'medium', isMilestone: false, description: '', clientVisible: false, assigneeUserIds: [members.office!] });
    await services.schedule.createTask(pm, harborProject.id, { kind: 'schedule', name: 'Repaint lobby', startDate: '2026-09-21', durationDays: 5, status: 'in_progress', priority: 'medium', isMilestone: false, description: '', clientVisible: true, assigneeUserIds: [members.field_supervisor!] });
    await services.schedule.createTask(pm, bakerProject.id, { kind: 'todo', name: 'Submit permit application', dueDate: '2026-10-01', status: 'not_started', priority: 'high', isMilestone: false, description: '', clientVisible: false, assigneeUserIds: [members.project_manager!] });
    log('created schedule with phases, dependencies and to-dos');

    await services.dailyLogs.create(sup, smithProject.id, { logDate: '2026-09-16', summary: 'Demo complete. Hauled 2 dumpsters. Found old galvanized supply lines behind the sink wall — will need replacing (see issue).', tags: ['demo'], clientVisible: true, status: 'submitted', weather: { conditions: 'Sunny', temperatureHighF: 94, temperatureLowF: 71, precipitationIn: 0, windMph: 6, source: 'manual' }, entries: [{ type: 'crew', trade: 'Laborers', headcount: 3, hours: 8, text: '' }, { type: 'work', text: 'Removed cabinets, countertops and tile floor.', taskId: demo.id }, { type: 'issue', text: 'Galvanized supply lines corroded; recommend replacing to the main.' }, { type: 'equipment', text: '20 yd dumpster ×2' }], photoDocumentIds: [], attachmentDocumentIds: [] });
    await services.dailyLogs.create(sup, smithProject.id, { logDate: '2026-09-18', summary: 'Plumbing rough-in underway. Pot filler line stubbed.', tags: ['plumbing'], clientVisible: true, status: 'submitted', weather: { conditions: 'Partly cloudy', temperatureHighF: 89, temperatureLowF: 70, precipitationIn: 0, windMph: 9, source: 'manual' }, entries: [{ type: 'crew', trade: 'Plumbers', headcount: 2, hours: 8, text: '' }, { type: 'work', text: 'Drain and vent for relocated sink complete.', taskId: plumbing.id }, { type: 'delay', delayCause: 'material', delayHours: 1.5, text: 'Waited on fittings from supply house.' }], photoDocumentIds: [], attachmentDocumentIds: [] });
    await services.dailyLogs.create(sup, harborProject.id, { logDate: '2026-09-18', summary: 'Prepped lobby walls; primer on north wall.', tags: [], clientVisible: true, status: 'submitted', entries: [{ type: 'crew', trade: 'Painters', headcount: 2, hours: 7, text: '' }], photoDocumentIds: [], attachmentDocumentIds: [] });
    log('created daily logs');

    await services.documents.createFolder(pm, { projectId: smithProject.id, name: 'Plans', kind: 'plans', clientVisible: true, vendorVisible: true });
    await services.documents.createFolder(pm, { projectId: smithProject.id, name: 'Photos', kind: 'photos', clientVisible: true, vendorVisible: false });
    await services.documents.createFolder(pm, { projectId: smithProject.id, name: 'Contracts', kind: 'contracts', clientVisible: true, vendorVisible: false });
    await services.documents.upload(pm, { stream: new TextEncoder().encode('%PDF-1.4\n% Buildline demo contract placeholder\n'), filename: 'Smith-Contract-signed.pdf', contentType: 'application/pdf' }, { projectId: smithProject.id, name: 'Smith Contract (signed)', tags: ['contract'], clientVisible: true });
    await services.documents.upload(pm, { stream: new TextEncoder().encode('%PDF-1.4\n% Buildline demo plan set placeholder\n'), filename: 'A-101 Floor Plan.pdf', contentType: 'application/pdf' }, { projectId: smithProject.id, name: 'A-101 Floor Plan', tags: ['plans'], clientVisible: true, vendorVisible: true });

    const thread = await services.messages.createThread(pm, { projectId: smithProject.id, kind: 'project', subject: 'Cabinet delivery', clientVisible: false, vendorVisible: false, initialMessage: 'Cabinets are confirmed for 10/16 delivery. Rosa, can your crew receive them?' });
    await services.messages.send(sup, thread.id, { body: 'Yes — we will have the garage cleared. Need the pot filler on site before then too.', mentions: [members.project_manager!], attachmentDocumentIds: [] });
    await services.messages.createThread(pm, { projectId: harborProject.id, kind: 'project', subject: 'Paint colour approval', clientVisible: true, vendorVisible: false, initialMessage: 'Board approved SW 7015 for the lobby.' });
    log('created documents and messages');

    // ---- money: catalog, vendors, estimate → budget, change order, purchasing, invoicing ----
    const codes = await services.catalog.listCostCodes(owner);
    const code = (name: string) => codes.find((c) => c.name === name)?.id ?? null;
    const items = [
      { name: 'Demolition — kitchen (per room)', costCodeId: code('Demolition'), unit: 'ea', unitCostCents: { labor: 240_000, other: 45_000 }, tags: ['demo', 'kitchen'] },
      { name: 'Shaker cabinets, painted', costCodeId: code('Cabinets & Millwork'), unit: 'lf', unitCostCents: { material: 42_000, labor: 9_500 }, tags: ['kitchen', 'cabinets'] },
      { name: 'Quartz countertop, installed', costCodeId: code('Countertops'), unit: 'sf', unitCostCents: { material: 6_500, subcontract: 2_500 }, tags: ['kitchen'] },
      { name: 'Plumbing rough-in — fixture', costCodeId: code('Plumbing'), unit: 'ea', unitCostCents: { subcontract: 65_000 }, tags: ['plumbing'] },
      { name: 'Electrical — recessed light', costCodeId: code('Electrical'), unit: 'ea', unitCostCents: { subcontract: 18_500 }, tags: ['electrical'] },
      { name: 'Tile floor, installed', costCodeId: code('Tile'), unit: 'sf', unitCostCents: { material: 900, subcontract: 1_400 }, tags: ['tile', 'bath'] },
      { name: 'Appliance allowance', costCodeId: code('Appliances'), unit: 'ea', unitCostCents: { material: 1_200_000 }, isAllowance: true, tags: ['kitchen', 'allowance'] },
    ];
    for (const i of items) await services.catalog.createCatalogItem(owner, { description: '', markupBp: null, vendorId: null, isAllowance: false, sourceUrl: null, ...i });
    const cabinetsVendor = await services.catalog.createVendor(owner, { name: 'Hill Country Cabinets', trade: 'Cabinetry', email: 'orders@hillcountrycabinets.example', phone: '512-555-0188', notes: 'Lead time 6 weeks. 50% deposit.' });
    const plumber = await services.catalog.createVendor(owner, { name: 'Bluebonnet Plumbing', trade: 'Plumbing', email: 'dispatch@bluebonnetplumbing.example', phone: '512-555-0121', notes: '' });
    await services.catalog.createVendor(owner, { name: 'Lone Star Electric', trade: 'Electrical', email: 'office@lonestarelectric.example', phone: '512-555-0166', notes: '' });
    log('created cost catalog and vendors');

    const estCtx = pm;
    await services.estimates.update(estCtx, smithProject.id, { taxBp: 825 });
    const sec = async (name: string) => (await services.estimates.createSection(estCtx, smithProject.id, { name, description: '', clientVisible: true })).sections.find((x) => x.name === name)!.id;
    const demoSec = await sec('Demolition & prep');
    const kitchenSec = await sec('Kitchen');
    const bathSec = await sec('Primary bath');
    const generalSec = await sec('General conditions');
    const line = (sectionId: string, name: string, extra: Record<string, unknown>) => services.estimates.createLine(estCtx, smithProject.id, { sectionId, name, description: '', quantityThousandths: 1000, unit: 'ea', unitCostCents: {}, taxable: false, isAllowance: false, isOptional: false, included: true, notes: '', clientVisible: true, ...extra });
    await line(demoSec, 'Demolition — kitchen', { costCodeId: code('Demolition'), unitCostCents: { labor: 240_000, other: 45_000 } });
    await line(demoSec, 'Dumpsters (3)', { costCodeId: code('Temporary Facilities'), quantityThousandths: 3000, unitCostCents: { other: 62_000 } });
    await line(kitchenSec, 'Shaker cabinets, painted', { costCodeId: code('Cabinets & Millwork'), quantityThousandths: 32_000, unit: 'lf', unitCostCents: { material: 42_000, labor: 9_500 }, taxable: true });
    await line(kitchenSec, 'Quartz countertops', { costCodeId: code('Countertops'), quantityThousandths: 68_000, unit: 'sf', unitCostCents: { material: 6_500, subcontract: 2_500 }, taxable: true });
    await line(kitchenSec, 'Plumbing rough-in and trim (sink, DW, pot filler)', { costCodeId: code('Plumbing'), quantityThousandths: 3000, unitCostCents: { subcontract: 65_000 } });
    await line(kitchenSec, 'Recessed lighting', { costCodeId: code('Electrical'), quantityThousandths: 12_000, unitCostCents: { subcontract: 18_500 } });
    await line(kitchenSec, 'Appliance allowance', { costCodeId: code('Appliances'), unitCostCents: { material: 1_200_000 }, isAllowance: true, taxable: true });
    await line(bathSec, 'Framing for addition', { costCodeId: code('Rough Carpentry / Framing'), unitCostCents: { labor: 1_450_000, material: 980_000 } });
    await line(bathSec, 'Roofing over addition', { costCodeId: code('Roofing'), unitCostCents: { subcontract: 1_120_000 } });
    await line(bathSec, 'Tile floor and shower', { costCodeId: code('Tile'), quantityThousandths: 210_000, unit: 'sf', unitCostCents: { material: 900, subcontract: 1_400 }, taxable: true });
    await line(bathSec, 'Plumbing fixtures allowance', { costCodeId: code('Plumbing'), unitCostCents: { material: 650_000 }, isAllowance: true, taxable: true });
    await line(generalSec, 'Permits & inspections', { costCodeId: code('Permits & Fees'), unitCostCents: { other: 380_000 } });
    await line(generalSec, 'Supervision (16 weeks)', { costCodeId: code('Supervision'), quantityThousandths: 16_000, unit: 'wk', unitCostCents: { labor: 95_000 } });
    await line(generalSec, 'Contingency', { costCodeId: code('Contingency'), unitCostCents: { other: 500_000 } });
    const locked = await services.estimates.lock(estCtx, smithProject.id, { applyContractValue: true });
    log(`estimate locked at ${(locked.totals.sellCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}; budget created`);
    // Baker: an estimate in progress, not yet locked.
    const bakerSec = (await services.estimates.createSection(estCtx, bakerProject.id, { name: 'Family room addition', description: '', clientVisible: true })).sections[0]!.id;
    await services.estimates.createLine(estCtx, bakerProject.id, { sectionId: bakerSec, name: 'Foundation and slab', description: '', quantityThousandths: 1000, unit: 'ea', unitCostCents: { subcontract: 1_850_000 }, taxable: false, isAllowance: false, isOptional: false, included: true, notes: '', clientVisible: true, costCodeId: code('Concrete') });
    await services.estimates.createLine(estCtx, bakerProject.id, { sectionId: bakerSec, name: 'Framing', description: '', quantityThousandths: 1000, unit: 'ea', unitCostCents: { labor: 1_400_000, material: 1_100_000 }, taxable: false, isAllowance: false, isOptional: false, included: true, notes: '', clientVisible: true, costCodeId: code('Rough Carpentry / Framing') });

    const budget = await services.budget.get(owner, smithProject.id);
    const bl = (name: string) => budget.lines.find((l) => l.name === name)!.id;
    const co1 = await services.changeOrders.create(pm, smithProject.id, { title: 'Add pantry cabinets and outlet', description: 'Client requested a 4 lf pantry run beside the refrigerator with a dedicated outlet.', reason: 'client_request', scheduleImpactDays: 2, lines: [
      { name: 'Pantry cabinets', budgetLineId: bl('Shaker cabinets, painted'), costCodeId: code('Cabinets & Millwork'), quantityThousandths: 4000, unit: 'lf', unitCostCents: { material: 42_000, labor: 9_500 }, taxable: true, description: '' },
      { name: 'Dedicated 20A outlet', costCodeId: code('Electrical'), quantityThousandths: 1000, unit: 'ea', unitCostCents: { subcontract: 32_000 }, taxable: false, description: '' },
    ] });
    await services.changeOrders.send(pm, co1.id, { message: 'Please review and approve by Friday.' });
    await services.changeOrders.decide(pm, co1.id, { decision: 'approved', decidedByName: 'Jane Smith', note: 'Approved by email 9/12.' });
    const co2 = await services.changeOrders.create(pm, smithProject.id, { title: 'Upgrade to slab-front cabinet doors', description: 'Swap shaker doors for flat slab fronts.', reason: 'design_change', scheduleImpactDays: 0, lines: [{ name: 'Door upgrade', budgetLineId: bl('Shaker cabinets, painted'), costCodeId: code('Cabinets & Millwork'), quantityThousandths: 32_000, unit: 'lf', unitCostCents: { material: 6_000 }, taxable: true, description: '' }] });
    await services.changeOrders.send(pm, co2.id, {});
    log('created change orders (one approved, one awaiting the client)');

    const po = await services.procurement.createPurchaseOrder(pm, smithProject.id, { vendorId: cabinetsVendor.id, title: 'Kitchen cabinets', notes: 'Deliver to garage. Call Rosa 30 min ahead.', lines: [
      { budgetLineId: bl('Shaker cabinets, painted'), costCodeId: code('Cabinets & Millwork'), description: 'Shaker cabinets, painted — 32 lf', quantityThousandths: 32_000, unit: 'lf', unitCostCents: 42_000 },
      { budgetLineId: bl('Shaker cabinets, painted'), costCodeId: code('Cabinets & Millwork'), description: 'Delivery', quantityThousandths: 1000, unit: 'ea', unitCostCents: 35_000 },
    ] });
    await services.procurement.transitionPurchaseOrder(owner, po.id, 'approve');
    await services.procurement.transitionPurchaseOrder(pm, po.id, 'issue');
    const deposit = await services.procurement.createBill(pm, { purchaseOrderId: po.id, vendorReference: 'HCC-4471', billDate: '2026-09-05', dueDate: '2026-09-20', taxCents: 0, notes: '50% deposit', lines: [{ purchaseOrderLineId: po.lines[0]!.id, budgetLineId: bl('Shaker cabinets, painted'), description: 'Cabinet deposit (50%)', amountCents: 672_000 }] });
    await services.procurement.transitionBill(owner, deposit.id, 'approve');
    await services.procurement.recordBillPayment(owner, deposit.id, { amountCents: 672_000, method: 'ach', reference: 'ACH 20918', notes: '' });
    const plumbPo = await services.procurement.createPurchaseOrder(pm, smithProject.id, { vendorId: plumber.id, title: 'Kitchen plumbing rough-in', notes: '', lines: [{ budgetLineId: bl('Plumbing rough-in and trim (sink, DW, pot filler)'), costCodeId: code('Plumbing'), description: 'Rough-in, 3 fixtures', quantityThousandths: 3000, unit: 'ea', unitCostCents: 65_000 }] });
    await services.procurement.transitionPurchaseOrder(owner, plumbPo.id, 'approve');
    await services.procurement.createBill(pm, { projectId: smithProject.id, vendorId: plumber.id, vendorReference: 'BP-1188', billDate: '2026-09-18', dueDate: '2026-10-18', taxCents: 0, notes: 'Not on a PO — check before approving.', lines: [{ budgetLineId: bl('Plumbing rough-in and trim (sink, DW, pot filler)'), description: 'Extra trip for pot filler line', amountCents: 28_500 }] });
    log('created purchase orders and bills');

    const draw1 = await services.invoices.create(owner, smithProject.id, { title: 'Draw 1 — mobilization and demolition', billingType: 'progress', issueDate: '2026-09-02', dueDate: '2026-09-16', taxBp: 825, retainageBp: 0, notes: 'Thank you for choosing Ridgeline.', terms: 'Due on receipt. 1.5% per month on late balances.', lines: [
      { description: 'Demolition — complete', budgetLineId: bl('Demolition — kitchen'), percentBp: 10_000, taxable: false },
      { description: 'Permits & inspections', budgetLineId: bl('Permits & inspections'), percentBp: 10_000, taxable: false },
      { description: 'Mobilization', quantityThousandths: 1000, unitPriceCents: 250_000, taxable: false },
    ] });
    await services.invoices.transition(owner, draw1.id, 'send');
    await services.invoices.recordPayment(owner, draw1.id, { amountCents: draw1.totalCents, method: 'check', reference: '2291', notes: '' });
    const draw2 = await services.invoices.create(owner, smithProject.id, { title: 'Draw 2 — cabinets ordered, rough-ins', billingType: 'progress', issueDate: '2026-09-15', dueDate: '2026-09-29', taxBp: 825, retainageBp: 0, notes: '', terms: '', lines: [
      { description: 'Cabinets — 50% (ordered)', budgetLineId: bl('Shaker cabinets, painted'), percentBp: 5_000, taxable: true },
      { description: 'Plumbing rough-in — 60%', budgetLineId: bl('Plumbing rough-in and trim (sink, DW, pot filler)'), percentBp: 6_000, taxable: false },
    ], changeOrderIds: [co1.id] });
    await services.invoices.transition(owner, draw2.id, 'send');
    await services.invoices.recordPayment(owner, draw2.id, { amountCents: 500_000, method: 'ach', reference: 'ACH 55120', notes: 'Partial' });
    await services.invoices.create(owner, smithProject.id, { title: 'Draw 3 — framing and roofing', billingType: 'progress', issueDate: '2026-10-01', taxBp: 825, retainageBp: 0, notes: '', terms: '', lines: [{ description: 'Framing — 50%', budgetLineId: bl('Framing for addition'), percentBp: 5_000, taxable: false }] });
    log('created invoices and payments');
    log('seed complete');
    return true;
}
