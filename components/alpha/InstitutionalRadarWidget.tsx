import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Search, 
  Activity, 
  BarChart3, 
  Calendar, 
  Database,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { pnseaService, DeliveryData } from '../../services/PnseaService';
import { openTradingView } from '../../utils/navigation';
import { formatINR, formatPercentage, formatQuantity } from '../../utils/indianFormatter';
import { ActionButton } from '../ui/ActionButton';

export const InstitutionalRadarWidget: React.FC = () => {
  const [symbol, setSymbol] = useState('SBIN');
  const [searchInput, setSearchInput] = useState('SBIN');
  const [deliveryData, setDeliveryData] = useState<DeliveryData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Quick pick symbols
  const quickSymbols = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'ITC', 'LT', 'BHARTIARTL', 'AXISBANK'];

  const fetchDelivery = async (targetSymbol: string) => {
    setLoading(true);
    setError(null);
    try {
      // Fetch last 45 days to ensure we have at least 30 trading days
      const toDate = new Date().toISOString().split('T')[0];
      const fromDateObj = new Date();
      fromDateObj.setDate(fromDateObj.getDate() - 45);
      const fromDate = fromDateObj.toISOString().split('T')[0];

      const data = await pnseaService.fetchDeliveryHistory(targetSymbol, fromDate, toDate);
      if (data && data.length > 0) {
        // Sort descending by date (most recent first)
        const sorted = [...data].sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime());
        setDeliveryData(sorted);
      } else {
        setDeliveryData([]);
        setError(`No delivery data returned for ${targetSymbol}. Make sure the Python Bridge server is running.`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDelivery(symbol);
  }, [symbol]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setSymbol(searchInput.trim().toUpperCase());
    }
  };

  // Metrics calculations
  const stats = useMemo(() => {
    if (deliveryData.length === 0) return null;
    
    // Use last 30 trading days
    const sliced = deliveryData.slice(0, 30);
    const latest = sliced[0];
    
    const avgDeliveryPct = sliced.reduce((acc, curr) => acc + (curr.Delivery_Pct || 0), 0) / sliced.length;
    const avgVolume = sliced.reduce((acc, curr) => acc + (curr.Volume || 0), 0) / sliced.length;
    const avgDeliveryQty = sliced.reduce((acc, curr) => acc + (curr.Deliverable_Qty || 0), 0) / sliced.length;
    
    // Accumulation signal (Latest delivery % vs 30-day average)
    const deviation = latest.Delivery_Pct - avgDeliveryPct;
    let signalStrength: 'HIGH' | 'NEUTRAL' | 'WEAK' = 'NEUTRAL';
    if (deviation > 5 && latest.Delivery_Pct > 45) {
      signalStrength = 'HIGH';
    } else if (deviation < -5 || latest.Delivery_Pct < 25) {
      signalStrength = 'WEAK';
    }

    // Number of high delivery accumulation days (>40% delivery & above average)
    const accumulationDaysCount = sliced.filter(d => d.Delivery_Pct > 40 && d.Delivery_Pct > avgDeliveryPct).length;

    return {
      latest,
      avgDeliveryPct,
      avgVolume,
      avgDeliveryQty,
      deviation,
      signalStrength,
      accumulationDaysCount,
      sampleSize: sliced.length
    };
  }, [deliveryData]);

  return (
    <div className="space-y-6">
      {/* Search and Quick Picks */}
      <div className="flex flex-col lg:flex-row gap-4 items-center justify-between bg-slate-900/30 p-6 rounded-3xl border border-slate-800/40">
        <form onSubmit={handleSearchSubmit} className="relative w-full lg:w-96 group">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors">
            <Search size={16} />
          </div>
          <input 
            type="text"
            placeholder="Search NSE Equity (e.g. SBIN, TCS)..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800/80 rounded-2xl py-2.5 pl-12 pr-24 text-sm text-slate-200 placeholder:text-slate-650 outline-none focus:border-indigo-500/50 transition-all font-bold"
          />
          <button 
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-black uppercase tracking-wider rounded-xl border border-slate-700/50 transition-all"
          >
            Fetch Live
          </button>
        </form>

        <div className="flex flex-wrap gap-2 justify-center lg:justify-end">
          {quickSymbols.map(sym => (
            <button
              key={sym}
              onClick={() => {
                setSymbol(sym);
                setSearchInput(sym);
              }}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black tracking-wider transition-all border ${symbol === sym 
                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20' 
                : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-750'}`}
            >
              {sym}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="min-h-[350px] flex flex-col items-center justify-center space-y-6 bg-slate-900/10 border border-slate-800/30 rounded-3xl">
          <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin shadow-[0_0_40px_rgba(99,102,241,0.15)]"></div>
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest animate-pulse">Consulting SQLite & PNSEA Bridge...</h3>
        </div>
      ) : error ? (
        <div className="min-h-[250px] flex flex-col items-center justify-center p-8 bg-rose-500/5 border border-rose-500/10 rounded-3xl text-center">
          <AlertCircle className="w-12 h-12 text-rose-500/80 mb-4 animate-bounce" />
          <h4 className="text-base font-black text-slate-200 uppercase tracking-tight">Stealth Bridge Connection Error</h4>
          <p className="text-xs text-rose-300 max-w-md mt-2 leading-relaxed">
            {error}
          </p>
          <div className="mt-6 flex gap-4">
            <ActionButton 
              size="md"
              icon={<RefreshCw size={12} />}
              label="Retry Fetch"
              onClick={() => fetchDelivery(symbol)}
            />
            <div className="text-[10px] text-slate-500 border border-slate-800 rounded-xl px-4 py-2 bg-slate-950/20 flex items-center justify-center">
              💡 Ensure `python-bridge/start.bat` is running in background.
            </div>
          </div>
        </div>
      ) : deliveryData.length === 0 ? (
        <div className="min-h-[300px] flex flex-col items-center justify-center bg-slate-900/10 border border-slate-800/40 rounded-3xl p-12 text-center">
          <Database className="w-12 h-12 text-slate-700 mb-6 animate-pulse" />
          <h3 className="text-xl font-bold text-slate-400 mb-2 uppercase tracking-widest">No Database Records</h3>
          <p className="text-slate-650 text-sm max-w-sm">No delivery records found for `{symbol}`. Run the script and check network logs.</p>
        </div>
      ) : stats ? (
        <div className="space-y-6">
          {/* STATS TILES */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* TILE 1: ACCUMULATION SIGNAL */}
            <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6 relative overflow-hidden">
              <div className={`absolute top-0 right-0 w-20 h-20 blur-3xl rounded-full ${
                stats.signalStrength === 'HIGH' ? 'bg-emerald-500/10' : stats.signalStrength === 'WEAK' ? 'bg-rose-500/10' : 'bg-slate-500/5'
              }`} />
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Accumulation Radar</span>
              <div className="flex items-baseline gap-2 mt-4">
                <span className={`text-2xl font-black ${
                  stats.signalStrength === 'HIGH' ? 'text-emerald-400' : stats.signalStrength === 'WEAK' ? 'text-rose-400' : 'text-slate-200'
                }`}>
                  {stats.signalStrength === 'HIGH' ? 'BULL ACCUMULATION' : stats.signalStrength === 'WEAK' ? 'INSTITUTIONAL EXIT' : 'NEUTRAL RADAR'}
                </span>
              </div>
              <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
                {formatPercentage(stats.latest.Delivery_Pct, { showSign: false })} Delivery vs {formatPercentage(stats.avgDeliveryPct, { showSign: false })} Avg (30D)
              </p>
            </div>

            {/* TILE 2: ACCUMULATION DAYS */}
            <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Accumulation Density</span>
              <div className="flex items-baseline gap-2 mt-4">
                <span className="text-3xl font-black text-white">{stats.accumulationDaysCount} / {stats.sampleSize}</span>
                <span className="text-xs font-bold text-slate-500 uppercase">Trading Days</span>
              </div>
              <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
                Days with &gt;40% and above average delivery
              </p>
            </div>

            {/* TILE 3: AVERAGE DELIVERY QUANTITY */}
            <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">30-Day Avg Delivery Qty</span>
              <div className="flex items-baseline gap-2 mt-4">
                <span className="text-2xl font-black text-white">
                  {formatINR(stats.avgDeliveryQty, { compact: true }).replace('₹', '')}
                </span>
                <span className="text-xs font-bold text-slate-500 uppercase">shares/day</span>
              </div>
              <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
                Average share delivery per session
              </p>
            </div>

            {/* TILE 4: LATEST DELIVERY METRICS */}
            <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Latest Delivery Session</span>
              <div className="flex items-baseline gap-2 mt-4">
                <span className="text-3xl font-black text-white">{formatPercentage(stats.latest.Delivery_Pct, { showSign: false })}</span>
                <span className={`text-xs font-bold ${stats.deviation >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatPercentage(stats.deviation)} vs avg
                </span>
              </div>
              <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider font-mono">
                {stats.latest.Date} // Price: {formatINR(stats.latest.Close)}
              </p>
            </div>
          </div>

          {/* MAIN LIST & ANALYSIS GRID */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* STOCKS STATS DETAIL AND TRADINGVIEW ACTION */}
            <div className="lg:col-span-1 bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6 space-y-6">
              <h3 className="text-sm font-bold text-white tracking-tight uppercase">Radar Snapshot</h3>
              
              <div className="space-y-4">
                <div className="flex justify-between items-center py-2.5 border-b border-slate-800/50">
                  <span className="text-xs font-bold text-slate-500 uppercase">Target Symbol</span>
                  <span className="text-sm font-black text-indigo-400">{symbol}</span>
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-slate-800/50">
                  <span className="text-xs font-bold text-slate-500 uppercase">Latest Close Price</span>
                  <span className="text-sm font-black text-white font-mono">{formatINR(stats.latest.Close)}</span>
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-slate-800/50">
                  <span className="text-xs font-bold text-slate-500 uppercase">30D Avg Delivery Ratio</span>
                  <span className="text-sm font-black text-white">{formatPercentage(stats.avgDeliveryPct, { showSign: false })}</span>
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-slate-800/50">
                  <span className="text-xs font-bold text-slate-500 uppercase">Latest Trade Volume</span>
                  <span className="text-sm font-black text-slate-300 font-mono">{formatQuantity(stats.latest.Volume)}</span>
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-slate-800/50">
                  <span className="text-xs font-bold text-slate-500 uppercase">Latest Delivery Vol</span>
                  <span className="text-sm font-black text-slate-300 font-mono">{formatQuantity(stats.latest.Deliverable_Qty)}</span>
                </div>
                <div className="flex justify-between items-center py-2.5">
                  <span className="text-xs font-bold text-slate-500 uppercase">Latest Trade Count</span>
                  <span className="text-sm font-black text-slate-300 font-mono">{stats.latest.Trades ? formatQuantity(stats.latest.Trades) : 'N/A'}</span>
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={() => openTradingView(symbol)}
                  className="w-full py-3 bg-slate-900 hover:bg-slate-850 border border-slate-850 rounded-2xl text-xs font-bold text-slate-300 hover:text-white uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                >
                  <Activity size={14} className="text-indigo-400" />
                  Launch TradingView Chart
                </button>
              </div>
            </div>

            {/* TABLE OF RAW 30-DAY HISTORICAL DATA */}
            <div className="lg:col-span-2 bg-slate-900/20 border border-slate-800/50 rounded-3xl overflow-hidden flex flex-col">
              <div className="p-6 border-b border-slate-800/50 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white tracking-tight uppercase">30-Day Delivery History Log</h3>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">SQLite Caching Active</span>
              </div>
              <div className="overflow-x-auto overflow-y-auto max-h-[380px] no-scrollbar">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead>
                    <tr className="bg-slate-950/40 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/40 select-none sticky top-0 z-10">
                      <th className="py-3.5 pl-6">Session Date</th>
                      <th className="py-3.5 text-right">Close Price</th>
                      <th className="py-3.5 text-right">Delivery %</th>
                      <th className="py-3.5 text-right">Delivery Quantity</th>
                      <th className="py-3.5 text-right pr-6">Total Volume</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/30">
                    {deliveryData.slice(0, 30).map((d, index) => {
                      const isHighAcc = d.Delivery_Pct >= 45;
                      const isAboveAvg = stats ? d.Delivery_Pct > stats.avgDeliveryPct : false;
                      
                      return (
                        <tr 
                          key={d.Date + index} 
                          className={`hover:bg-slate-800/20 transition-all ${
                            isHighAcc 
                              ? 'bg-emerald-500/5 hover:bg-emerald-500/10' 
                              : isAboveAvg 
                                ? 'bg-indigo-500/2 hover:bg-indigo-500/5' 
                                : ''
                          }`}
                        >
                          <td className="py-3.5 pl-6 font-bold text-slate-300 font-mono text-xs">{d.Date}</td>
                          <td className="py-3.5 text-right font-black text-slate-200 font-mono text-xs">
                            {formatINR(d.Close)}
                          </td>
                          <td className="py-3.5 text-right">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-black font-mono border ${
                              isHighAcc 
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.1)]' 
                                : isAboveAvg 
                                  ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' 
                                  : 'bg-slate-850 text-slate-400 border-slate-800'
                            }`}>
                              {formatPercentage(d.Delivery_Pct, { showSign: false })}
                            </span>
                          </td>
                          <td className="py-3.5 text-right text-xs font-mono font-bold text-slate-400">
                            {formatQuantity(d.Deliverable_Qty)}
                          </td>
                          <td className="py-3.5 text-right text-xs font-mono font-bold text-slate-400 pr-6">
                            {formatQuantity(d.Volume)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
