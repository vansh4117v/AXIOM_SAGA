const axios = require("axios");
const logger = require("../utils/logger");

/**
 * Retry an async function with exponential backoff.
 * @param {Function} fn           — async function to retry
 * @param {object}   opts
 * @param {number}   opts.maxRetries    — max retry attempts (default 3)
 * @param {number}   opts.baseDelayMs   — initial delay in ms (default 1000)
 * @param {number}   opts.maxDelayMs    — cap on delay (default 10000)
 * @param {Function} opts.shouldRetry   — predicate: (error) => boolean
 * @returns {Promise<*>}
 */
async function withRetry(
  fn,
  { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 10000, shouldRetry = () => true } = {},
) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !shouldRetry(err)) {
        throw err;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = Math.floor(Math.random() * delay * 0.2); // ±20% jitter
      logger.warn(
        `Jira write-back retry ${attempt + 1}/${maxRetries}: ` +
          `waiting ${delay + jitter}ms — ${err.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }

  throw lastError;
}

/**
 * Determine if an Axios error is retryable.
 * Retries on: 429 (rate limit), 500+ (server errors), network errors.
 * Does NOT retry on: 400, 401, 403, 404 (client errors).
 */
function isRetryableError(err) {
  if (!err.response) return true; // Network error, timeout
  const status = err.response.status;
  return status === 429 || status >= 500;
}

/**
 * Build ADF (Atlassian Document Format) comment body from briefing.
 * Follows exact structure from spec Section 9.
 *
 * @param {object} briefing     — assembled briefing from synthesis
 * @param {string} traceUrl     — link to full briefing in SAGE dashboard
 * @returns {object}            — ADF document
 */
function buildADFComment(briefing, traceUrl) {
  const confidencePercent = Math.round((briefing.overall_confidence || 0) * 100);

  const content = [
    {
      type: "heading",
      attrs: { level: 3 },
      content: [
        {
          type: "text",
          text: `🤖 SAGE Analysis — confidence ${confidencePercent}%`,
        },
      ],
    },

    {
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "strong" }], text: "Context: " },
        { type: "text", text: briefing.context_summary || "No context available" },
      ],
    },

    {
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "strong" }], text: "Owner: " },
        {
          type: "text",
          text: briefing.primary_owner
            ? `${briefing.primary_owner.name} (${briefing.primary_owner.team})`
            : "Unassigned",
        },
      ],
    },
  ];

  if (briefing.steps_summary) {
    content.push({
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "strong" }], text: "Suggested approach: " },
        { type: "text", text: briefing.steps_summary },
      ],
    });
  }

  if (briefing.risk_summary) {
    content.push({
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "strong" }], text: "Risk: " },
        {
          type: "text",
          text: briefing.risk_summary,
          ...(briefing.overall_risk_level === "critical" || briefing.overall_risk_level === "high"
            ? { marks: [{ type: "strong" }, { type: "textColor", attrs: { color: "#de350b" } }] }
            : {}),
        },
      ],
    });
  }

  const askMessage = briefing.suggested_question || briefing.ask_senior_message || "";
  if (askMessage) {
    content.push({
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "strong" }], text: "Ask senior: " },
            { type: "hardBreak" },
            { type: "text", text: askMessage },
          ],
        },
      ],
    });
  }

  if (traceUrl) {
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: traceUrl } }],
          text: "→ View full briefing in SAGE",
        },
      ],
    });
  }

  return {
    body: {
      type: "doc",
      version: 1,
      content,
    },
  };
}

/**
 * Write structured SAGE briefing as ADF comment on Jira ticket.
 * Retries on transient failures with exponential backoff.
 *
 * @param {string} ticketKey  — e.g. "PROJ-001"
 * @param {object} briefing   — assembled briefing from synthesis
 * @param {string} traceUrl   — link to full briefing in SAGE dashboard
 * @returns {object|null}     — Jira API response data, or null if skipped
 */
async function writeCommentToJira(ticketKey, briefing, traceUrl) {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl || !email || !apiToken) {
    logger.warn(`Jira write-back skipped for ${ticketKey} — missing credentials`);
    return null;
  }

  if (!briefing || typeof briefing !== "object") {
    logger.error(`Jira write-back skipped for ${ticketKey} — invalid briefing object`);
    return null;
  }

  const adfBody = buildADFComment(briefing, traceUrl);
  const url = `${baseUrl}/rest/api/3/issue/${ticketKey}/comment`;

  const start = Date.now();

  const result = await withRetry(
    async () => {
      const response = await axios.post(url, adfBody, {
        auth: { username: email, password: apiToken },
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: parseInt(process.env.JIRA_REQUEST_TIMEOUT || "15000", 10),
      });
      return response.data;
    },
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      shouldRetry: isRetryableError,
    },
  );

  const duration = Date.now() - start;
  logger.info(`Wrote SAGE comment to ${ticketKey} (id: ${result.id}, ${duration}ms)`);

  return result;
}

module.exports = { writeCommentToJira, buildADFComment, withRetry };
