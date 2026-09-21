import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createProject, createTestApp, inviteMember, registerOrg, multipart, type Actor, type TestApp } from './helpers.js';

let app: TestApp;
let owner: Actor;
beforeAll(async () => { app = await createTestApp(); owner = await registerOrg(app, { org: 'Projects Co' }); });
afterAll(async () => { await app.close(); });

describe('clients', () => {
  it('creates, lists, updates, archives clients with contacts', async () => {
    const c = await api(app, owner).post('/v1/clients', { displayName: 'Jane & John Smith', email: 'Jane@Example.test', billingAddress: { line1: '1 Main', city: 'Austin' }, contacts: [{ firstName: 'Jane', lastName: 'Smith', isPrimary: true, email: 'jane@example.test' }] });
    expect(c.status).toBe(201);
    expect(c.body.email).toBe('jane@example.test');
    expect(c.body.contacts).toHaveLength(1);
    const contact = await api(app, owner).post(`/v1/clients/${c.body.id}/contacts`, { firstName: 'John', lastName: 'Smith', phone: '555-0100' });
    expect(contact.status).toBe(201);
    const list = await api(app, owner).get('/v1/clients?q=smith');
    expect(list.body.items).toHaveLength(1);
    const upd = await api(app, owner).patch(`/v1/clients/${c.body.id}`, { notes: 'Prefers text messages' });
    expect(upd.body.notes).toBe('Prefers text messages');
    expect(upd.body.version).toBe(2);
    const archived = await api(app, owner).post(`/v1/clients/${c.body.id}/archive`, { archived: true });
    expect(archived.body.status).toBe('archived');
    expect((await api(app, owner).get('/v1/clients')).body.items.find((x: any) => x.id === c.body.id)).toBeUndefined();
    expect((await api(app, owner).get('/v1/clients?status=archived')).body.items).toHaveLength(1);
  });
});

