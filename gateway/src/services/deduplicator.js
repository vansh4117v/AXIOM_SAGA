const db = require('../utils/db');
const logger = require('../utils/logger');

/**
 * LRU-bounded deduplicator with TTL.
 * Two-layer check: in-memory LRU cache (fast) → DB tickets table (authoritative).
 *
 * Unlike a plain Set, this:
 * - Bounds memory usage (configurable maxSize, default 10000)
 * - Expires stale entries after TTL (default 1 hour)
 * - Runs periodic cleanup
 * - Allows reprocessing of failed tickets
 */

class Deduplicator {
  /**
   * @param {object} opts
   * @param {number} opts.maxSize             — max entries in memory (default 10000)
   * @param {number} opts.ttlMs               — time-to-live per entry in ms (default 1 hour)
   * @param {number} opts.cleanupIntervalMs   — cleanup interval in ms (default 5 min)
   */
  constructor({ maxSize = 10000, ttlMs = 3600000, cleanupIntervalMs = 300000 } = {}) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    /** @type {Map<string, {status: string, addedAt: number}>} */
    this.cache = new Map();

    this._cleanupInterval = setInterval(() => this._cleanup(), cleanupIntervalMs);
    this._cleanupInterval.unref();
  }

  /**
   * Check if ticket already processed / in-progress.
   * Layer 1: in-memory cache. Layer 2: DB.
   * Failed tickets are allowed through for reprocessing.
   *
   * @param {string} ticketKey
   * @returns {Promise<boolean>} true if duplicate (should skip)
   */
  async isDuplicate(ticketKey) {
    // Layer 1: in-memory cache
    const cached = this.cache.get(ticketKey);
    if (cached) {
      const age = Date.now() - cached.addedAt;
      if (age < this.ttlMs) {
        if (cached.status === 'failed') {
          logger.debug(`Dedup: ${ticketKey} previously failed (cached), allowing reprocess`);
          return false;
        }
        logger.debug(`Dedup: ${ticketKey} found in cache (status: ${cached.status})`);
        return true;
      }
      // Expired — remove
      this.cache.delete(ticketKey);
    }

    // Layer 2: DB check
    try {
      const result = await db.query(
        'SELECT status FROM tickets WHERE ticket_key = $1',
        [ticketKey]
      );

      if (result.rows.length > 0) {
        const status = result.rows[0].status;
        // Warm cache
        this._addToCache(ticketKey, status);

        if (status === 'failed') {
          logger.info(`Dedup: ${ticketKey} previously failed (DB), allowing reprocess`);
          return false;
        }

        logger.debug(`Dedup: ${ticketKey} found in DB (status: ${status})`);
        return true;
      }
    } catch (err) {
      // Fail open — if DB down, only rely on cache
      logger.error(`Dedup DB check failed for ${ticketKey}: ${err.message}`);
    }

    return false;
  }

  /**
   * Mark ticket as processed in cache.
   * @param {string} ticketKey
   * @param {string} status — 'processing' | 'complete' | 'failed'
   */
  markProcessed(ticketKey, status = 'processing') {
    this._addToCache(ticketKey, status);
  }

  /**
   * Update status of a cached ticket.
   */
  updateStatus(ticketKey, status) {
    const entry = this.cache.get(ticketKey);
    if (entry) {
      entry.status = status;
    } else {
      this._addToCache(ticketKey, status);
    }
  }

  /**
   * Add entry to cache, evicting oldest if at capacity (LRU).
   */
  _addToCache(ticketKey, status) {
    // If key exists, delete first so it moves to end (most recent)
    if (this.cache.has(ticketKey)) {
      this.cache.delete(ticketKey);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      logger.debug(`Dedup: evicted oldest entry ${oldestKey} (cache full)`);
    }

    this.cache.set(ticketKey, { status, addedAt: Date.now() });
  }

  /**
   * Remove expired entries from cache.
   */
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
      logger.debug(`Dedup cleanup: removed ${removed} expired entries, ${this.cache.size} remaining`);
    }
  }

  /**
   * Get cache stats.
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }

  /**
   * Destroy the deduplicator (clear interval + cache).
   */
  destroy() {
    clearInterval(this._cleanupInterval);
    this.cache.clear();
  }
}

// Singleton instance — created with defaults, reconfigurable via init()
let instance = null;

function getInstance(opts) {
  if (!instance) {
    instance = new Deduplicator(opts);
  }
  return instance;
}

function destroyInstance() {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

module.exports = { Deduplicator, getInstance, destroyInstance };
