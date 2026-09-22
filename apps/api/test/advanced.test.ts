import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createProject, createTestApp, inviteMember, registerOrg, type Actor, type TestApp } from './helpers.js';

let app: TestApp;
let owner: Actor;
beforeAll(async () => { app = await createTestApp(); owner = await registerOrg(app, { org: 'Phase Seven Builders' }); });
afterAll(async () => { await app.close(); });

describe('leads / CRM', () => {
  it('moves a lead through the pipeline, logs touches, and converts it into a client and project', async () => {
    const c = api(app, owner);
    const created = await c.post('/v1/leads', { name: 'Garcia garage conversion', contactName: 'Luis Garcia', contactEmail: 'luis@example.test', source: 'referral', estimatedValueCents: 8_500_000, projectType: 'remodel', notes: 'Wants to start in spring.' });
    expect(created.status).toBe(201);
    expect(created.body.stage).toBe('new');
    expect(created.body.ownerUserId).toBe(owner.userId);
    const id = created.body.id;

    const moved = await c.post(`/v1/leads/${id}/move`, { stage: 'qualified' });
    expect(moved.body.stage).toBe('qualified');
    const logged = await c.post(`/v1/leads/${id}/activities`, { kind: 'call', body: 'Walked the site. Budget confirmed.', dueAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(logged.status).toBe(201);
    expect(logged.body.nextFollowUpAt).toBeTruthy();
    expect(logged.body.activities.map((a: any) => a.kind)).toEqual(expect.arrayContaining(['call', 'stage']));

    const board = await c.get('/v1/leads/board');
    expect(board.body.columns.find((col: any) => col.stage === 'qualified').leads.map((l: any) => l.id)).toContain(id);
    expect(board.body.columns.find((col: any) => col.stage === 'qualified').valueCents).toBe(8_500_000);

    // Cannot mark won without converting.
    expect((await c.post(`/v1/leads/${id}/move`, { stage: 'won' })).status).toBe(409);
    const converted = await c.post(`/v1/leads/${id}/convert`, { contractValueCents: 9_000_000 });
    expect(converted.status).toBe(200);
    expect(converted.body.lead.stage).toBe('won');
    expect(converted.body.project.name).toBe('Garcia garage conversion');
    expect(converted.body.project.contractValueCents).toBe(9_000_000);
    expect(converted.body.project.clientId).toBe(converted.body.lead.clientId);
    const client = await c.get(`/v1/clients/${converted.body.lead.clientId}`);
    expect(client.body.displayName).toBe('Luis Garcia');
    expect(client.body.contacts[0].email).toBe('luis@example.test');
    expect((await c.post(`/v1/leads/${id}/convert`, {})).status).toBe(409);

    // Lost leads keep the reason; the pipeline report counts both.
    const lost = await c.post('/v1/leads', { name: 'Nguyen deck', estimatedValueCents: 1_200_000, source: 'website' });
    await c.post(`/v1/leads/${lost.body.id}/move`, { stage: 'lost', lostReason: 'Went with a cheaper bid' });
    expect((await c.get(`/v1/leads/${lost.body.id}`)).body.lostReason).toBe('Went with a cheaper bid');
    const open = await c.get('/v1/leads?stage=open');
    expect(open.body.items.map((l: any) => l.id)).not.toContain(id);
    const pipeline = await c.get('/v1/reports/pipeline');
    expect(pipeline.body.wonCount).toBe(1);
    expect(pipeline.body.lostCount).toBe(1);
    expect(pipeline.body.winRateBp).toBe(5000);
    expect(pipeline.body.sources.find((s: any) => s.source === 'referral').wonCount).toBe(1);

    // Field crew cannot see leads at all.
    const crew = await inviteMember(app, owner, 'field_crew');
    expect((await api(app, crew).get('/v1/leads')).status).toBe(403);
  });
});

describe('reports', () => {
  it('produces job cost, receivables aging and time reports as JSON and CSV', async () => {
    const c = api(app, owner);
    const project = await createProject(app, owner, { name: 'Report House', contractValueCents: 10_000_000 });
    // An invoice sent 45 days ago and half paid → 31-60 day bucket.
    const inv = await c.post(`/v1/projects/${project.id}/invoices`, { title: 'Draw 1', billingType: 'progress', issueDate: '2026-07-01', dueDate: new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10), taxBp: 0, retainageBp: 0, notes: '', terms: '', lines: [{ description: 'Mobilization', quantityThousandths: 1000, unitPriceCents: 200_000, taxable: false }] });
    expect(inv.status).toBe(201);
    await c.post(`/v1/invoices/${inv.body.id}/transition`, { action: 'send' });
    await c.post(`/v1/invoices/${inv.body.id}/payments`, { amountCents: 50_000, method: 'check', notes: '' });
    const aging = await c.get('/v1/reports/ar_aging');
    expect(aging.status).toBe(200);
    const row = aging.body.rows.find((r: any) => r.invoiceId === inv.body.id);
    expect(row.balanceCents).toBe(150_000);
    expect(row.bucket).toBe('days_31_60');
    expect(aging.body.buckets.days_31_60).toBeGreaterThanOrEqual(150_000);
    expect(aging.body.byClient.length).toBeGreaterThan(0);

    const catalog = await c.get('/v1/reports');
    expect(catalog.body.map((r: any) => r.key)).toEqual(expect.arrayContaining(['job_cost', 'ar_aging', 'time_by_project', 'pipeline']));
    const job = await c.get('/v1/reports/job_cost?status=all');
    expect(job.status).toBe(200);
    const jr = job.body.rows.find((r: any) => r.projectId === project.id);
    expect(jr.revisedContractCents).toBe(10_000_000);
    expect(jr.invoicedCents).toBe(200_000);
    expect(jr.paidCents).toBe(50_000);
    expect(job.body.totals.invoicedCents).toBeGreaterThanOrEqual(200_000);

    // Time report groups hours by project and person.
    const clockIn = new Date(Date.now() - 2 * 86_400_000); clockIn.setUTCHours(13, 0, 0, 0);
    const clockOut = new Date(clockIn.getTime() + 8 * 3600_000);
    await c.post('/v1/time/entries', { projectId: project.id, clockInAt: clockIn.toISOString(), clockOutAt: clockOut.toISOString(), breakSeconds: 1800, notes: '' });
    const time = await c.get('/v1/reports/time_by_project');
    const tr = time.body.rows.find((r: any) => r.projectId === project.id);
    expect(tr.seconds).toBe(7.5 * 3600);
    expect(tr.people[0].name).toBe('Olivia Owner');
    expect(time.body.totals.entries).toBeGreaterThanOrEqual(1);

    const csv = await c.get('/v1/reports/ar_aging?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.raw.headers['content-type']).toContain('text/csv');
    expect(csv.raw.body.split('\n')[0]).toBe('Invoice,Title,Project,Client,Issued,Due,Total,Paid,Balance,Days overdue,Bucket');
    expect(csv.raw.body).toContain('Draw 1');
    expect((await c.get('/v1/reports/nope')).status).toBe(400);

    // Reports respect the underlying permission: an office user without budget access sees no job cost report.
    const crew = await inviteMember(app, owner, 'field_crew', { projectIds: [project.id] });
    expect((await api(app, crew).get('/v1/reports')).status).toBe(403);
  });
});

describe('automations', () => {
  it('runs actions when the matching activity is recorded, and evaluates scheduled triggers once per object', async () => {
    const c = api(app, owner);
    const pm = await inviteMember(app, owner, 'project_manager', { firstName: 'Pat', lastName: 'Manager' });
    const project = await createProject(app, owner, { name: 'Automation Villa', memberUserIds: [pm.userId] });
    const catalog = await c.get('/v1/automations/catalog');
    expect(catalog.status).toBe(200);
    expect(catalog.body.events.find((e: any) => e.key === 'invoice.overdue').scheduled).toBe(true);
    expect(catalog.body.templates.length).toBeGreaterThan(3);

    // Activity trigger: completing a task creates a to-do for the managers and notifies the team.
    const created = await c.post('/v1/automations', { name: 'Task done → QA check', description: '', trigger: { event: 'task.completed', projectId: null }, actions: [
      { type: 'create_task', name: 'QA check: {{object}}', description: 'Completed by {{actor}}', daysUntilDue: 1, priority: 'high', assignTo: 'project_managers' },
      { type: 'notify', to: 'project_team', title: '{{object}} is done on {{project}}', body: '{{summary}}' },
      { type: 'email', to: 'address', address: 'owner-inbox@example.test', subject: 'Done: {{object}}', body: '{{summary}} on {{date}}' },
    ] });
    expect(created.status).toBe(201);
    const task = await c.post(`/v1/projects/${project.id}/tasks`, { kind: 'todo', name: 'Hang drywall' });
    const before = app.email.sent.length;
    await c.patch(`/v1/tasks/${task.body.id}`, { status: 'complete' });
    const tasks = await c.get(`/v1/projects/${project.id}/tasks?status=open`);
    const qa = tasks.body.items.find((t: any) => t.name === 'QA check: Hang drywall');
    expect(qa).toBeTruthy();
    expect(qa.description).toContain('Olivia Owner');
    expect(qa.assignees.map((a: any) => a.userId)).toContain(owner.userId); // the project creator is its manager
    expect(app.email.sent.length).toBe(before + 1);
    expect(app.email.sent.at(-1)!.subject).toBe('Done: Hang drywall');
    const pmNotifications = await api(app, pm).get('/v1/notifications');
    expect(pmNotifications.body.items.some((n: any) => n.title === 'Hang drywall is done on Automation Villa')).toBe(true);
    const runs = await c.get(`/v1/automations/runs?automationId=${created.body.id}`);
    expect(runs.body.items[0].status).toBe('succeeded');
    expect(runs.body.items[0].output.map((o: any) => o.action)).toEqual(['create_task', 'notify', 'email']);
    expect((await c.get(`/v1/automations/${created.body.id}`)).body.runCount).toBe(1);
    // The automation's own to-do creation does not re-trigger anything (no loop), and a paused automation stays quiet.
    await c.patch(`/v1/automations/${created.body.id}`, { enabled: false });
    const t2 = await c.post(`/v1/projects/${project.id}/tasks`, { kind: 'todo', name: 'Paint' });
    await c.patch(`/v1/tasks/${t2.body.id}`, { status: 'complete' });
    expect((await c.get(`/v1/automations/runs?automationId=${created.body.id}`)).body.items).toHaveLength(1);
    const activity = await c.get(`/v1/projects/${project.id}/activity`);
    expect(activity.body.items.some((a: any) => a.actorKind === 'system' && a.summary.includes('QA check'))).toBe(true);

    // Scheduled trigger: an overdue invoice fires once, not on every check.
    const inv = await c.post(`/v1/projects/${project.id}/invoices`, { title: 'Late draw', billingType: 'progress', issueDate: '2026-06-01', dueDate: '2026-06-15', taxBp: 0, retainageBp: 0, notes: '', terms: '', lines: [{ description: 'Work', quantityThousandths: 1000, unitPriceCents: 100_000, taxable: false }] });
    await c.post(`/v1/invoices/${inv.body.id}/transition`, { action: 'send' });
    const overdue = await c.post('/v1/automations', { name: 'Overdue invoice follow-up', description: '', trigger: { event: 'invoice.overdue', projectId: project.id }, actions: [{ type: 'create_task', name: 'Chase {{object}}', description: '{{summary}}', daysUntilDue: 0, priority: 'high', assignTo: 'project_managers' }] });
    const first = await c.post('/v1/automations/run-scheduled');
    expect(first.body.fired).toBe(1);
    const second = await c.post('/v1/automations/run-scheduled');
    expect(second.body.fired).toBe(0);
    const chase = (await c.get(`/v1/projects/${project.id}/tasks?status=open`)).body.items.filter((t: any) => t.name.startsWith('Chase '));
    expect(chase).toHaveLength(1);
    expect(chase[0].description).toMatch(/days past due/);
    await c.delete(`/v1/automations/${overdue.body.id}`);
    expect((await c.get(`/v1/automations/${overdue.body.id}`)).status).toBe(404);

    // Only automations.manage can see or change automations.
    const estimator = await inviteMember(app, owner, 'estimator');
    expect((await api(app, estimator).get('/v1/automations')).status).toBe(403);
  });
});
