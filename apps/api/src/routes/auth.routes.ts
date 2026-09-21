import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Config } from '../config.js';
import type { Services } from '../services/index.js';

const ok = z.object({ ok: z.literal(true) });

export async function authRoutes(app: AppInstance, s: Services, config: Config) {
  const tags = ['Auth'];
  const authLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.post('/auth/register', { ...authLimit, schema: { tags, security: [], body: contracts.registerBody, response: { 201: contracts.sessionResponse } } }, async (req, reply) => {
    const session = await s.auth.register(req.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
    return reply.status(201).send(session);
  });

  app.post('/auth/login', { ...authLimit, schema: { tags, security: [], body: contracts.loginBody, response: { 200: contracts.sessionResponse } } }, async (req) => {
    return s.auth.login(req.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  });

  app.post('/auth/logout', { schema: { tags, response: { 200: ok } } }, async (req) => {
    const session = req.requireSession();
    await s.auth.logout(session.sessionId);
    return { ok: true as const };
  });

  app.post('/auth/logout-all', { schema: { tags, response: { 200: ok } } }, async (req) => {
    const session = req.requireSession();
    await s.auth.logoutAll(session.user.id);
    return { ok: true as const };
  });

  app.get('/auth/me', { schema: { tags, response: { 200: contracts.meResponse } } }, async (req) => s.auth.me(req.requireSession()));

  app.post('/auth/switch-organization', { schema: { tags, body: z.object({ organizationId: z.uuid() }), response: { 200: contracts.meResponse } } }, async (req) => s.auth.switchOrganization(req.requireSession(), req.body.organizationId));

  app.patch('/auth/profile', { schema: { tags, body: contracts.updateProfileBody, response: { 200: contracts.userSummary } } }, async (req) => s.auth.updateProfile(req.requireSession(), req.body));

  app.post('/auth/password/change', { schema: { tags, body: contracts.changePasswordBody, response: { 200: ok } } }, async (req) => { await s.auth.changePassword(req.requireSession(), req.body); return { ok: true as const }; });

  app.post('/auth/password/forgot', { ...authLimit, schema: { tags, security: [], body: contracts.forgotPasswordBody, response: { 200: z.object({ ok: z.literal(true), resetUrl: z.string().optional() }) } } }, async (req) => {
    const r = await s.auth.forgotPassword(req.body.email);
    return { ok: true as const, resetUrl: r.resetUrl };
  });

  app.post('/auth/password/reset', { ...authLimit, schema: { tags, security: [], body: contracts.resetPasswordBody, response: { 200: ok } } }, async (req) => { await s.auth.resetPassword(req.body); return { ok: true as const }; });

  app.post('/auth/email/verify', { ...authLimit, schema: { tags, security: [], body: contracts.verifyEmailBody, response: { 200: ok } } }, async (req) => { await s.auth.verifyEmail(req.body.token); return { ok: true as const }; });

  app.post('/auth/email/resend', { ...authLimit, schema: { tags, response: { 200: z.object({ ok: z.literal(true), verifyUrl: z.string().optional() }) } } }, async (req) => {
    const session = req.requireSession();
    const verifyUrl = await s.auth.issueEmailVerification(session.user);
    return { ok: true as const, verifyUrl };
  });

  app.get('/auth/sessions', { schema: { tags, response: { 200: z.array(z.object({ id: z.uuid(), deviceName: z.string().nullable(), userAgent: z.string().nullable(), lastSeenAt: z.string(), createdAt: z.string(), current: z.boolean() })) } } }, async (req) => s.auth.listSessions(req.requireSession()));

  app.delete('/auth/sessions/:id', { schema: { tags, params: contracts.idParams, response: { 200: ok } } }, async (req) => { await s.auth.revokeSession(req.requireSession(), req.params.id); return { ok: true as const }; });

  // Invitation acceptance lives here because it may create an account.
  app.get('/invitations/:token', { schema: { tags: ['Members'], security: [], params: z.object({ token: z.string() }), response: { 200: contracts.invitationPreview } } }, async (req) => s.organizations.previewInvitation(req.params.token));

  app.post('/invitations/accept', { ...authLimit, schema: { tags: ['Members'], security: [], body: contracts.acceptInvitationBody, response: { 200: z.object({ organizationId: z.uuid(), created: z.boolean(), session: contracts.sessionResponse.nullable() }) } } }, async (req) => {
    const current = req.session ? { id: req.session.user.id, email: req.session.user.email } : null;
    const result = await s.organizations.acceptInvitation(req.body, current);
    let session: contracts.SessionResponse | null = null;
    if (!current && req.body.password) session = await s.auth.login({ email: (await s.organizations.previewInvitationEmailAfterAccept(result.userId)), password: req.body.password }, { ip: req.ip, userAgent: req.headers['user-agent'] });
    else if (current) await s.auth.switchOrganization(req.session!, result.organizationId);
    return { organizationId: result.organizationId, created: result.created, session };
  });
  void config;
}
