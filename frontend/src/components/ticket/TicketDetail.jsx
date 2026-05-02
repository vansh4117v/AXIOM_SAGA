import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { FileCode, User, Clock, Tag, Layers, AlertTriangle, ExternalLink, Loader } from 'lucide-react';

export default function TicketDetail({ ticketKey }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticketKey) return;
    setLoading(true);
    api.getTicket(ticketKey)
      .then(res => { setTicket(res.data); setError(null); })
      .catch(err => setError(err.response?.data?.error?.message || err.message))
      .finally(() => setLoading(false));
  }, [ticketKey]);

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
  const briefings = ticket.briefings || [];
  const latestBriefing = briefings[0];

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-[fadeIn_0.3s_ease]">
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

      {/* Briefing summary (if exists) */}
      {latestBriefing && (
        <div className="bg-bg-card border border-green-800/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[0.6875rem] font-semibold text-green-400 uppercase tracking-wider">
              Briefing Available
            </p>
            <span className="text-xs font-mono text-sage-muted">
              Confidence: {Math.round((latestBriefing.overall_confidence || 0) * 100)}%
            </span>
          </div>
          {latestBriefing.briefing?.context_summary && (
            <p className="text-sm text-sage-secondary">{latestBriefing.briefing.context_summary}</p>
          )}
          {latestBriefing.execution_plan?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {latestBriefing.execution_plan.map((a, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-indigo-300 font-medium">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* No briefing yet */}
      {!latestBriefing && ticket.status !== 'complete' && (
        <div className="bg-bg-card border border-border-subtle rounded-xl p-6 text-center">
          <Layers size={28} className="mx-auto mb-2 text-sage-muted opacity-40" />
          <p className="text-sm text-sage-muted">No briefing generated yet</p>
          <p className="text-xs text-sage-muted mt-1">
            {ticket.status === 'failed' ? 'Pipeline failed — check logs' : 'Submit for analysis or wait for Jira poller'}
          </p>
        </div>
      )}
    </div>
  );
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
