import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createProject, createTestApp, inviteMember, registerOrg, type Actor, type TestApp } from './helpers.js';

let app: TestApp;
let a: Actor; let b: Actor; let projectA: any; let clientA: any;
beforeAll(async () => {
  app = await createTestApp();
  a = await registerOrg(app, { org: 'Tenant A' });
  b = await registerOrg(app, { org: 'Tenant B' });
  projectA = await createProject(app, a, { name: 'A only' });
  clientA = (await api(app, a).post('/v1/clients', { displayName: 'Client of A' })).body;
});
afterAll(async () => { await app.close(); });

describe('tenant isolation', () => {
  it('never lists or reads another organization records', async () => {
    expect((await api(app, b).get('/v1/projects')).body.items).toHaveLength(0);
    expect((await api(app, b).get(`/v1/projects/${projectA.id}`)).status).toBe(404);
    expect((await api(app, b).get(`/v1/clients/${clientA.id}`)).status).toBe(404);
    expect((await api(app, b).patch(`/v1/projects/${projectA.id}`, { name: 'pwned' })).status).toBe(404);
    expect((await api(app, b).post(`/v1/projects/${projectA.id}/archive`)).status).toBe(404);
    expect((await api(app, b).get(`/v1/projects/${projectA.id}/schedule`)).status).toBe(404);
    expect((await api(app, b).post(`/v1/projects/${projectA.id}/tasks`, { name: 'x' })).status).toBe(404);
    expect((await api(app, b).post(`/v1/projects/${projectA.id}/daily-logs`, { logDate: '2026-06-01' })).status).toBe(404);
    const search = await api(app, b).get('/v1/search?q=A%20only');
    expect(search.body.results).toHaveLength(0);
    const activity = await api(app, b).get('/v1/activity');
    expect(activity.body.items.every((x: any) => x.organizationId === b.orgId)).toBe(true);
  });

  it('cannot reference another organization client when creating a project', async () => {
    const res = await api(app, b).post('/v1/projects', { name: 'Steal client', clientId: clientA.id });
    expect(res.status).toBe(404);
  });

  it('cannot use a foreign organization id header', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/v1/projects', headers: { authorization: `Bearer ${b.token}`, 'x-organization-id': a.orgId } });
    expect(res.statusCode).toBe(403);
  });

  it('restricted roles only see assigned projects', async () => {
    const crew = await inviteMember(app, a, 'field_crew');
    const second = await createProject(app, a, { name: 'Assigned', memberUserIds: [crew.userId] });
    const list = await api(app, crew).get('/v1/projects?status=all');
    expect(list.body.items.map((p: any) => p.id)).toEqual([second.id]);
    expect((await api(app, crew).get(`/v1/projects/${projectA.id}`)).status).toBe(404);
    expect((await api(app, crew).get(`/v1/projects/${second.id}`)).status).toBe(200);
    const dash = await api(app, crew).get('/v1/dashboard');
    expect(dash.body.activeProjects.items.map((p: any) => p.id)).toEqual([second.id]);
    expect(dash.body.unpaidInvoices).toBeUndefined(); // no invoices.read
  });

  it('permission checks are enforced server-side for every mutation', async () => {
    const crew = await inviteMember(app, a, 'field_crew', { projectIds: [projectA.id] });
    expect((await api(app, crew).post('/v1/projects', { name: 'nope' })).status).toBe(403);
    expect((await api(app, crew).post('/v1/clients', { displayName: 'nope' })).status).toBe(403);
    expect((await api(app, crew).get('/v1/clients')).status).toBe(403);
    expect((await api(app, crew).patch(`/v1/projects/${projectA.id}`, { name: 'nope' })).status).toBe(403);
    expect((await api(app, crew).post(`/v1/projects/${projectA.id}/phases`, { name: 'nope' })).status).toBe(403);
    // but can read the schedule and post a daily log on the assigned project
    expect((await api(app, crew).get(`/v1/projects/${projectA.id}/schedule`)).status).toBe(200);
    expect((await api(app, crew).post(`/v1/projects/${projectA.id}/daily-logs`, { logDate: '2026-06-01', summary: 'Poured footings' })).status).toBe(201);
  });

  it('external client role sees only client-visible data', async () => {
    const client = await inviteMember(app, a, 'client', { projectIds: [projectA.id] });
    await api(app, a).post(`/v1/projects/${projectA.id}/daily-logs`, { logDate: '2026-06-02', summary: 'internal note', clientVisible: false });
    await api(app, a).post(`/v1/projects/${projectA.id}/daily-logs`, { logDate: '2026-06-03', summary: 'shared update', clientVisible: true });
    const logs = await api(app, client).get(`/v1/projects/${projectA.id}/daily-logs`);
    expect(logs.status).toBe(200);
    expect(logs.body.items.map((l: any) => l.summary)).toEqual(['shared update']);
    expect((await api(app, client).get('/v1/clients')).status).toBe(403);
  });
});
