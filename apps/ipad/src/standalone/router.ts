/**
 * In-page HTTP router for the browser-only build. It mirrors apps/api/src/routes
 * one-to-one: same paths, same zod contracts, same service calls, same errors.
 * `fetch` calls to /v1/* are answered here instead of over the network.
 */
import { ZodError, z } from 'zod';
import { contracts } from '@buildline/core';
import type { Services } from '../../../api/src/services/index';
import type { RequestContext } from '../../../api/src/lib/context';
import { AppError } from '../../../api/src/lib/errors';
import type { AuthenticatedSession } from '../../../api/src/services/auth.service';

type Params = Record<string, string>;
interface Req { method: string; path: string; params: Params; query: Record<string, string>; body: any; headers: Headers; session: AuthenticatedSession | null; ctx: RequestContext | null }
interface Route { method: string; pattern: RegExp; keys: string[]; handler: (req: Req) => Promise<unknown>; status?: number }

const ok = { ok: true as const };

function compile(path: string) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { pattern, keys };
}

export function buildRoutes(s: Services, config: { NODE_ENV: string }): Route[] {
  const routes: Route[] = [];
  const add = (method: string, path: string, handler: (req: Req) => Promise<unknown>, status?: number) => { const { pattern, keys } = compile(path); routes.push({ method, pattern, keys, handler, status }); };
  const requireSession = (r: Req) => { if (!r.session) throw AppError.unauthenticated(); return r.session; };
  const requireCtx = (r: Req) => { if (!r.session) throw AppError.unauthenticated(); if (!r.ctx) throw new AppError(403, 'forbidden', 'Select an organization to continue.'); return r.ctx; };
  const q = <T extends z.ZodTypeAny>(schema: T, r: Req) => schema.parse(r.query) as z.infer<T>;
  const b = <T extends z.ZodTypeAny>(schema: T, r: Req) => schema.parse(r.body) as z.infer<T>;
  const c = contracts;

  // ---- auth ----
  add('POST', '/v1/auth/register', async (r) => s.auth.register(b(c.registerBody, r), {}), 201);
  add('POST', '/v1/auth/login', async (r) => s.auth.login(b(c.loginBody, r), {}));
  add('POST', '/v1/auth/logout', async (r) => { await s.auth.logout(requireSession(r).sessionId); return ok; });
  add('POST', '/v1/auth/logout-all', async (r) => { await s.auth.logoutAll(requireSession(r).user.id); return ok; });
  add('GET', '/v1/auth/me', async (r) => s.auth.me(requireSession(r)));
  add('POST', '/v1/auth/switch-organization', async (r) => s.auth.switchOrganization(requireSession(r), b(z.object({ organizationId: z.uuid() }), r).organizationId));
  add('PATCH', '/v1/auth/profile', async (r) => s.auth.updateProfile(requireSession(r), b(c.updateProfileBody, r)));
  add('POST', '/v1/auth/password/change', async (r) => { await s.auth.changePassword(requireSession(r), b(c.changePasswordBody, r)); return ok; });
  add('POST', '/v1/auth/password/forgot', async (r) => ({ ok: true, resetUrl: (await s.auth.forgotPassword(b(c.forgotPasswordBody, r).email)).resetUrl }));
  add('POST', '/v1/auth/password/reset', async (r) => { await s.auth.resetPassword(b(c.resetPasswordBody, r)); return ok; });
  add('POST', '/v1/auth/email/verify', async (r) => { await s.auth.verifyEmail(b(c.verifyEmailBody, r).token); return ok; });
  add('POST', '/v1/auth/email/resend', async (r) => ({ ok: true, verifyUrl: await s.auth.issueEmailVerification(requireSession(r).user) }));
  add('GET', '/v1/auth/sessions', async (r) => s.auth.listSessions(requireSession(r)));
  add('DELETE', '/v1/auth/sessions/:id', async (r) => { await s.auth.revokeSession(requireSession(r), r.params.id!); return ok; });
  add('GET', '/v1/invitations/:token', async (r) => s.organizations.previewInvitation(r.params.token!));
  add('POST', '/v1/invitations/accept', async (r) => {
    const body = b(c.acceptInvitationBody, r);
    const current = r.session ? { id: r.session.user.id, email: r.session.user.email } : null;
    const result = await s.organizations.acceptInvitation(body, current);
    let session: contracts.SessionResponse | null = null;
    if (!current && body.password) session = await s.auth.login({ email: await s.organizations.previewInvitationEmailAfterAccept(result.userId), password: body.password }, {});
    else if (current) await s.auth.switchOrganization(r.session!, result.organizationId);
    return { organizationId: result.organizationId, created: result.created, session };
  });

  // ---- organization, roles, members ----
  add('GET', '/v1/organization', async (r) => s.organizations.get(requireCtx(r)));
  add('PATCH', '/v1/organization', async (r) => s.organizations.update(requireCtx(r), b(c.updateOrganizationBody, r)));
  add('GET', '/v1/roles', async (r) => s.organizations.listRoles(requireCtx(r)));
  add('GET', '/v1/permissions', async (r) => { requireCtx(r); return [...c.PERMISSIONS_LIST]; });
  add('POST', '/v1/roles', async (r) => s.organizations.createRole(requireCtx(r), b(c.createRoleBody, r)), 201);
  add('PATCH', '/v1/roles/:id', async (r) => s.organizations.updateRole(requireCtx(r), r.params.id!, b(c.updateRoleBody, r)));
  add('DELETE', '/v1/roles/:id', async (r) => { await s.organizations.deleteRole(requireCtx(r), r.params.id!); return ok; });
  add('GET', '/v1/members', async (r) => s.organizations.listMembers(requireCtx(r)));
  add('PATCH', '/v1/members/:id', async (r) => s.organizations.updateMember(requireCtx(r), r.params.id!, b(c.updateMemberBody, r)));
  add('GET', '/v1/invitations', async (r) => s.organizations.listInvitations(requireCtx(r)));
  add('POST', '/v1/invitations', async (r) => s.organizations.invite(requireCtx(r), b(c.createInvitationBody, r)), 201);
  add('DELETE', '/v1/invitations/:id', async (r) => { await s.organizations.revokeInvitation(requireCtx(r), r.params.id!); return ok; });

  // ---- clients ----
  add('GET', '/v1/clients', async (r) => s.clients.list(requireCtx(r), q(c.listClientsQuery, r)));
  add('POST', '/v1/clients', async (r) => s.clients.create(requireCtx(r), b(c.createClientBody, r)), 201);
  add('GET', '/v1/clients/:id', async (r) => s.clients.get(requireCtx(r), r.params.id!));
  add('PATCH', '/v1/clients/:id', async (r) => s.clients.update(requireCtx(r), r.params.id!, b(c.updateClientBody, r)));
  add('POST', '/v1/clients/:id/archive', async (r) => s.clients.archive(requireCtx(r), r.params.id!, r.body?.archived ?? true));
  add('POST', '/v1/clients/:id/contacts', async (r) => s.clients.addContact(requireCtx(r), r.params.id!, b(c.createContactBody, r)), 201);
  add('PATCH', '/v1/clients/:id/contacts/:contactId', async (r) => s.clients.updateContact(requireCtx(r), r.params.id!, r.params.contactId!, b(c.updateContactBody, r)));
  add('DELETE', '/v1/clients/:id/contacts/:contactId', async (r) => { await s.clients.deleteContact(requireCtx(r), r.params.id!, r.params.contactId!); return ok; });

  // ---- projects ----
  add('GET', '/v1/projects', async (r) => s.projects.list(requireCtx(r), q(c.listProjectsQuery, r)));
  add('POST', '/v1/projects', async (r) => s.projects.create(requireCtx(r), b(c.createProjectBody, r)), 201);
  add('GET', '/v1/projects/:id', async (r) => s.projects.get(requireCtx(r), r.params.id!));
  add('PATCH', '/v1/projects/:id', async (r) => s.projects.update(requireCtx(r), r.params.id!, b(c.updateProjectBody.extend({ expectedVersion: z.number().int().optional() }), r)));
  add('POST', '/v1/projects/:id/archive', async (r) => s.projects.archive(requireCtx(r), r.params.id!, r.body?.archived ?? true));
  add('POST', '/v1/projects/:id/favorite', async (r) => s.projects.setFavorite(requireCtx(r), r.params.id!, b(z.object({ favorite: z.boolean() }), r).favorite));
  add('POST', '/v1/projects/:id/members', async (r) => s.projects.addMember(requireCtx(r), r.params.id!, b(c.addProjectMemberBody, r)));
  add('DELETE', '/v1/projects/:id/members/:memberId', async (r) => s.projects.removeMember(requireCtx(r), r.params.id!, r.params.memberId!));
  add('GET', '/v1/projects/:id/activity', async (r) => s.activity.list(requireCtx(r), { ...q(c.listActivityQuery.omit({ projectId: true }), r), projectId: r.params.id! }));

  // ---- dashboard, activity, search, notifications ----
  add('GET', '/v1/dashboard', async (r) => s.dashboard.get(requireCtx(r)));
  add('GET', '/v1/activity', async (r) => s.activity.list(requireCtx(r), q(c.listActivityQuery, r)));
  add('GET', '/v1/search', async (r) => ({ results: await s.search.search(requireCtx(r), q(c.searchQuery, r)) }));
  add('GET', '/v1/notifications', async (r) => { const ctx = requireCtx(r); const list = await s.notifications.list(ctx, q(c.listNotificationsQuery, r)); return { ...list, unreadCount: await s.notifications.unreadCount(ctx) }; });
  add('POST', '/v1/notifications/:id/read', async (r) => { await s.notifications.markRead(requireCtx(r), r.params.id as any); return ok; });
  add('GET', '/v1/notification-preferences', async (r) => s.notifications.getPreferences(requireCtx(r)));
  add('PUT', '/v1/notification-preferences', async (r) => s.notifications.setPreferences(requireCtx(r), b(c.notificationPreferences, r)));
  add('POST', '/v1/push-tokens', async (r) => { await s.notifications.registerPushToken(requireCtx(r), b(c.registerPushTokenBody, r)); return ok; });

  // ---- documents ----
  add('GET', '/v1/folders', async (r) => { const query = q(z.object({ projectId: z.uuid().optional(), parentId: z.uuid().optional(), root: z.coerce.boolean().optional(), company: z.coerce.boolean().optional() }), r); return s.documents.listFolders(requireCtx(r), { projectId: query.company ? null : query.projectId, parentId: query.root ? null : query.parentId }); });
  add('POST', '/v1/folders', async (r) => s.documents.createFolder(requireCtx(r), b(c.createFolderBody, r)), 201);
  add('PATCH', '/v1/folders/:id', async (r) => s.documents.updateFolder(requireCtx(r), r.params.id!, b(c.updateFolderBody, r)));
  add('DELETE', '/v1/folders/:id', async (r) => { await s.documents.archiveFolder(requireCtx(r), r.params.id!); return ok; });
  add('GET', '/v1/documents', async (r) => s.documents.list(requireCtx(r), q(c.listDocumentsQuery, r)));
  add('POST', '/v1/documents/upload', async (r) => {
    const ctx = requireCtx(r);
    const form = r.body as FormData;
    const metaRaw = form.get('meta');
    let meta: Record<string, unknown> = {};
    if (typeof metaRaw === 'string') { try { meta = JSON.parse(metaRaw); } catch { throw AppError.validation('meta must be valid JSON'); } }
    const file = form.get('file');
    if (!(file instanceof File)) throw AppError.validation('No file was uploaded.');
    const parsed = c.uploadDocumentFields.safeParse(meta);
    if (!parsed.success) throw AppError.validation('Invalid upload metadata', parsed.error.issues);
    return s.documents.upload(ctx, { stream: file, filename: file.name, contentType: file.type || 'application/octet-stream' }, parsed.data);
  }, 201);
  add('GET', '/v1/documents/:id', async (r) => s.documents.get(requireCtx(r), r.params.id!));
  add('PATCH', '/v1/documents/:id', async (r) => s.documents.update(requireCtx(r), r.params.id!, b(c.updateDocumentBody, r)));
  add('POST', '/v1/documents/:id/archive', async (r) => s.documents.archive(requireCtx(r), r.params.id!, r.body?.archived ?? true));

  // ---- schedule & tasks ----
  add('GET', '/v1/projects/:id/schedule', async (r) => s.schedule.schedule(requireCtx(r), r.params.id!));
  add('GET', '/v1/projects/:id/phases', async (r) => s.schedule.listPhases(requireCtx(r), r.params.id!));
  add('POST', '/v1/projects/:id/phases', async (r) => s.schedule.createPhase(requireCtx(r), r.params.id!, b(c.createPhaseBody, r)), 201);
  add('PATCH', '/v1/projects/:id/phases/:phaseId', async (r) => s.schedule.updatePhase(requireCtx(r), r.params.id!, r.params.phaseId!, b(c.updatePhaseBody, r)));
  add('DELETE', '/v1/projects/:id/phases/:phaseId', async (r) => { await s.schedule.deletePhase(requireCtx(r), r.params.id!, r.params.phaseId!); return ok; });
  add('GET', '/v1/tasks', async (r) => s.schedule.listTasks(requireCtx(r), q(c.listTasksQuery, r)));
  add('GET', '/v1/projects/:id/tasks', async (r) => s.schedule.listTasks(requireCtx(r), { ...q(c.listTasksQuery.omit({ projectId: true }), r), projectId: r.params.id! }));
  add('POST', '/v1/projects/:id/tasks', async (r) => s.schedule.createTask(requireCtx(r), r.params.id!, b(c.createTaskBody, r)), 201);
  add('GET', '/v1/tasks/:id', async (r) => s.schedule.getTask(requireCtx(r), r.params.id!));
  add('PATCH', '/v1/tasks/:id', async (r) => s.schedule.updateTask(requireCtx(r), r.params.id!, b(c.updateTaskBody, r)));
  add('DELETE', '/v1/tasks/:id', async (r) => { await s.schedule.archiveTask(requireCtx(r), r.params.id!); return ok; });
  add('POST', '/v1/tasks/:id/move', async (r) => s.schedule.moveTask(requireCtx(r), r.params.id!, b(c.moveTaskBody, r)));
  add('POST', '/v1/tasks/:id/dependencies', async (r) => s.schedule.addDependency(requireCtx(r), r.params.id!, b(c.addDependencyBody, r)));
  add('DELETE', '/v1/tasks/:id/dependencies/:depId', async (r) => s.schedule.removeDependency(requireCtx(r), r.params.id!, r.params.depId!));

  // ---- daily logs ----
  add('GET', '/v1/daily-logs', async (r) => s.dailyLogs.list(requireCtx(r), q(c.listDailyLogsQuery, r)));
  add('GET', '/v1/projects/:id/daily-logs', async (r) => s.dailyLogs.list(requireCtx(r), { ...q(c.listDailyLogsQuery.omit({ projectId: true }), r), projectId: r.params.id! }));
  add('POST', '/v1/projects/:id/daily-logs', async (r) => s.dailyLogs.create(requireCtx(r), r.params.id!, b(c.createDailyLogBody, r)), 201);
  add('GET', '/v1/daily-logs/:id', async (r) => s.dailyLogs.get(requireCtx(r), r.params.id!));
  add('PATCH', '/v1/daily-logs/:id', async (r) => s.dailyLogs.update(requireCtx(r), r.params.id!, b(c.updateDailyLogBody, r)));
  add('DELETE', '/v1/daily-logs/:id', async (r) => { await s.dailyLogs.archive(requireCtx(r), r.params.id!); return ok; });

  // ---- messages ----
  add('GET', '/v1/threads', async (r) => s.messages.listThreads(requireCtx(r), q(c.listThreadsQuery, r)));
  add('GET', '/v1/projects/:id/threads', async (r) => s.messages.listThreads(requireCtx(r), { ...q(c.listThreadsQuery.omit({ projectId: true }), r), projectId: r.params.id! }));
  add('POST', '/v1/threads', async (r) => s.messages.createThread(requireCtx(r), b(c.createThreadBody, r)), 201);
  add('GET', '/v1/threads/:id', async (r) => s.messages.getThread(requireCtx(r), r.params.id!));
  add('GET', '/v1/threads/:id/messages', async (r) => s.messages.listMessages(requireCtx(r), r.params.id!, q(c.listMessagesQuery, r)));
  add('POST', '/v1/threads/:id/messages', async (r) => s.messages.send(requireCtx(r), r.params.id!, b(c.sendMessageBody, r)), 201);
  add('POST', '/v1/threads/:id/read', async (r) => { await s.messages.markRead(requireCtx(r), r.params.id!); return ok; });
  add('DELETE', '/v1/threads/:id/messages/:messageId', async (r) => { await s.messages.deleteMessage(requireCtx(r), r.params.id!, r.params.messageId!); return ok; });

  // ---- sync ----
  add('GET', '/v1/sync/pull', async (r) => s.sync.pull(requireCtx(r), q(c.syncPullQuery, r)));
  add('POST', '/v1/sync/push', async (r) => ({ results: await s.sync.push(requireCtx(r), b(c.syncPushBody, r).mutations) }));
  void config;
  return routes;
}

