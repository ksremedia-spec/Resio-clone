import { z } from 'zod';
import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

const ok = z.object({ ok: z.literal(true) });

export async function miscRoutes(app: AppInstance, s: Services) {
  app.get('/dashboard', { schema: { tags: ['Dashboard'], response: { 200: contracts.dashboardResponse } } }, async (req) => s.dashboard.get(req.requireCtx()));
  app.get('/activity', { schema: { tags: ['Activity'], querystring: contracts.listActivityQuery, response: { 200: contracts.paginated(contracts.activityEntry) } } }, async (req) => s.activity.list(req.requireCtx(), req.query));
  app.get('/search', { schema: { tags: ['Search'], querystring: contracts.searchQuery, response: { 200: contracts.searchResponse } } }, async (req) => ({ results: await s.search.search(req.requireCtx(), req.query) }));

  app.get('/notifications', { schema: { tags: ['Notifications'], querystring: contracts.listNotificationsQuery, response: { 200: contracts.paginated(contracts.notificationSchema).extend({ unreadCount: z.number().int() }) } } }, async (req) => {
    const ctx = req.requireCtx();
    const list = await s.notifications.list(ctx, req.query);
    return { ...list, unreadCount: await s.notifications.unreadCount(ctx) };
  });
  app.post('/notifications/:id/read', { schema: { tags: ['Notifications'], params: z.object({ id: z.union([z.uuid(), z.literal('all')]) }), response: { 200: ok } } }, async (req) => { await s.notifications.markRead(req.requireCtx(), req.params.id); return { ok: true as const }; });
  app.get('/notification-preferences', { schema: { tags: ['Notifications'], response: { 200: contracts.notificationPreferences } } }, async (req) => s.notifications.getPreferences(req.requireCtx()));
  app.put('/notification-preferences', { schema: { tags: ['Notifications'], body: contracts.notificationPreferences, response: { 200: contracts.notificationPreferences } } }, async (req) => s.notifications.setPreferences(req.requireCtx(), req.body));
  app.post('/push-tokens', { schema: { tags: ['Notifications'], body: contracts.registerPushTokenBody, response: { 200: ok } } }, async (req) => { await s.notifications.registerPushToken(req.requireCtx(), req.body); return { ok: true as const }; });
}
