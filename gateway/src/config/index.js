/**
 * Centralised configuration with environment variable validation.
 * Fails fast on missing required vars in production.
 * Provides typed defaults for development.
 */

const path = require("path");

// Load .env from gateway root (two levels up from config/)
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

function required(key) {
  const val = process.env[key];
  if (!val && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val || "";
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

function optionalInt(key, fallback) {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: "${val}"`);
  }
  return parsed;
}

function optionalBool(key, fallback) {
  const val = process.env[key];
  if (!val) return fallback;
  return val === "true" || val === "1";
}

const config = Object.freeze({
  env: optional("NODE_ENV", "development"),
  isDev: optional("NODE_ENV", "development") === "development",
  isProd: optional("NODE_ENV", "development") === "production",

  server: Object.freeze({
    port: optionalInt("GATEWAY_PORT", 3001),
    frontendUrl: optional("FRONTEND_URL", "http://localhost:5173"),
    corsOrigins: optional("CORS_ORIGINS", "*"),
  }),

  database: Object.freeze({
    url: required("DATABASE_URL"),
    poolMax: optionalInt("DB_POOL_MAX", 20),
    poolIdleTimeout: optionalInt("DB_POOL_IDLE_TIMEOUT", 30000),
    connectionTimeout: optionalInt("DB_CONNECTION_TIMEOUT", 5000),
    ssl: optionalBool("DB_SSL", false),
  }),

  jira: Object.freeze({
    baseUrl: required("JIRA_BASE_URL"),
    email: required("JIRA_EMAIL"),
    apiToken: required("JIRA_API_TOKEN"),
    projectKey: optional("JIRA_PROJECT_KEY", "PROJ"),
    pollIntervalCron: optional("JIRA_POLL_CRON", "*/1 * * * *"),
    pollMaxResults: optionalInt("JIRA_POLL_MAX_RESULTS", 20),
    pollLookbackMinutes: optionalInt("JIRA_POLL_LOOKBACK_MINUTES", 2),
    requestTimeout: optionalInt("JIRA_REQUEST_TIMEOUT", 15000),
  }),

  aiEngine: Object.freeze({
    url: optional("AI_ENGINE_URL", "http://localhost:8000"),
    requestTimeout: optionalInt("AI_ENGINE_TIMEOUT", 10000),
  }),

  auth: Object.freeze({
    jwtSecret: required("JWT_SECRET"),
    jwtAccessExpiresIn: optional("JWT_ACCESS_EXPIRES", "15m"),
    jwtRefreshExpiresIn: optional("JWT_REFRESH_EXPIRES", "7d"),
    bcryptRounds: optionalInt("BCRYPT_ROUNDS", 12),
    maxLoginAttempts: optionalInt("MAX_LOGIN_ATTEMPTS", 5),
    lockoutDurationMs: optionalInt("LOCKOUT_DURATION_MS", 30 * 60 * 1000), // 30 min
  }),

  rateLimit: Object.freeze({
    windowMs: optionalInt("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000), // 15 min
    maxRequests: optionalInt("RATE_LIMIT_MAX", 100),
    authMaxRequests: optionalInt("RATE_LIMIT_AUTH_MAX", 10),
  }),

  dedup: Object.freeze({
    maxSize: optionalInt("DEDUP_MAX_SIZE", 10000),
    ttlMs: optionalInt("DEDUP_TTL_MS", 60 * 60 * 1000), // 1 hour
    cleanupIntervalMs: optionalInt("DEDUP_CLEANUP_INTERVAL_MS", 5 * 60 * 1000), // 5 min
  }),
});

module.exports = config;
