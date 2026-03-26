import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { logger } from '../../utils/logger';
import { 
  Trophy, User, Cpu, Lock, ArrowUpRight, ArrowDownRight, 
  RefreshCw, CheckCircle, XCircle, Clock, Zap, Calendar, Play, LogOut, History, Minus, Plus
} from 'lucide-react';
import { quantDuelService, DuelScorecard } from '../../services/backtester/QuantDuelService';
import { ForwardDuel, db } from '../../database';
import { alphaEngineService } from '../../services/AlphaEngineService';
import { formatCurrency } from '../../utils/helpers';
import { formatCurrencySigned } from '../../utils/helpers';

const NumericInput: React.FC<{
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  step?: number;
}> = ({ value, onChange, placeholder, label, className = '', step = 0.05 }) => {
  const handleStep = (delta: number) => {
    const current = parseFloat(value) || 0;
    onChange((current + delta).toFixed(2));
  };

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase ml-1">{label}</label>}
      <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-inner group focus-within:border-indigo-500/50 transition-colors">
        <button
          type="button"
          onClick={() => handleStep(-step)}
          className="px-2 py-2 text-slate-400 hover:text-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all border-r border-slate-100 dark:border-slate-800"
        >
          <Minus size={12} />
        </button>
        <input
          type="number"
          inputMode="decimal"
          step={step}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-transparent px-3 py-2 text-xs text-slate-900 dark:text-slate-200 outline-none font-mono font-bold text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => handleStep(step)}
          className="px-2 py-2 text-slate-400 hover:text-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all border-l border-slate-100 dark:border-slate-800"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
};

