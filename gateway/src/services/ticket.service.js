const axios = require('axios');
const { prisma } = require('../utils/prisma');
const { normaliseToTicketDTO } = require('./jiraNormaliser');
const { getInstance: getDeduplicator } = require('./deduplicator');
const logger = require('../utils/logger');
const {
  ValidationError,
  ConflictError,
  NotFoundError,
  ExternalServiceError,
} = require('../errors');

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000';
const AI_ENGINE_TIMEOUT = parseInt(process.env.AI_ENGINE_TIMEOUT || '10000', 10);


/**
 * Submit a ticket for analysis.
 * Accepts raw Jira issue JSON or pre-normalised TicketDTO.
 *
 * @param {object} body — request body (raw Jira or TicketDTO)
 * @returns {{ ticket_key: string, run_id: string, status: string }}
 */
async function submitTicket(body) {
  let dto;

  if (body.fields) {
    dto = normaliseToTicketDTO(body);
  } else if (body.ticket_key && body.ticket_summary) {
    dto = body;
  } else {
    throw new ValidationError(
      'Body must contain `fields` (raw Jira issue) or a TicketDTO with `ticket_key` and `ticket_summary`'
    );
  }

  // Validate ticket_key format
  if (!dto.ticket_key || !/^[A-Z]+-\d+$/.test(dto.ticket_key)) {
    throw new ValidationError('ticket_key must match format: PROJECT-123');
  }

  // Dedup check — allow re-analysis of failed/complete tickets
  const dedup = getDeduplicator();
  const existing = await prisma.ticket.findUnique({
    where: { ticketKey: dto.ticket_key },
    select: { status: true },
  });
  if (existing && existing.status === 'processing') {
    throw new ConflictError(`Ticket ${dto.ticket_key} is currently being processed`);
  }
  // Clear dedup cache so ticket can be reprocessed
  dedup.markProcessed(dto.ticket_key, 'pending');

  // Upsert ticket in DB
  await prisma.ticket.upsert({
    where: { ticketKey: dto.ticket_key },
    create: {
      ticketKey: dto.ticket_key,
      jiraIssueId: dto.ticket_id || null,
      rawPayload: body,
      ticketDto: dto,
      status: 'processing',
    },
    update: {
      rawPayload: body,
      ticketDto: dto,
      status: 'processing',
    },
  });

  // Forward to AI engine
  let runId;
  try {
    const res = await axios.post(`${AI_ENGINE_URL}/analyse`, dto, {
      timeout: AI_ENGINE_TIMEOUT,
      headers: { 'Content-Type': 'application/json' },
    });
    runId = res.data?.run_id || null;
  } catch (fwdErr) {
    await prisma.ticket.update({
      where: { ticketKey: dto.ticket_key },
      data: { status: 'failed' },
    }).catch(() => {});

    dedup.markProcessed(dto.ticket_key, 'failed');

    const msg = fwdErr.response
      ? `${fwdErr.response.status}: ${JSON.stringify(fwdErr.response.data)}`
      : fwdErr.message;
    throw new ExternalServiceError('AI Engine', msg, fwdErr.response?.status);
  }

  dedup.markProcessed(dto.ticket_key, 'processing');
  logger.info(`Ticket submitted: ${dto.ticket_key} → run_id: ${runId}`);

  return { ticket_key: dto.ticket_key, run_id: runId, status: 'processing' };
}


/**
 * List tickets with pagination, filtering, search, sort.
 *
 * @param {object} query — validated query params from Zod
 * @returns {{ tickets: Array, pagination: object }}
 */
async function listTickets(query) {
  const { status, priority, type, search, page, limit, sort, order } = query;
  await reconcileProcessingTickets();

  // Map API sort fields (snake_case) → Prisma model fields (camelCase)
  const sortFieldMap = {
    received_at:  'receivedAt',
    processed_at: 'processedAt',
    ticket_key:   'ticketKey',
    status:       'status',
  };
  const prismaSort = sortFieldMap[sort] || 'receivedAt';

  // Build Prisma where clause
  const where = {};

  if (status) where.status = status;

  // JSONB filtering via raw path
  const andConditions = [];

  if (priority) {
    andConditions.push({ ticketDto: { path: ['ticket_priority'], equals: priority } });
  }
  if (type) {
    andConditions.push({ ticketDto: { path: ['ticket_type'], equals: type } });
  }
  if (search) {
    where.OR = [
      { ticketKey: { contains: search, mode: 'insensitive' } },
      { ticketDto: { path: ['ticket_summary'], string_contains: search } },
    ];
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  const [total, tickets] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      orderBy: { [prismaSort]: order },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        ticketKey: true,
        jiraIssueId: true,
        ticketDto: true,
        status: true,
        receivedAt: true,
        processedAt: true,
      },
    }),
  ]);

  const mapped = tickets.map(t => ({
    ticket_key:    t.ticketKey,
    jira_issue_id: t.jiraIssueId,
    summary:       t.ticketDto?.ticket_summary || '',
    priority:      t.ticketDto?.ticket_priority || '',
    type:          t.ticketDto?.ticket_type || '',
    assignee:      t.ticketDto?.ticket_assignee?.name || '',
    labels:        t.ticketDto?.ticket_labels || [],
    status:        t.status,
    received_at:   t.receivedAt,
    processed_at:  t.processedAt,
  }));

  return {
    tickets: mapped,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
}


async function getTicketDetail(ticketKey) {
  const ticket = await prisma.ticket.findUnique({
    where: { ticketKey },
    include: {
      briefings: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!ticket) {
    throw new NotFoundError('Ticket', ticketKey);
  }

  const briefing = ticket.briefings[0] || null;

  return {
    ticket_key:    ticket.ticketKey,
    jira_issue_id: ticket.jiraIssueId,
    ticket:        ticket.ticketDto,
    status:        ticket.status,
    received_at:   ticket.receivedAt,
    processed_at:  ticket.processedAt,
    briefing:      briefing?.briefing || null,
    agent_trace:   briefing?.agentTrace || null,
    run_id:        briefing?.runId || null,
    overall_confidence: briefing?.overallConfidence || null,
    execution_plan:     briefing?.executionPlan || null,
  };
}

module.exports = { submitTicket, listTickets, getTicketDetail };

async function reconcileProcessingTickets() {
  const staleMinutes = parseInt(process.env.PROCESSING_TIMEOUT_MINUTES || '10', 10);
  const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE tickets t
      SET status = 'complete', processed_at = COALESCE(t.processed_at, NOW())
      WHERE t.status = 'processing'
        AND EXISTS (
          SELECT 1 FROM briefings b WHERE b.ticket_key = t.ticket_key
        )
    `,
    prisma.ticket.updateMany({
      where: {
        status: 'processing',
        receivedAt: { lt: staleCutoff },
      },
      data: {
        status: 'timeout',
        processedAt: new Date(),
      },
    }),
  ]).catch((err) => {
    logger.error(`Processing ticket reconciliation failed: ${err.message}`);
  });
}
