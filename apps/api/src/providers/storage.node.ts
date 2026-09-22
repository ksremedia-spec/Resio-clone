import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../lib/crypto.js';
import { bodyToBytes, type StorageProvider, type StoredObject, type UploadBody } from './storage.js';

export class LocalDiskStorage implements StorageProvider {
  readonly name = 'local';
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    const safe = normalize(key).replace(/^(\.\.[/\\])+/, '');
    if (safe.includes('..')) throw new Error('invalid storage key');
    return join(this.root, safe);
  }

  async put(key: string, body: UploadBody, _contentType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    if (body instanceof Uint8Array || body instanceof Blob) {
      const bytes = await bodyToBytes(body);
      await writeFile(path, bytes);
      return { key, sizeBytes: bytes.length, checksumSha256: sha256Hex(bytes) };
    }
    const hash = createHash('sha256');
    let size = 0;
    const source = Readable.from(body);
    source.on('data', (chunk: Buffer) => { hash.update(chunk); size += chunk.length; });
    await pipeline(source, createWriteStream(path));
    return { key, sizeBytes: size, checksumSha256: hash.digest('hex') };
  }

  async getStream(key: string): Promise<AsyncIterable<Uint8Array>> {
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
      mod = await import(/* @vite-ignore */ '@aws-sdk/client-s3' as string);
    } catch {
      throw new Error('S3 storage requires the optional dependency @aws-sdk/client-s3');
    }
    this.client = { mod, s3: new mod.S3Client({ region: this.opts.region, endpoint: this.opts.endpoint, forcePathStyle: !!this.opts.endpoint, credentials: this.opts.accessKeyId ? { accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey } : undefined }) };
    return this.client;
  }

  async put(key: string, body: UploadBody, contentType: string): Promise<StoredObject> {
    const { mod, s3 } = await this.sdk();
    const buf = await bodyToBytes(body);
    await s3.send(new mod.PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: buf, ContentType: contentType }));
    return { key, sizeBytes: buf.length, checksumSha256: sha256Hex(buf) };
  }
  async getStream(key: string): Promise<AsyncIterable<Uint8Array>> {
    const { mod, s3 } = await this.sdk();
    const res = await s3.send(new mod.GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    return res.Body as AsyncIterable<Uint8Array>;
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
