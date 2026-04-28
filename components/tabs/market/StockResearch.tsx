import React, { useState, useEffect, useRef } from 'react';
import { Search, Globe, ChevronRight, X, ArrowLeft, Building2 } from 'lucide-react';
import { upstoxMarketDataService } from '../../../services/UpstoxMarketDataService';
import FundamentalsPanel from '../../alpha/ShadowTerminal/FundamentalsPanel';
import TabHero from '../../shared/TabHero';
import FundamentalVerdictCard from '../../market/FundamentalVerdictCard';
import CatalystTimeline from '../../market/CatalystTimeline';
import TradingViewWidget from '../../shared/TradingViewWidget';

interface InstrumentSuggestion {
  symbol: string;
  isin: string;
  instrument_key: string;
  exchange: string;
  lot_size: number;
}

const POPULAR_TICKERS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'TATASTEEL'];

export default function StockResearch() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<InstrumentSuggestion[]>([]);
  const [selectedStock, setSelectedStock] = useState<InstrumentSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Debounced autocomplete search
  useEffect(() => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 1) {
      setSuggestions([]);
      return;
    }

    const handler = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = await upstoxMarketDataService.searchInstruments(cleanQuery);
        setSuggestions(results || []);
      } catch (err) {
        console.error('Failed to search instruments', err);
      } finally {
        setIsLoading(false);
      }
    }, 250); // 250ms debounce

    return () => clearTimeout(handler);
  }, [query]);

  // Handle click outside to close suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (stock: InstrumentSuggestion) => {
    setSelectedStock(stock);
    setQuery(stock.symbol);
    setShowSuggestions(false);
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    setSelectedStock(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <TabHero
        eyebrow="Market Intel"
        title="Stock Research"
        description="Search any NSE stock symbol to analyze complete financials, smart money patterns, and peer valuations."
        icon={Building2}
        iconTone="text-indigo-500"
        gradientClassName="from-indigo-50 via-white to-sky-50 dark:from-indigo-950/20 dark:via-slate-950 dark:to-sky-950/20"
        chips={['Fundamentals', 'Smart Money', 'Relative Valuation']}
      />

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Search Container */}
        <div ref={searchContainerRef} className="relative w-full">
          <div className="flex gap-2 items-center">
            {selectedStock && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold transition-all"
                title="Go back to search"
              >
                <ArrowLeft size={16} />
                <span className="hidden sm:inline">Search</span>
              </button>
            )}
            
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-400">
                <Search size={18} />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Search symbol (e.g. RELIANCE, TCS, HDFC)..."
                className="w-full pl-12 pr-10 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm font-semibold shadow-sm"
              />
              {query && (
                <button
                  onClick={handleClear}
                  className="absolute inset-y-0 right-4 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Autocomplete Suggestions Dropdown */}
          {showSuggestions && (query.trim().length > 0 || isLoading) && (
            <div className="absolute z-50 w-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  Searching NSE Database...
                </div>
              ) : suggestions.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  No matching stock symbols found.
                </div>
              ) : (
                suggestions.map((stock) => (
                  <button
                    key={stock.instrument_key}
                    onClick={() => handleSelect(stock)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-black text-slate-900 dark:text-white">{stock.symbol}</span>
                      <span className="text-[10px] text-slate-400 font-medium">ISIN: {stock.isin}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                        stock.exchange === 'NSE_EQ' 
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' 
                          : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                      }`}>
                        {stock.exchange.replace('_', ' ')}
                      </span>
                      <ChevronRight size={14} className="text-slate-400" />
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Main Display Area */}
        {selectedStock ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              {/* Header info */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 ring-1 ring-indigo-500/20">
                    <Building2 size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                      {selectedStock.symbol}
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-250 dark:border-slate-700">
                        {selectedStock.exchange}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">ISIN: {selectedStock.isin} | Lot Size: {selectedStock.lot_size}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <a
                    href={`https://tradingview.com/chart/?symbol=NSE%3A${selectedStock.symbol}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-[10px] font-bold text-slate-500 dark:text-slate-400 transition-all flex items-center gap-1.5"
                  >
                    TradingView <Globe size={12} />
                  </a>
                </div>
              </div>

              {/* TradingView Free Advanced Chart (no API key, zero deps).
                  Sits above Fundamentals so users see the chart first. */}
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
                <TradingViewWidget symbol={selectedStock.symbol} interval="D" height={420} />
              </div>

              {/* Embedded Fundamentals Panel */}
              <FundamentalsPanel symbol={selectedStock.symbol} gFactor={0} />
            </div>

            <div className="lg:col-span-1 space-y-6">
              {/* Fundamental Verdict Card */}
              <FundamentalVerdictCard symbol={selectedStock.symbol} />
              
              {/* Catalyst Timeline */}
              <div className="h-[340px] md:h-[480px]">
                <CatalystTimeline symbol={selectedStock.symbol} />
              </div>
            </div>
          </div>
        ) : (
          /* Blank state screen */
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center shadow-sm max-w-2xl mx-auto space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-slate-400 border border-slate-100 dark:border-slate-850">
              <Search size={28} className="text-indigo-500" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-md font-bold text-slate-800 dark:text-white">Analyze Company Financials</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                Type any ticker or corporate name to load Upstox-backed balance sheets, cash flow models, revenue ratios, smart money holdings, and peer comparisons.
              </p>
            </div>

            {/* Popular searches shortcut */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-850/80">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-3">Popular Companies</span>
              <div className="flex flex-wrap justify-center gap-2">
                {POPULAR_TICKERS.map((ticker) => (
                  <button
                    key={ticker}
                    onClick={async () => {
                      setIsLoading(true);
                      try {
                        const results = await upstoxMarketDataService.searchInstruments(ticker);
                        if (results && results.length > 0) {
                          handleSelect(results[0]);
                        }
                      } catch (err) {
                        console.error('Shortcut select failed', err);
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-850 border border-slate-200/50 dark:border-slate-800/60 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-all"
                  >
                    {ticker}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
