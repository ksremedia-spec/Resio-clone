import { z } from 'zod';

export const uuid = z.uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const isoDateTime = z.string().datetime({ offset: true });
export const cents = z.number().int().min(-9_007_199_254_740_991).max(9_007_199_254_740_991);
export const basisPoints = z.number().int().min(-1_000_000).max(1_000_000);
export const shortText = z.string().trim().min(1).max(200);
export const longText = z.string().trim().max(20_000);
export const email = z.email().max(320).transform((v) => v.toLowerCase());
export const phone = z.string().trim().max(40);
export const colorHex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const paginationQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const addressSchema = z.object({
  line1: z.string().trim().max(200).default(''),
  line2: z.string().trim().max(200).default(''),
  city: z.string().trim().max(120).default(''),
  region: z.string().trim().max(120).default(''),
  postalCode: z.string().trim().max(20).default(''),
  country: z.string().trim().max(2).default('US'),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
});
export type Address = z.infer<typeof addressSchema>;

export const auditFields = z.object({
  id: uuid,
  organizationId: uuid,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  createdBy: uuid.nullable(),
  updatedBy: uuid.nullable(),
  version: z.number().int(),
});

export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponse>;

export const idParams = z.object({ id: uuid });

/**
 * Build a PATCH schema from a create schema: every field becomes optional and
 * `.default()` wrappers are removed so an absent key means "leave unchanged"
 * rather than "reset to default" (Zod 4 keeps applying defaults in .partial()).
 */
export function patchOf<T extends z.ZodObject<any>>(schema: T, omit: string[] = []) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    if (omit.includes(key)) continue;
    let inner: any = field;
    while (inner?.def?.type === 'default' || inner?.def?.type === 'optional') inner = inner.def.innerType;
    shape[key] = (inner as z.ZodTypeAny).optional();
  }
  return z.object(shape);
}
