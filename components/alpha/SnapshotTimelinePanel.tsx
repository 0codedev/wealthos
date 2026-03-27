import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Trash2, Calendar, RefreshCw, Filter, TrendingUp, AlertTriangle, ChevronDown } from 'lucide-react';
import { snapshotService } from '../../services/SnapshotService';
import { SnapshotRecord, SnapshotEntry } from '../../database';
import { useToast } from '../shared/ToastProvider';

interface SnapshotTimelinePanelProps {
  onBack: () => void;
}

export const SnapshotTimelinePanel: React.FC<SnapshotTimelinePanelProps> = ({ onBack }) => {
  const { toast } = useToast();
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  
  // Filters & Search & Pagination
  const [minToDRvol, setMinToDRvol] = useState<number>(3);
  const [minGFactor, setMinGFactor] = useState<number>(5);
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Compare mode
  const [compareTargetId, setCompareTargetId] = useState<number | null>(null);
  const [isT1Open, setIsT1Open] = useState(false);
  const [isT2Open, setIsT2Open] = useState(false);

  // Statistics across all dates for backtesting
  const [allSnapshotsList, setAllSnapshotsList] = useState<SnapshotRecord[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  // Load available dates on mount
  useEffect(() => {
    loadDates();
    loadAllSnapshotsForStats();
  }, []);

  const loadDates = async () => {
    const dates = await snapshotService.getAllDates();
    setAvailableDates(dates);
    if (dates.length > 0 && !selectedDate) {
      setSelectedDate(dates[0]);
    }
  };

  const loadAllSnapshotsForStats = async () => {
    setStatsLoading(true);
    try {
      const dates = await snapshotService.getAllDates();
      const list: SnapshotRecord[] = [];
      for (const d of dates) {
        const snaps = await snapshotService.getSnapshotsForDate(d);
        list.push(...snaps);
      }
      setAllSnapshotsList(list);
    } catch (err) {
      console.error('Failed to load snapshots for stats:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleDeleteSnapshot = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this snapshot?')) return;
    await snapshotService.deleteSnapshot(id);
    toast.success('Snapshot deleted successfully.');
    
    // Reload snapshots
    const snaps = await snapshotService.getSnapshotsForDate(selectedDate);
    setSnapshots(snaps);
    
    if (selectedSnapshotId === id) {
      setSelectedSnapshotId(snaps.length > 0 ? snaps[0].id || null : null);
    }
    if (compareTargetId === id) {
      setCompareTargetId(null);
    }
    
    loadDates();
    loadAllSnapshotsForStats();
  };

  // Load snapshots for selected date
  useEffect(() => {
    if (!selectedDate) return;
    (async () => {
      const snaps = await snapshotService.getSnapshotsForDate(selectedDate);
      setSnapshots(snaps);
      
      // Auto-select the first snapshot (usually 9:25 AM auto_925)
      const autoOpenSnap = snaps.find(s => s.trigger === 'auto_925');
      if (autoOpenSnap && autoOpenSnap.id) {
        setSelectedSnapshotId(autoOpenSnap.id);
      } else if (snaps.length > 0 && snaps[0].id) {
        setSelectedSnapshotId(snaps[0].id);
      } else {
        setSelectedSnapshotId(null);
      }

      // Auto-select EOD snapshot as default compare target if available
      const eodSnap = snaps.find(s => s.trigger === 'eod');
      if (eodSnap && eodSnap.id) {
        setCompareTargetId(eodSnap.id);
      } else {
        setCompareTargetId(null);
      }
    })();
  }, [selectedDate]);

  const activeSnapshot = useMemo(() => {
    return snapshots.find(s => s.id === selectedSnapshotId) || null;
  }, [snapshots, selectedSnapshotId]);

  const compareSnapshot = useMemo(() => {
    return snapshots.find(s => s.id === compareTargetId) || null;
  }, [snapshots, compareTargetId]);

  const sectorsList = useMemo(() => {
    if (!activeSnapshot) return [];
    const sectors = new Set(activeSnapshot.stocks.map(s => s.sector));
    return Array.from(sectors).sort();
  }, [activeSnapshot]);

  // Compute outcomes and apply filters
  const processedStocks = useMemo(() => {
    if (!activeSnapshot) return [];

    return activeSnapshot.stocks
      .map(stock => {
        let outcomePct: number | null = null;
        let finalLtp: number | null = null;
        let t2Score: number | undefined = undefined;
        let t2Verdict: string | undefined = undefined;
        let t2IgsCheckCount: number | undefined = undefined;
        let t2IgsCheckTotal: number | undefined = undefined;

        if (compareSnapshot) {
          const matchingStock = compareSnapshot.stocks.find(s => s.symbol === stock.symbol);
          if (matchingStock) {
            finalLtp = matchingStock.ltp;
            outcomePct = stock.ltp > 0 ? ((matchingStock.ltp - stock.ltp) / stock.ltp) * 100 : 0;
            t2Score = matchingStock.score;
            t2Verdict = matchingStock.verdict;
            t2IgsCheckCount = matchingStock.igsCheckCount;
            t2IgsCheckTotal = matchingStock.igsCheckTotal;
          }
        }

        return {
          ...stock,
          outcomePct,
          finalLtp,
          t2Score,
          t2Verdict,
          t2IgsCheckCount,
          t2IgsCheckTotal
        };
      })
      .filter(stock => {
        // Sector Filter
        if (selectedSector !== 'ALL' && stock.sector !== selectedSector) return false;

        // ToD RVOL Filter (null checks are bypassed if min is 0)
        if (minToDRvol > 0) {
          if (stock.rvol_timeofday === null || stock.rvol_timeofday < minToDRvol) return false;
        }

        // G-Factor Filter
        if (stock.gFactor < minGFactor) return false;

        return true;
      })
      .sort((a, b) => (b.rvol_timeofday || 0) - (a.rvol_timeofday || 0));
  }, [activeSnapshot, compareSnapshot, selectedSector, minToDRvol, minGFactor]);

  // Filtered and Searched list for pagination
  const filteredAndSearchedStocks = useMemo(() => {
    return processedStocks.filter(stock => 
      stock.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [processedStocks, searchQuery]);

  const totalPages = Math.ceil(filteredAndSearchedStocks.length / 25);
  const paginatedStocks = useMemo(() => {
    const start = (currentPage - 1) * 25;
    return filteredAndSearchedStocks.slice(start, start + 25);
  }, [filteredAndSearchedStocks, currentPage]);

  // Backtesting Stats across ALL stored days
  const backtestStats = useMemo(() => {
    if (allSnapshotsList.length === 0) return null;

    // Group all snapshots by date
    const snapsByDate: Record<string, SnapshotRecord[]> = {};
    for (const snap of allSnapshotsList) {
      if (!snapsByDate[snap.date]) snapsByDate[snap.date] = [];
      snapsByDate[snap.date].push(snap);
    }

    let totalTrades = 0;
    let winCount = 0;
    let totalGain = 0;
    let totalLoss = 0;
    let positiveTradesCount = 0;
    let negativeTradesCount = 0;

    for (const [dateStr, snaps] of Object.entries(snapsByDate)) {
      // Find 9:25 AM (trigger 'auto_925') as T1 entry snapshot
      const entrySnap = snaps.find(s => s.trigger === 'auto_925');
      // Find EOD (trigger 'eod') as T2 exit snapshot
      const exitSnap = snaps.find(s => s.trigger === 'eod');

      if (!entrySnap || !exitSnap) continue;

      // Filter stocks at T1 that meet the criteria
      const matchingT1Stocks = entrySnap.stocks.filter(s => {
        if (selectedSector !== 'ALL' && s.sector !== selectedSector) return false;
        if (minToDRvol > 0 && (s.rvol_timeofday === null || s.rvol_timeofday < minToDRvol)) return false;
        if (s.gFactor < minGFactor) return false;
        return true;
      });

      for (const t1Stock of matchingT1Stocks) {
        const t2Stock = exitSnap.stocks.find(s => s.symbol === t1Stock.symbol);
        if (t2Stock && t1Stock.ltp > 0) {
          const outcome = ((t2Stock.ltp - t1Stock.ltp) / t1Stock.ltp) * 100;
          totalTrades++;
          if (outcome > 0) {
            winCount++;
            totalGain += outcome;
            positiveTradesCount++;
          } else if (outcome < 0) {
            totalLoss += outcome;
            negativeTradesCount++;
          }
        }
      }
    }

    const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
    const avgGain = positiveTradesCount > 0 ? totalGain / positiveTradesCount : 0;
    const avgLoss = negativeTradesCount > 0 ? totalLoss / negativeTradesCount : 0;

    return {
      totalTrades,
      winRate,
      avgGain,
      avgLoss
    };
  }, [allSnapshotsList, minToDRvol, minGFactor, selectedSector]);

  const handlePurge = async () => {
    if (!window.confirm('🚨 WARNING: This will permanently delete all morning snapshots from IndexedDB. This action cannot be undone. Proceed?')) {
      return;
    }
    await snapshotService.purgeAllSnapshots();
    setSnapshots([]);
    setSelectedDate('');
    setAvailableDates([]);
    setAllSnapshotsList([]);
    toast.success('All snapshot archives successfully deleted.');
  };

  const getTriggerLabel = (trigger: string) => {
    switch (trigger) {
      case 'auto_925': return '🌅 9:25 AM Open';
      case 'eod': return '🌆 3:15 PM EOD';
      case 'manual_refresh': return '🔄 Manual Refresh';
      default: return trigger;
    }
  };

  const formatTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return 'N/A';
    }
  };

  return (
    <div className="bg-[#0b1329] border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Back to Terminal"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-lg font-black text-sky-400 tracking-tight flex items-center gap-2">
              📸 Morning Snapshot Replay
            </h2>
            <p className="text-xs text-slate-400 font-bold">Backtest setups and verify dynamic volume indicators</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 self-end md:self-auto">
          <button
            onClick={loadDates}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-all"
            title="Sync Dates List"
          >
            <RefreshCw className="w-4.5 h-4.5" />
          </button>
          <button
            onClick={handlePurge}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-950/40 border border-rose-900 hover:bg-rose-900/60 text-rose-300 text-xs font-black transition-all"
            title="Delete all snapshots"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Archives
          </button>
        </div>
      </div>

      {/* Date & Trigger Selection bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900/40 p-4 border border-slate-800/80 rounded-2xl">
        {/* Date Selector */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Calendar className="w-3 h-3 text-slate-500" /> Select Date
          </span>
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-sky-500"
          >
            {availableDates.length === 0 ? (
              <option value="">No snapshots stored</option>
            ) : (
              availableDates.map(d => (
                <option key={d} value={d}>{d}</option>
              ))
            )}
          </select>
        </div>

        {/* Snapshot Selector */}
        <div className="flex flex-col gap-1.5 relative">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
            Active Snapshot (T1)
          </span>
          <button
            onClick={() => {
              setIsT1Open(!isT1Open);
              setIsT2Open(false);
            }}
            disabled={snapshots.length === 0}
            className="w-full flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-bold focus:outline-none focus:border-sky-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>
              {activeSnapshot 
                ? `${getTriggerLabel(activeSnapshot.trigger)} (${formatTime(activeSnapshot.timestamp)})` 
                : 'No snapshots'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          </button>
          
          {isT1Open && snapshots.length > 0 && (
            <div className="absolute top-[100%] left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-xl py-1 max-h-60 overflow-y-auto z-50 shadow-2xl">
              {snapshots.map(s => (
                <div
                  key={s.id}
                  onClick={() => {
                    if (s.id !== undefined) {
                      setSelectedSnapshotId(s.id);
                      setIsT1Open(false);
                    }
                  }}
                  className={`group flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-900 cursor-pointer ${
                    s.id === selectedSnapshotId ? 'bg-slate-900/60 text-sky-400' : 'text-slate-200'
                  }`}
                >
                  <span className="font-bold">
                    {getTriggerLabel(s.trigger)} ({formatTime(s.timestamp)})
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (s.id !== undefined) {
                        handleDeleteSnapshot(s.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-950/40 rounded transition-all text-rose-400"
                    title="Delete this snapshot"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Compare Mode Selector */}
        <div className="flex flex-col gap-1.5 relative">
          <span className="text-[10px] font-black text-sky-400 uppercase tracking-wider">
            Compare Target (T2 Exit)
          </span>
          <button
            onClick={() => {
              setIsT2Open(!isT2Open);
              setIsT1Open(false);
            }}
            disabled={snapshots.length === 0}
            className="w-full flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-bold focus:outline-none focus:border-sky-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>
              {compareSnapshot 
                ? `${getTriggerLabel(compareSnapshot.trigger)} (${formatTime(compareSnapshot.timestamp)})` 
                : 'None (LTP only)'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          </button>

          {isT2Open && snapshots.length > 0 && (
            <div className="absolute top-[100%] left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-xl py-1 max-h-60 overflow-y-auto z-50 shadow-2xl">
              <div
                onClick={() => {
                  setCompareTargetId(null);
                  setIsT2Open(false);
                }}
                className={`px-3 py-2 text-sm hover:bg-slate-900 cursor-pointer ${
                  compareTargetId === null ? 'bg-slate-900/60 text-sky-400' : 'text-slate-200 font-bold'
                }`}
              >
                None (LTP only)
              </div>
              {snapshots.map(s => (
                <div
                  key={s.id}
                  onClick={() => {
                    if (s.id !== undefined && s.id !== selectedSnapshotId) {
                      setCompareTargetId(s.id);
                      setIsT2Open(false);
                    }
                  }}
                  className={`group flex items-center justify-between px-3 py-2 text-sm ${
                    s.id === selectedSnapshotId 
                      ? 'opacity-40 cursor-not-allowed text-slate-500' 
                      : `hover:bg-slate-900 cursor-pointer ${
                          s.id === compareTargetId ? 'bg-slate-900/60 text-sky-400' : 'text-slate-200'
                        }`
                  }`}
                >
                  <span className="font-bold">
                    {getTriggerLabel(s.trigger)} ({formatTime(s.timestamp)})
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (s.id !== undefined) {
                        handleDeleteSnapshot(s.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-950/40 rounded transition-all text-rose-400"
                    title="Delete this snapshot"
                    disabled={s.id === selectedSnapshotId}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pattern Performance Backtester Stats Panel */}
      {backtestStats && backtestStats.totalTrades > 0 && (
        <div className="bg-sky-950/20 border border-sky-900/40 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-black text-sky-400 uppercase tracking-widest">
                Pattern Statistics (Across All Saved Days)
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Outcome for criteria: <span className="text-slate-200 font-bold">ToD RVOL ≥ {minToDRvol}×, G-Factor ≥ {minGFactor}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-8 bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl font-mono text-center">
            <div>
              <span className="text-[9px] text-slate-500 uppercase tracking-wider block">Trades</span>
              <span className="text-sm font-bold text-slate-200">{backtestStats.totalTrades}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-500 uppercase tracking-wider block">Win Rate</span>
              <span className={`text-sm font-bold ${backtestStats.winRate >= 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {backtestStats.winRate.toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-[9px] text-slate-500 uppercase tracking-wider block">Avg Win</span>
              <span className="text-sm font-bold text-emerald-400">+{backtestStats.avgGain.toFixed(2)}%</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-500 uppercase tracking-wider block">Avg Loss</span>
              <span className="text-sm font-bold text-rose-400">{backtestStats.avgLoss.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Filters Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center bg-slate-900/25 p-4 border border-slate-850 rounded-2xl">
        {/* Min ToD RVOL Filter */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <Filter className="w-3 h-3" /> Min Time-of-Day RVOL
          </label>
          <select
            value={minToDRvol}
            onChange={(e) => {
              setMinToDRvol(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none"
          >
            <option value="0">All Volumes</option>
            <option value="1">1.0× (Normal)</option>
            <option value="2">2.0× (Heavy)</option>
            <option value="3">3.0× (Aggressive)</option>
            <option value="5">5.0× (Institutional)</option>
            <option value="10">10.0× (Block Spike)</option>
            <option value="30">30.0× (Extreme Apex)</option>
          </select>
        </div>

        {/* Min G-Factor Filter */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
            Min G-Factor (0-10)
          </label>
          <select
            value={minGFactor}
            onChange={(e) => {
              setMinGFactor(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none"
          >
            <option value="0">All Scores</option>
            <option value="3">3.0+ (Slight Structure)</option>
            <option value="5">5.0+ (Solid structure)</option>
            <option value="7">7.0+ (Elite Momentum)</option>
            <option value="9">9.0+ (High Confluence)</option>
          </select>
        </div>

        {/* Sector Filter */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
            Sector Filter
          </label>
          <select
            value={selectedSector}
            onChange={(e) => {
              setSelectedSector(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 font-bold focus:outline-none"
          >
            <option value="ALL">All Sectors</option>
            {sectorsList.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Search Bar */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
            Search Symbol
          </label>
          <input
            type="text"
            placeholder="Search stock..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 font-bold focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Pagination Summary Info */}
      <div className="flex items-center justify-between text-xs text-slate-400 font-bold px-1">
        <span>
          Showing {filteredAndSearchedStocks.length > 0 ? (currentPage - 1) * 25 + 1 : 0} to{' '}
          {Math.min(currentPage * 25, filteredAndSearchedStocks.length)} of{' '}
          {filteredAndSearchedStocks.length} symbols
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-850 hover:text-white transition-all font-black"
            >
              Prev
            </button>
            <span className="font-mono text-slate-300">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-850 hover:text-white transition-all font-black"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Candidates Table */}
      <div className="overflow-x-auto border border-slate-850/80 rounded-2xl bg-slate-950/20">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-850 text-[10px] font-black uppercase text-slate-500 tracking-wider">
              <th className="py-3 px-4">Symbol</th>
              <th className="py-3 px-4">Sector</th>
              <th className="py-3 px-4 text-right">LTP (T1)</th>
              <th className="py-3 px-4 text-right">ToD RVOL</th>
              <th className="py-3 px-4 text-right">Whole RVOL</th>
              <th className="py-3 px-4 text-right">G-Factor</th>
              <th className="py-3 px-4 text-right">IGS Checklist</th>
              <th className="py-3 px-4 text-right">Score & Verdict</th>
              <th className="py-3 px-4 text-right bg-slate-900/20 text-sky-400">EOD Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850/40 text-xs text-slate-300 font-bold font-mono">
            {paginatedStocks.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-slate-600" />
                    <span>No stocks match your filter criteria in this snapshot</span>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedStocks.map(stock => {
                const rvolColor = stock.rvol_timeofday !== null
                  ? (stock.rvol_timeofday >= 5 ? 'text-emerald-400 font-black' : stock.rvol_timeofday >= 2 ? 'text-amber-400 font-bold' : 'text-slate-400')
                  : 'text-slate-600';
                
                const outcome = stock.outcomePct;
                const outcomeColor = outcome !== null
                  ? (outcome > 0 ? 'text-emerald-400 font-black' : outcome < 0 ? 'text-rose-400' : 'text-slate-400')
                  : 'text-slate-500';

                const igsText = stock.igsCheckCount !== undefined 
                  ? `${stock.igsCheckCount}/${stock.igsCheckTotal || 28}` 
                  : '—';
                const igsCompareText = compareSnapshot && stock.t2IgsCheckCount !== undefined
                  ? ` → ${stock.t2IgsCheckCount}/${stock.t2IgsCheckTotal || 28}`
                  : '';

                const scoreText = stock.score !== undefined 
                  ? `${stock.score} (${stock.verdict || 'P0 PASS'})` 
                  : '—';
                const scoreCompareText = compareSnapshot && stock.t2Score !== undefined
                  ? ` → ${stock.t2Score} (${stock.t2Verdict || 'P0 PASS'})`
                  : '';

                return (
                  <tr key={stock.symbol} className="hover:bg-slate-900/30 transition-colors">
                    <td className="py-3 px-4 text-slate-200 font-black font-sans">{stock.symbol}</td>
                    <td className="py-3 px-4 text-slate-400 font-sans">{stock.sector}</td>
                    <td className="py-3 px-4 text-right">₹{(stock.ltp || 0).toLocaleString('en-IN', { minimumFractionDigits: 1 })}</td>
                    <td className={`py-3 px-4 text-right ${rvolColor}`}>
                      {stock.rvol_timeofday !== null ? `${stock.rvol_timeofday.toFixed(1)}×` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400">{stock.rvol_wholeday.toFixed(1)}×</td>
                    <td className="py-3 px-4 text-right text-sky-400">{stock.gFactor.toFixed(1)}</td>
                    <td className="py-3 px-4 text-right text-indigo-400">
                      <span>{igsText}</span>
                      <span className="text-[10px] text-slate-500 font-sans font-bold">{igsCompareText}</span>
                    </td>
                    <td className="py-3 px-4 text-right text-amber-400">
                      <span>{scoreText}</span>
                      <span className="text-[10px] text-slate-500 font-sans font-bold">{scoreCompareText}</span>
                    </td>
                    <td className={`py-3 px-4 text-right bg-slate-900/10 ${outcomeColor}`}>
                      {outcome !== null ? (
                        <span className="flex items-center justify-end gap-1">
                          {outcome > 0 ? '▲' : outcome < 0 ? '▼' : ''}
                          {outcome > 0 ? '+' : ''}{outcome.toFixed(2)}%
                          <span className="text-[10px] text-slate-500 font-bold font-sans">
                            (₹{stock.finalLtp?.toFixed(1)})
                          </span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
};
