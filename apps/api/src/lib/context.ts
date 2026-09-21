import { and, eq, isNull } from 'drizzle-orm';
import type { Permission } from '@buildline/core';
import { AppError } from './errors.js';
import type { DbOrTx } from '../db/client.js';
import { projectMembers, projects } from '../db/schema/index.js';

export interface ActorUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface ActorMembership {
  id: string;
  organizationId: string;
  roleId: string;
  roleKey: string | null;
  roleName: string;
  permissions: Set<string>;
  restrictToAssignedProjects: boolean;
  external: boolean;
  defaultMode: 'office' | 'field' | 'portal';
  status: 'active' | 'suspended';
}

/**
 * Every service call receives a RequestContext. It is the only place
 * authorization decisions are made; routes, sync, AI tools and background
 * jobs all build one before calling a service.
 */
export class RequestContext {
  readonly projectAccessCache = new Map<string, boolean>();

  constructor(
    readonly user: ActorUser,
    readonly membership: ActorMembership,
    readonly sessionId: string | null,
    readonly meta: { ip?: string; userAgent?: string } = {},
  ) {}

  get userId() { return this.user.id; }
  get organizationId() { return this.membership.organizationId; }
  get actorName() { return `${this.user.firstName} ${this.user.lastName}`.trim(); }

  has(permission: Permission): boolean {
    return this.membership.status === 'active' && this.membership.permissions.has(permission);
  }

  require(permission: Permission): void {
    if (!this.has(permission)) throw AppError.forbidden(`Missing permission ${permission}.`);
  }

  hasAnyApprovalRead(): boolean {
    return this.has('change_orders.read') || this.has('proposals.read') || this.has('selections.read') || this.has('invoices.read');
  }

  requireAny(...permissions: Permission[]): void {
    if (!permissions.some((p) => this.has(p))) throw AppError.forbidden(`Missing permission ${permissions.join(' or ')}.`);
  }

  /** True when the role limits project data to explicit project membership. */
  get restrictedToAssignedProjects(): boolean {
    return this.membership.restrictToAssignedProjects;
  }

  /**
   * Verify the project belongs to this organization and, for restricted roles,
   * that the user is a member of it. Throws not_found (never revealing the
   * existence of other tenants' projects).
   */
  async requireProjectAccess(db: DbOrTx, projectId: string, opts: { allowArchived?: boolean } = {}): Promise<void> {
    const cacheKey = `${projectId}:${opts.allowArchived ? 1 : 0}`;
    const cached = this.projectAccessCache.get(cacheKey);
    if (cached === true) return;
    const [row] = await db.select({ id: projects.id, archivedAt: projects.archivedAt }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, this.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Project');
    if (row.archivedAt && !opts.allowArchived) throw AppError.notFound('Project');
    if (this.restrictedToAssignedProjects) {
      const [member] = await db.select({ id: projectMembers.id }).from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, this.userId))).limit(1);
      if (!member) throw AppError.notFound('Project');
    }
    this.projectAccessCache.set(cacheKey, true);
  }

  /** Project ids visible to this user when the role is restricted; null means "all in org". */
  async visibleProjectIds(db: DbOrTx): Promise<string[] | null> {
    if (!this.restrictedToAssignedProjects) return null;
    const rows = await db.select({ projectId: projectMembers.projectId }).from(projectMembers)
      .where(and(eq(projectMembers.userId, this.userId), eq(projectMembers.organizationId, this.organizationId), isNull(projectMembers.contactId)));
    return rows.map((r) => r.projectId);
  }
}
