import { z } from 'zod';
import { isoDateTime, uuid } from './common.js';

/**
 * Offline sync contracts. The client keeps an outbox of mutations; each has a
 * client-generated id so replays are idempotent. Pull returns changed rows
 * for the entity types the caller has permission to read.
 */
export const SYNC_ENTITIES = ['project', 'client', 'task', 'phase', 'daily_log', 'document', 'folder', 'thread', 'message', 'time_entry', 'notification'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const syncPullQuery = z.object({
  since: isoDateTime.optional(),
  entities: z.string().optional(),
  projectIds: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const syncChange = z.object({
  entity: z.enum(SYNC_ENTITIES),
  id: uuid,
  version: z.number().int(),
  updatedAt: isoDateTime,
  deleted: z.boolean(),
  data: z.record(z.string(), z.unknown()).nullable(),
});

export const syncPullResponse = z.object({
  changes: z.array(syncChange),
  cursor: isoDateTime,
  hasMore: z.boolean(),
});

export const syncMutation = z.object({
  clientMutationId: z.string().min(8).max(64),
  entity: z.enum(SYNC_ENTITIES),
  operation: z.enum(['create', 'update', 'delete']),
  /** Client-side id for creates (uuid generated on device). */
  id: uuid,
  baseVersion: z.number().int().nullable(),
  data: z.record(z.string(), z.unknown()),
  occurredAt: isoDateTime,
});
export type SyncMutation = z.infer<typeof syncMutation>;

export const syncPushBody = z.object({ mutations: z.array(syncMutation).min(1).max(200) });

export const syncMutationResult = z.object({
  clientMutationId: z.string(),
  status: z.enum(['applied', 'duplicate', 'conflict', 'rejected']),
  entity: z.enum(SYNC_ENTITIES),
  id: uuid,
  version: z.number().int().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  /** For conflicts: the server's current record so the client can merge. */
  serverData: z.record(z.string(), z.unknown()).nullable(),
});
export const syncPushResponse = z.object({ results: z.array(syncMutationResult) });
