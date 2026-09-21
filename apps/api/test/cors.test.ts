import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

let app: TestApp;
beforeAll(async () => { app = await createTestApp(); });
afterAll(async () => { await app.close(); });

describe('CORS for the iPad client', () => {
  it('allows PATCH/DELETE with the organization header from an allowed origin', async () => {
    const res = await app.fastify.inject({ method: 'OPTIONS', url: '/v1/tasks/00000000-0000-0000-0000-000000000000', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization, content-type, x-organization-id' } });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(res.headers['access-control-allow-methods'])).toMatch(/PATCH/);
    expect(String(res.headers['access-control-allow-methods'])).toMatch(/DELETE/);
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('x-organization-id');
  });
  it('rejects unknown origins', async () => {
    const res = await app.fastify.inject({ method: 'OPTIONS', url: '/v1/projects', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
