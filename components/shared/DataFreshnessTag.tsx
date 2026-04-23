import React, { useState, useEffect } from 'react';
import { DataTrustState } from '../../types/trust';

interface DataFreshnessTagProps {
  fetchedAt?: string | Date;
  source?: 'cache' | 'live';
  className?: string;
  trustState?: DataTrustState;
}

export const DataFreshnessTag: React.FC<DataFreshnessTagProps> = ({ 
  fetchedAt, 
  source = 'live', 
  className = '',
  trustState 
}) => {
  const [timeAgo, setTimeAgo] = useState<string>('');
  const [status, setStatus] = useState<'live' | 'cached' | 'stale' | 'degraded'>('live');

  useEffect(() => {
    const targetTime = trustState 
      ? new Date(trustState.lastUpdated) 
      : (fetchedAt ? (typeof fetchedAt === 'string' ? new Date(fetchedAt) : fetchedAt) : null);

    if (!targetTime) {
      setTimeAgo('No timestamp');
      setStatus('stale');
      return;
    }

    const updateFreshness = () => {
      const diffMs = Date.now() - targetTime.getTime();
      const diffSec = Math.floor(diffMs / 1000);

      if (diffSec < 0) {
        setTimeAgo('Live');
        setStatus(trustState ? (trustState.freshness as any) : 'live');
        return;
      }

      if (diffSec < 15) {
        setTimeAgo('Live');
        setStatus(trustState ? (trustState.freshness as any) : 'live');
      } else if (diffSec < 60) {
        setTimeAgo(`${diffSec}s ago`);
        setStatus(trustState ? (trustState.freshness as any) : (source === 'cache' ? 'cached' : 'live'));
      } else if (diffSec < 3600) {
        const mins = Math.floor(diffSec / 60);
        setTimeAgo(`${mins}m ago`);
        setStatus(trustState ? (trustState.freshness as any) : (mins > 5 ? 'stale' : 'cached'));
      } else {
        const hours = Math.floor(diffSec / 3600);
        if (hours < 24) {
          setTimeAgo(`${hours}h ago`);
        } else {
          setTimeAgo(`${Math.floor(hours / 24)}d ago`);
        }
        setStatus(trustState ? (trustState.freshness as any) : 'stale');
      }
    };

    updateFreshness();
    const interval = setInterval(updateFreshness, 5000); // update every 5 seconds
    return () => clearInterval(interval);
  }, [fetchedAt, source, trustState]);

  const statusColors = {
    live: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 dark:bg-emerald-500/15',
    cached: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20 dark:bg-indigo-500/15',
    stale: 'bg-amber-500/10 text-amber-500 border-amber-500/20 dark:bg-amber-500/15',
    degraded: 'bg-rose-500/10 text-rose-500 border-rose-500/20 dark:bg-rose-500/15'
  };

  const statusDots = {
    live: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse',
    cached: 'bg-indigo-500',
    stale: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]',
    degraded: 'bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse'
  };

  const sourceLabel = trustState 
    ? trustState.source.toUpperCase() 
    : (source === 'live' ? 'LIVE' : 'CACHED');

  return (
    <div 
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusColors[status]} ${className}`}
      title={trustState?.diagnostic}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${statusDots[status]}`}></span>
      <span>{sourceLabel} • {timeAgo}</span>
    </div>
  );
};

export default DataFreshnessTag;
