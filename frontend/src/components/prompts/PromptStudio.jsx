import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { Save, Check, Loader, ArrowLeft } from 'lucide-react';

const AGENTS = [
  { key: 'orchestrator', label: 'Orchestrator', desc: 'Classifies tickets and builds runtime plan' },
  { key: 'context_agent', label: 'Context', desc: 'Finds relevant files, PRs, and tickets' },
  { key: 'routing_agent', label: 'Routing', desc: 'Identifies best owner and builds ask-senior message' },
  { key: 'explainer_agent', label: 'Explainer', desc: 'Plain language summary and steps for juniors' },
  { key: 'risk_agent', label: 'Risk', desc: 'Identifies risk flags and related bugs' },
  { key: 'synthesis', label: 'Synthesis', desc: 'Assembles final briefing from all agents' },
];

export default function PromptStudio({ onBack }) {
  const [prompts, setPrompts] = useState({});
  const [selected, setSelected] = useState('orchestrator');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPrompts()
      .then(res => {
        const map = {};
        (res.data.prompts || []).forEach(p => { map[p.agent_name] = p; });
        setPrompts(map);
        setText(map['orchestrator']?.system_prompt || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const select = (name) => {
    setSelected(name);
    setText(prompts[name]?.system_prompt || '');
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updatePrompt(selected, text);
      setPrompts(p => ({
        ...p,
        [selected]: { ...p[selected], system_prompt: text, version: (p[selected]?.version || 0) + 1 },
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const current = prompts[selected];

  return (
    <div className="flex flex-col h-full p-6 animate-[fadeIn_0.3s_ease]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-bg-hover text-sage-muted hover:text-sage-primary transition-colors cursor-pointer">
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-lg font-semibold text-sage-primary">Prompt Studio</h1>
        </div>
        <p className="text-xs text-sage-muted">Edit agent system prompts. Changes take effect on next pipeline run.</p>
      </div>

      <div className="flex gap-5 flex-1 min-h-0">
        {/* Agent list */}
        <div className="w-48 flex flex-col gap-1 shrink-0">
          <p className="text-[0.625rem] text-sage-muted uppercase tracking-wider mb-2 font-semibold">Agents</p>
          {AGENTS.map(a => (
            <button key={a.key} onClick={() => select(a.key)}
              className={`text-left px-3 py-2.5 rounded-lg transition-all text-sm cursor-pointer
                ${selected === a.key
                  ? 'bg-accent/10 border border-accent/25 text-accent-hover'
                  : 'text-sage-secondary hover:bg-bg-hover border border-transparent'}`}>
              <span className="font-medium block">{a.label}</span>
              <span className="text-[0.625rem] text-sage-muted block mt-0.5">{a.desc}</span>
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-sage-primary">{selected}</p>
              {current && (
                <p className="text-[0.625rem] text-sage-muted font-mono">
                  v{current.version || 1} · last updated: {current.updated_at ? new Date(current.updated_at).toLocaleDateString() : 'never'}
                </p>
              )}
            </div>
            <button onClick={save} disabled={saving}
              className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium transition-all cursor-pointer
                ${saved
                  ? 'bg-green-600 text-white'
                  : 'bg-accent hover:bg-accent-hover text-white hover:shadow-[0_0_16px_var(--color-accent-glow)]'
                } disabled:opacity-50`}>
              {saved ? <Check size={13} /> : saving ? <Loader size={13} className="animate-spin" /> : <Save size={13} />}
              {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            className="flex-1 bg-bg-secondary border border-border-default rounded-xl p-4 text-sm text-sage-secondary font-mono resize-none outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] transition-all leading-relaxed"
            placeholder="Enter system prompt..."
          />

          <p className="text-[0.625rem] text-sage-muted">
            Prompts are stored in the database and loaded by the AI engine at the start of each pipeline run.
          </p>
        </div>
      </div>
    </div>
  );
}
