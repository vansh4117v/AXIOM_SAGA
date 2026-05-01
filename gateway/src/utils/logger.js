const { createLogger, format, transports } = require('winston');

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

/**
 * Structured logger with request ID correlation.
 * - Development: colourised, human-readable.
 * - Production: JSON for log aggregation.
 */
const logger = createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: 'sage-gateway' },
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.errors({ stack: true })
  ),
  transports: [
    process.env.NODE_ENV === 'production'
      ? new transports.Console({
          format: format.combine(format.json()),
        })
      : new transports.Console({
          format: format.combine(
            format.colorize(),
            format.printf(({ timestamp, level, message, service, stack, ...meta }) => {
              const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
              return stack
                ? `${timestamp} [${level}] ${message}\n${stack}${metaStr}`
                : `${timestamp} [${level}] ${message}${metaStr}`;
            })
          ),
        }),
  ],
});

/**
 * Create a child logger with request context.
 * Usage: const log = logger.child({ requestId: req.id });
 */
logger.forRequest = (req) => {
  return logger.child({ requestId: req.id, method: req.method, path: req.path });
};

module.exports = logger;
