import { sql } from 'drizzle-orm';
import { bigint, integer, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { organizations, users } from './identity.js';

export const money = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);
export const bp = (name: string) => integer(name).notNull().default(0);
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** Columns every tenant record carries. */
export function tenantColumns() {
  return {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
  };
}

export function archivable() {
  return { archivedAt: ts('archived_at') };
}
