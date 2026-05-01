const cron = require('node-cron');
const axios = require('axios');
const { normaliseToTicketDTO } = require('./jiraNormaliser');
const { getInstance: getDeduplicator } = require('./deduplicator');
const db = require('../utils/db');
const logger = require('../utils/logger');

/**
 * Simple circuit breaker for Jira API calls.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing).
 */
class CircuitBreaker {
  constructor({ failureThreshold = 5, resetTimeoutMs = 60000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.state = 'CLOSED';       // CLOSED | OPEN | HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
  }

  canExecute() {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker → HALF_OPEN (testing)');
        return true;
      }
      return false;
    }

    // HALF_OPEN — allow one request
    return true;
  }

  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      logger.info('Circuit breaker → CLOSED (recovered)');
    }
    this.failureCount = 0;
    this.successCount++;
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.warn('Circuit breaker → OPEN (still failing)');
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.warn(`Circuit breaker → OPEN after ${this.failureCount} consecutive failures`);
    }
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
    };
  }
}

const circuitBreaker = new CircuitBreaker();
let consecutiveErrors = 0;
let isPolling = false;
let pollCount = 0;
let lastPollTime = null;
let cronJob = null;

function getConfig() {
  return {
    baseUrl:        process.env.JIRA_BASE_URL,
    email:          process.env.JIRA_EMAIL,
    apiToken:       process.env.JIRA_API_TOKEN,
    projectKey:     process.env.JIRA_PROJECT_KEY || 'PROJ',
    aiEngineUrl:    process.env.AI_ENGINE_URL || 'http://localhost:8000',
    pollMaxResults: parseInt(process.env.JIRA_POLL_MAX_RESULTS || '20', 10),
    lookbackMin:    parseInt(process.env.JIRA_POLL_LOOKBACK_MINUTES || '2', 10),
    requestTimeout: parseInt(process.env.JIRA_REQUEST_TIMEOUT || '15000', 10),
    aiTimeout:      parseInt(process.env.AI_ENGINE_TIMEOUT || '10000', 10),
  };
}

function getJiraAuth(config) {
  return {
    auth: { username: config.email, password: config.apiToken },
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    timeout: config.requestTimeout,
  };
}

/**
 * Exponential backoff delay based on consecutive error count.
 * Caps at 5 minutes.
 */
function getBackoffMs() {
  if (consecutiveErrors === 0) return 0;
  const delay = Math.min(1000 * Math.pow(2, consecutiveErrors - 1), 5 * 60 * 1000);
  return delay;
}

