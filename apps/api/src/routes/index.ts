import type { AppInstance } from '../app.js';
import type { Config } from '../config.js';
import type { Services } from '../services/index.js';
import { authRoutes } from './auth.routes.js';
import { organizationRoutes } from './organization.routes.js';
import { clientRoutes } from './client.routes.js';
import { projectRoutes } from './project.routes.js';
import { miscRoutes } from './misc.routes.js';
import { documentRoutes } from './document.routes.js';
import { scheduleRoutes } from './schedule.routes.js';
import { dailyLogRoutes } from './dailyLog.routes.js';
import { messageRoutes } from './message.routes.js';
import { syncRoutes } from './sync.routes.js';
import { financialRoutes } from './financial.routes.js';
import { fieldRoutes } from './field.routes.js';

export async function registerRoutes(app: AppInstance, services: Services, config: Config) {
  await app.register(async (v1) => {
    await authRoutes(v1 as AppInstance, services, config);
    await organizationRoutes(v1 as AppInstance, services);
    await clientRoutes(v1 as AppInstance, services);
    await projectRoutes(v1 as AppInstance, services);
    await miscRoutes(v1 as AppInstance, services);
    await documentRoutes(v1 as AppInstance, services);
    await scheduleRoutes(v1 as AppInstance, services);
    await dailyLogRoutes(v1 as AppInstance, services);
    await messageRoutes(v1 as AppInstance, services);
    await syncRoutes(v1 as AppInstance, services);
    await financialRoutes(v1 as AppInstance, services);
    await fieldRoutes(v1 as AppInstance, services);
  }, { prefix: '/v1' });
}
