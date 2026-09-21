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
    log('seed complete');
    return true;
}
