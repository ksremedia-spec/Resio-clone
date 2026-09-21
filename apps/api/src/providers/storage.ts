import { sign, verifySignature } from '../lib/crypto.js';

/**
 * Storage abstraction. Files never live in the database; the database keeps
 * the storage key. Implementations: LocalDiskStorage and S3Storage (see
 * storage.node.ts) for servers, and an in-browser store for the standalone
 * demo. Signed URLs are produced by the API and verified by the download
 * route, so the same URL scheme works for every provider.
 */
export type UploadBody = Uint8Array | Blob | AsyncIterable<Uint8Array>;

export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, body: UploadBody, contentType: string): Promise<StoredObject>;
  getStream(key: string): Promise<AsyncIterable<Uint8Array>>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Optional: a directly usable URL for a stored version (browser demo returns object URLs). */
  urlFor?(versionId: string): string | null;
}

/** Signed, expiring download URLs (independent of provider). */
export function signDownload(secret: string, params: { versionId: string; orgId: string; expiresAt: number; disposition?: 'inline' | 'attachment' }): string {
  const payload = `${params.versionId}.${params.orgId}.${params.expiresAt}.${params.disposition ?? 'inline'}`;
  return sign(payload, secret);
}

export function verifyDownload(secret: string, params: { versionId: string; orgId: string; expiresAt: number; disposition: string; signature: string }): boolean {
  if (params.expiresAt < Date.now()) return false;
  const payload = `${params.versionId}.${params.orgId}.${params.expiresAt}.${params.disposition}`;
  return verifySignature(payload, params.signature, secret);
}

export async function bodyToBytes(body: UploadBody): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) { const c = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk; chunks.push(c); total += c.length; }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
