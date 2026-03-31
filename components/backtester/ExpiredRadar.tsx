import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { 
  Database, RefreshCw, BarChart3, AlertCircle, Info, Calendar, LineChart, Cpu
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid 
} from 'recharts';

export const ExpiredRadar: React.FC = () => {
  const [symbol, setSymbol] = useState('NIFTY');
  const [customSymbol, setCustomSymbol] = useState('');
  const [expiryType, setExpiryType] = useState<'options' | 'futures'>('options');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [contracts, setContracts] = useState<any[]>([]);
  const [selectedContract, setSelectedContract] = useState<string>('');
  const [candles, setCandles] = useState<any[]>([]);
  const [isFetchingExpiries, setIsFetchingExpiries] = useState(false);
  const [isFetchingContracts, setIsFetchingContracts] = useState(false);
  const [isFetchingCandles, setIsFetchingCandles] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const activeSymbol = useMemo(() => {
    return symbol === 'CUSTOM' ? customSymbol.toUpperCase().trim() : symbol;
  }, [symbol, customSymbol]);

  // Load Expiries when activeSymbol changes
  const loadExpiries = async () => {
    if (!activeSymbol) return;
    setIsFetchingExpiries(true);
    setErrorMessage('');
    try {
      const response = await fetch(`/api/python-nse/api/upstox/expired/expiries?symbol=${activeSymbol}`);
      if (response.ok) {
        const data = await response.json();
        const list = data.expiries || [];
        setExpiries(list);
        if (list.length > 0) {
          setSelectedExpiry(list[0]);
        } else {
          setSelectedExpiry('');
          setContracts([]);
        }
      } else {
        setErrorMessage('Failed to fetch expired expiries.');
      }
    } catch (err) {
      setErrorMessage('Network error fetching expired expiries.');
    } finally {
      setIsFetchingExpiries(false);
    }
  };

  useEffect(() => {
    loadExpiries();
  }, [activeSymbol]);

  // Load contracts when selectedExpiry or expiryType changes
  const loadContracts = async () => {
    if (!activeSymbol || !selectedExpiry) return;
    setIsFetchingContracts(true);
    setErrorMessage('');
    try {
      const endpoint = expiryType === 'options' 
        ? `/api/python-nse/api/upstox/expired/option-contracts?symbol=${activeSymbol}&expiry=${selectedExpiry}`
        : `/api/python-nse/api/upstox/expired/future-contracts?symbol=${activeSymbol}&expiry=${selectedExpiry}`;
      
      const response = await fetch(endpoint);
      if (response.ok) {
        const data = await response.json();
        const list = data.contracts || [];
        setContracts(list);
        if (list.length > 0) {
          setSelectedContract(list[0].instrument_key);
        } else {
          setSelectedContract('');
        }
      } else {
        setErrorMessage('Failed to fetch expired contracts.');
      }
    } catch (err) {
      setErrorMessage('Network error fetching expired contracts.');
    } finally {
      setIsFetchingContracts(false);
    }
  };

  useEffect(() => {
    loadContracts();
  }, [activeSymbol, selectedExpiry, expiryType]);

  // Fetch expired historical candles
  const fetchExpiredCandles = async () => {
    if (!selectedContract) return;
    setIsFetchingCandles(true);
    setErrorMessage('');
    try {
      const response = await fetch(`/api/python-nse/api/upstox/expired/historical-candles?instrument_key=${selectedContract}&interval=day`);
      if (response.ok) {
        const data = await response.json();
        const candleList = data.candles || [];
        setCandles(candleList.map((c: any) => ({
          date: new Date(c[0]).toLocaleDateString(),
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5]
        })).reverse());
      } else {
        setErrorMessage('Failed to retrieve expired historical data.');
      }
    } catch (err) {
      setErrorMessage('Network error loading historical candles.');
    } finally {
      setIsFetchingCandles(false);
    }
  };

  useEffect(() => {
    fetchExpiredCandles();
  }, [selectedContract]);

  return (
    <div className="bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-800/60 backdrop-blur-md shadow-2xl relative overflow-hidden group mt-6">
      <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity">
        <Database size={160} className="text-indigo-500 -rotate-12 pointer-events-none" />
      </div>

      <div className="relative z-10 space-y-6">
        <div>
          <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter mb-2">Expired Contracts Radar (Backtesting)</h2>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">Analyze historical candles and expiries of expired F&O assets</p>
        </div>

        {errorMessage && (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs font-bold uppercase tracking-wide">
            <AlertCircle size={14} />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Symbol</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
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
                placeholder="e.g. SBIN"
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value)}
                className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
            )}
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Contract Type</label>
            <div className="flex bg-slate-950 border border-slate-800 p-1 rounded-xl">
              <button
                onClick={() => setExpiryType('options')}
                className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg tracking-wider transition-colors ${expiryType === 'options' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                Options
              </button>
              <button
                onClick={() => setExpiryType('futures')}
                className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg tracking-wider transition-colors ${expiryType === 'futures' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                Futures
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Expiry Date</label>
            <select
              value={selectedExpiry}
              onChange={(e) => setSelectedExpiry(e.target.value)}
              disabled={expiries.length === 0 || isFetchingExpiries}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-30"
            >
              {isFetchingExpiries ? (
                <option>Loading expiries...</option>
              ) : expiries.length === 0 ? (
                <option>No expiries found</option>
              ) : (
                expiries.map(exp => <option key={exp} value={exp}>{exp}</option>)
              )}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Contract</label>
            <select
              value={selectedContract}
              onChange={(e) => setSelectedContract(e.target.value)}
              disabled={contracts.length === 0 || isFetchingContracts}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-30"
            >
              {isFetchingContracts ? (
                <option>Loading contracts...</option>
              ) : contracts.length === 0 ? (
                <option>No contracts</option>
              ) : (
                contracts.map(c => (
                  <option key={c.instrument_key} value={c.instrument_key}>
                    {c.trading_symbol} {c.strike_price ? `(Strike: ${c.strike_price})` : ''}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Historical chart */}
        {candles.length > 0 ? (
          <div className="bg-slate-950/70 border border-slate-850 p-6 rounded-3xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-850 pb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <BarChart3 size={12} className="text-indigo-400" />
                Historical Expired Price Trend (Daily)
              </span>
              <button 
                onClick={fetchExpiredCandles} 
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                title="Refresh chart"
              >
                <RefreshCw size={12} className={isFetchingCandles ? 'animate-spin' : ''} />
              </button>
            </div>
            
            <div className="h-64 w-full">
              <SafeChartContainer>
                <AreaChart data={candles} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="expiredPain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
                  <YAxis stroke="#64748b" fontSize={9} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff', fontSize: '10px', borderRadius: '12px' }}
                    formatter={(value: any) => [`₹${value.toLocaleString()}`, 'Close Price']}
                  />
                  <Area type="monotone" dataKey="close" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#expiredPain)" />
                </AreaChart>
              </SafeChartContainer>
            </div>
          </div>
        ) : (
          <div className="text-center py-10 border border-dashed border-slate-800/80 bg-slate-950/20 rounded-3xl text-xs text-slate-500">
            {isFetchingCandles ? (
              <div className="flex flex-col items-center gap-2">
                <RefreshCw size={18} className="animate-spin text-indigo-500" />
                <span>Fetching expired chart candles...</span>
              </div>
            ) : (
              <span>Select an expired contract above to view the price trend.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