function errorResponse(err: unknown): Response {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (err instanceof AppError) return json(err.status, { error: { code: err.code, message: err.message, details: err.details } });
  if (err instanceof ZodError) return json(400, { error: { code: 'validation_error', message: 'Some fields are invalid.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  console.error(err);
  return json(500, { error: { code: 'internal', message: 'Something went wrong in the in-page server. Your data has not been lost.' } });
}

/** Replace window.fetch for /v1/* with the in-page router. Other URLs pass through. */
export function installFetchInterceptor(s: Services, config: { NODE_ENV: string }) {
  const routes = buildRoutes(s, config);
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, window.location.href);
    if (!url.pathname.startsWith('/v1/')) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const route = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
    if (!route) return errorResponse(new AppError(404, 'not_found', `Route ${method} ${url.pathname} does not exist.`));
    try {
      const match = route.pattern.exec(url.pathname)!;
      const params: Params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(match[i + 1]!); });
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => { query[k] = v; });
      let body: any = null;
      const raw = init?.body ?? (input instanceof Request ? await input.text().catch(() => null) : null);
      if (raw instanceof FormData) body = raw;
      else if (typeof raw === 'string' && raw.length) { try { body = JSON.parse(raw); } catch { throw AppError.validation('Body must be JSON.'); } }
      const auth = headers.get('authorization');
      let session: AuthenticatedSession | null = null;
      let ctx: RequestContext | null = null;
      if (auth?.startsWith('Bearer ')) {
        session = await s.auth.authenticate(auth.slice(7).trim());
        if (session) ctx = await s.auth.buildContext(session, headers.get('x-organization-id'), {});
      }
      const result = await route.handler({ method, path: url.pathname, params, query, body, headers, session, ctx });
      return new Response(JSON.stringify(result ?? null), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
