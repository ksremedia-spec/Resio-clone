import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createProject, createTestApp, inviteMember, registerOrg, type Actor, type TestApp } from './helpers.js';

let app: TestApp;
let owner: Actor;
beforeAll(async () => { app = await createTestApp(); owner = await registerOrg(app, { org: 'Schedule Co' }); });
afterAll(async () => { await app.close(); });

describe('schedule', () => {
  it('builds phases, dependent tasks and cascades a delay downstream', async () => {
    const p = await createProject(app, owner, { name: 'Cascade' });
    const c = api(app, owner);
    const phase = await c.post(`/v1/projects/${p.id}/phases`, { name: 'Structure' });
    expect(phase.status).toBe(201);
    const foundation = (await c.post(`/v1/projects/${p.id}/tasks`, { name: 'Foundation', phaseId: phase.body.id, startDate: '2026-06-01', durationDays: 5 })).body;
    expect(foundation.endDate).toBe('2026-06-05');
    const framing = (await c.post(`/v1/projects/${p.id}/tasks`, { name: 'Framing', phaseId: phase.body.id, startDate: '2026-06-08', durationDays: 10, predecessors: [{ taskId: foundation.id }] })).body;
    const roofing = (await c.post(`/v1/projects/${p.id}/tasks`, { name: 'Roofing', startDate: '2026-06-22', durationDays: 5, predecessors: [{ taskId: framing.id }] })).body;
    const exterior = (await c.post(`/v1/projects/${p.id}/tasks`, { name: 'Exterior', startDate: '2026-06-29', durationDays: 5, predecessors: [{ taskId: roofing.id, lagDays: 2 }] })).body;
    expect(exterior.startDate).toBe('2026-07-01'); // pushed by lag on create
    expect(framing.predecessors).toHaveLength(1);

    const preview = await c.post(`/v1/tasks/${foundation.id}/move`, { durationDays: 8, commit: false });
    expect(preview.body.committed).toBe(false);
    expect(preview.body.changes.map((x: any) => x.name)).toEqual(['Foundation', 'Framing', 'Roofing', 'Exterior']);
    expect((await c.get(`/v1/tasks/${framing.id}`)).body.startDate).toBe('2026-06-08'); // preview did not persist

    const commit = await c.post(`/v1/tasks/${foundation.id}/move`, { durationDays: 8, commit: true });
    expect(commit.body.committed).toBe(true);
    expect((await c.get(`/v1/tasks/${framing.id}`)).body.startDate).toBe('2026-06-11');
    expect((await c.get(`/v1/tasks/${roofing.id}`)).body.startDate).toBe('2026-06-25');
    expect((await c.get(`/v1/tasks/${exterior.id}`)).body.startDate).toBe('2026-07-06');
    const schedule = await c.get(`/v1/projects/${p.id}/schedule`);
    expect(schedule.body.tasks).toHaveLength(4);
    expect(schedule.body.dependencies).toHaveLength(3);
    expect(schedule.body.criticalPath).toContain(foundation.id);
    expect(schedule.body.phases[0].startDate).toBe('2026-06-01');
    const activity = await c.get(`/v1/projects/${p.id}/activity?objectType=task`);
    expect(activity.body.items.filter((a: any) => a.verb === 'rescheduled').length).toBeGreaterThanOrEqual(3);
  });

  it('rejects dependency cycles and detects resource conflicts', async () => {
    const p = await createProject(app, owner, { name: 'Conflicts' });
    const c = api(app, owner);
    const a = (await c.post(`/v1/projects/${p.id}/tasks`, { name: 'A', startDate: '2027-06-01', durationDays: 3, assigneeUserIds: [owner.userId] })).body;
    const b = (await c.post(`/v1/projects/${p.id}/tasks`, { name: 'B', startDate: '2027-06-02', durationDays: 3, assigneeUserIds: [owner.userId] })).body;
    expect((await c.post(`/v1/tasks/${b.id}/dependencies`, { predecessorId: a.id })).status).toBe(200);
    const cycle = await c.post(`/v1/tasks/${a.id}/dependencies`, { predecessorId: b.id });
    expect(cycle.status).toBe(409);
    const self = await c.post(`/v1/tasks/${a.id}/dependencies`, { predecessorId: a.id });
    expect(self.status).toBe(400);
    const bAfter = (await c.get(`/v1/tasks/${b.id}`)).body;
    expect(bAfter.startDate).toBe('2027-06-04'); // moved after A by the dependency
    // Remove dependency and move B back so both overlap on the same person.
    await c.delete(`/v1/tasks/${b.id}/dependencies/${bAfter.predecessors[0].id}`);
    await c.patch(`/v1/tasks/${b.id}`, { startDate: '2027-06-02' });
    const schedule = await c.get(`/v1/projects/${p.id}/schedule`);
    expect(schedule.body.conflicts).toHaveLength(1);
    expect(schedule.body.conflicts[0].resourceType).toBe('user');
    const dash = await c.get('/v1/dashboard');
    expect(dash.body.scheduleConflicts.count).toBeGreaterThan(0);
  });

  it('task manager: assignment notifications, status, checklist, cross-project list, field crew limits', async () => {
    const p = await createProject(app, owner, { name: 'Tasks' });
    const crew = await inviteMember(app, owner, 'field_crew', { projectIds: [p.id] });
    const c = api(app, owner);
    const t = (await c.post(`/v1/projects/${p.id}/tasks`, { name: 'Install windows', kind: 'todo', dueDate: '2020-01-01', assigneeUserIds: [crew.userId], checklist: ['Measure', 'Order'] })).body;
    expect(t.checklist).toHaveLength(2);
    const notif = await api(app, crew).get('/v1/notifications?unreadOnly=true');
    expect(notif.body.items.some((n: any) => n.kind === 'task.assigned')).toBe(true);
    const mine = await api(app, crew).get('/v1/tasks?mine=true');
    expect(mine.body.items.map((x: any) => x.id)).toEqual([t.id]);
    expect(mine.body.items[0].projectName).toBe('Tasks');
    const done = await api(app, crew).patch(`/v1/tasks/${t.id}`, { status: 'complete', checklist: t.checklist.map((i: any) => ({ id: i.id, text: i.text, done: true })) });
    expect(done.status).toBe(200);
    expect(done.body.percentComplete).toBe(100);
    expect(done.body.checklist.every((i: any) => i.done)).toBe(true);
    expect((await api(app, crew).patch(`/v1/tasks/${t.id}`, { name: 'renamed by crew' })).status).toBe(403);
    const other = (await c.post(`/v1/projects/${p.id}/tasks`, { name: 'Not mine', kind: 'todo', dueDate: '2020-01-02' })).body;
    expect((await api(app, crew).patch(`/v1/tasks/${other.id}`, { status: 'complete' })).status).toBe(403);
    const overdue = await c.get('/v1/dashboard');
    expect(overdue.body.overdueTasks.items.some((x: any) => x.id === other.id)).toBe(true);
    const stale = await c.patch(`/v1/tasks/${other.id}`, { name: 'x', expectedVersion: 99 });
    expect(stale.status).toBe(409);
    expect((await c.delete(`/v1/tasks/${other.id}`)).status).toBe(200);
    expect((await c.get(`/v1/projects/${p.id}/tasks?status=all`)).body.items.map((x: any) => x.id)).toEqual([t.id]);
  });
});
