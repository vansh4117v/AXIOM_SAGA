const { z } = require('zod');

const ticketKeyPattern = /^[A-Z]+-\d+$/;

const manualSubmitSchema = z.object({
  ticket_key: z
    .string({ required_error: 'ticket_key is required' })
    .regex(ticketKeyPattern, 'ticket_key must match format: PROJECT-123'),
  ticket_summary: z
    .string({ required_error: 'ticket_summary is required' })
    .min(1)
    .max(500),
  ticket_description: z.string().max(10000).default(''),
  ticket_priority: z.enum(['Highest', 'High', 'Medium', 'Low', 'Lowest', 'Critical']).default('Medium'),
  ticket_labels: z.array(z.string()).default([]),
  ticket_components: z.array(z.string()).default([]),
  ticket_assignee: z.object({
    name: z.string().default('Unassigned'),
    email: z.string().email().nullable().default(null),
    jira_account_id: z.string().nullable().default(null),
  }).default({ name: 'Unassigned', email: null, jira_account_id: null }),
  ticket_reporter: z.object({
    name: z.string().default('Unknown'),
    email: z.string().email().nullable().default(null),
  }).default({ name: 'Unknown', email: null }),
  ticket_created: z.string().datetime().default(() => new Date().toISOString()),
  ticket_type: z.enum(['Bug', 'Story', 'Task', 'Epic', 'Sub-task', 'Improvement']).default('Task'),
  ticket_id: z.string().optional(),
}).strict();

const ticketListQuerySchema = z.object({
  status: z.enum(['pending', 'processing', 'complete', 'failed']).optional(),
  priority: z.string().optional(),
  type: z.string().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['received_at', 'processed_at', 'ticket_key', 'status']).default('received_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

module.exports = {
  manualSubmitSchema,
  ticketListQuerySchema,
};
