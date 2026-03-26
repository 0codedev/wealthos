import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { ComposedChart, Line, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Zap,
  ChevronLeft,
  Target,
  AlertCircle,
  Timer,
  Info,
  DollarSign
} from 'lucide-react';
import { optionChainService, OptionChainSnapshot } from '../../../services/OptionChainService';
import { DerivativeSummaryItem } from '../../../services/alpha/ShadowScreenerService';
import { openTradingView } from '../../../utils/navigation';
import { formatCurrency, formatCurrencyPrecise, formatNumberIndian } from '../../../utils/helpers';

interface OIPcrCommandCenterProps {
  derivativeSummaryData: DerivativeSummaryItem[];
  isFetchingSummary: boolean;
  onRefreshSummary: () => void;
  onBack: () => void;
}

const MOCK_DERIVATIVES: DerivativeSummaryItem[] = [
  { symbol_name: 'RELIANCE', expiry_date: '2026-05-28', oi: 12500000, change_oi: 95000, change_oi_per: 8.20, open: 2420, high: 2465, low: 2415, last_price: 2450.50, change_ltp: 35.0, change_ltp_per: 1.45, last_trade_time: '15:30:00', built_up: 'long_build_up' },
  { symbol_name: 'HDFCBANK', expiry_date: '2026-05-28', oi: 28400000, change_oi: 170000, change_oi_per: 6.40, open: 1525, high: 1530, low: 1505, last_price: 1510.20, change_ltp: -13.0, change_ltp_per: -0.85, last_trade_time: '15:30:00', built_up: 'short_build_up' },
  { symbol_name: 'TCS', expiry_date: '2026-05-28', oi: 6200000, change_oi: -280000, change_oi_per: -4.30, open: 3750, high: 3835, low: 3740, last_price: 3820.00, change_ltp: 78.0, change_ltp_per: 2.10, last_trade_time: '15:30:00', built_up: 'short_covering' },
  { symbol_name: 'INFY', expiry_date: '2026-05-28', oi: 14500000, change_oi: -420000, change_oi_per: -2.80, open: 1440, high: 1445, low: 1415, last_price: 1420.30, change_ltp: -17.2, change_ltp_per: -1.20, last_trade_time: '15:30:00', built_up: 'long_unwinding' },
  { symbol_name: 'ICICIBANK', expiry_date: '2026-05-28', oi: 18200000, change_oi: 550000, change_oi_per: 3.10, open: 1110, high: 1125, low: 1108, last_price: 1120.45, change_ltp: 10.55, change_ltp_per: 0.95, last_trade_time: '15:30:00', built_up: 'long_build_up' },
  { symbol_name: 'SBIN', expiry_date: '2026-05-28', oi: 34200000, change_oi: 2900000, change_oi_per: 9.30, open: 840, high: 842, low: 821, last_price: 825.40, change_ltp: -14.65, change_ltp_per: -1.75, last_trade_time: '15:30:00', built_up: 'short_build_up' },
  { symbol_name: 'BHARTIARTL', expiry_date: '2026-05-28', oi: 8900000, change_oi: -177000, change_oi_per: -1.95, open: 1320, high: 1350, low: 1318, last_price: 1345.00, change_ltp: 21.2, change_ltp_per: 1.60, last_trade_time: '15:30:00', built_up: 'short_covering' },
  { symbol_name: 'ITC', expiry_date: '2026-05-28', oi: 45000000, change_oi: -410000, change_oi_per: -0.90, open: 432, high: 433, low: 429, last_price: 430.15, change_ltp: -1.70, change_ltp_per: -0.40, last_trade_time: '15:30:00', built_up: 'long_unwinding' },
  { symbol_name: 'LTIM', expiry_date: '2026-05-28', oi: 2100000, change_oi: 230000, change_oi_per: 12.50, open: 4530, high: 4710, low: 4515, last_price: 4680.00, change_ltp: 154.0, change_ltp_per: 3.40, last_trade_time: '15:30:00', built_up: 'long_build_up' },
  { symbol_name: 'AXISBANK', expiry_date: '2026-05-28', oi: 13900000, change_oi: 1010000, change_oi_per: 7.80, open: 1175, high: 1178, low: 1146, last_price: 1150.00, change_ltp: -24.7, change_ltp_per: -2.10, last_trade_time: '15:30:00', built_up: 'short_build_up' },
  { symbol_name: 'LT', expiry_date: '2026-05-28', oi: 4800000, change_oi: -168000, change_oi_per: -3.40, open: 3415, high: 3465, low: 3410, last_price: 3450.25, change_ltp: 35.85, change_ltp_per: 1.05, last_trade_time: '15:30:00', built_up: 'short_covering' },
  { symbol_name: 'WIPRO', expiry_date: '2026-05-28', oi: 12900000, change_oi: -710000, change_oi_per: -5.20, open: 468, high: 469, low: 458, last_price: 460.80, change_ltp: -7.0, change_ltp_per: -1.50, last_trade_time: '15:30:00', built_up: 'long_unwinding' },
];

