import { Clock, AlertCircle } from 'lucide-react';

const PRIORITY_COLORS = {
  Critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  Highest:  'bg-red-500/10 text-red-400 border-red-500/20',
  High:     'bg-orange-500/10 text-orange-400 border-orange-500/20',
  Medium:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  Low:      'bg-green-500/10 text-green-400 border-green-500/20',
  Lowest:   'bg-green-500/10 text-green-400 border-green-500/20',
};

const STATUS_DOT = {
  pending:    'bg-sage-muted',
  processing: 'bg-accent animate-pulse-glow',
  complete:   'bg-green-500',
  failed:     'bg-red-500',
};

export default function TicketCard({ ticket, selected, onClick }) {
  const priority = ticket.priority || 'Medium';
  const priorityClass = PRIORITY_COLORS[priority] || PRIORITY_COLORS.Medium;
  const dotClass = STATUS_DOT[ticket.status] || STATUS_DOT.pending;

  const timeAgo = ticket.received_at
    ? formatTimeAgo(new Date(ticket.received_at))
    : '';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg p-3 transition-all duration-200 cursor-pointer group
        ${selected
          ? 'bg-accent-subtle border border-accent/30 shadow-[0_0_12px_var(--color-accent-glow)]'
          : 'bg-transparent border border-transparent hover:bg-bg-hover hover:border-border-subtle'
        }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
          <span className={`text-xs font-mono font-semibold ${selected ? 'text-accent-hover' : 'text-sage-primary'}`}>
            {ticket.ticket_key}
          </span>
        </div>
        <span className={`text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full border font-mono ${priorityClass}`}>
          {priority}
        </span>
      </div>

      <p className={`text-[0.8rem] mt-1.5 line-clamp-2 leading-snug ${selected ? 'text-sage-primary' : 'text-sage-secondary'}`}>
        {ticket.summary || ticket.ticket_key}
      </p>

      <div className="flex items-center gap-3 mt-2 text-[0.6875rem] text-sage-muted">
        {ticket.type && <span>{ticket.type}</span>}
        {ticket.assignee && ticket.assignee !== 'Unassigned' && (
          <span className="truncate">→ {ticket.assignee}</span>
        )}
        {timeAgo && (
          <span className="ml-auto flex items-center gap-1">
            <Clock size={10} />
            {timeAgo}
          </span>
        )}
      </div>
    </button>
  );
}

function formatTimeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
