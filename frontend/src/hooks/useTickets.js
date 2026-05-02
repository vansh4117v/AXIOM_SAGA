import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';

/**
 * Poll gateway for ticket list every intervalMs.
 * Returns { tickets, loading, error, refetch }.
 */
export function useTickets(intervalMs = 10000) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetch = useCallback(async () => {
    try {
      const { data } = await api.getTickets({ limit: 50, sort: 'received_at', order: 'desc' });
      setTickets(data.tickets || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [fetch, intervalMs]);

  return { tickets, loading, error, refetch: fetch };
}
