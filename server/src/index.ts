import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { registerMemoryRoutes } from './modules/memory/index.js';
import { registerSearchRoutes } from './modules/search/index.js';
import { registerIngestRoutes } from './modules/ingest/index.js';
import { registerPersonalRoutes } from './modules/personal/index.js';
import { registerProjectRoutes } from './modules/project/index.js';
import { registerRateLimit } from './modules/rate-limit/index.js';
import { registerBackupRoutes, startScheduledBackup } from './modules/backup/index.js';
import { checkEmbeddingHealth } from './modules/embedding/index.js';
import { getTable } from './db/lancedb.js';

/** True when this module is the process entry point (node dist/index.js). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return true; // e.g. node -e
  try {
    return fs.realpathSync(path.resolve(entry)) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/**
 * Build the Fastify app, run startup checks and begin listening.
 * Called by the CLI (`memorydock serve`) or directly when this file is the
 * process entry point.
 */
export async function startServer(): Promise<FastifyInstance> {
  // ---- Structured logging ----
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
  });

  // ---- Global error handling ----
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Fastify request body schema validation error
    if (error.validation) {
      return reply.status(400).send({
        status: false,
        message: `Validation error: ${error.message}`,
      });
    }

    // Any other unexpected exception: respond in the project's standard format
    request.log.error(error);
    return reply.status(error.statusCode || 500).send({
      status: false,
      message: error.message || 'Internal server error',
    });
  });

  // The React console is built into dist/admin. Keep it same-origin with the
  // loopback API so no browser token or CORS configuration is required.
  const adminRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin');
  const sendAdminFile = async (relative: string, reply: FastifyReply) => {
    const file = path.resolve(adminRoot, relative || 'index.html');
    if (!file.startsWith(`${path.resolve(adminRoot)}${path.sep}`) && file !== path.join(path.resolve(adminRoot), 'index.html')) throw new Error('Invalid admin asset path');
    const content = await fs.promises.readFile(file);
    if (file.endsWith('.html')) reply.type('text/html; charset=utf-8');
    else if (file.endsWith('.js')) reply.type('text/javascript; charset=utf-8');
    else if (file.endsWith('.css')) reply.type('text/css; charset=utf-8');
    return reply.send(content);
  };
  // The console is the first-class local entry point. Keep `/app` as a
  // backwards-compatible redirect for links created by earlier releases.
  app.get('/', async (_request, reply) => sendAdminFile('index.html', reply));
  app.get<{ Params: { '*': string } }>('/assets/*', async (request, reply) => sendAdminFile(`assets/${request.params['*']}`, reply));
  app.get('/app', async (_request, reply) => reply.redirect('/', 308));
  app.get('/app/', async (_request, reply) => reply.redirect('/', 308));
  app.get<{ Params: { '*': string } }>('/app/assets/*', async (request, reply) => reply.redirect(`/assets/${request.params['*']}`, 308));

  // ---- Health checks ----
  // Full health check
  app.get('/health', async () => {
    const embeddingStarted = Date.now();
    const embeddingOk = await checkEmbeddingHealth();
    const embeddingLatency = Date.now() - embeddingStarted;

    let dbEntryCount = 0;
    let dbConnected: boolean;
    try {
      const table = await getTable();
      await table.query().limit(1).toArray();
      dbConnected = true;
      // Attempt to gather entry stats (may be slow; only computed on demand)
      try {
        dbEntryCount = await table.countRows();
      } catch {
        // Stats failure must not affect the health check
      }
    } catch {
      dbConnected = false;
    }

    const mem = process.memoryUsage();
    const ver = (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
        return pkg.version || 'unknown';
      } catch { return 'unknown'; }
    })();

    return {
      status: dbConnected ? 'ok' : 'degraded',
      version: ver,
      uptime: Math.round(process.uptime()),
      db: dbConnected ? 'connected' : 'disconnected',
      db_entry_count: dbEntryCount,
      embedding_api: embeddingOk ? 'ok' : 'degraded',
      embedding_latency_ms: embeddingLatency,
      memory_mb: {
        heap_used: Math.round(mem.heapUsed / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
      },
    };
  });

  // Readiness check (all dependencies ready)
  app.get('/health/readiness', async () => {
    const embeddingOk = await checkEmbeddingHealth();
    try {
      await getTable();
    } catch {
      return { status: 'not ready', embedding_api: embeddingOk, db: false };
    }
    return { status: 'ready', embedding_api: embeddingOk, db: true };
  });

  // Liveness check (minimal: only confirms the process is alive)
  app.get('/health/liveness', async () => {
    return { status: 'alive' };
  });

  // Register modules
  await registerRateLimit(app);        // rate limit registers first (onRequest hooks run in registration order)
  await registerMemoryRoutes(app);
  await registerSearchRoutes(app);
  await registerIngestRoutes(app);
  await registerPersonalRoutes(app);
  await registerProjectRoutes(app);
  await registerBackupRoutes(app);

  // ---- Scheduled backup ----
  startScheduledBackup(app);

  // ---- Graceful shutdown ----
  async function shutdown(signal: string) {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      app.log.info('Server closed');
      process.exit(0);
    } catch (err) {
      app.log.error('Error during shutdown: %s', (err as Error).message);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ---- Startup checks ----
  const skipChecks = process.env.SKIP_STARTUP_CHECKS === 'true';

  if (!skipChecks) {
    let checkErrors = 0;

    // 1. Required configuration checks
    if (!config.embedding.baseUrl) {
      app.log.warn('EMBEDDING_BASE_URL is not configured — embedding and search will fail until it is set');
    } else if (!config.embedding.apiKey) {
      app.log.info('EMBEDDING_API_KEY is not set; the endpoint must permit unauthenticated requests');
    }
    if (!config.llm.apiKey) {
      app.log.warn('LLM_API_KEY is not set — project import summaries will fall back to README snippets');
    }

    // 2. LanceDB directory is writable
    const lancedbPath = config.lancedb.path;
    try {
      if (!fs.existsSync(lancedbPath)) {
        fs.mkdirSync(lancedbPath, { recursive: true });
      }
      fs.accessSync(lancedbPath, fs.constants.W_OK);
      app.log.info({ path: lancedbPath }, 'LanceDB storage OK');
    } catch {
      app.log.error({ path: lancedbPath }, 'LanceDB path not writable');
      checkErrors++;
    }

    // 3. Embedding API connectivity.
    //    Unconfigured = warn and start in degraded mode; configured but
    //    unreachable = hard fail (fail-fast on misconfiguration).
    if (!config.embedding.baseUrl) {
      app.log.warn('Embedding not configured — skipping connectivity check');
    } else {
      try {
        const ok = await checkEmbeddingHealth();
        if (ok) {
          app.log.info('Embedding API reachable');
        } else {
          app.log.warn('Embedding API health check failed');
        }
      } catch (err) {
        app.log.error({ err: (err as Error).message }, 'Embedding API unreachable');
        checkErrors++;
      }
    }

    // 4. LanceDB tables are readable/writable
    try {
      const table = await getTable();
      await table.query().limit(1).toArray();
      app.log.info('LanceDB table readable');
    } catch (err) {
      app.log.error({ err: (err as Error).message }, 'LanceDB table not readable');
      checkErrors++;
    }

    if (checkErrors > 0) {
      app.log.error({ errors: checkErrors }, 'Startup checks failed, exiting');
      process.exit(1);
    }
  } else {
    app.log.warn('Skipping startup checks (SKIP_STARTUP_CHECKS=true)');
  }

  // Start
  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ host: config.host, port: config.port }, 'Server started');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  return app;
}

// Auto-start when run directly (node dist/index.js or npx tsx src/index.ts).
if (isMainModule()) {
  startServer().catch(err => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}
