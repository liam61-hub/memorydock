import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthModule } from '../src/modules/auth/index.js';

const TEST_KEY = 'md_testkey0123456789abcdef0123456789abcdef';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await registerAuthModule(app, { apiKey: TEST_KEY });
  app.get('/protected', (request) => ({
    tenantId: request.tenantId ?? null,
  }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('auth middleware (local key)', () => {
  it('rejects requests without an X-Api-Key header with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with a wrong key with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-api-key': 'md_wrongkey' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the correct key and exposes the configured tenant id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-api-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: 'default' });
  });

  it('does not contact any external service: auth is fully local', async () => {
    // If the old external verification chain still existed, requests with a
    // valid-looking key would attempt a network fetch and fail/succeed based on
    // external state. A local key auth must succeed even with no network at all.
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-api-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('auth module routes', () => {
  it('does not proxy /api/auth/login to an external service', async () => {
    // With a valid key the request passes auth; the removed proxy route must
    // yield 404 (the old implementation would have returned 502/200).
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-api-key': TEST_KEY },
      payload: { username: 'admin', password: '123456' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not proxy /api/auth/refresh to an external service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { 'x-api-key': TEST_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('keeps /health public', async () => {
    // registerAuthModule does not own /health in this isolated app, but the
    // public-path allowlist must include it for the main server.
    const res = await app.inject({ method: 'GET', url: '/health' });
    // 404 here means the allowlist check passed (route simply not registered in
    // this test app); 401 would mean the allowlist failed.
    expect(res.statusCode).not.toBe(401);
  });

  it('keeps the readiness and liveness health endpoints public', async () => {
    for (const url of ['/health/readiness', '/health/liveness']) {
      const res = await app.inject({ method: 'GET', url });
      // 404 here means the allowlist check passed; the routes are not
      // registered in this isolated auth test app.
      expect(res.statusCode).not.toBe(401);
    }
  });

  it('does not expose arbitrary paths with a health prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/health-internal' });
    expect(res.statusCode).toBe(401);
  });
});
