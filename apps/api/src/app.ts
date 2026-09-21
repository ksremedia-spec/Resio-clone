import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { createDb } from './db/client.js';
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

  const { db, client } = createDb(config.DATABASE_URL);
  const providers = createProviders(config, overrides.providers);
  const services = createServices({ db, config, providers, log: fastify.log });

  await fastify.register(cors, { origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, exposedHeaders: ['content-disposition'] });
  await fastify.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: '1 minute', keyGenerator: (req) => (req.headers.authorization ?? req.ip).slice(0, 80) });
  await fastify.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 10 } });
  await fastify.register(swagger, {
    openapi: { info: { title: 'Buildline API', description: 'iPad-first construction management platform API. All non-auth routes require `Authorization: Bearer <session token>` and an active organization (`X-Organization-Id` header or session default).', version: '0.1.0' }, components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, security: [{ bearer: [] }] },
    transform: jsonSchemaTransform,
  });
  await fastify.register(swaggerUi, { routePrefix: '/docs' });
  await fastify.register(errorPlugin);
  await fastify.register(authPlugin, { services });

  fastify.get('/health', { schema: { hide: true } }, async () => ({ ok: true, time: new Date().toISOString() }));
  await registerRoutes(fastify as unknown as AppInstance, services, config);

  return {
    fastify,
    services,
    providers,
    async close() { await fastify.close(); await client.end(); },
  };
}
