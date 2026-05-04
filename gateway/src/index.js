require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const passport = require('passport');
const logger = require('./utils/logger');
const { prisma, healthCheck: dbHealthCheck, disconnect: dbDisconnect } = require('./utils/prisma');
const requestId = require('./middleware/requestId');
const { createRateLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const { authenticate, authorize } = require('./middleware/auth');
const { configurePassport } = require('./middleware/passport');
const { startPolling, stopPolling, getStatus: getPollerStatus, triggerManualPoll } = require('./services/jiraPoller');
const { getInstance: getDeduplicator, destroyInstance: destroyDeduplicator } = require('./services/deduplicator');
const { writeCommentToJira } = require('./services/jiraWriter');

// Routes
const authRoutes   = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const promptRoutes = require('./routes/prompts');

const app = express();
const PORT = process.env.GATEWAY_PORT || process.env.PORT || 8080;


app.use(helmet({
  contentSecurityPolicy: false,
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


app.use(passport.initialize());
configurePassport();


app.use(requestId);


app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level](`[${req.id}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});


const globalRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10),
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
});
app.use(globalRateLimiter);


app.get('/health', async (_req, res) => {
  const dbHealth = await dbHealthCheck();
  const pollerStatus = getPollerStatus();
  const dedupStats = getDeduplicator().getStats();

  res.status(dbHealth.connected ? 200 : 503).json({
    status: dbHealth.connected ? 'ok' : 'degraded',
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
  } catch (err) { next(err); }
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
    const {
      ticket_key,
      briefing,
      run_id,
      trace_url,
      status = 'complete',
      agent_trace = [],
      scratchpad = {},
      execution_plan,
      overall_confidence,
      skip_jira_write = false,
    } = req.body;

    if (!ticket_key) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'ticket_key required' },
      });
    }

    const dashboardUrl = trace_url
      || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/briefing/${run_id}`;

    if (briefing && run_id) {
      const existingBriefing = await prisma.briefing.findFirst({ where: { runId: run_id } });
      const briefingData = {
        ticketKey: ticket_key,
        scratchpad,
        briefing,
        agentTrace: agent_trace,
        overallConfidence: overall_confidence ?? briefing.overall_confidence ?? null,
        executionPlan: execution_plan || briefing.execution_plan || [],
      };

      if (existingBriefing) {
        await prisma.briefing.update({
          where: { id: existingBriefing.id },
          data: briefingData,
        });
      } else {
        await prisma.briefing.create({
          data: {
            runId: run_id,
            ...briefingData,
          },
        });
      }
    }

    if (briefing && !skip_jira_write) {
      try {
        await writeCommentToJira(ticket_key, briefing, dashboardUrl);
      } catch (writeErr) {
        logger.error(`Jira write-back failed for ${ticket_key}: ${writeErr.message}`);
      }
    }

    await prisma.ticket.update({
      where: { ticketKey: ticket_key },
      data: {
        status: ['complete', 'failed', 'timeout'].includes(status) ? status : 'complete',
        processedAt: new Date(),
      },
    }).catch(() => {});

    getDeduplicator().updateStatus(ticket_key, status);

    logger.info(`Briefing callback: ${ticket_key} ${status}`);
    return res.json({ status: 'ok', ticket_key });
  } catch (err) { next(err); }
});


app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});


app.use(errorHandler);


async function start() {
  try {
    // Test DB connection
    const dbCheck = await dbHealthCheck();
    if (dbCheck.connected) {
      logger.info(`Database connected (${dbCheck.latencyMs}ms)`);
    } else {
      logger.warn(`Database not available: ${dbCheck.reason}`);
    }

    // Init deduplicator
    getDeduplicator({
      maxSize: parseInt(process.env.DEDUP_MAX_SIZE || '10000', 10),
      ttlMs: parseInt(process.env.DEDUP_TTL_MS || String(60 * 60 * 1000), 10),
    });

    // Start Express
    const server = app.listen(PORT, () => {
      logger.info(`SAGE Gateway running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      startPolling(process.env.JIRA_POLL_CRON || '*/1 * * * *');
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully`);
      stopPolling();
      destroyDeduplicator();
      globalRateLimiter.destroy();

      server.close(async () => {
        await dbDisconnect();
        logger.info('Gateway shut down complete');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('unhandledRejection', (reason) => logger.error(`Unhandled rejection: ${reason}`));
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