async function pollJira() {
  const config = getConfig();

  // Guard: missing credentials
  if (!config.baseUrl || !config.email || !config.apiToken) {
    logger.warn('Jira polling skipped — missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN');
    return { skipped: true, reason: 'missing_credentials' };
  }

  // Guard: circuit breaker open
  if (!circuitBreaker.canExecute()) {
    logger.warn(`Jira polling skipped — circuit breaker OPEN (${circuitBreaker.failureCount} failures)`);
    return { skipped: true, reason: 'circuit_breaker_open' };
  }

  // Guard: prevent overlapping polls
  if (isPolling) {
    logger.debug('Jira poll skipped — previous poll still running');
    return { skipped: true, reason: 'already_polling' };
  }

  // Backoff delay
  const backoffMs = getBackoffMs();
  if (backoffMs > 0) {
    logger.info(`Backoff: waiting ${Math.round(backoffMs / 1000)}s before polling`);
    await new Promise(resolve => setTimeout(resolve, backoffMs));
  }

  isPolling = true;
  const pollStart = Date.now();
  const dedup = getDeduplicator();

  try {
    const jql = `project = ${config.projectKey} AND updated >= -${config.lookbackMin}m ORDER BY updated DESC`;
    logger.info(`Polling Jira: ${jql}`);

    const response = await axios.get(`${config.baseUrl}/rest/api/3/search`, {
      params: {
        jql,
        maxResults: config.pollMaxResults,
        fields: 'summary,description,priority,assignee,reporter,labels,components,status,issuetype,created',
      },
      ...getJiraAuth(config),
    });

    const issues = response.data.issues || [];
    const total = response.data.total || 0;
    logger.info(`Jira poll returned ${issues.length} issue(s) (total matching: ${total})`);

    let forwarded = 0;
    let skipped = 0;
    let failed = 0;

    for (const issue of issues) {
      // Dedup check
      if (await dedup.isDuplicate(issue.key)) {
        skipped++;
        continue;
      }

      // Normalise
      let dto;
      try {
        dto = normaliseToTicketDTO(issue);
      } catch (normErr) {
        logger.error(`Normalisation failed for ${issue.key}: ${normErr.message}`);
        failed++;
        continue;
      }

      // Save to DB
      try {
        await db.query(
          `INSERT INTO tickets (ticket_key, jira_issue_id, raw_payload, ticket_dto, status)
           VALUES ($1, $2, $3, $4, 'processing')
           ON CONFLICT (ticket_key) DO UPDATE SET
             raw_payload = EXCLUDED.raw_payload,
             ticket_dto  = EXCLUDED.ticket_dto,
             status      = 'processing'`,
          [issue.key, issue.id, JSON.stringify(issue), JSON.stringify(dto)]
        );
      } catch (dbErr) {
        logger.error(`DB insert failed for ${issue.key}: ${dbErr.message}`);
        // Continue — still try to forward to AI engine
      }

      // Forward to AI engine
      try {
        const analyseRes = await axios.post(`${config.aiEngineUrl}/analyse`, dto, {
          timeout: config.aiTimeout,
          headers: { 'Content-Type': 'application/json' },
        });

        const runId = analyseRes.data?.run_id || 'unknown';
        logger.info(`Forwarded ${issue.key} → AI engine (run_id: ${runId})`);
        dedup.markProcessed(issue.key, 'processing');
        forwarded++;
      } catch (fwdErr) {
        const errMsg = fwdErr.response
          ? `AI engine ${fwdErr.response.status}: ${JSON.stringify(fwdErr.response.data)}`
          : fwdErr.message;
        logger.error(`Failed to forward ${issue.key}: ${errMsg}`);

        dedup.markProcessed(issue.key, 'failed');

        // Update DB status
        await db.query(
          'UPDATE tickets SET status = $1 WHERE ticket_key = $2',
          ['failed', issue.key]
        ).catch(() => {});

        failed++;
      }
    }

    // Update poll state in DB
    if (issues.length > 0) {
      await db.query(
        `INSERT INTO jira_poll_state (id, last_polled_at, last_ticket_key)
         VALUES (1, NOW(), $1)
         ON CONFLICT (id) DO UPDATE SET
           last_polled_at  = NOW(),
           last_ticket_key = EXCLUDED.last_ticket_key`,
        [issues[0].key]
      ).catch(() => {});
    }

    // Success — reset error tracking
    circuitBreaker.recordSuccess();
    consecutiveErrors = 0;
    pollCount++;
    lastPollTime = new Date();

    const duration = Date.now() - pollStart;
    logger.info(
      `Poll #${pollCount} complete (${duration}ms): ` +
      `${forwarded} forwarded, ${skipped} skipped, ${failed} failed`
    );

    return { forwarded, skipped, failed, duration, total };
  } catch (err) {
    consecutiveErrors++;
    circuitBreaker.recordFailure();

    const duration = Date.now() - pollStart;

    if (err.response) {
      logger.error(
        `Jira API error ${err.response.status} (${duration}ms): ` +
        `${JSON.stringify(err.response.data).substring(0, 200)}`
      );
    } else if (err.code === 'ECONNREFUSED') {
      logger.error(`Jira API unreachable (${duration}ms): connection refused`);
    } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      logger.error(`Jira API timeout (${duration}ms)`);
    } else {
      logger.error(`Jira poll error (${duration}ms): ${err.message}`);
    }

    return { error: err.message, duration, consecutiveErrors };
  } finally {
    isPolling = false;
  }
}

/**
 * Start Jira polling cron job.
 * @param {string} cronExpression — cron schedule (default: every 60 seconds)
 */
function startPolling(cronExpression = '*/1 * * * *') {
  if (cronJob) {
    logger.warn('Poller already running — stopping existing before restart');
    stopPolling();
  }

  logger.info(`Starting Jira poller (schedule: ${cronExpression})`);

  // Run once immediately
  pollJira().catch(err => logger.error(`Initial poll failed: ${err.message}`));

  // Schedule recurring
  cronJob = cron.schedule(cronExpression, () => {
    pollJira().catch(err => logger.error(`Scheduled poll failed: ${err.message}`));
  });
}

/**
 * Stop polling.
 */
function stopPolling() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('Jira poller stopped');
  }
}

/**
 * Get poller health status.
 */
function getStatus() {
  return {
    isPolling,
    pollCount,
    lastPollTime: lastPollTime ? lastPollTime.toISOString() : null,
    consecutiveErrors,
    backoffMs: getBackoffMs(),
    circuitBreaker: circuitBreaker.getStatus(),
    cronActive: !!cronJob,
  };
}

/**
 * Trigger a manual poll (for admin/debug endpoints).
 */
async function triggerManualPoll() {
  logger.info('Manual poll triggered');
  return pollJira();
}

module.exports = {
  pollJira,
  startPolling,
  stopPolling,
  getStatus,
  triggerManualPoll,
};
