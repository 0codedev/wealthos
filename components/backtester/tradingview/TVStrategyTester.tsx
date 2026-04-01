import React, { useMemo } from 'react';
import {
  ComposedChart, Bar, Line, Area, AreaChart, XAxis, YAxis, Tooltip, Cell,
  BarChart, PieChart, Pie, ReferenceLine,
} from 'recharts';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { TVBacktestResult } from '../../../services/backtester/pine/PineBacktester';

interface Props {
  result: TVBacktestResult;
  symbol: string;
}

const fmt = (v: number, dec = 2) =>
  (v == null || isNaN(v)) ? 'N/A' : v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtInr = (v: number) => `₹${fmt(v)}`;
const sign = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-rose-400');

const GREEN = '#2dd4a7';
const RED = '#f6465d';
const BLUE = '#4a9eff';

const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
    <span className={`text-xl font-bold ${tone ?? 'text-slate-100'}`}>{value}</span>
    {sub && <span className={`text-[11px] font-semibold ${tone ?? 'text-slate-500'}`}>{sub}</span>}
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mt-8">
    <h3 className="text-sm font-bold text-slate-200 mb-4">{title}</h3>
    {children}
  </div>
);

const tooltipStyle = {
  contentStyle: { backgroundColor: '#0b1220', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 },
  itemStyle: { color: '#e2e8f0' },
  labelStyle: { color: '#94a3b8' },
};

