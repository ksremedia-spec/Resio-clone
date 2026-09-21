import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryEmailProvider } from '../src/providers/email.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/buildline_test';

export interface TestApp extends App { email: MemoryEmailProvider }

export async function createTestApp(): Promise<TestApp> {
  const email = new MemoryEmailProvider();
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, STORAGE_LOCAL_PATH: mkdtempSync(join(tmpdir(), 'buildline-storage-')), EMAIL_DRIVER: 'memory', RATE_LIMIT_MAX: '100000', LOG_LEVEL: 'silent' });
  const app = await buildApp(config, { providers: { email }, logger: false });
  return Object.assign(app, { email });
}

export interface Actor { token: string; orgId: string; userId: string; email: string }

let counter = 0;
export function uniqueEmail(prefix = 'user') { return `${prefix}-${Date.now()}-${++counter}@example.test`; }

export async function registerOrg(app: App, opts: { org?: string; firstName?: string; lastName?: string } = {}): Promise<Actor> {
  const email = uniqueEmail('owner');
  const res = await app.fastify.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'correct horse battery', firstName: opts.firstName ?? 'Olivia', lastName: opts.lastName ?? 'Owner', organizationName: opts.org ?? `Org ${randomUUID().slice(0, 6)}` } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json();
  return { token: body.token, orgId: body.activeOrganizationId, userId: body.user.id, email };
}

export function api(app: App, actor: Actor | null) {
  const headers: Record<string, string> = actor ? { authorization: `Bearer ${actor.token}`, 'x-organization-id': actor.orgId } : {};
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, extraHeaders: Record<string, string> = {}) => {
    const res = await app.fastify.inject({ method, url, payload: payload as any, headers: { ...headers, ...extraHeaders } });
    let json: any = null;
    try { json = res.json(); } catch { json = null; }
    return { status: res.statusCode, body: json, raw: res };
  };
  return {
    get: (url: string, h?: Record<string, string>) => call('GET', url, undefined, h),
    post: (url: string, payload?: unknown, h?: Record<string, string>) => call('POST', url, payload, h),
    patch: (url: string, payload?: unknown) => call('PATCH', url, payload),
    put: (url: string, payload?: unknown) => call('PUT', url, payload),
    delete: (url: string) => call('DELETE', url),
    headers,
  };
}

/** Invite a user with the given system role key and accept the invitation, returning an actor. */
export async function inviteMember(app: App, owner: Actor, roleKey: string, opts: { firstName?: string; lastName?: string; projectIds?: string[] } = {}): Promise<Actor> {
  const client = api(app, owner);
  const roles = await client.get('/v1/roles');
  const role = roles.body.find((r: any) => r.key === roleKey);
  if (!role) throw new Error(`role ${roleKey} not found`);
  const email = uniqueEmail(roleKey);
  const inv = await client.post('/v1/invitations', { email, roleId: role.id, projectIds: opts.projectIds });
  if (inv.status !== 201) throw new Error(`invite failed: ${JSON.stringify(inv.body)}`);
  const token = new URL(inv.body.acceptUrl).searchParams.get('token')!;
  const accept = await app.fastify.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token, password: 'another strong password', firstName: opts.firstName ?? roleKey, lastName: opts.lastName ?? 'Member' } });
  if (accept.statusCode !== 200) throw new Error(`accept failed: ${accept.body}`);
  const body = accept.json();
  return { token: body.session.token, orgId: body.organizationId, userId: body.session.user.id, email };
}

export async function createProject(app: App, actor: Actor, overrides: Record<string, unknown> = {}) {
  const res = await api(app, actor).post('/v1/projects', { name: 'Smith Residence', type: 'remodel', contractValueCents: 12_500_000, address: { line1: '12 Oak St', city: 'Austin', region: 'TX' }, ...overrides });
  if (res.status !== 201) throw new Error(`project create failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export function multipart(parts: Array<{ name: string; value?: string; filename?: string; contentType?: string; data?: Buffer }>) {
  const boundary = `----buildline${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (p.filename) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.contentType ?? 'application/octet-stream'}\r\n\r\n`));
      chunks.push(p.data ?? Buffer.alloc(0));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value ?? ''}`));
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
