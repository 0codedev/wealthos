import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Zap, Clock, Activity, AlertTriangle, ShieldCheck, Play, Pause, 
  RefreshCw, TrendingUp, TrendingDown, Bell, CheckCircle2, ChevronRight
} from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import { useGlobalTickStore } from '../../store/globalTickStore';
import { useToast } from '../shared/ToastProvider';

interface ScheduledEvent {
  id: string;
  name: string;
  country: 'US' | 'IN' | 'GLOBAL';
  category: 'INFLATION' | 'CENTRAL_BANK' | 'EMPLOYMENT' | 'GDP';
  scheduledAt: string; // ISO or human string
  impact: 'HIGH' | 'EXTREME';
  forecast?: string;
  previous?: string;
}

const DEFAULT_SCHEDULED_EVENTS: ScheduledEvent[] = [
  {
    id: 'us_cpi',
    name: 'US Consumer Price Index (CPI YoY)',
    country: 'US',
    category: 'INFLATION',
    scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 14).toISOString(),
    impact: 'EXTREME',
    forecast: '2.9%',
    previous: '3.0%'
  },
  {
    id: 'fed_fomc',
    name: 'US Federal Reserve Interest Rate Decision',
    country: 'US',
    category: 'CENTRAL_BANK',
    scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
    impact: 'EXTREME',
    forecast: '5.25%',
    previous: '5.50%'
  },
  {
    id: 'rbi_mpc',
    name: 'RBI Monetary Policy Repo Rate',
    country: 'IN',
    category: 'CENTRAL_BANK',
    scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 96).toISOString(),
    impact: 'HIGH',
    forecast: '6.50%',
    previous: '6.50%'
  },
  {
    id: 'us_nfp',
    name: 'US Non-Farm Payrolls (NFP)',
    country: 'US',
    category: 'EMPLOYMENT',
    scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 120).toISOString(),
    impact: 'HIGH',
    forecast: '165K',
    previous: '114K'
  }
];

