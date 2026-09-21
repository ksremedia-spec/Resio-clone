import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { sha256Hex, sign, verifySignature } from '../lib/crypto.js';

/**
 * Storage abstraction. Files never live in the database; the database keeps
 * the storage key. Implementations: LocalDiskStorage (development, tests,
 * single-node deployments) and S3Storage (any S3-compatible bucket). Signed
 * URLs are produced by the API and verified by the download route, so the
 * same URL scheme works for both providers.
 */
export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class LocalDiskStorage implements StorageProvider {
  readonly name = 'local';
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    const safe = normalize(key).replace(/^(\.\.[/\\])+/, '');
    if (safe.includes('..')) throw new Error('invalid storage key');
    return join(this.root, safe);
  }

  async put(key: string, body: Buffer | Readable, _contentType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    if (Buffer.isBuffer(body)) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, body);
      return { key, sizeBytes: body.length, checksumSha256: sha256Hex(body) };
    }
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256');
    let size = 0;
    body.on('data', (chunk: Buffer) => { hash.update(chunk); size += chunk.length; });
    await pipeline(body, createWriteStream(path));
    return { key, sizeBytes: size, checksumSha256: hash.digest('hex') };
  }

  async getStream(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    await stat(path);
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    if (existsSync(path)) await unlink(path);
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.pathFor(key));
  }
}

/**
 * S3-compatible adapter. Kept dependency-free: uses the AWS SDK only when
 * configured, loaded dynamically so local deployments do not need it.
 */
export class S3Storage implements StorageProvider {
  readonly name = 's3';
  private client: any;
  constructor(private readonly opts: { bucket: string; region?: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string }) {}

  private async sdk() {
    if (this.client) return this.client;
    let mod: any;
    try {
      mod = await import('@aws-sdk/client-s3' as string);
    } catch {
      throw new Error('S3 storage requires the optional dependency @aws-sdk/client-s3');
    }
    this.client = { mod, s3: new mod.S3Client({ region: this.opts.region, endpoint: this.opts.endpoint, forcePathStyle: !!this.opts.endpoint, credentials: this.opts.accessKeyId ? { accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey } : undefined }) };
    return this.client;
  }

  async put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject> {
    const { mod, s3 } = await this.sdk();
    const buf = Buffer.isBuffer(body) ? body : await streamToBuffer(body);
    await s3.send(new mod.PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: buf, ContentType: contentType }));
    return { key, sizeBytes: buf.length, checksumSha256: sha256Hex(buf) };
  }
  async getStream(key: string): Promise<Readable> {
    const { mod, s3 } = await this.sdk();
    const res = await s3.send(new mod.GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    return res.Body as Readable;
  }
  async delete(key: string): Promise<void> {
    const { mod, s3 } = await this.sdk();
    await s3.send(new mod.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
  async exists(key: string): Promise<boolean> {
    const { mod, s3 } = await this.sdk();
    try { await s3.send(new mod.HeadObjectCommand({ Bucket: this.opts.bucket, Key: key })); return true; } catch { return false; }
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
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
