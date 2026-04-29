import React, { useState, useEffect, useRef } from 'react';
import { OpenAlgoTerminal } from '../../src/components/charts/OpenAlgoTerminal';
import {
  Search,
  Activity,
  RefreshCw,
  Database,
  Layers,
  Sparkles,
  TrendingUp,
  X,
  CheckCircle2,
} from 'lucide-react';

interface InstrumentResult {
  symbol: string;
  isin: string;
  instrument_key: string;
  exchange: string;
  lot_size: number;
}

interface QuickScrip {
  name: string;
  symbol: string;
  exchange: string;
}

const QUICK_SCRIPS: QuickScrip[] = [
  { name: 'Nifty 50', symbol: 'NIFTY', exchange: 'NSE_INDEX' },
  { name: 'Bank Nifty', symbol: 'BANKNIFTY', exchange: 'NSE_INDEX' },
  { name: 'Fin Nifty', symbol: 'FINNIFTY', exchange: 'NSE_INDEX' },
  { name: 'Midcap Nifty', symbol: 'MIDCPNIFTY', exchange: 'NSE_INDEX' },
  { name: 'Sensex', symbol: 'SENSEX', exchange: 'BSE_INDEX' },
  { name: 'Reliance', symbol: 'RELIANCE', exchange: 'NSE_EQ' },
  { name: 'HDFC Bank', symbol: 'HDFCBANK', exchange: 'NSE_EQ' },
  { name: 'TCS', symbol: 'TCS', exchange: 'NSE_EQ' },
  { name: 'Infosys', symbol: 'INFY', exchange: 'NSE_EQ' },
  { name: 'ICICI Bank', symbol: 'ICICIBANK', exchange: 'NSE_EQ' },
];

