import { useState, useReducer, useCallback } from 'react';
import { ArrowLeft, Zap } from 'lucide-react';
import AgentTrace from '../components/trace/AgentTrace';
import BriefingPanel from '../components/briefing/BriefingPanel';
import SubmitForm from '../components/ticket/SubmitForm';
import { useSSE } from '../hooks/useSSE';

const initialCol = {
  runId: null,
  ticketKey: null,
  events: [],
  briefing: null,
  status: 'idle',
  plan: null,
};

function colReducer(state, action) {
  switch (action.type) {
    case 'SELECT':
      return { ...initialCol, runId: action.runId, ticketKey: action.ticketKey, status: 'processing' };
    case 'SSE_EVENT': {
      const evt = action.event;
      if (evt.type === 'plan_ready')
        return { ...state, plan: evt.data, events: [...state.events, evt] };
      if (evt.type === 'briefing_ready')
        return { ...state, briefing: evt.data.briefing, events: [...state.events, evt], status: 'complete' };
      if (evt.type === 'pipeline_failed')
        return { ...state, events: [...state.events, evt], status: 'failed' };
      if (evt.type === 'timeout')
        return { ...state, events: [...state.events, evt], status: 'timeout' };
      return { ...state, events: [...state.events, evt] };
    }
    default:
      return state;
  }
}

function CompareColumn({ label, color }) {
  const [state, dispatch] = useReducer(colReducer, initialCol);

  const handleEvent = useCallback((event) => {
    dispatch({ type: 'SSE_EVENT', event });
  }, []);

  useSSE(state.runId, handleEvent);

  const handleSubmitted = (runId, ticketKey) => {
    dispatch({ type: 'SELECT', runId, ticketKey });
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 border border-border-subtle rounded-2xl bg-bg-secondary overflow-hidden">
      {/* Column header */}
      <div className={`px-4 py-3 border-b border-border-subtle flex items-center justify-between bg-gradient-to-r ${color} bg-opacity-5`}>
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-sage-secondary" />
          <span className="text-sm font-medium text-sage-primary">{label}</span>
        </div>
        {state.ticketKey && (
          <span className="text-xs font-mono text-sage-muted">
            {state.ticketKey} · {state.status}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!state.runId && (
          <div className="pt-4">
            <SubmitForm onSubmitted={handleSubmitted} />
          </div>
        )}
        {state.runId && (
          <>
            <AgentTrace events={state.events} plan={state.plan} status={state.status} />
            <BriefingPanel briefing={state.briefing} status={state.status} />
          </>
        )}
      </div>
    </div>
  );
}

export default function Compare({ onNavigate }) {
  return (
    <div className="flex flex-col h-screen bg-bg-primary text-sage-primary">
      {/* Header */}
      <div className="h-14 bg-bg-secondary border-b border-border-subtle flex items-center px-5 gap-4 shrink-0">
        <button onClick={() => onNavigate('dashboard')}
          className="p-1.5 rounded-lg hover:bg-bg-hover text-sage-muted hover:text-sage-primary transition-colors cursor-pointer">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold text-sage-primary">Compare View</h1>
        <p className="text-xs text-sage-muted">Submit two tickets side by side. Different priorities → different agent paths → proof of agency.</p>
      </div>

      {/* Two columns */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        <CompareColumn label="Ticket A — High Priority" color="from-red-900/20 to-orange-900/20" />
        <CompareColumn label="Ticket B — Low Priority" color="from-blue-900/20 to-cyan-900/20" />
      </div>
    </div>
  );
}
