import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { liveMarketFeedService, FeedStatus } from '../../services/live/LiveMarketFeedService';

export const LiveStatusBadge: React.FC = () => {
  const [status, setStatus] = useState<FeedStatus>(() => liveMarketFeedService.getStatus());

  useEffect(() => {
    const unsub = liveMarketFeedService.onStatusChange((s) => setStatus(s));
    return () => unsub();
  }, []);

  const config = {
    idle: {
      color: 'text-slate-400 bg-slate-400/10 border-slate-500/20',
      dot: 'bg-slate-400',
      text: 'Offline',
      pulse: false,
    },
    connecting: {
      color: 'text-cyan-400 bg-cyan-400/10 border-cyan-500/20',
      dot: 'bg-cyan-400',
      text: 'Connecting',
      pulse: true,
    },
    connected: {
      color: 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20',
      dot: 'bg-emerald-400',
      text: 'Live Mesh',
      pulse: true,
    },
    disconnected: {
      color: 'text-rose-400 bg-rose-400/10 border-rose-500/20',
      dot: 'bg-rose-400',
      text: 'Disconnected',
      pulse: false,
    },
    fallback: {
      color: 'text-amber-400 bg-amber-400/10 border-amber-500/20',
      dot: 'bg-amber-400',
      text: 'Rest Fallback',
      pulse: true,
    },
  };

  const current = config[status] || config.idle;

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold backdrop-blur-md ${current.color} transition-all duration-300`}>
      <div className="relative flex h-2 w-2">
        {current.pulse && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${current.dot}`}></span>
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${current.dot}`}></span>
      </div>
      <span className="flex items-center gap-1">
        {status === 'connecting' && <RefreshCw size={10} className="animate-spin" />}
        {status === 'connected' && <Activity size={10} />}
        {current.text}
      </span>
    </div>
  );
};

export default LiveStatusBadge;
