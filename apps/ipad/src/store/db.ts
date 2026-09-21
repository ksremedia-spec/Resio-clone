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

export class BuildlineDb extends Dexie {
  cache!: Table<CacheEntry, string>;
  outbox!: Table<OutboxItem, number>;
  blobs!: Table<BlobEntry, string>;
  constructor() {
    super('buildline');
    this.version(1).stores({ cache: 'url, orgId, storedAt', outbox: '++id, clientMutationId, orgId, status, createdAt', blobs: 'key, orgId' });
  }
}

export const db = new BuildlineDb();
