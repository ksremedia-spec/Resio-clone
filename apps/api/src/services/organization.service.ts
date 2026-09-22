import { and, count, eq, inArray, isNull, sql, desc } from 'drizzle-orm';
import { isPermission, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { one } from '../lib/rows.js';
import { invitations, memberships, oneTimeTokens, organizations, projectMembers, projects, rolePermissions, roles, sessions, users } from '../db/schema/index.js';
import { contacts } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import { generateToken, hashToken, hashPassword } from '../lib/crypto.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';

export class OrganizationService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService) {}

  async get(ctx: RequestContext): Promise<contracts.OrganizationDetail> {
    const [org] = await this.deps.db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
    if (!org) throw AppError.notFound('Organization');
    return serializeOrganization(org);
  }

  async update(ctx: RequestContext, input: Partial<Record<string, unknown>>): Promise<contracts.OrganizationDetail> {
    ctx.require('org.manage');
    return this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
      if (!before) throw AppError.notFound('Organization');
      const patch: Record<string, unknown> = { ...input, updatedAt: sql`now()` };
      if (input.address) patch.address = { ...(before.address as object), ...(input.address as object) };
      const [after] = await tx.update(organizations).set(patch as any).where(eq(organizations.id, ctx.organizationId)).returning();
      const diff = diffRecords(before as any, after as any, ['updatedAt', 'settings', 'nextProjectNumber']);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'updated', objectType: 'organization', objectId: after!.id, objectLabel: after!.name, diff });
      return serializeOrganization(after!);
    });
  }

  // ---------- roles ----------

  async listRoles(ctx: RequestContext): Promise<contracts.Role[]> {
    const { db } = this.deps;
    const rows = await db.select().from(roles).where(eq(roles.organizationId, ctx.organizationId)).orderBy(roles.isSystem, roles.name);
    const perms = await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, rows.map((r) => r.id)));
    const counts = await db.select({ roleId: memberships.roleId, n: count() }).from(memberships).where(eq(memberships.organizationId, ctx.organizationId)).groupBy(memberships.roleId);
    const countBy = new Map(counts.map((c) => [c.roleId, c.n]));
    return rows.map((r) => serializeRole(r, perms.filter((p) => p.roleId === r.id).map((p) => p.permission), countBy.get(r.id) ?? 0));
  }

  async createRole(ctx: RequestContext, input: { name: string; description: string; restrictToAssignedProjects: boolean; external: boolean; defaultMode: 'office' | 'field' | 'portal'; permissions: string[]; cloneFromRoleId?: string }): Promise<contracts.Role> {
    ctx.require('roles.manage');
    return this.deps.db.transaction(async (tx) => {
      let permissionsList: string[] = input.permissions.filter(isPermission);
      if (input.cloneFromRoleId) {
        const [src] = await tx.select().from(roles).where(and(eq(roles.id, input.cloneFromRoleId), eq(roles.organizationId, ctx.organizationId))).limit(1);
        if (!src) throw AppError.notFound('Role');
        const srcPerms = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, src.id));
        permissionsList = [...new Set([...srcPerms.map((p) => p.permission), ...permissionsList])];
      }
      const [role] = await tx.insert(roles).values({ organizationId: ctx.organizationId, key: null, name: input.name, description: input.description, isSystem: false, restrictToAssignedProjects: input.restrictToAssignedProjects, external: input.external, defaultMode: input.defaultMode }).returning();
      if (permissionsList.length) await tx.insert(rolePermissions).values(permissionsList.map((permission) => ({ roleId: role!.id, permission })));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'created', objectType: 'role', objectId: role!.id, objectLabel: role!.name });
      return serializeRole(role!, permissionsList, 0);
    });
  }

  async updateRole(ctx: RequestContext, roleId: string, input: Partial<{ name: string; description: string; restrictToAssignedProjects: boolean; external: boolean; defaultMode: 'office' | 'field' | 'portal'; permissions: string[] }>): Promise<contracts.Role> {
    ctx.require('roles.manage');
    return this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Role');
      if (before.key === 'owner') throw AppError.conflict('The Owner role cannot be modified.');
      const { permissions, ...rest } = input;
      const [after] = await tx.update(roles).set({ ...rest, updatedAt: sql`now()` }).where(eq(roles.id, roleId)).returning();
      let permissionsList: string[];
      if (permissions) {
        permissionsList = permissions.filter(isPermission);
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
        if (permissionsList.length) await tx.insert(rolePermissions).values(permissionsList.map((permission) => ({ roleId, permission })));
      } else {
        permissionsList = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId))).map((p) => p.permission);
      }
      const diff = diffRecords(before as any, after as any) ?? {};
      if (permissions) diff.permissions = { from: '(previous)', to: `${permissionsList.length} permissions` };
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'updated', objectType: 'role', objectId: roleId, objectLabel: after!.name, diff: Object.keys(diff).length ? diff : null });
      const { n } = one(await tx.select({ n: count() }).from(memberships).where(eq(memberships.roleId, roleId)));
      return serializeRole(after!, permissionsList, n);
    });
  }

  async deleteRole(ctx: RequestContext, roleId: string) {
    ctx.require('roles.manage');
    await this.deps.db.transaction(async (tx) => {
      const [role] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, ctx.organizationId))).limit(1);
      if (!role) throw AppError.notFound('Role');
      if (role.isSystem) throw AppError.conflict('System roles cannot be deleted.');
      const { n } = one(await tx.select({ n: count() }).from(memberships).where(eq(memberships.roleId, roleId)));
      if (n > 0) throw AppError.conflict('Reassign members before deleting this role.');
      await tx.delete(roles).where(eq(roles.id, roleId));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'deleted', objectType: 'role', objectId: roleId, objectLabel: role.name });
    });
  }

  // ---------- members ----------

  async listMembers(ctx: RequestContext): Promise<contracts.Member[]> {
    ctx.requireAny('members.manage', 'members.invite', 'projects.read');
    const rows = await this.deps.db.select({ m: memberships, u: users, r: roles }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId)).innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(eq(memberships.organizationId, ctx.organizationId)).orderBy(users.firstName, users.lastName);
    return rows.map(({ m, u, r }) => serializeMember(m, u, r));
  }

  async updateMember(ctx: RequestContext, membershipId: string, input: { roleId?: string; status?: 'active' | 'suspended'; title?: string | null; hourlyCostCents?: number | null }): Promise<contracts.Member> {
    ctx.require('members.manage');
    return this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select({ m: memberships, r: roles }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Member');
      if (input.roleId || input.status === 'suspended') {
        // Never allow removing/demoting the last active owner.
        if (before.r.key === 'owner') {
          const { n } = one(await tx.select({ n: count() }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId))
            .where(and(eq(memberships.organizationId, ctx.organizationId), eq(roles.key, 'owner'), eq(memberships.status, 'active'))));
          const demoting = input.roleId && input.roleId !== before.r.id;
          if (n <= 1 && (demoting || input.status === 'suspended')) throw AppError.conflict('An organization must keep at least one active owner.');
        }
        if (input.roleId) {
          const [role] = await tx.select().from(roles).where(and(eq(roles.id, input.roleId), eq(roles.organizationId, ctx.organizationId))).limit(1);
          if (!role) throw AppError.notFound('Role');
        }
      }
      const [after] = await tx.update(memberships).set({ ...input, updatedAt: sql`now()` }).where(eq(memberships.id, membershipId)).returning();
      if (input.status === 'suspended') await tx.update(sessions).set({ revokedAt: sql`now()` }).where(and(eq(sessions.userId, after!.userId), eq(sessions.activeOrganizationId, ctx.organizationId)));
      const [u] = await tx.select().from(users).where(eq(users.id, after!.userId)).limit(1);
      const [r] = await tx.select().from(roles).where(eq(roles.id, after!.roleId)).limit(1);
      const diff = diffRecords(before.m as any, after as any);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'updated', objectType: 'member', objectId: membershipId, objectLabel: `${u!.firstName} ${u!.lastName}`, diff });
      return serializeMember(after!, u!, r!);
    });
  }

  // ---------- invitations ----------

  async listInvitations(ctx: RequestContext): Promise<contracts.Invitation[]> {
    ctx.requireAny('members.invite', 'members.manage');
    const rows = await this.deps.db.select({ i: invitations, r: roles, u: users }).from(invitations).innerJoin(roles, eq(roles.id, invitations.roleId)).leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(eq(invitations.organizationId, ctx.organizationId), eq(invitations.status, 'pending'))).orderBy(desc(invitations.createdAt));
    return rows.map(({ i, r, u }) => serializeInvitation(i, r.name, u ? `${u.firstName} ${u.lastName}` : 'Buildline'));
  }

  async invite(ctx: RequestContext, input: { email: string; roleId: string; firstName?: string; lastName?: string; projectIds?: string[]; message?: string }): Promise<contracts.Invitation> {
    ctx.require('members.invite');
    const { db, config, providers } = this.deps;
    const [role] = await db.select().from(roles).where(and(eq(roles.id, input.roleId), eq(roles.organizationId, ctx.organizationId))).limit(1);
    if (!role) throw AppError.notFound('Role');
    if (role.key === 'owner' && !ctx.has('org.manage')) throw AppError.forbidden('Only an owner can invite another owner.');
    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existingUser) {
      const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, existingUser.id), eq(memberships.organizationId, ctx.organizationId))).limit(1);
      if (m) throw AppError.conflict('This person is already a member of your organization.');
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const invitation = await db.transaction(async (tx) => {
      await tx.update(invitations).set({ status: 'revoked', updatedAt: sql`now()` }).where(and(eq(invitations.organizationId, ctx.organizationId), eq(invitations.email, input.email), eq(invitations.status, 'pending')));
      const [inv] = await tx.insert(invitations).values({ organizationId: ctx.organizationId, email: input.email, firstName: input.firstName ?? null, lastName: input.lastName ?? null, roleId: role.id, projectIds: input.projectIds ?? [], message: input.message ?? null, invitedBy: ctx.userId, expiresAt }).returning();
      await tx.insert(oneTimeTokens).values({ kind: 'invitation', tokenHash: hashToken(token), organizationId: ctx.organizationId, subjectId: inv!.id, expiresAt });
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'invited', objectType: 'invitation', objectId: inv!.id, objectLabel: input.email, metadata: { roleName: role.name } });
      return inv!;
    });
    const acceptUrl = `${config.APP_URL}/invite?token=${token}`;
    await providers.email.send({ to: input.email, subject: `${ctx.actorName} invited you to ${org!.name} on Buildline`, text: `${ctx.actorName} invited you to join ${org!.name} as ${role.name}.\n${input.message ? `\n"${input.message}"\n` : ''}\nAccept the invitation (valid 14 days):\n${acceptUrl}`, template: 'invitation' });
    const out = serializeInvitation(invitation, role.name, ctx.actorName);
    if (config.NODE_ENV !== 'production') out.acceptUrl = acceptUrl;
    return out;
  }

  async revokeInvitation(ctx: RequestContext, id: string) {
    ctx.require('members.invite');
    await this.deps.db.transaction(async (tx) => {
      const [inv] = await tx.update(invitations).set({ status: 'revoked', updatedAt: sql`now()` }).where(and(eq(invitations.id, id), eq(invitations.organizationId, ctx.organizationId), eq(invitations.status, 'pending'))).returning();
      if (!inv) throw AppError.notFound('Invitation');
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { verb: 'revoked', objectType: 'invitation', objectId: id, objectLabel: inv.email });
    });
  }

  async previewInvitation(token: string): Promise<{ organizationName: string; email: string; roleName: string; invitedByName: string; accountExists: boolean; expiresAt: string }> {
    const inv = await this.loadInvitationByToken(token);
    const [org] = await this.deps.db.select().from(organizations).where(eq(organizations.id, inv.organizationId)).limit(1);
    const [role] = await this.deps.db.select().from(roles).where(eq(roles.id, inv.roleId)).limit(1);
    const [inviter] = inv.invitedBy ? await this.deps.db.select().from(users).where(eq(users.id, inv.invitedBy)).limit(1) : [];
    const [existing] = await this.deps.db.select({ id: users.id }).from(users).where(eq(users.email, inv.email)).limit(1);
    return { organizationName: org!.name, email: inv.email, roleName: role!.name, invitedByName: inviter ? `${inviter.firstName} ${inviter.lastName}` : 'Buildline', accountExists: !!existing, expiresAt: inv.expiresAt };
  }

  /** Email of a freshly created user (used to open a session right after accepting an invitation). */
  async previewInvitationEmailAfterAccept(userId: string): Promise<string> {
    const [u] = await this.deps.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw AppError.notFound('User');
    return u.email;
  }

  private async loadInvitationByToken(token: string) {
    const [t] = await this.deps.db.select().from(oneTimeTokens).where(and(eq(oneTimeTokens.tokenHash, hashToken(token)), eq(oneTimeTokens.kind, 'invitation'))).limit(1);
    if (!t || t.usedAt) throw new AppError(400, 'token_invalid', 'This invitation link is invalid or has already been used.');
    const [inv] = await this.deps.db.select().from(invitations).where(eq(invitations.id, t.subjectId!)).limit(1);
    if (!inv || inv.status !== 'pending') throw new AppError(400, 'token_invalid', 'This invitation is no longer valid.');
    if (new Date(inv.expiresAt) < new Date()) throw new AppError(400, 'token_expired', 'This invitation has expired. Ask for a new one.');
    return inv;
  }

  /**
   * Accept an invitation. When `currentUserId` is given the signed-in user
   * (whose email must match) joins; otherwise a new account is created from
   * password/firstName/lastName.
   */
  async acceptInvitation(input: { token: string; password?: string; firstName?: string; lastName?: string }, currentUser: { id: string; email: string } | null): Promise<{ userId: string; organizationId: string; created: boolean }> {
    const inv = await this.loadInvitationByToken(input.token);
    const { db } = this.deps;
    return db.transaction(async (tx) => {
      let userId: string;
      let created = false;
      let name: string;
      const [existing] = await tx.select().from(users).where(eq(users.email, inv.email)).limit(1);
      if (currentUser) {
        if (currentUser.email !== inv.email) throw AppError.forbidden(`This invitation was sent to ${inv.email}. Sign in with that address to accept it.`);
        userId = currentUser.id;
        name = `${existing!.firstName} ${existing!.lastName}`;
      } else if (existing) {
        throw new AppError(409, 'conflict', 'An account with this email already exists. Sign in, then open the invitation link again.');
      } else {
        if (!input.password || !input.firstName || !input.lastName) throw AppError.validation('Password, first name and last name are required to create your account.');
        const [u] = await tx.insert(users).values({ email: inv.email, passwordHash: await hashPassword(input.password), firstName: input.firstName, lastName: input.lastName, emailVerifiedAt: sql`now()`, passwordChangedAt: sql`now()` }).returning();
        userId = u!.id;
        created = true;
        name = `${u!.firstName} ${u!.lastName}`;
      }
      const [already] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.organizationId, inv.organizationId))).limit(1);
      if (!already) await tx.insert(memberships).values({ organizationId: inv.organizationId, userId, roleId: inv.roleId, status: 'active' });
      // Portal users: link the CRM contact with the same email so approvals and messages carry the contact.
      const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.organizationId, inv.organizationId), sql`lower(${contacts.email}) = ${inv.email.toLowerCase()}`)).limit(1);
      if (contact) await tx.update(contacts).set({ portalUserId: userId, updatedAt: sql`now()` }).where(eq(contacts.id, contact.id));
      for (const projectId of inv.projectIds) {
        const [p] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, inv.organizationId))).limit(1);
        if (p) await tx.insert(projectMembers).values({ organizationId: inv.organizationId, projectId, userId, accessLevel: 'member', createdBy: userId }).onConflictDoNothing();
      }
      await tx.update(invitations).set({ status: 'accepted', acceptedAt: sql`now()`, acceptedBy: userId, updatedAt: sql`now()` }).where(eq(invitations.id, inv.id));
      await tx.update(oneTimeTokens).set({ usedAt: sql`now()` }).where(and(eq(oneTimeTokens.kind, 'invitation'), eq(oneTimeTokens.subjectId, inv.id)));
      await this.activity.record(tx, { organizationId: inv.organizationId, userId, name, kind: 'user' }, { verb: 'joined', objectType: 'member', objectId: userId, objectLabel: name });
      if (inv.invitedBy) await this.notifications.notify(tx, { organizationId: inv.organizationId, userIds: [inv.invitedBy], kind: 'member.joined', title: `${name} joined your organization`, body: `${name} accepted your invitation.`, link: '/settings/members' });
      return { userId, organizationId: inv.organizationId, created };
    });
  }
}

