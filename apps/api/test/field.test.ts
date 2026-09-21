import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, createProject, createTestApp, inviteMember, multipart, registerOrg, type Actor, type TestApp } from './helpers.js';

let app: TestApp;
let owner: Actor;
beforeAll(async () => { app = await createTestApp(); owner = await registerOrg(app, { org: 'Field Co' }); });
afterAll(async () => { await app.close(); });

async function uploadPhoto(actor: Actor, projectId: string, name = 'photo.jpg') {
  const form = multipart([{ name: 'meta', value: JSON.stringify({ projectId }) }, { name: 'file', filename: name, contentType: 'image/jpeg', data: Buffer.from('ffd8ffe0', 'hex') }]);
  const res = await app.fastify.inject({ method: 'POST', url: '/v1/documents/upload', headers: { ...api(app, actor).headers, 'content-type': form.contentType }, payload: form.body });
  return res.json();
}

describe('daily logs', () => {
  it('creates a log with entries and photos, notifies managers, records activity', async () => {
    const p = await createProject(app, owner, { name: 'Log project' });
    const sup = await inviteMember(app, owner, 'field_supervisor', { projectIds: [p.id] });
    const photo = await uploadPhoto(sup, p.id);
    const log = await api(app, sup).post(`/v1/projects/${p.id}/daily-logs`, {
      logDate: '2026-06-10', summary: 'Framed second floor walls', clientVisible: true, tags: ['framing'],
      weather: { conditions: 'Sunny', temperatureHighF: 91 },
      entries: [{ type: 'crew', trade: 'Framers', headcount: 4, hours: 8 }, { type: 'work', text: 'North wall complete' }, { type: 'delay', delayCause: 'material', delayHours: 2, text: 'Lumber delivery late' }],
      photoDocumentIds: [photo.id],
    });
    expect(log.status).toBe(201);
    expect(log.body.totals).toEqual({ headcount: 4, laborHours: 32, delayHours: 2, photoCount: 1 });
    expect(log.body.photos[0].id).toBe(photo.id);
    expect(log.body.authorName).toContain('field_supervisor');
    const ownerNotifs = await api(app, owner).get('/v1/notifications');
    expect(ownerNotifs.body.items.some((n: any) => n.kind === 'daily_log.created')).toBe(true);
    const activity = await api(app, owner).get(`/v1/projects/${p.id}/activity?objectType=daily_log`);
    expect(activity.body.items[0].clientVisible).toBe(true);
    const list = await api(app, owner).get(`/v1/daily-logs?tag=framing`);
    expect(list.body.items).toHaveLength(1);
    const search = await api(app, owner).get('/v1/search?q=lumber');
    expect(search.body.results.some((r: any) => r.type === 'daily_log')).toBe(true);
    const upd = await api(app, sup).patch(`/v1/daily-logs/${log.body.id}`, { summary: 'Framed second floor walls; inspection booked', expectedVersion: log.body.version });
    expect(upd.body.version).toBe(log.body.version + 1);
    expect((await api(app, sup).patch(`/v1/daily-logs/${log.body.id}`, { summary: 'x', expectedVersion: 1 })).status).toBe(409);
    expect((await api(app, owner).get(`/v1/projects/${p.id}`)).body.counts.dailyLogs).toBe(1);
  });
});

describe('messaging', () => {
  it('threads, messages, mentions, read state and unread counts', async () => {
    const p = await createProject(app, owner, { name: 'Chat project' });
    const pm = await inviteMember(app, owner, 'project_manager');
    await api(app, owner).post(`/v1/projects/${p.id}/members`, { userId: pm.userId, accessLevel: 'member' });
    const thread = await api(app, owner).post('/v1/threads', { projectId: p.id, kind: 'project', subject: 'Cabinet delivery', initialMessage: 'Cabinets arrive Thursday.' });
    expect(thread.status).toBe(201);
    expect(thread.body.participants.map((x: any) => x.userId).sort()).toEqual([owner.userId, pm.userId].sort());
    expect(thread.body.messageCount).toBe(1);
    const pmThreads = await api(app, pm).get('/v1/threads?unreadOnly=true');
    expect(pmThreads.body.items).toHaveLength(1);
    expect(pmThreads.body.items[0].unreadCount).toBe(1);
    const reply = await api(app, pm).post(`/v1/threads/${thread.body.id}/messages`, { body: 'Great, I will be on site.', mentions: [owner.userId] });
    expect(reply.status).toBe(201);
    const ownerNotifs = await api(app, owner).get('/v1/notifications?unreadOnly=true');
    expect(ownerNotifs.body.items.some((n: any) => n.kind === 'mention')).toBe(true);
    const msgs = await api(app, owner).get(`/v1/threads/${thread.body.id}/messages`);
    expect(msgs.body.items.map((m: any) => m.body)).toEqual(['Cabinets arrive Thursday.', 'Great, I will be on site.']);
    expect((await api(app, owner).get(`/v1/projects/${p.id}`)).body.counts.unreadMessages).toBe(1);
    await api(app, owner).post(`/v1/threads/${thread.body.id}/read`);
    expect((await api(app, owner).get(`/v1/projects/${p.id}`)).body.counts.unreadMessages).toBe(0);
    const outsider = await inviteMember(app, owner, 'estimator');
    expect((await api(app, outsider).get(`/v1/threads/${thread.body.id}`)).status).toBe(404);
    const dash = await api(app, pm).get('/v1/dashboard');
    expect(dash.body.recentMessages[0].threadId).toBe(thread.body.id);
  });
});

