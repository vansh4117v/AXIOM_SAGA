const logger = require('../utils/logger');

/**
 * Recursively extract plain text from Jira Atlassian Document Format (ADF).
 * Handles all standard ADF node types: paragraphs, headings, lists,
 * code blocks, tables, inline nodes, media placeholders.
 */
function extractPlainText(adf) {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;

  const parts = [];

  function walk(node, depth = 0) {
    if (!node) return;

    switch (node.type) {
      case 'text':
        parts.push(node.text || '');
        break;

      case 'hardBreak':
        parts.push('\n');
        break;

      case 'paragraph':
        if (parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
          parts.push('\n');
        }
        walkChildren(node, depth);
        parts.push('\n');
        break;

      case 'heading':
        if (parts.length > 0) parts.push('\n');
        walkChildren(node, depth);
        parts.push('\n');
        break;

      case 'bulletList':
      case 'orderedList':
        walkChildren(node, depth);
        break;

      case 'listItem':
        parts.push('  '.repeat(depth) + '• ');
        walkChildren(node, depth + 1);
        if (!parts[parts.length - 1].endsWith('\n')) parts.push('\n');
        break;

      case 'codeBlock':
        parts.push('\n```\n');
        walkChildren(node, depth);
        parts.push('\n```\n');
        break;

      case 'blockquote':
        parts.push('\n> ');
        walkChildren(node, depth);
        parts.push('\n');
        break;

      case 'table':
        walkChildren(node, depth);
        parts.push('\n');
        break;

      case 'tableRow':
        walkChildren(node, depth);
        parts.push('\n');
        break;

      case 'tableCell':
      case 'tableHeader':
        walkChildren(node, depth);
        parts.push(' | ');
        break;

      case 'mention':
        parts.push(`@${node.attrs?.text || node.attrs?.id || 'unknown'}`);
        break;

      case 'emoji':
        parts.push(node.attrs?.shortName || '');
        break;

      case 'inlineCard':
        parts.push(node.attrs?.url || '');
        break;

      case 'mediaGroup':
      case 'mediaSingle':
        parts.push('[media attachment]');
        break;

      case 'rule':
        parts.push('\n---\n');
        break;

      case 'doc':
        walkChildren(node, depth);
        break;

      default:
        // Unknown node type — try to extract children
        walkChildren(node, depth);
        break;
    }
  }

  function walkChildren(node, depth) {
    if (Array.isArray(node.content)) {
      node.content.forEach(child => walk(child, depth));
    }
  }

  walk(adf);

  return parts.join('')
    .replace(/\n{3,}/g, '\n\n')  // Collapse excessive newlines
    .trim();
}

/**
 * Sanitise a string field — trim whitespace, collapse internal whitespace,
 * remove control characters except newlines.
 */
function sanitiseString(val, maxLength = 10000) {
  if (typeof val !== 'string') return '';
  return val
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Control chars except \n \r \t
    .trim()
    .substring(0, maxLength);
}

/**
 * Safely extract an array from a field, ensuring each element is a string.
 */
function safeStringArray(val) {
  if (!Array.isArray(val)) return [];
  return val.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean);
}

/**
 * Normalise raw Jira issue JSON → TicketDTO.
 * Output matches AgentScratchpad input fields exactly (Section 4 of spec).
 *
 * Performs:
 * - ADF→plaintext conversion for description
 * - Safe defaults for all optional fields
 * - String sanitisation
 * - Field length enforcement
 *
 * @param {object} issue — raw Jira REST API v3 issue object
 * @returns {object}     — TicketDTO matching Scratchpad input schema
 */
function normaliseToTicketDTO(issue) {
  if (!issue || !issue.key) {
    throw new Error('Invalid Jira issue: missing key');
  }

  const f = issue.fields || {};

  // Extract description — handle both ADF objects and plain strings
  let description;
  if (typeof f.description === 'string') {
    description = f.description;
  } else if (f.description && typeof f.description === 'object') {
    description = extractPlainText(f.description);
  } else {
    description = '';
  }

  const dto = {
    ticket_id:          String(issue.id || ''),
    ticket_key:         String(issue.key),
    ticket_summary:     sanitiseString(f.summary || '', 500),
    ticket_description: sanitiseString(description, 10000),
    ticket_priority:    f.priority?.name || 'Medium',
    ticket_labels:      safeStringArray(f.labels),
    ticket_components:  Array.isArray(f.components)
      ? f.components.map(c => typeof c === 'object' ? c.name : String(c)).filter(Boolean)
      : [],
    ticket_assignee: {
      name:            f.assignee?.displayName || 'Unassigned',
      email:           f.assignee?.emailAddress || null,
      jira_account_id: f.assignee?.accountId || null,
    },
    ticket_reporter: {
      name:  f.reporter?.displayName || 'Unknown',
      email: f.reporter?.emailAddress || null,
    },
    ticket_created: f.created || new Date().toISOString(),
    ticket_type:    f.issuetype?.name || 'Task',
  };

  // Validate priority is one of expected values
  const validPriorities = ['Highest', 'High', 'Medium', 'Low', 'Lowest', 'Critical'];
  if (!validPriorities.includes(dto.ticket_priority)) {
    logger.warn(`Unknown priority "${dto.ticket_priority}" for ${dto.ticket_key}, defaulting to Medium`);
    dto.ticket_priority = 'Medium';
  }

  // Validate ticket type
  const validTypes = ['Bug', 'Story', 'Task', 'Epic', 'Sub-task', 'Improvement'];
  if (!validTypes.includes(dto.ticket_type)) {
    logger.warn(`Unknown type "${dto.ticket_type}" for ${dto.ticket_key}, keeping as-is`);
  }

  logger.info(
    `Normalised ${dto.ticket_key}: "${dto.ticket_summary.substring(0, 60)}" ` +
    `[${dto.ticket_priority}/${dto.ticket_type}] ` +
    `labels=[${dto.ticket_labels.join(',')}] ` +
    `assignee=${dto.ticket_assignee.name}`
  );

  return dto;
}

module.exports = { normaliseToTicketDTO, extractPlainText, sanitiseString, safeStringArray };
