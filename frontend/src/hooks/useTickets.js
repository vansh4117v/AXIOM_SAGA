import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';

/**
 * Poll gateway for ticket list every intervalMs.
 * Returns { tickets, loading, error, refetch }.
 */
export function useTickets(intervalMs = 30000) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const inFlightRef = useRef(false);
  const retryAfterRef = useRef(0);

  const fetch = useCallback(async () => {
    const now = Date.now();
    if (inFlightRef.current || now < retryAfterRef.current) return;

    inFlightRef.current = true;
    try {
      const { data } = await api.getTickets({ limit: 50, sort: 'received_at', order: 'desc' });
      setTickets(data.tickets || []);
      setError(null);
    } catch (err) {
      if (err.response?.status === 429) {
        const retryAfterSeconds = Number(err.response.headers?.['retry-after'] || 60);
        retryAfterRef.current = Date.now() + retryAfterSeconds * 1000;
      }
      setError(err.message);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') fetch();
    }, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [fetch, intervalMs]);

  return { tickets, loading, error, refetch: fetch };
}