describe('offline sync', () => {
  it('applies queued mutations idempotently and reports conflicts without losing data', async () => {
    const p = await createProject(app, owner, { name: 'Sync project' });
    const sup = await inviteMember(app, owner, 'field_supervisor', { projectIds: [p.id] });
    const c = api(app, sup);
    const taskId = randomUUID();
    const logId = randomUUID();
    const mutations = [
      { clientMutationId: 'm-create-task-1', entity: 'task', operation: 'create', id: taskId, baseVersion: null, occurredAt: '2026-06-10T08:00:00.000Z', data: { projectId: p.id, name: 'Offline task', startDate: '2026-06-15', durationDays: 2 } },
      { clientMutationId: 'm-create-log-1', entity: 'daily_log', operation: 'create', id: logId, baseVersion: null, occurredAt: '2026-06-10T08:05:00.000Z', data: { projectId: p.id, logDate: '2026-06-10', summary: 'Written offline', entries: [{ type: 'note', text: 'no signal at site' }] } },
    ];
    const push = await c.post('/v1/sync/push', { mutations });
    expect(push.status).toBe(200);
    expect(push.body.results.map((r: any) => r.status)).toEqual(['applied', 'applied']);
    expect(push.body.results[0].id).toBe(taskId);
    const replay = await c.post('/v1/sync/push', { mutations });
    expect(replay.body.results.map((r: any) => r.status)).toEqual(['duplicate', 'duplicate']);
    expect((await c.get(`/v1/projects/${p.id}/tasks`)).body.items).toHaveLength(1);

    // Someone else edits the task online; the offline edit based on the old version conflicts.
    await api(app, owner).patch(`/v1/tasks/${taskId}`, { name: 'Renamed online' });
    const conflict = await c.post('/v1/sync/push', { mutations: [{ clientMutationId: 'm-update-task-1', entity: 'task', operation: 'update', id: taskId, baseVersion: 1, occurredAt: '2026-06-10T09:00:00.000Z', data: { name: 'Renamed offline' } }] });
    expect(conflict.body.results[0].status).toBe('conflict');
    expect(conflict.body.results[0].serverData.name).toBe('Renamed online');
    // After merging, the client retries with the current version.
    const retry = await c.post('/v1/sync/push', { mutations: [{ clientMutationId: 'm-update-task-1', entity: 'task', operation: 'update', id: taskId, baseVersion: conflict.body.results[0].serverData.version, occurredAt: '2026-06-10T09:00:00.000Z', data: { name: 'Renamed offline (merged)' } }] });
    expect(retry.body.results[0].status).toBe('applied');
    const unsupported = await c.post('/v1/sync/push', { mutations: [{ clientMutationId: 'm-unsupported-1', entity: 'client', operation: 'create', id: randomUUID(), baseVersion: null, occurredAt: '2026-06-10T09:00:00.000Z', data: {} }] });
    expect(unsupported.body.results[0].status).toBe('rejected');

    const pull = await c.get(`/v1/sync/pull?entities=task,daily_log,project&projectIds=${p.id}`);
    expect(pull.status).toBe(200);
    expect(pull.body.changes.map((x: any) => x.entity).sort()).toEqual(['daily_log', 'project', 'task']);
    const again = await c.get(`/v1/sync/pull?since=${encodeURIComponent(pull.body.cursor)}`);
    expect(again.body.changes).toHaveLength(0);
  });
});
