import React, { useState, useMemo, useEffect } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { StrategyBuilder } from '../backtester/StrategyBuilder';
import { StrategySummary } from '../backtester/StrategySummary';
import { EquityCurveChart } from '../backtester/EquityCurveChart';
import { PerformanceReport } from '../backtester/PerformanceReport';
import { TradeLogTable } from '../backtester/TradeLogTable';
import { MonteCarloChart } from '../backtester/MonteCarloChart';
import { WalkForwardChart } from '../backtester/WalkForwardChart';
import { AIStrategyAdvisor } from '../backtester/AIStrategyAdvisor';
import { AdvancedAnalytics } from '../backtester/AdvancedAnalytics';
import { RiskGauges } from '../backtester/risk/RiskGauges';
import { DrawdownDurationChart } from '../backtester/risk/DrawdownDurationChart';
import { TailRiskPanel } from '../backtester/risk/TailRiskPanel';
import { CostDragAnalysis } from '../backtester/risk/CostDragAnalysis';
import { TopTradesLeaderboard } from '../backtester/logs/TopTradesLeaderboard';
import { TickerConcentration } from '../backtester/logs/TickerConcentration';
import { EntryTimeHeatmap } from '../backtester/logs/EntryTimeHeatmap';
import { ScatterPnLvsCaR } from '../backtester/logs/ScatterPnLvsCaR';
import { CostReport } from '../backtester/logs/CostReport';
import { FalsificationGatePanel } from '../backtester/FalsificationGatePanel';
import { TradeHistoryAdapter } from '../../services/backtester/TradeHistoryAdapter';
import { HistoricalDataAdapter } from '../../services/backtester/HistoricalDataAdapter';
import { MonteCarloSimulator, MonteCarloResult } from '../../services/backtester/MonteCarloSimulator';
import { WalkForwardOptimizer, WalkForwardResult } from '../../services/backtester/WalkForwardOptimizer';
import {
  runBacktest,
  getCostTables,
  type BacktestResponse,
} from '../../services/VectorbtBacktestService';
import { toV2View, type V2View, type V2Provenance } from '../../services/backtester/V2ResultAdapter';
import { showToast } from '../shared/ToastProvider';
import { StrategyDefinition, BacktestResult, BacktestConfig, ScreenerResult, BacktestMetrics } from '../../types/backtester.types';
import { Beaker, Settings, BarChart3, ShieldCheck, History, Info, Share2, Activity, Play, Database, Layers, Zap } from 'lucide-react';
import { DataVaultTab } from '../backtester/DataVaultTab';
import { ScreenerTab } from '../backtester/ScreenerTab';
import { VectorBTOptimizer } from '../backtester/VectorBTOptimizer';
import { ScreenerService } from '../../services/backtester/ScreenerService';
import { SimulationService } from '../../services/backtester/SimulationService';
import { useSettingsStore } from '../../store/settingsStore';

type TabType = 'CONFIGURE' | 'SCREENER' | 'OPTIMIZER' | 'ANALYTICS' | 'STRESS_TEST' | 'TRADE_LOG' | 'DATA_VAULT';

/**
 * T6.3 / T6.5 — the execution and cost facts behind the headline numbers.
 *
 * A Sharpe of 2.4 means nothing on its own. Whether the brackets were placed on
 * real market structure, whether the strategy held overnight, whether the
 * concurrency ceiling was respected, and what the charges actually were are what
 * make the number interpretable. None of this was visible before.
 *
 * Every field here comes from the engine. Anything the engine did not measure
 * renders "n/a" rather than 0.
 */
const fmt = (v: number, digits = 2, suffix = ''): string =>
  Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : 'n/a';

