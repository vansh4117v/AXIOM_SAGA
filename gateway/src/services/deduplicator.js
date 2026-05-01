const { prisma } = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * LRU-bounded deduplicator with TTL.
 * Two-layer: in-memory LRU cache (fast) → Prisma DB check (authoritative).
 * Failed tickets reprocessable.
 */
class Deduplicator {
  constructor({ maxSize = 10000, ttlMs = 3600000, cleanupIntervalMs = 300000 } = {}) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this._cleanupInterval = setInterval(() => this._cleanup(), cleanupIntervalMs);
    this._cleanupInterval.unref();
  }

  async isDuplicate(ticketKey) {
    // Layer 1: cache
    const cached = this.cache.get(ticketKey);
    if (cached) {
      if (Date.now() - cached.addedAt < this.ttlMs) {
        if (cached.status === 'failed') {
          logger.debug(`Dedup: ${ticketKey} previously failed (cached), allowing reprocess`);
          return false;
        }
        logger.debug(`Dedup: ${ticketKey} found in cache (status: ${cached.status})`);
        return true;
      }
      this.cache.delete(ticketKey);
    }

    // Layer 2: DB via Prisma
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { ticketKey },
        select: { status: true },
      });

      if (ticket) {
        this._addToCache(ticketKey, ticket.status);
        if (ticket.status === 'failed') {
          logger.info(`Dedup: ${ticketKey} previously failed (DB), allowing reprocess`);
          return false;
        }
        logger.debug(`Dedup: ${ticketKey} found in DB (status: ${ticket.status})`);
        return true;
      }
    } catch (err) {
      logger.error(`Dedup DB check failed for ${ticketKey}: ${err.message}`);
    }

    return false;
  }

  markProcessed(ticketKey, status = 'processing') {
    this._addToCache(ticketKey, status);
  }

  updateStatus(ticketKey, status) {
    const entry = this.cache.get(ticketKey);
    if (entry) {
      entry.status = status;
    } else {
      this._addToCache(ticketKey, status);
    }
  }

  _addToCache(ticketKey, status) {
    if (this.cache.has(ticketKey)) this.cache.delete(ticketKey);
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(ticketKey, { status, addedAt: Date.now() });
  }

  _cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.addedAt >= this.ttlMs) {
        this.cache.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug(`Dedup cleanup: removed ${removed} expired, ${this.cache.size} remaining`);
    }
  }

  getStats() {
    return { cacheSize: this.cache.size, maxSize: this.maxSize, ttlMs: this.ttlMs };
  }

  destroy() {
    clearInterval(this._cleanupInterval);
    this.cache.clear();
  }
}

let instance = null;

function getInstance(opts) {
  if (!instance) instance = new Deduplicator(opts);
  return instance;
}

function destroyInstance() {
  if (instance) { instance.destroy(); instance = null; }
}

module.exports = { Deduplicator, getInstance, destroyInstance };