export const TVStrategyTester: React.FC<Props> = ({ result, symbol }) => {
  const { metrics: m, equityCurve, trades, buyHoldCurve } = result;

  // Cumulative P&L + per-trade run-up / drawdown bars
  const perfData = useMemo(() => equityCurve.map((e, i) => ({
    i,
    pnl: e.equity - m.initialCapital,
    bar: e.tradePnL,
    bh: buyHoldCurve.length ? (buyHoldCurve[Math.min(i, buyHoldCurve.length - 1)] / 100) * m.initialCapital : 0,
  })), [equityCurve, m.initialCapital, buyHoldCurve]);

  // Returns distribution histogram
  const distData = useMemo(() => {
    if (!trades.length) return [];
    const pnls = trades.map((t) => t.pnl);
    const min = Math.min(...pnls), max = Math.max(...pnls);
    const buckets = 12;
    const size = (max - min) / buckets || 1;
    const arr = Array.from({ length: buckets }, (_, i) => ({
      label: fmt(min + (i + 0.5) * size, 0),
      count: 0,
      mid: min + (i + 0.5) * size,
    }));
    for (const pnl of pnls) {
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor((pnl - min) / size)));
      arr[idx].count++;
    }
    return arr;
  }, [trades]);

  // Trades distribution donut
  const donutData = useMemo(() => [
    { name: 'Winners', value: m.winningTrades, color: GREEN },
    { name: 'Losers', value: m.losingTrades, color: RED },
  ], [m]);

  // Equity run-ups & drawdowns alternating
  const runDrawData = useMemo(() => equityCurve.slice(1).map((e, i) => ({
    i,
    runup: e.runup,
    drawdown: -e.drawdown,
  })), [equityCurve]);

  const profitStructure = useMemo(() => [
    { name: 'Gross Profit', value: m.grossProfit, color: GREEN },
    { name: 'Gross Loss', value: -m.grossLoss, color: RED },
    { name: 'Commission', value: -(trades.length * 40), color: '#f59e0b' },
    { name: 'Net Profit', value: m.netPnL, color: BLUE },
  ], [m, trades]);

  return (
    <div className="bg-[#0b1220] rounded-2xl border border-slate-800 p-6 text-slate-200">
      {/* ─── KEY STATS ─── */}
      <h2 className="text-sm font-bold text-slate-300 mb-5">Key stats — {symbol}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pb-6 border-b border-slate-800">
        <Stat
          label="Total P&L"
          value={fmtInr(m.netPnL)}
          sub={`${m.roc >= 0 ? '+' : ''}${fmt(m.roc)}%`}
          tone={sign(m.netPnL)}
        />
        <Stat label="Max drawdown" value={fmtInr(m.maxDrawdown)} sub={`${fmt(m.maxDrawdownPct)}%`} tone="text-rose-400" />
        <Stat label="Profitable trades" value={`${fmt(m.winRate, 2)}%`} sub={`${m.winningTrades}/${m.totalTrades}`} />
        <Stat label="Profit factor" value={fmt(m.profitFactor)} tone={m.profitFactor >= 1.5 ? 'text-emerald-400' : 'text-slate-100'} />
      </div>

      {/* ─── PERFORMANCE ─── */}
      <Section title="Performance — Cumulative P&L, run-ups & drawdowns">
        <div className="h-[320px]">
          <SafeChartContainer height="100%" minHeight={280}>
            <ComposedChart data={perfData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="i" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={60}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => fmtInr(Number(v))} />
              <ReferenceLine y={0} stroke="#334155" />
              <Bar dataKey="bar" name="Trade P&L">
                {perfData.map((d, i) => <Cell key={i} fill={d.bar >= 0 ? GREEN : RED} fillOpacity={0.55} />)}
              </Bar>
              <Line type="monotone" dataKey="pnl" name="Cumulative P&L" stroke={GREEN} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="bh" name="Buy & hold" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </SafeChartContainer>
        </div>
      </Section>

      {/* ─── RETURN DETAILS ─── */}
      <Section title="Return details">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <Stat label="Open P&L" value={fmtInr(m.openPnL)} />
              <Stat label="Expected payoff" value={fmtInr(m.expectancy)} tone={sign(m.expectancy)} />
              <Stat label="Strategy outperformance" value={`${fmt(m.roc - m.buyHoldReturnPct)}%`} tone={sign(m.roc - m.buyHoldReturnPct)} />
              <Stat label="Sharpe ratio" value={fmt(m.sharpe)} />
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2">Profit structure</h4>
            <div className="h-[200px]">
              <SafeChartContainer height="100%" minHeight={180}>
                <BarChart data={profitStructure} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={45} />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => fmtInr(Number(v))} />
                  <ReferenceLine y={0} stroke="#334155" />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                    {profitStructure.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </SafeChartContainer>
            </div>
          </div>
        </div>
      </Section>

      {/* ─── TRADES ANALYSIS ─── */}
      <Section title="Trades analysis">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
          <Stat label="Average P&L" value={fmtInr(m.avgPnL)} sub={`${fmt((m.avgPnL / m.initialCapital) * 100, 2)}%`} tone={sign(m.avgPnL)} />
          <Stat label="Average bars in trades" value={fmt(m.avgBarsInTrades, 0)} />
          <Stat label="Largest profit" value={fmtInr(m.largestWin)} tone="text-emerald-400" />
          <Stat label="Largest loss" value={fmtInr(m.largestLoss)} tone="text-rose-400" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2">Returns distribution</h4>
            <div className="h-[220px]">
              <SafeChartContainer height="100%" minHeight={180}>
                <BarChart data={distData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 8 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {distData.map((d, i) => <Cell key={i} fill={d.mid >= 0 ? GREEN : RED} fillOpacity={0.7} />)}
                  </Bar>
                </BarChart>
              </SafeChartContainer>
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2">Trades distribution</h4>
            <div className="h-[220px] flex items-center">
              <div className="w-[60%] h-full">
                <SafeChartContainer height="100%" minHeight={180}>
                  <PieChart>
                    <Pie data={donutData} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip {...tooltipStyle} />
                  </PieChart>
                </SafeChartContainer>
              </div>
              <div className="flex flex-col gap-3 text-xs">
                <div className="text-slate-300"><span className="text-lg font-bold">{m.totalTrades}</span><br />Total trades</div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: GREEN }} /> Winners — {m.winningTrades} ({fmt(m.winRate, 1)}%)</div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: RED }} /> Losers — {m.losingTrades} ({fmt(100 - m.winRate, 1)}%)</div>
                <div className="text-slate-400">Long {m.longTrades} · Short {m.shortTrades}</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ─── EQUITY RUN-UPS & DRAWDOWNS ─── */}
      <Section title="Equity run-ups and drawdowns">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-4">
          <Stat label="Avg run-up duration" value={`${fmt(m.avgRunUpDuration, 0)} trades`} />
          <Stat label="Avg drawdown duration" value={`${fmt(m.avgDrawdownDuration, 0)} trades`} />
          <Stat label="Max drawdown % of capital" value={`${fmt(m.maxDrawdownPct)}%`} tone="text-rose-400" />
          <Stat label="Max run-up" value={fmtInr(m.maxRunUp)} tone="text-emerald-400" />
        </div>
        <div className="h-[200px]">
          <SafeChartContainer height="100%" minHeight={180}>
            <BarChart data={runDrawData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} stackOffset="sign">
              <XAxis dataKey="i" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={45} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => fmtInr(Math.abs(Number(v)))} />
              <ReferenceLine y={0} stroke="#334155" />
              <Bar dataKey="runup" fill={GREEN} fillOpacity={0.6} />
              <Bar dataKey="drawdown" fill={RED} fillOpacity={0.6} />
            </BarChart>
          </SafeChartContainer>
        </div>
      </Section>

      {/* ─── CAPITAL EFFICIENCY ─── */}
      <Section title="Capital efficiency">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="CAGR" value={`${fmt(m.cagr)}%`} tone={sign(m.cagr)} />
          <Stat label="Account size required" value={fmtInr(m.accountSizeRequired)} />
          <Stat label="Return on initial capital" value={`${fmt(m.roc)}%`} tone={sign(m.roc)} />
          <Stat label="Final capital" value={fmtInr(m.finalCapital)} />
        </div>
        <div className="h-[140px] mt-4">
          <SafeChartContainer height="100%" minHeight={120}>
            <AreaChart data={equityCurve} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BLUE} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="index" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={45} domain={['dataMin', 'dataMax']} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => fmtInr(Number(v))} />
              <Area type="monotone" dataKey="equity" stroke={BLUE} strokeWidth={2} fill="url(#eqFill)" />
            </AreaChart>
          </SafeChartContainer>
        </div>
      </Section>
    </div>
  );
};

export default TVStrategyTester;