const TIMEFRAMES = [
  { label: '1m', value: '1m' },
  { label: '3m', value: '3m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
];

export const ProChartsTab: React.FC = () => {
  const [activeSymbol, setActiveSymbol] = useState<string>('NIFTY');
  const [activeExchange, setActiveExchange] = useState<string>('NSE_INDEX');
  const [activeInterval, setActiveInterval] = useState<string>('5m');

  // Search autocomplete state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<InstrumentResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [selectedFilter, setSelectedFilter] = useState<string>('ALL');

  // Instrument count & sync state
  const [instrumentCount, setInstrumentCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string>('');

  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Fetch initial instrument count
  useEffect(() => {
    fetch('/api/python-nse/api/upstox/instruments/count')
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'success' && typeof data.count === 'number') {
          setInstrumentCount(data.count);
        }
      })
      .catch(() => {});
  }, []);

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(() => {
      const exParam =
        selectedFilter !== 'ALL'
          ? `&exchange=${encodeURIComponent(selectedFilter)}`
          : '';
      fetch(
        `/api/python-nse/api/upstox/instruments/search?q=${encodeURIComponent(
          searchQuery.trim()
        )}${exParam}`
      )
        .then((r) => r.json())
        .then((data: InstrumentResult[]) => {
          if (Array.isArray(data)) {
            setSearchResults(data);
            setIsDropdownOpen(true);
          }
        })
        .catch(() => {
          setSearchResults([]);
        })
        .finally(() => {
          setIsSearching(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedFilter]);

  const handleSelectScrip = (scrip: QuickScrip) => {
    setActiveSymbol(scrip.symbol);
    setActiveExchange(scrip.exchange);
    setSearchQuery('');
    setIsDropdownOpen(false);
  };

  const handleSelectResult = (item: InstrumentResult) => {
    setActiveSymbol(item.symbol);
    setActiveExchange(item.exchange);
    setSearchQuery('');
    setIsDropdownOpen(false);
  };

  const handleTriggerSync = () => {
    setIsSyncing(true);
    setSyncMessage('Syncing master contract across all exchanges...');
    fetch('/api/python-nse/api/upstox/instruments/sync')
      .then((r) => r.json())
      .then(() => {
        setSyncMessage('Sync started in background! Updating count...');
        setTimeout(() => {
          fetch('/api/python-nse/api/upstox/instruments/count')
            .then((r) => r.json())
            .then((res) => {
              if (res.status === 'success') {
                setInstrumentCount(res.count);
                setSyncMessage(`Active: ${res.count.toLocaleString()} symbols`);
              }
              setIsSyncing(false);
            });
        }, 3000);
      })
      .catch((err) => {
        setSyncMessage('Sync failed: ' + err);
        setIsSyncing(false);
      });
  };

  return (
    <div className="flex flex-col h-full w-full space-y-2.5 p-3 md:p-4 text-[var(--wa-text-primary,#f8fafc)] font-sans select-none">
      {/* 1. Header Command Deck */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--wa-surface,#0b0d14)] border border-[var(--wa-border,rgba(255,255,255,0.08))] p-3 rounded-2xl shadow-lg">
        {/* Title & Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--wa-accent,#6366f1)] flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold tracking-tight font-display text-[var(--wa-text-primary,#f8fafc)]">
                Pro Charts Terminal
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                OpenAlgo 2.5 Canvas
              </span>
            </div>
            <p className="text-[11px] text-[var(--wa-text-muted,#64748b)]">
              Upstox Live Stream &bull; 105 Indicators &bull; 85 Drawing Tools &bull; Volume Profile (TPO)
            </p>
          </div>
        </div>

        {/* Search Autocomplete Box */}
        <div ref={searchContainerRef} className="relative flex-1 max-w-md min-w-[260px]">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-4 h-4 text-[var(--wa-text-muted,#64748b)] pointer-events-none" />
            <input
              type="text"
              placeholder="Find any symbol (e.g. NIFTY, TATASTEEL, INFY)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setIsDropdownOpen(true);
              }}
              className="w-full pl-9 pr-8 py-2 text-xs rounded-xl bg-[var(--wa-card,#0d0f17)] border border-[var(--wa-border,rgba(255,255,255,0.08))] text-[var(--wa-text-primary,#f8fafc)] placeholder-[var(--wa-text-muted,#64748b)] focus:outline-none focus:border-[var(--wa-accent,#6366f1)] shadow-inner transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setIsDropdownOpen(false);
                }}
                className="absolute right-2.5 text-[var(--wa-text-muted,#64748b)] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Autocomplete Dropdown */}
          {isDropdownOpen && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1.5 max-h-80 overflow-y-auto rounded-xl bg-[var(--wa-card-elevated,#131624)] border border-[var(--wa-border,rgba(255,255,255,0.12))] shadow-2xl z-50 no-scrollbar divide-y divide-[var(--wa-border,rgba(255,255,255,0.06))]">
              {/* Segment Filter Header */}
              <div className="flex items-center gap-1.5 p-2 bg-[var(--wa-card,#0d0f17)] text-[10px] font-bold text-[var(--wa-text-muted,#64748b)]">
                {['ALL', 'NSE_EQ', 'NSE_INDEX', 'BSE_INDEX', 'NSE_FO'].map((seg) => (
                  <button
                    key={seg}
                    type="button"
                    onClick={() => setSelectedFilter(seg)}
                    className={`px-2 py-0.5 rounded ${
                      selectedFilter === seg
                        ? 'bg-[var(--wa-accent,#6366f1)] text-white'
                        : 'hover:text-white'
                    }`}
                  >
                    {seg}
                  </button>
                ))}
              </div>

              {searchResults.map((item) => (
                <div
                  key={item.instrument_key}
                  onClick={() => handleSelectResult(item)}
                  className="flex items-center justify-between px-3 py-2 text-xs hover:bg-[var(--wa-surface,#0b0d14)] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-[var(--wa-text-primary,#f8fafc)]">
                      {item.symbol}
                    </span>
                    <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-[var(--wa-card,#0d0f17)] text-[var(--wa-text-secondary,#94a3b8)]">
                      {item.exchange}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--wa-text-muted,#64748b)]">
                    Lot: {item.lot_size}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Master Instruments Sync & Live Status */}
        <div className="flex items-center gap-2">
          {/* Live WS Pill */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--wa-card,#0d0f17)] border border-[var(--wa-border,rgba(255,255,255,0.08))]">
            <span className="w-2 h-2 rounded-full bg-[var(--wa-bullish,#10b981)] animate-pulse" />
            <span className="text-[11px] text-[var(--wa-text-secondary,#94a3b8)]">Upstox Feed Live</span>
          </div>

          {/* Master Contract Sync Button */}
          <button
            type="button"
            onClick={handleTriggerSync}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[var(--wa-card,#0d0f17)] hover:bg-[var(--wa-surface,#0b0d14)] border border-[var(--wa-border,rgba(255,255,255,0.08))] text-[var(--wa-text-secondary,#94a3b8)] hover:text-white transition-all shadow-sm"
            title="Update Master Contract Database from Upstox (3.3MB complete across NSE/BSE/MCX)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-indigo-400' : ''}`} />
            <span className="text-[11px]">
              {instrumentCount > 0 ? `${instrumentCount.toLocaleString()} Scrips` : 'Sync Master'}
            </span>
          </button>
        </div>
      </div>

      {/* 2. Scrip Preset Bar & Timeframe Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--wa-surface,#0b0d14)] border border-[var(--wa-border,rgba(255,255,255,0.08))] px-3 py-2 rounded-2xl shadow-sm">
        {/* Preset Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {QUICK_SCRIPS.map((scrip) => {
            const isActive = activeSymbol === scrip.symbol && activeExchange === scrip.exchange;
            return (
              <button
                key={scrip.symbol}
                type="button"
                onClick={() => handleSelectScrip(scrip)}
                className={`px-3 py-1 rounded-xl text-xs font-extrabold transition-all duration-150 whitespace-nowrap ${
                  isActive
                    ? 'bg-[var(--wa-accent,#6366f1)] text-white shadow-md shadow-indigo-500/20'
                    : 'bg-[var(--wa-card,#0d0f17)] text-[var(--wa-text-secondary,#94a3b8)] hover:text-white hover:bg-[var(--wa-card-elevated,#131624)] border border-[var(--wa-border,rgba(255,255,255,0.05))]'
                }`}
              >
                {scrip.name}
              </button>
            );
          })}
        </div>

        {/* Timeframe Chips */}
        <div className="flex items-center gap-1 bg-[var(--wa-card,#0d0f17)] border border-[var(--wa-border,rgba(255,255,255,0.06))] p-1 rounded-xl">
          {TIMEFRAMES.map((tf) => {
            const isSelected = activeInterval === tf.value;
            return (
              <button
                key={tf.value}
                type="button"
                onClick={() => setActiveInterval(tf.value)}
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold transition-all duration-150 ${
                  isSelected
                    ? 'bg-[var(--wa-accent,#6366f1)] text-white shadow-sm'
                    : 'text-[var(--wa-text-muted,#64748b)] hover:text-white'
                }`}
              >
                {tf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. OpenAlgo Canvas Terminal Viewport */}
      <div className="flex-1 w-full min-h-[580px] rounded-2xl overflow-hidden border border-[var(--wa-border,rgba(255,255,255,0.08))] shadow-2xl bg-[var(--wa-surface,#0b0d14)]">
        <OpenAlgoTerminal
          symbol={activeSymbol}
          exchange={activeExchange}
          interval={activeInterval}
          theme="dark"
          height="100%"
          className="w-full h-full"
        />
      </div>
    </div>
  );
};

export default ProChartsTab;
