import { useState } from 'react';
import { api } from '../../api/client';
import { Search, Zap, AlertCircle, Loader } from 'lucide-react';

export default function SubmitForm({ onSubmitted }) {
  const [ticketKey, setTicketKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const key = ticketKey.trim().toUpperCase();
    if (!key) {
      setError('Enter a Jira ticket key');
      return;
    }
    if (!/^[A-Z]+-\d+$/.test(key)) {
      setError('Invalid format. Use PROJECT-123 (e.g., SAGE-1)');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fetch ticket from gateway (which has it from Jira poller or will fetch it)
      let ticketData;
      try {
        const { data } = await api.getTicket(key);
        ticketData = data.ticket || data.ticketDto || {};
      } catch (fetchErr) {
        // Ticket not in gateway DB yet — submit directly with minimal info
        // Gateway will validate and forward to agent
        ticketData = null;
      }

      // Submit through gateway — gateway validates, upserts, forwards to agent
      const dto = ticketData ? {
        ticket_key: key,
        ticket_id: ticketData.ticket_id || key,
        ticket_summary: ticketData.ticket_summary || key,
        ticket_description: ticketData.ticket_description || '',
        ticket_priority: ticketData.ticket_priority || 'Medium',
        ticket_type: ticketData.ticket_type || 'Task',
        ticket_labels: ticketData.ticket_labels || [],
        ticket_components: ticketData.ticket_components || [],
        ticket_assignee: ticketData.ticket_assignee || { name: 'Unassigned', email: '' },
        ticket_reporter: ticketData.ticket_reporter || { name: 'Unknown', email: '' },
        ticket_created: ticketData.ticket_created || new Date().toISOString(),
      } : {
        ticket_key: key,
        ticket_id: key,
        ticket_summary: key,
        ticket_description: '',
        ticket_priority: 'Medium',
        ticket_type: 'Task',
        ticket_labels: [],
        ticket_components: [],
        ticket_assignee: { name: 'Unassigned', email: '' },
        ticket_reporter: { name: 'Unknown', email: '' },
        ticket_created: new Date().toISOString(),
      };

      const { data } = await api.submitTicket(dto);
      onSubmitted(data.run_id, data.ticket_key);
    } catch (err) {
      const msg = err.response?.data?.error?.message
        || err.response?.data?.detail
        || err.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto animate-[fadeIn_0.3s_ease]">
      <div className="mb-8 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Zap size={24} className="text-accent" />
        </div>
        <h2 className="text-xl font-semibold text-sage-primary mb-1">Analyse a Jira Ticket</h2>
        <p className="text-sm text-sage-muted">
          Enter an existing Jira ticket key. SAGE will fetch its details, reason about it,
          and produce a situational briefing.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">
            Jira Ticket Key
          </label>
          <input
            value={ticketKey}
            onChange={(e) => setTicketKey(e.target.value)}
            placeholder="SAGE-1"
            autoFocus
            className="w-full px-4 py-3 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all font-mono text-center text-lg tracking-wider"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-4 py-3">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-accent-hover disabled:opacity-45 text-white font-medium rounded-lg transition-all duration-200 hover:shadow-[0_0_24px_var(--color-accent-glow)] cursor-pointer text-sm"
        >
          {loading ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
          {loading ? 'Analysing…' : 'Analyse Ticket'}
        </button>
      </form>

      <p className="text-xs text-sage-muted text-center mt-6">
        Or click a ticket in the sidebar to view details and analyse it from there.
      </p>
    </div>
  );
}
