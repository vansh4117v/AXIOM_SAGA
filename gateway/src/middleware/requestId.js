const { v4: uuidv4 } = require('uuid');

/**
 * Attach a unique request ID to every incoming request.
 * - Reads X-Request-ID from upstream (e.g. load balancer) if present.
 * - Otherwise generates a UUIDv4.
 * - Sets response header X-Request-ID for client-side correlation.
 * - Available as req.id throughout the request lifecycle.
 */
function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || uuidv4();
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}

module.exports = requestId;
