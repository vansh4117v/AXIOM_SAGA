import { CheckCircle, Circle, Loader, AlertCircle, Zap, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

const AGENT_LABELS = {
  orchestrator: 'Orchestrator',
  risk_agent: 'Risk Agent',
  context_agent: 'Context Agent',
  routing_agent: 'Routing Agent',
  explainer_agent: 'Explainer Agent',
  risk_agent_late: 'Risk (Late)',
  synthesis: 'Synthesis',
};

const AGENT_COLORS = {
  orchestrator: 'from-violet-500 to-purple-600',
  risk_agent: 'from-red-500 to-orange-500',
  context_agent: 'from-blue-500 to-cyan-500',
  routing_agent: 'from-emerald-500 to-green-500',
  explainer_agent: 'from-amber-500 to-yellow-500',
  synthesis: 'from-indigo-500 to-violet-500',
};

export default function AgentTrace({ events, plan, status }) {
  const agentStates = {};
  const toolsByAgent = {};

  events.forEach(evt => {
    if (evt.type === 'agent_started') {
      agentStates[evt.data.agent] = 'running';
    }
    if (evt.type === 'tool_called') {
      const a = evt.data.agent;
      if (!toolsByAgent[a]) toolsByAgent[a] = [];
      toolsByAgent[a].push({ ...evt.data, done: false });
    }
    if (evt.type === 'tool_result') {
      const a = evt.data.agent;
      if (toolsByAgent[a]) {
        const t = toolsByAgent[a].find(x => x.tool === evt.data.tool && !x.done);
        if (t) { t.done = true; t.confidence = evt.data.confidence; t.result_summary = evt.data.result_summary; }
      }
    }
    if (evt.type === 'agent_complete') {
      agentStates[evt.data.agent] = { ...evt.data, state: 'done' };
    }
  });

  const planEvt = events.find(e => e.type === 'plan_ready');
  const agentList = ['orchestrator', ...(plan?.plan || [])];
  // Add synthesis if not in list
  if (plan?.plan && !plan.plan.includes('synthesis')) agentList.push('synthesis');

  return (
    <div className="bg-bg-card border border-border-subtle rounded-2xl p-5 flex flex-col gap-4 overflow-y-auto">
      <h2 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-sage-muted">
        Agent Execution Trace
      </h2>

      {/* Execution plan chips */}
      {planEvt && (
        <div className="space-y-2 animate-[fadeIn_0.4s_ease]">
          <div className="flex flex-wrap gap-2">
            {planEvt.data.plan.map((agent, i) => (
              <span key={agent}
                className="text-xs px-2.5 py-1 rounded-full bg-accent/10 border border-accent/20 text-indigo-300 font-medium">
                {i + 1}. {AGENT_LABELS[agent] ?? agent}
              </span>
            ))}
          </div>
          {planEvt.data.reasoning && (
            <p className="text-xs text-sage-muted italic pl-1">
              {planEvt.data.reasoning}
            </p>
          )}
          {planEvt.data.classification && (
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(planEvt.data.classification).filter(([k]) => k !== 'reasoning').map(([k, v]) => (
                <span key={k} className="text-[0.625rem] font-mono px-2 py-0.5 rounded bg-bg-elevated border border-border-subtle text-sage-secondary">
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Agent rows */}
      <div className="space-y-2">
        {agentList.map(agentName => (
          <AgentRow
            key={agentName}
            name={agentName}
            state={agentStates[agentName]}
            tools={toolsByAgent[agentName] || []}
          />
        ))}
      </div>

      {/* Status footer */}
      {status === 'failed' && (
        <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/8 border border-red-500/20 rounded-lg px-4 py-3">
          <AlertCircle size={14} />
          Pipeline failed — check server logs
        </div>
      )}
      {status === 'timeout' && (
        <div className="flex items-center gap-2 text-yellow-400 text-xs bg-yellow-500/8 border border-yellow-500/20 rounded-lg px-4 py-3">
          <AlertCircle size={14} />
          Pipeline timeout after 120s
        </div>
      )}
    </div>
  );
}

function AgentRow({ name, state, tools }) {
  const [expanded, setExpanded] = useState(true);
  const isDone = state && typeof state === 'object' && state.state === 'done';
  const isRunning = state === 'running';
  const isPending = !state;
  const gradient = AGENT_COLORS[name] || 'from-gray-500 to-gray-600';

  return (
    <div className={`rounded-xl border p-3.5 transition-all duration-300 animate-[fadeIn_0.3s_ease]
      ${isDone ? 'border-green-800/50 bg-green-950/15' : ''}
      ${isRunning ? 'border-accent/40 bg-accent/5 shadow-lg shadow-accent/10' : ''}
      ${isPending ? 'border-border-subtle bg-bg-secondary/50 opacity-35' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Status icon */}
          {isDone && <CheckCircle size={15} className="text-green-400" />}
          {isRunning && <Loader size={15} className="text-accent-hover animate-spin" />}
          {isPending && <Circle size={15} className="text-sage-muted" />}

          {/* Agent label with gradient dot */}
          <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${gradient}`} />
          <span className={`text-sm font-medium
            ${isDone ? 'text-green-300' : ''}
            ${isRunning ? 'text-accent-hover' : ''}
            ${isPending ? 'text-sage-muted' : ''}`}>
            {AGENT_LABELS[name] ?? name}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {isDone && state.confidence != null && <ConfidencePill value={state.confidence} />}
          {isDone && <span className="text-xs text-sage-muted font-mono">{state.duration_ms}ms</span>}
          {tools.length > 0 && (
            <button onClick={() => setExpanded(!expanded)} className="p-0.5 text-sage-muted hover:text-sage-primary transition-colors cursor-pointer">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Decision */}
      {isDone && state.decision_made && (
        <p className="mt-1.5 text-xs text-sage-secondary pl-8">{state.decision_made}</p>
      )}

      {/* Tool calls */}
      {expanded && tools.length > 0 && (
        <div className="mt-2.5 pl-8 space-y-1.5">
          {tools.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <Zap size={10} className={t.done ? 'text-yellow-500' : 'text-sage-muted animate-pulse'} />
              <span className="font-mono text-yellow-600/80">{t.tool}</span>
              <span className="text-sage-muted truncate max-w-[160px]">({t.input_summary})</span>
              {t.done && t.result_summary && (
                <span className="text-green-500/70">→ {t.result_summary}</span>
              )}
              {t.done && t.confidence != null && (
                <ConfidencePill value={t.confidence} small />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfidencePill({ value, small }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? 'bg-green-900/50 text-green-300 border-green-700/40'
              : pct >= 50 ? 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40'
              : 'bg-red-900/50 text-red-300 border-red-700/40';
  return (
    <span className={`font-mono border rounded-full ${color} ${small ? 'text-[0.6rem] px-1.5 py-0' : 'text-xs px-2 py-0.5'}`}>
      {pct}%
    </span>
  );
}
