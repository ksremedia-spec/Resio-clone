import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, registerOrg, uniqueEmail, type TestApp } from './helpers.js';

let app: TestApp;
beforeAll(async () => { app = await createTestApp(); });
afterAll(async () => { await app.close(); });

describe('authentication', () => {
  it('registers an organization with an owner and seeds system roles', async () => {
    const owner = await registerOrg(app, { org: 'Acme Builders' });
    const me = await api(app, owner).get('/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.activeMembership.roleKey).toBe('owner');
    expect(me.body.activeMembership.permissions).toContain('org.manage');
    const roles = await api(app, owner).get('/v1/roles');
    expect(roles.body.map((r: any) => r.key).sort()).toEqual(['client', 'estimator', 'field_crew', 'field_supervisor', 'office', 'owner', 'project_manager', 'vendor']);
    expect(app.email.sent.some((m) => m.template === 'email_verify' && m.to === owner.email)).toBe(true);
  });

  it('rejects duplicate registration and bad credentials', async () => {
    const owner = await registerOrg(app);
    const dup = await app.fastify.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: owner.email, password: 'correct horse battery', firstName: 'A', lastName: 'B', organizationName: 'X' } });
    expect(dup.statusCode).toBe(409);
    const bad = await app.fastify.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: owner.email, password: 'wrong password!!' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('invalid_credentials');
    const weak = await app.fastify.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: uniqueEmail(), password: 'short', firstName: 'A', lastName: 'B', organizationName: 'X' } });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('validation_error');
  });

  it('logs in, logs out and invalidates the session', async () => {
    const owner = await registerOrg(app);
    const login = await app.fastify.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: owner.email, password: 'correct horse battery', deviceName: 'iPad Pro' } });
    expect(login.statusCode).toBe(200);
    const token = login.json().token;
    const actor = { ...owner, token };
    expect((await api(app, actor).get('/v1/auth/me')).status).toBe(200);
    expect((await api(app, actor).post('/v1/auth/logout')).status).toBe(200);
    expect((await api(app, actor).get('/v1/auth/me')).status).toBe(401);
    expect((await api(app, null).get('/v1/projects')).status).toBe(401);
  });

  it('resets a password via emailed token and revokes other sessions', async () => {
    const owner = await registerOrg(app);
    const forgot = await app.fastify.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: owner.email } });
    expect(forgot.statusCode).toBe(200);
    const mail = app.email.sent.filter((m) => m.template === 'password_reset').pop()!;
    const token = new URL(mail.text.match(/https?:\S+/)![0]).searchParams.get('token')!;
    const reset = await app.fastify.inject({ method: 'POST', url: '/v1/auth/password/reset', payload: { token, password: 'brand new passphrase' } });
    expect(reset.statusCode).toBe(200);
    expect((await api(app, owner).get('/v1/auth/me')).status).toBe(401);
    const login = await app.fastify.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: owner.email, password: 'brand new passphrase' } });
    expect(login.statusCode).toBe(200);
    const reuse = await app.fastify.inject({ method: 'POST', url: '/v1/auth/password/reset', payload: { token, password: 'yet another passphrase' } });
    expect(reuse.statusCode).toBe(400);
    // unknown email responds identically (no enumeration)
    expect((await app.fastify.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: 'nobody@example.test' } })).statusCode).toBe(200);
  });

  it('verifies email and changes password', async () => {
    const owner = await registerOrg(app);
    const mail = app.email.sent.filter((m) => m.template === 'email_verify' && m.to === owner.email).pop()!;
    const token = new URL(mail.text.match(/https?:\S+/)![0]).searchParams.get('token')!;
    expect((await app.fastify.inject({ method: 'POST', url: '/v1/auth/email/verify', payload: { token } })).statusCode).toBe(200);
    expect((await api(app, owner).get('/v1/auth/me')).body.user.emailVerifiedAt).not.toBeNull();
    const change = await api(app, owner).post('/v1/auth/password/change', { currentPassword: 'correct horse battery', newPassword: 'a much longer new password' });
    expect(change.status).toBe(200);
    expect((await api(app, owner).get('/v1/auth/me')).status).toBe(200); // current session kept
  });
});
