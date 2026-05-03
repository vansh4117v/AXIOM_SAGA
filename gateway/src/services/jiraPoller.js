const cron = require("node-cron");
const axios = require("axios");
const { normaliseToTicketDTO } = require("./jiraNormaliser");
const { getInstance: getDeduplicator } = require("./deduplicator");
const { prisma } = require("../utils/prisma");
const logger = require("../utils/logger");

class CircuitBreaker {
  constructor({ failureThreshold = 5, resetTimeoutMs = 60000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
  }

  canExecute() {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
        logger.info("Circuit breaker → HALF_OPEN (testing)");
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess() {
    if (this.state === "HALF_OPEN") {
      this.state = "CLOSED";
      logger.info("Circuit breaker → CLOSED (recovered)");
    }
    this.failureCount = 0;
    this.successCount++;
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      logger.warn("Circuit breaker → OPEN (still failing)");
      return;
    }
    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
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
    baseUrl: process.env.JIRA_BASE_URL,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    projectKey: process.env.JIRA_PROJECT_KEY || "PROJ",
    aiEngineUrl: process.env.AI_ENGINE_URL || "http://localhost:8000",
    pollMaxResults: parseInt(process.env.JIRA_POLL_MAX_RESULTS || "20", 10),
    lookbackMin: parseInt(process.env.JIRA_POLL_LOOKBACK_MINUTES || "2", 10),
    requestTimeout: parseInt(process.env.JIRA_REQUEST_TIMEOUT || "15000", 10),
    aiTimeout: parseInt(process.env.AI_ENGINE_TIMEOUT || "10000", 10),
  };
}

function getJiraAuth(config) {
  return {
    auth: { username: config.email, password: config.apiToken },
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    timeout: config.requestTimeout,
  };
}

function getBackoffMs() {
  if (consecutiveErrors === 0) return 0;
  return Math.min(1000 * Math.pow(2, consecutiveErrors - 1), 5 * 60 * 1000);
}

async function pollJira() {
  const config = getConfig();

  if (!config.baseUrl || !config.email || !config.apiToken) {
    logger.warn("Jira polling skipped — missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN");
    return { skipped: true, reason: "missing_credentials" };
  }

  if (!circuitBreaker.canExecute()) {
    logger.warn(`Jira polling skipped — circuit breaker OPEN`);
    return { skipped: true, reason: "circuit_breaker_open" };
  }

  if (isPolling) {
    logger.debug("Jira poll skipped — previous poll still running");
    return { skipped: true, reason: "already_polling" };
  }

  const backoffMs = getBackoffMs();
  if (backoffMs > 0) {
    logger.info(`Backoff: waiting ${Math.round(backoffMs / 1000)}s before polling`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  isPolling = true;
  const pollStart = Date.now();
  const dedup = getDeduplicator();

  try {
    const jql = `project = ${config.projectKey} AND updated >= -${config.lookbackMin}m ORDER BY updated DESC`;
    logger.info(`Polling Jira: ${jql}`);

    const response = await axios.get(`${config.baseUrl}/rest/api/3/search/jql`, {
      params: {
        jql,
        maxResults: config.pollMaxResults,
        fields:
          "summary,description,priority,assignee,reporter,labels,components,status,issuetype,created",
      },
      ...getJiraAuth(config),
    });

    const issues = response.data.issues || [];
    logger.info(`Jira poll returned ${issues.length} issue(s)`);

    let forwarded = 0,
      skipped = 0,
      failed = 0;

    for (const issue of issues) {
      if (await dedup.isDuplicate(issue.key)) {
        skipped++;
        continue;
      }

      let dto;
      try {
        dto = normaliseToTicketDTO(issue);
      } catch (normErr) {
        logger.error(`Normalisation failed for ${issue.key}: ${normErr.message}`);
        failed++;
        continue;
      }

      // Upsert via Prisma
      try {
        await prisma.ticket.upsert({
          where: { ticketKey: issue.key },
          create: {
            ticketKey: issue.key,
            jiraIssueId: issue.id,
            rawPayload: issue,
            ticketDto: dto,
            status: "processing",
          },
          update: {
            rawPayload: issue,
            ticketDto: dto,
            status: "processing",
          },
        });
      } catch (dbErr) {
        logger.error(`DB upsert failed for ${issue.key}: ${dbErr.message}`);
      }

      // Forward to AI engine
      try {
        const analyseRes = await axios.post(`${config.aiEngineUrl}/analyse`, dto, {
          timeout: config.aiTimeout,
          headers: { "Content-Type": "application/json" },
        });
        logger.info(`Forwarded ${issue.key} → AI engine (run_id: ${analyseRes.data?.run_id})`);
        dedup.markProcessed(issue.key, "processing");
        forwarded++;
      } catch (fwdErr) {
        const errMsg = fwdErr.response
          ? `AI engine ${fwdErr.response.status}: ${JSON.stringify(fwdErr.response.data)}`
          : fwdErr.message;
        logger.error(`Failed to forward ${issue.key}: ${errMsg}`);
        dedup.markProcessed(issue.key, "failed");
        await prisma.ticket
          .update({
            where: { ticketKey: issue.key },
            data: { status: "failed" },
          })
          .catch(() => {});
        failed++;
      }
    }

    // Update poll state
    if (issues.length > 0) {
      await prisma.jiraPollState
        .upsert({
          where: { id: 1 },
          create: { id: 1, lastPolledAt: new Date(), lastTicketKey: issues[0].key },
          update: { lastPolledAt: new Date(), lastTicketKey: issues[0].key },
        })
        .catch(() => {});
    }

    circuitBreaker.recordSuccess();
    consecutiveErrors = 0;
    pollCount++;
    lastPollTime = new Date();

    const duration = Date.now() - pollStart;
    logger.info(
      `Poll #${pollCount} complete (${duration}ms): ${forwarded} forwarded, ${skipped} skipped, ${failed} failed`,
    );

    return { forwarded, skipped, failed, duration };
  } catch (err) {
    consecutiveErrors++;
    circuitBreaker.recordFailure();
    const duration = Date.now() - pollStart;

    if (err.response) {
      logger.error(
        `Jira API error ${err.response.status} (${duration}ms): ${JSON.stringify(err.response.data).substring(0, 200)}`,
      );
    } else if (err.code === "ECONNREFUSED") {
      logger.error(`Jira API unreachable (${duration}ms)`);
    } else {
      logger.error(`Jira poll error (${duration}ms): ${err.message}`);
    }

    return { error: err.message, duration, consecutiveErrors };
  } finally {
    isPolling = false;
  }
}

function startPolling(cronExpression = "*/1 * * * *") {
  if (cronJob) {
    stopPolling();
  }
  logger.info(`Starting Jira poller (schedule: ${cronExpression})`);
  pollJira().catch((err) => logger.error(`Initial poll failed: ${err.message}`));
  cronJob = cron.schedule(cronExpression, () => {
    pollJira().catch((err) => logger.error(`Scheduled poll failed: ${err.message}`));
  });
}

function stopPolling() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info("Jira poller stopped");
  }
}

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

async function triggerManualPoll() {
  logger.info("Manual poll triggered");
  return pollJira();
}

module.exports = { pollJira, startPolling, stopPolling, getStatus, triggerManualPoll };
