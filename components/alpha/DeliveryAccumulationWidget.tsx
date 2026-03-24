import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Search,
  Activity,
  RefreshCw,
  AlertCircle,
  Database,
  Play,
  Square,
  BarChart3,
  Flame,
  Zap,
  Globe
} from 'lucide-react';
import { pnseaService, DeliveryRadarItem, ScanProgress } from '../../services/PnseaService';
import { InstitutionalRadarWidget } from './InstitutionalRadarWidget';
import { openTradingView } from '../../utils/navigation';
import { formatNumberIndian } from '../../utils/helpers';
import { Tabs } from '../ui/AnimatedTabs';
import { ActionButton } from '../ui/ActionButton';

export const DeliveryAccumulationWidget: React.FC = () => {
  // Tabs: 'radar' for compiled F&O list, 'single' for the single stock historical log
  const [activeTab, setActiveTab] = useState<'radar' | 'single'>('radar');
  const [selectedSingleSymbol, setSelectedSingleSymbol] = useState('SBIN');

  const [radarData, setRadarData] = useState<DeliveryRadarItem[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<keyof DeliveryRadarItem>('deviation');
  const [sortAsc, setSortAsc] = useState(false);

  // Poll intervals
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchRadarData = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await pnseaService.fetchDeliveryRadar(force);
      setRadarData(data || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const checkScanProgress = useCallback(async () => {
    try {
      const progress = await pnseaService.fetchScanProgress();
      setScanProgress(progress);

      if (progress.is_scanning) {
        // If scanning is active, poll every 2.5 seconds
        if (!pollTimerRef.current) {
          pollTimerRef.current = setInterval(checkScanProgress, 2500);
        }
      } else {
        // If scanning completed or wasn't running, clear interval
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          // Refresh list since scan finished
          fetchRadarData(true);
        }
      }
    } catch (err) {
      console.error('Failed to fetch scan progress', err);
    }
  }, []);

  useEffect(() => {
    fetchRadarData();
    checkScanProgress();

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [checkScanProgress]);

  const handleStartScan = async () => {
    try {
      setError(null);
      await pnseaService.triggerRadarScan();
      // Immediately check progress
      checkScanProgress();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const handleCancelScan = async () => {
    try {
      setError(null);
      await pnseaService.cancelRadarScan();
      // Immediately check progress
      checkScanProgress();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const handleRowClick = (symbol: string) => {
    setSelectedSingleSymbol(symbol);
    // Wait, the single-stock lookup in InstitutionalRadarWidget uses internal state. 
    // We can mount InstitutionalRadarWidget and pass a default initial symbol or override it.
    setActiveTab('single');
  };

  // Sort and filter helper
  const processedRadarData = useMemo(() => {
    let result = [...radarData];

    // Filter by search symbol
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toUpperCase();
      result = result.filter(item => item.symbol.includes(term));
    }

    // Sort
    result.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (typeof aVal === 'string') {
        aVal = (aVal as string).toUpperCase();
        bVal = (bVal as string).toUpperCase();
      }

      if (aVal === bVal) return 0;

      const comparison = aVal > bVal ? 1 : -1;
      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [radarData, searchTerm, sortField, sortAsc]);

  // Infinite scroll/chunking for table performance
  const [visibleCount, setVisibleCount] = useState(30);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Reset visible count whenever search or sort changes
  useEffect(() => {
    setVisibleCount(30);
  }, [searchTerm, sortField, sortAsc]);

  useEffect(() => {
    if (!loadMoreRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount(prev => Math.min(prev + 30, processedRadarData.length));
      }
    }, { threshold: 0.1 });

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [processedRadarData.length, visibleCount]);

  const handleSort = (field: keyof DeliveryRadarItem) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Toggle Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/30 p-4 rounded-3xl border border-slate-800/40">
        <Tabs.Root
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as any)}
          layoutId="delivery-accumulation-tabs"
          variant="solid-indigo"
          motionPreset="spring"
        >
          <Tabs.List className="min-h-[38px] p-1 bg-slate-950 border border-slate-800/50">
            <Tabs.Trigger
              value="radar"
              className="px-5 min-h-[30px] text-xs font-black tracking-wider uppercase"
            >
              F&O Accumulation Radar
            </Tabs.Trigger>
            <Tabs.Trigger
              value="single"
              className="px-5 min-h-[30px] text-xs font-black tracking-wider uppercase"
            >
              Single-Stock History Log
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>

        {/* Scan Status / Controls Panel */}
        {activeTab === 'radar' && (
          <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-950/40 px-5 py-3 rounded-2xl border border-slate-850/60 max-w-full overflow-hidden">
            {scanProgress?.is_scanning ? (
              <div className="flex flex-col sm:flex-row items-center gap-4 w-full">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-ping" />
                  <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest animate-pulse">
                    Scanning {scanProgress.current_symbol || 'F&O'} ({scanProgress.current}/{scanProgress.total})
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-40 sm:w-48 bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800/80 shrink-0">
                  <div
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${(scanProgress.current / (scanProgress.total || 1)) * 100}%` }}
                  />
                </div>

                <button
                  onClick={handleCancelScan}
                  className="px-3 py-1.5 bg-rose-950/30 hover:bg-rose-950/60 border border-rose-900/40 hover:border-rose-800 text-rose-400 hover:text-rose-200 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5"
                >
                  <Square size={10} /> Cancel Scan
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-4 justify-between w-full">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Database size={12} className="text-slate-600" />
                  <span>
                    Last Compiled:{' '}
                    {scanProgress?.last_completed
                      ? new Date(scanProgress.last_completed).toLocaleString()
                      : 'Never'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <ActionButton
                    size="sm"
                    icon={<RefreshCw size={12} />}
                    onClick={() => fetchRadarData(true)}
                    title="Force refresh cached radar summary"
                  />
                  <button
                    onClick={handleStartScan}
                    className="px-4 py-2 bg-indigo-900/30 hover:bg-indigo-900/60 border border-indigo-800/40 hover:border-indigo-700 text-indigo-400 hover:text-indigo-200 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5"
                  >
                    <Play size={10} className="fill-indigo-400" /> Launch Daily Radar Scan
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {activeTab === 'single' ? (
        // Single Stock Tab: Mounts the InstitutionalRadarWidget inline
        // In the interest of premium UX, we will allow selectedSingleSymbol to be parsed, but InstitutionalRadarWidget handles search itself.
        // We'll output a banner or info block if a symbol was pre-selected, letting the user know they can search it.
        <div className="bg-slate-950/10 border border-slate-900 p-6 rounded-3xl relative">
          {selectedSingleSymbol && (
            <div className="mb-4 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-indigo-300 font-bold uppercase">
                👉 Selected stock from radar: <span className="text-white font-black">{selectedSingleSymbol}</span>. Search for this symbol below.
              </span>
              <button
                onClick={() => setSelectedSingleSymbol('')}
                className="text-[10px] text-slate-500 hover:text-slate-300 font-black uppercase"
              >
                Dismiss
              </button>
            </div>
          )}
          <InstitutionalRadarWidget />
        </div>
      ) : (
        // Compiled F&O Accumulation Radar Tab
        <div className="space-y-6">
          {/* Filters & Information Banner */}
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between bg-slate-900/30 p-6 rounded-3xl border border-slate-800/40">
            <div className="relative w-full lg:w-96 group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                <Search size={16} />
              </div>
              <input
                type="text"
                placeholder="Filter radar by symbol (e.g. SBIN)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800/80 rounded-2xl py-2.5 pl-12 pr-6 text-sm text-slate-200 placeholder:text-slate-650 outline-none focus:border-indigo-500/50 transition-all font-bold"
              />
            </div>

            <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-2xl px-4 py-3 flex items-center gap-3 max-w-xl text-left">
              <Flame size={16} className="text-indigo-400 shrink-0 animate-pulse" />
              <p className="text-[11px] text-indigo-300 leading-relaxed font-bold uppercase">
                🚀 <span className="text-white">Confluence setup</span>: High delivery volume indicates promoter or institutional buying. Watch for deviation &gt; 5% and rising trend indicators.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-3 p-4 bg-rose-500/5 border border-rose-500/10 rounded-2xl text-rose-300 text-xs font-bold">
              <AlertCircle size={16} className="text-rose-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="min-h-[350px] flex flex-col items-center justify-center space-y-6 bg-slate-900/10 border border-slate-800/30 rounded-3xl">
              <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin shadow-[0_0_40px_rgba(99,102,241,0.15)]"></div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest animate-pulse">Compiling F&O Accumulation Radar...</h3>
            </div>
          ) : processedRadarData.length === 0 ? (
            <div className="min-h-[300px] flex flex-col items-center justify-center bg-slate-900/10 border border-slate-800/40 rounded-3xl p-12 text-center">
              <Database className="w-12 h-12 text-slate-700 mb-6 animate-pulse" />
              <h3 className="text-xl font-bold text-slate-400 mb-2 uppercase tracking-widest">No Compiled Data</h3>
              <p className="text-slate-650 text-sm max-w-sm mb-6">F&O delivery accumulation database is currently empty. Run a background scan to compile NSE daily delivery analytics.</p>
              <button
                onClick={handleStartScan}
                className="px-6 py-3 bg-indigo-650 hover:bg-indigo-600 text-white text-xs font-black uppercase tracking-wider rounded-2xl shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2"
              >
                <Play size={12} className="fill-white" /> Trigger Scanner Launch
              </button>
            </div>
          ) : (
            <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl overflow-hidden flex flex-col">
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead>
                    <tr className="bg-slate-950/40 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/40 select-none sticky top-0 z-10">
                      <th className="py-4 pl-6 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('symbol')}>
                        Symbol {sortField === 'symbol' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="py-4 text-right cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('close')}>
                        Close Price {sortField === 'close' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="py-4 text-right cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('delivery_pct')}>
                        Delivery % {sortField === 'delivery_pct' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="py-4 text-right cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('avg_delivery_pct')}>
                        30D Avg Del % {sortField === 'avg_delivery_pct' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="py-4 text-right cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('deviation')}>
                        Deviation {sortField === 'deviation' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="py-4 text-right cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('volume')}>
                        Daily Vol {sortField === 'volume' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="py-4 text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('is_rising')}>
                        Trend {sortField === 'is_rising' && (sortAsc ? '▲' : '▼')}
                      </th>
                      <th className="py-4 text-center pr-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/30">
                    {processedRadarData.slice(0, visibleCount).map((item: DeliveryRadarItem, index: number) => {
                      const isHighDev = item.deviation >= 5 && item.delivery_pct >= 40;
                      const isWeak = item.deviation <= -5 || item.delivery_pct < 25;

                      return (
                        <tr
                          key={item.symbol + index}
                          className={`hover:bg-slate-800/20 transition-all cursor-pointer ${isHighDev
                              ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                              : isWeak
                                ? 'bg-rose-500/2 hover:bg-rose-500/5'
                                : ''
                            }`}
                          onClick={() => handleRowClick(item.symbol)}
                        >
                          <td className="py-3.5 pl-6 font-black text-indigo-400 text-xs">
                            {item.symbol}
                          </td>
                          <td className="py-3.5 text-right font-bold text-slate-200 font-mono text-xs">
                            ₹{item.close?.toFixed(2) || 'N/A'}
                          </td>
                          <td className="py-3.5 text-right">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-black font-mono border ${item.delivery_pct >= 45
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                : item.delivery_pct >= 30
                                  ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                                  : 'bg-slate-850 text-slate-400 border-slate-800'
                              }`}>
                              {item.delivery_pct?.toFixed(2)}%
                            </span>
                          </td>
                          <td className="py-3.5 text-right font-bold text-slate-400 font-mono text-xs">
                            {item.avg_delivery_pct?.toFixed(2)}%
                          </td>
                          <td className={`py-3.5 text-right font-black font-mono text-xs ${item.deviation >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                            {item.deviation >= 0 ? '+' : ''}{item.deviation?.toFixed(2)}%
                          </td>
                          <td className="py-3.5 text-right text-xs font-mono font-bold text-slate-400">
                            {item.volume >= 1000000
                              ? `${(item.volume / 1000000).toFixed(2)}M`
                              : formatNumberIndian(item.volume) || 'N/A'}
                          </td>
                          <td className="py-3.5 text-center">
                            {item.is_rising ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-400 uppercase bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                                <TrendingUp size={10} /> RISING
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black text-slate-500 uppercase bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-800">
                                <TrendingDown size={10} /> FLAT/FALL
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 text-center pr-6" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => openTradingView(item.symbol)}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700/50 transition-all"
                                title="Open TradingView Chart"
                              >
                                <Activity size={12} />
                              </button>
                              <button
                                onClick={() => handleRowClick(item.symbol)}
                                className="px-2.5 py-1.5 bg-indigo-950/40 hover:bg-indigo-950/80 text-indigo-400 hover:text-indigo-200 text-[9px] font-black uppercase tracking-wider rounded-lg border border-indigo-900/30 transition-all"
                              >
                                View Log
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {visibleCount < processedRadarData.length && (
                <div ref={loadMoreRef} className="py-4 flex items-center justify-center text-[10px] font-black text-slate-500 uppercase tracking-widest bg-slate-950/40 border-t border-slate-800/30">
                  <div className="w-3.5 h-3.5 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mr-2" />
                  Loading more assets...
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
