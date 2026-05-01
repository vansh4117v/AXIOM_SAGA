const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

/**
 * Singleton PrismaClient instance.
 * - Logs warnings and errors in all environments.
 * - Logs queries in development.
 * - Graceful disconnect on process exit.
 */

const logLevels = process.env.NODE_ENV === 'production'
  ? [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }]
  : [{ level: 'query', emit: 'event' }, { level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }];

const prisma = new PrismaClient({
  log: logLevels,
});


if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query', (e) => {
    if (e.duration > 200) {
      logger.warn(`Slow query (${e.duration}ms): ${e.query.substring(0, 150)}`);
    } else {
      logger.debug(`Query (${e.duration}ms): ${e.query.substring(0, 100)}`);
    }
  });
}

prisma.$on('warn', (e) => {
  logger.warn(`Prisma warning: ${e.message}`);
});

prisma.$on('error', (e) => {
  logger.error(`Prisma error: ${e.message}`);
});


async function healthCheck() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { connected: false, latencyMs: Date.now() - start, reason: err.message };
  }
}


async function disconnect() {
  await prisma.$disconnect();
  logger.info('Prisma client disconnected');
}

module.exports = { prisma, healthCheck, disconnect };
