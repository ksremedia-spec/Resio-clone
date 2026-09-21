import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createProject, createTestApp, inviteMember, registerOrg, type TestApp } from './helpers.js';

let app: TestApp;
beforeAll(async () => { app = await createTestApp(); });
afterAll(async () => { await app.close(); });

describe('members, roles and invitations', () => {
  it('invites a project manager who accepts and gets the role permissions', async () => {
    const owner = await registerOrg(app);
    const pm = await inviteMember(app, owner, 'project_manager', { firstName: 'Pat' });
    const me = await api(app, pm).get('/v1/auth/me');
    expect(me.body.activeMembership.roleKey).toBe('project_manager');
    expect(me.body.activeMembership.permissions).toContain('projects.write');
    expect(me.body.activeMembership.permissions).not.toContain('org.manage');
    const members = await api(app, owner).get('/v1/members');
    expect(members.body).toHaveLength(2);
    const joined = app.email.sent.find((m) => m.template === 'invitation');
    expect(joined).toBeTruthy();
    const activity = await api(app, owner).get('/v1/activity');
    expect(activity.body.items.some((a: any) => a.verb === 'joined')).toBe(true);
  });

  it('invitation with project ids grants project membership on acceptance', async () => {
    const owner = await registerOrg(app);
    const project = await createProject(app, owner);
    const crew = await inviteMember(app, owner, 'field_crew', { projectIds: [project.id] });
    const list = await api(app, crew).get('/v1/projects');
    expect(list.body.items.map((p: any) => p.id)).toEqual([project.id]);
  });

  it('prevents demoting or suspending the last owner', async () => {
    const owner = await registerOrg(app);
    const members = await api(app, owner).get('/v1/members');
    const roles = await api(app, owner).get('/v1/roles');
    const pmRole = roles.body.find((r: any) => r.key === 'project_manager');
    const res = await api(app, owner).patch(`/v1/members/${members.body[0].id}`, { roleId: pmRole.id });
    expect(res.status).toBe(409);
    const sus = await api(app, owner).patch(`/v1/members/${members.body[0].id}`, { status: 'suspended' });
    expect(sus.status).toBe(409);
  });

  it('suspending a member revokes their access', async () => {
    const owner = await registerOrg(app);
    const est = await inviteMember(app, owner, 'estimator');
    const members = await api(app, owner).get('/v1/members');
    const m = members.body.find((x: any) => x.userId === est.userId);
    expect((await api(app, owner).patch(`/v1/members/${m.id}`, { status: 'suspended' })).status).toBe(200);
    expect((await api(app, est).get('/v1/projects')).status).toBe(401);
  });

  it('custom roles can be created, cloned and enforced', async () => {
    const owner = await registerOrg(app);
    const created = await api(app, owner).post('/v1/roles', { name: 'Photographer', permissions: ['projects.read', 'documents.read', 'documents.write'], restrictToAssignedProjects: true, defaultMode: 'field' });
    expect(created.status).toBe(201);
    expect(created.body.permissions.sort()).toEqual(['documents.read', 'documents.write', 'projects.read']);
    const badPerm = await api(app, owner).post('/v1/roles', { name: 'Bad', permissions: ['not.a.permission'] });
    expect(badPerm.status).toBe(400);
    const updated = await api(app, owner).patch(`/v1/roles/${created.body.id}`, { permissions: ['projects.read'] });
    expect(updated.body.permissions).toEqual(['projects.read']);
    const ownerRole = (await api(app, owner).get('/v1/roles')).body.find((r: any) => r.key === 'owner');
    expect((await api(app, owner).patch(`/v1/roles/${ownerRole.id}`, { name: 'Boss' })).status).toBe(409);
    expect((await api(app, owner).delete(`/v1/roles/${ownerRole.id}`)).status).toBe(409);
    expect((await api(app, owner).delete(`/v1/roles/${created.body.id}`)).status).toBe(200);
  });

  it('non-admins cannot manage roles or the organization', async () => {
    const owner = await registerOrg(app);
    const crew = await inviteMember(app, owner, 'field_crew');
    expect((await api(app, crew).post('/v1/roles', { name: 'X', permissions: [] })).status).toBe(403);
    expect((await api(app, crew).patch('/v1/organization', { name: 'Hacked' })).status).toBe(403);
    expect((await api(app, crew).post('/v1/invitations', { email: 'x@example.test', roleId: '00000000-0000-0000-0000-000000000000' })).status).toBe(403);
    const org = await api(app, owner).patch('/v1/organization', { name: 'Renamed Co', defaultMarkupBp: 2500, workingDays: [1, 2, 3, 4, 5, 6] });
    expect(org.status).toBe(200);
    expect(org.body.name).toBe('Renamed Co');
  });
});