export function serializeOrganization(org: typeof organizations.$inferSelect): contracts.OrganizationDetail {
  const address = org.address as Record<string, unknown>;
  return {
    id: org.id, name: org.name, slug: org.slug, legalName: org.legalName, email: org.email, phone: org.phone, website: org.website,
    address: { line1: '', line2: '', city: '', region: '', postalCode: '', country: 'US', latitude: null, longitude: null, ...address } as contracts.Address,
    timezone: org.timezone, currency: org.currency, logoDocumentId: org.logoDocumentId, defaultMarkupBp: org.defaultMarkupBp, defaultTaxBp: org.defaultTaxBp,
    workingDays: org.workingDays, createdAt: org.createdAt,
  };
}

export function serializeRole(r: typeof roles.$inferSelect, permissions: string[], memberCount: number): contracts.Role {
  return { id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, restrictToAssignedProjects: r.restrictToAssignedProjects, external: r.external, defaultMode: r.defaultMode as contracts.Role['defaultMode'], permissions, memberCount };
}

export function serializeMember(m: typeof memberships.$inferSelect, u: typeof users.$inferSelect, r: typeof roles.$inferSelect): contracts.Member {
  return { id: m.id, userId: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, phone: u.phone, roleId: r.id, roleName: r.name, roleKey: r.key, status: m.status as contracts.Member['status'], title: m.title, hourlyCostCents: m.hourlyCostCents, joinedAt: m.joinedAt, lastActiveAt: u.lastActiveAt };
}

export function serializeInvitation(i: typeof invitations.$inferSelect, roleName: string, invitedByName: string): contracts.Invitation {
  return { id: i.id, email: i.email, firstName: i.firstName, lastName: i.lastName, roleId: i.roleId, roleName, status: i.status as contracts.Invitation['status'], invitedByName, expiresAt: i.expiresAt, createdAt: i.createdAt };
}

export { isNull };
