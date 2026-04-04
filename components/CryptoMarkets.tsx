import React, { useState, useEffect, useCallback } from 'react';
import { SafeChartContainer } from './shared/SafeChartContainer';
import {
  Globe, TrendingUp, TrendingDown, RefreshCw, BarChart2,
  DollarSign, Activity, AlertCircle, ArrowUpRight, ArrowDownRight,
  ExternalLink, Layers, Search, ShieldAlert, Cpu
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

const EXCHANGES = [
  { id: 'binance', name: 'Binance', icon: '🟡' },
  { id: 'bybit', name: 'Bybit', icon: '🖤' },
  { id: 'okx', name: 'OKX', icon: '⬜' },
  { id: 'hyperliquid', name: 'Hyperliquid', icon: '💧' },
  { id: 'gateio', name: 'Gate.io', icon: '🔵' },
  { id: 'kucoin', name: 'KuCoin', icon: '🟢' },
  { id: 'kraken', name: 'Kraken', icon: '🐙' }
];

const POPULAR_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT', 'AVAX/USDT', 'BNB/USDT', 'NEAR/USDT'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

export const CryptoMarkets: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'exchanges' | 'polymarket'>('exchanges');
  const [selectedExchange, setSelectedExchange] = useState('binance');
  const [selectedSymbol, setSelectedSymbol] = useState('BTC/USDT');
  const [customSymbol, setCustomSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('1h');
  
  // State for exchange data
  const [ticker, setTicker] = useState<any>(null);
  const [ohlcvData, setOhlcvData] = useState<any[]>([]);
  const [orderbook, setOrderbook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });
  const [loadingTicker, setLoadingTicker] = useState(false);
  const [loadingOhlcv, setLoadingOhlcv] = useState(false);
  const [loadingOrderbook, setLoadingOrderbook] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State for Polymarket
  const [polyEvents, setPolyEvents] = useState<any[]>([]);
  const [loadingPoly, setLoadingPoly] = useState(false);
  const [polySearch, setPolySearch] = useState('');

  // Fetch Ticker
  const fetchTicker = useCallback(async () => {
    setLoadingTicker(true);
    setErrorMsg(null);
    try {
      const sym = customSymbol.trim() ? customSymbol.trim() : selectedSymbol;

      const res = await fetch(`/api/ccxt/ticker/${selectedExchange}/${encodeURIComponent(sym)}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to fetch ticker');
      }
      const data = await res.json();
      setTicker(data);
    } catch (err: any) {
      setErrorMsg(err.message);
      setTicker(null);
    } finally {
      setLoadingTicker(false);
    }
  }, [selectedExchange, selectedSymbol, customSymbol]);

  // Fetch OHLCV
  const fetchOhlcv = useCallback(async () => {
    setLoadingOhlcv(true);
    try {
      const sym = customSymbol.trim() ? customSymbol.trim() : selectedSymbol;
      const res = await fetch(`/api/ccxt/ohlcv/${selectedExchange}/${encodeURIComponent(sym)}?timeframe=${timeframe}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setOhlcvData(data.data || []);
      }
    } catch (err) {
      console.error('Error fetching OHLCV:', err);
    } finally {
      setLoadingOhlcv(false);
    }
  }, [selectedExchange, selectedSymbol, customSymbol, timeframe]);

  // Fetch Orderbook
  const fetchOrderbook = useCallback(async () => {
    setLoadingOrderbook(true);
    try {
      const sym = customSymbol.trim() ? customSymbol.trim() : selectedSymbol;
      const res = await fetch(`/api/ccxt/orderbook/${selectedExchange}/${encodeURIComponent(sym)}?depth=10`);
      if (res.ok) {
        const data = await res.json();
        setOrderbook({ bids: data.bids || [], asks: data.asks || [] });
      }
    } catch (err) {
      console.error('Error fetching orderbook:', err);
    } finally {
      setLoadingOrderbook(false);
    }
  }, [selectedExchange, selectedSymbol, customSymbol]);

  // Fetch Polymarket
  const fetchPolymarket = useCallback(async () => {
    setLoadingPoly(true);
    try {
      const res = await fetch('/api/ccxt/polymarket/markets?limit=30');
      if (res.ok) {
        const data = await res.json();
        setPolyEvents(data.markets || []);
      }
    } catch (err) {
      console.error('Error fetching Polymarket data:', err);
    } finally {
      setLoadingPoly(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'exchanges') {
      fetchTicker();
      fetchOhlcv();
      fetchOrderbook();
    } else {
      fetchPolymarket();
    }
  }, [activeTab, fetchTicker, fetchOhlcv, fetchOrderbook, fetchPolymarket]);

  const handleRefreshAll = () => {
    if (activeTab === 'exchanges') {
      fetchTicker();
      fetchOhlcv();
      fetchOrderbook();
    } else {
      fetchPolymarket();
    }
  };

  const filteredPoly = polyEvents.filter(e => 
    (e.question || '').toLowerCase().includes(polySearch.toLowerCase()) ||
    (e.category || '').toLowerCase().includes(polySearch.toLowerCase())
  );

  return (
    <div className="p-6 bg-slate-950 text-slate-100 min-h-screen space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-cyan-400">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Universal Crypto & Prediction Markets
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/40">
                  CCXT Gateway v4.0
                </span>
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Unified live market data across 103+ crypto exchanges & Polymarket prediction CLOB
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Navigation Tabs */}
          <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex">
            <button
              onClick={() => setActiveTab('exchanges')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'exchanges'
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <Cpu className="w-4 h-4" /> Crypto Exchanges
              </span>
            </button>
            <button
              onClick={() => setActiveTab('polymarket')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'polymarket'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <Activity className="w-4 h-4" /> Polymarket Predictions
              </span>
            </button>
          </div>

          <button
            onClick={handleRefreshAll}
            className="p-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loadingTicker || loadingPoly ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {activeTab === 'exchanges' ? (
        <>
          {/* Exchange & Symbol Control Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-900/80 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            {/* Exchange Picker */}
            <div className="lg:col-span-4 space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Select Exchange</label>
              <div className="flex flex-wrap gap-1.5">
                {EXCHANGES.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => { setSelectedExchange(ex.id); setCustomSymbol(''); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                      selectedExchange === ex.id
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span>{ex.icon}</span>
                    <span>{ex.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Symbol Picker */}
            <div className="lg:col-span-5 space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Symbol</label>
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_SYMBOLS.map((sym) => (
                  <button
                    key={sym}
                    onClick={() => { setSelectedSymbol(sym); setCustomSymbol(''); }}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium border transition-all ${
                      selectedSymbol === sym && !customSymbol
                        ? 'bg-slate-800 border-cyan-400 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Symbol Search */}
            <div className="lg:col-span-3 space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Custom Pair</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="e.g. SOL/USDT"
                  value={customSymbol}
                  onChange={(e) => setCustomSymbol(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-sm flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Ticker Cards Banner */}
          {ticker && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 block font-medium">Last Price</span>
                <span className="text-xl font-bold font-mono text-white mt-1 block">
                  ${ticker.last?.toLocaleString() || 'N/A'}
                </span>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 block font-medium">24h Change</span>
                <span className={`text-xl font-bold font-mono mt-1 flex items-center gap-1 ${
                  (ticker.change_24h || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {(ticker.change_24h || 0) >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  {ticker.change_24h ? `${ticker.change_24h.toFixed(2)}%` : '0.00%'}
                </span>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 block font-medium">24h High</span>
                <span className="text-lg font-bold font-mono text-slate-200 mt-1 block">
                  ${ticker.high?.toLocaleString() || 'N/A'}
                </span>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 block font-medium">24h Low</span>
                <span className="text-lg font-bold font-mono text-slate-200 mt-1 block">
                  ${ticker.low?.toLocaleString() || 'N/A'}
                </span>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 block font-medium">Bid / Ask</span>
                <span className="text-xs font-mono text-slate-300 mt-1 block">
                  <span className="text-emerald-400">${ticker.bid || 'N/A'}</span> / <span className="text-rose-400">${ticker.ask || 'N/A'}</span>
                </span>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 block font-medium">24h Volume</span>
                <span className="text-sm font-bold font-mono text-slate-300 mt-1 block">
                  {ticker.volume ? ticker.volume.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'N/A'}
                </span>
              </div>
            </div>
          )}

          {/* Main Chart + Orderbook Section */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Candlestick Area Chart (8 cols) */}
            <div className="lg:col-span-8 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-cyan-400" />
                  Price History ({selectedSymbol})
                </h3>

                {/* Timeframe selector */}
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                        timeframe === tf ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recharts Area Chart */}
              <div className="h-[320px] w-full pt-2">
                {loadingOhlcv ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading Chart...
                  </div>
                ) : ohlcvData.length > 0 ? (
                  <SafeChartContainer>
                    <AreaChart data={ohlcvData}>
                      <defs>
                        <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        stroke="#64748b"
                        fontSize={11}
                      />
                      <YAxis
                        domain={['auto', 'auto']}
                        stroke="#64748b"
                        fontSize={11}
                        orientation="right"
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                        labelFormatter={(ts) => new Date(ts).toLocaleString()}
                        formatter={(val: any) => [`$${Number(val).toLocaleString()}`, 'Close Price']}
                      />
                      <Area type="monotone" dataKey="close" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill="url(#colorClose)" />
                    </AreaChart>
                  </SafeChartContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                    No OHLCV chart data available for this timeframe
                  </div>
                )}
              </div>
            </div>

            {/* Orderbook Depth View (4 cols) */}
            <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-4">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                Live Orderbook ({selectedExchange.toUpperCase()})
              </h3>

              {loadingOrderbook ? (
                <div className="h-[300px] flex items-center justify-center text-slate-500 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading Book...
                </div>
              ) : (
                <div className="space-y-4 text-xs font-mono">
                  {/* Asks (Sells) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-slate-500 text-[10px] uppercase font-bold border-b border-slate-800 pb-1">
                      <span>Ask Price</span>
                      <span>Amount</span>
                    </div>
                    {orderbook.asks.slice(0, 7).reverse().map((ask: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center py-0.5 text-rose-400 hover:bg-rose-950/20 px-1 rounded">
                        <span>${Number(ask[0]).toLocaleString()}</span>
                        <span className="text-slate-400">{Number(ask[1]).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Spread Indicator */}
                  {ticker && (
                    <div className="py-2 bg-slate-950 border-y border-slate-800 text-center font-bold text-slate-200">
                      ${ticker.last?.toLocaleString()}
                    </div>
                  )}

                  {/* Bids (Buys) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-slate-500 text-[10px] uppercase font-bold border-b border-slate-800 pb-1">
                      <span>Bid Price</span>
                      <span>Amount</span>
                    </div>
                    {orderbook.bids.slice(0, 7).map((bid: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center py-0.5 text-emerald-400 hover:bg-emerald-950/20 px-1 rounded">
                        <span>${Number(bid[0]).toLocaleString()}</span>
                        <span className="text-slate-400">{Number(bid[1]).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Polymarket Prediction Tab */
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
              <input
                type="text"
                placeholder="Search prediction markets (e.g. Fed rates, Bitcoin, Elections)..."
                value={polySearch}
                onChange={(e) => setPolySearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
              Live Polygon CLOB Odds
            </div>
          </div>

          {loadingPoly ? (
            <div className="p-12 text-center text-slate-500 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-400" />
              <p>Fetching prediction markets from Polymarket CLOB...</p>
            </div>
          ) : filteredPoly.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredPoly.map((event: any, idx: number) => {
                const question = event.question || event.title || 'Prediction Market';
                const category = event.category || 'General';
                const prices = event.outcomePrices ? JSON.parse(typeof event.outcomePrices === 'string' ? event.outcomePrices : JSON.stringify(event.outcomePrices)) : [0.5, 0.5];
                const yesPrice = prices[0] ? (Number(prices[0]) * 100).toFixed(1) : '50.0';
                const noPrice = prices[1] ? (Number(prices[1]) * 100).toFixed(1) : '50.0';

                return (
                  <div key={event.id || idx} className="bg-slate-900/90 border border-slate-800 hover:border-purple-500/50 p-5 rounded-2xl space-y-4 transition-all flex flex-col justify-between group">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          {category}
                        </span>
                        {event.volume && (
                          <span className="text-xs text-slate-400 font-mono">
                            Vol: ${Number(event.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-semibold text-slate-100 group-hover:text-purple-300 transition-colors line-clamp-2">
                        {question}
                      </h4>
                    </div>

                    <div className="space-y-3 pt-2">
                      {/* Probability Gauge Bar */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs font-mono font-semibold">
                          <span className="text-emerald-400">YES {yesPrice}%</span>
                          <span className="text-rose-400">NO {noPrice}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-rose-950 rounded-full overflow-hidden flex">
                          <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${yesPrice}%` }}></div>
                        </div>
                      </div>

                      {/* Action Link */}
                      <a
                        href={`https://polymarket.com/event/${event.slug || ''}`}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full py-2 bg-slate-950 hover:bg-purple-950/40 border border-slate-800 hover:border-purple-500/50 rounded-xl text-xs font-medium text-purple-300 flex items-center justify-center gap-1.5 transition-colors"
                      >
                        Trade on Polymarket <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-slate-500 border border-slate-800 rounded-2xl bg-slate-900/50">
              No prediction markets found matching your search
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default CryptoMarkets;
