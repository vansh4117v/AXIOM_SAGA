const express = require("express");
const router = express.Router();
const axios = require("axios");
const { normaliseToTicketDTO } = require("../services/jiraNormaliser");
const { getInstance: getDeduplicator } = require("../services/deduplicator");
const db = require("../utils/db");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validate");
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  ExternalServiceError,
} = require("../errors");

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || "http://localhost:8000";
const AI_ENGINE_TIMEOUT = parseInt(process.env.AI_ENGINE_TIMEOUT || "10000", 10);

router.post("/", async (req, res, next) => {
  try {
    let dto;

    // Accept raw Jira issue JSON or pre-normalised TicketDTO
    if (req.body.fields) {
      dto = normaliseToTicketDTO(req.body);
    } else if (req.body.ticket_key && req.body.ticket_summary) {
      dto = req.body;
    } else {
      throw new ValidationError(
        "Body must contain `fields` (raw Jira issue) or a TicketDTO with at least `ticket_key` and `ticket_summary`",
      );
    }

    // Validate ticket_key format
    if (!/^[A-Z]+-\d+$/.test(dto.ticket_key)) {
      throw new ValidationError("ticket_key must match format: PROJECT-123");
    }

    // Dedup check
    const dedup = getDeduplicator();
    if (await dedup.isDuplicate(dto.ticket_key)) {
      throw new ConflictError(`Ticket ${dto.ticket_key} already processed or in progress`);
    }

    // Save to DB
    await db.query(
      `INSERT INTO tickets (ticket_key, jira_issue_id, raw_payload, ticket_dto, status)
       VALUES ($1, $2, $3, $4, 'processing')
       ON CONFLICT (ticket_key) DO UPDATE SET
         raw_payload = EXCLUDED.raw_payload,
         ticket_dto  = EXCLUDED.ticket_dto,
         status      = 'processing'`,
      [dto.ticket_key, dto.ticket_id || null, JSON.stringify(req.body), JSON.stringify(dto)],
    );

    // Forward to AI engine
    let runId;
    try {
      const analyseRes = await axios.post(`${AI_ENGINE_URL}/analyse`, dto, {
        timeout: AI_ENGINE_TIMEOUT,
        headers: { "Content-Type": "application/json" },
      });
      runId = analyseRes.data?.run_id || null;
    } catch (fwdErr) {
      // Update status to failed
      await db
        .query("UPDATE tickets SET status = 'failed' WHERE ticket_key = $1", [dto.ticket_key])
        .catch(() => {});

      dedup.markProcessed(dto.ticket_key, "failed");

      const msg = fwdErr.response
        ? `${fwdErr.response.status}: ${JSON.stringify(fwdErr.response.data)}`
        : fwdErr.message;
      throw new ExternalServiceError("AI Engine", msg, fwdErr.response?.status);
    }

    dedup.markProcessed(dto.ticket_key, "processing");
    logger.info(`Manual submit: ${dto.ticket_key} → run_id: ${runId}`);

    return res.status(201).json({
      ticket_key: dto.ticket_key,
      run_id: runId,
      status: "processing",
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const {
      status,
      priority,
      type,
      search,
      page = "1",
      limit = "20",
      sort = "received_at",
      order = "desc",
    } = req.query;

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Validate sort
    const allowedSorts = ["received_at", "processed_at", "ticket_key", "status"];
    const sortCol = allowedSorts.includes(sort) ? sort : "received_at";
    const sortOrder = order.toLowerCase() === "asc" ? "ASC" : "DESC";

    // Build query dynamically
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }

    if (priority) {
      conditions.push(`ticket_dto->>'ticket_priority' = $${paramIdx++}`);
      params.push(priority);
    }

    if (type) {
      conditions.push(`ticket_dto->>'ticket_type' = $${paramIdx++}`);
      params.push(type);
    }

    if (search) {
      conditions.push(`(
        ticket_key ILIKE $${paramIdx} OR
        ticket_dto->>'ticket_summary' ILIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count total
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM tickets ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total || "0", 10);

    // Fetch page
    const dataResult = await db.query(
      `SELECT ticket_key, jira_issue_id, ticket_dto, status, received_at, processed_at
       FROM tickets ${whereClause}
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limitNum, offset],
    );

    const tickets = dataResult.rows.map((row) => ({
      ticket_key: row.ticket_key,
      jira_issue_id: row.jira_issue_id,
      summary: row.ticket_dto?.ticket_summary || "",
      priority: row.ticket_dto?.ticket_priority || "",
      type: row.ticket_dto?.ticket_type || "",
      assignee: row.ticket_dto?.ticket_assignee?.name || "",
      labels: row.ticket_dto?.ticket_labels || [],
      status: row.status,
      received_at: row.received_at,
      processed_at: row.processed_at,
    }));

    return res.json({
      tickets,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasMore: pageNum * limitNum < total,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:ticketKey", async (req, res, next) => {
  try {
    const { ticketKey } = req.params;

    const result = await db.query(
      `SELECT
         t.ticket_key, t.jira_issue_id, t.ticket_dto, t.status,
         t.received_at, t.processed_at,
         b.run_id, b.briefing, b.agent_trace, b.overall_confidence, b.execution_plan
       FROM tickets t
       LEFT JOIN briefings b ON b.ticket_key = t.ticket_key
       WHERE t.ticket_key = $1`,
      [ticketKey],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Ticket", ticketKey);
    }

    const row = result.rows[0];

    return res.json({
      ticket_key: row.ticket_key,
      jira_issue_id: row.jira_issue_id,
      ticket: row.ticket_dto,
      status: row.status,
      received_at: row.received_at,
      processed_at: row.processed_at,
      briefing: row.briefing || null,
      agent_trace: row.agent_trace || null,
      run_id: row.run_id || null,
      overall_confidence: row.overall_confidence || null,
      execution_plan: row.execution_plan || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