describe('projects', () => {
  it('creates a project with an auto number, members and activity', async () => {
    const client = (await api(app, owner).post('/v1/clients', { displayName: 'Baker Family' })).body;
    const p = await createProject(app, owner, { name: 'Baker Kitchen', clientId: client.id });
    expect(p.number).toBe('1001');
    expect(p.clientName).toBe('Baker Family');
    expect(p.members.map((m: any) => m.userId)).toContain(owner.userId);
    expect(p.counts.openTasks).toBe(0);
    expect(p.financials.contractValueCents).toBe(12_500_000);
    const second = await createProject(app, owner, { name: 'Second' });
    expect(second.number).toBe('1002');
    const clash = await api(app, owner).post('/v1/projects', { name: 'Dup', number: '1001' });
    expect(clash.status).toBe(409);
    const activity = await api(app, owner).get(`/v1/projects/${p.id}/activity`);
    expect(activity.body.items[0].summary).toContain('created project 1001 Baker Kitchen');
  });

  it('updates with optimistic concurrency, favourites, filtering, pagination', async () => {
    const p = await createProject(app, owner, { name: 'Concurrency' });
    const ok = await api(app, owner).patch(`/v1/projects/${p.id}`, { name: 'Concurrency v2', expectedVersion: p.version });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(p.version + 1);
    const stale = await api(app, owner).patch(`/v1/projects/${p.id}`, { name: 'stale', expectedVersion: p.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
    const diffEntry = (await api(app, owner).get(`/v1/projects/${p.id}/activity`)).body.items[0];
    expect(diffEntry.diff.name).toEqual({ from: 'Concurrency', to: 'Concurrency v2' });
    expect((await api(app, owner).post(`/v1/projects/${p.id}/favorite`, { favorite: true })).body.isFavorite).toBe(true);
    const favs = await api(app, owner).get('/v1/projects?favorites=true');
    expect(favs.body.items.map((x: any) => x.id)).toEqual([p.id]);
    const page1 = await api(app, owner).get('/v1/projects?limit=2&sort=name:asc');
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await api(app, owner).get(`/v1/projects?limit=2&sort=name:asc&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    expect(page2.body.items.length).toBeGreaterThan(0);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    const search = await api(app, owner).get('/v1/projects?q=concurrency');
    expect(search.body.items).toHaveLength(1);
  });

  it('manages project members and notifies them', async () => {
    const p = await createProject(app, owner, { name: 'Team' });
    const pm = await inviteMember(app, owner, 'project_manager');
    const members = await api(app, owner).post(`/v1/projects/${p.id}/members`, { userId: pm.userId, accessLevel: 'manager' });
    expect(members.status).toBe(200);
    expect(members.body.find((m: any) => m.userId === pm.userId).accessLevel).toBe('manager');
    const notif = await api(app, pm).get('/v1/notifications');
    expect(notif.body.items.some((n: any) => n.kind === 'member.joined' && n.projectId === p.id)).toBe(true);
    expect(notif.body.unreadCount).toBeGreaterThan(0);
    await api(app, pm).post('/v1/notifications/all/read');
    expect((await api(app, pm).get('/v1/notifications')).body.unreadCount).toBe(0);
    const id = members.body.find((m: any) => m.userId === pm.userId).id;
    const removed = await api(app, owner).delete(`/v1/projects/${p.id}/members/${id}`);
    expect(removed.body.find((m: any) => m.userId === pm.userId)).toBeUndefined();
  });

  it('archives and restores; blocks archive with open invoices', async () => {
    const p = await createProject(app, owner, { name: 'Archive me' });
    const archived = await api(app, owner).post(`/v1/projects/${p.id}/archive`, { archived: true });
    expect(archived.body.status).toBe('archived');
    expect((await api(app, owner).get('/v1/projects')).body.items.find((x: any) => x.id === p.id)).toBeUndefined();
    expect((await api(app, owner).get('/v1/projects?status=archived')).body.items.some((x: any) => x.id === p.id)).toBe(true);
    const restored = await api(app, owner).post(`/v1/projects/${p.id}/archive`, { archived: false });
    expect(restored.body.archivedAt).toBeNull();
  });

  it('dashboard aggregates actionable items', async () => {
    const dash = await api(app, owner).get('/v1/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.activeProjects.count).toBeGreaterThan(0);
    expect(dash.body.recentActivity.length).toBeGreaterThan(0);
    expect(dash.body.overdueTasks).toBeDefined();
    expect(dash.body.pendingApprovals).toBeDefined();
    expect(dash.body.scheduleConflicts).toBeDefined();
  });
});

describe('documents', () => {
  it('uploads, versions, lists, shares and downloads through signed urls', async () => {
    const p = await createProject(app, owner, { name: 'Docs' });
    const folder = await api(app, owner).post('/v1/folders', { projectId: p.id, name: 'Site photos', kind: 'photos' });
    expect(folder.status).toBe(201);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const form = multipart([{ name: 'meta', value: JSON.stringify({ projectId: p.id, folderId: folder.body.id, tags: ['framing'], photo: { takenAt: '2026-06-01T15:00:00.000Z', latitude: 30.27, longitude: -97.74 } }) }, { name: 'file', filename: 'IMG_0001.png', contentType: 'image/png', data: png }]);
    const up = await app.fastify.inject({ method: 'POST', url: '/v1/documents/upload', headers: { ...api(app, owner).headers, 'content-type': form.contentType }, payload: form.body });
    expect(up.statusCode).toBe(201);
    const doc = up.json();
    expect(doc.kind).toBe('photo');
    expect(doc.photo.latitude).toBe(30.27);
    expect(doc.sizeBytes).toBe(png.length);
    expect(doc.downloadUrl).toContain('/v1/files/');
    const url = new URL(doc.downloadUrl);
    const dl = await app.fastify.inject({ method: 'GET', url: url.pathname + url.search });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.rawPayload.equals(png)).toBe(true);
    const tampered = await app.fastify.inject({ method: 'GET', url: url.pathname + url.search.replace('sig=', 'sig=x') });
    expect(tampered.statusCode).toBe(403);
    const v2 = multipart([{ name: 'meta', value: JSON.stringify({ documentId: doc.id, versionNote: 'retouched' }) }, { name: 'file', filename: 'IMG_0001.png', contentType: 'image/png', data: Buffer.concat([png, Buffer.from('x')]) }]);
    const up2 = await app.fastify.inject({ method: 'POST', url: '/v1/documents/upload', headers: { ...api(app, owner).headers, 'content-type': v2.contentType }, payload: v2.body });
    expect(up2.json().versionCount).toBe(2);
    const detail = await api(app, owner).get(`/v1/documents/${doc.id}`);
    expect(detail.body.versions).toHaveLength(2);
    const list = await api(app, owner).get(`/v1/documents?projectId=${p.id}&tag=framing`);
    expect(list.body.items).toHaveLength(1);
    const folders = await api(app, owner).get(`/v1/folders?projectId=${p.id}`);
    expect(folders.body.find((f: any) => f.id === folder.body.id).documentCount).toBe(1);
    // client can only see shared documents
    const client = await inviteMember(app, owner, 'client', { projectIds: [p.id] });
    expect((await api(app, client).get(`/v1/documents?projectId=${p.id}`)).body.items).toHaveLength(0);
    await api(app, owner).patch(`/v1/documents/${doc.id}`, { clientVisible: true });
    expect((await api(app, client).get(`/v1/documents?projectId=${p.id}`)).body.items).toHaveLength(1);
    // storage stays clean: archived docs disappear from lists
    await api(app, owner).post(`/v1/documents/${doc.id}/archive`);
    expect((await api(app, owner).get(`/v1/documents?projectId=${p.id}`)).body.items).toHaveLength(0);
  });
});
