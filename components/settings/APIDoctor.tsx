import React, { useEffect, useState } from 'react';
import { useCapabilityStore, CapabilityName, CapabilityState } from '../../store/capabilityStore';
import { upstoxWebSocketService, WSHealthMetrics } from '../../services/UpstoxWebSocketService';
import { 
  Activity, 
  Cpu, 
  RefreshCw, 
  KeyRound, 
  Wifi, 
  WifiOff, 
  AlertTriangle, 
  CheckCircle2, 
  Database,
  Terminal,
  Server,
  Plus,
  ShieldAlert
} from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import { upstoxAccountService } from '../../services/UpstoxAccountService';
import MarketCalendarWidget from '../market/MarketCalendarWidget';
import { ProductionHealthDashboard } from '../system/ProductionHealthDashboard';

export const APIDoctor: React.FC = () => {
  const { toast } = useToast();
  const capStore = useCapabilityStore();
  const [healthSummary, setHealthSummary] = useState<any>(null);
  const [wsMetrics, setWsMetrics] = useState<WSHealthMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReprobing, setIsReprobing] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [expandedSubs, setExpandedSubs] = useState(false);
  const [ipWhitelist, setIpWhitelist] = useState<string[]>([]);
  const [newIp, setNewIp] = useState('');
  const [isUpdatingIp, setIsUpdatingIp] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const [killSwitchActive, setKillSwitchActive] = useState<boolean | null>(null);
  const [isTogglingKs, setIsTogglingKs] = useState(false);
  const [ksAck, setKsAck] = useState(false);

  const loadKillSwitch = async () => {
    try {
      const res = await upstoxAccountService.fetchKillSwitchStatus();
      if (res && res.status === 'success' && res.data) {
        setKillSwitchActive(res.data.kill_switch_active);
      }
    } catch (err) {
      console.error('Failed to load Kill Switch status:', err);
    }
  };

  const handleToggleKillSwitch = async () => {
    if (killSwitchActive === null) return;
    setIsTogglingKs(true);
    try {
      const nextState = killSwitchActive ? 'deactivate' : 'activate';
      const res = await upstoxAccountService.toggleKillSwitch(nextState);
      if (res && res.status === 'success') {
        toast.success(`Kill Switch ${killSwitchActive ? 'deactivated' : 'activated'} successfully.`);
        setKillSwitchActive(!killSwitchActive);
        setKsAck(false);
      } else {
        toast.error(res?.message || 'Failed to toggle Kill Switch.');
      }
    } catch (err) {
      toast.error('Failed to toggle Kill Switch.');
    } finally {
      setIsTogglingKs(false);
    }
  };

  const loadIpWhitelist = async () => {
    try {
      const res = await upstoxAccountService.fetchIpWhitelist();
      if (res && res.status === 'success' && res.data) {
        setIpWhitelist(res.data.ip || []);
      }
    } catch (err) {
      console.error('Failed to load IP whitelist:', err);
    }
  };

  const handleAddIp = () => {
    const clean = newIp.trim();
    if (!clean) return;
    if (ipWhitelist.includes(clean)) {
      toast.error('IP address already in list.');
      return;
    }
    if (!/^[0-9a-fA-F.:]+$/.test(clean)) {
      toast.error('Invalid IP address format.');
      return;
    }
    setIpWhitelist([...ipWhitelist, clean]);
    setNewIp('');
  };

  const handleRemoveIp = (ip: string) => {
    setIpWhitelist(ipWhitelist.filter(x => x !== ip));
  };

  const saveIpWhitelist = async () => {
    setIsUpdatingIp(true);
    try {
      const res = await upstoxAccountService.updateIpWhitelist(ipWhitelist);
      if (res && res.status === 'success') {
        toast.success('IP Whitelist updated successfully.');
        setAcknowledged(false);
      } else {
        toast.error(res?.message || 'Failed to update IP Whitelist.');
      }
    } catch (err) {
      toast.error('Failed to update IP Whitelist.');
    } finally {
      setIsUpdatingIp(false);
    }
  };

  const fetchHealthSummary = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/python-nse/api/upstox/health-summary');
      if (response.ok) {
        const data = await response.json();
        setHealthSummary(data);
      }
    } catch (err: unknown) {
      console.error('Failed to fetch health summary:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReprobe = async () => {
    setIsReprobing(true);
    try {
      await capStore.hydrateCapabilities();
      await fetchHealthSummary();
      toast.success('System capabilities re-probed successfully.');
    } catch (err) {
      toast.error('Failed to re-probe system capabilities.');
    } finally {
      setIsReprobing(false);
    }
  };

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      const response = await fetch('/api/python-nse/api/upstox/cache/clear', { method: 'POST' });
      if (response.ok) {
        toast.success('Upstox Cache successfully cleared.');
        fetchHealthSummary();
      } else {
        toast.error('Failed to clear cache.');
      }
    } catch (err) {
      toast.error('Failed to clear cache due to network error.');
    } finally {
      setIsClearingCache(false);
    }
  };

  // Poll health summary every 15s
  useEffect(() => {
    fetchHealthSummary();
    loadIpWhitelist();
    loadKillSwitch();
    const interval = setInterval(fetchHealthSummary, 15000);
    return () => clearInterval(interval);
  }, []);

  // Poll WebSocket metrics every 1s
  useEffect(() => {
    const updateWS = () => {
      setWsMetrics(upstoxWebSocketService.getHealthMetrics());
    };
    updateWS();
    const interval = setInterval(updateWS, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatLastTick = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const diff = Date.now() - timestamp;
    if (diff < 1000) return 'Just now';
    return `${Math.round(diff / 1000)}s ago`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'green':
      case 'available':
        return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'yellow':
      case 'degraded':
      case 'warning':
        return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'red':
      case 'unavailable':
      case 'error':
        return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      case 'demo_only':
      case 'blue':
        return 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20';
      default:
        return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  const getCapabilityDot = (state: CapabilityState) => {
    switch (state) {
      case 'available':
        return '🟢';
      case 'degraded':
        return '🟡';
      case 'unavailable':
        return '🔴';
      case 'demo_only':
        return '🔵';
      default:
        return '⚪';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-orange-500 animate-pulse" />
          <h3 className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">Upstox API Diagnostics (API Doctor)</h3>
        </div>
        <button
          onClick={fetchHealthSummary}
          disabled={isLoading}
          className="p-2 text-slate-400 hover:text-orange-500 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-30"
          title="Refresh summary"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Health Overview Banner */}
      {healthSummary && (
        <div className={`rounded-3xl p-5 border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r ${
          healthSummary.status === 'green' 
            ? 'from-emerald-50 via-white to-emerald-50 dark:from-emerald-950/10 dark:via-slate-900 dark:to-emerald-950/10 border-emerald-500/20' 
            : healthSummary.status === 'yellow'
            ? 'from-amber-50 via-white to-amber-50 dark:from-amber-950/10 dark:via-slate-900 dark:to-amber-950/10 border-amber-500/20'
            : 'from-rose-50 via-white to-rose-50 dark:from-rose-950/10 dark:via-slate-900 dark:to-rose-950/10 border-rose-500/20'
        }`}>
          <div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${getStatusColor(healthSummary.status)}`}>
                System Status: {healthSummary.status}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                Last checked: {new Date().toLocaleTimeString()}
              </span>
            </div>
            <h4 className="mt-2 text-base font-bold text-slate-900 dark:text-white">
              {healthSummary.status === 'green' && 'All vital market intelligence systems operating at 100% efficiency.'}
              {healthSummary.status === 'yellow' && 'Subsystems running degraded. Backtester fallback active.'}
              {healthSummary.status === 'red' && 'Upstox connection offline. Interactive re-auth required.'}
            </h4>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Dhan remains the execution master. Upstox is running in a read-only analytics lane.
            </p>
          </div>
          <button
            onClick={handleReprobe}
            disabled={isReprobing}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-950 dark:bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-850 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 active:scale-95"
          >
            {isReprobing ? <RefreshCw size={12} className="animate-spin" /> : <Server size={12} />}
            Re-probe API
          </button>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* WebSocket Health Panel */}
        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {wsMetrics?.isConnected ? (
                <Wifi size={16} className="text-emerald-500 animate-pulse" />
              ) : (
                <WifiOff size={16} className="text-rose-500" />
              )}
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">WebSocket Stream Health</h4>
            </div>
            {wsMetrics && (
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                wsMetrics.isConnected ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'
              }`}>
                {wsMetrics.isConnected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
            )}
          </div>

          {wsMetrics && (
            <div className="grid grid-cols-2 gap-4 mt-2">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/40 p-3">
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Ticks Received</span>
                <span className="text-lg font-black text-slate-800 dark:text-white block mt-1">{wsMetrics.ticksReceived.toLocaleString()}</span>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/40 p-3">
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Last Tick At</span>
                <span className="text-lg font-black text-slate-800 dark:text-white block mt-1">{formatLastTick(wsMetrics.lastTickAt)}</span>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/40 p-3">
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Active Subs</span>
                <span className="text-lg font-black text-slate-800 dark:text-white block mt-1">{wsMetrics.subscriptionCount} / 200</span>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/40 p-3">
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Reconnects</span>
                <span className="text-lg font-black text-slate-800 dark:text-white block mt-1">{wsMetrics.reconnectCount}</span>
              </div>
            </div>
          )}

          {wsMetrics && wsMetrics.subscriptionCount > 0 && (
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <button 
                onClick={() => setExpandedSubs(!expandedSubs)}
                className="w-full flex items-center justify-between text-xs text-slate-500 font-bold uppercase tracking-wider hover:text-orange-500 transition-colors"
              >
                <span>Subscriptions List ({wsMetrics.subscriptionCount})</span>
                <span>{expandedSubs ? 'Collapse' : 'Expand'}</span>
              </button>
              {expandedSubs && (
                <div className="mt-2 max-h-32 overflow-y-auto pr-1 text-xs font-mono space-y-1 mt-3">
                  {wsMetrics.subscriptions.map((sub) => (
                    <div key={sub} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1 last:border-none">
                      <span className="text-slate-700 dark:text-slate-300 truncate">{sub}</span>
                      <span className="text-[9px] font-black uppercase text-indigo-500 bg-indigo-500/10 px-1.5 py-0.5 rounded">{wsMetrics.keyModes[sub] || 'full'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rate Limits & Cache Panel */}
        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-indigo-500" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">API Budget & Cache</h4>
            </div>
          </div>

          {healthSummary?.rate_limit && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400 font-medium">Rate Limit Usage (Minute):</span>
                  <span className="font-bold text-slate-800 dark:text-white">{healthSummary.rate_limit.minute_usage} / {healthSummary.rate_limit.minute_limit}</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-850 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      (healthSummary.rate_limit.minute_usage / healthSummary.rate_limit.minute_limit) > 0.85 
                        ? 'bg-rose-500' 
                        : (healthSummary.rate_limit.minute_usage / healthSummary.rate_limit.minute_limit) > 0.60 
                        ? 'bg-amber-500' 
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min((healthSummary.rate_limit.minute_usage / healthSummary.rate_limit.minute_limit) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400 font-medium">Rate Limit Usage (30-Minute):</span>
                  <span className="font-bold text-slate-800 dark:text-white">{healthSummary.rate_limit.thirty_minute_usage} / {healthSummary.rate_limit.thirty_minute_limit}</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-850 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      (healthSummary.rate_limit.thirty_minute_usage / healthSummary.rate_limit.thirty_minute_limit) > 0.85 
                        ? 'bg-rose-500' 
                        : (healthSummary.rate_limit.thirty_minute_usage / healthSummary.rate_limit.thirty_minute_limit) > 0.60 
                        ? 'bg-amber-500' 
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min((healthSummary.rate_limit.thirty_minute_usage / healthSummary.rate_limit.thirty_minute_limit) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>
          )}

          {healthSummary?.cache && (
            <div className="pt-2 flex items-center justify-between gap-4 border-t border-slate-100 dark:border-slate-800 mt-2">
              <div>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Local Cache Cache Size</span>
                <span className="text-base font-black text-slate-800 dark:text-white block mt-1">{healthSummary.cache.total_items} Items</span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">{healthSummary.cache.stale_items} stale / {healthSummary.cache.fresh_items} fresh</span>
              </div>
              <button
                onClick={handleClearCache}
                disabled={isClearingCache || healthSummary.cache.total_items === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white rounded-xl text-[10px] font-bold transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 shrink-0"
              >
                <Trash2Icon size={12} />
                Purge Cache
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Capabilities & Token Status row */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Token Modes Status */}
        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-orange-500" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Access Tokens & Modes</h4>
          </div>

          {healthSummary && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <div>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Daily Login OAuth Token</span>
                  <span className="text-[10px] text-slate-450 mt-0.5 block leading-relaxed">Required for smartlists and live orders checks</span>
                </div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                  healthSummary.interactive_token_active ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'
                }`}>
                  {healthSummary.interactive_token_active ? 'ACTIVE' : 'MISSING'}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5 last:border-none last:pb-0">
                <div>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">1-Year Analytics Token</span>
                  <span className="text-[10px] text-slate-450 mt-0.5 block leading-relaxed">Fallback for quotes, fundamentals and charts</span>
                </div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                  healthSummary.analytics_token_active ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'
                }`}>
                  {healthSummary.analytics_token_active ? 'ACTIVE' : 'MISSING'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Capability Grid */}
        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none space-y-4">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-indigo-500" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">API Subsystem Capabilities</h4>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            {(Object.keys(capStore.capabilities) as CapabilityName[]).map((name) => {
              const cap = capStore.capabilities[name];
              return (
                <div key={name} className="flex items-center justify-between p-2 rounded-xl border border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/40">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 capitalize">{name.replace('-', ' ')}</span>
                  <span className="text-xs font-bold flex items-center gap-1" title={cap.reason || 'Running smoothly'}>
                    {getCapabilityDot(cap.state)}
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">{cap.state.replace('_', ' ')}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Errors & Event Logging */}
      {healthSummary?.last_errors && (
        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none space-y-4">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-slate-400" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Diagnostic Error Log (Last 5 Events)</h4>
          </div>
          <div className="rounded-2xl border border-slate-150 bg-slate-950 p-4 font-mono text-xs text-slate-300 max-h-48 overflow-y-auto space-y-3">
            {healthSummary.last_errors.length === 0 ? (
              <p className="text-emerald-400 font-bold">No errors logged. All subsystems operating cleanly.</p>
            ) : (
              healthSummary.last_errors.map((err: any, index: number) => (
                <div key={index} className="border-b border-slate-800 pb-2 last:border-none last:pb-0 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className="text-amber-500 font-bold">{err.endpoint}</span>
                    <span>{new Date(err.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-slate-300 break-words leading-relaxed">{err.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Emergency Kill Switch Card */}
        <div className="rounded-[28px] border border-rose-500/30 bg-rose-50/5 dark:bg-rose-950/5 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-rose-500">
              <ShieldAlert size={16} />
              <h4 className="text-sm font-bold uppercase tracking-wider">Emergency Kill Switch</h4>
            </div>
            <button
              onClick={loadKillSwitch}
              disabled={isTogglingKs}
              className="p-1 hover:bg-slate-105 dark:hover:bg-slate-800 rounded transition-colors"
              title="Reload Kill Switch"
            >
              <RefreshCw size={12} className={isTogglingKs ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              Instantly halt all automated and manual trading capability via Upstox API. This is a security feature to stop runs or clear out exposures immediately.
            </p>

            <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950/40 rounded-xl">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Kill Switch Status</span>
              <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                killSwitchActive === null ? 'bg-slate-500/15 text-slate-500' :
                killSwitchActive ? 'bg-rose-500/15 text-rose-500 animate-pulse' : 'bg-emerald-500/15 text-emerald-600'
              }`}>
                {killSwitchActive === null ? 'UNKNOWN' : killSwitchActive ? 'ACTIVE (TRADING HALTED)' : 'INACTIVE (TRADING ALLOWED)'}
              </span>
            </div>

            <div className="pt-2 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ack-kill-switch"
                  checked={ksAck}
                  onChange={(e) => setKsAck(e.target.checked)}
                  className="rounded border-slate-300 text-rose-650 focus:ring-rose-500 dark:bg-slate-950"
                />
                <label htmlFor="ack-kill-switch" className="text-[10px] text-slate-500 font-bold select-none cursor-pointer">
                  I understand this will halt all trading capability.
                </label>
              </div>

              <button
                onClick={handleToggleKillSwitch}
                disabled={isTogglingKs || !ksAck || killSwitchActive === null}
                className={`w-full py-2 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-30 active:scale-95 ${
                  killSwitchActive ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                {isTogglingKs ? 'Processing...' : killSwitchActive ? 'Deactivate Kill Switch' : 'Activate Kill Switch'}
              </button>
            </div>
          </div>
        </div>

        {/* IP Whitelist Card */}
        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert size={16} className="text-emerald-500" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Upstox IP Whitelist</h4>
            </div>
            <button
              onClick={loadIpWhitelist}
              disabled={isUpdatingIp}
              className="p-1 hover:bg-slate-105 dark:hover:bg-slate-800 rounded transition-colors"
              title="Reload Whitelist"
            >
              <RefreshCw size={12} className={isUpdatingIp ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              Configure approved public IP addresses allowed to communicate with the Upstox API.
            </p>

            <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
              {ipWhitelist.length === 0 ? (
                <div className="text-center py-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-400">
                  No active IP restrictions.
                </div>
              ) : (
                ipWhitelist.map((ip) => (
                  <div key={ip} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-950/40 rounded-xl text-xs font-mono">
                    <span className="text-slate-700 dark:text-slate-300">{ip}</span>
                    <button
                      onClick={() => handleRemoveIp(ip)}
                      className="text-slate-400 hover:text-rose-500 transition-colors"
                      title="Remove IP"
                    >
                      <Trash2Icon size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. 192.168.1.1"
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-50 border border-slate-200/80 focus:outline-none focus:border-indigo-500 dark:bg-slate-950/40 dark:border-slate-800 dark:text-white font-mono"
              />
              <button
                onClick={handleAddIp}
                className="px-3 py-1.5 bg-slate-950 dark:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1"
              >
                <Plus size={12} /> Add
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3 text-[10px] text-amber-600 dark:text-amber-500">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>Safety Check:</strong> Deleting your current IP will instantly lock this server out of the Upstox API. Verify that your current device public IP is included.
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ack-lockout"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-650 focus:ring-indigo-500 dark:bg-slate-950"
                />
                <label htmlFor="ack-lockout" className="text-[10px] text-slate-500 font-bold select-none cursor-pointer">
                  I understand the risk of lock-out.
                </label>
              </div>

              <button
                onClick={saveIpWhitelist}
                disabled={isUpdatingIp || !acknowledged}
                className="w-full py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-500 transition-all disabled:opacity-30 active:scale-95"
              >
                {isUpdatingIp ? 'Saving...' : 'Save Whitelist'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Automated Error Diagnostics & Production Health Stability Monitor */}
      <ProductionHealthDashboard />

      {/* Market Calendar & Holiday Timings */}
      <MarketCalendarWidget />
    </div>
  );
};

// Reusable simple Trash Icon to avoid missing icon import
const Trash2Icon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
);
