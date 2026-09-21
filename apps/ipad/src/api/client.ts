import { db, type OutboxItem } from '../store/db';
import { emit } from '../store/events';

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
  get isNetwork() { return this.status === 0; }
}

let authToken: string | null = null;
let orgId: string | null = null;
export function setAuth(token: string | null, organizationId: string | null) { authToken = token; orgId = organizationId; }
export function getAuth() { return { token: authToken, orgId }; }

export interface RequestOptions {
  /** When offline (or the network fails), queue the mutation and resolve with `optimistic`. */
  queue?: { entity: string; label: string; optimistic: unknown; invalidates?: string[]; clientMutationId?: string };
  /** Serve from cache when the network fails (GET only). Default true. */
  cache?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface Result<T> { data: T; fromCache: boolean; queued: boolean }

async function rawFetch(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  if (orgId) headers['x-organization-id'] = orgId;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  return fetch(`${API_URL}${path}`, { method, headers, body: payload, signal: opts.signal });
}

async function parseError(res: Response): Promise<ApiError> {
  let json: any = null;
  try { json = await res.json(); } catch { /* ignore */ }
  const err = json?.error ?? {};
  return new ApiError(res.status, err.code ?? 'http_error', err.message ?? `Request failed (${res.status})`, err.details);
}

export async function get<T>(path: string, opts: RequestOptions = {}): Promise<Result<T>> {
  try {
    const res = await rawFetch('GET', path, undefined, opts);
    if (!res.ok) throw await parseError(res);
    const data = (await res.json()) as T;
    if (opts.cache !== false && orgId) void db.cache.put({ url: path, orgId, body: data, storedAt: Date.now() }).catch(() => {});
    return { data, fromCache: false, queued: false };
  } catch (err) {
    const networkFailure = !(err instanceof ApiError) || err.isNetwork;
    if (networkFailure && opts.cache !== false) {
      const cached = await db.cache.get(path).catch(() => undefined);
      if (cached && cached.orgId === orgId) { emit('offline', true); return { data: cached.body as T, fromCache: true, queued: false }; }
    }
    if (networkFailure) { emit('offline', true); throw new ApiError(0, 'network', 'You appear to be offline. Recently viewed data is still available.'); }
    throw err;
  }
}

export async function mutate<T>(method: OutboxItem['method'], path: string, body?: unknown, opts: RequestOptions = {}): Promise<Result<T>> {
  try {
    const res = await rawFetch(method, path, body, opts);
    if (!res.ok) throw await parseError(res);
    emit('offline', false);
    const data = (res.status === 204 ? null : await res.json()) as T;
    if (opts.queue?.invalidates) await invalidate(opts.queue.invalidates);
    return { data, fromCache: false, queued: false };
  } catch (err) {
    const networkFailure = !(err instanceof ApiError) || err.isNetwork;
    if (networkFailure && opts.queue && orgId) {
      emit('offline', true);
      await db.outbox.add({ clientMutationId: opts.queue.clientMutationId ?? crypto.randomUUID(), orgId, method, url: path, body: body ?? null, entity: opts.queue.entity, label: opts.queue.label, createdAt: Date.now(), attempts: 0, status: 'queued', invalidates: opts.queue.invalidates ?? [] });
      emit('outbox', undefined);
      return { data: opts.queue.optimistic as T, fromCache: false, queued: true };
    }
    if (networkFailure) { emit('offline', true); throw new ApiError(0, 'network', 'You appear to be offline. This change was not saved — try again when connected.'); }
    throw err;
  }
}

/** Upload a file as multipart; queues the blob locally when offline. */
export async function upload<T>(path: string, file: Blob, filename: string, meta: Record<string, unknown>, opts: { queue?: RequestOptions['queue']; contentType?: string } = {}): Promise<Result<T>> {
  const form = new FormData();
  const clientMutationId = opts.queue?.clientMutationId ?? crypto.randomUUID();
  form.append('meta', JSON.stringify({ ...meta, clientMutationId }));
  form.append('file', file, filename);
  try {
    const res = await rawFetch('POST', path, form);
    if (!res.ok) throw await parseError(res);
    emit('offline', false);
    if (opts.queue?.invalidates) await invalidate(opts.queue.invalidates);
    return { data: (await res.json()) as T, fromCache: false, queued: false };
  } catch (err) {
    const networkFailure = !(err instanceof ApiError) || err.isNetwork;
    if (networkFailure && opts.queue && orgId) {
      emit('offline', true);
      const blobKey = `blob-${clientMutationId}`;
      await db.blobs.put({ key: blobKey, orgId, blob: file, filename, contentType: opts.contentType ?? file.type, createdAt: Date.now() });
      await db.outbox.add({ clientMutationId, orgId, method: 'POST', url: path, body: { ...meta, clientMutationId }, blobKey, entity: opts.queue.entity, label: opts.queue.label, createdAt: Date.now(), attempts: 0, status: 'queued', invalidates: opts.queue.invalidates ?? [] });
      emit('outbox', undefined);
      return { data: opts.queue.optimistic as T, fromCache: false, queued: true };
    }
    if (networkFailure) throw new ApiError(0, 'network', 'Unable to upload right now. The file was not saved — try again when connected.');
    throw err;
  }
}

export async function invalidate(prefixes: string[]) {
  if (!prefixes.length) return;
  const all = await db.cache.toArray();
  const doomed = all.filter((c) => prefixes.some((p) => c.url === p || c.url.startsWith(p))).map((c) => c.url);
  if (doomed.length) await db.cache.bulkDelete(doomed);
  emit('invalidate', prefixes);
}

/** 2s, 4s, 8s … capped at 2 minutes. */
export function backoff(attempts: number): number { return Math.min(120_000, 2_000 * 2 ** Math.max(0, attempts - 1)); }

/** Replay a queued outbox item. Returns true when it succeeded. */
export async function replay(item: OutboxItem): Promise<boolean> {
  try {
    let res: Response;
    if (item.blobKey) {
      const blob = await db.blobs.get(item.blobKey);
      if (!blob) { await db.outbox.update(item.id!, { status: 'needs_attention', lastError: 'The queued file is no longer on this device.' }); return false; }
      const form = new FormData();
      form.append('meta', JSON.stringify(item.body));
      form.append('file', blob.blob, blob.filename);
      res = await rawFetch('POST', item.url, form);
    } else {
      res = await rawFetch(item.method, item.url, item.body ?? undefined);
    }
    if (res.ok || res.status === 409) {
      // 409 conflict/duplicate: the server already has this change; treat as delivered but tell the user if it was a real conflict.
      if (res.status === 409) {
        const e = await parseError(res);
        if (e.code === 'version_conflict') { await db.outbox.update(item.id!, { status: 'needs_attention', lastError: e.message, attempts: item.attempts + 1 }); return false; }
      }
      await db.outbox.delete(item.id!);
      if (item.blobKey) await db.blobs.delete(item.blobKey);
      await invalidate(item.invalidates);
      return true;
    }
    if (res.status >= 400 && res.status < 500) {
      const e = await parseError(res);
      await db.outbox.update(item.id!, { status: 'needs_attention', lastError: e.message, attempts: item.attempts + 1 });
      return false;
    }
    await db.outbox.update(item.id!, { attempts: item.attempts + 1, lastError: `Server error ${res.status}`, nextAttemptAt: Date.now() + backoff(item.attempts + 1) });
    return false;
  } catch (err) {
    await db.outbox.update(item.id!, { attempts: item.attempts + 1, lastError: (err as Error).message, nextAttemptAt: Date.now() + backoff(item.attempts + 1) });
    return false;
  }
}
