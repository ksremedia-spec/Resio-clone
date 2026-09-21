import type { Deps } from './deps.js';
import { ActivityService } from './activity.service.js';
import { NotificationService } from './notification.service.js';
import { AuthService } from './auth.service.js';
import { OrganizationService } from './organization.service.js';
import { ClientService } from './client.service.js';
import { ProjectService } from './project.service.js';
import { DocumentService } from './document.service.js';
import { DashboardService } from './dashboard.service.js';
import { SearchService } from './search.service.js';
import { SyncService } from './sync.service.js';
import { ScheduleService } from './schedule.service.js';
import { DailyLogService } from './dailyLog.service.js';
import { MessageService } from './message.service.js';
import { registerSyncHandlers } from './sync.handlers.js';

export function createServices(deps: Deps) {
  const activity = new ActivityService(deps);
  const notifications = new NotificationService(deps);
  const auth = new AuthService(deps, activity);
  const organizations = new OrganizationService(deps, activity, notifications);
  const clients = new ClientService(deps, activity);
  const projects = new ProjectService(deps, activity, notifications);
  const documents = new DocumentService(deps, activity);
  const dashboard = new DashboardService(deps, activity, notifications);
  const search = new SearchService(deps);
  const sync = new SyncService(deps);
  const schedule = new ScheduleService(deps, activity, notifications, documents);
  const dailyLogs = new DailyLogService(deps, activity, notifications, documents);
  const messages = new MessageService(deps, activity, notifications, documents);
  const services = { activity, notifications, auth, organizations, clients, projects, documents, dashboard, search, sync, schedule, dailyLogs, messages };
  registerSyncHandlers(services);
  return services;
}

export type Services = ReturnType<typeof createServices>;
