import { contracts } from '@buildline/core';
import type { AppInstance } from '../app.js';
import type { Services } from '../services/index.js';

export async function syncRoutes(app: AppInstance, s: Services) {
  app.get('/sync/pull', { schema: { tags: ['Sync'], querystring: contracts.syncPullQuery, response: { 200: contracts.syncPullResponse } } }, async (req) => s.sync.pull(req.requireCtx(), req.query));
  app.post('/sync/push', { schema: { tags: ['Sync'], body: contracts.syncPushBody, response: { 200: contracts.syncPushResponse } } }, async (req) => ({ results: await s.sync.push(req.requireCtx(), req.body.mutations) }));
}
