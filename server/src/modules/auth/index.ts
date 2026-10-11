import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// Extend the Fastify request type.
declare module 'fastify' {
  interface FastifyRequest {
    /** Tenant id (workspace) resolved by the auth middleware. */
    tenantId?: string;
  }
}

export interface AuthOptions {
  /** The local API key accepted by this instance. */
  apiKey: string;
}

/** Shorten a key for log output, showing only the first 8 characters. */
function maskKey(key: string): string {
  return key.length <= 10 ? key.slice(0, 4) + '***' : key.slice(0, 8) + '***';
}

/**
 * Constant-time comparison of two keys: both sides are hashed with SHA-256
 * first so differing lengths do not leak via timing.
 */
function keysEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf-8').digest();
  const hb = createHash('sha256').update(b, 'utf-8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Auth middleware: validates the local API key entirely in-process.
 * No external service is contacted (local single-user mode).
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AuthOptions,
) {
  const apiKey = request.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    return reply.status(401).send({
      error: { code: 'auth.missing_key', message: 'Missing X-Api-Key header' },
    });
  }

  if (!keysEqual(apiKey, options.apiKey)) {
    request.log?.warn({ keyPrefix: maskKey(apiKey) }, 'API key rejected');
    return reply.status(401).send({
      error: { code: 'auth.invalid_key', message: 'Invalid API key' },
    });
  }

  request.tenantId = 'default';
}

/** Paths that never require authentication. */
const PUBLIC_PATHS = ['/health', '/health/readiness', '/health/liveness'];

/**
 * Register the auth module: global auth hook plus public-path allowlist.
 */
export async function registerAuthModule(app: FastifyInstance, options: AuthOptions) {
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?', 1)[0];
    if (PUBLIC_PATHS.includes(pathname)) {
      return;
    }
    await authMiddleware(request, reply, options);
  });
}
