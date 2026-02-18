import { useState, useEffect } from 'react';
import { MarketContextEnvelope } from '../types/market_context';

export const useMarketContext = (canonicalId: string | null, intervalMs = 15000) => {
  const [context, setContext] = useState<MarketContextEnvelope | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContext = async () => {
    if (!canonicalId) return;
    try {
      setIsLoading(true);
      const response = await fetch(`/api/python-nse/api/context/${encodeURIComponent(canonicalId)}`);
      if (response.ok) {
        const data = await response.json();
        setContext(data);
        setError(null);
      } else {
        throw new Error(`Failed to load context: ${response.statusText}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Error fetching context');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchContext();
    if (!canonicalId || intervalMs <= 0) return;
    const interval = setInterval(fetchContext, intervalMs);
    return () => clearInterval(interval);
  }, [canonicalId, intervalMs]);

  return { context, isLoading, error, refetch: fetchContext };
};
