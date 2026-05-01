const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const logger = require('../utils/logger');
const { validate } = require('../middleware/validate');
const { authorize } = require('../middleware/auth');
const { ValidationError, NotFoundError } = require('../errors');

const VALID_AGENTS = new Set([
  'orchestrator',
  'context_agent',
  'routing_agent',
  'explainer_agent',
  'risk_agent',
  'synthesis',
]);

router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT agent_name, system_prompt, version, updated_at, updated_by
       FROM agent_prompts
       ORDER BY agent_name`
    );

    return res.json({
      count: result.rows.length,
      prompts: result.rows,
    });
  } catch (err) {
    // Table might not exist yet
    if (err.code === '42P01') {
      return res.json({ count: 0, prompts: [] });
    }
    next(err);
  }
});

router.get('/:agent', async (req, res, next) => {
  try {
    const { agent } = req.params;

    const result = await db.query(
      `SELECT agent_name, system_prompt, version, updated_at, updated_by
       FROM agent_prompts
       WHERE agent_name = $1`,
      [agent]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Prompt', agent);
    }

    return res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

const promptUpdateSchema = {
  system_prompt: { type: 'string', required: true, minLength: 10, maxLength: 50000 },
};

router.put('/:agent', authorize('admin'), validate(promptUpdateSchema), async (req, res, next) => {
  try {
    const { agent } = req.params;
    const { system_prompt } = req.body;
    const updatedBy = req.user?.username || 'unknown';

    // Validate agent name
    if (!VALID_AGENTS.has(agent)) {
      throw new ValidationError(
        `Invalid agent name: "${agent}". Must be one of: ${[...VALID_AGENTS].join(', ')}`
      );
    }

    // Upsert with version bump
    const result = await db.query(
      `INSERT INTO agent_prompts (agent_name, system_prompt, version, updated_at, updated_by)
       VALUES ($1, $2, 1, NOW(), $3)
       ON CONFLICT (agent_name) DO UPDATE SET
         system_prompt = EXCLUDED.system_prompt,
         version       = agent_prompts.version + 1,
         updated_at    = NOW(),
         updated_by    = EXCLUDED.updated_by
       RETURNING agent_name, version, updated_at, updated_by`,
      [agent, system_prompt, updatedBy]
    );

    const row = result.rows[0];
    logger.info(`Prompt updated: ${agent} → v${row.version} by ${updatedBy}`);

    return res.json({
      message: 'Prompt updated',
      agent_name: row.agent_name,
      version: row.version,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
    });
  } catch (err) {
    next(err);
  }
});

// (for future: prompt version audit trail)

module.exports = router;
