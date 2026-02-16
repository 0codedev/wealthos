import { useEffect, useState } from 'react';

export interface BridgeTelemetry {
  status: string;
  timestamp: string;
  server: {
    uptime_seconds: number;
    fastapi_version: string;
  };
  system?: {
    cpu_percent: number;
    ram: {
      total_mb: number;
      used_mb: number;
      free_mb: number;
      percent: number;
    };
    swap: {
      total_mb: number;
      used_mb: number;
      percent: number;
    };
    threads_active: number;
  };
  process?: {
    pid: number;
    fds: number;
    threads: number;
    memory_rss_mb: number;
  };
  http: {
    total_requests: number;
    status_distribution: Record<string, number>;
    latencies: Record<string, {
      calls: number;
      avg_ms: number;
      p50_ms: number;
      p90_ms: number;
      p99_ms: number;
    }>;
  };
  database: {
    active_connections: number;
    peak_connections: number;
    row_counts: Record<string, number>;
  };
  websocket: {
    status: 'connected' | 'connecting' | 'disconnected';
    ping_time_ms: number;
    active_sse_listeners: number;
    subscribed_keys_count: number;
  };
  storage: {
    cache_db_size_mb: number;
    parquet_archive_size_mb: number;
    disk: {
      total_gb: number;
      free_gb: number;
      used_percent: number;
    };
  };
}

export const useBridgeTelemetry = (intervalMs = 60000) => {
  const [telemetry, setTelemetry] = useState<BridgeTelemetry | null>(null);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTelemetry = async () => {
    try {
      const response = await fetch('/api/python-nse/api/telemetry');
      if (response.ok) {
        const data = await response.json();
        setTelemetry(data);
        setIsOnline(true);
        setError(null);
        if (window.performance && window.performance.mark) {
          if (!window.performance.getEntriesByName('bridge:reachable').length) {
            window.performance.mark('bridge:reachable');
          }
          if (!window.performance.getEntriesByName('bridge-health:received').length) {
            window.performance.mark('bridge-health:received');
          }
        }
      } else {
        throw new Error(`Server returned status ${response.status}`);
      }
    } catch (err: unknown) {
      console.warn('Failed to fetch bridge telemetry:', err);
      setIsOnline(false);
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Bridge offline');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    if (intervalMs <= 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const startTimer = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(fetchTelemetry, intervalMs);
    };

    if (typeof document !== 'undefined' && !document.hidden) {
      startTimer();
    }

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void fetchTelemetry();
        startTimer();
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);

  return {
    telemetry,
    isOnline,
    isLoading,
    error,
    refresh: fetchTelemetry
  };
};
