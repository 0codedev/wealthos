import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, SlidersHorizontal, RefreshCw, AlertCircle
} from 'lucide-react';
import { upstoxMarketDataService } from '../../services/UpstoxMarketDataService';

interface InstrumentSelectorProps {
  onSelect: (instrument: {
    symbol: string;
    instrument_key: string;
    exchange: string;
    lot_size: number;
    strike_price?: number;
    expiry?: string;
    option_type?: string;
  }) => void;
  value?: string;
  onChange?: (val: string) => void;
  className?: string;
  placeholder?: string;
}

export const InstrumentSelector: React.FC<InstrumentSelectorProps> = ({
  onSelect,
  value = '',
  onChange,
  className = '',
  placeholder = 'Search Symbol (e.g. NIFTY, Reliance)...'
}) => {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedUnderlying, setSelectedUnderlying] = useState<any | null>(null);

  // Filters state
  const [segment, setSegment] = useState<'EQ' | 'FO'>('EQ');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [optionType, setOptionType] = useState<'ALL' | 'CE' | 'PE'>('ALL');
  const [strikeMin, setStrikeMin] = useState<string>('');
  const [strikeMax, setStrikeMax] = useState<string>('');
  const [atmOffset, setAtmOffset] = useState<string>('');
  
  const [contracts, setContracts] = useState<any[]>([]);
  const [isFetchingContracts, setIsFetchingContracts] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Sync with value prop
  useEffect(() => {
    if (value !== undefined && value !== query) {
      setQuery(value);
    }
  }, [value]);

  // Autocomplete search
  useEffect(() => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    const handler = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = await upstoxMarketDataService.searchInstruments(cleanQuery);
        // Sort results
        const sorted = [...(results || [])].sort((a, b) => {
          if (segment === 'FO') {
            return a.exchange === 'NSE_FO' ? -1 : 1;
          }
          return a.exchange === 'NSE_EQ' ? -1 : 1;
        });
        setSuggestions(sorted);
      } catch (err) {
        console.error('Failed to search instruments', err);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(handler);
  }, [query, segment]);

  // Click outside to close suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch F&O expiries/contracts when underlying is selected
  useEffect(() => {
    if (!selectedUnderlying || segment !== 'FO') {
      setExpiries([]);
      setSelectedExpiry('');
      setContracts([]);
      return;
    }

    const fetchContracts = async () => {
      setIsFetchingContracts(true);
      setErrorMsg('');
      try {
        let url = `/api/python-nse/api/upstox/option-contracts?symbol=${encodeURIComponent(selectedUnderlying.symbol)}`;
        if (selectedExpiry) url += `&expiry=${encodeURIComponent(selectedExpiry)}`;
        if (optionType !== 'ALL') url += `&option_type=${optionType}`;
        if (strikeMin) url += `&strike_min=${strikeMin}`;
        if (strikeMax) url += `&strike_max=${strikeMax}`;
        if (atmOffset) url += `&atm_offset=${atmOffset}`;

        const response = await fetch(url);
        if (response.ok) {
          const res = await response.json();
          const list = res.data || [];
          setContracts(list);

          // Populate expiries dynamically if not set
          if (!selectedExpiry) {
            const uniqueExpiries: string[] = Array.from(
              new Set(list.map((c: any) => c.expiry).filter(Boolean))
            ).sort() as string[];
            setExpiries(uniqueExpiries);
            if (uniqueExpiries.length > 0) {
              setSelectedExpiry(uniqueExpiries[0]);
            }
          }
        } else {
          setErrorMsg('Failed to retrieve option contracts.');
        }
      } catch (err) {
        setErrorMsg('Error loading option contracts.');
      } finally {
        setIsFetchingContracts(false);
      }
    };

    fetchContracts();
  }, [selectedUnderlying, segment, selectedExpiry, optionType, strikeMin, strikeMax, atmOffset]);

  const handleSelectUnderlying = (item: any) => {
    setSelectedUnderlying(item);
    setQuery(item.symbol);
    setShowSuggestions(false);
    setSelectedExpiry('');
    
    if (onChange) {
      onChange(item.symbol);
    }
    
    if (segment === 'EQ') {
      onSelect({
        symbol: item.symbol,
        instrument_key: item.instrument_key,
        exchange: item.exchange,
        lot_size: item.lot_size
      });
    }
  };

  return (
    <div className={`space-y-4 w-full text-slate-900 dark:text-white font-mono ${className}`} ref={searchContainerRef}>
      {/* Segment and Input Container */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Segment Toggle */}
        <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shrink-0 h-fit">
          <button
            type="button"
            onClick={() => {
              setSegment('EQ');
              setSelectedUnderlying(null);
              setQuery('');
              if (onChange) onChange('');
            }}
            className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
              segment === 'EQ' 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'text-slate-500 dark:text-slate-450 hover:text-slate-700 dark:hover:text-slate-250'
            }`}
          >
            Equity
          </button>
          <button
            type="button"
            onClick={() => {
              setSegment('FO');
              setSelectedUnderlying(null);
              setQuery('');
              if (onChange) onChange('');
            }}
            className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
              segment === 'FO' 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'text-slate-500 dark:text-slate-450 hover:text-slate-700 dark:hover:text-slate-250'
            }`}
          >
            Derivatives
          </button>
        </div>

        {/* Query Input */}
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-600">
            <Search size={14} />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              setShowSuggestions(true);
              if (selectedUnderlying) {
                setSelectedUnderlying(null);
              }
              if (onChange) {
                onChange(val);
              }
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder={placeholder}
            className="w-full bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600"
          />

          {/* Autocomplete Dropdown */}
          {showSuggestions && (query.length >= 2 || suggestions.length > 0) && (
            <div className="absolute z-50 w-full mt-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-900/60 backdrop-blur-xl">
              {isLoading ? (
                <div className="px-4 py-3 text-xs text-slate-550 flex items-center gap-2">
                  <RefreshCw size={12} className="animate-spin text-indigo-500" />
                  <span>Searching database...</span>
                </div>
              ) : suggestions.length === 0 ? (
                <div className="px-4 py-3 text-xs text-slate-550">No instruments found.</div>
              ) : (
                suggestions.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectUnderlying(item)}
                    className="w-full px-4 py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-900/80 transition-colors flex justify-between items-center group cursor-pointer text-slate-900 dark:text-white"
                  >
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{item.symbol}</span>
                      <span className="text-[9px] text-slate-500 ml-2 uppercase font-black px-1.5 py-0.5 bg-slate-100 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">{item.exchange}</span>
                    </div>
                    <span className="text-[10px] text-slate-500">Lot: {item.lot_size}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Advanced F&O Options Filters Panel */}
      {segment === 'FO' && selectedUnderlying && (
        <div className="p-4 bg-slate-50/50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800/60 rounded-2xl space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-850 pb-2">
            <SlidersHorizontal size={12} className="text-indigo-600 dark:text-indigo-400" />
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-550">Advanced Option Filters</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Expiry Dropdown */}
            <div>
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Expiry Date</label>
              <select
                value={selectedExpiry}
                onChange={(e) => setSelectedExpiry(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-2 text-[10px] font-bold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 outline-none"
              >
                {expiries.map(exp => (
                  <option key={exp} value={exp}>{exp}</option>
                ))}
              </select>
            </div>

            {/* Option Type */}
            <div>
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Call / Put</label>
              <div className="flex bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-0.5 rounded-lg">
                {(['ALL', 'CE', 'PE'] as const).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setOptionType(type)}
                    className={`flex-1 py-1 text-[9px] font-black uppercase rounded transition-colors ${
                      optionType === type ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Strike Range */}
            <div>
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Strike Range (Min - Max)</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  placeholder="Min"
                  value={strikeMin}
                  onChange={(e) => setStrikeMin(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-[10px] font-bold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-700"
                />
                <span className="text-slate-405 text-[10px]">-</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={strikeMax}
                  onChange={(e) => setStrikeMax(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-[10px] font-bold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-700"
                />
              </div>
            </div>

            {/* ATM Offset */}
            <div>
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">ATM Offset (Points)</label>
              <input
                type="number"
                placeholder="e.g. 200"
                value={atmOffset}
                onChange={(e) => setAtmOffset(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-[10px] font-bold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-700"
              />
            </div>
          </div>

          {/* Option Contracts Results */}
          <div className="space-y-2 pt-2">
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-550 block">Select Target Option Contract:</span>
            {isFetchingContracts ? (
              <div className="py-6 text-center text-slate-500 text-[10px] flex items-center justify-center gap-2">
                <RefreshCw size={12} className="animate-spin text-indigo-500" />
                <span>Fetching option contracts from Upstox...</span>
              </div>
            ) : errorMsg ? (
              <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-[10px] font-bold">
                <AlertCircle size={12} />
                <span>{errorMsg}</span>
              </div>
            ) : contracts.length === 0 ? (
              <div className="py-4 text-center text-slate-550 text-[10px]">No contracts match filters.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
                {contracts.slice(0, 40).map((c: any) => (
                  <button
                    key={c.instrument_key}
                    type="button"
                    onClick={() => {
                      const finalSymbol = c.trading_symbol;
                      setQuery(finalSymbol);
                      if (onChange) onChange(finalSymbol);
                      onSelect({
                        symbol: finalSymbol,
                        instrument_key: c.instrument_key,
                        exchange: c.exchange || 'NSE_FO',
                        lot_size: c.lot_size || selectedUnderlying.lot_size,
                        strike_price: c.strike_price,
                        expiry: c.expiry,
                        option_type: c.option_type
                      });
                    }}
                    className="px-2.5 py-2 text-left bg-white dark:bg-slate-900/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:border-indigo-500/40 border border-slate-200 dark:border-slate-800/80 rounded-xl transition-all cursor-pointer group text-slate-900 dark:text-white"
                  >
                    <div className="text-[10px] font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{c.trading_symbol}</div>
                    <div className="text-[8px] text-slate-500 mt-0.5">Strike: {c.strike_price} ({c.option_type})</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
