import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * Lightweight in-memory rate limiter middleware (sliding window)
 *
 * Design principles:
 * - Zero external dependencies, backed by an in-memory Map
 * - Rate limit per IP + endpoint
 * - Lazy cleanup: expired records are checked and purged on each request
 * - Memory safe: caps the store at 10000 keys to prevent leaks
 */

interface RateLimitConfig {
  /** Max requests per minute */
  maxPerMinute: number;
}

/** Default rate limit rules */
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  'GET:/api/memories': { maxPerMinute: 60 },
  'GET:/api/search': { maxPerMinute: 60 },
  'POST:/api/search': { maxPerMinute: 60 },
  'POST:/api/memories': { maxPerMinute: 20 },
  'PUT:/api/memories': { maxPerMinute: 20 },
  'DELETE:/api/memories': { maxPerMinute: 20 },
  'POST:/api/ingest': { maxPerMinute: 20 },
  'GET:/api/projects': { maxPerMinute: 30 },
  'GET:/api/personal-info': { maxPerMinute: 30 },
};

/** Default limit (applied when no rule matches) */
const DEFAULT_CONFIG: RateLimitConfig = { maxPerMinute: 30 };

/** Window size (ms) */
const WINDOW_MS = 60_000;

/** In-memory key cap (prevents leaks) */
const MAX_KEYS = 10_000;

/** IP+endpoint -> array of request timestamps */
const store = new Map<string, number[]>();

/** Last cleanup timestamp */
let lastCleanup = Date.now();

/**
 * Lazy cleanup: delete keys not accessed for over 2 minutes to bound memory.
 */
function lazyCleanup() {
  const now = Date.now();
  // Run at most every 60 seconds
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;

  const stale = now - 120_000; // not accessed within the last 2 minutes
  for (const [key, timestamps] of store) {
    // Timestamp of the most recent request
    const lastReq = timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0;
    if (lastReq < stale) {
      store.delete(key);
    }
  }
}

/**
 * Get the client IP.
 */
function getClientIP(request: FastifyRequest): string {
  const xff = request.headers['x-forwarded-for'] as string | undefined;
  if (xff) {
    return xff.split(',')[0].trim();
  }
  return request.ip || '127.0.0.1';
}

/**
 * Rate limit check.
 * @returns true = allowed, false = limit exceeded
 */
function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  let timestamps = store.get(key);
  if (!timestamps) {
    timestamps = [];
    store.set(key, timestamps);
  }

  // Drop records that fell outside the window
  const valid = timestamps.filter(t => t > windowStart);
  store.set(key, valid);

  if (valid.length >= maxPerMinute) {
    return false;
  }

  valid.push(now);
  return true;
}

/**
 * Get the Retry-After value in seconds.
 */
function getRetryAfter(key: string): number {
  const timestamps = store.get(key);
  if (!timestamps || timestamps.length === 0) return 60;
  const oldest = timestamps[0];
  return Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000);
}

/**
 * Register the rate limit middleware.
 */
export async function registerRateLimit(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Whitelisted paths are not rate limited
    const url = request.url.split('?')[0]; // strip the query string
    if (url === '/health' || url.startsWith('/health/')) {
      return;
    }

    // Admin endpoints are localhost-only and not rate limited
    if (url.startsWith('/api/admin/')) {
      return;
    }

    const method = request.method;
    const routeKey = `${method}:${url}`;

    // Match against the rate limit rules
    const config = DEFAULT_LIMITS[routeKey] || DEFAULT_CONFIG;

    const ip = getClientIP(request);
    const limitKey = `${ip}:${routeKey}`;

    // Lazy cleanup + store size protection
    lazyCleanup();
    if (store.size > MAX_KEYS) {
      // Over the cap: bulk-purge stale entries
      const entries = [...store.entries()];
      const now = Date.now();
      const cutoff = now - 30_000; // not accessed within the last 30 seconds
      for (const [k, timestamps] of entries) {
        const lastReq = timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0;
        if (lastReq < cutoff) {
          store.delete(k);
        }
      }
    }

    if (!checkRateLimit(limitKey, config.maxPerMinute)) {
      const retryAfter = getRetryAfter(limitKey);
      request.log?.warn({ ip, route: routeKey, retryAfter }, 'Rate limit exceeded');
      return reply
        .status(429)
        .header('Retry-After', String(retryAfter))
        .send({
          status: false,
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        });
    }
  });
}
