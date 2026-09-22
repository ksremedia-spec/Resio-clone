import { z } from 'zod';
import { addressSchema, auditFields, email, isoDateTime, longText, paginationQuery, shortText, uuid, patchOf } from './common.js';

export const contactSchema = auditFields.extend({
  clientId: uuid.nullable(),
  vendorId: uuid.nullable(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  isPrimary: z.boolean(),
  notes: z.string(),
  portalUserId: uuid.nullable().optional(),
});
export type Contact = z.infer<typeof contactSchema>;

export const createContactBody = z.object({
  firstName: shortText,
  lastName: z.string().trim().max(200).default(''),
  email: email.nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  isPrimary: z.boolean().default(false),
  notes: longText.default(''),
});
export const updateContactBody = patchOf(createContactBody);

export const clientSchema = auditFields.extend({
  displayName: z.string(),
  companyName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  billingAddress: addressSchema,
  notes: z.string(),
  status: z.enum(['active', 'archived']),
  archivedAt: isoDateTime.nullable(),
  projectCount: z.number().int().optional(),
  contacts: z.array(contactSchema).optional(),
});
export type Client = z.infer<typeof clientSchema>;

export const createClientBody = z.object({
  displayName: shortText,
  companyName: z.string().trim().max(200).nullable().optional(),
  email: email.nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  billingAddress: addressSchema.partial().optional(),
  notes: longText.default(''),
  contacts: z.array(createContactBody).max(20).optional(),
});
export const updateClientBody = patchOf(createClientBody, ['contacts']);

export const listClientsQuery = paginationQuery.extend({
  q: z.string().max(200).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  sort: z.enum(['displayName:asc', 'displayName:desc', 'updatedAt:desc', 'createdAt:desc']).default('displayName:asc'),
});
