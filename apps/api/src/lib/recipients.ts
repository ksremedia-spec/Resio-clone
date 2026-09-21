import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { memberships, projectMembers, rolePermissions } from '../db/schema/index.js';

/** Active members of the organization whose role grants the permission (used to route approvals). */
export async function usersWithPermission(db: DbOrTx, organizationId: string, permission: string): Promise<string[]> {
  const rows = await db.select({ userId: memberships.userId }).from(memberships).innerJoin(rolePermissions, eq(rolePermissions.roleId, memberships.roleId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, 'active'), eq(rolePermissions.permission, permission)));
  return [...new Set(rows.map((r) => r.userId))];
}

/** Internal users on a project's team, optionally limited to those holding a permission. */
export async function projectTeamUserIds(db: DbOrTx, organizationId: string, projectId: string, permission?: string): Promise<string[]> {
  const rows = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
  const ids = rows.map((r) => r.userId).filter((x): x is string => !!x);
  if (!permission || !ids.length) return [...new Set(ids)];
  const allowed = await db.select({ userId: memberships.userId }).from(memberships).innerJoin(rolePermissions, eq(rolePermissions.roleId, memberships.roleId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, 'active'), eq(rolePermissions.permission, permission), inArray(memberships.userId, ids)));
  return [...new Set(allowed.map((r) => r.userId))];
}
