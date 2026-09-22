import { db } from './db';
import { get, getAuth } from '../api/client';
import { emit } from './events';

/**
 * "Download for offline": pulls every record the person may read through the
 * sync API into IndexedDB, then warms the URL cache for the screens they use
 * most, so a project can be opened on site with no signal. Later refreshes
 * pull only what changed since the last cursor.
 */
export interface OfflineStatus { lastFullAt: number | null; lastRefreshAt: number | null; cursor: string | null; records: number; byEntity: Record<string, number>; urls: number }
export interface OfflineProgress { step: string; done: number; total: number }

const KEY = (orgId: string, k: string) => `${orgId}:${k}`;
const PAGE = 500;

interface SyncChange { entity: string; id: string; version: number; updatedAt: string; deleted: boolean; data: Record<string, unknown> | null }

export async function offlineStatus(): Promise<OfflineStatus> {
  const { orgId } = getAuth();
  if (!orgId) return { lastFullAt: null, lastRefreshAt: null, cursor: null, records: 0, byEntity: {}, urls: 0 };
  const [full, refresh, cursor] = await Promise.all([db.meta.get(KEY(orgId, 'lastFullAt')), db.meta.get(KEY(orgId, 'lastRefreshAt')), db.meta.get(KEY(orgId, 'cursor'))]).catch(() => [undefined, undefined, undefined]);
  const rows = await db.records.where('orgId').equals(orgId).toArray().catch(() => []);
  const byEntity: Record<string, number> = {};
  for (const r of rows) byEntity[r.entity] = (byEntity[r.entity] ?? 0) + 1;
  const urls = await db.cache.where('orgId').equals(orgId).count().catch(() => 0);
  return { lastFullAt: (full?.value as number) ?? null, lastRefreshAt: (refresh?.value as number) ?? null, cursor: (cursor?.value as string) ?? null, records: rows.length, byEntity, urls };
}

/** Pull everything (or everything since the cursor) into the local record store. */
export async function pullRecords(opts: { since?: string | null; onProgress?: (p: OfflineProgress) => void } = {}): Promise<{ changes: number; cursor: string }> {
  const { orgId } = getAuth();
  if (!orgId) throw new Error('Sign in first.');
  let since = opts.since ?? null;
  let changes = 0;
  let cursor = since ?? '';
  for (let pageNo = 0; pageNo < 200; pageNo++) {
    const res = await get<{ changes: SyncChange[]; cursor: string; hasMore: boolean }>(`/v1/sync/pull?limit=${PAGE}${since ? `&since=${encodeURIComponent(since)}` : ''}`, { cache: false });
    const page = res.data;
    const puts = page.changes.filter((c) => !c.deleted && c.data).map((c) => ({ entity: c.entity, id: c.id, orgId, projectId: (c.data as any)?.projectId ?? null, updatedAt: c.updatedAt, version: c.version, data: c.data }));
    const dels = page.changes.filter((c) => c.deleted).map((c) => [c.entity, c.id] as [string, string]);
    if (puts.length) await db.records.bulkPut(puts);
    if (dels.length) await db.records.bulkDelete(dels);
    changes += page.changes.length;
    cursor = page.cursor;
    opts.onProgress?.({ step: `Downloading records (${changes})`, done: changes, total: changes + (page.hasMore ? PAGE : 0) });
    if (!page.hasMore) break;
    since = page.cursor;
  }
  await db.meta.put({ key: KEY(orgId, 'cursor'), value: cursor });
  await db.meta.put({ key: KEY(orgId, 'lastRefreshAt'), value: Date.now() });
  return { changes, cursor };
}

/** The screens a person opens on site. Each URL is fetched once so the cache can serve it offline. */
export function screenUrls(projectIds: string[]): string[] {
  const today = new Date().toISOString().slice(0, 10);
  const twoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const month = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const urls = ['/v1/dashboard', '/v1/projects?status=open&limit=50', '/v1/projects?status=open&limit=100', '/v1/members', '/v1/time/current', '/v1/threads?limit=100', '/v1/cost-codes', '/v1/notifications?limit=20',
    `/v1/tasks?status=open&kind=todo&limit=200&sort=dueDate:asc&dueBefore=${twoWeeks}`, `/v1/tasks?status=open&kind=schedule&limit=200&sort=startDate:asc&dueAfter=${today}&dueBefore=${month}`];
  for (const id of projectIds) urls.push(`/v1/projects/${id}`, `/v1/projects/${id}/schedule`, `/v1/projects/${id}/phases`, `/v1/projects/${id}/tasks?status=all&kind=schedule&limit=200`, `/v1/projects/${id}/tasks?status=open&kind=todo&limit=200&sort=dueDate:asc`, `/v1/projects/${id}/daily-logs?limit=60`, `/v1/folders?projectId=${id}&root=true`, `/v1/threads?limit=100&projectId=${id}`);
  return urls;
}

let running = false;
/** Full download: records first, then the screens. Safe to run again; it just refreshes. */
export async function downloadForOffline(onProgress?: (p: OfflineProgress) => void): Promise<OfflineStatus> {
  if (running) throw new Error('A download is already running.');
  running = true;
  try {
    const { orgId } = getAuth();
    if (!orgId) throw new Error('Sign in first.');
    onProgress?.({ step: 'Downloading records', done: 0, total: 1 });
    await pullRecords({ since: null, onProgress });
    const projects = await get<{ items: Array<{ id: string }> }>('/v1/projects?status=open&limit=100');
    const urls = screenUrls(projects.data.items.map((p) => p.id));
    let done = 0;
    for (const url of urls) {
      try { await get(url); } catch { /* a screen the role cannot see; skip */ }
      done += 1;
      onProgress?.({ step: 'Saving screens', done, total: urls.length });
    }
    await db.meta.put({ key: KEY(orgId, 'lastFullAt'), value: Date.now() });
    emit('offline:downloaded', undefined);
    return offlineStatus();
  } finally { running = false; }
}

/** Incremental refresh used on reconnect; a no-op until the first full download. */
export async function refreshOfflineIfEnabled(): Promise<void> {
  const { orgId } = getAuth();
  if (!orgId || running) return;
  const full = await db.meta.get(KEY(orgId, 'lastFullAt')).catch(() => undefined);
  if (!full) return;
  const cursor = await db.meta.get(KEY(orgId, 'cursor')).catch(() => undefined);
  try { await pullRecords({ since: (cursor?.value as string) ?? null }); emit('offline:downloaded', undefined); } catch { /* offline again; try later */ }
}

export async function clearOfflineData(): Promise<void> {
  const { orgId } = getAuth();
  if (!orgId) return;
  await db.records.where('orgId').equals(orgId).delete();
  await db.cache.where('orgId').equals(orgId).delete();
  await db.meta.bulkDelete([KEY(orgId, 'lastFullAt'), KEY(orgId, 'lastRefreshAt'), KEY(orgId, 'cursor')]);
  emit('offline:downloaded', undefined);
}

/** Read downloaded records of one kind (used by screens that want a local list while offline). */
export async function localRecords<T = Record<string, unknown>>(entity: string, projectId?: string): Promise<T[]> {
  const { orgId } = getAuth();
  if (!orgId) return [];
  const rows = await db.records.where('orgId').equals(orgId).and((r) => r.entity === entity && (!projectId || r.projectId === projectId)).toArray().catch(() => []);
  return rows.map((r) => r.data as T);
}
