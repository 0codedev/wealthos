import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Sliders, Play, RefreshCw, AlertCircle, Award,
  BarChart2, TrendingUp, TrendingDown, Layers, ShieldCheck,
  CheckCircle2, ArrowUpRight, Cpu, Sparkles, Activity, Download,
  Copy, Check, Target, Compass
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import { SafeChartContainer } from '../shared/SafeChartContainer';

export type StrategyType = 'ema_cross' | 'sma_cross' | 'rsi' | 'donchian';
export type HeatmapMetricType = 'return' | 'sharpe' | 'win_rate' | 'profit_factor' | 'max_dd';

interface OptimizeResult {
  status: string;
  symbol: string;
  strategy?: string;
  combinations_tested: number;
  best_by_return: {
    fast_ma: number;
    slow_ma: number;
    return_pct: number;
    sharpe?: number;
  };
  best_by_sharpe: {
    fast_ma: number;
    slow_ma: number;
    sharpe: number;
    return_pct?: number;
  };
  robustness?: {
    score: number;
    status: string;
    best_params: string;
    neighborhood_size: number;
  };
  heatmap_returns: Record<string, number>;
  heatmap_sharpe: Record<string, number>;
  heatmap_win_rate?: Record<string, number>;
  heatmap_profit_factor?: Record<string, number>;
  heatmap_max_dd?: Record<string, number>;
}

interface BenchmarkData {
  symbol: string;
  total_return_pct: number;
  annual_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
}

interface SingleBacktestResult {
  status: string;
  symbol: string;
  strategy?: string;
  period: string;
  params: {
    fast_ma: number;
    slow_ma: number;
    rsi_period?: number;
    rsi_entry?: number;
    rsi_exit?: number;
    init_cash: number;
    fees: number;
  };
  stats: {
    total_return_pct: number;
    annual_return_pct: number;
    sharpe_ratio: number;
    sortino_ratio: number;
    calmar_ratio: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    total_trades: number;
    profit_factor: number;
  };
  benchmark?: BenchmarkData | null;
  alpha_vs_nifty?: number;
  equity_curve: [string, number][];
  drawdown_curve?: [string, number][];
}

const PRESET_SYMBOLS = [
  { label: 'Nifty 50', value: '^NSEI' },
  { label: 'Bank Nifty', value: '^NSEBANK' },
  { label: 'Reliance', value: 'RELIANCE.NS' },
  { label: 'TCS', value: 'TCS.NS' },
  { label: 'HDFC Bank', value: 'HDFCBANK.NS' },
  { label: 'Infosys', value: 'INFY.NS' },
  { label: 'ICICI Bank', value: 'ICICIBANK.NS' },
  { label: 'Tata Motors', value: 'TATAMOTORS.NS' },
  { label: 'SBI', value: 'SBIN.NS' },
  { label: 'Gold Bees', value: 'GOLDBEES.NS' },
  { label: 'Bitcoin', value: 'BTC-USD' },
  { label: 'Apple', value: 'AAPL' },
];

const STRATEGIES: { id: StrategyType; label: string; tag: string; description: string; fastLabel: string; slowLabel: string }[] = [
  {
    id: 'ema_cross',
    label: 'EMA Crossover',
    tag: 'Recommended',
    description: 'Fast Exponential Moving Average vs Slow EMA trend following.',
    fastLabel: 'Fast EMA',
    slowLabel: 'Slow EMA',
  },
  {
    id: 'sma_cross',
    label: 'SMA Crossover',
    tag: 'Classic',
    description: 'Simple Moving Average golden & death cross system.',
    fastLabel: 'Fast SMA',
    slowLabel: 'Slow SMA',
  },
  {
    id: 'rsi',
    label: 'RSI Mean-Reversion',
    tag: 'Oscillator',
    description: 'Oversold dip accumulation with overbought exit target.',
    fastLabel: 'Entry Level',
    slowLabel: 'Exit Level',
  },
  {
    id: 'donchian',
    label: 'Donchian Breakout',
    tag: 'Turtle Trend',
    description: 'Upper channel breakout entry and lower channel trailing exit.',
    fastLabel: 'Upper Band',
    slowLabel: 'Lower Band',
  },
];

