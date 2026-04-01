import React, { useState, useMemo, useCallback } from 'react';
import { Copy, Download, Play, Loader2, CandlestickChart, Check, AlertTriangle, Code2 } from 'lucide-react';
import { useToast } from '../../shared/ToastProvider';
import { TabHeader } from '../../ui/TabHeader';
import {
  PINE_STRATEGIES, getPineStrategy, defaultParamValues, PineParamValues, PineParam,
} from '../../../services/backtester/pine/pineStrategies';
import { runPineBacktest, fetchCandles, TVBacktestResult } from '../../../services/backtester/pine/PineBacktester';

const TVStrategyTester = React.lazy(() => import('./TVStrategyTester'));

const TIMEFRAMES: { value: '5' | '15' | '30' | '60'; label: string }[] = [
  { value: '5', label: '5 min' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
];

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const TradingViewLab: React.FC = () => {
  const { toast } = useToast();
  const [strategyId, setStrategyId] = useState<string>(PINE_STRATEGIES[0].id);
  const def = useMemo(() => getPineStrategy(strategyId)!, [strategyId]);

  const [params, setParams] = useState<PineParamValues>(() => defaultParamValues(PINE_STRATEGIES[0]));
  const [symbol, setSymbol] = useState<string>(PINE_STRATEGIES[0].defaultSymbol);
  const [timeframe, setTimeframe] = useState<'5' | '15' | '30' | '60'>(PINE_STRATEGIES[0].defaultTimeframe);
  const [fromDate, setFromDate] = useState<string>(todayISO(-365));
  const [toDate, setToDate] = useState<string>(todayISO(0));

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TVBacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onSelectStrategy = useCallback((id: string) => {
    const d = getPineStrategy(id)!;
    setStrategyId(id);
    setParams(defaultParamValues(d));
    setSymbol(d.defaultSymbol);
    setTimeframe(d.defaultTimeframe);
    setResult(null);
    setError(null);
  }, []);

  const setParam = useCallback((key: string, value: number | boolean) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const pineSource = useMemo(() => def.generatePine(params), [def, params]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pineSource);
      setCopied(true);
      toast.success('Pine Script copied - paste into TradingView editor.');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Clipboard blocked. Select the code and copy manually.');
    }
  }, [pineSource, toast]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([pineSource], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.id}_${symbol}.pine`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${def.id}_${symbol}.pine`);
  }, [pineSource, def.id, symbol, toast]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const candles = await fetchCandles(symbol.trim().toUpperCase(), timeframe, fromDate, toDate);
      const res = runPineBacktest(def.id, candles, params);
      if (res.trades.length === 0) {
        const days = new Set(candles.map((c) => c.date)).size;
        setError(`Fetched ${candles.length} candles across ${days} trading days, but no entry signals fired. Try a wider date range, a different symbol, or loosen the filters (e.g. turn off Require Retest / Require Volume, lower the deviation/z thresholds).`);
      } else {
        setResult(res);
      }
    } catch (e: any) {
      setError(e?.message || 'Backtest failed.');
    } finally {
      setRunning(false);
    }
  }, [def.id, symbol, timeframe, fromDate, toDate, params]);

  return (
    <div className="space-y-5">
      {/* Intro */}
      <TabHeader
        title="TradingView Strategy Tester"
        subtitle="Auto-generates a TradingView Pine Script v6 for each of your Python strategies. Tune parameters, preview a TradingView-style backtest in-app, then copy or download the script to validate on real TradingView."
        badge={
          <div className="rounded-xl bg-indigo-500/10 p-2 text-indigo-500">
            <CandlestickChart size={18} />
          </div>
        }
      />

      {/* Strategy selector */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {PINE_STRATEGIES.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelectStrategy(s.id)}
            className={`text-left rounded-xl border p-3 transition-all ${
              strategyId === s.id
                ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">{s.category}</div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{s.label}</div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">{s.file}</div>
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 px-1">{def.description}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: config */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-5 space-y-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">Configuration</h4>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase text-slate-400">Symbol</span>
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm font-bold uppercase" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase text-slate-400">Timeframe</span>
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as any)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm font-bold">
                {TIMEFRAMES.map((t) => <option key={t.value} value={t.value} className="bg-slate-900">{t.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase text-slate-400">From</span>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase text-slate-400">To</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" />
            </label>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
            <span className="text-[10px] font-bold uppercase text-slate-400">Strategy Parameters</span>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {def.params.map((param) => (
                <ParamControl key={param.key} param={param} value={params[param.key]} onChange={(v) => setParam(param.key, v)} />
              ))}
            </div>
          </div>

          <button
            onClick={handleRun}
            disabled={running}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-4 py-3 text-sm font-black uppercase tracking-wider text-white transition-colors"
          >
            {running ? <><Loader2 size={16} className="animate-spin" /> Running backtest…</> : <><Play size={16} /> Run In-App Preview</>}
          </button>
        </div>

        {/* Right: Pine script */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
              <Code2 size={14} className="text-indigo-500" /> Pine Script v6
            </h4>
            <div className="flex gap-2">
              <button onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-bold uppercase hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={handleDownload}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-bold uppercase hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <Download size={13} /> .pine
              </button>
            </div>
          </div>
          <pre className="flex-1 overflow-auto rounded-xl bg-[#0b1220] border border-slate-800 p-4 text-[11px] leading-relaxed font-mono text-slate-300 max-h-[420px]">
            <code>{pineSource}</code>
          </pre>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p className="text-xs font-semibold">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <React.Suspense fallback={<div className="p-10 text-center text-xs font-bold uppercase tracking-widest text-slate-500 animate-pulse">Rendering analytics…</div>}>
          <TVStrategyTester result={result} symbol={symbol.toUpperCase()} />
        </React.Suspense>
      )}
    </div>
  );
};

const ParamControl: React.FC<{ param: PineParam; value: number | boolean; onChange: (v: number | boolean) => void }> = ({ param, value, onChange }) => {
  if (param.type === 'bool') {
    return (
      <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{param.label}</span>
        <input type="checkbox" checked={value as boolean} onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-indigo-500" />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase text-slate-400">{param.label}</span>
      <input
        type="number"
        value={value as number}
        min={param.min}
        max={param.max}
        step={param.step ?? (param.type === 'float' ? 0.1 : 1)}
        onChange={(e) => onChange(param.type === 'int' ? parseInt(e.target.value || '0', 10) : parseFloat(e.target.value || '0'))}
        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm font-semibold"
      />
    </label>
  );
};

export default TradingViewLab;
