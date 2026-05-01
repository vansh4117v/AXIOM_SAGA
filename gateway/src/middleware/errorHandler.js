const logger = require('../utils/logger');
const { AppError } = require('../errors');

/**
 * Global error handler middleware.
 * Must be registered LAST (after all routes).
 * Handles AppError subclasses with structured JSON responses.
 * Catches unexpected errors and returns 500 without leaking internals.
 */
function errorHandler(err, req, res, _next) {
  // Already sent headers — delegate to Express default
  if (res.headersSent) {
    return _next(err);
  }

  // Operational errors (our AppError hierarchy)
  if (err instanceof AppError) {
    logger.warn(`[${req.id || '-'}] ${req.method} ${req.path} → ${err.statusCode} ${err.code}: ${err.message}`);

    return res.status(err.statusCode).json(err.toJSON());
  }

  // Express body-parser JSON syntax error
  if (err.type === 'entity.parse.failed') {
    logger.warn(`[${req.id || '-'}] Malformed JSON body`);
    return res.status(400).json({
      error: { code: 'MALFORMED_JSON', message: 'Request body contains invalid JSON' },
    });
  }

  // Express payload too large
  if (err.type === 'entity.too.large') {
    logger.warn(`[${req.id || '-'}] Payload too large`);
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds size limit' },
    });
  }

  // Unexpected / programmer errors — log full stack, return generic 500
  logger.error(`[${req.id || '-'}] Unhandled error: ${err.message}`, { stack: err.stack });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    },
  });
}

module.exports = errorHandler;
