import Dexie, { type Table } from 'dexie';
import { sha256Hex } from '../../../api/src/lib/crypto';
import { bodyToBytes, type StorageProvider, type StoredObject, type UploadBody } from '../../../api/src/providers/storage';

interface BlobRow { key: string; bytes: Uint8Array; contentType: string }

class BlobDb extends Dexie {
  blobs!: Table<BlobRow, string>;
  constructor() { super('buildline-standalone-files'); this.version(1).stores({ blobs: 'key' }); }
}

/**
 * File storage for the browser-only build: bytes live in IndexedDB, and each
 * stored version gets an object URL so photos and PDFs display directly.
 */
export class BrowserStorage implements StorageProvider {
  readonly name = 'browser';
  private db = new BlobDb();
  private urls = new Map<string, string>();

  async init() {
    const rows = await this.db.blobs.toArray();
    for (const r of rows) this.remember(r.key, r.bytes, r.contentType);
  }
  private remember(key: string, bytes: Uint8Array, contentType: string) {
    const versionId = key.split('/').pop()!;
    const old = this.urls.get(versionId);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(versionId, URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType })));
  }
  async put(key: string, body: UploadBody, contentType: string): Promise<StoredObject> {
    const bytes = await bodyToBytes(body);
    await this.db.blobs.put({ key, bytes, contentType });
    this.remember(key, bytes, contentType);
    return { key, sizeBytes: bytes.length, checksumSha256: sha256Hex(bytes) };
  }
  async getStream(key: string): Promise<AsyncIterable<Uint8Array>> {
    const row = await this.db.blobs.get(key);
    if (!row) throw new Error('file not found');
    const bytes = row.bytes;
    return { async *[Symbol.asyncIterator]() { yield bytes; } };
  }
  async delete(key: string) { await this.db.blobs.delete(key); }
  async exists(key: string) { return !!(await this.db.blobs.get(key)); }
  urlFor(versionId: string) { return this.urls.get(versionId) ?? null; }
}
