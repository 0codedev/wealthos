import React, { useEffect, useMemo, useState } from 'react';
import {
  Dna, Sparkles, RefreshCw, ShieldAlert, Activity, TrendingUp, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Investment, DNAReport, FactorExposure, RiskProfile, RebalancePlan } from '../../types';
import { portfolioDNAService } from '../../services/PortfolioDNAService';
import { CorrelationHeatmap } from './CorrelationHeatmap';
import { SmartRebalancePanel } from './SmartRebalancePanel';
import { formatCurrency } from '../../utils/helpers';
import { EmptyState } from '../shared/EmptyState';

interface PortfolioDNAProps {
  investments: Investment[];
}

// ============================================================
// Custom 5-axis SVG Radar
// ============================================================

interface CustomRadarProps {
  exposures: { label: string; value: number; raw: number; fullMark: number }[];
  size?: number;
  highlightAxis?: number | null;
  onHoverAxis?: (idx: number | null) => void;
}

const CustomRadar: React.FC<CustomRadarProps> = ({ exposures, size = 240, highlightAxis, onHoverAxis }) => {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;
  const axes = exposures.length;
  const angleStep = (Math.PI * 2) / axes;
  const offset = -Math.PI / 2; // start at top

  const polar = (idx: number, valueFrac: number) => {
    const angle = offset + idx * angleStep;
    const r = radius * valueFrac;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  };

  // Path string for the data polygon
  const dataPath = exposures
    .map((e, i) => {
      const v = Math.max(0, Math.min(1, e.value / e.fullMark));
      const p = polar(i, v);
      return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    })
    .join(' ')
    .concat(' Z');

  // Animated stroke-dasharray for reveal
  const [dashOffset, setDashOffset] = useState(radius * 4);
  useEffect(() => {
    const id = setTimeout(() => setDashOffset(0), 50);
    return () => clearTimeout(id);
  }, [dataPath]);

  return (
    <svg width={size} height={size} className="select-none">
      <defs>
        <linearGradient id="radar-fill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="radar-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>

      {/* Concentric grid rings (4 levels) */}
      {[0.25, 0.5, 0.75, 1].map((lvl, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={radius * lvl}
          fill="none"
          stroke="#1e293b"
          strokeWidth={1}
          strokeDasharray={i === 3 ? '0' : '2 3'}
          opacity={0.7}
        />
      ))}

      {/* Axes */}
      {exposures.map((e, i) => {
        const p = polar(i, 1);
        const isHi = highlightAxis === i;
        return (
          <g
            key={e.label}
            onMouseEnter={() => onHoverAxis?.(i)}
            onMouseLeave={() => onHoverAxis?.(null)}
            className="cursor-pointer"
          >
            <line
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              stroke={isHi ? '#6366f1' : '#334155'}
              strokeWidth={isHi ? 1.5 : 0.6}
              opacity={isHi ? 1 : 0.5}
            />
            <text
              x={p.x}
              y={p.y}
              dx={p.x > cx ? 6 : p.x < cx ? -6 : 0}
              dy={p.y > cy ? 12 : -4}
              textAnchor={p.x > cx ? 'start' : p.x < cx ? 'end' : 'middle'}
              className={`text-[9px] font-mono font-bold transition-colors ${
                isHi ? 'fill-indigo-300' : 'fill-slate-500'
              }`}
            >
              {e.label}
            </text>
          </g>
        );
      })}

      {/* Data polygon */}
      <path
        d={dataPath}
        fill="url(#radar-fill)"
        stroke="url(#radar-stroke)"
        strokeWidth={1.6}
        strokeLinejoin="round"
        style={{
          transition: 'stroke-dashoffset 0.9s ease-out',
          strokeDasharray: radius * 4,
          strokeDashoffset: dashOffset
        }}
      />

      {/* Data point dots */}
      {exposures.map((e, i) => {
        const v = Math.max(0, Math.min(1, e.value / e.fullMark));
        const p = polar(i, v);
        return (
          <circle
            key={`dot-${i}`}
            cx={p.x}
            cy={p.y}
            r={3}
            fill="#a5b4fc"
            stroke="#0f172a"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
};

// ============================================================
// Sharpe frontier mini-chart
// ============================================================

interface FrontierMiniChartProps {
  currentVol: number;
  currentRet: number;
  points: { volatility: number; expectedReturn: number; sharpe: number }[];
}

const FrontierMiniChart: React.FC<FrontierMiniChartProps> = ({ currentVol, currentRet, points }) => {
  const w = 240, h = 110, padding = 12;
  if (points.length < 2) {
    return <div className="text-[10px] text-slate-500 font-mono text-center py-6">Frontier unavailable</div>;
  }
  const allVols = [...points.map(p => p.volatility), currentVol];
  const allRets = [...points.map(p => p.expectedReturn), currentRet];
  const minV = Math.min(...allVols), maxV = Math.max(...allVols);
  const minR = Math.min(...allRets), maxR = Math.max(...allRets);
  const spanV = Math.max(0.01, maxV - minV);
  const spanR = Math.max(0.01, maxR - minR);

  const x = (v: number) => padding + ((v - minV) / spanV) * (w - 2 * padding);
  const y = (r: number) => h - padding - ((r - minR) / spanR) * (h - 2 * padding);

  // Find max-Sharpe point
  const maxSharpe = points.reduce((m, p) => p.sharpe > m.sharpe ? p : m, points[0]);

  // Build smooth-ish path
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.volatility).toFixed(1)} ${y(p.expectedReturn).toFixed(1)}`)
    .join(' ');

  return (
    <svg width={w} height={h} className="block">
      <defs>
        <linearGradient id="frontier-grad" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${x(points[points.length - 1].volatility)} ${h - padding} L ${x(points[0].volatility)} ${h - padding} Z`} fill="url(#frontier-grad)" />
      <path d={path} stroke="#818cf8" strokeWidth={1.5} fill="none" />
      {/* Max-Sharpe point */}
      <circle cx={x(maxSharpe.volatility)} cy={y(maxSharpe.expectedReturn)} r={3.5} fill="#10b981" stroke="#0f172a" strokeWidth={1.2} />
      {/* Current portfolio */}
      <circle cx={x(currentVol)} cy={y(currentRet)} r={4.5} fill="#f43f5e" stroke="#fff" strokeWidth={1.4} />
      <text x={x(currentVol) + 6} y={y(currentRet) - 4} className="text-[8px] font-mono fill-rose-300 font-bold">YOU</text>
      <text x={x(maxSharpe.volatility) + 6} y={y(maxSharpe.expectedReturn) + 10} className="text-[8px] font-mono fill-emerald-300 font-bold">MAX</text>
      <text x={padding} y={h - 2} className="text-[7px] font-mono fill-slate-600">σ-axis</text>
      <text x={w - 30} y={10} className="text-[7px] font-mono fill-slate-600">μ-axis</text>
    </svg>
  );
};

// ============================================================
// Main component
// ============================================================

const RISK_PROFILES: { id: RiskProfile; label: string; tag: string }[] = [
  { id: 'conservative', label: 'Conservative', tag: 'β 0.6–0.8' },
  { id: 'balanced', label: 'Balanced', tag: 'β 0.9–1.1' },
  { id: 'aggressive', label: 'Aggressive', tag: 'β 1.2–1.5' }
];

export const PortfolioDNA: React.FC<PortfolioDNAProps> = ({ investments }) => {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DNAReport | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [hoverAxis, setHoverAxis] = useState<number | null>(null);
  const [profile, setProfile] = useState<RiskProfile>('balanced');
  const [rebalancePlan, setRebalancePlan] = useState<RebalancePlan | null>(null);

  const runDeepScan = async () => {
    try {
      setLoading(true);
      const dnaReport = await portfolioDNAService.generateDNAReport(investments);
      setReport(dnaReport);
      if (dnaReport.factorExposures.length > 0) {
        setSelectedAsset(dnaReport.factorExposures[0].ticker);
      }
    } catch (e) {
      console.warn('PortfolioDNA: deep scan failed', e);
    } finally {
      setLoading(false);
    }
  };

  // Recompute rebalance plan in real-time when profile or report changes
  useEffect(() => {
    if (!report) {
      setRebalancePlan(null);
      return;
    }
    const plan = portfolioDNAService.generateRebalancePlan(investments, profile, report);
    setRebalancePlan(plan);
  }, [profile, report, investments]);

  const selectedExposure = report?.factorExposures.find(e => e.ticker === selectedAsset);

  // 5-axis radar data for the custom SVG radar
  const radarData = useMemo(() => {
    if (!selectedExposure) return [];
    return [
      { label: 'Market β',  value: Math.min(100, Math.max(0, (selectedExposure.beta + 0.5) * 50)),  raw: selectedExposure.beta, fullMark: 100 },
      { label: 'Jensen α',  value: Math.min(100, Math.max(0, (selectedExposure.alpha + 5) * 10)),   raw: selectedExposure.alpha, fullMark: 100 },
      { label: 'SMB Size',  value: Math.min(100, Math.max(0, (selectedExposure.smbLoading + 1) * 50)), raw: selectedExposure.smbLoading, fullMark: 100 },
      { label: 'HML Value', value: Math.min(100, Math.max(0, (selectedExposure.hmlLoading + 1) * 50)), raw: selectedExposure.hmlLoading, fullMark: 100 },
      { label: 'Sharpe',    value: Math.min(100, Math.max(0, (selectedExposure.sharpe + 0.5) * 40)),   raw: selectedExposure.sharpe, fullMark: 100 },
    ];
  }, [selectedExposure]);

  // Compute the live frontier
  const frontier = useMemo(() => {
    if (!report || investments.length === 0) return null;
    const equity = investments.filter(i => i.ticker);
    if (equity.length < 2) return null;
    // We don't have raw returns here, so synthesize from factor exposures
    // The MiniChart will degrade gracefully if points is empty.
    return portfolioDNAService.computeFullFrontier(equity, []);
  }, [report, investments]);

  // Current portfolio position on the frontier (weighted)
  const currentPortfolio = useMemo(() => {
    if (!report) return { vol: 0, ret: 0 };
    const total = investments.reduce((s, h) => s + h.currentValue, 0) || 1;
    let vol = 0, ret = 0;
    for (const e of report.factorExposures) {
      const h = investments.find(i => i.ticker === e.ticker);
      if (!h) continue;
      const w = h.currentValue / total;
      vol += e.volatility * w;
      ret += e.sharpe * e.volatility * w / 100; // rough proxy for return
    }
    return { vol, ret };
  }, [report, investments]);

  // Pillar 3A: friendly empty state when portfolio has <2 equity holdings
  if (investments.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
        <EmptyState
          type="no-investments"
          title="No investments yet"
          message="Add at least two equity holdings to generate a portfolio DNA report."
        />
      </motion.div>
    );
  }

  // Double Helix SVG Drawing helper
  const renderDoubleHelix = () => {
    if (!report || report.factorExposures.length === 0) return null;

    const exposures = report.factorExposures;
    const width = 280;
    const height = 400;
    const paddingY = 40;
    const rungsCount = exposures.length;
    const step = rungsCount > 1 ? (height - paddingY * 2) / (rungsCount - 1) : 0;

    const leftStrandPoints: string[] = [];
    const rightStrandPoints: string[] = [];

    exposures.forEach((exp, idx) => {
      const t = idx * 1.4; // twist frequency
      const y = paddingY + idx * step;
      const xOffset = Math.sin(t) * 60;

      const leftX = width / 2 - xOffset;
      const rightX = width / 2 + xOffset;

      leftStrandPoints.push(`${leftX},${y}`);
      rightStrandPoints.push(`${rightX},${y}`);
    });

    return (
      <svg width={width} height={height} className="mx-auto select-none">
        <defs>
          <linearGradient id="helix-left" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id="helix-right" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>

        {exposures.map((exp, idx) => {
          const t = idx * 1.4;
          const y = paddingY + idx * step;
          const xOffset = Math.sin(t) * 60;
          const leftX = width / 2 - xOffset;
          const rightX = width / 2 + xOffset;

          const rungColor = exp.beta > 1.2
            ? 'stroke-rose-500/70'
            : exp.beta > 0.8
              ? 'stroke-indigo-500/60'
              : 'stroke-emerald-500/70';

          const isSelected = selectedAsset === exp.ticker;

          return (
            <g key={exp.ticker} className="cursor-pointer group" onClick={() => setSelectedAsset(exp.ticker)}>
              <line
                x1={leftX}
                y1={y}
                x2={rightX}
                y2={y}
                className={`stroke-2 ${rungColor} transition-all duration-300 ${
                  isSelected ? 'stroke-[4px] opacity-100' : 'opacity-40 group-hover:opacity-85'
                }`}
              />

              <circle
                cx={leftX}
                cy={y}
                r={isSelected ? 7 : 5}
                className="fill-indigo-500 stroke-slate-950 stroke-2 transition-transform duration-200 group-hover:scale-125"
              />

              <circle
                cx={rightX}
                cy={y}
                r={isSelected ? 7 : 5}
                className="fill-emerald-500 stroke-slate-950 stroke-2 transition-transform duration-200 group-hover:scale-125"
              />

              <text
                x={width / 2}
                y={y + 4}
                className={`text-[9px] font-mono font-bold text-center transition-colors ${
                  isSelected ? 'fill-indigo-300' : 'fill-slate-500 group-hover:fill-slate-300'
                }`}
                textAnchor="middle"
              >
                {exp.ticker}
              </text>
            </g>
          );
        })}

        {leftStrandPoints.length > 1 && (
          <path
            d={`M ${leftStrandPoints.join(' L ')}`}
            fill="none"
            stroke="url(#helix-left)"
            strokeWidth="3"
            className="opacity-75"
          />
        )}

        {rightStrandPoints.length > 1 && (
          <path
            d={`M ${rightStrandPoints.join(' L ')}`}
            fill="none"
            stroke="url(#helix-right)"
            strokeWidth="3"
            className="opacity-75"
          />
        )}
      </svg>
    );
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-indigo-500/5 via-sky-500/0 to-transparent" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-white flex items-center gap-2">
            <Dna className="w-5 h-5 text-indigo-400" />
            Portfolio DNA Map
            <span className="px-2 py-0.5 text-[9px] font-black uppercase rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono tracking-wider animate-pulse">
              4-Factor OLS
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Multivariable regression over daily returns: Market + SMB + HML + Momentum. Discover your risk genome and receive a tax-aware rebalance plan.
          </p>
        </div>

        <button
          onClick={runDeepScan}
          disabled={loading}
          className="flex items-center justify-center gap-2 py-2.5 px-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-600/20 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {report ? 'Re-Run Deep Scan' : 'Run Deep Scan'}
        </button>
      </div>

      {!report && !loading && (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-900/20 border border-dashed border-slate-800 rounded-2xl text-center">
          <Dna className="w-12 h-12 text-slate-600 mb-4 animate-bounce" />
          <p className="text-sm font-bold text-slate-400">Deep Scan Ready</p>
          <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
            Click 'Run Deep Scan' to download 252 market sessions of OHLCV data per holding and reconstruct your portfolio's risk DNA.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-900/20 border border-slate-800/50 rounded-2xl text-center">
          <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin mb-4" />
          <p className="text-sm font-bold text-slate-300">Reconstructing Risk DNA...</p>
          <p className="text-xs text-slate-500 mt-1 animate-pulse">
            Solving 4-factor XᵀX inversion · rolling momentum series · frontier optimization.
          </p>
        </div>
      )}

      {report && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10 animate-in fade-in duration-300">

          {/* Left Column: DNA Helix and Gauges */}
          <div className="lg:col-span-5 flex flex-col items-center justify-between bg-slate-900/30 border border-slate-800/80 rounded-2xl p-5">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest self-start">
              Portfolio Gene Sequence
            </h4>

            <div className="my-4 relative">
              {renderDoubleHelix()}
              <div className="absolute inset-x-0 bottom-2 text-center text-[9px] text-slate-500 font-mono">
                Click rungs to analyze individual asset loading
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 w-full pt-4 border-t border-slate-800/50 text-center">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/50">
                <span className="text-[9px] font-black text-slate-500 uppercase block tracking-wider mb-0.5">Concentration</span>
                <span className={`text-lg font-black ${report.concentrationScore > 40 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {report.concentrationScore}%
                </span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/50">
                <span className="text-[9px] font-black text-slate-500 uppercase block tracking-wider mb-0.5">Diversification</span>
                <span className={`text-lg font-black ${report.diversificationScore > 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {report.diversificationScore}%
                </span>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-7 space-y-4">

            {/* Custom 5-axis Radar + Sharpe frontier mini-chart */}
            {selectedExposure ? (
              <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-5">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">
                      5-Axis Factor Attribution
                    </span>
                    <strong className="text-sm text-indigo-300 tracking-tight font-black">
                      {selectedAsset} · 4-Factor OLS
                    </strong>
                    {hoverAxis !== null && radarData[hoverAxis] && (
                      <div className="mt-2 text-[10px] font-mono text-slate-400">
                        <span className="text-indigo-400 font-bold">{radarData[hoverAxis].label}:</span>{' '}
                        <span className="text-slate-200">{radarData[hoverAxis].raw.toFixed(2)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-[10px] font-mono">
                    <div className="flex flex-col">
                      <span className="text-slate-500">β</span>
                      <span className="font-bold text-white">{selectedExposure.beta}</span>
                    </div>
                    <div className="w-px h-5 bg-slate-800" />
                    <div className="flex flex-col">
                      <span className="text-slate-500">σ</span>
                      <span className="font-bold text-rose-400">{selectedExposure.volatility}%</span>
                    </div>
                    <div className="w-px h-5 bg-slate-800" />
                    <div className="flex flex-col">
                      <span className="text-slate-500">Sharpe</span>
                      <span className="font-bold text-emerald-400">{selectedExposure.sharpe}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div className="h-56 flex items-center justify-center">
                    <CustomRadar
                      exposures={radarData}
                      highlightAxis={hoverAxis}
                      onHoverAxis={setHoverAxis}
                      size={230}
                    />
                  </div>

                  <div className="bg-slate-950/50 border border-slate-800/50 rounded-xl p-3">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">
                      Sharpe Frontier
                    </span>
                    <FrontierMiniChart
                      currentVol={currentPortfolio.vol}
                      currentRet={currentPortfolio.ret}
                      points={frontier || []}
                    />
                    <p className="text-[9px] text-slate-500 font-mono mt-2 leading-tight">
                      YOU vs optimal frontier · red dot = current · green = max-Sharpe
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/10 border border-slate-800/80 rounded-2xl p-5 text-center text-xs text-slate-500">
                Select an asset in the helix map to view factor radar.
              </div>
            )}

            {/* Correlation Heatmap */}
            <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-5">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-3">
                Pairwise Pearson Correlation
              </span>
              <CorrelationHeatmap correlation={report.correlationMatrix} />
            </div>

            {/* Risk DNA Insights */}
            {report.riskInsights.length > 0 && (
              <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-5 space-y-3">
                <span className="text-[10px] font-black text-indigo-400 flex items-center gap-1 uppercase tracking-wider">
                  <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" />
                  DNA Risk Anomalies
                </span>
                <div className="space-y-2 text-xs text-slate-400 font-medium">
                  {report.riskInsights.map((insight, idx) => (
                    <div key={idx} className="flex items-start gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-900">
                      <AlertCircle className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                      <span>{insight}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* PHASE 3 — Risk Profile Slider + Smart Rebalance Panel         */}
      {/* ============================================================ */}
      {report && !loading && (
        <div className="relative z-10 space-y-4 pt-4 border-t border-slate-800/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-black text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                Smart Rebalance Engine
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Tax-aware lot selection · targets a {profile} risk profile
              </p>
            </div>

            {/* Glassmorphic 3-position slider */}
            <div className="relative inline-flex items-center p-1 bg-slate-900/70 border border-slate-800 rounded-2xl shadow-inner">
              {RISK_PROFILES.map(p => {
                const isActive = profile === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setProfile(p.id)}
                    className={`relative z-10 px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-colors ${
                      isActive ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="risk-profile-thumb"
                        className="absolute inset-0 bg-gradient-to-br from-indigo-500/80 to-emerald-500/80 rounded-xl shadow-lg shadow-indigo-500/30"
                        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10 flex flex-col items-center">
                      <span>{p.label}</span>
                      <span className="text-[8px] font-mono opacity-70">{p.tag}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={profile}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <SmartRebalancePanel
                investments={investments}
                plan={rebalancePlan}
                profile={profile}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
export default PortfolioDNA;