export const VectorBTOptimizer: React.FC = () => {
  // Strategy selection
  const [strategy, setStrategy] = useState<StrategyType>('ema_cross');

  // Config state
  const [symbol, setSymbol] = useState('RELIANCE.NS');
  const [startDate, setStartDate] = useState('2023-01-01');
  const [endDate, setEndDate] = useState('2024-01-01');
  const [initCash, setInitCash] = useState(500000);
  const [fees, setFees] = useState(0.001);

  // Parameter sweep state (Fast vs Slow)
  const [fastStart, setFastStart] = useState(5);
  const [fastEnd, setFastEnd] = useState(30);
  const [fastStep, setFastStep] = useState(5);
  const [slowStart, setSlowStart] = useState(20);
  const [slowEnd, setSlowEnd] = useState(80);
  const [slowStep, setSlowStep] = useState(10);

  // Execution state
  const [loadingOptimize, setLoadingOptimize] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizeDurationMs, setOptimizeDurationMs] = useState<number | null>(null);

  // Selected cell & single backtest state
  const [selectedPair, setSelectedPair] = useState<{ fast: number; slow: number } | null>(null);
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetricType>('return');
  const [loadingSingle, setLoadingSingle] = useState(false);
  const [singleResult, setSingleResult] = useState<SingleBacktestResult | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [copiedAlgo, setCopiedAlgo] = useState(false);

  // Active strategy metadata
  const activeStratMeta = useMemo(() => {
    return STRATEGIES.find((s) => s.id === strategy) || STRATEGIES[0];
  }, [strategy]);

  // Adjust default parameters when strategy changes
  const handleStrategyChange = (newStrat: StrategyType) => {
    setStrategy(newStrat);
    setOptimizeResult(null);
    setSingleResult(null);
    setSelectedPair(null);

    if (newStrat === 'rsi') {
      setFastStart(20);
      setFastEnd(40);
      setFastStep(5);
      setSlowStart(60);
      setSlowEnd(80);
      setSlowStep(5);
    } else if (newStrat === 'donchian') {
      setFastStart(15);
      setFastEnd(45);
      setFastStep(10);
      setSlowStart(5);
      setSlowEnd(25);
      setSlowStep(5);
    } else {
      setFastStart(5);
      setFastEnd(30);
      setFastStep(5);
      setSlowStart(20);
      setSlowEnd(80);
      setSlowStep(10);
    }
  };

  // Generate grid ranges
  const fastValues = useMemo(() => {
    const list: number[] = [];
    const step = Math.max(1, Number(fastStep) || 1);
    for (let f = Number(fastStart); f <= Number(fastEnd); f += step) {
      list.push(f);
    }
    return list;
  }, [fastStart, fastEnd, fastStep]);

  const slowValues = useMemo(() => {
    const list: number[] = [];
    const step = Math.max(1, Number(slowStep) || 1);
    for (let s = Number(slowStart); s <= Number(slowEnd); s += step) {
      list.push(s);
    }
    return list;
  }, [slowStart, slowEnd, slowStep]);

  // Execute grid parameter sweep
  const handleRunOptimize = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoadingOptimize(true);
    setOptimizeError(null);
    const startT = performance.now();

    try {
      const payload = {
        symbol: symbol.trim(),
        strategy,
        start_date: startDate,
        end_date: endDate,
        fast_range_start: Number(fastStart),
        fast_range_end: Number(fastEnd) + 1,
        fast_range_step: Number(fastStep),
        slow_range_start: Number(slowStart),
        slow_range_end: Number(slowEnd) + 1,
        slow_range_step: Number(slowStep),
        init_cash: Number(initCash),
        fees: Number(fees),
      };

      let res = await fetch('/api/vectorbt/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        // Fallback to python-nse proxy route
        res = await fetch('/api/python-nse/api/vectorbt/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const endT = performance.now();
      setOptimizeDurationMs(Math.round(endT - startT));

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Optimization request failed' }));
        throw new Error(err.detail || `Server returned ${res.status}`);
      }

      const data: OptimizeResult = await res.json();
      setOptimizeResult(data);

      // Auto-select best return pair and run its single backtest
      if (data.best_by_return) {
        const best = { fast: data.best_by_return.fast_ma, slow: data.best_by_return.slow_ma };
        setSelectedPair(best);
        runSingleBacktest(best.fast, best.slow);
      }
    } catch (err: any) {
      setOptimizeError(err.message || 'Optimization failed to run');
      setOptimizeResult(null);
    } finally {
      setLoadingOptimize(false);
    }
  };

  // Run single backtest for a specific pair
  const runSingleBacktest = async (f: number, s: number) => {
    setLoadingSingle(true);
    setSingleError(null);
    try {
      const payload = {
        symbol: symbol.trim(),
        strategy,
        start_date: startDate,
        end_date: endDate,
        fast_ma: f,
        slow_ma: s,
        rsi_period: 14,
        rsi_entry: f,
        rsi_exit: s,
        donchian_upper: f,
        donchian_lower: s,
        init_cash: Number(initCash),
        fees: Number(fees),
      };

      let res = await fetch('/api/vectorbt/run_sma_crossover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        res = await fetch('/api/python-nse/api/vectorbt/run_sma_crossover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Single backtest failed' }));
        throw new Error(err.detail || `Server returned ${res.status}`);
      }

      const data: SingleBacktestResult = await res.json();
      setSingleResult(data);
    } catch (err: any) {
      setSingleError(err.message || 'Failed to simulate selected pair');
      setSingleResult(null);
    } finally {
      setLoadingSingle(false);
    }
  };

  const handleCellClick = (f: number, s: number) => {
    if (strategy !== 'rsi' && s <= f) return; // Invalid combination where slow <= fast for crossovers
    setSelectedPair({ fast: f, slow: s });
    runSingleBacktest(f, s);
  };

  // Extract active dataset for current heatmap metric
  const activeHeatmapDataset = useMemo(() => {
    if (!optimizeResult) return {};
    switch (heatmapMetric) {
      case 'sharpe':
        return optimizeResult.heatmap_sharpe || {};
      case 'win_rate':
        return optimizeResult.heatmap_win_rate || {};
      case 'profit_factor':
        return optimizeResult.heatmap_profit_factor || {};
      case 'max_dd':
        return optimizeResult.heatmap_max_dd || {};
      case 'return':
      default:
        return optimizeResult.heatmap_returns || {};
    }
  }, [optimizeResult, heatmapMetric]);

  // Color generator for heatmap cells using semantic theme tokens
  const getCellColor = (f: number, s: number) => {
    const isInvalid = strategy !== 'rsi' && s <= f;
    if (isInvalid) {
      return 'bg-tf-bg-app/40 border-tf-border-subtle text-tf-text-muted/40 cursor-not-allowed';
    }
    if (!optimizeResult) {
      return 'bg-tf-bg-surface border-tf-border text-tf-text-muted';
    }

    const key = `(${f}, ${s})`;
    const val = activeHeatmapDataset[key];

    if (val === undefined || isNaN(val)) {
      return 'bg-tf-bg-app/50 border-tf-border text-tf-text-muted';
    }

    if (heatmapMetric === 'return') {
      if (val < -10) return 'bg-wa-bearish/30 border-wa-bearish/50 text-wa-bearish font-bold';
      if (val < 0) return 'bg-wa-bearish/15 border-wa-bearish/30 text-wa-bearish/80';
      if (val === 0) return 'bg-tf-bg-elevated border-tf-border text-tf-text-muted';
      if (val < 15) return 'bg-wa-bullish/15 border-wa-bullish/30 text-wa-bullish/90';
      if (val < 30) return 'bg-wa-bullish/25 border-wa-bullish/50 text-wa-bullish font-semibold';
      if (val < 60) return 'bg-wa-bullish/40 border-wa-bullish/70 text-white font-bold shadow-sm';
      return 'bg-wa-accent/40 border-wa-accent/80 text-white font-black shadow-md';
    } else if (heatmapMetric === 'sharpe') {
      if (val < 0) return 'bg-wa-bearish/25 border-wa-bearish/40 text-wa-bearish';
      if (val < 0.5) return 'bg-tf-bg-elevated border-tf-border text-tf-text-muted';
      if (val < 1.0) return 'bg-wa-accent/15 border-wa-accent/30 text-wa-accent';
      if (val < 1.5) return 'bg-wa-accent/30 border-wa-accent/50 text-wa-accent font-semibold';
      if (val < 2.0) return 'bg-wa-bullish/30 border-wa-bullish/60 text-wa-bullish font-bold';
      return 'bg-wa-bullish/50 border-wa-bullish/80 text-white font-black shadow-md';
    } else if (heatmapMetric === 'win_rate') {
      if (val < 40) return 'bg-wa-bearish/25 border-wa-bearish/40 text-wa-bearish';
      if (val < 50) return 'bg-tf-bg-elevated border-tf-border text-tf-text-muted';
      if (val < 60) return 'bg-wa-bullish/20 border-wa-bullish/40 text-wa-bullish';
      return 'bg-wa-bullish/40 border-wa-bullish/70 text-white font-bold';
    } else if (heatmapMetric === 'profit_factor') {
      if (val < 1.0) return 'bg-wa-bearish/25 border-wa-bearish/40 text-wa-bearish';
      if (val < 1.5) return 'bg-wa-accent/20 border-wa-accent/40 text-wa-accent';
      if (val < 2.0) return 'bg-wa-bullish/25 border-wa-bullish/50 text-wa-bullish font-semibold';
      return 'bg-wa-bullish/45 border-wa-bullish/70 text-white font-black';
    } else {
      // Max DD: lower is better
      if (val > 25) return 'bg-wa-bearish/40 border-wa-bearish/70 text-white font-bold';
      if (val > 15) return 'bg-wa-warning/25 border-wa-warning/50 text-wa-warning';
      if (val > 8) return 'bg-tf-bg-elevated border-tf-border text-tf-text-muted';
      return 'bg-wa-bullish/30 border-wa-bullish/60 text-wa-bullish font-bold';
    }
  };

  // Chart data formatting
  const chartData = useMemo(() => {
    if (!singleResult || !singleResult.equity_curve) return [];
    return singleResult.equity_curve.map(([date, val]) => ({
      date,
      equity: val,
    }));
  }, [singleResult]);

  // Export trade log CSV
  const handleExportCSV = () => {
    if (!singleResult || !singleResult.equity_curve) return;
    const rows = [
      ['Date', 'Portfolio Value', 'Strategy', 'Fast Parameter', 'Slow Parameter'],
      ...singleResult.equity_curve.map(([date, val]) => [
        date,
        val,
        strategy,
        singleResult.params.fast_ma,
        singleResult.params.slow_ma,
      ]),
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${singleResult.symbol}_${strategy}_backtest.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy OpenAlgo strategy snippet
  const handleCopyOpenAlgo = () => {
    if (!singleResult) return;
    const snippet = `# OpenAlgo Automated Execution Config
STRATEGY_NAME = "${strategy.toUpperCase()}"
SYMBOL = "${singleResult.symbol}"
PARAM_FAST = ${singleResult.params.fast_ma}
PARAM_SLOW = ${singleResult.params.slow_ma}
CAPITAL = ${singleResult.params.init_cash}
FEES = ${singleResult.params.fees}
EXPECTED_ANNUAL_RETURN = "${singleResult.stats.annual_return_pct}%"
SHARPE_RATIO = ${singleResult.stats.sharpe_ratio}
`;
    navigator.clipboard.writeText(snippet);
    setCopiedAlgo(true);
    setTimeout(() => setCopiedAlgo(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner Card */}
      <div className="bg-tf-bg-card backdrop-blur-md p-5 rounded-2xl border border-tf-border shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-wa-accent/10 border border-wa-accent/30 rounded-xl text-wa-accent shrink-0">
              <Zap className="w-5 h-5 text-wa-bullish animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-tf-text-primary tracking-wide">
                  VectorBT Parameter Matrix Optimizer
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-wa-bullish-subtle text-wa-bullish border border-wa-bullish/30">
                  ⚡ Vectorized C/NumPy Speed
                </span>
                {optimizeDurationMs !== null && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-wa-accent-subtle text-wa-accent border border-wa-accent/30">
                    ⏱️ {optimizeDurationMs}ms Compute
                  </span>
                )}
                {optimizeResult?.robustness && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-wa-bullish/10 text-wa-bullish border border-wa-bullish/30">
                    🛡️ {optimizeResult.robustness.status} ({optimizeResult.robustness.score}%)
                  </span>
                )}
              </div>
              <p className="text-xs text-tf-text-secondary mt-0.5">
                Simulate thousands of parameter combinations simultaneously across Indian equities and indices without curve fitting.
              </p>
            </div>
          </div>

          {/* Quick Preset Symbols */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase font-bold text-tf-text-muted mr-1">Presets:</span>
            {PRESET_SYMBOLS.map((item) => (
              <button
                key={item.value}
                onClick={() => setSymbol(item.value)}
                className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-all ${
                  symbol === item.value
                    ? 'bg-wa-accent text-white font-bold shadow-sm'
                    : 'bg-tf-bg-elevated text-tf-text-secondary hover:text-tf-text-primary hover:bg-tf-bg-surface'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Strategy Selector Tabs */}
      <div className="bg-tf-bg-card p-3 rounded-2xl border border-tf-border flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-tf-text-muted uppercase tracking-wider px-2 flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-wa-accent" /> Strategy:
        </span>
        {STRATEGIES.map((strat) => (
          <button
            key={strat.id}
            onClick={() => handleStrategyChange(strat.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              strategy === strat.id
                ? 'bg-wa-accent text-white shadow-md'
                : 'bg-tf-bg-surface text-tf-text-secondary hover:text-tf-text-primary hover:bg-tf-bg-elevated'
            }`}
          >
            <span>{strat.label}</span>
            <span
              className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                strategy === strat.id
                  ? 'bg-white/20 text-white'
                  : 'bg-tf-bg-card text-tf-text-muted'
              }`}
            >
              {strat.tag}
            </span>
          </button>
        ))}
      </div>

      {/* Control Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form: Parameters & Ranges */}
        <div className="lg:col-span-4 bg-tf-bg-card backdrop-blur-md p-5 rounded-2xl border border-tf-border shadow-md space-y-4">
          <div className="flex items-center justify-between border-b border-tf-border pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-tf-text-primary flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-wa-accent" />
              Optimization Setup
            </h3>
            <span className="text-[10px] text-tf-text-muted font-mono">
              {(fastValues.length * slowValues.length)} Combos
            </span>
          </div>

          <form onSubmit={handleRunOptimize} className="space-y-4 text-xs font-mono">
            {/* Symbol & Dates */}
            <div className="space-y-2">
              <div>
                <label className="text-tf-text-secondary text-[10px] uppercase font-bold block mb-1">
                  Ticker / Asset
                </label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="e.g. RELIANCE.NS, ^NSEI, BTC-USD"
                  className="w-full bg-tf-bg-app border border-tf-border rounded-lg px-3 py-2 text-tf-text-primary font-bold focus:border-wa-accent focus:outline-none transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-tf-text-secondary text-[10px] uppercase font-bold block mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-tf-bg-app border border-tf-border rounded-lg px-2.5 py-1.5 text-tf-text-primary text-[11px] focus:border-wa-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-tf-text-secondary text-[10px] uppercase font-bold block mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-tf-bg-app border border-tf-border rounded-lg px-2.5 py-1.5 text-tf-text-primary text-[11px] focus:border-wa-accent focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Fast Parameter Range */}
            <div className="bg-tf-bg-app/60 p-3 rounded-xl border border-tf-border/60 space-y-2">
              <span className="text-[10px] uppercase font-bold text-wa-accent block">
                {activeStratMeta.fastLabel} Range
              </span>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-tf-text-muted text-[9px] block">Start</label>
                  <input
                    type="number"
                    value={fastStart}
                    onChange={(e) => setFastStart(Number(e.target.value))}
                    className="w-full bg-tf-bg-surface border border-tf-border rounded px-2 py-1 text-tf-text-primary text-center"
                  />
                </div>
                <div>
                  <label className="text-tf-text-muted text-[9px] block">End</label>
                  <input
                    type="number"
                    value={fastEnd}
                    onChange={(e) => setFastEnd(Number(e.target.value))}
                    className="w-full bg-tf-bg-surface border border-tf-border rounded px-2 py-1 text-tf-text-primary text-center"
                  />
                </div>
                <div>
                  <label className="text-tf-text-muted text-[9px] block">Step</label>
                  <input
                    type="number"
                    value={fastStep}
                    onChange={(e) => setFastStep(Number(e.target.value))}
                    className="w-full bg-tf-bg-surface border border-tf-border rounded px-2 py-1 text-tf-text-primary text-center"
                  />
                </div>
              </div>
            </div>

            {/* Slow Parameter Range */}
            <div className="bg-tf-bg-app/60 p-3 rounded-xl border border-tf-border/60 space-y-2">
              <span className="text-[10px] uppercase font-bold text-wa-bullish block">
                {activeStratMeta.slowLabel} Range
              </span>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-tf-text-muted text-[9px] block">Start</label>
                  <input
                    type="number"
                    value={slowStart}
                    onChange={(e) => setSlowStart(Number(e.target.value))}
                    className="w-full bg-tf-bg-surface border border-tf-border rounded px-2 py-1 text-tf-text-primary text-center"
                  />
                </div>
                <div>
                  <label className="text-tf-text-muted text-[9px] block">End</label>
                  <input
                    type="number"
                    value={slowEnd}
                    onChange={(e) => setSlowEnd(Number(e.target.value))}
                    className="w-full bg-tf-bg-surface border border-tf-border rounded px-2 py-1 text-tf-text-primary text-center"
                  />
                </div>
                <div>
                  <label className="text-tf-text-muted text-[9px] block">Step</label>
                  <input
                    type="number"
                    value={slowStep}
                    onChange={(e) => setSlowStep(Number(e.target.value))}
                    className="w-full bg-tf-bg-surface border border-tf-border rounded px-2 py-1 text-tf-text-primary text-center"
                  />
                </div>
              </div>
            </div>

            {/* Capital & Fees */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-tf-text-secondary text-[10px] uppercase font-bold block mb-1">
                  Capital (₹)
                </label>
                <input
                  type="number"
                  value={initCash}
                  onChange={(e) => setInitCash(Number(e.target.value))}
                  className="w-full bg-tf-bg-app border border-tf-border rounded-lg px-2.5 py-1.5 text-tf-text-primary"
                />
              </div>
              <div>
                <label className="text-tf-text-secondary text-[10px] uppercase font-bold block mb-1">
                  Fee Ratio (STT/Brk)
                </label>
                <input
                  type="number"
                  step="0.0005"
                  value={fees}
                  onChange={(e) => setFees(Number(e.target.value))}
                  className="w-full bg-tf-bg-app border border-tf-border rounded-lg px-2.5 py-1.5 text-tf-text-primary"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loadingOptimize}
              className="w-full py-3 bg-gradient-to-r from-wa-accent to-wa-bullish hover:opacity-95 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-wa-accent/20 disabled:opacity-50"
            >
              {loadingOptimize ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Running Vectorized Grid...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  Run Vectorized Parameter Sweep
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Area: Results, Leaderboards & Heatmap */}
        <div className="lg:col-span-8 space-y-6">
          {optimizeError && (
            <div className="p-4 bg-wa-bearish/10 border border-wa-bearish/30 rounded-xl text-wa-bearish text-xs flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{optimizeError}</span>
            </div>
          )}

          {/* Top Leaderboard Stats */}
          {optimizeResult && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Best by Return */}
              <div className="bg-tf-bg-card backdrop-blur-md p-4 rounded-2xl border border-wa-bullish/30 relative overflow-hidden shadow-md">
                <div className="absolute top-0 right-0 w-24 h-24 bg-wa-bullish/10 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-wa-bullish flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5" /> Best Total Return
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-wa-bullish/20 text-wa-bullish font-bold">
                    F: {optimizeResult.best_by_return.fast_ma} | S: {optimizeResult.best_by_return.slow_ma}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black font-mono text-tf-text-primary">
                    {optimizeResult.best_by_return.return_pct > 0 ? '+' : ''}
                    {optimizeResult.best_by_return.return_pct}%
                  </span>
                  <span className="text-[10px] text-tf-text-secondary">Total Gain</span>
                </div>
                <button
                  onClick={() => handleCellClick(optimizeResult.best_by_return.fast_ma, optimizeResult.best_by_return.slow_ma)}
                  className="mt-2 text-[10px] text-wa-bullish hover:underline flex items-center gap-1 font-semibold"
                >
                  Simulate this pair <ArrowUpRight size={12} />
                </button>
              </div>

              {/* Best by Sharpe */}
              <div className="bg-tf-bg-card backdrop-blur-md p-4 rounded-2xl border border-wa-accent/30 relative overflow-hidden shadow-md">
                <div className="absolute top-0 right-0 w-24 h-24 bg-wa-accent/10 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-wa-accent flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" /> Best Sharpe Ratio
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-wa-accent/20 text-wa-accent font-bold">
                    F: {optimizeResult.best_by_sharpe.fast_ma} | S: {optimizeResult.best_by_sharpe.slow_ma}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black font-mono text-tf-text-primary">
                    {optimizeResult.best_by_sharpe.sharpe}
                  </span>
                  <span className="text-[10px] text-tf-text-secondary">Risk-Adjusted</span>
                </div>
                <button
                  onClick={() => handleCellClick(optimizeResult.best_by_sharpe.fast_ma, optimizeResult.best_by_sharpe.slow_ma)}
                  className="mt-2 text-[10px] text-wa-accent hover:underline flex items-center gap-1 font-semibold"
                >
                  Simulate this pair <ArrowUpRight size={12} />
                </button>
              </div>

              {/* Active Selection & Robustness */}
              <div className="bg-tf-bg-card backdrop-blur-md p-4 rounded-2xl border border-tf-border shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-tf-text-secondary flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-wa-accent" /> Active Cell
                  </span>
                  {optimizeResult.robustness && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-tf-bg-surface text-wa-bullish border border-tf-border">
                      {optimizeResult.robustness.status}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black font-mono text-wa-accent">
                    {selectedPair ? `(${selectedPair.fast}, ${selectedPair.slow})` : 'Select cell'}
                  </span>
                </div>
                <span className="text-[10px] text-tf-text-muted block mt-1">
                  Click any matrix cell below to inspect its equity & drawdown curves
                </span>
              </div>
            </div>
          )}

          {/* Heatmap Matrix Card */}
          <div className="bg-tf-bg-card backdrop-blur-md p-5 rounded-2xl border border-tf-border shadow-md space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-tf-border pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-wa-bullish" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-tf-text-primary">
                  Parameter Response Heatmap
                </h3>
                {optimizeResult && (
                  <span className="text-[10px] text-tf-text-muted font-mono">
                    ({optimizeResult.combinations_tested} combinations)
                  </span>
                )}
              </div>

              {/* 5-Metric Switcher Toggle */}
              <div className="flex items-center gap-1 bg-tf-bg-app p-1 rounded-xl border border-tf-border flex-wrap">
                <button
                  type="button"
                  onClick={() => setHeatmapMetric('return')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    heatmapMetric === 'return'
                      ? 'bg-wa-bullish text-white shadow-sm'
                      : 'text-tf-text-muted hover:text-tf-text-primary'
                  }`}
                >
                  Return %
                </button>
                <button
                  type="button"
                  onClick={() => setHeatmapMetric('sharpe')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    heatmapMetric === 'sharpe'
                      ? 'bg-wa-accent text-white shadow-sm'
                      : 'text-tf-text-muted hover:text-tf-text-primary'
                  }`}
                >
                  Sharpe
                </button>
                <button
                  type="button"
                  onClick={() => setHeatmapMetric('win_rate')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    heatmapMetric === 'win_rate'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-tf-text-muted hover:text-tf-text-primary'
                  }`}
                >
                  Win Rate
                </button>
                <button
                  type="button"
                  onClick={() => setHeatmapMetric('profit_factor')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    heatmapMetric === 'profit_factor'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-tf-text-muted hover:text-tf-text-primary'
                  }`}
                >
                  Profit Factor
                </button>
                <button
                  type="button"
                  onClick={() => setHeatmapMetric('max_dd')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    heatmapMetric === 'max_dd'
                      ? 'bg-wa-bearish text-white shadow-sm'
                      : 'text-tf-text-muted hover:text-tf-text-primary'
                  }`}
                >
                  Max DD %
                </button>
              </div>
            </div>

            {/* Matrix Heatmap Table */}
            <div className="overflow-x-auto custom-scrollbar pb-2">
              <div className="inline-block min-w-full">
                {/* Column Header */}
                <div className="text-center text-[10px] uppercase font-bold text-wa-bullish tracking-wider mb-2">
                  {activeStratMeta.slowLabel} (Columns) →
                </div>
                <table className="border-collapse font-mono text-xs w-full">
                  <thead>
                    <tr>
                      <th className="p-2 text-wa-accent text-[10px] font-bold text-left border-b border-r border-tf-border">
                        {activeStratMeta.fastLabel} ↓
                      </th>
                      {slowValues.map((s) => (
                        <th
                          key={`col-${s}`}
                          className="p-2 text-center text-tf-text-secondary text-[11px] border-b border-tf-border min-w-[54px]"
                        >
                          {s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fastValues.map((f) => (
                      <tr key={`row-${f}`}>
                        <td className="p-2 text-wa-accent text-[11px] font-bold border-r border-tf-border bg-tf-bg-app/40">
                          {f}
                        </td>
                        {slowValues.map((s) => {
                          const isSelected = selectedPair?.fast === f && selectedPair?.slow === s;
                          const isInvalid = strategy !== 'rsi' && s <= f;
                          const key = `(${f}, ${s})`;
                          const val = activeHeatmapDataset[key];

                          return (
                            <td
                              key={`cell-${f}-${s}`}
                              onClick={() => handleCellClick(f, s)}
                              title={
                                isInvalid
                                  ? 'Slow parameter must be strictly greater than Fast parameter'
                                  : `${activeStratMeta.fastLabel}: ${f} | ${activeStratMeta.slowLabel}: ${s} | ${val !== undefined ? `${val}` : 'N/A'}`
                              }
                              className={`p-2 text-center text-[11px] border border-tf-border/50 transition-all ${getCellColor(
                                f,
                                s
                              )} ${
                                isSelected
                                  ? 'ring-2 ring-white scale-105 z-10 shadow-lg'
                                  : isInvalid
                                  ? ''
                                  : 'hover:opacity-90 hover:scale-105 cursor-pointer'
                              }`}
                            >
                              {isInvalid ? (
                                <span className="text-tf-text-muted/40">-</span>
                              ) : val !== undefined && !isNaN(val) ? (
                                heatmapMetric === 'return' ? (
                                  `${val > 0 ? '+' : ''}${Math.round(val)}%`
                                ) : heatmapMetric === 'win_rate' ? (
                                  `${Math.round(val)}%`
                                ) : (
                                  val.toFixed(2)
                                )
                              ) : (
                                '·'
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {!optimizeResult && !loadingOptimize && (
              <div className="py-8 text-center text-tf-text-muted text-xs">
                Configure parameter ranges on the left and click "Run Vectorized Parameter Sweep" to populate this matrix.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Selected Pair Simulation, Benchmark Comparison & Equity Curve */}
      <AnimatePresence>
        {singleResult && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            className="bg-tf-bg-card backdrop-blur-md p-6 rounded-2xl border border-tf-border shadow-xl space-y-6"
          >
            {/* Header with Title and Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-tf-border pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-wa-bullish-subtle border border-wa-bullish/30 rounded-xl text-wa-bullish">
                  <BarChart2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-tf-text-primary flex items-center gap-2 flex-wrap">
                    Strategy Equity Growth Curve
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-tf-bg-surface text-wa-accent font-mono font-bold border border-tf-border">
                      {activeStratMeta.fastLabel}: {singleResult.params.fast_ma} • {activeStratMeta.slowLabel}: {singleResult.params.slow_ma}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-wa-accent-subtle text-wa-accent font-mono font-bold">
                      {singleResult.strategy?.toUpperCase() || strategy.toUpperCase()}
                    </span>
                  </h3>
                  <p className="text-xs text-tf-text-secondary mt-0.5">
                    {singleResult.symbol} • {singleResult.period}
                  </p>
                </div>
              </div>

              {/* Action Buttons: Export & OpenAlgo */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 rounded-xl bg-tf-bg-surface border border-tf-border text-tf-text-secondary hover:text-tf-text-primary hover:bg-tf-bg-elevated text-xs font-mono font-bold flex items-center gap-1.5 transition-all"
                  title="Export equity series to CSV"
                >
                  <Download size={13} />
                  CSV
                </button>
                <button
                  onClick={handleCopyOpenAlgo}
                  className="px-3 py-1.5 rounded-xl bg-wa-accent/15 border border-wa-accent/30 text-wa-accent hover:bg-wa-accent/25 text-xs font-mono font-bold flex items-center gap-1.5 transition-all"
                  title="Copy strategy parameters for OpenAlgo live desk"
                >
                  {copiedAlgo ? <Check size={13} /> : <Copy size={13} />}
                  {copiedAlgo ? 'Copied!' : 'OpenAlgo Hook'}
                </button>
              </div>
            </div>

            {/* Benchmark Alpha & Comparison Cards */}
            {singleResult.benchmark && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
                <div className="bg-tf-bg-surface p-4 rounded-xl border border-tf-border">
                  <span className="text-tf-text-muted text-[10px] uppercase font-bold block">
                    Benchmark ({singleResult.benchmark.symbol})
                  </span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-lg font-black text-tf-text-primary">
                      {singleResult.benchmark.total_return_pct > 0 ? '+' : ''}
                      {singleResult.benchmark.total_return_pct}%
                    </span>
                    <span className="text-[10px] text-tf-text-secondary">
                      (Sharpe: {singleResult.benchmark.sharpe_ratio})
                    </span>
                  </div>
                </div>

                <div className="bg-tf-bg-surface p-4 rounded-xl border border-tf-border">
                  <span className="text-tf-text-muted text-[10px] uppercase font-bold block">
                    Strategy Return
                  </span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-lg font-black ${singleResult.stats.total_return_pct >= 0 ? 'text-wa-bullish' : 'text-wa-bearish'}`}>
                      {singleResult.stats.total_return_pct >= 0 ? '+' : ''}
                      {singleResult.stats.total_return_pct}%
                    </span>
                    <span className="text-[10px] text-tf-text-secondary">
                      (Sharpe: {singleResult.stats.sharpe_ratio})
                    </span>
                  </div>
                </div>

                <div className="bg-tf-bg-surface p-4 rounded-xl border border-wa-bullish/30 relative overflow-hidden">
                  <span className="text-wa-bullish text-[10px] uppercase font-bold block flex items-center gap-1">
                    <Target size={12} /> Alpha Generated vs NIFTY
                  </span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-xl font-black ${Number(singleResult.alpha_vs_nifty || 0) >= 0 ? 'text-wa-bullish' : 'text-wa-bearish'}`}>
                      {Number(singleResult.alpha_vs_nifty || 0) > 0 ? '+' : ''}
                      {singleResult.alpha_vs_nifty}%
                    </span>
                    <span className="text-[10px] text-wa-bullish">
                      {Number(singleResult.alpha_vs_nifty || 0) >= 0 ? 'Outperformed' : 'Underperformed'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Performance Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 font-mono text-xs">
              <div className="bg-tf-bg-surface p-3 rounded-xl border border-tf-border">
                <span className="text-tf-text-muted text-[9px] block">ANNUAL RETURN</span>
                <span className="text-tf-text-primary font-bold block mt-1">{singleResult.stats.annual_return_pct}%</span>
              </div>
              <div className="bg-tf-bg-surface p-3 rounded-xl border border-tf-border">
                <span className="text-tf-text-muted text-[9px] block">SHARPE RATIO</span>
                <span className="text-wa-accent font-bold block mt-1">{singleResult.stats.sharpe_ratio}</span>
              </div>
              <div className="bg-tf-bg-surface p-3 rounded-xl border border-tf-border">
                <span className="text-tf-text-muted text-[9px] block">SORTINO</span>
                <span className="text-tf-text-primary font-bold block mt-1">{singleResult.stats.sortino_ratio}</span>
              </div>
              <div className="bg-tf-bg-surface p-3 rounded-xl border border-tf-border">
                <span className="text-tf-text-muted text-[9px] block">PROFIT FACTOR</span>
                <span className="text-tf-text-primary font-bold block mt-1">{singleResult.stats.profit_factor}</span>
              </div>
              <div className="bg-tf-bg-surface p-3 rounded-xl border border-tf-border">
                <span className="text-tf-text-muted text-[9px] block">WIN RATE</span>
                <span className="text-purple-400 font-bold block mt-1">{singleResult.stats.win_rate_pct}%</span>
              </div>
              <div className="bg-tf-bg-surface p-3 rounded-xl border border-tf-border">
                <span className="text-tf-text-muted text-[9px] block">MAX DRAWDOWN</span>
                <span className="text-wa-bearish font-bold block mt-1">{singleResult.stats.max_drawdown_pct}%</span>
              </div>
              <div className="bg-tf-bg-surface p-3 rounded-xl border border-tf-border">
                <span className="text-tf-text-muted text-[9px] block">TOTAL TRADES</span>
                <span className="text-tf-text-primary font-bold block mt-1">{singleResult.stats.total_trades}</span>
              </div>
              <div className="bg-tf-bg-surface p-3 rounded-xl border border-tf-border">
                <span className="text-tf-text-muted text-[9px] block">STATUS</span>
                <span className="text-wa-bullish font-bold block mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Validated
                </span>
              </div>
            </div>

            {/* Equity Curve Chart */}
            <div className="bg-tf-bg-surface p-4 rounded-xl border border-tf-border">
              <div className="h-[300px] w-full">
                <SafeChartContainer>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="optEquityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--wa-bullish, #10b981)" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="var(--wa-bullish, #10b981)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--tf-border, rgba(255, 255, 255, 0.08))" />
                    <XAxis
                      dataKey="date"
                      stroke="var(--tf-text-muted, #64748b)"
                      fontSize={10}
                      tickLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      stroke="var(--tf-text-muted, #64748b)"
                      fontSize={10}
                      orientation="right"
                      domain={['auto', 'auto']}
                      tickLine={false}
                      tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--tf-bg-card, #0d0f17)',
                        borderColor: 'var(--tf-border, rgba(255, 255, 255, 0.08))',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '12px',
                      }}
                      formatter={(value: any) => [`₹${Number(value).toLocaleString()}`, 'Portfolio Value']}
                    />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke="var(--wa-bullish, #10b981)"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#optEquityGrad)"
                    />
                  </AreaChart>
                </SafeChartContainer>
              </div>
            </div>

            {/* Plain-English Quant Synthesis Report */}
            <div className="p-4 bg-tf-bg-app rounded-xl border border-tf-border space-y-1.5 text-xs">
              <span className="text-[10px] uppercase font-bold text-wa-accent tracking-wider block">
                Quant Insights & Plain-Language Summary
              </span>
              <p className="text-tf-text-secondary leading-relaxed">
                Over this backtest window on <span className="text-tf-text-primary font-bold">{singleResult.symbol}</span>, 
                the strategy produced a total return of <span className={`font-bold ${singleResult.stats.total_return_pct >= 0 ? 'text-wa-bullish' : 'text-wa-bearish'}`}>{singleResult.stats.total_return_pct}%</span> across{' '}
                <span className="text-tf-text-primary font-bold">{singleResult.stats.total_trades} completed trades</span> with a{' '}
                <span className="text-purple-400 font-bold">{singleResult.stats.win_rate_pct}% win rate</span>. 
                {singleResult.alpha_vs_nifty !== undefined && (
                  <> Compared to holding NIFTY 50, it achieved an excess alpha of <span className="text-wa-bullish font-bold">{singleResult.alpha_vs_nifty}%</span>.</>
                )}
                {' '}The worst temporary drawdown from peak equity was <span className="text-wa-bearish font-bold">{singleResult.stats.max_drawdown_pct}%</span>, yielding a Sharpe ratio of{' '}
                <span className="text-wa-accent font-bold">{singleResult.stats.sharpe_ratio}</span>.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default VectorBTOptimizer;