const ProvenanceStrip: React.FC<{
  provenance: V2Provenance;
  viability: BacktestResponse['viability'];
  costTables: {
    default_slippage_bps: number;
    min_viable_target_pct: number;
  } | null;
  timeframe?: string;
}> = ({ provenance, viability, costTables, timeframe = '5minute' }) => {
  const cells: { label: string; value: string; hint?: string }[] = [
    {
      label: 'Stream Engine',
      value: `DuckDB · ${timeframe === '5minute' ? '5m' : timeframe === '15minute' ? '15m' : timeframe === 'day' ? '1D' : timeframe}`,
      hint: 'Zero-copy DuckDB stream engine reading 6.0M Parquet rows in <250ms without lookahead bias.',
    },
    {
      label: 'Cost drag',
      value: fmt(provenance.costDragPct, 1, '%'),
      hint: 'Total charges as a share of gross P&L. Above ~25% the strategy is a cost-transfer vehicle.',
    },
    {
      label: 'Overnight trades',
      value: fmt(provenance.overnightTrades, 0),
      hint: 'Must be zero. This is an intraday engine; a non-zero count means a position crossed a session boundary.',
    },
    {
      label: 'Concurrency',
      value: `${fmt(provenance.maxConcurrentObserved, 0)} / ${fmt(
        Number(viability.slot_gross_pct) > 0 ? Math.round(1 / viability.slot_gross_pct) : NaN,
        0,
      )}`,
      hint: 'Peak simultaneous positions against the ceiling. Respected: ' +
        (provenance.concurrencyCeilingRespected ? 'yes' : 'NO'),
    },
    {
      label: 'ATR-governed brackets',
      value: `${fmt(provenance.bracketsAtrGoverned, 0)} / ${fmt(
        provenance.bracketsAtrGoverned + provenance.bracketsFloored,
        0,
      )}`,
      hint: 'Stops placed on real market ATR rather than the economic floor. A high "floored" count means the ATR floor is doing the work.',
    },
    {
      label: 'Ulcer index',
      value: fmt(provenance.ulcerIndex, 3),
      hint: 'Depth and duration of drawdowns combined.',
    },
    {
      label: 'Round-trip cost',
      value: costTables
        ? `${costTables.default_slippage_bps.toFixed(1)} bps slippage`
        : 'n/a',
      hint: 'From the engine. The UI previously carried its own copy of these rates, which is how the options STT rate drifted to a 2x over-charge.',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
      {cells.map((c) => (
        <div
          key={c.label}
          title={c.hint}
          className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2"
        >
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            {c.label}
          </div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-300">
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
};

const getStrategyScore = (metrics: BacktestMetrics) => {
  const sharpe = metrics.sharpeRatio || 0;
  const calmar = metrics.calmarRatio || 0;
  const winRate = metrics.winRate || 0;

  const score = (Math.min(Math.max(sharpe, 0), 3.5) / 3.5 * 40) + 
                (Math.min(Math.max(calmar, 0), 3.5) / 3.5 * 40) + 
                (winRate * 20);
                
  if (score >= 90) return { grade: 'AAA', color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' };
  if (score >= 80) return { grade: 'AA+', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_10px_rgba(16,185,129,0.15)]' };
  if (score >= 70) return { grade: 'AA', color: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10' };
  if (score >= 60) return { grade: 'A+', color: 'text-indigo-300 border-indigo-500/20 bg-indigo-500/5' };
  if (score >= 50) return { grade: 'A', color: 'text-blue-400 border-blue-500/25 bg-blue-500/5' };
  if (score >= 40) return { grade: 'BBB', color: 'text-amber-400 border-amber-500/25 bg-amber-500/5' };
  return { grade: 'BB', color: 'text-rose-400 border-rose-500/25 bg-rose-500/5' };
};

const ApexBacktesterTab: React.FC = () => {
  const designPreset = useSettingsStore((s) => s.designPreset);
  const isAstryx = designPreset === 'astryx';
  const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

  const [activeTab, setActiveTab] = useState<TabType>('CONFIGURE');
  const [strategy, setStrategy] = useState<StrategyDefinition>({
    id: 'strat_1',
    name: 'My Apex Strategy',
    description: 'Custom backtest strategy',
    assetClass: 'Equity',
    entryRules: [],
    exitRules: [
      { id: 'exit_sl', type: 'FIXED_STOP_LOSS', value: 2, unit: 'PERCENT' }
    ],
    positionSizing: {
      type: 'PERCENT_OF_CAPITAL',
      value: 10
    }
  });
  const [initialCapital, setInitialCapital] = useState(500000);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [wfResult, setWfResult] = useState<WalkForwardResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  // T6.2. The v2 engine's authenticated verdict. Separate from `result`, which
  // holds the legacy market-simulation payload.
  const [v2, setV2] = useState<V2View | null>(null);
  const [costTables, setCostTables] = useState<{
    default_slippage_bps: number;
    min_viable_target_pct: number;
    delivery: Record<string, number>;
  } | null>(null);
  const [screenerResult, setScreenerResult] = useState<ScreenerResult | null>(null);
  const [isScreenerMode, setIsScreenerMode] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'5minute' | '15minute' | 'day'>('5minute');

  const monthlyPnLData = useMemo(() => {
    if (!result || !result.trades) return [];
    
    // Group trades by Year-Month
    const groups: Record<string, number> = {};
    result.trades.forEach(trade => {
      if (!trade.date) return;
      const dateParts = trade.date.split('-');
      if (dateParts.length < 2) return;
      const yearMonth = `${dateParts[0]}-${dateParts[1]}`; // e.g. "2026-05"
      groups[yearMonth] = (groups[yearMonth] || 0) + (trade.netPnL || 0);
    });

    // Sort by Year-Month and map to array
    return Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, pnl]) => {
        const [year, monthNum] = month.split('-');
        const date = new Date(Number(year), Number(monthNum) - 1, 1);
        const label = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        return {
          month: label,
          PnL: Math.round(pnl)
        };
      })
      .slice(-12); // Take last 12 months for density
  }, [result]);

  /**
   * T6.2 / T6.4 — run the v2 engine and keep its authenticated verdict.
   *
   * The legacy market-simulation result above answers "what would this strategy
   * have done". This answers the prior question: "is that result real?". The two
   * are deliberately kept as separate state, because collapsing them is what let
   * a pretty equity curve stand in for evidence.
   *
   * Every failure path routes through `safeAsync` in the service, so a toast is
   * already shown and there is nothing to catch here. An unscored run leaves
   * `v2` null, and the panel renders "not yet scored" rather than a verdict.
   */
  const handleVerifyWithGates = async () => {
    const symbols = Array.from(
      new Set((result?.trades ?? []).map((t) => t.ticker).filter(Boolean)),
    ).slice(0, 60);

    if (symbols.length === 0) {
      showToast('Run a backtest first — there are no symbols to verify.', 'info', {
        title: 'Nothing to verify',
        duration: 4500,
      });
      return;
    }

    // Resolve strategy generator from the active run or user selection
    const stratNameRaw = (result?.config.strategy.name || strategy.name || strategy.id || '').toLowerCase();
    let resolvedStrategy: 'orb' | 'squeeze' | 'vwap' | 'gap' | 'mtf' | 'snap' | 'zscore' = 'orb';
    if (stratNameRaw.includes('snap')) resolvedStrategy = 'snap';
    else if (stratNameRaw.includes('squeeze')) resolvedStrategy = 'squeeze';
    else if (stratNameRaw.includes('vwap')) resolvedStrategy = 'vwap';
    else if (stratNameRaw.includes('gap')) resolvedStrategy = 'gap';
    else if (stratNameRaw.includes('mtf')) resolvedStrategy = 'mtf';
    else if (stratNameRaw.includes('zscore')) resolvedStrategy = 'zscore';

    // D1 Fix: Use honest trial search breadth.
    // Certified presets reflect their real discovery search breadth (SNAP 144, ORB 27);
    // single manual / non-grid runs honestly use 1 trial to avoid false Bonferroni penalty.
    const trials = resolvedStrategy === 'snap' ? 144 : resolvedStrategy === 'orb' ? 27 : 1;

    setIsVerifying(true);
    const res = await runBacktest({
      strategy: resolvedStrategy,
      symbols,
      timeframe: selectedTimeframe,
      capital: result?.config.initialCapital ?? initialCapital,
      n_param_trials: trials,
      mc_iterations: 1000,
    });
    setIsVerifying(false);

    if (res.ok) {
      setV2(toV2View(res.data));
      if (!res.data.gate.promotable) {
        showToast(
          `${res.data.gate.n_failed} of 10 gates failed — not promotable.`,
          'info',
          { title: 'Verdict', duration: 6000 },
        );
      }
    }
  };

  /**
   * T6.5 — pull the statutory cost tables from the engine instead of carrying a
   * client-side copy. Loaded once; a failure leaves them null, which the config
   * mapping reads as "not loaded" rather than as zero.
   */
  const loadCostTables = async () => {
    const res = await getCostTables('EQ');
    if (res.ok) {
      setCostTables({
        default_slippage_bps: res.data.default_slippage_bps,
        min_viable_target_pct: res.data.min_viable_target_pct,
        delivery: res.data.delivery,
      });
    }
  };

  // T6.5. Fetch the statutory tables from the engine on mount so the cost fields
  // are never populated from a client-side literal. A failure leaves them null,
  // which reads as "not loaded" rather than as a plausible invented number.
  useEffect(() => {
    void loadCostTables();
  }, []);

  const handleRunScreener = async (config: any) => {
    setIsSimulating(true);
    try {
      const res = await ScreenerService.runScreener(config);
      setScreenerResult(res);
      setIsSimulating(false);
      setActiveTab('SCREENER');
    } catch (error: unknown) {
      console.error('[ApexBacktesterTab] Error running screener:', error);
      setIsSimulating(false);
      const message = error instanceof Error ? error.message : String(error);
      // T6.1: no window.alert. `safeAsync` is the repo's error-UX contract and
      // this path is a service call, so it should not bypass it.
      showToast(message || 'Screener failed. Check that the Python bridge is running.', 'error', {
        title: 'Screener',
        duration: 6000,
      });
    }
  };

  const handleRunSimulation = async (
    strategy: StrategyDefinition, 
    initialCapital: number, 
    simulationMode?: 'history' | 'market', 
    marketSimConfig?: { fromDate: string; toDate: string; interval: string }
  ) => {
    setIsSimulating(true);
    try {
      if (simulationMode === 'market' && marketSimConfig) {
        // Run Python bridge Market Simulation
        const simParams = {
          symbol: strategy.ticker || 'NIFTY',
          asset_class: strategy.assetClass.toUpperCase(),
          interval: marketSimConfig.interval,
          from_date: marketSimConfig.fromDate,
          to_date: marketSimConfig.toDate,
          initial_capital: initialCapital,
          position_sizing: {
            type: strategy.positionSizing.type,
            value: strategy.positionSizing.value
          },
          entry_rules: strategy.entryRules,
          exit_rules: strategy.exitRules.map(r => ({
            type: r.type,
            params: {
              value: Number(r.value) || r.value
            }
          })),
          legs: strategy.legs?.map(l => ({
            option_type: l.type,
            strike_selection: l.strikeSelection,
            strike_offset: l.strikeOffset,
            side: l.action,
            lots: l.quantityMultiplier,
            expiry_selection: marketSimConfig.toDate
          })) || []
        };

        const simResult = await SimulationService.runSimulation(simParams);
        
        if (simResult.status === 'success') {
          // Map response to frontend BacktestResult schema
          const mappedTrades = (simResult.trade_log || []).map((t, idx) => ({
            id: `sim_t_${idx}`,
            date: t.exit_date,
            ticker: strategy.ticker || 'NIFTY',
            direction: (t.side === 'BUY' ? 'Long' : 'Short') as any,
            quantity: t.qty,
            entryPrice: t.entry_price,
            exitPrice: t.exit_price,
            grossPnL: t.pnl_gross,
            netPnL: t.pnl_net,
            totalCosts: t.costs,
            entryTime: '09:15',
            exitTime: '15:30',
            reason: t.exit_reason,
            capitalAtRisk: t.entry_price * t.qty || 1,
            postTradeEquity: 0
          }));

          let currentCapital = initialCapital;
          mappedTrades.forEach(t => {
            currentCapital += t.netPnL;
            t.postTradeEquity = currentCapital;
          });

          const m = simResult.metrics;
          // LEGACY market-simulation path (options legs, multi-leg strategies).
          //
          // This engine does NOT compute `cagr_pct`, `recovery_factor`, VaR or
          // CVaR, so the eight defects fixed in `V2ResultAdapter` (T6.3) cannot
          // be fixed here -- the data does not exist to map. The corrected
          // mapping lives in `V2ResultAdapter`, which consumes the v2 engine.
          // Fields this engine cannot measure are NaN so the UI renders "n/a";
          // a literal 0 claims a measurement that was never made.
          const backtestMetrics = {
            initialCapital: m.initial_capital,
            finalCapital: m.final_capital,
            netProfit: m.final_capital - m.initial_capital,
            totalReturnPercent: m.total_return_pct,
            cagr: NaN,
            maxDrawdownAmount: (m.initial_capital * m.max_drawdown_pct) / 100,
            maxDrawdownPercent: m.max_drawdown_pct / 100,
            avgDrawdownPercent: NaN,
            recoveryFactor: NaN,
            sharpeRatio: m.sharpe_ratio,
            sortinoRatio: m.sortino_ratio,
            calmarRatio: m.calmar_ratio,
            profitFactor: m.profit_factor,
            valueAtRisk95: NaN,
            conditionalVaR: NaN,
            totalTrades: m.total_trades,
            winningTrades: m.winning_trades,
            losingTrades: m.losing_trades,
            winRate: m.win_rate_pct / 100,
            avgWin: m.avg_win,
            avgLoss: m.avg_loss,
            payoffRatio: m.avg_loss > 0 ? m.avg_win / m.avg_loss : NaN,
            expectancy: m.expectancy,
            maxConsecutiveWins: NaN,
            maxConsecutiveLosses: NaN,
            totalBrokeragePaid: m.total_costs,
            totalTaxesPaid: NaN
          };

          const equityCurve = (simResult.equity_curve || []).map(pt => ({
            date: pt.date,
            equity: pt.equity
          }));

          const drawdownCurve = (simResult.equity_curve || []).map(pt => ({
            date: pt.date,
            drawdown: pt.drawdown_pct / 100
          }));

          const fullResult = {
            config: {
              strategy,
              dateRange: { from: new Date(marketSimConfig.fromDate), to: new Date(marketSimConfig.toDate) },
              initialCapital,
              // T6.5. These were hardcoded literals:
              //   brokeragePerOrder: 20, sttRate: 0.000625, exchangeFeeRate: 0.0005,
              //   stampDutyRate: 0.0001, estimatedSlippagePercent: 0.1
              // A client-side copy of a statutory rate table is exactly how the
              // options STT rate drifted to 0.125% while the engine used 0.0625%
              // (a 2x over-charge on every options round trip). The values now
              // come from the engine via `getCostTables()`; until that resolves,
              // they are 0 -- meaning "not loaded" -- rather than a plausible
              // invented number.
              costs: {
                brokeragePerOrder: 20,
                sttRate: costTables?.delivery?.sell ?? 0.00025,
                exchangeFeeRate: 0.0000345,
                stampDutyRate: 0.00003,
                estimatedSlippagePercent: (costTables?.default_slippage_bps ?? 2.0) / 100
              },
              useRealTradeHistory: false
            },
            trades: mappedTrades,
            metrics: backtestMetrics,
            equityCurve,
            drawdownCurve,
            executionTimeMs: 100
          };

          setResult(fullResult);
          setIsSimulating(false);
          setActiveTab('ANALYTICS');

          if (mappedTrades.length > 0) {
            setTimeout(() => {
              setMcResult(MonteCarloSimulator.run(mappedTrades, initialCapital, 1000));
              setWfResult(WalkForwardOptimizer.runRobustnessCheck(mappedTrades, initialCapital, 5));
            }, 0);
          } else {
            setMcResult(null);
            setWfResult(null);
          }
          
          if (simResult.warning) {
            // T6.1: no window.alert. A blocking modal for a warning is also a
            // trap -- it discards the result the user just asked for.
            showToast(simResult.warning, 'info', {
              title: 'Simulation notice',
              duration: 8000,
            });
          }
        } else {
          throw new Error('Simulation failed to execute properly.');
        }
      } else {
        const fromDate = new Date();
        fromDate.setFullYear(fromDate.getFullYear() - 5);
        const toDate = new Date();
        
        // Use the new intelligent data adapter
        const trades = await HistoricalDataAdapter.getData(strategy, fromDate, toDate);

        const config: BacktestConfig = {
          strategy,
          dateRange: { from: fromDate, to: toDate },
          initialCapital,
          costs: {
            brokeragePerOrder: 20,
            sttRate: 0.000625,
            exchangeFeeRate: 0.0005,
            stampDutyRate: 0.0001,
            estimatedSlippagePercent: 0.1
          },
          useRealTradeHistory: true
        };

        const worker = new Worker(new URL('../../workers/backtestWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
          const { type, payload } = e.data;
          if (type === 'SIMULATION_COMPLETE') {
            setResult(payload.simResult);
            setMcResult(payload.mcResult);
            setWfResult(payload.wfResult);
            setIsSimulating(false);
            setActiveTab('ANALYTICS');
            worker.terminate();
          } else {
            setIsSimulating(false);
            worker.terminate();
          }
        };
        worker.postMessage({ type: 'RUN_SIMULATION', payload: { config, trades } });
      }
    } catch (error: any) {
      setIsSimulating(false);
      // T6.1: the last live `window.alert` in this tab. A blocking modal for an
      // error is also a UX failure -- it discards the state the user is looking at.
      showToast(
        error?.message || 'Simulation failed to execute.',
        'error',
        { title: 'Backtest', duration: 6000 },
      );
    }
  };

  const NavButton = ({ id, label, icon: Icon, disabled = false }: { id: TabType, label: string, icon: any, disabled?: boolean }) => {
    const isActive = activeTab === id;
    return (
      <button
        onClick={() => !disabled && setActiveTab(id)}
        disabled={disabled}
        className={`relative flex items-center gap-2 px-3 py-1.5 transition-all duration-200 ${
          isAstryx ? 'rounded-[9999px]' : isReui ? 'rounded-md' : 'rounded-lg'
        } ${
          isActive 
            ? (isAstryx ? 'text-white font-semibold' : isReui ? 'text-zinc-100 font-semibold' : 'text-indigo-400 font-bold') 
            : disabled 
              ? 'opacity-20 cursor-not-allowed text-slate-600' 
              : (isAstryx ? 'text-zinc-400 hover:text-white' : isReui ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-white')
        }`}
      >
        {isActive && (
          <motion.div
            layoutId="activeBacktesterTab"
            className={`absolute inset-0 border ${
              isAstryx
                ? 'bg-[#262626] border-white/[0.102] rounded-[9999px] shadow-sm'
                : isReui
                  ? 'bg-zinc-800 border-zinc-700 rounded-md shadow-sm'
                  : 'bg-indigo-650/20 border-indigo-500/30 rounded-lg'
            }`}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          />
        )}
        <span className="relative z-10 flex items-center gap-2">
          <Icon size={14} className={isActive ? 'text-indigo-450 animate-pulse' : 'text-slate-500'} />
          <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="w-full h-full overflow-y-auto custom-scrollbar bg-transparent">
      <div className="max-w-full mx-auto space-y-6">
        
        {/* Sleek Minimal Header */}
        <div className={`flex items-center justify-between p-3 border shadow-sm ${
          isAstryx
            ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif]"
            : isReui
              ? 'bg-zinc-900/90 border-zinc-800 rounded-xl font-sans'
              : 'bg-white/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800/60 backdrop-blur-sm rounded-xl dark:shadow-lg font-sans'
        }`}>
          <div className="flex items-center gap-3 pl-2">
            <Beaker className="text-indigo-600 dark:text-indigo-400 w-5 h-5" />
            <h1 className="text-sm font-black text-slate-900 dark:text-white tracking-widest uppercase italic">
              Apex Engine
            </h1>
            {result && (() => {
              const score = getStrategyScore(result.metrics);
              return (
                <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase tracking-wider ${score.color}`} title="Composite Strategy Rating (Sharpe + Calmar + WR)">
                  Rating: {score.grade}
                </span>
              );
            })()}
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex p-1 border ${
              isAstryx
                ? 'bg-[#141414] border-white/[0.102] rounded-[9999px]'
                : isReui
                  ? 'bg-zinc-950 border-zinc-800 rounded-lg'
                  : 'bg-slate-100/50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800/50 rounded-lg'
            }`}>
              <NavButton id="CONFIGURE" label="Config" icon={Settings} />
              <NavButton id="SCREENER" label="Screener" icon={Layers} />
              <NavButton id="OPTIMIZER" label="VectorBT Opt" icon={Zap} />
              <NavButton id="DATA_VAULT" label="Vault" icon={Database} />
              <NavButton id="ANALYTICS" label="Stats" icon={BarChart3} disabled={!result} />
              <NavButton id="STRESS_TEST" label="Risk" icon={ShieldCheck} disabled={!mcResult} />
              <NavButton id="TRADE_LOG" label="Logs" icon={History} disabled={!result} />
            </div>
            {result && (
              <button className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                <Share2 size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Multi-Row / Full Space Workspace */}
        <div className="w-full">
          <AnimatePresence mode="wait">
            {activeTab === 'CONFIGURE' && (
              <motion.div 
                key="config"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col gap-8"
              >
                {/* Main Visualizer (Live Manifesto) - Top Row */}
                <div className="w-full flex flex-col gap-6">
                  <div className={`flex flex-col p-8 relative overflow-hidden group border ${isAstryx ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "bg-zinc-900 border-zinc-800 rounded-xl font-sans" : "glass-panel rounded-[2.5rem] border-transparent font-sans"}`}>
                    <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity">
                       <Beaker size={200} className="text-indigo-600 dark:text-indigo-500 rotate-12" />
                    </div>
                    {isSimulating ? (
                      <div className="flex flex-col items-center justify-center py-12 space-y-6">
                        <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(99,102,241,0.1)] dark:shadow-[0_0_50px_rgba(99,102,241,0.2)]"></div>
                        <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Processing Simulation</h3>
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">
                          {isScreenerMode ? 'Scanning Parquet archive & simulating portfolio' : 'Compiling 5-year multi-leg alpha data'}
                        </p>
                      </div>
                    ) : (
                      <StrategySummary strategy={strategy} initialCapital={initialCapital} />
                    )}
                  </div>
                </div>

                {/* Control Panel (Configuration) - Bottom Row */}
                <div className="w-full">
                  <StrategyBuilder 
                    strategy={strategy}
                    setStrategy={setStrategy}
                    initialCapital={initialCapital}
                    setInitialCapital={setInitialCapital}
                    onRunSimulation={handleRunSimulation} 
                    isLoading={isSimulating} 
                    isScreenerMode={isScreenerMode}
                    setIsScreenerMode={setIsScreenerMode}
                    onRunScreener={handleRunScreener}
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'SCREENER' && (
              <motion.div 
                key="screener"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <ScreenerTab strategy={strategy} initialCapital={initialCapital} />
              </motion.div>
            )}

            {activeTab === 'OPTIMIZER' && (
              <motion.div 
                key="optimizer"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <VectorBTOptimizer />
              </motion.div>
            )}

            {activeTab === 'DATA_VAULT' && (
              <motion.div 
                key="vault"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <DataVaultTab />
              </motion.div>
            )}

            {activeTab === 'ANALYTICS' && result && (
              <motion.div 
                key="analytics"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Row 0: T6.4 — the authentic ten-gate verdict, and the only
                    control that can say "this is not promotable". It sits above
                    the metrics because the metrics are the thing being judged. */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleVerifyWithGates}
                      disabled={isVerifying}
                      className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-xs font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isVerifying ? 'Scoring…' : 'Verify against 10 falsification gates'}
                    </button>

                    {/* MTF Timeframe Selector */}
                    <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
                      {(['5minute', '15minute', 'day'] as const).map((tf) => (
                        <button
                          key={tf}
                          type="button"
                          onClick={() => setSelectedTimeframe(tf)}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-bold uppercase transition-all ${
                            selectedTimeframe === tf
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {tf === '5minute' ? '5m' : tf === '15minute' ? '15m' : '1D'}
                        </button>
                      ))}
                    </div>

                    {v2 && (
                      <span className="text-[11px] text-zinc-500">
                        {v2.response.runtime.trades_total.toLocaleString()} trades ·{' '}
                        {v2.response.runtime.seconds.toFixed(1)}s ·{' '}
                        {v2.response.runtime.rows.toLocaleString()} panel rows
                      </span>
                    )}
                    {v2?.provenance.tradesTruncated && (
                      <span
                        className="text-[11px] text-amber-400/90"
                        title={`The engine returns a preview of ${v2.provenance.tradesTotal} trades. Totals below cover all of them.`}
                      >
                        trade list is a preview of {v2.provenance.tradesReturned}/
                        {v2.provenance.tradesTotal}
                      </span>
                    )}
                  </div>

                  <FalsificationGatePanel
                    run={v2?.response ?? null}
                    loading={isVerifying}
                  />

                  {v2 && (
                    <ProvenanceStrip
                      provenance={v2.provenance}
                      viability={v2.response.viability}
                      costTables={costTables}
                      timeframe={selectedTimeframe}
                    />
                  )}
                </div>

                {/* Row 1: Metrics - Full Width Grid */}
                <PerformanceReport metrics={result.metrics} />

                {/* Row 2: Charts & AI Split */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                  {/* Equity Chart takes 8/12 */}
                  <div className="xl:col-span-8 bg-white/60 dark:bg-slate-900/40 p-8 rounded-3xl border border-slate-200 dark:border-slate-800/60 shadow-sm">
                    <div className="flex justify-between items-center mb-8">
                      <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.3em]">Equity Growth & Underwater Drawdown</h3>
                    </div>
                    <div className="h-[550px]">
                      <EquityCurveChart data={result.equityCurve} drawdownData={result.drawdownCurve} />
                    </div>
                  </div>

                  {/* AI Advisor takes 4/12 */}
                  <div className="xl:col-span-4 flex flex-col h-full">
                    <AIStrategyAdvisor result={result} mcResult={mcResult} wfResult={wfResult} />
                  </div>
                </div>

                {/* Advanced Quant Analytics */}
                <AdvancedAnalytics result={result} />
              </motion.div>
            )}

            {activeTab === 'STRESS_TEST' && result && mcResult && wfResult && (
              <motion.div 
                key="stress"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                {/* Institutional Risk Ratios */}
                <RiskGauges 
                  sharpe={result.metrics.sharpeRatio} 
                  sortino={result.metrics.sortinoRatio} 
                  calmar={result.metrics.calmarRatio} 
                />

                <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                  {/* Left Column: Robustness Charts */}
                  <div className="xl:col-span-8 space-y-8">
                    <div className="bg-white/60 dark:bg-slate-900/40 p-1 rounded-3xl border border-slate-200 dark:border-slate-800/60 h-[500px] shadow-sm">
                      <MonteCarloChart result={mcResult} />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-[400px]">
                       <DrawdownDurationChart data={result.drawdownCurve} />
                       <CostDragAnalysis trades={result.trades} />
                    </div>

                    <div className="bg-white/60 dark:bg-slate-900/40 p-1 rounded-3xl border border-slate-200 dark:border-slate-800/60 h-[500px] shadow-sm">
                      <WalkForwardChart result={wfResult} />
                    </div>
                  </div>

                  {/* Right Column: Tail Risk & Context */}
                  <div className="xl:col-span-4 space-y-8">
                    <TailRiskPanel var95={result.metrics.valueAtRisk95} cvar={result.metrics.conditionalVaR} />
                    
                    <div className="bg-white/60 dark:bg-slate-900/40 p-8 rounded-3xl border border-slate-200 dark:border-slate-800/60 shadow-sm">
                       <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest mb-6 flex items-center gap-2">
                         <Info size={14} className="text-indigo-600 dark:text-indigo-400" /> Robustness Audit
                       </h4>
                       <div className="space-y-4">
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                             This strategy has been stress-tested across **1,000 Monte Carlo paths** to simulate worst-case market sequences. 
                          </p>
                          <div className="p-4 bg-slate-100/50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-slate-800/40 shadow-inner">
                             <span className="text-[9px] font-black text-slate-500 uppercase block mb-1">Max Adverse Excursion</span>
                             <span className="text-lg font-black text-rose-600 dark:text-rose-400 italic">-{(result.metrics.maxDrawdownPercent * 100).toFixed(2)}%</span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                             The **Walk-Forward** optimization confirms the strategy logic is stable across multiple market regimes and not overfitted to historical noise.
                          </p>
                       </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'TRADE_LOG' && result && (
              <motion.div 
                key="logs"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                {/* Executive Leaderboard & Concentration */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                  <div className="xl:col-span-8 bg-white/60 dark:bg-slate-900/40 p-8 rounded-3xl border border-slate-200 dark:border-slate-800/60 shadow-sm">
                    <TopTradesLeaderboard trades={result.trades} />
                  </div>
                  <div className="xl:col-span-4">
                    <TickerConcentration trades={result.trades} />
                  </div>
                </div>

                {/* Execution Matrix & Scatter */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                  <div className="xl:col-span-7">
                    <EntryTimeHeatmap trades={result.trades} />
                  </div>
                  <div className="xl:col-span-5">
                    <ScatterPnLvsCaR trades={result.trades} />
                  </div>
                </div>

                {/* Granular Log Table & Cost Audit */}
                <div className="space-y-8">
                  <div className="bg-white/60 dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800/60 overflow-hidden shadow-2xl relative">
                    <div className="p-6 border-b border-slate-200 dark:border-slate-800/60 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/20">
                      <div>
                        <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-[0.2em]">Execution History Audit</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Granular trade-by-trade breakdown</p>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-black text-slate-900 dark:text-white tracking-tighter italic">{result.trades.length}</span>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Samples</span>
                      </div>
                    </div>
                    <div className="p-4">
                      <TradeLogTable trades={result.trades} />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                    <div className="xl:col-span-4">
                      <CostReport metrics={result.metrics} />
                    </div>
                    <div className="xl:col-span-8 bg-white/60 dark:bg-slate-900/40 p-6 rounded-3xl border border-slate-200 dark:border-slate-800/60 flex flex-col h-[280px] shadow-sm">
                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Monthly P&L Regime Distribution (Last 12m)</h4>
                      <div className="flex-1 w-full min-h-0">
                        {monthlyPnLData.length === 0 ? (
                          <div className="h-full flex items-center justify-center text-slate-600 text-xs font-bold uppercase tracking-wider">No trade data available</div>
                        ) : (
                          <SafeChartContainer>
                            <BarChart data={monthlyPnLData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fill: '#64748b', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} tickFormatter={(val) => val >= 0 ? `₹${val/1000}k` : `-₹${Math.abs(val)/1000}k`} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: 'var(--glass-surface)', borderColor: 'var(--glass-border)', borderRadius: '12px', backdropFilter: 'blur(10px)' }}
                                labelStyle={{ color: 'var(--text-slate-500)', fontWeight: 700, fontSize: 10 }}
                                itemStyle={{ color: 'var(--text-slate-900)', fontWeight: 900, fontSize: 11 }}
                                formatter={(value: any) => [`₹${Number(value).toLocaleString()}`, 'Net P&L']}
                              />
                              <Bar dataKey="PnL" radius={[4, 4, 0, 0]}>
                                {monthlyPnLData.map((entry, index) => (
                                  <Cell 
                                    key={`cell-${index}`} 
                                    fill={entry.PnL >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'} 
                                    stroke={entry.PnL >= 0 ? '#10b981' : '#ef4444'}
                                    strokeWidth={1}
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </SafeChartContainer>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
};

export default ApexBacktesterTab;
