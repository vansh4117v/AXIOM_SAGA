require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const logger = require('./utils/logger');
const db = require('./utils/db');
const requestId = require('./middleware/requestId');
const { createRateLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const { authenticate, authorize } = require('./middleware/auth');
const { startPolling, stopPolling, getStatus: getPollerStatus, triggerManualPoll } = require('./services/jiraPoller');
const { getInstance: getDeduplicator, destroyInstance: destroyDeduplicator } = require('./services/deduplicator');
const { writeCommentToJira } = require('./services/jiraWriter');

// Routes
const authRoutes   = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const promptRoutes = require('./routes/prompts');

const app = express();
const PORT = process.env.GATEWAY_PORT || 3001;

app.use(helmet({
  contentSecurityPolicy: false, // Allow dashboard to load resources
  crossOriginEmbedderPolicy: false,
}));

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: corsOrigins.includes('*') ? '*' : corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use(requestId);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level](
      `[${req.id}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

const globalRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10),
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
});
app.use(globalRateLimiter);

app.get('/health', async (_req, res) => {
  const dbHealth = await db.healthCheck();
  const pollerStatus = getPollerStatus();
  const dedupStats = getDeduplicator().getStats();

  const healthy = dbHealth.connected;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'sage-gateway',
    version: require('../package.json').version,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: {
      database: dbHealth,
      jiraPoller: {
        active: pollerStatus.cronActive,
        pollCount: pollerStatus.pollCount,
        lastPollTime: pollerStatus.lastPollTime,
        circuitBreaker: pollerStatus.circuitBreaker.state,
        consecutiveErrors: pollerStatus.consecutiveErrors,
      },
      deduplicator: dedupStats,
    },
  });
});

app.use('/auth', authRoutes);

app.use('/tickets', authenticate, ticketRoutes);
app.use('/prompts', authenticate, promptRoutes);

app.get('/admin/poller/status', authenticate, authorize('admin'), (_req, res) => {
  res.json(getPollerStatus());
});

app.post('/admin/poller/trigger', authenticate, authorize('admin'), async (_req, res, next) => {
  try {
    const result = await triggerManualPoll();
    res.json({ message: 'Manual poll triggered', result });
  } catch (err) {
    next(err);
  }
});

app.post('/admin/poller/stop', authenticate, authorize('admin'), (_req, res) => {
  stopPolling();
  res.json({ message: 'Poller stopped' });
});

app.post('/admin/poller/start', authenticate, authorize('admin'), (_req, res) => {
  startPolling(process.env.JIRA_POLL_CRON || '*/1 * * * *');
  res.json({ message: 'Poller started' });
});

app.post('/callback/briefing', express.json(), async (req, res, next) => {
  try {
    const { ticket_key, briefing, run_id, trace_url } = req.body;

    if (!ticket_key || !briefing) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'ticket_key and briefing required' },
      });
    }

    // Write comment to Jira
    const dashboardUrl = trace_url
      || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/briefing/${run_id}`;

    try {
      await writeCommentToJira(ticket_key, briefing, dashboardUrl);
    } catch (writeErr) {
      logger.error(`Jira write-back failed for ${ticket_key}: ${writeErr.message}`);
      // Don't fail the callback — still update ticket status
    }

    // Update ticket status
    await db.query(
      "UPDATE tickets SET status = 'complete', processed_at = NOW() WHERE ticket_key = $1",
      [ticket_key]
    );

    // Update dedup cache
    getDeduplicator().updateStatus(ticket_key, 'complete');

    logger.info(`Briefing callback: ${ticket_key} complete`);
    return res.json({ status: 'ok', ticket_key });
  } catch (err) {
    next(err);
  }
});

app.use((_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
});

app.use(errorHandler);

async function start() {
  try {
    // Initialise database pool
    db.initPool(process.env.DATABASE_URL, {
      poolMax: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
      connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '5000', 10),
      ssl: process.env.DB_SSL === 'true',
    });

    // Run migrations
    const migrationsDir = path.resolve(__dirname, 'db/migrations');
    await db.runMigrations(migrationsDir);

    // Initialise deduplicator
    getDeduplicator({
      maxSize: parseInt(process.env.DEDUP_MAX_SIZE || '10000', 10),
      ttlMs: parseInt(process.env.DEDUP_TTL_MS || String(60 * 60 * 1000), 10),
    });

    // Start Express
    const server = app.listen(PORT, () => {
      logger.info(`SAGE Gateway running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

      // Start Jira polling
      startPolling(process.env.JIRA_POLL_CRON || '*/1 * * * *');
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully`);

      stopPolling();
      destroyDeduplicator();
      globalRateLimiter.destroy();

      server.close(async () => {
        await db.close();
        logger.info('Gateway shut down complete');
        process.exit(0);
      });

      // Force exit after 10s
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Catch unhandled rejections
    process.on('unhandledRejection', (reason) => {
      logger.error(`Unhandled rejection: ${reason}`);
    });

    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
      process.exit(1);
    });

  } catch (err) {
    logger.error(`Failed to start gateway: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

start();

module.exports = app;
