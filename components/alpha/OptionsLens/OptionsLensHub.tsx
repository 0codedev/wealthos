import React, { useEffect, useState, useMemo } from 'react';
import { optionChainService, OptionChainSnapshot } from '../../../services/OptionChainService';
import { quantGreeksService, GEXData } from '../../../services/QuantGreeksService';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, ResponsiveContainer } from 'recharts';
import { Activity, ShieldCheck, Flame, RefreshCw, Layers, ArrowUpRight, ArrowDownRight, Compass } from 'lucide-react';
import { CHART_COLORS, CHART_DEFAULTS } from '../../../utils/chartTheme';
import { HeroZeroScannerCard } from './HeroZeroScannerCard';

export interface OptionsLensHubProps {
  defaultSymbol?: 'NIFTY' | 'BANKNIFTY';
  onStrikeSelect?: (strike: number) => void;
}

export const OptionsLensHub: React.FC<OptionsLensHubProps> = ({
  defaultSymbol = 'NIFTY',
  onStrikeSelect
}) => {
  const [symbol, setSymbol] = useState<'NIFTY' | 'BANKNIFTY'>(defaultSymbol);
  const [snapshot, setSnapshot] = useState<OptionChainSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const lotSize = symbol === 'BANKNIFTY' ? 15 : 25;

  const loadChain = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const snap = await optionChainService.fetchOptionChain(symbol);
      setSnapshot(snap);
    } catch (err) {
      console.error('OptionsLensHub: Failed to load option chain', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadChain();
    const interval = setInterval(() => loadChain(), 15000); // 15s refresh
    return () => clearInterval(interval);
  }, [symbol]);

  // Compute GEX and Walls
  const gexAnalysis = useMemo(() => {
    if (!snapshot || !snapshot.strikes || snapshot.strikes.length === 0) return null;
    const spot = snapshot.underlyingValue || 0;
    const gexData = quantGreeksService.computeGEX(snapshot, lotSize, spot);

    // Strike level GEX series
    let callWallStrike = 0;
    let maxCallGex = -Infinity;
    let putWallStrike = 0;
    let maxPutGex = -Infinity;

    const strikesData = snapshot.strikes.map(row => {
      const ce = row.CE;
      const pe = row.PE;
      const k = row.strikePrice;

      // Dealer convention: Call OI = negative dealer gamma, Put OI = positive dealer gamma (or vice-versa depending on framing)
      // Standard aggregate dealer GEX per strike:
      // Dealer GEX = Put Gamma * Put OI * Spot * LotSize - Call Gamma * Call OI * Spot * LotSize
      const ceGamma = ce?.gamma ?? 0;
      const peGamma = pe?.gamma ?? 0;
      const ceOI = ce?.oi ?? 0;
      const peOI = pe?.oi ?? 0;

      const callGex = (ceGamma * ceOI * spot * lotSize) / 1e7; // in Crores
      const putGex = (peGamma * peOI * spot * lotSize) / 1e7;
      const netStrikeGex = putGex - callGex;

      if (callGex > maxCallGex) {
        maxCallGex = callGex;
        callWallStrike = k;
      }
      if (putGex > maxPutGex) {
        maxPutGex = putGex;
        putWallStrike = k;
      }

      return {
        strike: k,
        callGex: Number(callGex.toFixed(2)),
        putGex: Number(putGex.toFixed(2)),
        netGex: Number(netStrikeGex.toFixed(2)),
        isAtm: Math.abs(k - spot) <= 50,
        isCallWall: false,
        isPutWall: false,
        isZeroGamma: k === gexData.zeroGammaLevel
      };
    });

    // Tag walls
    strikesData.forEach(d => {
      if (d.strike === callWallStrike) d.isCallWall = true;
      if (d.strike === putWallStrike) d.isPutWall = true;
    });

    // Filter to strike window around ATM (+/- 12 strikes)
    const sortedStrikes = [...strikesData].sort((a, b) => a.strike - b.strike);
    const atmIndex = sortedStrikes.findIndex(s => Math.abs(s.strike - spot) <= 50);
    const windowStart = Math.max(0, (atmIndex !== -1 ? atmIndex : Math.floor(sortedStrikes.length / 2)) - 12);
    const windowStrikes = sortedStrikes.slice(windowStart, windowStart + 25);

    return {
      spot,
      gexData,
      callWallStrike,
      putWallStrike,
      zeroGammaLevel: gexData.zeroGammaLevel,
      regime: gexData.regime,
      windowStrikes
    };
  }, [snapshot, lotSize]);

  if (isLoading && !snapshot) {
    return (
      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl p-6 border border-slate-800 animate-pulse h-[460px] flex flex-col items-center justify-center gap-3">
        <Activity className="w-10 h-10 text-indigo-400 animate-spin" />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Computing Institutional GEX Map...</span>
      </div>
    );
  }

  const spot = gexAnalysis?.spot ?? 0;
  const zeroGamma = gexAnalysis?.zeroGammaLevel ?? spot;
  const isAboveZeroGamma = spot >= zeroGamma;
  const isLongGamma = gexAnalysis?.regime === 'PINNING';

  return (
    <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl p-4 md:p-6 border border-slate-800/80 shadow-2xl flex flex-col gap-4">
      {/* Header controls & 3-Second Traffic Light */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
              Options Lens GEX Hub <Layers className="w-5 h-5 text-indigo-400" />
            </h3>
            <button
              type="button"
              onClick={() => loadChain(true)}
              className="p-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700 text-slate-300 transition-colors"
              title="Refresh GEX Surface"
            >
              <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-slate-400 text-xs mt-0.5 font-mono">
            Dealer Gamma Exposure, Zero-Gamma Flip ($S_0$) & Writing Walls
          </p>
        </div>

        {/* Index Selector + 3-Second Traffic Light */}
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          {/* Symbol switcher */}
          <div className="flex items-center bg-slate-950 rounded-lg p-0.5 border border-slate-800">
            {(['NIFTY', 'BANKNIFTY'] as const).map(sym => (
              <button
                key={sym}
                type="button"
                onClick={() => setSymbol(sym)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                  symbol === sym
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>

          {/* 3-Second Institutional Traffic Light */}
          <div
            className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 ${
              isLongGamma
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                : 'bg-rose-500/15 border-rose-500/30 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.15)] animate-pulse'
            }`}
          >
            {isLongGamma ? <ShieldCheck size={16} /> : <Flame size={16} />}
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-wider leading-tight">
                {isLongGamma ? '🟢 LONG GAMMA (PINNING)' : '🔴 SHORT GAMMA (TRENDING)'}
              </span>
              <span className="text-[8px] font-mono opacity-80 leading-tight">
                {isLongGamma ? 'Dealers buy dips / sell rips' : 'Dealers forced to chase moves'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Key Architectural Levels HUD */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
          <span className="text-[9px] uppercase font-bold text-slate-500 block">Spot Price</span>
          <span className="font-mono text-base font-black text-white">₹{spot.toFixed(1)}</span>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
          <span className="text-[9px] uppercase font-bold text-slate-500 block">Zero-Gamma ($S_0$)</span>
          <span className="font-mono text-base font-black text-amber-400">
            {zeroGamma > 0 ? `₹${zeroGamma}` : '--'}
          </span>
          <span className="text-[8px] font-mono text-slate-400 block mt-0.5">
            {isAboveZeroGamma ? '▲ Above Flip (Bull Bias)' : '▼ Below Flip (Bear Bias)'}
          </span>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
          <span className="text-[9px] uppercase font-bold text-slate-500 block">Call Wall (Ceiling)</span>
          <span className="font-mono text-base font-black text-rose-400">
            {gexAnalysis?.callWallStrike ? `₹${gexAnalysis.callWallStrike}` : '--'}
          </span>
          <span className="text-[8px] font-mono text-slate-400 block mt-0.5">Dealer Resistance Buffer</span>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
          <span className="text-[9px] uppercase font-bold text-slate-500 block">Put Wall (Floor)</span>
          <span className="font-mono text-base font-black text-emerald-400">
            {gexAnalysis?.putWallStrike ? `₹${gexAnalysis.putWallStrike}` : '--'}
          </span>
          <span className="text-[8px] font-mono text-slate-400 block mt-0.5">Dealer Support Absorption</span>
        </div>
      </div>

      {/* GEX Surface Bar Chart */}
      <div className="w-full h-[280px]">
        {gexAnalysis?.windowStrikes && gexAnalysis.windowStrikes.length > 0 ? (
          <SafeChartContainer>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={gexAnalysis.windowStrikes}
                margin={{ top: 15, right: 10, left: -10, bottom: 25 }}
              >
                <XAxis
                  dataKey="strike"
                  {...CHART_DEFAULTS.axis}
                  tick={({ x, y, payload }) => {
                    const strikeVal = Number(payload.value);
                    const isZero = strikeVal === zeroGamma;
                    const isCall = strikeVal === gexAnalysis.callWallStrike;
                    const isPut = strikeVal === gexAnalysis.putWallStrike;
                    let labelColor = '#94a3b8';
                    if (isZero) labelColor = '#fbbf24';
                    else if (isCall) labelColor = '#f43f5e';
                    else if (isPut) labelColor = '#10b981';

                    return (
                      <g transform={`translate(${x},${y})`}>
                        <text
                          x={0}
                          y={0}
                          dy={10}
                          textAnchor="middle"
                          fill={labelColor}
                          fontSize={9}
                          fontWeight={isZero || isCall || isPut ? 900 : 600}
                          className="font-mono cursor-pointer"
                          onClick={() => onStrikeSelect && onStrikeSelect(strikeVal)}
                        >
                          {strikeVal}
                          {isCall ? ' 🛑' : isPut ? ' 🛡️' : isZero ? ' ⚡' : ''}
                        </text>
                      </g>
                    );
                  }}
                  interval={0}
                />
                <YAxis
                  {...CHART_DEFAULTS.axis}
                  tickFormatter={val => `${val}Cr`}
                />
                <Tooltip
                  {...CHART_DEFAULTS.tooltip}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-slate-950/95 border border-slate-800 p-3 rounded-xl shadow-xl space-y-1 font-mono text-xs">
                        <div className="font-bold text-white border-b border-slate-800 pb-1">
                          Strike ₹{d.strike} {d.isAtm ? '(ATM)' : ''}
                        </div>
                        <div className="text-emerald-400">Put Gamma (Support): +₹{d.putGex} Cr</div>
                        <div className="text-rose-400">Call Gamma (Resistance): -₹{d.callGex} Cr</div>
                        <div className="text-slate-300 font-bold pt-1 border-t border-slate-800/60">
                          Net Dealer GEX: {d.netGex >= 0 ? '+' : ''}{d.netGex} Cr
                        </div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={0} stroke={CHART_DEFAULTS.grid.stroke} strokeDasharray={CHART_DEFAULTS.grid.strokeDasharray} />
                <Bar dataKey="netGex" radius={[3, 3, 0, 0]}>
                  {gexAnalysis.windowStrikes.map((entry, idx) => {
                    const isCall = entry.strike === gexAnalysis.callWallStrike;
                    const isPut = entry.strike === gexAnalysis.putWallStrike;
                    let fill = entry.netGex >= 0 ? 'rgba(16, 185, 129, 0.75)' : 'rgba(244, 63, 94, 0.75)';
                    if (isCall) fill = '#f43f5e';
                    if (isPut) fill = '#10b981';

                    return (
                      <Cell
                        key={`gex-cell-${idx}`}
                        fill={fill}
                        stroke={isCall || isPut ? '#ffffff' : 'transparent'}
                        strokeWidth={isCall || isPut ? 1.5 : 0}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </SafeChartContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xs font-mono text-slate-500">
            No strike data available for GEX map
          </div>
        )}
      </div>

      {/* 3-Second Action Prescription */}
      <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3 flex items-center gap-3">
        <Compass className="w-5 h-5 text-indigo-400 shrink-0" />
        <div className="text-xs text-slate-300">
          <strong className="text-white uppercase font-mono mr-1">Captain's 3-Second Action:</strong>
          {isLongGamma ? (
            <span>
              Dealers in <strong>Long Gamma</strong> ($S_0$ holds). Market is mean-reverting. <strong>Fade extremes</strong> near Put Wall ₹{gexAnalysis?.putWallStrike} / Call Wall ₹{gexAnalysis?.callWallStrike}. Do NOT chase breakouts.
            </span>
          ) : (
            <span className="text-rose-300">
              Dealers trapped in <strong>Short Gamma</strong> ($S_0$ breached). Trend acceleration & gamma squeeze active. <strong>Trend follow with the move</strong>; trail stops aggressively.
            </span>
          )}
        </div>
      </div>

      {/* 2:00 PM Hero-Zero Gamma Explosion Scanner & 52-Week IV Rank Engine */}
      <HeroZeroScannerCard
        symbol={symbol}
        onStrikeSelect={(strike) => onStrikeSelect?.(strike)}
      />
    </div>
  );
};
