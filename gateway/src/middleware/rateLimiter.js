const { RateLimitError } = require('../errors');
const jwt = require('jsonwebtoken');

/**
 * In-memory sliding window rate limiter.
 * Tracks timestamps per IP. Prunes expired entries automatically.
 */
class SlidingWindowRateLimiter {
  constructor({ windowMs = 900000, maxRequests = 100, cleanupIntervalMs = 60000 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.clients = new Map();
    this._cleanupInterval = setInterval(() => this._cleanup(), cleanupIntervalMs);
    this._cleanupInterval.unref();
  }

  middleware() {
    return (req, res, next) => {
      const key = getClientKey(req);
      const now = Date.now();
      const windowStart = now - this.windowMs;

      let ts = this.clients.get(key);
      if (!ts) { ts = []; this.clients.set(key, ts); }

      while (ts.length > 0 && ts[0] <= windowStart) ts.shift();

      if (ts.length >= this.maxRequests) {
        const retryMs = ts[0] - windowStart;
        res.setHeader('Retry-After', Math.ceil(retryMs / 1000));
        res.setHeader('X-RateLimit-Limit', this.maxRequests);
        res.setHeader('X-RateLimit-Remaining', 0);
        return next(new RateLimitError(retryMs));
      }

      ts.push(now);
      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', this.maxRequests - ts.length);
      next();
    };
  }

  _cleanup() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, ts] of this.clients) {
      while (ts.length > 0 && ts[0] <= cutoff) ts.shift();
      if (ts.length === 0) this.clients.delete(key);
    }
  }

  destroy() { clearInterval(this._cleanupInterval); this.clients.clear(); }
}

function createRateLimiter(opts) {
  const limiter = new SlidingWindowRateLimiter(opts);
  const mw = limiter.middleware();
  mw.destroy = () => limiter.destroy();
  return mw;
}

function getClientKey(req) {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null;
  const secret = process.env.JWT_SECRET;

  if (token && secret) {
    try {
      const decoded = jwt.verify(token, secret);
      if (decoded.tokenType !== 'refresh' && decoded.userId) {
        return `user:${decoded.userId}`;
      }
    } catch (_err) {
      // Fall back to IP based limiting; auth middleware will handle invalid tokens.
    }
  }

  return `ip:${req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'}`;
}

module.exports = { SlidingWindowRateLimiter, createRateLimiter };
