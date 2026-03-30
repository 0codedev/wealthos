import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Database, CheckCircle2, AlertCircle, FileText, Trash2, Shield, Info, BarChart3, ChevronRight, RefreshCw, Play } from 'lucide-react';
import { DataVaultService } from '../../services/backtester/DataVaultService';
import { UpstoxBacktestDataService } from '../../services/backtester/UpstoxBacktestDataService';
import { formatNumberIndian } from '../../utils/helpers';
import { db } from '../../database';
import { sanitizeStyleFragment } from '../../utils/security';
import { ExpiredRadar } from './ExpiredRadar';

export const DataVaultTab: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [stats, setStats] = useState({ totalPoints: 0, symbolCount: 0, lastUpdated: 'Never' });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Upstox Live Fetch states
  const [symbol, setSymbol] = useState('NIFTY');
  const [customSymbol, setCustomSymbol] = useState('');
  const [segment, setSegment] = useState<'options' | 'futures' | 'equity'>('options');
  const [interval, setFetchInterval] = useState('day');
  const [cycles, setCycles] = useState(6);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<{
    step: number;
    stepName: string;
    current: number;
    total: number;
    symbol: string;
  } | null>(null);

  // Parquet Sync states
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [archiveStats, setArchiveStats] = useState<{ total_mb: number, file_count: number, symbols_count: number } | null>(null);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [syncMode, setSyncMode] = useState<'delta' | 'full'>('delta');
  const [syncSymbols, setSyncSymbols] = useState<'indices' | 'all' | 'custom'>('indices');
  const [customSyncSymbols, setCustomSyncSymbols] = useState('');
  const [deltaStrategy, setDeltaStrategy] = useState<'static' | 'buffer'>('static');
  const [bufferDays, setBufferDays] = useState<number>(7);

  useEffect(() => {
    loadStats();
    loadSyncStatus();
    loadArchiveStats();
  }, []);

  const loadSyncStatus = async () => {
    try {
      const response = await fetch('/api/python-nse/api/backtest/sync-status');
      if (response.ok) {
        const data = await response.json();
        setSyncStatus(data);
      }
    } catch (error) {
      console.error('Failed to load sync status:', error);
    }
  };

  const loadArchiveStats = async () => {
    try {
      const response = await fetch('/api/python-nse/api/backtest/archive-stats');
      if (response.ok) {
        const data = await response.json();
        setArchiveStats(data);
      }
    } catch (error) {
      console.error('Failed to load archive stats:', error);
    }
  };

  // Poll sync status if running
  useEffect(() => {
    let intervalId: any;
    if (syncStatus?.is_running) {
      intervalId = setInterval(() => {
        loadSyncStatus();
        loadArchiveStats();
      }, 5000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [syncStatus?.is_running]);

  const loadStats = async () => {
    const s = await DataVaultService.getVaultStats();
    setStats(s);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsImporting(true);
    setFeedback(null);
    let totalImported = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        const points = await DataVaultService.parseBhavcopy(files[i]);
        const imported = await DataVaultService.importToVault(points);
        totalImported += imported;
      }
      
      setFeedback({ 
        type: 'success', 
        message: `Successfully imported ${formatNumberIndian(totalImported)} data points into the Vault.`
      });
      loadStats();
    } catch (error) {
      setFeedback({ 
        type: 'error', 
        message: 'Failed to parse file. Ensure it is a valid NSE Bhavcopy CSV.' 
      });
    } finally {
      setIsImporting(false);
    }
  };

  const clearVault = async () => {
    if (confirm('Are you sure you want to clear the Data Vault? This will delete all local historical data.')) {
      await db.historical_data.clear();
      loadStats();
      setFeedback({ type: 'success', message: 'Data Vault cleared successfully.' });
    }
  };

  const handleLiveFetch = async () => {
    setIsFetching(true);
    setFetchProgress(null);
    setFeedback(null);
    
    const targetSymbol = symbol === 'CUSTOM' ? customSymbol.trim().toUpperCase() : symbol;
    const symbolList = targetSymbol.split(',').map(s => s.trim()).filter(Boolean);
    
    if (symbolList.length === 0) {
      setFeedback({ type: 'error', message: 'Please specify a valid symbol.' });
      setIsFetching(false);
      return;
    }
    
    try {
      let totalImportedSymbols = 0;
      
      for (const sym of symbolList) {
        await UpstoxBacktestDataService.fetchAndStore(
          sym,
          segment,
          interval,
          cycles,
          (progress) => {
            setFetchProgress({
              ...progress,
              symbol: `${sym} -> ${progress.symbol}`
            });
          }
        );
        totalImportedSymbols++;
      }
      
      setFeedback({
        type: 'success',
        message: `Successfully fetched and stored live data for ${symbolList.join(', ')} (${segment}).`
      });
      loadStats();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback({
        type: 'error',
        message: message || `Failed to fetch live data from Upstox. Please ensure python-bridge is running.`
      });
    } finally {
      setIsFetching(false);
      setFetchProgress(null);
    }
  };

  const startSync = async () => {
    try {
      const symbolsParam = syncSymbols === 'custom' ? customSyncSymbols : syncSymbols;
      let url = `/api/python-nse/api/backtest/start-sync?mode=${syncMode}&symbols=${encodeURIComponent(symbolsParam)}`;
      if (syncMode === 'delta') {
        url += `&delta_strategy=${deltaStrategy}&buffer_days=${bufferDays}`;
      }
      const response = await fetch(url, {
        method: 'POST'
      });
      if (response.ok) {
        setFeedback({
          type: 'success',
          message: 'Parquet synchronization started in the background.'
        });
        loadSyncStatus();
      } else {
        const err = await response.json();
        setFeedback({
          type: 'error',
          message: err.detail || 'Failed to start synchronization.'
        });
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        message: 'Network error starting synchronization.'
      });
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto py-4">
      {/* Header & Stats Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-800/60 backdrop-blur-md shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity">
            <Database size={160} className="text-indigo-500 rotate-12" />
          </div>
          <div className="relative z-10">
            <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter mb-2">Institutional Data Vault</h2>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-8">Local High-Fidelity Market History</p>
            
            <div className="grid grid-cols-2 gap-8">
              <div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Total Data Points</span>
                <span className="text-3xl font-black text-white italic">{formatNumberIndian(stats.totalPoints)}</span>
              </div>
              <div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Unique Symbols</span>
                <span className="text-3xl font-black text-indigo-400 italic">{stats.symbolCount}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-800/60 backdrop-blur-md flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Shield className="text-emerald-400" size={18} />
              <span className="text-[10px] font-black text-white uppercase tracking-widest">Privacy Status</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
              Data in the vault is stored **locally on your device**. No external servers or API keys are required for backtesting.
            </p>
          </div>
          <button 
            onClick={clearVault}
            className="mt-6 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all text-[10px] font-black uppercase tracking-widest"
          >
            <Trash2 size={14} /> Clear Local Vault
          </button>
        </div>
      </div>

      {/* Upload Zone */}
      <div 
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e.dataTransfer.files); }}
        className={`relative group h-[300px] rounded-[3rem] border-2 border-dashed transition-all flex flex-col items-center justify-center overflow-hidden
          ${isDragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/20 hover:border-slate-700'}
        `}
      >
        <input 
          type="file" 
          multiple 
          accept=".csv"
          onChange={(e) => handleFileUpload(e.target.files)}
          className="absolute inset-0 opacity-0 cursor-pointer z-10"
        />
        
        {isImporting ? (
          <div className="flex flex-col items-center space-y-4">
            <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
            <p className="text-[10px] font-black text-white uppercase tracking-[0.3em] animate-pulse">Ingesting Market Data...</p>
          </div>
        ) : (
          <>
            <div className="w-16 h-16 bg-slate-800 rounded-3xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Upload className="text-indigo-400" size={32} />
            </div>
            <h3 className="text-sm font-black text-white uppercase tracking-[0.2em] mb-2">Drop NSE Bhavcopy Here</h3>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Supports Equity & F&O CSV Files</p>
          </>
        )}
      </div>

      {/* Parquet Archive Sync Dashboard */}
      <div className="bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-800/60 backdrop-blur-md shadow-2xl relative overflow-hidden group">
        {/* CC12 — wrap static CSS in the sanitizer. */}
        <style>{sanitizeStyleFragment(`
          <style>
          @keyframes shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }
          .animate-shimmer {
            background: linear-gradient(90deg, #6366f1 25%, #a855f7 50%, #6366f1 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite linear;
          }
          </style>
        `)}</style>
        <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity">
          <Database size={160} className="text-violet-500 rotate-45" />
        </div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter mb-2">Parquet Archive Sync</h2>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-8">Download and manage high-fidelity compressed F&O data locally</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mb-6">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Sync Mode</label>
              <select
                value={syncMode}
                onChange={(e) => setSyncMode(e.target.value as any)}
                disabled={syncStatus?.is_running}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="delta">Delta (Incremental, Weekly)</option>
                <option value="full">Full (Re-download All)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Symbol Set</label>
              <select
                value={syncSymbols}
                onChange={(e) => setSyncSymbols(e.target.value as any)}
                disabled={syncStatus?.is_running}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="indices">Indices (Nifty, BankNifty, etc.)</option>
                <option value="all">Full F&O Universe (180+ stocks)</option>
                <option value="custom">Custom list...</option>
              </select>
              {syncSymbols === 'custom' && (
                <input
                  type="text"
                  placeholder="e.g. RELIANCE,SBIN,INFY"
                  value={customSyncSymbols}
                  onChange={(e) => setCustomSyncSymbols(e.target.value)}
                  disabled={syncStatus?.is_running}
                  className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-bold text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              )}
            </div>

            {syncMode === 'delta' ? (
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Delta Strategy</label>
                <select
                  value={deltaStrategy}
                  onChange={(e) => setDeltaStrategy(e.target.value as any)}
                  disabled={syncStatus?.is_running}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  <option value="static">Static (Skip Existing)</option>
                  <option value="buffer">Buffer Override (Recent Expiries)</option>
                </select>
                {deltaStrategy === 'buffer' && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">Days:</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={bufferDays}
                      onChange={(e) => setBufferDays(Number(e.target.value))}
                      disabled={syncStatus?.is_running}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Last Sync</label>
                <div className="bg-slate-950/60 border border-slate-800/40 rounded-xl px-4 py-3 text-xs font-black text-white italic">
                  {syncStatus?.last_sync ? new Date(syncStatus.last_sync).toLocaleString() : 'Never'}
                </div>
              </div>
            )}

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Archive Status</label>
              <div className="bg-slate-950/60 border border-slate-800/40 rounded-xl px-4 py-3 text-xs font-black text-indigo-400 italic">
                {syncStatus?.is_running ? 'Syncing...' : syncStatus?.completed_symbols ? `${Object.keys(syncStatus.completed_symbols).length} symbols archived` : 'Idle'}
              </div>
              {syncMode === 'delta' && (
                <div className="mt-2 text-[9px] font-bold text-slate-500 uppercase italic">
                  Last Sync: {syncStatus?.last_sync ? new Date(syncStatus.last_sync).toLocaleDateString() : 'Never'}
                </div>
              )}
            </div>
          </div>

          {syncStatus?.is_running && (
            <div className="mb-6 p-6 rounded-2xl bg-indigo-500/5 border border-indigo-500/10">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                  Parquet Archive Build in Progress
                </span>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">
                  Syncing background process...
                </span>
              </div>
              <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden mb-2 relative">
                <div className="animate-shimmer h-full rounded-full w-full shadow-[0_0_12px_rgba(99,102,241,0.5)]" />
              </div>
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                Data is being synchronized locally in the background. You can close this tab or dashboard while it finishes.
              </div>
            </div>
          )}

          <div className="flex justify-end items-center gap-4">
            {syncStatus?.errors && syncStatus.errors.length > 0 && (
              <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wide flex items-center gap-1.5">
                <AlertCircle size={12} /> Sync completed with {syncStatus.errors.length} errors
              </span>
            )}
            
            <button
              onClick={startSync}
              disabled={syncStatus?.is_running}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-black text-[10px] uppercase tracking-widest px-8 py-4 rounded-2xl transition-all shadow-lg hover:shadow-violet-500/20 disabled:opacity-40"
            >
              {syncStatus?.is_running ? (
                <>
                  <RefreshCw size={14} className="animate-spin" /> Sync Running...
                </>
              ) : (
                <>
                  <Play size={14} /> Start Synchronization
                </>
              )}
            </button>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-800/60 my-8" />

          {/* Metadata Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 my-6">
            <div className="bg-slate-950/40 p-5 rounded-2xl border border-slate-800/40">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Compressed Archive Size</span>
              <span className="text-xl font-black text-white italic">{archiveStats ? `${archiveStats.total_mb.toFixed(2)} MB` : 'Calculating...'}</span>
            </div>
            <div className="bg-slate-950/40 p-5 rounded-2xl border border-slate-800/40">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Total Parquet Files</span>
              <span className="text-xl font-black text-indigo-400 italic">{archiveStats ? `${archiveStats.file_count} files` : 'Calculating...'}</span>
            </div>
            <div className="bg-slate-950/40 p-5 rounded-2xl border border-slate-800/40">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Archived Tickers</span>
              <span className="text-xl font-black text-emerald-400 italic">{archiveStats ? `${archiveStats.symbols_count} symbols` : 'Calculating...'}</span>
            </div>
          </div>

          {/* Sync Inventory Virtual List */}
          {syncStatus?.completed_symbols && Object.keys(syncStatus.completed_symbols).length > 0 && (
            <div className="mt-6">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-4">
                <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                  <Database size={12} className="text-indigo-400" />
                  Local Parquet Archive Inventory
                </h3>
                <input
                  type="text"
                  placeholder="Filter symbols (e.g. INFY, NIFTY)..."
                  value={archiveSearch}
                  onChange={(e) => setArchiveSearch(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs font-bold text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors w-full sm:w-64"
                />
              </div>

              {/* Simple Windowed List (Virtualized) */}
              {(() => {
                const items = Object.entries(syncStatus.completed_symbols).map(([symbol, info]: [string, any]) => ({
                  symbol,
                  last_synced_at: info.last_synced_at,
                  status: info.status || 'success',
                  message: info.message
                }));
                const filtered = items.filter(it => it.symbol.toUpperCase().includes(archiveSearch.toUpperCase()));
                const itemHeight = 44;
                const containerHeight = 250;
                const totalHeight = filtered.length * itemHeight;
                const visibleCount = Math.ceil(containerHeight / itemHeight);
                const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 3);
                const endIndex = Math.min(filtered.length, startIndex + visibleCount + 6);
                
                return (
                  <div 
                    className="relative overflow-y-auto border border-slate-800/60 rounded-2xl bg-slate-950/40"
                    style={{ height: `${containerHeight}px` }}
                    onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
                  >
                    {filtered.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                        No symbols match your filter
                      </div>
                    ) : (
                      <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
                        {filtered.slice(startIndex, endIndex).map((item, index) => {
                          const absoluteIndex = startIndex + index;
                          const isErr = item.status === 'error' || item.status === 'failed';
                          return (
                            <div 
                              key={item.symbol}
                              className="absolute left-0 w-full flex items-center justify-between px-6 border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors"
                              style={{ 
                                top: `${absoluteIndex * itemHeight}px`, 
                                height: `${itemHeight}px` 
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-black text-white">{item.symbol}</span>
                                <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                  isErr ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                }`}>
                                  {item.status}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-4 text-right">
                                {isErr && item.message && (
                                  <span 
                                    className="text-[9px] text-rose-400/80 font-bold max-w-[200px] truncate uppercase tracking-tight cursor-help"
                                    title={item.message}
                                  >
                                    {item.message}
                                  </span>
                                )}
                                <span className="text-[9px] text-slate-500 font-bold uppercase">
                                  {item.last_synced_at ? new Date(item.last_synced_at).toLocaleString() : 'Never'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Live Fetch Panel */}
      <div className="bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-800/60 backdrop-blur-md shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity">
          <Database size={160} className="text-indigo-500 -rotate-12" />
        </div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter mb-2">Live Upstox Data Fetcher</h2>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-8">Pull institutional-grade data directly from Upstox API</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mb-6">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Symbol</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                disabled={isFetching}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="NIFTY">NIFTY 50</option>
                <option value="BANKNIFTY">BANKNIFTY</option>
                <option value="FINNIFTY">FINNIFTY</option>
                <option value="MIDCPNIFTY">MIDCPNIFTY</option>
                <option value="CUSTOM">Custom...</option>
              </select>
              {symbol === 'CUSTOM' && (
                <input
                  type="text"
                  placeholder="Enter custom symbol (e.g. SBIN)"
                  value={customSymbol}
                  onChange={(e) => setCustomSymbol(e.target.value)}
                  disabled={isFetching}
                  className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-bold text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              )}
            </div>
            
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Segment</label>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value as any)}
                disabled={isFetching}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="options">Options</option>
                <option value="futures">Futures</option>
                <option value="equity">Equity</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Interval</label>
              <select
                value={interval}
                onChange={(e) => setFetchInterval(e.target.value)}
                disabled={isFetching}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="1minute">1 Minute</option>
                <option value="5minute">5 Minute</option>
                <option value="15minute">15 Minute</option>
                <option value="day">Daily</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Expiry Cycles</label>
              <input
                type="number"
                min={1}
                max={24}
                value={cycles}
                onChange={(e) => setCycles(Number(e.target.value))}
                disabled={isFetching || segment === 'equity'}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-40"
              />
            </div>
          </div>

          {isFetching && fetchProgress && (
            <div className="mb-6 p-6 rounded-2xl bg-indigo-500/5 border border-indigo-500/10">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                  Step {fetchProgress.step}/4: {fetchProgress.stepName}
                </span>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {fetchProgress.current} / {fetchProgress.total}
                </span>
              </div>
              
              <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden mb-2">
                <div 
                  className="bg-indigo-500 h-full rounded-full transition-all duration-300 animate-pulse"
                  style={{ width: `${(fetchProgress.current / Math.max(1, fetchProgress.total)) * 100}%` }}
                />
              </div>
              
              <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                <span>Processing: {fetchProgress.symbol}</span>
                <span>{Math.round((fetchProgress.current / Math.max(1, fetchProgress.total)) * 100)}% Complete</span>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleLiveFetch}
              disabled={isFetching}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[10px] uppercase tracking-widest px-8 py-4 rounded-2xl transition-all shadow-lg hover:shadow-indigo-500/20 disabled:opacity-40"
            >
              {isFetching ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                  Fetching Live Data...
                </>
              ) : (
                <>
                  <Database size={14} /> Fetch & Store in Vault
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Feedback Overlay */}
      <AnimatePresence>
        {feedback && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`p-6 rounded-[2rem] border flex items-center gap-4 ${
              feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
            <span className="text-xs font-bold uppercase tracking-wide">{feedback.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expired Radar backtesting panel */}
      <ExpiredRadar />

      {/* Guide Card */}
      <div className="bg-indigo-500/5 p-8 rounded-[2.5rem] border border-indigo-500/10">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 bg-indigo-500/20 rounded-2xl">
            <Info className="text-indigo-400" size={24} />
          </div>
          <div>
            <h4 className="text-xs font-black text-white uppercase tracking-widest">How to get free data?</h4>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Institutional Sourcing Guide</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-start gap-4 p-4 bg-slate-900/40 rounded-2xl border border-slate-800/40">
            <div className="text-indigo-400 font-black italic text-lg opacity-30 mt-1">01</div>
            <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
              Go to **NSE India → Resources → Daily Reports**. Download the **Bhavcopy** (Full Bhavcopy) for the dates you want to test.
            </p>
          </div>
          <div className="flex items-start gap-4 p-4 bg-slate-900/40 rounded-2xl border border-slate-800/40">
            <div className="text-indigo-400 font-black italic text-lg opacity-30 mt-1">02</div>
            <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
              For **Options**, download the **F&O Bhavcopy**. This contains all strikes and premiums for the entire options chain.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
