const { prisma } = require('../utils/prisma');
const logger = require('../utils/logger');
const { NotFoundError, ValidationError } = require('../errors');

const VALID_AGENTS = new Set([
  'orchestrator', 'context_agent', 'routing_agent',
  'explainer_agent', 'risk_agent', 'synthesis',
]);


async function getAllPrompts() {
  const prompts = await prisma.agentPrompt.findMany({
    orderBy: { agentName: 'asc' },
  });

  return {
    count: prompts.length,
    prompts: prompts.map(p => ({
      agent_name:    p.agentName,
      system_prompt: p.systemPrompt,
      version:       p.version,
      updated_at:    p.updatedAt,
      updated_by:    p.updatedBy,
    })),
  };
}


async function getPromptByAgent(agentName) {
  const prompt = await prisma.agentPrompt.findUnique({
    where: { agentName },
  });

  if (!prompt) {
    throw new NotFoundError('Prompt', agentName);
  }

  return {
    agent_name:    prompt.agentName,
    system_prompt: prompt.systemPrompt,
    version:       prompt.version,
    updated_at:    prompt.updatedAt,
    updated_by:    prompt.updatedBy,
  };
}


async function updatePrompt(agentName, systemPrompt, updatedBy) {
  if (!VALID_AGENTS.has(agentName)) {
    throw new ValidationError(
      `Invalid agent name: "${agentName}". Must be one of: ${[...VALID_AGENTS].join(', ')}`
    );
  }

  const existing = await prisma.agentPrompt.findUnique({
    where: { agentName },
  });

  let result;

  if (existing) {
    result = await prisma.agentPrompt.update({
      where: { agentName },
      data: {
        systemPrompt,
        version: existing.version + 1,
        updatedBy,
      },
    });
  } else {
    result = await prisma.agentPrompt.create({
      data: {
        agentName,
        systemPrompt,
        version: 1,
        updatedBy,
      },
    });
  }

  logger.info(`Prompt updated: ${agentName} → v${result.version} by ${updatedBy}`);

  return {
    message: 'Prompt updated',
    agent_name: result.agentName,
    version: result.version,
    updated_at: result.updatedAt,
    updated_by: result.updatedBy,
  };
}

module.exports = { getAllPrompts, getPromptByAgent, updatePrompt };
