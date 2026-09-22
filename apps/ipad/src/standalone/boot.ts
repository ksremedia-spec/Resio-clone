/**
 * Boots the whole Buildline backend inside the browser: PGlite (Postgres in
 * WebAssembly, persisted in IndexedDB), the real migrations, the real
 * service layer, demo data, and a fetch interceptor that answers /v1/*.
 * Nothing leaves the page; there is no server.
 */
import init0 from '../../../api/drizzle/0000_init.sql?raw';
import init1 from '../../../api/drizzle/0001_security.sql?raw';
import { drizzleFromPglite, migratePglite } from '../../../api/src/db/pglite-shared';
import { loadConfig } from '../../../api/src/config';
import { createServices } from '../../../api/src/services/index';
import { MemoryEmailProvider } from '../../../api/src/providers/email';
import { demoPayments, nullPush, nullSms, nullWeather } from '../../../api/src/providers/integrations';
import { seedDemo } from '../../../api/src/db/seed-data';
import { BrowserStorage } from './storage';
import { installFetchInterceptor } from './router';

export type BootStage = 'engine' | 'database' | 'services' | 'demo' | 'ready';

export async function bootStandalone(onStage: (stage: BootStage, detail?: string) => void): Promise<void> {
  onStage('engine', 'Loading the database engine (about 14 MB, first time only)');
  const { PGlite } = await import('@electric-sql/pglite');
  const client = new PGlite('idb://buildline-demo');
  await client.waitReady;
  onStage('database', 'Preparing tables');
  await migratePglite(client, [{ name: '0000_init.sql', body: init0 }, { name: '0001_security.sql', body: init1 }]);
  const db = drizzleFromPglite(client);
  onStage('services');
  // An Anthropic key pasted in Settings → AI assistant lives only in this browser and is sent straight to Anthropic.
  let anthropicKey: string | undefined; try { anthropicKey = localStorage.getItem('buildline.anthropicKey') ?? undefined; } catch { /* storage blocked */ }
  const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'pglite://browser', APP_URL: window.location.origin + window.location.pathname, API_URL: window.location.origin, APP_SECRET: 'standalone-demo-secret-not-for-production', EMAIL_DRIVER: 'memory', STORAGE_DRIVER: 'local', ANTHROPIC_API_KEY: anthropicKey || undefined });
  const storage = new BrowserStorage();
  await storage.init();
  const email = new MemoryEmailProvider();
  const services = createServices({ db, config, providers: { storage, email, payments: demoPayments, weather: nullWeather, push: nullPush, sms: nullSms }, log: console });
  onStage('demo', 'Creating the demo company');
  await seedDemo(services, db);
  installFetchInterceptor(services, config);
  (window as any).__buildlineStandalone = { services, db, email, storage };
  onStage('ready');
}

/** Wipe the in-browser database and files (Settings → "Reset demo data"). */
export async function resetStandalone() {
  const dbs = await (indexedDB.databases?.() ?? Promise.resolve([]));
  for (const d of dbs) if (d.name && (d.name.includes('buildline') || d.name.startsWith('/pglite'))) indexedDB.deleteDatabase(d.name);
  localStorage.clear();
  window.location.reload();
}
