const { Pool } = require('pg');
const logger = require('./logger');

let pool = null;

/**
 * Initialise connection pool. Called once at startup.
 * Returns null if DATABASE_URL not set (dev mode — queries return empty results).
 */
function initPool(databaseUrl, opts = {}) {
  if (!databaseUrl) {
    logger.warn('DATABASE_URL not set — DB operations will return empty results');
    return null;
  }

  pool = new Pool({
    connectionString: databaseUrl,
    max: opts.poolMax || 20,
    idleTimeoutMillis: opts.idleTimeout || 30000,
    connectionTimeoutMillis: opts.connectionTimeout || 5000,
    ssl: databaseUrl.includes('azure') || opts.ssl
      ? { rejectUnauthorized: false }
      : undefined,
  });

  pool.on('error', (err) => {
    logger.error(`Unexpected pool error: ${err.message}`);
  });

  logger.info('Database connection pool initialised');
  return pool;
}

function getPool() {
  return pool;
}

const EMPTY_RESULT = Object.freeze({ rows: [], rowCount: 0 });

/**
 * Execute a parameterised query.
 * @param {string} text     — SQL with $1, $2 placeholders
 * @param {Array}  params   — parameter values
 * @returns {Promise<{rows: Array, rowCount: number}>}
 */
async function query(text, params = []) {
  if (!pool) return EMPTY_RESULT;

  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 200) {
      logger.warn(`Slow query (${duration}ms): ${text.substring(0, 120)}`);
    }
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error(`Query failed (${duration}ms): ${text.substring(0, 120)} — ${err.message}`);
    throw err;
  }
}

/**
 * Execute a function within a database transaction.
 * Automatically commits on success, rolls back on error.
 *
 * @param {Function} fn — async function receiving a client with .query()
 * @returns {Promise<*>} — return value of fn
 *
 * Usage:
 *   const user = await db.transaction(async (client) => {
 *     const res = await client.query('INSERT INTO users ... RETURNING *', [...]);
 *     await client.query('INSERT INTO audit_log ...', [...]);
 *     return res.rows[0];
 *   });
 */
async function transaction(fn) {
  if (!pool) {
    throw new Error('Database not initialised — cannot run transaction');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const fs = require('fs');
const path = require('path');

/**
 * Run all .sql migration files from a directory, in filename order.
 * Tracks executed migrations in a `gateway_migrations` table.
 * Idempotent — skips already-executed migrations.
 *
 * @param {string} migrationsDir — absolute path to migrations directory
 */
async function runMigrations(migrationsDir) {
  if (!pool) {
    logger.warn('Skipping migrations — no database connection');
    return;
  }

  // Ensure migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gateway_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get already-executed migrations
  const executed = await pool.query('SELECT filename FROM gateway_migrations ORDER BY filename');
  const executedSet = new Set(executed.rows.map(r => r.filename));

  // Read migration files
  if (!fs.existsSync(migrationsDir)) {
    logger.info('No migrations directory found — skipping');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (executedSet.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO gateway_migrations (filename) VALUES ($1)',
        [file]
      );
      await client.query('COMMIT');
      logger.info(`Migration executed: ${file}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Migration failed: ${file} — ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  if (ran > 0) {
    logger.info(`${ran} migration(s) executed`);
  } else {
    logger.info('All migrations up to date');
  }
}

/**
 * Check database connectivity. Returns { connected, latencyMs }.
 */
async function healthCheck() {
  if (!pool) return { connected: false, latencyMs: null, reason: 'Pool not initialised' };

  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { connected: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { connected: false, latencyMs: Date.now() - start, reason: err.message };
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

module.exports = {
  initPool,
  getPool,
  query,
  transaction,
  runMigrations,
  healthCheck,
  close,
};
