import Dexie, { type Table } from 'dexie';

/**
 * Local persistence (IndexedDB). Three concerns:
 *  - `cache`: GET responses keyed by URL, so recently viewed data is
 *    available offline.
 *  - `outbox`: queued mutations that could not reach the server. They are
 *    replayed in order when connectivity returns; nothing is ever dropped
 *    silently — failed items stay with `needsAttention` for the user.
 *  - `blobs`: photos/files captured offline, uploaded when online.
 */
export interface CacheEntry { url: string; orgId: string; body: unknown; storedAt: number }
export interface OutboxItem {
  id?: number;
  clientMutationId: string;
  orgId: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  body: unknown | null;
  /** For file uploads: key into `blobs`. */
  blobKey?: string;
  entity: string;
  label: string;
  createdAt: number;
  attempts: number;
  status: 'queued' | 'sending' | 'needs_attention';
  lastError?: string;
  /** Earliest time (ms) the next attempt may run; grows exponentially with failures. */
  nextAttemptAt?: number;
  /** Which cached URLs to invalidate after success. */
  invalidates: string[];
}
export interface BlobEntry { key: string; orgId: string; blob: Blob; filename: string; contentType: string; createdAt: number }
/** A record pulled through /v1/sync/pull by "Download for offline". */
export interface LocalRecord { entity: string; id: string; orgId: string; projectId: string | null; updatedAt: string; version: number; data: unknown }
export interface MetaEntry { key: string; value: unknown }

export class BuildlineDb extends Dexie {
  cache!: Table<CacheEntry, string>;
  outbox!: Table<OutboxItem, number>;
  blobs!: Table<BlobEntry, string>;
  records!: Table<LocalRecord, [string, string]>;
  meta!: Table<MetaEntry, string>;
  constructor() {
    super('buildline');
    this.version(1).stores({ cache: 'url, orgId, storedAt', outbox: '++id, clientMutationId, orgId, status, createdAt', blobs: 'key, orgId' });
    // v2: full offline download (records pulled through sync + per-org metadata such as the sync cursor).
    this.version(2).stores({ cache: 'url, orgId, storedAt', outbox: '++id, clientMutationId, orgId, status, createdAt', blobs: 'key, orgId', records: '[entity+id], orgId, entity, projectId, updatedAt', meta: 'key' });
  }
}

export const db = new BuildlineDb();
