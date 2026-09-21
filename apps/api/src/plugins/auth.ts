import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedSession } from '../services/auth.service.js';
import type { RequestContext } from '../lib/context.js';
import { AppError } from '../lib/errors.js';
import type { Services } from '../services/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: AuthenticatedSession | null;
    ctx: RequestContext | null;
    requireSession(): AuthenticatedSession;
    requireCtx(): RequestContext;
  }
}

/**
 * Reads `Authorization: Bearer <token>` and, when valid, attaches the session
 * and (when an active organization is known) a RequestContext. Routes decide
 * whether they need a session, a context, or neither.
 */
export const authPlugin = fp(async (app, opts: { services: Services }) => {
  app.decorateRequest('session', null);
  app.decorateRequest('ctx', null);
  app.decorateRequest('requireSession', function (this: FastifyRequest) {
    if (!this.session) throw AppError.unauthenticated();
    return this.session;
  });
  app.decorateRequest('requireCtx', function (this: FastifyRequest) {
    if (!this.session) throw AppError.unauthenticated();
    if (!this.ctx) throw new AppError(403, 'forbidden', 'Select an organization to continue.');
    return this.ctx;
  });
  app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const token = header.slice(7).trim();
    const session = await opts.services.auth.authenticate(token);
    if (!session) return;
    req.session = session;
    const orgHeader = req.headers['x-organization-id'];
    const orgId = typeof orgHeader === 'string' && orgHeader ? orgHeader : null;
    req.ctx = await opts.services.auth.buildContext(session, orgId, { ip: req.ip, userAgent: req.headers['user-agent'] });
  });
});
