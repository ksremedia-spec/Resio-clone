import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { createDb } from './db/client.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createProviders, type Providers } from './providers/index.js';
import { createServices, type Services } from './services/index.js';
import { authPlugin } from './plugins/auth.js';
import { errorPlugin } from './plugins/errors.js';
import { registerRoutes } from './routes/index.js';

export interface App {
  fastify: FastifyInstance;
  services: Services;
  providers: Providers;
  close(): Promise<void>;
}

export type AppInstance = FastifyInstance<any, any, any, any, ZodTypeProvider>;

export async function buildApp(config: Config, overrides: { providers?: Partial<Providers>; logger?: boolean } = {}): Promise<App> {
  const fastify = Fastify({ logger: overrides.logger ?? (config.NODE_ENV !== 'test' ? { level: config.LOG_LEVEL } : false), trustProxy: true, bodyLimit: 2 * 1024 * 1024 }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  const { db, close: closeDb } = await createDb(config.DATABASE_URL);
  const providers = createProviders(config, overrides.providers);
  const services = createServices({ db, config, providers, log: fastify.log });

  await fastify.register(cors, { origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['authorization', 'content-type', 'x-organization-id', 'accept'], exposedHeaders: ['content-disposition'] });
  await fastify.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: '1 minute', keyGenerator: (req) => (req.headers.authorization ?? req.ip).slice(0, 80) });
  await fastify.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 10 } });
  await fastify.register(swagger, {
    openapi: { info: { title: 'Buildline API', description: 'iPad-first construction management platform API. All non-auth routes require `Authorization: Bearer <session token>` and an active organization (`X-Organization-Id` header or session default).', version: '0.1.0' }, components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, security: [{ bearer: [] }] },
    transform: jsonSchemaTransform,
  });
  await fastify.register(swaggerUi, { routePrefix: '/docs' });
  // Optional: serve the built client from the same process (demo / single-box deployments).
  let clientRoot: string | null = null;
  if (config.SERVE_CLIENT_DIR) {
    clientRoot = resolve(config.SERVE_CLIENT_DIR);
    if (!existsSync(join(clientRoot, 'index.html'))) throw new Error(`SERVE_CLIENT_DIR ${clientRoot} does not contain a built client (run pnpm --filter @buildline/ipad build)`);
    await fastify.register(fastifyStatic, { root: clientRoot, prefix: '/', wildcard: false, decorateReply: true });
  }
  await fastify.register(errorPlugin, { spaFallback: !!clientRoot });
  await fastify.register(authPlugin, { services });

  fastify.get('/health', { schema: { hide: true } }, async () => ({ ok: true, time: new Date().toISOString() }));
  await registerRoutes(fastify as unknown as AppInstance, services, config);
  // Scheduled automations (overdue invoices/tasks, lead follow-ups) are checked hourly outside tests.
  if (config.NODE_ENV !== 'test') {
    const timer = setInterval(() => { void services.automations.runScheduledEverywhere(); }, 60 * 60 * 1000);
    timer.unref?.();
    fastify.addHook('onClose', async () => clearInterval(timer));
  }


  return {
    fastify,
    services,
    providers,
    async close() { await fastify.close(); await closeDb(); },
  };
}
