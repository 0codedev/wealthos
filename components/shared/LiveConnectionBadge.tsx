import React, { useState, useEffect } from 'react';
import { useGlobalTickStore } from '../../store/globalTickStore';

interface LiveConnectionBadgeProps {
  size?: 'xs' | 'sm' | 'md';
  showMetrics?: boolean;
  sourceLabel?: string;
  className?: string;
}

export const LiveConnectionBadge: React.FC<LiveConnectionBadgeProps> = ({
  size = 'sm',
  showMetrics = true,
  sourceLabel,
  className = '',
}) => {
  const connectionState = useGlobalTickStore((s) => s.connectionState);
  const ticksPerSecond = useGlobalTickStore((s) => s.ticksPerSecond);
  const ticksReceived = useGlobalTickStore((s) => s.ticksReceived);
  const lastTickAt = useGlobalTickStore((s) => s.lastTickAt);
  const subscribedKeysCount = useGlobalTickStore((s) => s.subscribedKeysCount);

  // Local ticker to re-render latency/time-ago every second
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => (t + 1) % 1000), 1000);
    return () => clearInterval(interval);
  }, []);

  const sizeClasses = {
    xs: 'text-[8px] px-1.5 py-0.5 gap-1',
    sm: 'text-[9px] px-2 py-0.5 gap-1.5',
    md: 'text-xs px-2.5 py-1 gap-1.5',
  }[size];

  const dotSize = size === 'xs' ? 'h-1 w-1' : 'h-1.5 w-1.5';

  let statusConfig = {
    text: 'OFFLINE',
    container: 'bg-slate-800/50 text-slate-400 border-slate-700/60',
    dot: <span className={`${dotSize} rounded-full bg-slate-500`} />,
    title: 'Disconnected from market stream',
  };

  const lastTickAgo = lastTickAt ? Math.max(0, Math.floor((Date.now() - lastTickAt) / 1000)) : null;
  const tooltipDetails = `State: ${connectionState.toUpperCase()} | Throughput: ${ticksPerSecond} t/s | Subscriptions: ${subscribedKeysCount} | Ticks: ${ticksReceived.toLocaleString()} | Last Tick: ${lastTickAgo !== null ? `${lastTickAgo}s ago` : 'None'}`;

  switch (connectionState) {
    case 'streaming':
      statusConfig = {
        text: `LIVE${showMetrics && ticksPerSecond > 0 ? ` ${ticksPerSecond} T/S` : ''}`,
        container: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]',
        dot: (
          <span className={`relative flex ${dotSize}`}>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className={`relative inline-flex rounded-full ${dotSize} bg-emerald-500`} />
          </span>
        ),
        title: tooltipDetails,
      };
      break;

    case 'subscribing':
      statusConfig = {
        text: `SYNCING${subscribedKeysCount > 0 ? ` (${subscribedKeysCount})` : ''}`,
        container: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
        dot: <span className={`${dotSize} rounded-full bg-amber-400 animate-pulse`} />,
        title: tooltipDetails,
      };
      break;

    case 'connecting':
      statusConfig = {
        text: 'CONNECTING',
        container: 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse',
        dot: <span className={`${dotSize} rounded-full bg-amber-400`} />,
        title: 'Establishing WebSocket connection to Upstox SSE bridge...',
      };
      break;

    case 'stalled':
      statusConfig = {
        text: 'STALLED',
        container: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
        dot: <span className={`${dotSize} rounded-full bg-orange-400 animate-pulse`} />,
        title: `Warning: No tick data received for over 12 seconds. ${tooltipDetails}`,
      };
      break;

    case 'disconnected':
    default:
      statusConfig = {
        text: 'OFFLINE',
        container: 'bg-slate-800/40 text-slate-400 border-slate-800',
        dot: <span className={`${dotSize} rounded-full bg-slate-500`} />,
        title: 'Market feed offline (outside market hours or disconnected)',
      };
      break;
  }

  const label = sourceLabel ? `${sourceLabel} ${statusConfig.text}` : statusConfig.text;

  return (
    <span
      className={`inline-flex items-center rounded-full border font-black uppercase tracking-wider select-none transition-all duration-200 cursor-help ${sizeClasses} ${statusConfig.container} ${className}`}
      title={statusConfig.title}
    >
      {statusConfig.dot}
      <span>{label}</span>
    </span>
  );
};

export default LiveConnectionBadge;
