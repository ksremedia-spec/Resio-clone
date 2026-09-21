import { contracts } from '@buildline/core';
import type { Services } from './index.js';
import { AppError } from '../lib/errors.js';

/**
 * Maps offline mutations onto the ordinary service methods. Each handler
 * validates with the same zod contract as the REST route, so the offline
 * path can never do something the online path cannot.
 */
export function registerSyncHandlers(s: Services) {
  const { sync } = s;

  sync.registerHandler('task', 'create', async (ctx, m) => {
    const { projectId, ...rest } = m.data as { projectId: string } & Record<string, unknown>;
    if (!projectId) throw AppError.validation('projectId is required');
    const body = contracts.createTaskBody.parse(rest);
    const task = await s.schedule.createTask(ctx, projectId, { ...body, id: m.id, clientMutationId: m.clientMutationId });
    return { version: task.version, data: task };
  });
  sync.registerHandler('task', 'update', async (ctx, m) => {
    const body = contracts.updateTaskBody.parse(m.data);
    const task = await s.schedule.updateTask(ctx, m.id, { ...body, expectedVersion: m.baseVersion ?? undefined });
    return { version: task.version, data: task };
  });
  sync.registerHandler('task', 'delete', async (ctx, m) => { await s.schedule.archiveTask(ctx, m.id); return { version: null, data: null }; });

  sync.registerHandler('daily_log', 'create', async (ctx, m) => {
    const { projectId, ...rest } = m.data as { projectId: string } & Record<string, unknown>;
    if (!projectId) throw AppError.validation('projectId is required');
    const body = contracts.createDailyLogBody.parse(rest);
    const log = await s.dailyLogs.create(ctx, projectId, { ...body, id: m.id });
    return { version: log.version, data: log };
  });
  sync.registerHandler('daily_log', 'update', async (ctx, m) => {
    const body = contracts.updateDailyLogBody.parse(m.data);
    const log = await s.dailyLogs.update(ctx, m.id, { ...body, expectedVersion: m.baseVersion ?? undefined });
    return { version: log.version, data: log };
  });

  sync.registerHandler('message', 'create', async (ctx, m) => {
    const { threadId, ...rest } = m.data as { threadId: string } & Record<string, unknown>;
    if (!threadId) throw AppError.validation('threadId is required');
    const body = contracts.sendMessageBody.parse(rest);
    const msg = await s.messages.send(ctx, threadId, { ...body, clientMutationId: m.clientMutationId });
    return { version: 1, data: msg };
  });
  sync.registerHandler('thread', 'create', async (ctx, m) => {
    const body = contracts.createThreadBody.parse(m.data);
    const thread = await s.messages.createThread(ctx, { ...body, clientMutationId: m.clientMutationId });
    return { version: thread.version, data: thread };
  });

  sync.registerHandler('project', 'update', async (ctx, m) => {
    const body = contracts.updateProjectBody.parse(m.data);
    const p = await s.projects.update(ctx, m.id, { ...body, expectedVersion: m.baseVersion ?? undefined });
    return { version: p.version, data: p };
  });
  sync.registerHandler('client', 'update', async (ctx, m) => {
    const body = contracts.updateClientBody.parse(m.data);
    const c = await s.clients.update(ctx, m.id, body);
    return { version: c.version, data: c };
  });
  sync.registerHandler('notification', 'update', async (ctx, m) => { await s.notifications.markRead(ctx, m.id); return { version: null, data: null }; });
}
