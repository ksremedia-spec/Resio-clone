type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();
export function on(event: 'offline' | 'outbox' | 'outbox:changed' | 'invalidate' | 'toast' | 'unauthorized' | 'offline:downloaded', handler: Handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler);
  return () => { handlers.get(event)!.delete(handler); };
}
export function emit(event: 'offline' | 'outbox' | 'outbox:changed' | 'invalidate' | 'toast' | 'unauthorized' | 'offline:downloaded', payload: any) {
  handlers.get(event)?.forEach((h) => { try { h(payload); } catch { /* ignore */ } });
}
