import { Plus, Search, RefreshCw, Inbox } from 'lucide-react';
import { useTickets } from '../../hooks/useTickets';
import TicketCard from '../ticket/TicketCard';
import { useState } from 'react';

export default function Sidebar({ selectedTicketKey, onSelect, onShowSubmit }) {
  const { tickets, loading, refetch } = useTickets();
  const [search, setSearch] = useState('');

  const filtered = search
    ? tickets.filter(t =>
        t.ticket_key.toLowerCase().includes(search.toLowerCase()) ||
        t.summary?.toLowerCase().includes(search.toLowerCase())
      )
    : tickets;

  return (
    <aside className="w-80 bg-bg-secondary border-r border-border-subtle flex flex-col shrink-0 h-full">
      {/* Top actions */}
      <div className="p-3 border-b border-border-subtle space-y-2">
        <button
          onClick={onShowSubmit}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-all duration-200 hover:shadow-[0_0_20px_var(--color-accent-glow)] cursor-pointer"
        >
          <Plus size={16} />
          Submit Ticket
        </button>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tickets..."
            className="w-full pl-9 pr-3 py-2 bg-bg-card border border-border-subtle rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all"
          />
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-sage-muted">
          Tickets ({filtered.length})
        </span>
        <button
          onClick={refetch}
          className="p-1 rounded text-sage-muted hover:text-sage-primary transition-colors cursor-pointer"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {loading && (
          <div className="space-y-2 p-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 animate-shimmer rounded-lg" />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-sage-muted">
            <Inbox size={32} className="mb-2 opacity-40" />
            <p className="text-sm">No tickets yet</p>
            <p className="text-xs mt-1">Submit one to start</p>
          </div>
        )}

        {filtered.map(ticket => (
          <TicketCard
            key={ticket.ticket_key}
            ticket={ticket}
            selected={ticket.ticket_key === selectedTicketKey}
            onClick={() => onSelect(ticket.ticket_key, ticket.run_id)}
          />
        ))}
      </div>
    </aside>
  );
}
