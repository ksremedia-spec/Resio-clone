import { z } from 'zod';
import { email, shortText, uuid, isoDateTime } from './common.js';

export const password = z.string().min(10).max(200);

export const registerBody = z.object({
  email,
  password,
  firstName: shortText,
  lastName: shortText,
  organizationName: shortText,
});

export const loginBody = z.object({ email, password: z.string().min(1).max(200), deviceName: z.string().max(120).optional() });

export const userSummary = z.object({
  id: uuid,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  avatarDocumentId: uuid.nullable(),
  emailVerifiedAt: isoDateTime.nullable(),
  phone: z.string().nullable(),
});
export type UserSummary = z.infer<typeof userSummary>;

export const organizationSummary = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  logoDocumentId: uuid.nullable(),
  timezone: z.string(),
  currency: z.string(),
});
export type OrganizationSummary = z.infer<typeof organizationSummary>;

export const membershipSummary = z.object({
  id: uuid,
  organization: organizationSummary,
  roleId: uuid,
  roleKey: z.string().nullable(),
  roleName: z.string(),
  permissions: z.array(z.string()),
  restrictToAssignedProjects: z.boolean(),
  external: z.boolean(),
  defaultMode: z.enum(['office', 'field', 'portal']),
  status: z.enum(['active', 'suspended']),
});
export type MembershipSummary = z.infer<typeof membershipSummary>;

export const sessionResponse = z.object({
  token: z.string(),
  expiresAt: isoDateTime,
  user: userSummary,
  memberships: z.array(membershipSummary),
  activeOrganizationId: uuid.nullable(),
});
export type SessionResponse = z.infer<typeof sessionResponse>;

export const meResponse = z.object({
  user: userSummary,
  memberships: z.array(membershipSummary),
  activeOrganizationId: uuid.nullable(),
  activeMembership: membershipSummary.nullable(),
});
export type MeResponse = z.infer<typeof meResponse>;

export const forgotPasswordBody = z.object({ email });
export const resetPasswordBody = z.object({ token: z.string().min(10), password });
export const verifyEmailBody = z.object({ token: z.string().min(10) });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword: password });
export const updateProfileBody = z.object({ firstName: shortText.optional(), lastName: shortText.optional(), phone: z.string().max(40).nullable().optional() });
