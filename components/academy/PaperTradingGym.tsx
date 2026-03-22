
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { useToast } from '../shared/ToastProvider';
import {
  X, Play, Pause, FastForward, TrendingUp, TrendingDown,
  Activity, DollarSign, RefreshCw, Trophy, Target, Calculator
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine
} from 'recharts';
import { CustomTooltip } from '../shared/CustomTooltip';

// --- MOCK DATA GENERATOR (Simulates a Trading Session) ---
const generateScenario = (length: number = 100) => {
  // Awaiting live historical tick data synchronization
  return [];
};

interface PaperTradingGymProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (score: number) => void;
}

interface TradeRecord {
  id: number;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice?: number;
  qty: number;
  pnl?: number;
}

export const PaperTradingGym: React.FC<PaperTradingGymProps> = ({ isOpen, onClose, onComplete }) => {
  const { toast } = useToast();
  // --- Game State ---
  const [fullData, setFullData] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(20); // Start with some history
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000); // ms per candle

  // --- Portfolio State ---
  const [capital, setCapital] = useState(100000);
  const [position, setPosition] = useState<TradeRecord | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [qty, setQty] = useState(50); // NIFTY Lot Size

  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize Scenario
  useEffect(() => {
    if (isOpen) {
      setFullData(generateScenario(150));
      setCurrentIndex(30);
      setCapital(100000);
      setPosition(null);
      setTradeHistory([]);
      setIsPlaying(false);
    }
  }, [isOpen]);

  // Game Loop
  useEffect(() => {
    let interval: any;
    if (isPlaying && currentIndex < fullData.length - 1) {
      interval = setInterval(() => {
        setCurrentIndex(prev => prev + 1);
      }, speed);
    } else if (currentIndex >= fullData.length - 1) {
      setIsPlaying(false);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentIndex, fullData.length, speed]);

  // Derived Values
  const visibleData = useMemo(() => fullData.slice(0, currentIndex + 1), [fullData, currentIndex]);
  const currentPrice = visibleData.length > 0 ? visibleData[visibleData.length - 1].price : 0;

  // PnL Calculation
  const unrealizedPnL = useMemo(() => {
    if (!position) return 0;
    const diff = currentPrice - position.entryPrice;
    return position.type === 'LONG' ? diff * position.qty : -diff * position.qty;
  }, [position, currentPrice]);

  const totalPnL = tradeHistory.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const equity = capital + totalPnL + unrealizedPnL;

  // Actions
  const handleNext = () => {
    if (currentIndex < fullData.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const executeOrder = (type: 'LONG' | 'SHORT') => {
    if (position) {
      // Close existing first? Or reverse? For simplicity: Close if opposite, else add (not supported yet)
      // Let's force close before open for this gym
      toast.warning('Close your current position before opening a new one.');
      return;
    }

    setPosition({
      id: Date.now(),
      type,
      entryPrice: currentPrice,
      qty
    });
  };

  const closePosition = () => {
    if (!position) return;

    const pnl = unrealizedPnL;
    const closedTrade = { ...position, exitPrice: currentPrice, pnl };

    setTradeHistory(prev => [closedTrade, ...prev]);
    setPosition(null);
  };

  const finishSession = () => {
    // Auto close open position
    if (position) closePosition();
    // Calculate Score based on Equity gain
    const gain = equity - 100000;
    const score = gain > 0 ? 100 : 50; // Simple logic
    onComplete(score);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="paper-trading-gym-title" className="fixed inset-0 z-[100] bg-slate-950 flex flex-col animate-in fade-in duration-300">

      {/* HEADER */}
      <div className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-indigo-600 rounded-lg">
            <Activity className="text-white" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-white tracking-tight">NIFTY SIMULATOR</h2>
            <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest">Paper Trading Gym</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right hidden md:block">
            <p className="text-xs text-slate-500 uppercase font-bold">Account Equity</p>
            <p className={`text-2xl font-mono font-bold ${equity >= 100000 ? 'text-emerald-400' : 'text-rose-400'}`}>
              ₹{equity.toFixed(2)}
            </p>
          </div>

          <button onClick={onClose} aria-label="Close paper trading gym" className="p-2 hover:bg-slate-800 rounded-full text-slate-500 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

        {/* LEFT: CHART */}
        <div className="flex-1 flex flex-col bg-slate-950 relative border-r border-slate-800">
          {/* Chart Header Overlay */}
          <div className="absolute top-4 left-4 z-10 flex gap-4">
            <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700 p-2 rounded-lg text-white font-mono">
              <span className="text-xs text-slate-400 mr-2">PRICE</span>
              <span className="text-lg font-bold">{currentPrice.toFixed(2)}</span>
            </div>
            <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700 p-2 rounded-lg text-white font-mono">
              <span className="text-xs text-slate-400 mr-2">CANDLE</span>
              <span className="text-lg font-bold text-indigo-400">{currentIndex} / {fullData.length}</span>
            </div>
          </div>

          <div className="flex-1 w-full h-full pt-12">
            <SafeChartContainer>
              <AreaChart data={visibleData}>
                <defs>
                  <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                <XAxis dataKey="index" hide />
                <YAxis
                  domain={['auto', 'auto']}
                  orientation="right"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickCount={8}
                />
                <Tooltip
                  content={<CustomTooltip formatter={(value: number) => value.toFixed(2)} />}
                  cursor={{ strokeDasharray: '3 3' }}
                />
                <ReferenceLine y={position?.entryPrice} stroke={position?.type === 'LONG' ? '#10b981' : '#f43f5e'} strokeDasharray="3 3" label={{ value: 'ENTRY', fill: position?.type === 'LONG' ? '#10b981' : '#f43f5e', fontSize: 10, position: 'insideLeft' }} />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorPrice)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </SafeChartContainer>
          </div>

          {/* Playback Controls */}
          <div className="h-16 bg-slate-900 border-t border-slate-800 flex items-center justify-center gap-4">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-12 h-12 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-white transition-all active:scale-95"
            >
              {isPlaying ? <Pause size={20} fill="white" /> : <Play size={20} fill="white" className="ml-1" />}
            </button>

            <button
              onClick={handleNext}
              className="w-12 h-12 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-white transition-all active:scale-95"
              disabled={isPlaying}
            >
              <FastForward size={20} />
            </button>

            <div className="h-8 w-px bg-slate-700 mx-2"></div>

            <div className="flex gap-2">
              {[1000, 500, 200].map(s => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-3 py-1 rounded text-xs font-bold ${speed === s ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                >
                  {s === 1000 ? '1x' : s === 500 ? '2x' : '5x'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: TRADING TERMINAL */}
        <div className="w-full md:w-80 bg-slate-900 flex flex-col border-l border-slate-800">

          {/* 1. ORDER PANEL */}
          <div className="p-6 border-b border-slate-800">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Order Deck</h3>
              <span className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-300">QTY: {qty}</span>
            </div>

            {!position ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => executeOrder('LONG')}
                  className="py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-lg shadow-[0_4px_0_rgb(6,95,70)] active:shadow-none active:translate-y-[4px] transition-all flex flex-col items-center"
                >
                  <TrendingUp size={24} className="mb-1" />
                  BUY CALL
                </button>
                <button
                  onClick={() => executeOrder('SHORT')}
                  className="py-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-black text-lg shadow-[0_4px_0_rgb(159,18,57)] active:shadow-none active:translate-y-[4px] transition-all flex flex-col items-center"
                >
                  <TrendingDown size={24} className="mb-1" />
                  BUY PUT
                </button>
              </div>
            ) : (
              <div className={`p-4 rounded-xl border-2 ${position.type === 'LONG' ? 'bg-emerald-900/20 border-emerald-500/50' : 'bg-rose-900/20 border-rose-500/50'}`}>
                <div className="flex justify-between items-start mb-2">
                  <span className={`text-xs font-black px-2 py-0.5 rounded ${position.type === 'LONG' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                    {position.type}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">@ {position.entryPrice}</span>
                </div>

                <div className="text-center py-2">
                  <p className="text-xs text-slate-500 uppercase font-bold">Running PnL</p>
                  <p className={`text-3xl font-mono font-black ${unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {unrealizedPnL >= 0 ? '+' : ''}{unrealizedPnL.toFixed(0)}
                  </p>
                </div>

                <button
                  onClick={closePosition}
                  className="w-full mt-2 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg border border-slate-600"
                >
                  CLOSE POSITION
                </button>
              </div>
            )}
          </div>

          {/* 2. HISTORY LOG */}
          <div className="flex-1 overflow-y-auto p-4 bg-slate-950/30">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Session Log</h3>
            <div className="space-y-2">
              {tradeHistory.map((t) => (
                <div key={t.id} className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg border border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${t.type === 'LONG' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                    <div>
                      <p className="text-xs font-bold text-slate-300">{t.type}</p>
                      <p className="text-[10px] text-slate-500">{t.entryPrice} &rarr; {t.exitPrice}</p>
                    </div>
                  </div>
                  <span className={`font-mono text-sm font-bold ${t.pnl && t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.pnl && t.pnl >= 0 ? '+' : ''}{t.pnl?.toFixed(0)}
                  </span>
                </div>
              ))}
              {tradeHistory.length === 0 && (
                <div className="text-center py-8 text-slate-600 text-xs italic">
                  No closed trades yet.
                </div>
              )}
            </div>
          </div>

          {/* 3. FOOTER */}
          <div className="p-4 border-t border-slate-800 bg-slate-900">
            <button
              onClick={finishSession}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all"
            >
              <Trophy size={16} /> End Session
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
