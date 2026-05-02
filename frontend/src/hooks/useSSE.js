import { useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';

const SSE_EVENTS = [
  'plan_ready', 'agent_started', 'tool_called', 'tool_result',
  'agent_complete', 'briefing_ready', 'pipeline_failed', 'timeout',
];

/**
 * SSE hook — connects to AI engine stream for a run_id.
 * Calls onEvent(event) for each parsed SSE event.
 * Auto-disconnects on unmount or runId change.
 */
export function useSSE(runId, onEvent) {
  const esRef = useRef(null);

  const connect = useCallback(() => {
    if (!runId) return;
    if (esRef.current) esRef.current.close();

    const url = api.streamUrl(runId);
    const es = new EventSource(url);
    esRef.current = es;

    SSE_EVENTS.forEach(eventType => {
      es.addEventListener(eventType, (e) => {
        try {
          const data = JSON.parse(e.data);
          onEvent({ type: eventType, data, timestamp: Date.now() });
        } catch { /* malformed JSON — skip */ }
      });
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
    };
  }, [runId, onEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);
}
