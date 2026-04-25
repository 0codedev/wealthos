import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from './shared/SafeChartContainer';
import {
  FlaskConical, Zap, Play, BarChart2, TrendingUp, TrendingDown,
  ShieldCheck, Percent, Layers, Sliders, RefreshCw, AlertCircle, Award,
  Activity, Clock, CheckCircle2, DollarSign, Scale, Cpu, ExternalLink
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

interface StrategyLabProps {
  embedded?: boolean;
  initialEngine?: 'vectorbt' | 'backtrader' | 'lumibot' | 'comparison';
}

export const StrategyLab: React.FC<StrategyLabProps> = ({ embedded = false, initialEngine = 'vectorbt' }) => {
  const [activeEngine, setActiveEngine] = useState<'vectorbt' | 'backtrader' | 'lumibot' | 'comparison'>(initialEngine);


  // Shared Form Parameters
  const [symbol, setSymbol] = useState('RELIANCE.NS');
  const [startDate, setStartDate] = useState('2023-01-01');
  const [endDate, setEndDate] = useState('2024-01-01');
  const [initCash, setInitCash] = useState(100000);
  const [fees, setFees] = useState(0.001);

  // VectorBT State
  const [fastMa, setFastMa] = useState(10);
  const [slowMa, setSlowMa] = useState(30);
  const [loadingVbt, setLoadingVbt] = useState(false);
  const [vbtResult, setVbtResult] = useState<any>(null);
  const [vbtError, setVbtError] = useState<string | null>(null);

  // VectorBT Grid Search State
  const [fastStart, setFastStart] = useState(5);
  const [fastEnd, setFastEnd] = useState(30);
  const [fastStep, setFastStep] = useState(5);
  const [slowStart, setSlowStart] = useState(20);
  const [slowEnd, setSlowEnd] = useState(80);
  const [slowStep, setSlowStep] = useState(10);
  const [loadingOptimize, setLoadingOptimize] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<any>(null);

  // Backtrader State
  const [btFast, setBtFast] = useState(10);
  const [btSlow, setBtSlow] = useState(30);
  const [slippage, setSlippage] = useState(0.001);
  const [loadingBt, setLoadingBt] = useState(false);
  const [btResult, setBtResult] = useState<any>(null);
  const [btError, setBtError] = useState<string | null>(null);

  // Lumibot State
  const [lumiStrategy, setLumiStrategy] = useState('buy_and_hold');
  const [loadingLumi, setLoadingLumi] = useState(false);
  const [lumiTaskId, setLumiTaskId] = useState<string | null>(null);
  const [lumiResult, setLumiResult] = useState<any>(null);
  const [lumiError, setLumiError] = useState<string | null>(null);

  // --- Handlers ---

  // Run VectorBT Single
  const handleRunVectorBT = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoadingVbt(true);
    setVbtError(null);
    try {
      const res = await fetch('/api/python-nse/api/vectorbt/run_sma_crossover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          start_date: startDate,
          end_date: endDate,
          fast_ma: Number(fastMa),
          slow_ma: Number(slowMa),
          init_cash: Number(initCash),
          fees: Number(fees),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'VectorBT backtest failed');
      }

      const data = await res.json();
      setVbtResult(data);
    } catch (err: any) {
      setVbtError(err.message);
      setVbtResult(null);
    } finally {
      setLoadingVbt(false);
    }
  };

  // Run VectorBT Grid Search
  const handleRunOptimize = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoadingOptimize(true);
    try {
      const res = await fetch('/api/python-nse/api/vectorbt/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          start_date: startDate,
          end_date: endDate,
          fast_range_start: Number(fastStart),
          fast_range_end: Number(fastEnd),
          fast_range_step: Number(fastStep),
          slow_range_start: Number(slowStart),
          slow_range_end: Number(slowEnd),
          slow_range_step: Number(slowStep),
          init_cash: Number(initCash),
          fees: Number(fees),
        }),
      });
      if (res.ok) {
        setOptimizeResult(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingOptimize(false);
    }
  };

  // Run Backtrader
  const handleRunBacktrader = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoadingBt(true);
    setBtError(null);
    try {
      const res = await fetch('/api/python-nse/api/backtrader/sma_crossover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          start_date: startDate,
          end_date: endDate,
          fast_period: Number(btFast),
          slow_period: Number(btSlow),
          cash: Number(initCash),
          commission: Number(fees),
          slippage_perc: Number(slippage),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Backtrader simulation failed');
      }

      const data = await res.json();
      setBtResult(data);
    } catch (err: any) {
      setBtError(err.message);
      setBtResult(null);
    } finally {
      setLoadingBt(false);
    }
  };

  // Run Lumibot
  const handleRunLumibot = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoadingLumi(true);
    setLumiError(null);
    setLumiResult(null);
    try {
      const res = await fetch('/api/python-nse/api/lumibot/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          start_date: startDate,
          end_date: endDate,
          budget: Number(initCash),
          strategy_type: lumiStrategy,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Lumibot backtest start failed');
      }

      const data = await res.json();
      setLumiTaskId(data.task_id);
    } catch (err: any) {
      setLumiError(err.message);
      setLoadingLumi(false);
    }
  };

  // Poll Lumibot task status
  useEffect(() => {
    if (!lumiTaskId || lumiResult?.status === 'done' || lumiResult?.status === 'error') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/python-nse/api/lumibot/results/${lumiTaskId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'done' || data.status === 'error') {
            setLumiResult(data);
            setLoadingLumi(false);
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [lumiTaskId, lumiResult]);

  const vbtChartData = vbtResult?.equity_curve
    ? vbtResult.equity_curve.map(([date, val]: [string, number]) => ({ date, value: val }))
    : [];

  return (
    <div className={embedded ? "space-y-6" : "p-6 bg-slate-950 text-slate-100 min-h-screen space-y-6"}>
      {!embedded ? (
        /* Standalone Header */
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Multi-Engine Strategy Lab
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/40">
                  VectorBT • Backtrader • Lumibot
                </span>
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Compare strategy performance from high-speed matrix scanning to realistic event simulation
              </p>
            </div>
          </div>

          {/* Engine Tabs */}
          <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex flex-wrap gap-1">
            <button
              onClick={() => setActiveEngine('vectorbt')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeEngine === 'vectorbt'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ⚡ VectorBT (Matrix Speed)
            </button>

            <button
              onClick={() => setActiveEngine('backtrader')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeEngine === 'backtrader'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📈 Backtrader (Event Realism)
            </button>

            <button
              onClick={() => setActiveEngine('lumibot')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeEngine === 'lumibot'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🤖 Lumibot (Multi-Asset)
            </button>

            <button
              onClick={() => setActiveEngine('comparison')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeEngine === 'comparison'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ⚖️ Side-by-Side Comparison
            </button>
          </div>
        </div>
      ) : (
        /* Embedded Engine Selector */
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900/70 border border-slate-800 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Zap size={14} className="text-emerald-400" /> Multi-Engine Runner:
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveEngine('vectorbt')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeEngine === 'vectorbt'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              ⚡ VectorBT (Matrix Speed)
            </button>
            <button
              onClick={() => setActiveEngine('backtrader')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeEngine === 'backtrader'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              📈 Backtrader (Event Realism)
            </button>
            <button
              onClick={() => setActiveEngine('lumibot')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeEngine === 'lumibot'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              🤖 Lumibot (Multi-Asset)
            </button>
            <button
              onClick={() => setActiveEngine('comparison')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeEngine === 'comparison'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              ⚖️ Side-by-Side Comparison
            </button>
          </div>
        </div>
      )}

      {/* Shared Config Bar */}
      <div className="bg-slate-900/80 backdrop-blur-md p-4 rounded-2xl border border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-mono">
        <div>
          <label className="text-slate-400 uppercase font-semibold block mb-1">Target Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
          />
        </div>
        <div>
          <label className="text-slate-400 uppercase font-semibold block mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
          />
        </div>
        <div>
          <label className="text-slate-400 uppercase font-semibold block mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
          />
        </div>
        <div>
          <label className="text-slate-400 uppercase font-semibold block mb-1">Initial Capital (₹/$)</label>
          <input
            type="number"
            value={initCash}
            onChange={(e) => setInitCash(Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
          />
        </div>
      </div>

      {/* --- ENGINE 1: VECTORBT --- */}
      {activeEngine === 'vectorbt' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-3">
              <FlaskConical className="w-4 h-4 text-emerald-400" />
              VectorBT Parameters
            </h3>

            <form onSubmit={handleRunVectorBT} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Fast MA Period</label>
                  <input type="number" value={fastMa} onChange={(e) => setFastMa(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Slow MA Period</label>
                  <input type="number" value={slowMa} onChange={(e) => setSlowMa(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono" />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Transaction Fee (Brokerage)</label>
                <input type="number" step="0.0005" value={fees} onChange={(e) => setFees(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono" />
              </div>

              <button
                type="submit"
                disabled={loadingVbt}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/30"
              >
                {loadingVbt ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run VectorBT Engine
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 space-y-6">
            {vbtError && (
              <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-sm flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                <span>{vbtError}</span>
              </div>
            )}

            {vbtResult ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <span className="text-xs text-slate-400 font-medium">Total Return</span>
                    <span className={`text-xl font-bold font-mono block mt-1 ${vbtResult.stats.total_return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {vbtResult.stats.total_return_pct >= 0 ? '+' : ''}{vbtResult.stats.total_return_pct}%
                    </span>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <span className="text-xs text-slate-400 font-medium">Sharpe Ratio</span>
                    <span className="text-xl font-bold font-mono text-cyan-400 block mt-1">{vbtResult.stats.sharpe_ratio}</span>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <span className="text-xs text-slate-400 font-medium">Max Drawdown</span>
                    <span className="text-xl font-bold font-mono text-rose-400 block mt-1">{vbtResult.stats.max_drawdown_pct}%</span>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <span className="text-xs text-slate-400 font-medium">Win Rate</span>
                    <span className="text-xl font-bold font-mono text-purple-400 block mt-1">{vbtResult.stats.win_rate_pct}%</span>
                  </div>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-3">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-emerald-400" /> VectorBT Equity Growth
                  </h3>
                  <div className="h-[280px] w-full pt-2">
                    <SafeChartContainer>
                      <AreaChart data={vbtChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} orientation="right" domain={['auto', 'auto']} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }} />
                        <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fillOpacity={0.3} fill="#10b981" />
                      </AreaChart>
                    </SafeChartContainer>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/40 border border-slate-800 p-12 rounded-2xl text-center text-slate-500">
                Click "Run VectorBT Engine" to generate backtest matrix results
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- ENGINE 2: BACKTRADER --- */}
      {activeEngine === 'backtrader' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-3">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              Backtrader Realism Setup
            </h3>

            <form onSubmit={handleRunBacktrader} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Fast Period</label>
                  <input type="number" value={btFast} onChange={(e) => setBtFast(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Slow Period</label>
                  <input type="number" value={btSlow} onChange={(e) => setBtSlow(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono" />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Market Slippage %</label>
                <input type="number" step="0.0005" value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono" />
              </div>

              <button
                type="submit"
                disabled={loadingBt}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/30"
              >
                {loadingBt ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Simulate Backtrader Realism
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 space-y-6">
            {btError && (
              <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-sm flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                <span>{btError}</span>
              </div>
            )}

            {btResult ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <span className="text-xs text-slate-400 font-medium">Final Portfolio</span>
                    <span className="text-xl font-bold font-mono text-white block mt-1">${btResult.performance.final_value.toLocaleString()}</span>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <span className="text-xs text-slate-400 font-medium">Net Return %</span>
                    <span className={`text-xl font-bold font-mono block mt-1 ${btResult.performance.total_return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {btResult.performance.total_return_pct >= 0 ? '+' : ''}{btResult.performance.total_return_pct}%
                    </span>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <span className="text-xs text-slate-400 font-medium">Sharpe Ratio</span>
                    <span className="text-xl font-bold font-mono text-blue-400 block mt-1">{btResult.performance.sharpe_ratio}</span>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <span className="text-xs text-slate-400 font-medium">SQN Quality Score</span>
                    <span className="text-xl font-bold font-mono text-indigo-400 block mt-1">{btResult.performance.sqn_score}</span>
                  </div>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-3 font-mono text-xs">
                  <h4 className="text-sm font-semibold text-slate-200">Execution Trade Breakdown</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 bg-slate-950 rounded-lg">
                      <span className="text-slate-400 block">Total Executed</span>
                      <span className="text-base font-bold text-white mt-1 block">{btResult.trade_stats.total_trades}</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-lg">
                      <span className="text-slate-400 block">Winning Trades</span>
                      <span className="text-base font-bold text-emerald-400 mt-1 block">{btResult.trade_stats.won}</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-lg">
                      <span className="text-slate-400 block">Losing Trades</span>
                      <span className="text-base font-bold text-rose-400 mt-1 block">{btResult.trade_stats.lost}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/40 border border-slate-800 p-12 rounded-2xl text-center text-slate-500">
                Click "Simulate Backtrader Realism" to run tick-by-tick event simulation
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- ENGINE 3: LUMIBOT --- */}
      {activeEngine === 'lumibot' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Cpu className="w-4 h-4 text-purple-400" />
              Lumibot Setup
            </h3>

            <form onSubmit={handleRunLumibot} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Strategy Type</label>
                <select
                  value={lumiStrategy}
                  onChange={(e) => setLumiStrategy(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                >
                  <option value="buy_and_hold">Buy & Hold Strategy</option>
                  <option value="sma_cross">Lumibot Dynamic SMA Crossover</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={loadingLumi}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-purple-900/30"
              >
                {loadingLumi ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Launch Lumibot Strategy
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 space-y-6">
            {lumiError && (
              <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-sm flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                <span>{lumiError}</span>
              </div>
            )}

            {loadingLumi && (
              <div className="p-12 border border-purple-800/40 bg-purple-950/20 rounded-2xl text-center space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-400" />
                <p className="text-sm font-semibold text-purple-200">Lumibot strategy running asynchronously in background...</p>
                <p className="text-xs text-slate-400 font-mono">Task ID: {lumiTaskId}</p>
              </div>
            )}

            {lumiResult?.status === 'done' && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <span className="text-xs text-slate-400 font-medium">Total Return</span>
                  <span className="text-xl font-bold font-mono text-purple-400 block mt-1">
                    {lumiResult.stats.total_return_pct}%
                  </span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <span className="text-xs text-slate-400 font-medium">CAGR %</span>
                  <span className="text-xl font-bold font-mono text-emerald-400 block mt-1">
                    {lumiResult.stats.cagr_pct}%
                  </span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <span className="text-xs text-slate-400 font-medium">Max Drawdown</span>
                  <span className="text-xl font-bold font-mono text-rose-400 block mt-1">
                    {lumiResult.stats.max_drawdown_pct}%
                  </span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <span className="text-xs text-slate-400 font-medium">Sharpe Ratio</span>
                  <span className="text-xl font-bold font-mono text-cyan-400 block mt-1">
                    {lumiResult.stats.sharpe_ratio}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- TAB 4: SIDE-BY-SIDE COMPARISON --- */}
      {activeEngine === 'comparison' && (
        <div className="space-y-6">
          <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-2xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Scale className="w-4 h-4 text-amber-400" />
              Engine Benchmark & Paradigm Matrix
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left font-mono">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="p-3">Feature / Metric</th>
                    <th className="p-3 text-emerald-400">VectorBT (Matrix)</th>
                    <th className="p-3 text-blue-400">Backtrader (Event)</th>
                    <th className="p-3 text-purple-400">Lumibot (Multi-Asset)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  <tr>
                    <td className="p-3 font-semibold text-slate-300">Execution Speed</td>
                    <td className="p-3 text-emerald-300">⚡ Milliseconds (Vectorized)</td>
                    <td className="p-3 text-slate-300">⏱️ Seconds (Event Loop)</td>
                    <td className="p-3 text-slate-300">⏳ Async Worker (Background)</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-300">Slippage & Commission</td>
                    <td className="p-3 text-slate-400">Basic Fee Ratio</td>
                    <td className="p-3 text-blue-300">Exact Tick Slippage + Broker Fee</td>
                    <td className="p-3 text-purple-300">Alpaca / Interactive Brokers Model</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-300">Primary Use Case</td>
                    <td className="p-3 text-slate-300">Parameter Discovery & Grid Search</td>
                    <td className="p-3 text-slate-300">Tick Realism & Realistic Backtest</td>
                    <td className="p-3 text-slate-300">Live Paper Trading Parity</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-300">Latest Run Return</td>
                    <td className="p-3 font-bold text-emerald-400">{vbtResult ? `${vbtResult.stats.total_return_pct}%` : 'Not run'}</td>
                    <td className="p-3 font-bold text-blue-400">{btResult ? `${btResult.performance.total_return_pct}%` : 'Not run'}</td>
                    <td className="p-3 font-bold text-purple-400">{lumiResult ? `${lumiResult.stats.total_return_pct}%` : 'Not run'}</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-300">Latest Run Sharpe</td>
                    <td className="p-3 font-bold text-emerald-400">{vbtResult ? vbtResult.stats.sharpe_ratio : 'Not run'}</td>
                    <td className="p-3 font-bold text-blue-400">{btResult ? btResult.performance.sharpe_ratio : 'Not run'}</td>
                    <td className="p-3 font-bold text-purple-400">{lumiResult ? lumiResult.stats.sharpe_ratio : 'Not run'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default StrategyLab;
