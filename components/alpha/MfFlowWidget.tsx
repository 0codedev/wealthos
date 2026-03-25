import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Search, 
  RefreshCw, 
  AlertCircle, 
  Database,
  Building2,
  DollarSign,
  TrendingUp as BuyIcon,
  TrendingDown as SellIcon,
  ArrowRightLeft,
  FileText
} from 'lucide-react';
import { pnseaService, MfInsiderTransaction } from '../../services/PnseaService';
import { openTradingView } from '../../utils/navigation';
import { formatINR, formatQuantity } from '../../utils/indianFormatter';

export const MfFlowWidget: React.FC = () => {
  const [mfData, setMfData] = useState<MfInsiderTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'aggregated' | 'transactions'>('aggregated');
  
  // Sorting for aggregated view
  const [aggSortAsc, setAggSortAsc] = useState(false);

  // Sorting for transaction log
  const [txSortField, setTxSortField] = useState<keyof MfInsiderTransaction>('date');
  const [txSortAsc, setTxSortAsc] = useState(false);

  const fetchMfFlows = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      // General MF Flows (no symbol filter)
      const data = await pnseaService.fetchMfInsider(undefined, undefined, force);
      setMfData(data || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to fetch Mutual Fund insider flows');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMfFlows();
  }, []);

  // Aggregated data: Group MF transactions by stock symbol
  const aggregatedData = useMemo(() => {
    const symbolMap: { [symbol: string]: { buys: number; sells: number; buyQty: number; sellQty: number } } = {};

    mfData.forEach(tx => {
      const sym = tx.symbol.toUpperCase();
      if (!symbolMap[sym]) {
        symbolMap[sym] = { buys: 0, sells: 0, buyQty: 0, sellQty: 0 };
      }

      const isBuy = tx.buy_sell?.toLowerCase() === 'buy';
      const val = tx.value || 0;
      const qty = tx.qty || 0;

      if (isBuy) {
        symbolMap[sym].buys += val;
        symbolMap[sym].buyQty += qty;
      } else {
        symbolMap[sym].sells += val;
        symbolMap[sym].sellQty += qty;
      }
    });

    const result = Object.keys(symbolMap).map(symbol => {
      const { buys, sells, buyQty, sellQty } = symbolMap[symbol];
      const net = buys - sells;
      return {
        symbol,
        buys,
        sells,
        net,
        buyQty,
        sellQty
      };
    });

    // Filter by search term
    let filtered = result;
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toUpperCase();
      filtered = filtered.filter(item => item.symbol.includes(term));
    }

    // Default sorting: highest absolute net flow first (highest buy/sell conviction)
    filtered.sort((a, b) => {
      const diff = b.net - a.net;
      return aggSortAsc ? -diff : diff;
    });

    return filtered;
  }, [mfData, searchTerm, aggSortAsc]);

  // Filtered raw transactions
  const filteredTransactions = useMemo(() => {
    let result = [...mfData];

    // Filter
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toUpperCase();
      result = result.filter(
        tx => 
          tx.symbol.toUpperCase().includes(term) || 
          tx.scheme_name?.toUpperCase().includes(term) ||
          tx.isin?.toUpperCase().includes(term)
      );
    }

    // Sort
    result.sort((a, b) => {
      let aVal = a[txSortField];
      let bVal = b[txSortField];

      if (typeof aVal === 'string') {
        aVal = (aVal as string).toUpperCase();
        bVal = (bVal as string).toUpperCase();
      }

      if (aVal === bVal) return 0;

      const comparison = (aVal ?? 0) > (bVal ?? 0) ? 1 : -1;
      return txSortAsc ? comparison : -comparison;
    });

    return result;
  }, [mfData, searchTerm, txSortField, txSortAsc]);

  const handleTxSort = (field: keyof MfInsiderTransaction) => {
    if (txSortField === field) {
      setTxSortAsc(!txSortAsc);
    } else {
      setTxSortField(field);
      setTxSortAsc(false);
    }
  };

  // Top level summary cards
  const summary = useMemo(() => {
    let totalBuys = 0;
    let totalSells = 0;
    const activeSchemes = new Set<string>();

    mfData.forEach(tx => {
      const isBuy = tx.buy_sell?.toLowerCase() === 'buy';
      const val = tx.value || 0;
      if (isBuy) {
        totalBuys += val;
      } else {
        totalSells += val;
      }
      if (tx.scheme_name) {
        activeSchemes.add(tx.scheme_name);
      }
    });

    return {
      totalBuys,
      totalSells,
      netFlow: totalBuys - totalSells,
      uniqueSchemes: activeSchemes.size
    };
  }, [mfData]);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 blur-3xl rounded-full" />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <DollarSign size={12} className="text-emerald-400" />
            Total MF Buying
          </span>
          <div className="flex items-baseline gap-2 mt-4">
            <span className="text-3xl font-black text-emerald-400">{formatINR(summary.totalBuys, { compact: true })}</span>
          </div>
          <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
            Total buy transactions (Past 7 Days)
          </p>
        </div>

        <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-rose-500/5 blur-3xl rounded-full" />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <DollarSign size={12} className="text-rose-400" />
            Total MF Selling
          </span>
          <div className="flex items-baseline gap-2 mt-4">
            <span className="text-3xl font-black text-rose-400">{formatINR(summary.totalSells, { compact: true })}</span>
          </div>
          <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
            Total sell transactions (Past 7 Days)
          </p>
        </div>

        <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6 relative overflow-hidden">
          <div className={`absolute top-0 right-0 w-20 h-20 blur-3xl rounded-full ${
            summary.netFlow >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10'
          }`} />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <ArrowRightLeft size={12} className={summary.netFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
            Net Smart Flow
          </span>
          <div className="flex items-baseline gap-2 mt-4">
            <span className={`text-3xl font-black ${
              summary.netFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {summary.netFlow >= 0 ? '+' : ''}{formatINR(summary.netFlow, { compact: true })}
            </span>
          </div>
          <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
            Net institutional mutual fund balance
          </p>
        </div>

        <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <Building2 size={12} className="text-indigo-400" />
            Active MF Schemes
          </span>
          <div className="flex items-baseline gap-2 mt-4">
            <span className="text-3xl font-black text-white">{summary.uniqueSchemes}</span>
            <span className="text-xs font-bold text-slate-500 uppercase">reporting</span>
          </div>
          <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
            Unique mutual fund schemes tracked
          </p>
        </div>
      </div>

      {/* Control panel and filters */}
      <div className="flex flex-col lg:flex-row gap-4 items-center justify-between bg-slate-900/30 p-6 rounded-3xl border border-slate-800/40">
        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-850">
          <button
            onClick={() => setViewMode('aggregated')}
            className={`px-4 py-2 rounded-lg text-xs font-black tracking-wider transition-all uppercase flex items-center gap-1.5 ${
              viewMode === 'aggregated'
                ? 'bg-indigo-650 text-white shadow-lg shadow-indigo-650/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 size={12} /> Stock Confluence Aggregation
          </button>
          <button
            onClick={() => setViewMode('transactions')}
            className={`px-4 py-2 rounded-lg text-xs font-black tracking-wider transition-all uppercase flex items-center gap-1.5 ${
              viewMode === 'transactions'
                ? 'bg-indigo-650 text-white shadow-lg shadow-indigo-650/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText size={12} /> Live Transaction Log
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
          <div className="relative w-full sm:w-80 group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors">
              <Search size={14} />
            </div>
            <input 
              type="text"
              placeholder={viewMode === 'aggregated' ? 'Search by stock symbol...' : 'Search symbol, scheme or ISIN...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800/80 rounded-2xl py-2 pl-10 pr-6 text-xs text-slate-200 placeholder:text-slate-650 outline-none focus:border-indigo-500/50 transition-all font-bold"
            />
          </div>

          <button
            onClick={() => fetchMfFlows(true)}
            disabled={loading}
            className="w-full sm:w-auto px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Bypass & Reload
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-rose-500/5 border border-rose-500/10 rounded-2xl text-rose-300 text-xs font-bold">
          <AlertCircle size={16} className="text-rose-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content Grid */}
      {loading ? (
        <div className="min-h-[350px] flex flex-col items-center justify-center space-y-6 bg-slate-900/10 border border-slate-800/30 rounded-3xl">
          <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin shadow-[0_0_40px_rgba(99,102,241,0.15)]"></div>
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest animate-pulse">Syncing Mutual Fund Intelligence...</h3>
        </div>
      ) : mfData.length === 0 ? (
        <div className="min-h-[300px] flex flex-col items-center justify-center bg-slate-900/10 border border-slate-800/40 rounded-3xl p-12 text-center">
          <Database className="w-12 h-12 text-slate-700 mb-6 animate-pulse" />
          <h3 className="text-xl font-bold text-slate-400 mb-2 uppercase tracking-widest">No Mutual Fund Data</h3>
          <p className="text-slate-650 text-sm max-w-sm">No transaction records compiled for the last 7 days. Check the Python bridge connection status.</p>
        </div>
      ) : viewMode === 'aggregated' ? (
        // Aggregated view
        <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-800/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white tracking-tight uppercase">Net Mutual Fund Flows by Stock</h3>
            <button
              onClick={() => setAggSortAsc(!aggSortAsc)}
              className="text-[10px] font-black uppercase text-indigo-400 hover:text-indigo-300 transition-colors border border-indigo-500/20 bg-indigo-500/5 px-2.5 py-1.5 rounded-lg"
            >
              Sort Order: {aggSortAsc ? 'Highest Selling First' : 'Highest Buying First'}
            </button>
          </div>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-slate-950/40 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/40 select-none sticky top-0 z-10">
                  <th className="py-4 pl-6">Stock Symbol</th>
                  <th className="py-4 text-right">Total MF Buying</th>
                  <th className="py-4 text-right">Total MF Selling</th>
                  <th className="py-4 text-right">Net Smart Flow</th>
                  <th className="py-4 text-right">Buys Qty</th>
                  <th className="py-4 text-right">Sells Qty</th>
                  <th className="py-4 text-center pr-6">Charts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30">
                {aggregatedData.map((item, index) => {
                  const isPositive = item.net >= 0;
                  return (
                    <tr 
                      key={item.symbol + index} 
                      className={`hover:bg-slate-800/20 transition-all ${
                        isPositive 
                          ? 'bg-emerald-500/2 hover:bg-emerald-500/5' 
                          : 'bg-rose-500/2 hover:bg-rose-500/5'
                      }`}
                    >
                      <td className="py-3.5 pl-6 font-black text-indigo-400 text-xs">
                        {item.symbol}
                      </td>
                      <td className="py-3.5 text-right font-bold text-emerald-400 font-mono text-xs">
                        {formatINR(item.buys, { compact: true })}
                      </td>
                      <td className="py-3.5 text-right font-bold text-rose-400 font-mono text-xs">
                        {formatINR(item.sells, { compact: true })}
                      </td>
                      <td className={`py-3.5 text-right font-black font-mono text-xs ${
                        isPositive ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {isPositive ? '+' : ''}{formatINR(item.net, { compact: true })}
                      </td>
                      <td className="py-3.5 text-right text-xs font-mono font-bold text-slate-400">
                        {formatQuantity(item.buyQty)}
                      </td>
                      <td className="py-3.5 text-right text-xs font-mono font-bold text-slate-400">
                        {formatQuantity(item.sellQty)}
                      </td>
                      <td className="py-3.5 text-center pr-6">
                        <button
                          onClick={() => openTradingView(item.symbol)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700/50 transition-all inline-flex items-center gap-1.5"
                          title="Open TradingView Chart"
                        >
                          <TrendingUp size={12} className="text-indigo-400" />
                          <span className="text-[9px] font-black uppercase tracking-wider">Chart</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        // Raw transaction log
        <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl overflow-hidden flex flex-col">
          <div className="overflow-x-auto no-scrollbar max-h-[500px]">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-slate-950/40 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/40 select-none sticky top-0 z-10">
                  <th className="py-4 pl-6 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleTxSort('date')}>
                    Date {txSortField === 'date' && (txSortAsc ? '▲' : '▼')}
                  </th>
                  <th className="py-4 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleTxSort('symbol')}>
                    Symbol {txSortField === 'symbol' && (txSortAsc ? '▲' : '▼')}
                  </th>
                  <th className="py-4 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleTxSort('scheme_name')}>
                    MF Scheme {txSortField === 'scheme_name' && (txSortAsc ? '▲' : '▼')}
                  </th>
                  <th className="py-4 text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleTxSort('buy_sell')}>
                    Action {txSortField === 'buy_sell' && (txSortAsc ? '▲' : '▼')}
                  </th>
                  <th className="py-4 text-right cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleTxSort('qty')}>
                    Quantity {txSortField === 'qty' && (txSortAsc ? '▲' : '▼')}
                  </th>
                  <th className="py-4 text-right cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleTxSort('value')}>
                    Deal Value {txSortField === 'value' && (txSortAsc ? '▲' : '▼')}
                  </th>
                  <th className="py-4 text-center pr-6">ISIN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30">
                {filteredTransactions.map((tx, index) => {
                  const isBuy = tx.buy_sell?.toLowerCase() === 'buy';
                  return (
                    <tr 
                      key={(tx.id || index) + '-' + index} 
                      className={`hover:bg-slate-800/20 transition-all ${
                        isBuy 
                          ? 'bg-emerald-500/2 hover:bg-emerald-500/5' 
                          : 'bg-rose-500/2 hover:bg-rose-500/5'
                      }`}
                    >
                      <td className="py-3.5 pl-6 font-bold text-slate-400 font-mono text-xs">
                        {tx.date}
                      </td>
                      <td className="py-3.5 font-black text-indigo-400 text-xs">
                        {tx.symbol}
                      </td>
                      <td className="py-3.5 font-bold text-slate-200 text-xs max-w-xs truncate" title={tx.scheme_name}>
                        {tx.scheme_name}
                      </td>
                      <td className="py-3.5 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase border ${
                          isBuy 
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                            : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                        }`}>
                          {isBuy ? <BuyIcon size={10} /> : <SellIcon size={10} />}
                          {tx.buy_sell}
                        </span>
                      </td>
                      <td className="py-3.5 text-right font-bold text-slate-300 font-mono text-xs">
                        {formatQuantity(tx.qty)}
                      </td>
                      <td className={`py-3.5 text-right font-black font-mono text-xs ${
                        isBuy ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {formatINR(tx.value)}
                      </td>
                      <td className="py-3.5 text-center font-mono text-[10px] text-slate-500 pr-6">
                        {tx.isin || 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