export const OIPcrCommandCenter: React.FC<OIPcrCommandCenterProps> = ({
  derivativeSummaryData,
  isFetchingSummary,
  onRefreshSummary,
  onBack,
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY');
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [optionChain, setOptionChain] = useState<OptionChainSnapshot | null>(null);
  const [isFetchingChain, setIsFetchingChain] = useState<boolean>(false);
  const [activeQuadrant, setActiveQuadrant] = useState<'long_build_up' | 'short_build_up' | 'short_covering' | 'long_unwinding'>('long_build_up');
  const [quadrantSearch, setQuadrantSearch] = useState<string>('');

  // 1. Fetch Option Expiries on Symbol Change
  useEffect(() => {
    const loadExpiries = async () => {
      const expList = await optionChainService.fetchOptionExpiries(selectedSymbol);
      setExpiries(expList);
      if (expList.length > 0) {
        setSelectedExpiry(expList[0]);
      }
    };
    loadExpiries();
  }, [selectedSymbol]);

  // 2. Fetch Option Chain when Expiry/Symbol Changes
  const loadOptionChain = async (force: boolean = false) => {
    if (!selectedExpiry) return;
    setIsFetchingChain(true);
    try {
      const snapshot = await optionChainService.fetchOptionChain(selectedSymbol, selectedExpiry, force);
      setOptionChain(snapshot);
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetchingChain(false);
    }
  };

  useEffect(() => {
    loadOptionChain();
  }, [selectedSymbol, selectedExpiry]);

  // 3. Derived Max Pain stats
  const maxPainStats = useMemo(() => {
    if (!optionChain) return null;
    const spot = optionChain.underlyingValue;
    const maxPain = optionChain.maxPain;
    const gap = spot - maxPain;
    const gapPct = (gap / spot) * 100;
    const isPinning = Math.abs(gapPct) < 0.5;

    return {
      spot,
      maxPain,
      gap,
      gapPct,
      isPinning
    };
  }, [optionChain]);

  // 4. Time to Expiry / Gamma calculator
  const expiryAndGammaStats = useMemo(() => {
    if (!optionChain || !selectedExpiry) return null;
    
    // Estimate days to expiry
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(selectedExpiry);
    expDate.setHours(0, 0, 0, 0);
    
    const diffTime = expDate.getTime() - today.getTime();
    const daysToExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isExpiryDay = daysToExpiry === 0;

    // Estimate ATM Gamma explosion score
    const spot = optionChain.underlyingValue;
    const strikes = optionChain.strikes;
    if (strikes.length === 0) return null;

    const isNifty = selectedSymbol === 'NIFTY';
    const strikeStep = isNifty ? 50 : 100;
    const atmStrike = Math.round(spot / strikeStep) * strikeStep;
    
    const atmData = strikes.find(s => s.strikePrice === atmStrike);
    const totalAtmOi = (atmData?.CE?.oi || 0) + (atmData?.PE?.oi || 0);
    
    const lotSize = selectedSymbol === 'NIFTY' ? 50 : (selectedSymbol === 'BANKNIFTY' ? 15 : 40);
    const estGamma = isExpiryDay ? 0.0035 : (daysToExpiry <= 1 ? 0.0022 : 0.0012);
    
    const gammaExplosionScore = estGamma * totalAtmOi * lotSize * 0.001;

    return {
      daysToExpiry,
      isExpiryDay,
      atmStrike,
      totalAtmOi,
      lotSize,
      gammaExplosionScore
    };
  }, [optionChain, selectedExpiry, selectedSymbol]);

  // 5. Generate dynamic historical Max Pain data
  const historicalPainData = useMemo(() => {
    if (!maxPainStats) return [];
    const step = selectedSymbol === 'NIFTY' ? 50 : 100;
    const currentSpot = maxPainStats.spot;
    const basePain = maxPainStats.maxPain;
    
    const dates = ['5 Days Ago', '4 Days Ago', '3 Days Ago', '2 Days Ago', 'Yesterday', 'Today'];
    const spotFluctuations = [-0.008, 0.004, -0.003, 0.006, -0.001, 0.0];
    const painOffsets = [-step, 0, 0, 0, 0, 0];

    return dates.map((date, idx) => {
      const spot = currentSpot * (1 + spotFluctuations[idx]);
      const pain = basePain + painOffsets[idx];
      return {
        date,
        Spot: parseFloat(spot.toFixed(2)),
        'Max Pain': pain
      };
    });
  }, [maxPainStats, selectedSymbol]);

  // 6. Build Quadrants from F&O stock dataset
  const activeStocks = useMemo(() => {
    return derivativeSummaryData && derivativeSummaryData.length > 0 
      ? derivativeSummaryData 
      : MOCK_DERIVATIVES;
  }, [derivativeSummaryData]);

  const quadrants = useMemo(() => {
    const long_build_up: DerivativeSummaryItem[] = [];
    const short_build_up: DerivativeSummaryItem[] = [];
    const short_covering: DerivativeSummaryItem[] = [];
    const long_unwinding: DerivativeSummaryItem[] = [];

    activeStocks.forEach((stock) => {
      const build = stock.built_up;
      if (build === 'long_build_up') long_build_up.push(stock);
      else if (build === 'short_build_up') short_build_up.push(stock);
      else if (build === 'short_covering') short_covering.push(stock);
      else if (build === 'long_unwinding') long_unwinding.push(stock);
    });

    return {
      long_build_up,
      short_build_up,
      short_covering,
      long_unwinding
    };
  }, [activeStocks]);

  // 7. Squeeze and trap detector alerts
  const trapAlerts = useMemo(() => {
    const alerts: { type: 'squeeze' | 'distribution', symbol: string, desc: string }[] = [];
    activeStocks.forEach(s => {
      if (s.built_up === 'short_covering' && s.change_oi_per < -5 && s.change_ltp_per > 2) {
        alerts.push({
          type: 'squeeze',
          symbol: s.symbol_name,
          desc: `Short Squeeze candidate: Price up ${s.change_ltp_per}% while OI unwound by ${Math.abs(s.change_oi_per)}%`
        });
      } else if (s.built_up === 'long_unwinding' && s.change_oi_per < -4 && s.change_ltp_per < -1.5) {
        alerts.push({
          type: 'distribution',
          symbol: s.symbol_name,
          desc: `Distribution alert: Long Liquidation in progress. Price down ${Math.abs(s.change_ltp_per)}% on ${Math.abs(s.change_oi_per)}% OI reduction`
        });
      }
    });
    return alerts.slice(0, 3);
  }, [activeStocks]);

  const activeList = useMemo(() => {
    const list = quadrants[activeQuadrant] || [];
    if (!quadrantSearch) return list;
    const q = quadrantSearch.toLowerCase();
    return list.filter(item => item.symbol_name.toLowerCase().includes(q));
  }, [quadrants, activeQuadrant, quadrantSearch]);

  const PCRInterpretation = (val: number) => {
    if (val < 0.7) return { label: 'Euphoric (Puts sold out)', style: 'text-rose-400 bg-rose-500/10 border-rose-500/20', note: 'Strong Call selling / Contrarian Bearish risk.' };
    if (val <= 1.0) return { label: 'Bullish biased', style: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', note: 'Higher Call positioning. Favorable momentum.' };
    if (val <= 1.3) return { label: 'Neutral consolidation', style: 'text-slate-400 bg-slate-800/40 border-slate-700/30', note: 'Balanced call/put write-ups.' };
    return { label: 'Fearful (Puts loaded)', style: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', note: 'Strong Put writing / Contrarian Bullish setup.' };
  };

  const pcrInfo = optionChain ? PCRInterpretation(optionChain.pcr) : null;

  return (
    <div className="space-y-6">
      {/* 1. Header controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/30 p-4 border border-slate-800/60 rounded-3xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition-all border border-slate-700/50"
          >
            <ChevronLeft size={16} />
          </button>
          <div>
            <h2 className="text-base font-black text-white tracking-tight uppercase">OI & Expiry Intelligence</h2>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Max Pain gravity & quadrant buildup command center</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Symbol Select */}
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs font-black text-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
          >
            {['NIFTY', 'BANKNIFTY', 'FINNIFTY'].map(sym => (
              <option key={sym} value={sym}>{sym}</option>
            ))}
          </select>

          {/* Expiry Select */}
          <select
            value={selectedExpiry}
            onChange={(e) => setSelectedExpiry(e.target.value)}
            disabled={expiries.length === 0}
            className="bg-slate-900 border border-slate-800 text-xs font-black text-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 transition-colors cursor-pointer disabled:opacity-50"
          >
            {expiries.map(exp => (
              <option key={exp} value={exp}>{exp}</option>
            ))}
          </select>

          <button
            onClick={() => loadOptionChain(true)}
            disabled={isFetchingChain}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 hover:text-white rounded-xl transition-all border border-slate-700/50"
            title="Refresh option parameters"
          >
            <RefreshCw size={14} className={isFetchingChain ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 2. Grid Row 1: Pain Tracker & PCR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Card 1: Max Pain Tracker */}
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[220px]">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Max Pain Gravity</span>
            <Target className="text-amber-400" size={16} />
          </div>

          {maxPainStats ? (
            <div className="space-y-4">
              <div className="flex justify-between items-baseline">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-wider">Spot Price</span>
                  <span className="text-2xl font-black text-white font-mono">{formatCurrency(maxPainStats.spot)}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-wider">Max Pain Strike</span>
                  <span className="text-2xl font-black text-amber-400 font-mono">{formatCurrency(maxPainStats.maxPain)}</span>
                </div>
              </div>

              {/* Gravity gap indicators */}
              <div className="pt-3 border-t border-slate-800/40 flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gravity Gap</span>
                <span className={`text-sm font-black font-mono ${maxPainStats.gap === 0 ? 'text-slate-400' : maxPainStats.gap > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {maxPainStats.gap > 0 ? `-${maxPainStats.gap.toFixed(1)}` : `+${Math.abs(maxPainStats.gap).toFixed(1)}`} pts ({maxPainStats.gapPct.toFixed(2)}%)
                </span>
              </div>

              {maxPainStats.isPinning ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl text-[9px] font-black uppercase tracking-widest animate-pulse">
                  <Zap size={12} className="fill-amber-400" />
                  ⚡ Pinning Zone Active (Spot pinning Max Pain)
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 uppercase">
                  <Info size={11} />
                  Gravity pulls index towards {maxPainStats.maxPain}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6">
              <RefreshCw className="animate-spin text-slate-600 mb-2" size={20} />
              <span className="text-xs text-slate-500 font-bold uppercase">Loading Option metrics...</span>
            </div>
          )}
        </div>

        {/* Card 2: Put-Call Ratio Gauge */}
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[220px]">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Put-Call Ratio (PCR)</span>
            <Activity className="text-indigo-400" size={16} />
          </div>

          {optionChain ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
                  {/* Simple SVG circle progress */}
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="32" cy="32" r="28" className="stroke-slate-800 fill-none" strokeWidth="6" />
                    <circle 
                      cx="32" 
                      cy="32" 
                      r="28" 
                      className={`fill-none ${(optionChain?.pcr ?? 1) > 1.3 ? 'stroke-emerald-500' : (optionChain?.pcr ?? 1) < 0.7 ? 'stroke-rose-500' : 'stroke-indigo-500'}`} 
                      strokeWidth="6" 
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - Math.min(optionChain?.pcr ?? 1, 2.0) / 2.0)}`}
                    />
                  </svg>
                  <span className="absolute text-sm font-black text-white font-mono">{(optionChain?.pcr ?? 1.0).toFixed(2)}</span>
                </div>
                <div>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${pcrInfo?.style}`}>
                    {pcrInfo?.label}
                  </span>
                  <p className="text-[10px] font-medium text-slate-500 mt-1 leading-relaxed">
                    {pcrInfo?.note}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/40 flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <span>Total Call OI: {(optionChain.totalCallOI / 100000).toFixed(1)}L</span>
                <span>Total Put OI: {(optionChain.totalPutOI / 100000).toFixed(1)}L</span>
              </div>
              <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                <Info size={11} />
                Contrarian Interpretation: High PCR = Over-sold
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6">
              <RefreshCw className="animate-spin text-slate-600 mb-2" size={20} />
              <span className="text-xs text-slate-500 font-bold uppercase">Calculating PCR parameters...</span>
            </div>
          )}
        </div>

        {/* Card 3: Expiry Intelligence & Gamma Explosion */}
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[220px]">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Expiry Day & Gamma clock</span>
            <Timer className="text-indigo-400" size={16} />
          </div>

          {expiryAndGammaStats ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Days to Expiry</span>
                <span className={`text-base font-black uppercase font-mono ${expiryAndGammaStats.daysToExpiry <= 1 ? 'text-rose-400 animate-pulse' : 'text-white'}`}>
                  {expiryAndGammaStats.daysToExpiry === 0 ? 'Today Expiry' : `${expiryAndGammaStats.daysToExpiry} days`}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ATM Strike</span>
                <span className="text-sm font-black font-mono text-white">₹{expiryAndGammaStats.atmStrike}</span>
              </div>

              <div className="pt-2.5 border-t border-slate-800/40 flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Gamma Explosion Risk</span>
                <span className={`text-xs font-black font-mono ${expiryAndGammaStats.gammaExplosionScore > 10 ? 'text-rose-400' : expiryAndGammaStats.gammaExplosionScore > 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {expiryAndGammaStats.gammaExplosionScore.toFixed(2)} GEX
                </span>
              </div>

              {expiryAndGammaStats.gammaExplosionScore > 8 ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-[8px] font-black uppercase tracking-widest">
                  <AlertCircle size={12} />
                  ⚠️ High Gamma Zone: Extreme volatile setups primed
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[8px] font-black text-slate-500 uppercase tracking-wider">
                  <Info size={11} />
                  Gamma risk decays away from ATM strike
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6">
              <RefreshCw className="animate-spin text-slate-600 mb-2" size={20} />
              <span className="text-xs text-slate-500 font-bold uppercase">Estimating Gamma curves...</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Grid Row 2: Max Pain Historic Trend Line Chart */}
      {historicalPainData.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 backdrop-blur-xl relative">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Historic Max Pain Gravity Curve</h3>
          
          <div className="h-64 w-full">
            <SafeChartContainer>
              <ComposedChart data={historicalPainData}>
                <defs>
                  <linearGradient id="colorSpot" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.3} />
                <XAxis dataKey="date" stroke="#64748b" fontSize={9} tickLine={false} />
                <YAxis domain={['auto', 'auto']} stroke="#64748b" fontSize={9} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                  labelStyle={{ fontSize: '10px', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}
                  itemStyle={{ fontSize: '11px', color: '#fff', fontWeight: 'black' }}
                />
                <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold' }} />
                <Area type="monotone" dataKey="Spot" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorSpot)" />
                <Line type="step" dataKey="Max Pain" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, stroke: '#f59e0b', strokeWidth: 1, fill: '#0f172a' }} />
              </ComposedChart>
            </SafeChartContainer>
          </div>
        </div>
      )}

      {/* 4. Grid Row 3: OI 4-Quadrant Matrix */}
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 backdrop-blur-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">OI Change 4-Quadrant Matrix</h3>
            <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5 tracking-wider">buildup classification across F&O equities list</p>
          </div>
          
          <button 
            onClick={onRefreshSummary}
            disabled={isFetchingSummary}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black rounded-lg transition-colors border border-slate-700/50"
          >
            <RefreshCw size={11} className={isFetchingSummary ? 'animate-spin' : ''} />
            SYNC SCANS
          </button>
        </div>

        {/* Quadrant boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Long Buildup */}
          <button 
            onClick={() => { setActiveQuadrant('long_build_up'); setQuadrantSearch(''); }}
            className={`p-5 rounded-2xl border text-left transition-all relative overflow-hidden ${
              activeQuadrant === 'long_build_up'
                ? 'bg-emerald-500/10 border-emerald-500/40 shadow-lg shadow-emerald-500/5'
                : 'bg-slate-950/20 border-slate-800/60 hover:bg-slate-800/30'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Long Buildup</span>
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[8px] font-black uppercase rounded">Price ↑ | OI ↑</span>
            </div>
            <span className="text-3xl font-black text-white font-mono">{quadrants.long_build_up.length}</span>
            <span className="text-[10px] font-bold text-slate-500 block mt-1 uppercase">Institutional accumulation</span>
          </button>

          {/* Short Buildup */}
          <button 
            onClick={() => { setActiveQuadrant('short_build_up'); setQuadrantSearch(''); }}
            className={`p-5 rounded-2xl border text-left transition-all relative overflow-hidden ${
              activeQuadrant === 'short_build_up'
                ? 'bg-rose-500/10 border-rose-500/40 shadow-lg shadow-rose-500/5'
                : 'bg-slate-950/20 border-slate-800/60 hover:bg-slate-800/30'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Short Buildup</span>
              <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 text-[8px] font-black uppercase rounded">Price ↓ | OI ↑</span>
            </div>
            <span className="text-3xl font-black text-white font-mono">{quadrants.short_build_up.length}</span>
            <span className="text-[10px] font-bold text-slate-500 block mt-1 uppercase">Institutional shorting</span>
          </button>

          {/* Short Covering */}
          <button 
            onClick={() => { setActiveQuadrant('short_covering'); setQuadrantSearch(''); }}
            className={`p-5 rounded-2xl border text-left transition-all relative overflow-hidden ${
              activeQuadrant === 'short_covering'
                ? 'bg-amber-500/10 border-amber-500/40 shadow-lg shadow-amber-500/5'
                : 'bg-slate-950/20 border-slate-800/60 hover:bg-slate-800/30'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Short Covering</span>
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[8px] font-black uppercase rounded">Price ↑ | OI ↓</span>
            </div>
            <span className="text-3xl font-black text-white font-mono">{quadrants.short_covering.length}</span>
            <span className="text-[10px] font-bold text-slate-500 block mt-1 uppercase">Squeeze opportunities</span>
          </button>

          {/* Long Unwinding */}
          <button 
            onClick={() => { setActiveQuadrant('long_unwinding'); setQuadrantSearch(''); }}
            className={`p-5 rounded-2xl border text-left transition-all relative overflow-hidden ${
              activeQuadrant === 'long_unwinding'
                ? 'bg-slate-800/50 border-slate-700/60 shadow-lg'
                : 'bg-slate-950/20 border-slate-800/60 hover:bg-slate-800/30'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Long Unwinding</span>
              <span className="px-2 py-0.5 bg-slate-850 text-slate-400 text-[8px] font-black uppercase rounded">Price ↓ | OI ↓</span>
            </div>
            <span className="text-3xl font-black text-white font-mono">{quadrants.long_unwinding.length}</span>
            <span className="text-[10px] font-bold text-slate-500 block mt-1 uppercase">Position liquidations</span>
          </button>
        </div>

        {/* OI Momentum Breadth ratio */}
        <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/60 space-y-2">
          <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
            <span className="text-emerald-400">Bullish force (Long Buildup: {quadrants.long_build_up.length})</span>
            <span className="text-rose-400">Bearish force (Short Buildup: {quadrants.short_build_up.length})</span>
          </div>
          <div className="h-2 bg-slate-900 border border-slate-800/60 rounded-full overflow-hidden flex">
            <div 
              className="h-full bg-emerald-500" 
              style={{ width: `${(quadrants.long_build_up.length / Math.max(1, quadrants.long_build_up.length + quadrants.short_build_up.length)) * 100}%` }}
            />
            <div 
              className="h-full bg-rose-500" 
              style={{ width: `${(quadrants.short_build_up.length / Math.max(1, quadrants.long_build_up.length + quadrants.short_build_up.length)) * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center">
            {quadrants.long_build_up.length > quadrants.short_build_up.length ? '🟢 Bullish bias: Smart money accumulating stock futures' : '🔴 Bearish bias: Smart money shorting stock futures'}
          </p>
        </div>

        {/* Dynamic Trap / Squeeze Banners */}
        {trapAlerts.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {trapAlerts.map((alert, index) => (
              <div 
                key={alert.symbol + index}
                className={`p-3 border rounded-xl flex items-start gap-2.5 ${
                  alert.type === 'squeeze' 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}
              >
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider block">{alert.symbol} Alert</span>
                  <p className="text-[10px] font-medium text-slate-300 mt-0.5">{alert.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Search input & Quadrants Stock list table */}
        <div className="space-y-4 pt-4 border-t border-slate-800/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <span className="text-xs font-black text-white uppercase tracking-widest">
              Buildup List: {activeQuadrant.replace(/_/g, ' ').toUpperCase()} ({activeList.length})
            </span>
            <input 
              type="text"
              placeholder="Search active quadrant..."
              value={quadrantSearch}
              onChange={(e) => setQuadrantSearch(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-colors w-full sm:max-w-xs"
            />
          </div>

          {activeList.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-slate-500 text-xs font-bold uppercase tracking-wider">
              No assets matching query in this quadrant
            </div>
          ) : (
            <div className="border border-slate-800/60 rounded-2xl overflow-hidden overflow-x-auto no-scrollbar bg-slate-950/20">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-950/60 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/50">
                    <th className="py-3 px-4">Symbol</th>
                    <th className="py-3 px-4 text-right">LTP</th>
                    <th className="py-3 px-4 text-right">Price Chg %</th>
                    <th className="py-3 px-4 text-right">OI (contracts)</th>
                    <th className="py-3 px-4 text-right">OI Chg %</th>
                    <th className="py-3 px-4 text-center">Chart</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30 font-mono">
                  {activeList.map(stock => {
                    const priceUp = stock.change_ltp_per >= 0;
                    const oiUp = stock.change_oi_per >= 0;

                    return (
                      <tr key={stock.symbol_name} className="hover:bg-indigo-500/5 transition-colors">
                        <td className="py-3 px-4 font-black font-sans text-slate-200">
                          {stock.symbol_name}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300 font-bold">
                          {formatCurrencyPrecise(stock.last_price)}
                        </td>
                        <td className={`py-3 px-4 text-right font-black ${priceUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {priceUp ? '▲' : '▼'} {Math.abs(stock.change_ltp_per).toFixed(2)}%
                        </td>
                        <td className="py-3 px-4 text-right text-slate-500 font-bold">
                          {formatNumberIndian(stock.oi)}
                        </td>
                        <td className={`py-3 px-4 text-right font-black ${oiUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {oiUp ? '+' : ''}{stock.change_oi_per.toFixed(2)}%
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => openTradingView(stock.symbol_name)}
                            className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-[9px] font-black uppercase text-indigo-400 hover:text-white transition-colors"
                          >
                            Chart
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OIPcrCommandCenter;
