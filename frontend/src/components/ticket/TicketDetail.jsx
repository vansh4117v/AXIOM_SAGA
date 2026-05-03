import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { FileCode, User, Clock, Tag, Layers, AlertTriangle, Zap, Loader } from 'lucide-react';
import BriefingPanel from '../briefing/BriefingPanel';
import AgentTrace from '../trace/AgentTrace';

export default function TicketDetail({ ticketKey, onAnalyse }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [analysing, setAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState(null);

  useEffect(() => {
    if (!ticketKey) return;
    setLoading(true);
    api.getTicket(ticketKey)
      .then(res => { setTicket(res.data); setError(null); })
      .catch(err => setError(err.response?.data?.error?.message || err.message))
      .finally(() => setLoading(false));
  }, [ticketKey]);

  const handleAnalyse = async () => {
    if (!ticket) return;
    setAnalysing(true);
    setAnalyseError(null);
    try {
      const dto = ticket.ticket || ticket.ticketDto || {};
      const payload = {
        ticket_key: ticket.ticket_key || ticketKey,
        ticket_id: dto.ticket_id || ticket.jira_issue_id || ticketKey,
        ticket_summary: dto.ticket_summary || ticketKey,
        ticket_description: dto.ticket_description || '',
        ticket_priority: dto.ticket_priority || 'Medium',
        ticket_type: dto.ticket_type || 'Task',
        ticket_labels: dto.ticket_labels || [],
        ticket_components: dto.ticket_components || [],
        ticket_assignee: dto.ticket_assignee || { name: 'Unassigned', email: '' },
        ticket_reporter: dto.ticket_reporter || { name: 'Unknown', email: '' },
        ticket_created: dto.ticket_created || new Date().toISOString(),
      };
      const { data } = await api.submitTicket(payload);
      if (onAnalyse) onAnalyse(data.run_id, data.ticket_key);
    } catch (err) {
      const msg = err.response?.data?.error?.message
        || err.response?.data?.detail
        || err.message;
      setAnalyseError(msg);
    } finally {
      setAnalysing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader size={20} className="animate-spin text-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <AlertTriangle size={32} className="text-sage-muted mb-3" />
        <p className="text-sm text-sage-muted">{error}</p>
      </div>
    );
  }

  if (!ticket) return null;

  const dto = ticket.ticket || ticket.ticketDto || {};
  const briefing = ticket.briefing
    ? {
        ...ticket.briefing,
        overall_confidence: ticket.briefing.overall_confidence ?? ticket.overall_confidence,
      }
    : null;
  const executionPlan = ticket.execution_plan || briefing?.execution_plan || [];
  const traceEvents = buildTraceEvents(ticket.agent_trace || [], executionPlan);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-[fadeIn_0.3s_ease]">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-sm font-mono font-bold text-accent-hover">{ticket.ticket_key || ticketKey}</span>
          <StatusBadge status={ticket.status} />
          {dto.ticket_priority && <PriorityBadge priority={dto.ticket_priority} />}
        </div>
        <h2 className="text-xl font-semibold text-sage-primary">
          {dto.ticket_summary || 'Untitled Ticket'}
        </h2>
      </div>

      {/* Analyse button */}
      {ticket.status !== 'processing' && onAnalyse && (
        <div>
          <button
            onClick={handleAnalyse}
            disabled={analysing}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-45 text-white font-medium rounded-lg transition-all duration-200 hover:shadow-[0_0_24px_var(--color-accent-glow)] cursor-pointer text-sm"
          >
            {analysing ? <Loader size={16} className="animate-spin" /> : <Zap size={16} />}
            {analysing ? 'Analysing…' : 'Analyse This Ticket'}
          </button>
          {analyseError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-4 py-3 mt-3">
              <AlertTriangle size={16} />
              {analyseError}
            </div>
          )}
        </div>
      )}

      {/* Meta row */}
      <div className="flex flex-wrap gap-4 text-xs text-sage-muted">
        {dto.ticket_type && (
          <span className="flex items-center gap-1.5">
            <Tag size={12} />
            {dto.ticket_type}
          </span>
        )}
        {dto.ticket_assignee?.name && dto.ticket_assignee.name !== 'Unassigned' && (
          <span className="flex items-center gap-1.5">
            <User size={12} />
            {dto.ticket_assignee.name}
          </span>
        )}
        {ticket.received_at && (
          <span className="flex items-center gap-1.5">
            <Clock size={12} />
            Received: {new Date(ticket.received_at).toLocaleString()}
          </span>
        )}
        {ticket.processed_at && (
          <span className="flex items-center gap-1.5">
            <Clock size={12} />
            Processed: {new Date(ticket.processed_at).toLocaleString()}
          </span>
        )}
      </div>

      {/* Description */}
      {dto.ticket_description && (
        <div className="bg-bg-card border border-border-subtle rounded-xl p-5">
          <p className="text-[0.6875rem] font-semibold text-sage-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FileCode size={12} />
            Description
          </p>
          <p className="text-sm text-sage-secondary leading-relaxed whitespace-pre-wrap">
            {dto.ticket_description}
          </p>
        </div>
      )}

      {/* Labels & Components */}
      {(dto.ticket_labels?.length > 0 || dto.ticket_components?.length > 0) && (
        <div className="flex flex-wrap gap-4">
          {dto.ticket_labels?.length > 0 && (
            <div>
              <p className="text-[0.625rem] font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Labels</p>
              <div className="flex flex-wrap gap-1.5">
                {dto.ticket_labels.map(l => (
                  <span key={l} className="text-xs px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent-hover">
                    {l}
                  </span>
                ))}
              </div>
            </div>
          )}
          {dto.ticket_components?.length > 0 && (
            <div>
              <p className="text-[0.625rem] font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Components</p>
              <div className="flex flex-wrap gap-1.5">
                {dto.ticket_components.map(c => (
                  <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full saved briefing (if exists) */}
      {briefing && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {traceEvents.length > 0 && (
            <AgentTrace
              events={traceEvents}
              plan={{ plan: executionPlan }}
              status={ticket.status}
            />
          )}
          <BriefingPanel briefing={briefing} status={ticket.status} />
        </div>
      )}

      {/* No briefing yet */}
      {!briefing && ticket.status !== 'complete' && (
        <div className="bg-bg-card border border-border-subtle rounded-xl p-6 text-center">
          <Layers size={28} className="mx-auto mb-2 text-sage-muted opacity-40" />
          <p className="text-sm text-sage-muted">No briefing generated yet</p>
          <p className="text-xs text-sage-muted mt-1">
            {ticket.status === 'failed'
              ? 'Pipeline failed — check logs'
              : 'Click "Analyse This Ticket" above to run SAGE analysis'}
          </p>
        </div>
      )}
    </div>
  );
}

function buildTraceEvents(trace, executionPlan) {
  const events = [];

  if (executionPlan?.length > 0) {
    events.push({
      type: 'plan_ready',
      data: { plan: executionPlan },
    });
  }

  trace.forEach(entry => {
    (entry.tools_called || []).forEach(tool => {
      const inputSummary = summarizeToolInput(tool.input);
      events.push({
        type: 'tool_called',
        data: {
          agent: entry.agent,
          tool: tool.tool,
          input_summary: inputSummary,
        },
      });
      events.push({
        type: 'tool_result',
        data: {
          agent: entry.agent,
          tool: tool.tool,
          input_summary: inputSummary,
          result_summary: '',
        },
      });
    });

    events.push({
      type: 'agent_complete',
      data: {
        agent: entry.agent,
        duration_ms: entry.duration_ms,
        confidence: entry.confidence,
        decision_made: entry.decision_made,
      },
    });
  });

  return events;
}

function summarizeToolInput(input) {
  if (input == null) return '';
  if (typeof input === 'string') return input;

  try {
    const text = JSON.stringify(input);
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  } catch {
    return String(input);
  }
}

function StatusBadge({ status }) {
  const cfg = {
    pending:    'bg-sage-muted/10 text-sage-muted border-sage-muted/20',
    processing: 'bg-accent/10 text-accent-hover border-accent/20',
    complete:   'bg-green-500/10 text-green-400 border-green-500/20',
    failed:     'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return (
    <span className={`text-[0.625rem] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider ${cfg[status] || cfg.pending}`}>
      {status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const cfg = {
    Critical: 'bg-red-500/10 text-red-400 border-red-500/20',
    High:     'bg-orange-500/10 text-orange-400 border-orange-500/20',
    Medium:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    Low:      'bg-green-500/10 text-green-400 border-green-500/20',
  };
  return (
    <span className={`text-[0.625rem] font-semibold px-2 py-0.5 rounded-full border ${cfg[priority] || cfg.Medium}`}>
      {priority}
    </span>
  );
}
