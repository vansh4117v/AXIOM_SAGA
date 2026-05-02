const { z } = require('zod');

const VALID_AGENTS = ['orchestrator', 'context_agent', 'routing_agent', 'explainer_agent', 'risk_agent', 'synthesis'];

const updatePromptSchema = z.object({
  system_prompt: z
    .string({ required_error: 'system_prompt is required' })
    .min(10, 'Prompt must be at least 10 characters')
    .max(50000, 'Prompt must be at most 50000 characters'),
});

const agentParamSchema = z.object({
  agent: z.enum(VALID_AGENTS, {
    errorMap: () => ({ message: `Agent must be one of: ${VALID_AGENTS.join(', ')}` }),
  }),
});

module.exports = {
  updatePromptSchema,
  agentParamSchema,
  VALID_AGENTS,
};
