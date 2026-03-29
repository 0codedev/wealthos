import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { RefreshCw, TrendingUp, TrendingDown, Info, ShieldAlert } from 'lucide-react';
import { neuralOrderFlowService, OrderFlowReport } from '../../services/NeuralOrderFlowService';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { formatCurrency } from '../../utils/helpers';

export const OrderFlowPanel: React.FC = () => {
  const [symbol, setSymbol] = useState<string>('NIFTY');
  const [report, setReport] = useState<OrderFlowReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);

  const loadData = async (sym: string) => {
    setLoading(true);
    const rep = await neuralOrderFlowService.analyzeOrderFlow(sym);
    if (rep) {
      setReport(rep);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadData(symbol);
  }, [symbol]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void loadData(symbol);
    }, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, symbol]);

  const getDirectionColor = (dir: string) => {
    if (dir === 'BULLISH') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 shadow-emerald-500/10';
    if (dir === 'BEARISH') return 'text-rose-400 bg-rose-500/10 border-rose-500/30 shadow-rose-500/10';
    return 'text-amber-400 bg-amber-500/10 border-amber-500/30 shadow-amber-500/10';
  };

  return (
    <div className="bg-slate-900 rounded-2xl border border-indigo-500/20 p-6 text-white shadow-xl">
      <div className="flex flex-wrap items-center justify-between mb-6 border-b border-slate-800 pb-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
            <TrendingUp size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Neural Order Flow Analyzer</h2>
            <p className="text-xs text-slate-400">Track smart money flows through Put-Call Ratio, Max Pain deviations, and IV Skews.</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            disabled={loading}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="NIFTY">NIFTY 50</option>
            <option value="BANKNIFTY">BANK NIFTY</option>
            <option value="FINNIFTY">FIN NIFTY</option>
          </select>
          
          <div className="flex items-center gap-1.5 text-xs text-slate-400 border border-slate-800 rounded-lg px-2.5 py-1.5 bg-slate-950">
            <input
              type="checkbox"
              id="autorefresh"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-800 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
            />
            <label htmlFor="autorefresh" className="cursor-pointer font-medium select-none">Auto-refresh (1m)</label>
          </div>

          <button
            onClick={() => void loadData(symbol)}
            disabled={loading}
            className="p-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-400 hover:text-white transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !report ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
          <RefreshCw className="animate-spin text-indigo-500" size={32} />
          <p className="text-sm font-mono">Loading option contracts and greeks matrix...</p>
        </div>
      ) : report ? (
        <div className="space-y-6">
          {/* Top Row: Directional Badge & Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className={`border rounded-2xl p-5 flex flex-col items-center justify-center text-center shadow-lg transition-all duration-300 ${getDirectionColor(report.direction)}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1">Signal Verdict</span>
              <span className="text-3xl font-black tracking-widest">{report.direction}</span>
              <span className="text-xs font-mono font-bold mt-2">Confidence: {report.confidence}%</span>
            </div>
            
            <div className="bg-slate-950 border border-slate-850 p-5 rounded-2xl md:col-span-2 grid grid-cols-2 gap-4">
              <div>
                <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                  Put-Call Ratio (PCR)
                  <Info size={10} className="text-slate-600" />
                </span>
                <span className="text-2xl font-black font-mono">{report.pcr.toFixed(2)}</span>
                <p className="text-[10px] text-slate-400 mt-1">
                  {report.pcr < 0.7 ? 'Oversold / Bearish signal' : report.pcr > 1.3 ? 'Overbought / Bullish signal' : 'Neutral market balance'}
                </p>
              </div>
              
              <div>
                <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                  Max Pain Level
                  <Info size={10} className="text-slate-600" />
                </span>
                <span className="text-2xl font-black font-mono">{report.maxPain}</span>
                <p className="text-[10px] text-slate-400 mt-1">
                  Spot price is {report.underlyingValue > report.maxPain ? 'above' : 'below'} pain by {Math.abs(report.underlyingValue - report.maxPain).toFixed(0)} pts.
                </p>
              </div>
            </div>
          </div>

          {/* Indicators Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950 border border-slate-850 p-4 rounded-xl text-xs">
            <div className="flex items-center gap-2 border-r border-slate-800 pr-4">
              <ShieldAlert size={16} className="text-indigo-400 shrink-0" />
              <div>
                <span className="text-slate-500 block">OI Accumulation</span>
                <span className="font-semibold text-slate-200">{report.oiSignal}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-4">
              <ShieldAlert size={16} className="text-indigo-400 shrink-0" />
              <div>
                <span className="text-slate-500 block">IV Skew Bias</span>
                <span className="font-semibold text-slate-200">{report.ivSkew}</span>
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">OI Distribution by Strike</h3>
              <div className="h-64">
                <SafeChartContainer>
                  <BarChart data={report.oiDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="strike" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b' }} />
                    <Legend />
                    <Bar dataKey="callsOI" name="Call OI" fill="#f43f5e" />
                    <Bar dataKey="putsOI" name="Put OI" fill="#10b981" />
                  </BarChart>
                </SafeChartContainer>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">IV Skew Curve</h3>
              <div className="h-64">
                <SafeChartContainer>
                  <LineChart data={report.ivSkewData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="strike" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b' }} />
                    <Legend />
                    <Line type="monotone" dataKey="callsIV" name="Call IV" stroke="#f43f5e" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="putsIV" name="Put IV" stroke="#10b981" dot={false} strokeWidth={2} />
                  </LineChart>
                </SafeChartContainer>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500">
          <p>Unable to load Order Flow analysis. Check Option Chain proxy or settings.</p>
        </div>
      )}
    </div>
  );
};

export default OrderFlowPanel;