const QuantDuelPanel: React.FC = () => {
  const [todayDuel, setTodayDuel] = useState<ForwardDuel | null>(null);
  const [scorecard, setScorecard] = useState<DuelScorecard | null>(null);
  const [history, setHistory] = useState<ForwardDuel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selector for model timing
  const [modelTime, setModelTime] = useState<'09:50' | '10:30' | '11:00'>(
    (localStorage.getItem('alpha_duel_model_time') as any) || '09:50'
  );

  // Form states for user selection
  const [userTicker, setUserTicker] = useState('');
  const [userEntryPrice, setUserEntryPrice] = useState('');
  const [userStopLoss, setUserStopLoss] = useState('');
  const [userTarget, setUserTarget] = useState('');

  // Early exit modal
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitPriceInput, setExitPriceInput] = useState('');

  // Manual resolution form states (Fail-safe)
  const [showManualForm, setShowManualForm] = useState(false);
  const [sysHigh, setSysHigh] = useState('');
  const [sysLow, setSysLow] = useState('');
  const [sysClose, setSysClose] = useState('');
  const [usrHigh, setUsrHigh] = useState('');
  const [usrLow, setUsrLow] = useState('');
  const [usrClose, setUsrClose] = useState('');

  // Manual system pick inputs (override option)
  const [sysTickerInput, setSysTickerInput] = useState('');
  const [sysEntryInput, setSysEntryInput] = useState('');

  // Live telemetry prices
  const [liveSysPrice, setLiveSysPrice] = useState<number | null>(null);
  const [liveUsrPrice, setLiveUsrPrice] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  // Auto-suggest user SL/TP based on 1:2 R:R when Ticker/Entry changes
  useEffect(() => {
    const entry = parseFloat(userEntryPrice);
    if (!isNaN(entry) && entry > 0 && userTicker) {
      const stocks = alphaEngineService.getCachedStocks();
      const match = stocks.find(s => s.symbol === userTicker.toUpperCase());
      const atr = match?.atr || (entry * 0.03); // fallback to 3%
      const risk = Math.max(atr, entry * 0.008); // min 0.8% risk
      setUserStopLoss((entry - risk).toFixed(2));
      setUserTarget((entry + 2 * risk).toFixed(2));
    }
  }, [userEntryPrice, userTicker]);

  // Auto-trigger Quant Selection Hook
  useEffect(() => {
    const checkAndAutoTrigger = async () => {
      try {
        const today = await quantDuelService.getTodayDuel();
        if (today) {
          updateTelemetryPrices(today);
          return;
        }

        const now = new Date();
        const day = now.getDay();
        const isWeekday = day >= 1 && day <= 5;
        if (!isWeekday) return;

        const currentHours = now.getHours();
        const currentMins = now.getMinutes();
        const currentTimeVal = currentHours * 60 + currentMins;

        const [targetH, targetM] = modelTime.split(':').map(Number);
        const targetTimeVal = targetH * 60 + targetM;

        // Auto trigger only during active trading session after the selected timing
        if (currentTimeVal >= targetTimeVal && currentTimeVal < 15 * 60 + 30) {
          logger.log('QuantDuel', `Auto-triggering model pick for timing ${modelTime}...`);
          await handleAutoSelectSystemPick();
        }
      } catch (err) {
        console.error('Error auto-triggering selection:', err);
      }
    };

    checkAndAutoTrigger();
  }, [modelTime]);

  const updateTelemetryPrices = (duel: ForwardDuel | null) => {
    if (!duel) return;
    const cached = alphaEngineService.getCachedStocks();
    const sysStock = cached.find(s => s.symbol === duel.systemTicker);
    const usrStock = duel.userTicker ? cached.find(s => s.symbol === duel.userTicker) : null;
    
    if (sysStock) setLiveSysPrice(sysStock.lastPrice);
    if (usrStock) setLiveUsrPrice(usrStock.lastPrice);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const today = await quantDuelService.getTodayDuel();
      setTodayDuel(today);
      if (today) {
        updateTelemetryPrices(today);
        setExitPriceInput(today.userEntryPrice.toString());
      }
      
      const score = await quantDuelService.getScorecard();
      setScorecard(score);

      const hist = await quantDuelService.getDuelHistory();
      setHistory(hist);
    } catch (err) {
      console.error(err);
      setError('Failed to load duel data.');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoSelectSystemPick = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch current sectors to determine strongest bias
      const sectorScope = await alphaEngineService.fetchSectorScope(true);
      const sortedSectors = [...sectorScope]
        .filter(s => s.sector !== 'NIFTY 50' && s.sector !== 'SENSEX' && s.sector !== 'NIFTY MID SELECT')
        .sort((a, b) => b.percentChange - a.percentChange);

      if (sortedSectors.length === 0) {
        throw new Error("No active sector data found.");
      }

      // 2. Fetch FnO stocks
      let stocks = alphaEngineService.getCachedStocks();
      if (stocks.length === 0) {
        stocks = await alphaEngineService.fetchFnOStocks(true);
      }

      let topPick: any = null;

      // 3. Find top non-exhausted stock from the strongest sector
      for (const sectorObj of sortedSectors) {
        const sectorStocks = stocks.filter(s => s.sector === sectorObj.sector);
        // Prioritize positive breakouts with no fatigue/trap risks
        const cleanSetups = sectorStocks.filter(s => s.signal === 'Up' && !s.isExhausted && !s.isTrapRisk);
        if (cleanSetups.length > 0) {
          const sorted = [...cleanSetups].sort((a, b) => b.gFactor - a.gFactor);
          topPick = sorted[0];
          break;
        }
      }

      // Fallback 1: Search clean setups across all sectors
      if (!topPick) {
        const cleanSetups = stocks.filter(s => s.signal === 'Up' && !s.isExhausted && !s.isTrapRisk);
        if (cleanSetups.length > 0) {
          const sorted = [...cleanSetups].sort((a, b) => b.gFactor - a.gFactor);
          topPick = sorted[0];
        }
      }

      // Fallback 2: Any highest gFactor stock
      if (!topPick && stocks.length > 0) {
        const sorted = [...stocks].sort((a, b) => b.gFactor - a.gFactor);
        topPick = sorted[0];
      }

      if (!topPick) {
        throw new Error("Could not find a valid F&O stock setup.");
      }

      // Calculate 1:2 R:R limits
      const entryPrice = topPick.lastPrice;
      const atr = topPick.atr || (entryPrice * 0.03);
      const risk = Math.max(atr, entryPrice * 0.008);
      const stopLoss = parseFloat((entryPrice - risk).toFixed(2));
      const target = parseFloat((entryPrice + 2 * risk).toFixed(2));

      // Populate input states for visual confirmation
      setSysTickerInput(topPick.symbol);
      setSysEntryInput(entryPrice.toString());

      // Persist duel selection to database
      const duel = await quantDuelService.initializeTodayDuel(
        topPick.symbol,
        entryPrice,
        stopLoss,
        target,
        modelTime
      );
      setTodayDuel(duel);
      await loadData();
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to auto-select system pick.');
    } finally {
      setLoading(false);
    }
  };

  const handleInitSystemPick = async () => {
    if (!sysTickerInput || !sysEntryInput) return;
    try {
      const entryPrice = parseFloat(sysEntryInput);
      const stocks = alphaEngineService.getCachedStocks();
      const match = stocks.find(s => s.symbol === sysTickerInput.toUpperCase());
      const atr = match?.atr || (entryPrice * 0.03);
      const risk = Math.max(atr, entryPrice * 0.008);
      const stopLoss = parseFloat((entryPrice - risk).toFixed(2));
      const target = parseFloat((entryPrice + 2 * risk).toFixed(2));

      const duel = await quantDuelService.initializeTodayDuel(
        sysTickerInput, 
        entryPrice,
        stopLoss,
        target,
        modelTime
      );
      setTodayDuel(duel);
      loadData();
    } catch (err) {
      console.error(err);
      setError('Failed to initialize system pick.');
    }
  };

  const handleLockUserPick = async () => {
    if (!userTicker || !userEntryPrice) return;
    try {
      const entry = parseFloat(userEntryPrice);
      const slVal = userStopLoss ? parseFloat(userStopLoss) : parseFloat((entry * 0.992).toFixed(2));
      const tpVal = userTarget ? parseFloat(userTarget) : parseFloat((entry * 1.015).toFixed(2));

      const duel = await quantDuelService.lockUserSelection(
        userTicker,
        entry,
        slVal,
        tpVal
      );
      setTodayDuel(duel);
      loadData();
    } catch (err) {
      console.error(err);
      setError('Failed to lock your selection.');
    }
  };

  const handleUserEarlyExit = async () => {
    if (!todayDuel || !exitPriceInput) return;
    try {
      const exitPrice = parseFloat(exitPriceInput);
      const stopLoss = todayDuel.userStopLoss || (todayDuel.userEntryPrice * 0.992);
      const target = todayDuel.userTarget || (todayDuel.userEntryPrice * 1.015);
      
      const pnl = quantDuelService.calculateDuelPnL(
        todayDuel.userEntryPrice,
        exitPrice,
        stopLoss,
        target
      );

      const updated: ForwardDuel = {
        ...todayDuel,
        userStatus: 'EOD_EXIT',
        userExitPrice: exitPrice,
        userPeakPrice: Math.max(todayDuel.userPeakPrice, exitPrice),
        userTroughPrice: Math.min(todayDuel.userTroughPrice, exitPrice),
        userPnL: pnl
      };

      await db.forward_duels.put(updated);
      setTodayDuel(updated);
      setShowExitModal(false);
      await loadData();
    } catch (err) {
      console.error(err);
      setError('Failed to log manual exit.');
    }
  };

  const handleYahooResolve = async () => {
    setLoading(true);
    setError(null);
    try {
      await quantDuelService.resolveDuelWithYahoo();
      await loadData();
    } catch (err) {
      console.error(err);
      setError('Failed to resolve duel via Yahoo Finance. Try manual resolution.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualResolve = async () => {
    if (!sysHigh || !sysLow || !sysClose) return;
    try {
      await quantDuelService.resolveDuelManually(
        parseFloat(sysHigh),
        parseFloat(sysLow),
        parseFloat(sysClose),
        usrHigh ? parseFloat(usrHigh) : 0,
        usrLow ? parseFloat(usrLow) : 0,
        usrClose ? parseFloat(usrClose) : 0
      );
      setShowManualForm(false);
      await loadData();
    } catch (err) {
      console.error(err);
      setError('Failed to resolve duel manually.');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'TARGET_HIT':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1"><CheckCircle size={10} /> Target Hit (+40%)</span>;
      case 'STOP_HIT':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1"><XCircle size={10} /> Stop Hit (-20%)</span>;
      case 'EOD_EXIT':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center gap-1"><Clock size={10} /> EOD Exit</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1 animate-pulse"><Zap size={10} /> Active</span>;
    }
  };

  // Telemetry Progress Bar Component
  const TelemetryBar: React.FC<{ entry: number; stop: number; target: number; current: number }> = ({ entry, stop, target, current }) => {
    const range = target - stop;
    if (range <= 0) return null;
    
    const entryPct = ((entry - stop) / range) * 100;
    const currentPct = Math.max(0, Math.min(100, ((current - stop) / range) * 100));
    const profitPct = ((current - entry) / entry) * 100;
    
    return (
      <div className="mt-5 space-y-2">
        <div className="flex justify-between text-[9px] font-black text-slate-500 uppercase tracking-wider">
          <span className="text-rose-400">SL: {formatCurrency(stop)}</span>
          <span className="text-slate-400">Entry: {formatCurrency(entry)}</span>
          <span className="text-emerald-400">Target: {formatCurrency(target)}</span>
        </div>
        <div className="relative h-2 bg-slate-900 border border-slate-800 rounded-full overflow-hidden">
          {/* Entry Line Indicator */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-slate-600 z-10" style={{ left: `${entryPct}%` }}></div>
          
          {/* Fill Bar: Emerald if in profit, Rose if in loss */}
          {currentPct >= entryPct ? (
            <div className="absolute top-0 bottom-0 bg-emerald-500/20" style={{ left: `${entryPct}%`, width: `${currentPct - entryPct}%` }}></div>
          ) : (
            <div className="absolute top-0 bottom-0 bg-rose-500/20" style={{ left: `${currentPct}%`, width: `${entryPct - currentPct}%` }}></div>
          )}
          
          {/* Current Marker Pin */}
          <div className="absolute top-0 bottom-0 w-1.5 bg-indigo-400 shadow-md shadow-indigo-500/50" style={{ left: `${currentPct}%` }}></div>
        </div>
        <div className="flex justify-between items-center text-[10px]">
          <span className="text-slate-600 font-bold uppercase tracking-tight">1:2 Risk Multiplier</span>
          <span className={`font-mono font-bold ${profitPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            LTP: ₹{current.toFixed(2)} ({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(2)}%)
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Timing Controller */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-center gap-4 shadow-sm dark:shadow-xl transition-all">
        <div>
          <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight flex items-center gap-2">
            🏆 Human vs Quant Trading Battle
          </h2>
          <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
            Test your manual selection setup rules against the automated ACS screener pick.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Model Timing:</label>
          <select
            value={modelTime}
            onChange={(e) => {
              const val = e.target.value as any;
              setModelTime(val);
              localStorage.setItem('alpha_duel_model_time', val);
            }}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-black uppercase text-indigo-600 dark:text-indigo-400 rounded-xl px-3.5 py-2 outline-none cursor-pointer hover:border-indigo-400 dark:hover:border-slate-700 transition-all font-sans shadow-inner"
          >
            <option value="09:50">09:50 AM (Breakout)</option>
            <option value="10:30">10:30 AM (Trend)</option>
            <option value="11:00">11:00 AM (Consolidation)</option>
          </select>
        </div>
      </div>

      {/* Scorecard Widget */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* User Card */}
        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/20 dark:to-slate-900 border border-indigo-200 dark:border-indigo-900/30 rounded-2xl p-5 shadow-sm dark:shadow-xl group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <User size={120} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
              <User className="text-indigo-600 dark:text-indigo-400" size={18} />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Participant</p>
              <h4 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">Your Performance</h4>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">Win Rate</p>
              <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                {scorecard ? scorecard.userWinRate.toFixed(1) : '0.0'}%
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">Total Return</p>
              <p className={`text-2xl font-black ${scorecard && scorecard.userTotalPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {scorecard && scorecard.userTotalPnL >= 0 ? '+' : ''}{scorecard ? scorecard.userTotalPnL.toFixed(1) : '0.0'}%
              </p>
            </div>
          </div>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-3 font-medium">Based on {scorecard ? scorecard.userTrades : 0} locked duels</p>
        </div>

        {/* System Card */}
        <div className="relative overflow-hidden bg-gradient-to-br from-fuchsia-50 to-white dark:from-fuchsia-950/20 dark:to-slate-900 border border-fuchsia-200 dark:border-fuchsia-900/30 rounded-2xl p-5 shadow-sm dark:shadow-xl group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <Cpu size={120} className="text-fuchsia-600 dark:text-fuchsia-400" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-fuchsia-500/10 rounded-xl border border-fuchsia-500/20">
              <Cpu className="text-fuchsia-600 dark:text-fuchsia-400" size={18} />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Algorithm</p>
              <h4 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">ACS Model Pick</h4>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">Win Rate</p>
              <p className="text-2xl font-black text-fuchsia-600 dark:text-fuchsia-400">
                {scorecard ? scorecard.systemWinRate.toFixed(1) : '0.0'}%
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">Total Return</p>
              <p className={`text-2xl font-black ${scorecard && scorecard.systemTotalPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {scorecard && scorecard.systemTotalPnL >= 0 ? '+' : ''}{scorecard ? scorecard.systemTotalPnL.toFixed(1) : '0.0'}%
              </p>
            </div>
          </div>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-3 font-medium">Based on {scorecard ? scorecard.systemTrades : 0} automated picks</p>
        </div>

        {/* Leadership Trophy */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-sm dark:shadow-xl group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-xl border border-amber-500/20">
                <Trophy className="text-amber-600 dark:text-amber-400" size={18} />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Leaderboard</p>
                <h4 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight font-sans">Current Standings</h4>
              </div>
            </div>
          </div>
          <div className="my-2">
            {scorecard && scorecard.leader === 'TIE' && (
              <p className="text-lg font-black text-slate-600 dark:text-slate-300 uppercase italic">Tied Match</p>
            )}
            {scorecard && scorecard.leader === 'SYSTEM' && (
              <p className="text-lg font-black text-fuchsia-600 dark:text-fuchsia-400 uppercase flex items-center gap-2 italic">
                🤖 System Leading
              </p>
            )}
            {scorecard && scorecard.leader === 'USER' && (
              <p className="text-lg font-black text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-2 italic">
                🏆 You are Leading!
              </p>
            )}
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-500 font-medium">
            Compare options performance: Target is 2R profit (+40% premium), Stop is 1R loss (-20% premium).
          </p>
        </div>
      </div>

      {/* Duel Arena */}
      <div className="bg-white/60 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm dark:shadow-xl relative backdrop-blur-md">
        <div className="flex justify-between items-center mb-8 px-1">
          <div className="flex items-center gap-3">
            <Calendar className="text-indigo-600 dark:text-indigo-400" size={20} />
            <h3 className="text-base font-black text-slate-900 dark:text-slate-100 uppercase tracking-[0.2em]">Today's Strategic Match</h3>
          </div>
          {todayDuel && (
            <div className="flex gap-2">
              <button 
                onClick={handleYahooResolve} 
                className="px-4 py-2 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/20 rounded-xl text-[10px] font-black uppercase text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5 transition-all shadow-sm"
                disabled={loading}
              >
                {loading ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Resolve via Cloud
              </button>
              <button 
                onClick={() => setShowManualForm(!showManualForm)}
                className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 transition-all shadow-sm"
              >
                Manual Audit
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-2xl text-xs text-rose-600 dark:text-rose-400 font-bold flex items-center gap-2">
            <XCircle size={14} /> {error}
          </div>
        )}

        {!todayDuel ? (
          <div className="p-10 bg-slate-50 dark:bg-slate-950 rounded-[2.5rem] border border-slate-200 dark:border-slate-800/80 text-center max-w-lg mx-auto shadow-inner">
            <Lock className="text-slate-300 dark:text-slate-700 mx-auto mb-4" size={48} />
            <h4 className="text-sm font-black text-slate-500 dark:text-slate-400 uppercase mb-2 tracking-widest">Duel Not Initialized</h4>
            <p className="text-xs text-slate-500 dark:text-slate-500 leading-relaxed mb-8 font-medium">
              The neural system picks the highest conviction breakout setup automatically at your chosen session timing.
            </p>
            <div className="space-y-6 text-left">
              <button 
                onClick={handleAutoSelectSystemPick}
                disabled={loading}
                className="w-full py-4 bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 border border-white/10 active:scale-95"
              >
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} fill="currentColor" />}
                Neural Auto-Selection (ACS)
              </button>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800/80"></div>
                <span className="flex-shrink mx-4 text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest">Direct Override</span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800/80"></div>
              </div>

              <div className="flex gap-3">
                <input 
                  type="text" 
                  placeholder="SYMBOL (E.G. RELIANCE)"
                  value={sysTickerInput}
                  onChange={e => setSysTickerInput(e.target.value.toUpperCase())}
                  className="w-1/2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-900 dark:text-slate-200 outline-none uppercase font-mono font-bold shadow-inner"
                />
                <input 
                  type="number" 
                  placeholder="SPOT PRICE"
                  value={sysEntryInput}
                  onChange={e => setSysEntryInput(e.target.value)}
                  className="w-1/2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-900 dark:text-slate-200 outline-none font-mono font-bold shadow-inner"
                />
              </div>
              <button 
                onClick={handleInitSystemPick}
                disabled={!sysTickerInput || !sysEntryInput}
                className="w-full py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] text-slate-600 dark:text-slate-300 transition-all flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 shadow-sm"
              >
                <Play size={12} fill="currentColor" /> Initialize Manual Duel
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* System Pick Area */}
            <div className="p-6 bg-slate-50/50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-3xl relative overflow-hidden shadow-inner">
              <div className="absolute top-4 right-4 opacity-5 dark:opacity-10">
                <Cpu size={60} className="text-fuchsia-600 dark:text-fuchsia-400" />
              </div>
              <p className="text-[10px] font-black text-fuchsia-600 dark:text-fuchsia-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Cpu size={10}/> Neural Protocol Pick</p>
              <div className="flex justify-between items-baseline mb-6">
                <div>
                  <h4 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">{todayDuel.systemTicker}</h4>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Model Ref: {todayDuel.modelRunTime || '09:50'}</span>
                </div>
                {getStatusBadge(todayDuel.systemStatus)}
              </div>
              
              <div className="space-y-3 text-xs">
                <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/40 pb-2.5">
                  <span className="text-slate-500 dark:text-slate-500 font-bold uppercase tracking-tighter">Initial Spot</span>
                  <span className="font-bold text-slate-900 dark:text-slate-300 font-mono">{formatCurrency(todayDuel.systemEntryPrice)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/40 pb-2.5">
                  <span className="text-slate-500 dark:text-slate-500 font-bold uppercase tracking-tighter">Session High</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(todayDuel.systemPeakPrice)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/40 pb-2.5">
                  <span className="text-slate-500 dark:text-slate-500 font-bold uppercase tracking-tighter">Session Low</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400 font-mono">{formatCurrency(todayDuel.systemTroughPrice)}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-slate-500 dark:text-slate-500 font-bold uppercase tracking-tighter">Options Alpha</span>
                  <span className={`font-black font-mono text-base ${todayDuel.systemPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {todayDuel.systemPnL >= 0 ? '+' : ''}{todayDuel.systemPnL.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* System Telemetry Map */}
              <TelemetryBar 
                entry={todayDuel.systemEntryPrice}
                stop={todayDuel.systemStopLoss || (todayDuel.systemEntryPrice * 0.992)}
                target={todayDuel.systemTarget || (todayDuel.systemEntryPrice * 1.015)}
                current={liveSysPrice || todayDuel.systemExitPrice || todayDuel.systemEntryPrice}
              />
            </div>

            {/* User Pick Area */}
            <div className="p-6 bg-slate-50/50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-3xl relative overflow-hidden shadow-inner">
              <div className="absolute top-4 right-4 opacity-5 dark:opacity-10">
                <User size={60} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><User size={10}/> Subjective Selection</p>
              
              {!todayDuel.userTicker ? (
                <div className="space-y-4 py-4">
                  <p className="text-[11px] text-slate-500 dark:text-slate-500 font-medium leading-relaxed">
                    Detected a higher probability breakout? Lock it in below to baseline your manual edge.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <input 
                      type="text" 
                      placeholder="TICKER"
                      value={userTicker}
                      onChange={e => setUserTicker(e.target.value.toUpperCase())}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-900 dark:text-slate-200 outline-none uppercase font-mono font-bold shadow-inner"
                    />
                    <NumericInput 
                      placeholder="ENTRY PRICE"
                      value={userEntryPrice}
                      onChange={setUserEntryPrice}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <NumericInput 
                      label="Stop Loss (Price)"
                      placeholder="STOP"
                      value={userStopLoss}
                      onChange={setUserStopLoss}
                    />
                    <NumericInput 
                      label="Target (Price)"
                      placeholder="TARGET"
                      value={userTarget}
                      onChange={setUserTarget}
                    />
                  </div>
                  <button 
                    onClick={handleLockUserPick}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 rounded-2xl text-[10px] font-black uppercase text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 active:scale-95 tracking-widest"
                  >
                    <Lock size={12} fill="currentColor" /> Lock Match Selection
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-baseline mb-6">
                    <h4 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">{todayDuel.userTicker}</h4>
                    <div className="flex items-center gap-2">
                      {todayDuel.userStatus === 'PENDING' && (
                        <button 
                          onClick={() => setShowExitModal(true)}
                          className="px-3 py-1.5 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm"
                        >
                          <LogOut size={12} /> Liquidate
                        </button>
                      )}
                      {getStatusBadge(todayDuel.userStatus)}
                    </div>
                  </div>
                  
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/40 pb-2.5">
                      <span className="text-slate-500 dark:text-slate-500 font-bold uppercase tracking-tighter">Initial Spot</span>
                      <span className="font-bold text-slate-900 dark:text-slate-300 font-mono">{formatCurrency(todayDuel.userEntryPrice)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/40 pb-2.5">
                      <span className="text-slate-500 dark:text-slate-500 font-bold uppercase tracking-tighter">Session High</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(todayDuel.userPeakPrice)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-800/40 pb-2.5">
                      <span className="text-slate-500 dark:text-slate-500 font-bold uppercase tracking-tighter">Session Low</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400 font-mono">{formatCurrency(todayDuel.userTroughPrice)}</span>
                    </div>
                    <div className="flex justify-between pt-1">
                      <span className="text-slate-500 dark:text-slate-500 font-bold uppercase tracking-tighter">Subjective PnL</span>
                      <span className={`font-black font-mono text-base ${todayDuel.userPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {todayDuel.userPnL >= 0 ? '+' : ''}{todayDuel.userPnL.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* User Telemetry Map */}
                  <TelemetryBar 
                    entry={todayDuel.userEntryPrice}
                    stop={todayDuel.userStopLoss || (todayDuel.userEntryPrice * 0.992)}
                    target={todayDuel.userTarget || (todayDuel.userEntryPrice * 1.015)}
                    current={liveUsrPrice || todayDuel.userExitPrice || todayDuel.userEntryPrice}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* User Manual Early Exit Modal */}
        <AnimatePresence>
          {showExitModal && todayDuel && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            >
              <motion.div 
                initial={{ scale: 0.95, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 10 }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl shadow-inner">
                    <LogOut size={24} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">Manual Exit</h3>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest mt-1">Audit override for {todayDuel.userTicker}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Current Exit Price (LTP)</label>
                  <input 
                    type="number"
                    value={exitPriceInput}
                    onChange={e => setExitPriceInput(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-slate-200 outline-none font-mono font-bold shadow-inner focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowExitModal(false)}
                    className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-300 rounded-2xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleUserEarlyExit}
                    className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-black uppercase tracking-widest text-white rounded-2xl transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
                  >
                    Commit Exit
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Manual Resolution Form */}
        <AnimatePresence>
          {showManualForm && todayDuel && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-8 border-t border-slate-200 dark:border-slate-800/60 pt-8 space-y-6"
            >
              <div className="flex items-center gap-2 mb-2">
                 <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse"></div>
                 <h4 className="text-xs font-black text-slate-800 dark:text-slate-300 uppercase tracking-[0.2em]">Match Audit Override (Manual Input)</h4>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* System EOD Form */}
                <div className="space-y-4">
                  <p className="text-[10px] font-black text-fuchsia-600 dark:text-fuchsia-400 uppercase tracking-widest ml-1">Neural Pick: {todayDuel.systemTicker}</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                       <span className="text-[8px] font-black text-slate-400 uppercase ml-1">Day High</span>
                       <input 
                         type="number" 
                         placeholder="High" 
                         value={sysHigh} 
                         onChange={e => setSysHigh(e.target.value)}
                         className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-200 outline-none font-mono font-bold shadow-inner"
                       />
                    </div>
                    <div className="space-y-1.5">
                       <span className="text-[8px] font-black text-slate-400 uppercase ml-1">Day Low</span>
                       <input 
                         type="number" 
                         placeholder="Low" 
                         value={sysLow} 
                         onChange={e => setSysLow(e.target.value)}
                         className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-200 outline-none font-mono font-bold shadow-inner"
                       />
                    </div>
                    <div className="space-y-1.5">
                       <span className="text-[8px] font-black text-slate-400 uppercase ml-1">Day Close</span>
                       <input 
                         type="number" 
                         placeholder="Close" 
                         value={sysClose} 
                         onChange={e => setSysClose(e.target.value)}
                         className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-200 outline-none font-mono font-bold shadow-inner"
                       />
                    </div>
                  </div>
                </div>

                {/* User EOD Form */}
                {todayDuel.userTicker && (
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest ml-1">Your Pick: {todayDuel.userTicker}</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                         <span className="text-[8px] font-black text-slate-400 uppercase ml-1">Day High</span>
                         <input 
                           type="number" 
                           placeholder="High" 
                           value={usrHigh} 
                           onChange={e => setUsrHigh(e.target.value)}
                           className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-200 outline-none font-mono font-bold shadow-inner"
                         />
                      </div>
                      <div className="space-y-1.5">
                         <span className="text-[8px] font-black text-slate-400 uppercase ml-1">Day Low</span>
                         <input 
                           type="number" 
                           placeholder="Low" 
                           value={usrLow} 
                           onChange={e => setUsrLow(e.target.value)}
                           className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-200 outline-none font-mono font-bold shadow-inner"
                         />
                      </div>
                      <div className="space-y-1.5">
                         <span className="text-[8px] font-black text-slate-400 uppercase ml-1">Day Close</span>
                         <input 
                           type="number" 
                           placeholder="Close" 
                           value={usrClose} 
                           onChange={e => setUsrClose(e.target.value)}
                           className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-200 outline-none font-mono font-bold shadow-inner"
                         />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-8">
                <button 
                  onClick={() => setShowManualForm(false)} 
                  className="px-6 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-300 transition-all font-sans"
                >
                  Discard
                </button>
                <button 
                  onClick={handleManualResolve}
                  className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-xs font-black uppercase tracking-widest text-white transition-all shadow-lg shadow-emerald-600/20 active:scale-95"
                >
                  Validate & Resolve
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Duel History Ledger */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm dark:shadow-xl transition-all">
        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-[0.2em] mb-6 font-sans px-1 flex items-center gap-2">
            <History className="text-slate-400" size={18} /> Battle History Log
        </h3>
        
        {history.length === 0 ? (
          <div className="text-center py-12 bg-slate-50 dark:bg-slate-950/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
             <p className="text-xs font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest">No strategic duels logged in history vaults.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800/50 shadow-inner bg-slate-50/30 dark:bg-transparent">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 text-slate-500 dark:text-slate-500 font-black uppercase text-[9px] tracking-widest">
                  <th className="px-5 py-4">Session Date</th>
                  <th className="px-5 py-4">Model Ref</th>
                  <th className="px-5 py-4">Neural Pick</th>
                  <th className="px-5 py-4 text-right">Bot Return</th>
                  <th className="px-5 py-4 pl-10">Your Asset</th>
                  <th className="px-5 py-4 text-right">Your Return</th>
                  <th className="px-5 py-4 text-right pr-6 uppercase tracking-widest">Victor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                {history.map((row) => (
                  <tr key={row.id} className="text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800/40 transition-all group">
                    <td className="px-5 py-4 font-bold text-slate-900 dark:text-slate-400">{row.date}</td>
                    <td className="px-5 py-4 font-bold text-slate-400 dark:text-slate-600 font-mono text-[10px]">{row.modelRunTime || '09:50'}</td>
                    <td className="px-5 py-4 font-black text-fuchsia-600 dark:text-fuchsia-400 tracking-tight italic">{row.systemTicker}</td>
                    <td className={`px-5 py-4 text-right font-black font-mono ${row.systemPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {row.systemPnL >= 0 ? '+' : ''}{row.systemPnL.toFixed(1)}%
                    </td>
                    <td className="px-5 py-4 pl-10 font-black text-indigo-600 dark:text-indigo-300 tracking-tight">{row.userTicker || 'STANDBY'}</td>
                    <td className={`px-5 py-4 text-right font-black font-mono ${row.userPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {row.userTicker ? `${row.userPnL >= 0 ? '+' : ''}${row.userPnL.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-5 py-4 text-right font-black pr-6">
                      {!row.userTicker ? (
                        <span className="text-slate-300 dark:text-slate-700">—</span>
                      ) : row.systemPnL > row.userPnL ? (
                        <span className="text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10 px-2.5 py-1 rounded-lg border border-fuchsia-500/20 flex items-center justify-end gap-1.5 inline-flex ml-auto"><Cpu size={10}/> BOT</span>
                      ) : row.userPnL > row.systemPnL ? (
                        <span className="text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/20 flex items-center justify-end gap-1.5 inline-flex ml-auto"><User size={10}/> YOU</span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-500 uppercase tracking-widest text-[9px]">Tied</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuantDuelPanel;
