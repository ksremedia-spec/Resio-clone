import { db } from './db';
import { replay, getAuth } from '../api/client';
import { emit, on } from './events';
import { network } from '../native';

/**
 * Outbox processor. Runs when connectivity returns, when a change is queued,
 * and on an interval. Items are replayed strictly in creation order so that
 * dependent changes (create a log, then upload its photo) arrive in order.
 */
let running = false;
export async function processOutbox(): Promise<{ sent: number; remaining: number }> {
  if (running) return { sent: 0, remaining: await pendingCount() };
  running = true;
  let sent = 0;
  try {
    const { orgId } = getAuth();
    if (!orgId) return { sent: 0, remaining: 0 };
    const items = await db.outbox.where('orgId').equals(orgId).sortBy('createdAt');
    for (const item of items) {
      if (item.status === 'needs_attention') continue;
      if (item.nextAttemptAt && item.nextAttemptAt > Date.now()) continue;
      await db.outbox.update(item.id!, { status: 'sending' });
      const ok = await replay(item);
      if (ok) { sent += 1; emit('offline', false); }
      else {
        const fresh = await db.outbox.get(item.id!);
        if (fresh && fresh.status === 'sending') await db.outbox.update(item.id!, { status: 'queued' });
        // A network failure stops the run; a rejected item is skipped so later ones still go.
        if (fresh && fresh.status !== 'needs_attention' && !(await network.isOnline())) break;
      }
    }
  } finally {
    running = false;
    emit('outbox:changed', undefined);
  }
  return { sent, remaining: await pendingCount() };
}

export async function pendingCount(): Promise<number> {
  const { orgId } = getAuth();
  if (!orgId) return 0;
  return db.outbox.where('orgId').equals(orgId).count();
}

export async function retryItem(id: number) {
  await db.outbox.update(id, { status: 'queued', lastError: undefined, nextAttemptAt: 0 });
  return processOutbox();
}

export async function discardItem(id: number) {
  const item = await db.outbox.get(id);
  if (item?.blobKey) await db.blobs.delete(item.blobKey);
  await db.outbox.delete(id);
  emit('outbox:changed', undefined);
}

let started = false;
export function startSyncEngine() {
  if (started) return;
  started = true;
  network.onChange((online) => { emit('offline', !online); if (online) void processOutbox(); });
  // New items trigger a run; runs never re-trigger themselves (they emit outbox:changed instead), and failed items back off.
  on('outbox', () => { void network.isOnline().then((online) => { if (online) void processOutbox(); }); });
  setInterval(() => { void network.isOnline().then((online) => { if (online) void processOutbox(); }); }, 15_000);
  void processOutbox();
}