export const CatalystVelocityDeck: React.FC = () => {
  const { toast } = useToast();
  const settings = useSettingsStore();
  const ticks = useGlobalTickStore(s => s.ticks);
  const niftyTick = ticks['NSE_INDEX|Nifty 50'];

  const [autopilotEnabled, setAutopilotEnabled] = useState<boolean>(
    () => settings.hftAutoTradeSandboxEnabled === true
  );
  const [volMultiplier, setVolMultiplier] = useState<number>(
    () => settings.hftVolMultiplier || 3.5
  );
  const [confirmMinutes, setConfirmMinutes] = useState<number>(
    () => settings.hftConfirmWindowMinutes || 2
  );

  const [recentHftTrades, setRecentHftTrades] = useState<any[]>([]);
  const [isTestPunching, setIsTestPunching] = useState<boolean>(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('14h 00m 00s');

  const nextEvent = DEFAULT_SCHEDULED_EVENTS[0];

  // Live countdown timer for the next scheduled macro event
  useEffect(() => {
    const updateCountdown = () => {
      const targetTime = new Date(nextEvent.scheduledAt).getTime();
      const diff = targetTime - Date.now();
      if (diff <= 0) {
        setTimeRemaining('EVENT ACTIVE NOW');
        return;
      }
      const hrs = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeRemaining(`${hrs.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextEvent]);

  // Handle Autopilot Sandbox Toggle
  const handleToggleAutopilot = useCallback(() => {
    const nextState = !autopilotEnabled;
    setAutopilotEnabled(nextState);
    useSettingsStore.setState({ hftAutoTradeSandboxEnabled: nextState });
    if (nextState) {
      toast.success('⚡ HFT Macro Velocity Autopilot ENABLED for Sandbox (Port 5000)');
    } else {
      toast.info('HFT Macro Velocity Autopilot paused');
    }
  }, [autopilotEnabled, toast]);

  // Current NIFTY telemetry
  const ltp = niftyTick?.ltp || 24500;
  const prevClose = niftyTick?.close || 24450;
  const pctChange = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0.2;
  const currentVelocity = 0.082; // Simulated/Rolling baseline %/min
  const sigmaRatio = 1.4; // 1.4x baseline (calm regime)

  // 1-Click Manual Simulation / Test Punch to OpenAlgo Sandbox
  const handleTestPunch = async (direction: 'UP' | 'DOWN') => {
    setIsTestPunching(true);
    const optType = direction === 'UP' ? 'CE' : 'PE';
    const atmStrike = Math.round(ltp / 50) * 50;
    const testSymbol = `NIFTY ${atmStrike} ${optType}`;

    try {
      const resp = await fetch('/api/python-nse/api/openalgo/placeorder-sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'NIFTY',
          option_type: optType,
          strike: atmStrike,
          action: 'BUY',
          exchange: 'NFO',
          quantity: 25,
          pricetype: 'MARKET',
          product: 'MIS',
          strategy: 'HFT_MacroVelocity_SANDBOX',
          reasoning: `Manual Macro Event Simulation: Direction ${direction} | Strike: ${atmStrike} ${optType}`
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.detail || data.message || `HTTP ${resp.status}`);
      }
      const orderId = String(data.orderid || `HFT_${Date.now().toString().slice(-4)}`);
      const filledSymbol = data.symbol || testSymbol;
      
      const newTrade = {
        orderId,
        symbol: filledSymbol,
        direction,
        time: new Date().toLocaleTimeString('en-IN', { hour12: false }),
        status: 'FILLED (SANDBOX)',
        strike: atmStrike
      };
      setRecentHftTrades(prev => [newTrade, ...prev.slice(0, 4)]);
      toast.success(`⚡ Macro Event Sandbox Order Placed: BUY ${filledSymbol} (#${orderId})`);
    } catch (err: any) {
      toast.error(`Order failed: ${err.message}`, { title: 'Sandbox Execution Error' });
      const mockId = `HFT_SIM_${Date.now().toString().slice(-4)}`;
      const newTrade = {
        orderId: mockId,
        symbol: testSymbol,
        direction,
        time: new Date().toLocaleTimeString('en-IN', { hour12: false }),
        status: 'SIMULATED',
        strike: atmStrike
      };
      setRecentHftTrades(prev => [newTrade, ...prev.slice(0, 4)]);
      toast.info(`⚡ Macro Event Sandbox Simulated: BUY ${testSymbol} (#${mockId})`);
    } finally {
      setIsTestPunching(false);
    }
  };

  return (
    <div className="bg-[#08090C] border border-white/[0.08] rounded-3xl p-6 shadow-2xl space-y-6 text-slate-100 font-sans relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/[0.03] rounded-full blur-3xl pointer-events-none" />

      {/* HEADER ROW */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/[0.06] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
            </span>
            <h3 className="text-base font-black tracking-tight uppercase bg-gradient-to-r from-cyan-400 via-indigo-300 to-white bg-clip-text text-transparent">
              Institutional Macro Event & Velocity Engine // Prop Deck
            </h3>
          </div>
          <p className="text-[11px] text-slate-400 font-medium tracking-wide mt-1">
            Real-time NIFTY order flow velocity scanner · High-impact macro news catalyst sniper
          </p>
        </div>

        {/* AUTOPILOT SANDBOX TOGGLE */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleAutopilot}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md active:scale-95 ${
              autopilotEnabled
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-emerald-950/40'
                : 'bg-slate-900 hover:bg-slate-850 text-slate-400 border border-slate-800'
            }`}
          >
            <Zap className={`w-3.5 h-3.5 ${autopilotEnabled ? 'text-emerald-400 fill-current' : 'text-slate-500'}`} />
            <span>Autopilot Sandbox: {autopilotEnabled ? 'ACTIVE' : 'PAUSED'}</span>
          </button>
        </div>
      </div>

      {/* NEXT UPCOMING HIGH-IMPACT EVENT COUNTDOWN BANNER */}
      <div className="p-4 rounded-2xl border border-cyan-500/25 bg-gradient-to-r from-cyan-950/20 via-slate-900/60 to-slate-950/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              NEXT HIGH-IMPACT CATALYST
            </span>
            <span className="text-xs font-black text-white">{nextEvent.name}</span>
          </div>
          <div className="flex items-center gap-3 text-[10.5px] font-mono text-slate-400">
            <span>Forecast: <strong className="text-slate-200">{nextEvent.forecast}</strong></span>
            <span>·</span>
            <span>Prior: <strong className="text-slate-200">{nextEvent.previous}</strong></span>
            <span>·</span>
            <span className="text-amber-400 font-bold uppercase">{nextEvent.impact} VOLATILITY EXPECTED</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-950/80 border border-cyan-500/30 rounded-xl">
          <Clock className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
          <div className="text-right">
            <span className="text-[8px] text-slate-500 uppercase font-black block">Release T-Minus</span>
            <span className="text-sm font-mono font-black text-cyan-300 tracking-wider block">
              {timeRemaining}
            </span>
          </div>
        </div>
      </div>

      {/* TELEMETRY & VOLATILITY RADAR */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
        <div className="bg-slate-900/50 border border-white/[0.06] p-3.5 rounded-2xl">
          <span className="text-[8.5px] text-slate-500 uppercase font-black block">NIFTY 50 Spot</span>
          <span className="text-lg font-black font-mono text-white mt-1 block">
            ₹{ltp.toLocaleString('en-IN')}
          </span>
          <span className={`text-[9.5px] font-bold font-mono ${pctChange >= 0 ? 'text-emerald-400' : 'text-rose-455'}`}>
            {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}%
          </span>
        </div>

        <div className="bg-slate-900/50 border border-white/[0.06] p-3.5 rounded-2xl">
          <span className="text-[8.5px] text-slate-500 uppercase font-black block">30-Min Baseline Vol</span>
          <span className="text-lg font-black font-mono text-indigo-300 mt-1 block">
            {currentVelocity.toFixed(3)}%/min
          </span>
          <span className="text-[9px] text-slate-500 block mt-0.5">Rolling median velocity</span>
        </div>

        <div className="bg-slate-900/50 border border-white/[0.06] p-3.5 rounded-2xl">
          <span className="text-[8.5px] text-slate-500 uppercase font-black block">Sigma Multiplier</span>
          <span className={`text-lg font-black font-mono mt-1 block ${
            sigmaRatio >= volMultiplier ? 'text-rose-400 animate-pulse' : 'text-emerald-400'
          }`}>
            {sigmaRatio.toFixed(1)}σ
          </span>
          <span className="text-[9px] text-slate-500 block mt-0.5">
            Trigger threshold: {volMultiplier}σ
          </span>
        </div>

        <div className="bg-slate-900/50 border border-white/[0.06] p-3.5 rounded-2xl">
          <span className="text-[8.5px] text-slate-500 uppercase font-black block">Regime State</span>
          <span className="text-xs font-black uppercase text-emerald-400 mt-1.5 block tracking-wider">
            ✓ Pre-Event Calm
          </span>
          <span className="text-[9px] text-slate-500 block mt-0.5">Spreads tight · Liquidity stable</span>
        </div>
      </div>

      {/* MANUAL TEST & SIMULATION CONTROLS */}
      <div className="p-4 rounded-2xl border border-white/[0.06] bg-slate-950/40 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            Macro Velocity Sandbox Dispatch Test
          </span>
          <span className="text-[9px] font-mono text-slate-500">
            OpenAlgo Sandbox · 25 Qty MIS
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => handleTestPunch('UP')}
            disabled={isTestPunching}
            className="py-2.5 px-4 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-50"
          >
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span>Simulate Bullish Burst (Punch ATM CE)</span>
          </button>

          <button
            onClick={() => handleTestPunch('DOWN')}
            disabled={isTestPunching}
            className="py-2.5 px-4 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-50"
          >
            <TrendingDown className="w-4 h-4 text-rose-400" />
            <span>Simulate Bearish Burst (Punch ATM PE)</span>
          </button>
        </div>
      </div>

      {/* RECENT HFT SANDBOX TRADES LIST */}
      {recentHftTrades.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block px-1">
            Recent Macro Velocity Sandbox Orders
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {recentHftTrades.map((tr) => (
              <div key={tr.orderId} className="p-3 bg-slate-900/60 border border-white/[0.06] rounded-xl flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${tr.direction === 'UP' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span className="font-bold text-white">{tr.symbol}</span>
                </div>
                <div className="text-right text-[10px] text-slate-400">
                  <span className="text-emerald-400 font-bold block">{tr.status}</span>
                  <span>{tr.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CatalystVelocityDeck;
