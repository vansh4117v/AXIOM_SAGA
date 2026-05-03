import { useState, useReducer, useCallback } from 'react';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import SubmitForm from '../components/ticket/SubmitForm';
import TicketDetail from '../components/ticket/TicketDetail';
import AgentTrace from '../components/trace/AgentTrace';
import BriefingPanel from '../components/briefing/BriefingPanel';
import { useSSE } from '../hooks/useSSE';

const initialState = {
  selectedRunId: null,
  selectedTicketKey: null,
  events: [],
  briefing: null,
  status: 'idle',
  plan: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SELECT_TICKET':
      return {
        ...initialState,
        selectedRunId: action.runId,
        selectedTicketKey: action.ticketKey,
        status: action.runId ? 'processing' : 'idle',
      };
    case 'SHOW_SUBMIT':
      return { ...initialState };
    case 'SSE_EVENT': {
      const evt = action.event;
      if (evt.type === 'plan_ready')
        return { ...state, plan: evt.data, events: [...state.events, evt] };
      if (evt.type === 'briefing_ready')
        return { ...state, briefing: evt.data.briefing || evt.data, events: [...state.events, evt], status: 'complete' };
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

export default function Dashboard({ onNavigate }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [showSubmit, setShowSubmit] = useState(true);

  const handleEvent = useCallback((event) => {
    dispatch({ type: 'SSE_EVENT', event });
  }, []);

  useSSE(state.selectedRunId, handleEvent);

  const handleTicketSubmitted = (runId, ticketKey) => {
    setShowSubmit(false);
    dispatch({ type: 'SELECT_TICKET', runId, ticketKey });
  };

  const handleSelectFromSidebar = (ticketKey, runId) => {
    setShowSubmit(false);
    dispatch({ type: 'SELECT_TICKET', runId: runId || null, ticketKey });
  };

  const handleShowSubmit = () => {
    setShowSubmit(true);
    dispatch({ type: 'SHOW_SUBMIT' });
  };

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-sage-primary">
      <Header
        status={state.status}
        onNavigate={onNavigate}
        currentPage="dashboard"
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          selectedTicketKey={state.selectedTicketKey}
          onSelect={handleSelectFromSidebar}
          onShowSubmit={handleShowSubmit}
        />
        <main className="flex-1 overflow-y-auto p-6">
          {/* No run selected — show submit form */}
          {showSubmit && !state.selectedRunId && (
            <div className="flex items-start justify-center pt-8">
              <SubmitForm onSubmitted={handleTicketSubmitted} />
            </div>
          )}

          {/* Run active — show trace + briefing */}
          {state.selectedRunId && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 h-full">
              <AgentTrace
                events={state.events}
                plan={state.plan}
                status={state.status}
              />
              <BriefingPanel
                briefing={state.briefing}
                status={state.status}
              />
            </div>
          )}

          {/* Ticket selected but no run_id (polled ticket, already complete) */}
          {!showSubmit && !state.selectedRunId && state.selectedTicketKey && (
            <TicketDetail
              ticketKey={state.selectedTicketKey}
              onAnalyse={handleTicketSubmitted}
            />
          )}
        </main>
      </div>
    </div>
  );
}
