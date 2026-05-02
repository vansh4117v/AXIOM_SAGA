import { useState } from 'react';
import { api } from '../../api/client';
import { Send, AlertCircle, Loader } from 'lucide-react';

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const TYPES = ['Bug', 'Story', 'Task', 'Incident', 'Epic'];

export default function SubmitForm({ onSubmitted }) {
  const [form, setForm] = useState({
    ticket_key: '', ticket_summary: '', ticket_description: '',
    ticket_priority: 'Medium', ticket_type: 'Bug',
    ticket_labels: '', ticket_components: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.ticket_key || !form.ticket_summary || !form.ticket_description) {
      setError('Key, Summary, and Description are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const dto = {
        ticket_id: form.ticket_key,
        ticket_key: form.ticket_key,
        ticket_summary: form.ticket_summary,
        ticket_description: form.ticket_description,
        ticket_priority: form.ticket_priority,
        ticket_type: form.ticket_type,
        ticket_labels: form.ticket_labels.split(',').map(s => s.trim()).filter(Boolean),
        ticket_components: form.ticket_components.split(',').map(s => s.trim()).filter(Boolean),
        ticket_assignee: { name: 'SAGE User', email: '' },
        ticket_reporter: { name: 'SAGE User', email: '' },
        ticket_created: new Date().toISOString(),
      };
      const { data } = await api.analyse(dto);
      onSubmitted(data.run_id, data.ticket_key);
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto animate-[fadeIn_0.3s_ease]">
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-sage-primary mb-1">Submit Ticket for Analysis</h2>
        <p className="text-sm text-sage-muted">SAGE will reason about your ticket and produce a situational briefing.</p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Ticket Key *</label>
            <input value={form.ticket_key} onChange={set('ticket_key')}
              placeholder="PROJ-001"
              className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Priority</label>
            <select value={form.ticket_priority} onChange={set('ticket_priority')}
              className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all appearance-none cursor-pointer">
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Summary *</label>
          <input value={form.ticket_summary} onChange={set('ticket_summary')}
            placeholder="Payment gateway 500 errors on retry after timeout"
            className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Description *</label>
          <textarea value={form.ticket_description} onChange={set('ticket_description')}
            rows={5}
            placeholder="Describe the issue in detail — what's happening, impact, reproduction steps..."
            className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all resize-y min-h-[120px]" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Type</label>
            <select value={form.ticket_type} onChange={set('ticket_type')}
              className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all appearance-none cursor-pointer">
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Labels</label>
            <input value={form.ticket_labels} onChange={set('ticket_labels')}
              placeholder="payments, production"
              className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-sage-muted uppercase tracking-wider mb-1.5">Components</label>
            <input value={form.ticket_components} onChange={set('ticket_components')}
              placeholder="backend, api"
              className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border-default rounded-lg text-sm text-sage-primary placeholder:text-sage-muted outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all" />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-4 py-3">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-accent-hover disabled:opacity-45 text-white font-medium rounded-lg transition-all duration-200 hover:shadow-[0_0_24px_var(--color-accent-glow)] cursor-pointer text-sm">
          {loading ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
          {loading ? 'Analysing…' : 'Analyse Ticket'}
        </button>
      </form>
    </div>
  );
}
