import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { SYSTEM_ROLES, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx, Tx } from '../db/client.js';
import { memberships, oneTimeTokens, organizations, rolePermissions, roles, sessions, users } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import { generateToken, hashPassword, hashToken, slugify, verifyPassword } from '../lib/crypto.js';
import { RequestContext, type ActorMembership, type ActorUser } from '../lib/context.js';
import type { ActivityService } from './activity.service.js';

const TOKEN_PREFIX = 'bl_';

export interface AuthenticatedSession {
  sessionId: string;
  user: typeof users.$inferSelect;
  activeOrganizationId: string | null;
}

export class AuthService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService) {}

  // ---------- registration & organisations ----------

  async register(input: { email: string; password: string; firstName: string; lastName: string; organizationName: string }, meta: { ip?: string; userAgent?: string; deviceName?: string } = {}) {
    const { db } = this.deps;
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing.length) throw AppError.conflict('An account with this email already exists. Sign in instead.');
    const passwordHash = await hashPassword(input.password);
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email: input.email, passwordHash, firstName: input.firstName, lastName: input.lastName, passwordChangedAt: sql`now()` }).returning();
      const org = await this.createOrganization(tx, { name: input.organizationName, ownerUserId: user!.id });
      return { user: user!, org };
    });
    await this.issueEmailVerification(result.user);
    const session = await this.createSession(result.user.id, result.org.id, meta);
    return this.sessionResponse(session.token, session.row.expiresAt, result.user, result.org.id);
  }

  /** Creates an organization with system roles and an owner membership. Reused by seed and tests. */
  async createOrganization(tx: Tx, input: { name: string; ownerUserId: string }) {
    let slug = slugify(input.name);
    const clash = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (clash.length) slug = `${slug}-${generateToken(3).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)}`;
    const [org] = await tx.insert(organizations).values({ name: input.name, slug, createdBy: input.ownerUserId }).returning();
    const roleIds = new Map<string, string>();
    for (const def of SYSTEM_ROLES) {
      const [role] = await tx.insert(roles).values({ organizationId: org!.id, key: def.key, name: def.name, description: def.description, isSystem: true, restrictToAssignedProjects: def.restrictToAssignedProjects, external: def.external, defaultMode: def.defaultMode }).returning();
      roleIds.set(def.key, role!.id);
      if (def.permissions.length) await tx.insert(rolePermissions).values(def.permissions.map((permission) => ({ roleId: role!.id, permission })));
    }
    await tx.insert(memberships).values({ organizationId: org!.id, userId: input.ownerUserId, roleId: roleIds.get('owner')!, status: 'active' });
    const [owner] = await tx.select().from(users).where(eq(users.id, input.ownerUserId)).limit(1);
    await this.activity.record(tx, { organizationId: org!.id, userId: input.ownerUserId, name: `${owner!.firstName} ${owner!.lastName}`, kind: 'user' }, { verb: 'created', objectType: 'organization', objectId: org!.id, objectLabel: org!.name });
    return org!;
  }

  // ---------- sessions ----------

  async login(input: { email: string; password: string; deviceName?: string }, meta: { ip?: string; userAgent?: string } = {}) {
    const { db } = this.deps;
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const ok = await verifyPassword(input.password, user?.passwordHash);
    if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect.');
    if (user.disabledAt) throw new AppError(403, 'forbidden', 'This account has been disabled.');
    const membershipRows = await this.listMemberships(db, user.id);
    const active = membershipRows.find((m) => m.status === 'active');
    const session = await this.createSession(user.id, active?.organization.id ?? null, { ...meta, deviceName: input.deviceName });
    await db.update(users).set({ lastActiveAt: sql`now()` }).where(eq(users.id, user.id));
    return this.sessionResponse(session.token, session.row.expiresAt, user, active?.organization.id ?? null);
  }

  private async createSession(userId: string, activeOrganizationId: string | null, meta: { ip?: string; userAgent?: string; deviceName?: string }) {
    const token = TOKEN_PREFIX + generateToken(32);
    const expiresAt = new Date(Date.now() + this.deps.config.SESSION_TTL_DAYS * 86_400_000).toISOString();
    const [row] = await this.deps.db.insert(sessions).values({ userId, tokenHash: hashToken(token), activeOrganizationId, deviceName: meta.deviceName ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null, ipAddress: meta.ip ?? null, expiresAt }).returning();
    return { token, row: row! };
  }

  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const { db } = this.deps;
    const [row] = await db.select({ session: sessions, user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`))).limit(1);
    if (!row || row.user.disabledAt) return null;
    // Touch last seen at most once a minute to limit writes.
    if (Date.now() - new Date(row.session.lastSeenAt).getTime() > 60_000) {
      void db.update(sessions).set({ lastSeenAt: sql`now()` }).where(eq(sessions.id, row.session.id)).catch(() => {});
      void db.update(users).set({ lastActiveAt: sql`now()` }).where(eq(users.id, row.user.id)).catch(() => {});
    }
    return { sessionId: row.session.id, user: row.user, activeOrganizationId: row.session.activeOrganizationId };
  }

  async logout(sessionId: string) {
    await this.deps.db.update(sessions).set({ revokedAt: sql`now()` }).where(eq(sessions.id, sessionId));
  }

  async logoutAll(userId: string, exceptSessionId?: string) {
    const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (exceptSessionId) conditions.push(sql`${sessions.id} <> ${exceptSessionId}`);
    await this.deps.db.update(sessions).set({ revokedAt: sql`now()` }).where(and(...conditions));
  }

  async switchOrganization(session: AuthenticatedSession, organizationId: string) {
    const rows = await this.listMemberships(this.deps.db, session.user.id);
    const target = rows.find((m) => m.organization.id === organizationId && m.status === 'active');
    if (!target) throw AppError.forbidden('You are not a member of that organization.');
    await this.deps.db.update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.id, session.sessionId));
    return this.me({ ...session, activeOrganizationId: organizationId });
  }

  // ---------- context building ----------

  async buildContext(session: AuthenticatedSession, organizationId: string | null, meta: { ip?: string; userAgent?: string }): Promise<RequestContext | null> {
    const orgId = organizationId ?? session.activeOrganizationId;
    if (!orgId) return null;
    const membership = await this.loadMembership(this.deps.db, session.user.id, orgId);
    if (!membership) return null;
    const user: ActorUser = { id: session.user.id, email: session.user.email, firstName: session.user.firstName, lastName: session.user.lastName };
    return new RequestContext(user, membership, session.sessionId, meta);
  }

  async loadMembership(db: DbOrTx, userId: string, organizationId: string): Promise<ActorMembership | null> {
    const [row] = await db.select({ m: memberships, r: roles }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId))).limit(1);
    if (!row) return null;
    const perms = await db.select({ p: rolePermissions.permission }).from(rolePermissions).where(eq(rolePermissions.roleId, row.r.id));
    return {
      id: row.m.id,
      organizationId,
      roleId: row.r.id,
      roleKey: row.r.key,
      roleName: row.r.name,
      permissions: new Set(perms.map((p) => p.p)),
      restrictToAssignedProjects: row.r.restrictToAssignedProjects,
      external: row.r.external,
      defaultMode: row.r.defaultMode as ActorMembership['defaultMode'],
      status: row.m.status as ActorMembership['status'],
    };
  }

  async listMemberships(db: DbOrTx, userId: string): Promise<contracts.MembershipSummary[]> {
    const rows = await db.select({ m: memberships, r: roles, o: organizations }).from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId)).innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, userId), isNull(organizations.archivedAt)));
    const out: contracts.MembershipSummary[] = [];
    for (const row of rows) {
      const perms = await db.select({ p: rolePermissions.permission }).from(rolePermissions).where(eq(rolePermissions.roleId, row.r.id));
      out.push({
        id: row.m.id,
        organization: { id: row.o.id, name: row.o.name, slug: row.o.slug, logoDocumentId: row.o.logoDocumentId, timezone: row.o.timezone, currency: row.o.currency },
        roleId: row.r.id, roleKey: row.r.key, roleName: row.r.name,
        permissions: perms.map((p) => p.p),
        restrictToAssignedProjects: row.r.restrictToAssignedProjects,
        external: row.r.external,
        defaultMode: row.r.defaultMode as 'office' | 'field' | 'portal',
        status: row.m.status as 'active' | 'suspended',
      });
    }
    return out;
  }

  async me(session: AuthenticatedSession): Promise<contracts.MeResponse> {
    const membershipsList = await this.listMemberships(this.deps.db, session.user.id);
    const active = membershipsList.find((m) => m.organization.id === session.activeOrganizationId) ?? null;
    return { user: serializeUser(session.user), memberships: membershipsList, activeOrganizationId: active?.organization.id ?? null, activeMembership: active };
  }

  private async sessionResponse(token: string, expiresAt: string, user: typeof users.$inferSelect, activeOrganizationId: string | null): Promise<contracts.SessionResponse> {
    const membershipsList = await this.listMemberships(this.deps.db, user.id);
    return { token, expiresAt, user: serializeUser(user), memberships: membershipsList, activeOrganizationId };
  }

  // ---------- profile & password ----------

  async updateProfile(session: AuthenticatedSession, input: { firstName?: string; lastName?: string; phone?: string | null }) {
    const [user] = await this.deps.db.update(users).set({ ...input, updatedAt: sql`now()` }).where(eq(users.id, session.user.id)).returning();
    return serializeUser(user!);
  }

  async changePassword(session: AuthenticatedSession, input: { currentPassword: string; newPassword: string }) {
    const ok = await verifyPassword(input.currentPassword, session.user.passwordHash);
    if (!ok) throw new AppError(401, 'invalid_credentials', 'Current password is incorrect.');
    await this.deps.db.update(users).set({ passwordHash: await hashPassword(input.newPassword), passwordChangedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(users.id, session.user.id));
    await this.logoutAll(session.user.id, session.sessionId);
  }

  async forgotPassword(email: string) {
    const [user] = await this.deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    // Always respond identically to avoid account enumeration.
    if (!user || user.disabledAt) return { resetUrl: undefined };
    const token = generateToken(32);
    await this.deps.db.insert(oneTimeTokens).values({ kind: 'password_reset', tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const resetUrl = `${this.deps.config.APP_URL}/reset-password?token=${token}`;
    await this.deps.providers.email.send({ to: user.email, subject: 'Reset your Buildline password', text: `Hi ${user.firstName},\n\nUse this link to choose a new password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`, template: 'password_reset' });
    return { resetUrl: this.deps.config.NODE_ENV === 'production' ? undefined : resetUrl };
  }

  async resetPassword(input: { token: string; password: string }) {
    const { db } = this.deps;
    const [row] = await db.select().from(oneTimeTokens).where(and(eq(oneTimeTokens.tokenHash, hashToken(input.token)), eq(oneTimeTokens.kind, 'password_reset'))).limit(1);
    if (!row || row.usedAt) throw new AppError(400, 'token_invalid', 'This reset link is invalid.');
    if (new Date(row.expiresAt) < new Date()) throw new AppError(400, 'token_expired', 'This reset link has expired. Request a new one.');
    await db.transaction(async (tx) => {
      await tx.update(oneTimeTokens).set({ usedAt: sql`now()` }).where(eq(oneTimeTokens.id, row.id));
      await tx.update(users).set({ passwordHash: await hashPassword(input.password), passwordChangedAt: sql`now()`, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`, updatedAt: sql`now()` }).where(eq(users.id, row.userId!));
      await tx.update(sessions).set({ revokedAt: sql`now()` }).where(and(eq(sessions.userId, row.userId!), isNull(sessions.revokedAt)));
    });
  }

  async issueEmailVerification(user: { id: string; email: string; firstName: string }) {
    const token = generateToken(32);
    await this.deps.db.insert(oneTimeTokens).values({ kind: 'email_verify', tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    const url = `${this.deps.config.APP_URL}/verify-email?token=${token}`;
    await this.deps.providers.email.send({ to: user.email, subject: 'Verify your Buildline email', text: `Hi ${user.firstName},\n\nConfirm your email address:\n${url}`, template: 'email_verify' });
    return this.deps.config.NODE_ENV === 'production' ? undefined : url;
  }

  async verifyEmail(token: string) {
    const { db } = this.deps;
    const [row] = await db.select().from(oneTimeTokens).where(and(eq(oneTimeTokens.tokenHash, hashToken(token)), eq(oneTimeTokens.kind, 'email_verify'))).limit(1);
    if (!row || row.usedAt) throw new AppError(400, 'token_invalid', 'This verification link is invalid.');
    if (new Date(row.expiresAt) < new Date()) throw new AppError(400, 'token_expired', 'This verification link has expired.');
    await db.transaction(async (tx) => {
      await tx.update(oneTimeTokens).set({ usedAt: sql`now()` }).where(eq(oneTimeTokens.id, row.id));
      await tx.update(users).set({ emailVerifiedAt: sql`now()` }).where(eq(users.id, row.userId!));
    });
  }

  async listSessions(session: AuthenticatedSession) {
    const rows = await this.deps.db.select().from(sessions).where(and(eq(sessions.userId, session.user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)));
    return rows.map((r) => ({ id: r.id, deviceName: r.deviceName, userAgent: r.userAgent, lastSeenAt: r.lastSeenAt, createdAt: r.createdAt, current: r.id === session.sessionId }));
  }

  async revokeSession(session: AuthenticatedSession, id: string) {
    await this.deps.db.update(sessions).set({ revokedAt: sql`now()` }).where(and(eq(sessions.id, id), eq(sessions.userId, session.user.id)));
  }
}

export function serializeUser(u: typeof users.$inferSelect): contracts.UserSummary {
  return { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, avatarDocumentId: u.avatarDocumentId, emailVerifiedAt: u.emailVerifiedAt, phone: u.phone };
}
