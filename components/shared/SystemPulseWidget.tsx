import React, { useEffect, useState, useMemo } from 'react';
import { liveQuery } from 'dexie';
import { Activity, ShieldCheck, Wifi, Cloud, ShieldAlert, Clock, RefreshCw, Server, Database, AlertCircle } from 'lucide-react';
import { db, SyncRecordRow } from '../../database';
import { isMarketHours } from '../../types/trust';
import { dhanBrokerService } from '../../services/DhanBrokerService';
import { upstoxAuthService } from '../../services/UpstoxAuthService';
import { useBridgeTelemetry } from '../../hooks/useBridgeTelemetry';
import { useCapabilityStore } from '../../store/capabilityStore';

export const SystemPulseWidget: React.FC = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [marketLive, setMarketLive] = useState(isMarketHours());
  const [syncRecords, setSyncRecords] = useState<SyncRecordRow[]>([]);
  const [upstoxConnected, setUpstoxConnected] = useState(upstoxAuthService.isTokenValid());
  const { telemetry, isOnline: isBridgeOnline } = useBridgeTelemetry(60000);
  const [discrepancies, setDiscrepancies] = useState<any[]>([]);
  const [providerHealth, setProviderHealth] = useState<any[]>([]);

  const capabilities = useCapabilityStore(state => state.capabilities);
  const resetAll = useCapabilityStore(state => state.resetAll);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (24 * 3600));
    const h = Math.floor((seconds % (24 * 3600)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const degradedCapabilitiesCount = useMemo(() => {
    return Object.values(capabilities).filter(cap => cap.state !== 'available').length;
  }, [capabilities]);

  const fetchPulseDetails = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const discRes = await fetch('/api/python-nse/api/discrepancies');
      if (discRes.ok) {
        const dData = await discRes.json();
        setDiscrepancies(dData || []);
      }
      
      const healthRes = await fetch('/api/python-nse/api/health/providers');
      if (healthRes.ok) {
        const hData = await healthRes.json();
        setProviderHealth(hData || []);
      }
    } catch (err) {
      console.warn('Failed to fetch pulse details:', err);
    }
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    fetchPulseDetails();
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPulseTimer = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        setMarketLive(isMarketHours());
        setUpstoxConnected(upstoxAuthService.isTokenValid());
        fetchPulseDetails();
      }, 60000);
    };

    if (typeof document !== 'undefined' && !document.hidden) {
      startPulseTimer();
    }

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        setMarketLive(isMarketHours());
        setUpstoxConnected(upstoxAuthService.isTokenValid());
        void fetchPulseDetails();
        startPulseTimer();
      } else if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    const sub = liveQuery(() => db.sync_records.toArray()).subscribe({
      next: (value) => setSyncRecords(value || []),
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (interval) clearInterval(interval);
      sub.unsubscribe();
    };
  }, []);

  const lastSyncTime = useMemo(() => {
    const records = syncRecords
      .filter(r => r.source === 'firebase')
      .sort((a, b) => new Date(b.lastSyncedAt).getTime() - new Date(a.lastSyncedAt).getTime());
    return records[0]?.lastSyncedAt || null;
  }, [syncRecords]);

  const lastSyncStr = useMemo(() => {
    if (!lastSyncTime) return 'Never';
    const diffMins = Math.floor((Date.now() - new Date(lastSyncTime).getTime()) / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return new Date(lastSyncTime).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  }, [lastSyncTime]);

  const hasSyncAlert = useMemo(() => {
    return syncRecords.some(r => r.syncStatus === 'ERROR' || r.syncStatus === 'CONFLICT');
  }, [syncRecords]);

  const dhanConnected = dhanBrokerService.isConfigured();

  // Compute aggregated health status
  const overallStatus = useMemo(() => {
    if (!isOnline) return 'offline';
    const cpuLoad = telemetry?.system?.cpu_percent || 0;
    const ramLoad = telemetry?.system?.ram.percent || 0;
    if (cpuLoad > 85 || ramLoad > 90) return 'offline';
    if (hasSyncAlert || isBridgeOnline === false || degradedCapabilitiesCount > 0 || discrepancies.length > 0 || cpuLoad > 65 || ramLoad > 80) return 'attention';
    return 'healthy';
  }, [isOnline, hasSyncAlert, isBridgeOnline, degradedCapabilitiesCount, discrepancies, telemetry]);

  const getStatusColor = () => {
    if (overallStatus === 'offline') return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
    if (overallStatus === 'attention') return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20 dark:text-indigo-400';
  };

  return (
    <div className="relative group select-none">
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border shadow-sm transition-all cursor-pointer ${getStatusColor()}`}>
        <div className="relative flex items-center justify-center w-2.5 h-2.5">
          {overallStatus === 'healthy' && (
            <span className="absolute w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping opacity-75"></span>
          )}
          <span className={`relative w-1.5 h-1.5 rounded-full ${
            overallStatus === 'healthy' ? 'bg-indigo-500' :
            overallStatus === 'attention' ? 'bg-amber-500 animate-pulse' :
            'bg-rose-500'
          }`}></span>
        </div>
        <span className="flex items-center gap-1.5 font-mono text-[10px]">
          <Activity size={12} className={overallStatus === 'healthy' ? 'text-indigo-500 animate-pulse' : 'text-current'} />
          {telemetry?.system ? (
            <span>
              {telemetry.system.cpu_percent.toFixed(0)}% <span className="text-[9px] text-slate-400 font-sans">CPU</span> | {telemetry.system.ram.percent.toFixed(0)}% <span className="text-[9px] text-slate-400 font-sans">RAM</span>
            </span>
          ) : (
            <span>System Pulse</span>
          )}
        </span>
      </div>

      {/* Dropdown details panel */}
      <div className="absolute right-0 top-10 hidden group-hover:block bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-[10px] p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl z-[100] w-56 font-sans font-medium text-left leading-relaxed">
        <p className="font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800/80 pb-2">
          <ShieldCheck size={14} className="text-indigo-500" />
          System Operations
        </p>

        {/* Network */}
        <div className="flex justify-between items-center mb-2">
          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><Wifi size={10} /> Network Status:</span>
          <span className={`font-bold font-mono uppercase ${isOnline ? 'text-emerald-500' : 'text-rose-500'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>

        {/* VM CPU Load */}
        {telemetry?.system && (
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><Server size={10} /> VM CPU Load:</span>
            <span className={`font-bold font-mono ${
              telemetry.system.cpu_percent > 80 ? 'text-rose-500 animate-pulse' :
              telemetry.system.cpu_percent > 55 ? 'text-amber-500' : 'text-emerald-500'
            }`}>
              {telemetry.system.cpu_percent.toFixed(1)}%
            </span>
          </div>
        )}

        {/* VM RAM Usage */}
        {telemetry?.system && (
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><Server size={10} /> VM RAM Usage:</span>
            <span className={`font-bold font-mono ${
              telemetry.system.ram.percent > 85 ? 'text-rose-500 animate-pulse' :
              telemetry.system.ram.percent > 70 ? 'text-amber-500' : 'text-emerald-500'
            }`}>
              {telemetry.system.ram.percent.toFixed(1)}%
            </span>
          </div>
        )}

        {/* VM Uptime */}
        {telemetry && (
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><Clock size={10} /> VM Uptime:</span>
            <span className="font-bold font-mono text-slate-700 dark:text-slate-350">
              {formatUptime(telemetry.server.uptime_seconds)}
            </span>
          </div>
        )}

        {/* Market Status */}
        <div className="flex justify-between items-center mb-2">
          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><Clock size={10} /> Market Session:</span>
          <span className={`font-bold font-mono uppercase ${marketLive ? 'text-emerald-500' : 'text-slate-500 dark:text-slate-400'}`}>
            {marketLive ? 'Live' : 'Closed'}
          </span>
        </div>

        {/* Cloud Sync */}
        <div className="flex justify-between items-center mb-2">
          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><Cloud size={10} /> Cloud Sync:</span>
          <span className={`font-bold font-mono uppercase ${hasSyncAlert ? 'text-amber-500' : 'text-emerald-500'}`}>
            {hasSyncAlert ? 'Attention' : lastSyncStr}
          </span>
        </div>

        {/* Python Bridge */}
        <div className="flex justify-between items-center mb-2">
          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><Server size={10} /> Python Bridge:</span>
          <span className={`font-bold font-mono uppercase ${isBridgeOnline ? 'text-emerald-500' : isBridgeOnline === false ? 'text-rose-500' : 'text-slate-500'}`}>
            {isBridgeOnline ? 'Online' : isBridgeOnline === false ? 'Offline' : 'Loading'}
          </span>
        </div>

        {/* Bridge Cache */}
        {telemetry && (
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><Database size={10} /> Bridge Cache:</span>
            <span className="font-bold font-mono text-slate-700 dark:text-slate-300">
              {telemetry.storage.cache_db_size_mb} MB
            </span>
          </div>
        )}

        {/* Broker Integrations */}
        <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Dhan Broker Lane:</span>
            <span className={`font-mono text-[9px] font-bold ${dhanConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
              {dhanConnected ? 'LINKED' : 'OFFLINE'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Upstox Analytics:</span>
            <span className={`font-mono text-[9px] font-bold ${upstoxConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
              {upstoxConnected ? 'ACTIVE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {/* API Capabilities */}
        <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1">
          <div className="flex justify-between items-center mb-1">
            <span className="font-bold text-slate-400 uppercase tracking-wider text-[8px]">API Capabilities:</span>
            {degradedCapabilitiesCount > 0 && (
              <span className="font-mono text-[8px] font-black text-amber-500 uppercase tracking-widest animate-pulse">
                {degradedCapabilitiesCount} Degraded
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[8px] font-mono leading-none pt-0.5">
            {Object.values(capabilities).map(cap => {
              let badgeColor = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
              let dotColor = 'bg-emerald-500';
              
              if (cap.state === 'unavailable') {
                badgeColor = 'bg-rose-500/10 text-rose-500 border-rose-500/20';
                dotColor = 'bg-rose-500';
              } else if (cap.state === 'degraded' || cap.state === 'demo_only') {
                badgeColor = 'bg-amber-500/10 text-amber-500 border-amber-500/20';
                dotColor = 'bg-amber-500';
              }
              
              return (
                <div 
                  key={cap.name} 
                  className={`flex items-center gap-1.5 px-1.5 py-1 border rounded-lg transition-colors ${badgeColor}`}
                  title={cap.reason || `${cap.name} is fully operational`}
                >
                  <span className={`w-1 h-1 rounded-full shrink-0 ${dotColor} ${cap.state === 'degraded' ? 'animate-pulse' : ''}`}></span>
                  <span className="capitalize font-black text-[7px] truncate max-w-[70px]">
                    {cap.name.replace('-', ' ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Provider Telemetry */}
        {providerHealth.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1">
            <span className="font-bold text-slate-400 uppercase tracking-wider text-[8px]">Provider Telemetry:</span>
            {providerHealth.map((h, idx) => (
              <div key={idx} className="flex justify-between items-center font-mono text-[8px] leading-tight">
                <span className="text-slate-400 capitalize">{h.provider}:</span>
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  {h.latency_ms.toFixed(0)}ms | err: {(h.error_rate * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Divergence Alerts */}
        {discrepancies.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-rose-100 dark:border-rose-900/40 space-y-1 text-rose-500">
            <div className="flex items-center gap-1 font-bold text-[8px] uppercase tracking-wider">
              <AlertCircle size={10} />
              <span>Divergence Alerts:</span>
            </div>
            <div className="space-y-1 font-mono text-[7.5px] max-h-16 overflow-y-auto leading-normal">
              {discrepancies.map((d, idx) => (
                <div key={idx} className="flex justify-between border-b border-rose-500/5 pb-0.5">
                  <span className="truncate max-w-[100px]">{d.canonical_id.split(":")[1] || d.canonical_id}:</span>
                  <span className="font-black">{(d.delta * 100).toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Retry Connection Button */}
        {degradedCapabilitiesCount > 0 && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              resetAll();
              
              window.dispatchEvent(new CustomEvent('app-toast', {
                detail: {
                  message: 'Re-probing API connections and resetting degraded capabilities...',
                  type: 'info',
                  duration: 4000
                }
              }));
              
              try {
                await upstoxAuthService.checkHealth();
              } catch (err) {
                console.warn('Re-probing failed:', err);
              }
            }}
            className="w-full mt-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1 cursor-pointer active:scale-95"
          >
            <RefreshCw size={10} className="animate-spin-slow" />
            Retry Connection
          </button>
        )}
      </div>
    </div>
  );
};
