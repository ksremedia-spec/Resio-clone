import { z } from 'zod';
import { addressSchema, email, isoDateTime, shortText, uuid, patchOf } from './common.js';
import { PERMISSIONS } from '../permissions.js';

export const organizationDetail = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  legalName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  address: addressSchema,
  timezone: z.string(),
  currency: z.string(),
  logoDocumentId: uuid.nullable(),
  defaultMarkupBp: z.number().int(),
  defaultTaxBp: z.number().int(),
  workingDays: z.array(z.number().int().min(0).max(6)),
  createdAt: isoDateTime,
});
export type OrganizationDetail = z.infer<typeof organizationDetail>;

export const updateOrganizationBody = z.object({
  name: shortText.optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  email: email.nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  address: addressSchema.partial().optional(),
  timezone: z.string().max(64).optional(),
  currency: z.string().length(3).optional(),
  defaultMarkupBp: z.number().int().min(0).max(100_000).optional(),
  defaultTaxBp: z.number().int().min(0).max(100_000).optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
});

export const roleSchema = z.object({
  id: uuid,
  key: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  isSystem: z.boolean(),
  restrictToAssignedProjects: z.boolean(),
  external: z.boolean(),
  defaultMode: z.enum(['office', 'field', 'portal']),
  permissions: z.array(z.string()),
  memberCount: z.number().int().optional(),
});
export type Role = z.infer<typeof roleSchema>;

export const createRoleBody = z.object({
  name: shortText,
  description: z.string().max(500).default(''),
  restrictToAssignedProjects: z.boolean().default(true),
  external: z.boolean().default(false),
  defaultMode: z.enum(['office', 'field', 'portal']).default('office'),
  permissions: z.array(z.enum(PERMISSIONS)),
  cloneFromRoleId: uuid.optional(),
});
export const updateRoleBody = patchOf(createRoleBody, ['cloneFromRoleId']);

export const memberSchema = z.object({
  id: uuid,
  userId: uuid,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  roleId: uuid,
  roleName: z.string(),
  roleKey: z.string().nullable(),
  status: z.enum(['active', 'suspended']),
  title: z.string().nullable(),
  hourlyCostCents: z.number().int().nullable(),
  joinedAt: isoDateTime,
  lastActiveAt: isoDateTime.nullable(),
});
export type Member = z.infer<typeof memberSchema>;

export const updateMemberBody = z.object({
  roleId: uuid.optional(),
  status: z.enum(['active', 'suspended']).optional(),
  title: z.string().max(120).nullable().optional(),
  hourlyCostCents: z.number().int().min(0).nullable().optional(),
});

export const invitationSchema = z.object({
  id: uuid,
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  roleId: uuid,
  roleName: z.string(),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  invitedByName: z.string(),
  expiresAt: isoDateTime,
  createdAt: isoDateTime,
  /** Only returned to the inviter at creation time (dev/test convenience when email is not configured). */
  acceptUrl: z.string().optional(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const createInvitationBody = z.object({
  email,
  roleId: uuid,
  firstName: shortText.optional(),
  lastName: shortText.optional(),
  projectIds: z.array(uuid).max(50).optional(),
  message: z.string().max(1000).optional(),
});

export const acceptInvitationBody = z.object({
  token: z.string().min(10),
  // Required when the invitee has no account yet.
  password: z.string().min(10).max(200).optional(),
  firstName: shortText.optional(),
  lastName: shortText.optional(),
});

export const invitationPreview = z.object({
  organizationName: z.string(),
  email: z.string(),
  roleName: z.string(),
  invitedByName: z.string(),
  accountExists: z.boolean(),
  expiresAt: isoDateTime,
});
