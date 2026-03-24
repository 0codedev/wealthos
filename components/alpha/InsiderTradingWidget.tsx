import React, { useState, useEffect, useMemo } from 'react';
import { formatCurrency, formatNumberIndian } from '../../utils/helpers';
import { 
  TrendingUp, 
  TrendingDown, 
  Search, 
  Users, 
  ShieldAlert, 
  ShieldCheck, 
  PieChart, 
  Activity, 
  RefreshCw, 
  AlertCircle,
  Database,
  Building2,
  DollarSign
} from 'lucide-react';
import { 
  pnseaService, 
  InsiderTransaction, 
  PledgedData, 
  MfInsiderTransaction 
} from '../../services/PnseaService';
import { Tabs } from '../ui/AnimatedTabs';

export const InsiderTradingWidget: React.FC = () => {
  const [symbol, setSymbol] = useState('SBIN');
  const [searchInput, setSearchInput] = useState('SBIN');
  
  const [insiderData, setInsiderData] = useState<InsiderTransaction[]>([]);
  const [pledgedData, setPledgedData] = useState<PledgedData | null>(null);
  const [mfData, setMfData] = useState<MfInsiderTransaction[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'insider' | 'pledged' | 'mf'>('insider');

  // Quick pick symbols
  const quickSymbols = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'ITC', 'LT', 'BHARTIARTL', 'AXISBANK'];

  const fetchGovernanceData = async (targetSymbol: string) => {
    setLoading(true);
    setError(null);
    try {
      // Calculate a wide date range for insider transactions (last 6 months)
      const toDate = new Date().toISOString().split('T')[0];
      const fromDateObj = new Date();
      fromDateObj.setDate(fromDateObj.getDate() - 180);
      const fromDate = fromDateObj.toISOString().split('T')[0];

      const [insiderRes, pledgedRes, mfRes] = await Promise.all([
        pnseaService.fetchInsiderTrading(targetSymbol, fromDate, toDate),
        pnseaService.fetchPledgedShares(targetSymbol),
        pnseaService.fetchMfInsider(targetSymbol)
      ]);

      // Process and sort Insider Data by Date (most recent first)
      if (insiderRes && insiderRes.length > 0) {
        const sortedInsider = [...insiderRes].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setInsiderData(sortedInsider);
      } else {
        setInsiderData([]);
      }

      // Process Pledged Data
      setPledgedData(pledgedRes);

      // Process Mutual Fund Flows
      if (mfRes && mfRes.length > 0) {
        const sortedMf = [...mfRes].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setMfData(sortedMf);
      } else {
        setMfData([]);
      }

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGovernanceData(symbol);
  }, [symbol]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setSymbol(searchInput.trim().toUpperCase());
    }
  };

  // Helper formatting for big rupee values
  const formatCurrency = (val: number) => {
    if (!val) return '₹0';
    if (val >= 10000000) {
      return `₹${(val / 10000000).toFixed(2)} Cr`;
    }
    if (val >= 100000) {
      return `₹${(val / 100000).toFixed(2)} Lk`;
    }
    return `₹${formatNumberIndian(val)}`;
  };

  // Helper formatting for big counts
  const formatQty = (val: number) => {
    if (!val) return '0';
    if (val >= 1000000) {
      return `${(val / 1000000).toFixed(2)}M`;
    }
    return formatNumberIndian(val);
  };

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    // Insider metrics
    const netInsiderVal = insiderData.reduce((acc, curr) => {
      const isBuy = curr.action?.toLowerCase() === 'buy' || curr.trans_type?.toLowerCase().includes('acq');
      const val = curr.sec_val || 0;
      return isBuy ? acc + val : acc - val;
    }, 0);

    const promoterBuys = insiderData.filter(
      d => d.action?.toLowerCase() === 'buy' || d.trans_type?.toLowerCase().includes('acq')
    ).length;

    const promoterSells = insiderData.filter(
      d => d.action?.toLowerCase() === 'sell' || d.trans_type?.toLowerCase().includes('disp')
    ).length;

    // MF flows metrics
    const netMfVal = mfData.reduce((acc, curr) => {
      const isBuy = curr.buy_sell?.toLowerCase() === 'buy';
      const val = curr.value || 0;
      return isBuy ? acc + val : acc - val;
    }, 0);

    return {
      netInsiderVal,
      promoterBuys,
      promoterSells,
      netMfVal
    };
  }, [insiderData, mfData]);

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
            placeholder="Search Corporate Governance (e.g. SBIN, RELIANCE)..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800/80 rounded-2xl py-2.5 pl-12 pr-24 text-sm text-slate-200 placeholder:text-slate-650 outline-none focus:border-indigo-500/50 transition-all font-bold"
          />
          <button 
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-black uppercase tracking-wider rounded-xl border border-slate-700/50 transition-all"
          >
            Query
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
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest animate-pulse">Retrieving Governance Intelligence...</h3>
        </div>
      ) : error ? (
        <div className="min-h-[250px] flex flex-col items-center justify-center p-8 bg-rose-500/5 border border-rose-500/10 rounded-3xl text-center">
          <AlertCircle className="w-12 h-12 text-rose-500/80 mb-4 animate-bounce" />
          <h4 className="text-base font-black text-slate-200 uppercase tracking-tight">Governance Intelligence Sync Error</h4>
          <p className="text-xs text-rose-300 max-w-md mt-2 leading-relaxed">
            {error}
          </p>
          <div className="mt-6 flex gap-4">
            <button 
              onClick={() => fetchGovernanceData(symbol)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-880 border border-slate-800 text-slate-300 text-xs font-bold rounded-xl transition-all flex items-center gap-2"
            >
              <RefreshCw size={12} /> Retry Fetch
            </button>
            <div className="text-[10px] text-slate-500 border border-slate-800 rounded-xl px-4 py-2 bg-slate-950/20 flex items-center justify-center">
              💡 Ensure the Python Bridge FastAPI server is active.
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* STATS OVERVIEW TILES */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Tile 1: Net Promoter Buying */}
            <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6 relative overflow-hidden">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-3">Net Promoter Activity (6M)</span>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-black ${
                  summaryMetrics.netInsiderVal > 0 ? 'text-emerald-400' : summaryMetrics.netInsiderVal < 0 ? 'text-rose-400' : 'text-slate-200'
                }`}>
                  {summaryMetrics.netInsiderVal > 0 ? '+' : ''}{formatCurrency(summaryMetrics.netInsiderVal)}
                </span>
              </div>
              <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
                {summaryMetrics.promoterBuys} Buys // {summaryMetrics.promoterSells} Sells registered
              </p>
            </div>

            {/* Tile 2: Pledging Vector */}
            <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6 relative overflow-hidden">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-3">Promoter Pledge Status</span>
              <div className="flex items-baseline gap-2">
                {pledgedData ? (
                  <>
                    <span className={`text-3xl font-black ${
                      pledgedData.pledged_pct > 50 ? 'text-rose-400 animate-pulse' : pledgedData.pledged_pct > 15 ? 'text-amber-400' : 'text-emerald-400'
                    }`}>
                      {pledgedData.pledged_pct.toFixed(2)}%
                    </span>
                    <span className="text-xs font-bold text-slate-500 uppercase">pledged</span>
                  </>
                ) : (
                  <span className="text-xl font-black text-slate-400">NO PLEDGED DATA</span>
                )}
              </div>
              <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
                {pledgedData ? `Pledged: ${formatQty(pledgedData.pledged_shares)} of ${formatQty(pledgedData.promoter_shares)} shares` : 'Promoter stake has zero pledges recorded'}
              </p>
            </div>

            {/* Tile 3: Mutual Fund Flows */}
            <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6 relative overflow-hidden">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-3">Mutual Fund Net Flow</span>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-black ${
                  summaryMetrics.netMfVal > 0 ? 'text-emerald-400' : summaryMetrics.netMfVal < 0 ? 'text-rose-400' : 'text-slate-200'
                }`}>
                  {summaryMetrics.netMfVal > 0 ? '+' : ''}{formatCurrency(summaryMetrics.netMfVal)}
                </span>
              </div>
              <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wider">
                Institutional smart money inflow vector
              </p>
            </div>
          </div>

          {/* HIGH PLEDGED WARNING BANNER */}
          {pledgedData && pledgedData.pledged_pct > 50 && (
            <div className="bg-rose-500/10 border border-rose-500/25 p-4 rounded-2xl flex items-start gap-3">
              <ShieldAlert className="text-rose-400 shrink-0 mt-0.5" size={18} />
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-rose-300">Severe Promoter Pledge Alert</h4>
                <p className="text-[11px] text-rose-200/80 leading-relaxed mt-1">
                  Over 50% of the promoter stake in this company is currently pledged ({pledgedData.pledged_pct.toFixed(1)}%). 
                  This presents an elevated risk of margin call liquidation during market corrections, which can result in abrupt sell-offs. Exercise absolute caution.
                </p>
              </div>
            </div>
          )}

          {/* TAB SYSTEM */}
          <div className="bg-slate-900/20 border border-slate-800/50 rounded-3xl overflow-hidden flex flex-col">
            <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800/50 p-6 gap-4">
              <Tabs.Root
                value={activeSubTab}
                onChange={(val) => setActiveSubTab(val as 'insider' | 'pledged' | 'mf')}
                variant="solid-indigo"
                layoutId="insider-trading-subtabs"
                motionPreset="spring"
              >
                <Tabs.List className="bg-slate-900/50 p-1 rounded-xl border border-slate-800">
                  <Tabs.Trigger value="insider" className="px-4 py-2 text-xs font-black uppercase tracking-wider">
                    Promoter Deals ({insiderData.length})
                  </Tabs.Trigger>
                  <Tabs.Trigger value="pledged" className="px-4 py-2 text-xs font-black uppercase tracking-wider">
                    Pledge Vectors
                  </Tabs.Trigger>
                  <Tabs.Trigger value="mf" className="px-4 py-2 text-xs font-black uppercase tracking-wider">
                    MF Smart Money ({mfData.length})
                  </Tabs.Trigger>
                </Tabs.List>
              </Tabs.Root>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                SQLite Cached • PNSEA Stealth Stream
              </span>
            </div>

            {/* TAB 1: INSIDER TRANSACTIONS */}
            {activeSubTab === 'insider' && (
              <div className="overflow-x-auto max-h-[380px] no-scrollbar">
                {insiderData.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
                    No promoter insider transactions found in the last 180 days.
                  </div>
                ) : (
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead>
                      <tr className="bg-slate-950/40 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/40 select-none sticky top-0 z-10">
                        <th className="py-3.5 pl-6">Acquirer / Insider Name</th>
                        <th className="py-3.5">Action</th>
                        <th className="py-3.5 text-right">Value (₹)</th>
                        <th className="py-3.5 text-right">Quantity</th>
                        <th className="py-3.5 text-right">Post Stake %</th>
                        <th className="py-3.5 text-right pr-6">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/30">
                      {insiderData.map((tx, idx) => {
                        const isBuy = tx.action?.toLowerCase() === 'buy' || tx.trans_type?.toLowerCase().includes('acq');
                        return (
                          <tr key={idx} className="hover:bg-slate-800/20 transition-all">
                            <td className="py-3.5 pl-6 font-bold text-slate-200 text-xs max-w-xs truncate" title={tx.acquirer_name}>
                              {tx.acquirer_name}
                            </td>
                            <td className="py-3.5 text-xs">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${
                                isBuy 
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}>
                                {isBuy ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                {tx.action || (isBuy ? 'Buy' : 'Sell')}
                              </span>
                            </td>
                            <td className={`py-3.5 text-right font-black text-xs font-mono ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {formatCurrency(tx.sec_val)}
                            </td>
                            <td className="py-3.5 text-right text-xs font-mono font-bold text-slate-300">
                              {formatQty(tx.qty)}
                            </td>
                            <td className="py-3.5 text-right text-xs font-mono font-bold text-slate-300">
                              {tx.post_pct ? `${tx.post_pct.toFixed(3)}%` : 'N/A'}
                            </td>
                            <td className="py-3.5 text-right text-xs font-mono text-slate-400 pr-6">
                              {tx.date}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* TAB 2: PLEDGED SHARES DETAILS */}
            {activeSubTab === 'pledged' && (
              <div className="p-6">
                {!pledgedData ? (
                  <div className="text-center text-slate-500 text-xs font-bold uppercase tracking-wider py-8">
                    No pledged shares records returned for this symbol.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Building2 className="text-indigo-400" size={20} />
                        <div>
                          <h4 className="text-sm font-black text-white uppercase tracking-tight">{pledgedData.company_name}</h4>
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Company Registry Status</span>
                        </div>
                      </div>

                      <div className="space-y-2 mt-4">
                        <div className="flex justify-between items-center py-2 border-b border-slate-800/40">
                          <span className="text-xs text-slate-500 font-bold uppercase">Total Issued Shares</span>
                          <span className="text-xs font-mono font-black text-white">{formatQty(pledgedData.total_shares)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-slate-800/40">
                          <span className="text-xs text-slate-500 font-bold uppercase">Total Promoter Shares</span>
                          <span className="text-xs font-mono font-black text-white">{formatQty(pledgedData.promoter_shares)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-slate-800/40">
                          <span className="text-xs text-slate-500 font-bold uppercase">Shares Pledged by Promoters</span>
                          <span className={`text-xs font-mono font-black ${pledgedData.pledged_shares > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                            {formatQty(pledgedData.pledged_shares)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-xs text-slate-500 font-bold uppercase">Pledged Shareholdings Ratio</span>
                          <span className={`text-xs font-mono font-black ${
                            pledgedData.pledged_pct > 50 ? 'text-rose-400' : pledgedData.pledged_pct > 15 ? 'text-amber-400' : 'text-emerald-400'
                          }`}>
                            {pledgedData.pledged_pct.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      <div className="pt-4 flex items-center gap-2 text-[10px] text-slate-500 italic">
                        <Activity size={10} />
                        Last registry update: {pledgedData.updated_at}
                      </div>
                    </div>

                    <div className="flex flex-col items-center justify-center p-6 bg-slate-950/30 rounded-2xl border border-slate-800/50">
                      <div className="relative flex items-center justify-center">
                        {/* Circular ring representation */}
                        <svg className="w-36 h-36 transform -rotate-90">
                          <circle cx="72" cy="72" r="60" stroke="#1e293b" strokeWidth="12" fill="transparent" />
                          <circle 
                            cx="72" 
                            cy="72" 
                            r="60" 
                            stroke={pledgedData.pledged_pct > 50 ? '#f43f5e' : pledgedData.pledged_pct > 15 ? '#f59e0b' : '#10b981'} 
                            strokeWidth="12" 
                            fill="transparent" 
                            strokeDasharray={376.9}
                            strokeDashoffset={376.9 - (376.9 * Math.min(pledgedData.pledged_pct, 100)) / 100}
                          />
                        </svg>
                        <div className="absolute text-center">
                          <span className="text-2xl font-black text-white">{pledgedData.pledged_pct.toFixed(0)}%</span>
                          <p className="text-[8px] font-black text-slate-550 uppercase tracking-widest mt-0.5">Pledged</p>
                        </div>
                      </div>

                      <div className="mt-6 flex gap-4 text-xs font-bold uppercase tracking-wider text-center">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-800" />
                          <span className="text-slate-400">Free Stakes</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2.5 h-2.5 rounded-full ${
                            pledgedData.pledged_pct > 50 ? 'bg-rose-500' : pledgedData.pledged_pct > 15 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`} />
                          <span className="text-slate-400">Pledged Stakes</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: MUTUAL FUND SMART MONEY */}
            {activeSubTab === 'mf' && (
              <div className="overflow-x-auto max-h-[380px] no-scrollbar">
                {mfData.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
                    No Mutual Fund transaction records found for this symbol.
                  </div>
                ) : (
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead>
                      <tr className="bg-slate-950/40 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/40 select-none sticky top-0 z-10">
                        <th className="py-3.5 pl-6">MF Scheme Name</th>
                        <th className="py-3.5">Action</th>
                        <th className="py-3.5 text-right">Value (₹)</th>
                        <th className="py-3.5 text-right">Quantity</th>
                        <th className="py-3.5 text-right">ISIN</th>
                        <th className="py-3.5 text-right pr-6">Transaction Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/30">
                      {mfData.map((mf, idx) => {
                        const isBuy = mf.buy_sell?.toLowerCase() === 'buy';
                        return (
                          <tr key={idx} className="hover:bg-slate-800/20 transition-all">
                            <td className="py-3.5 pl-6 font-bold text-slate-200 text-xs max-w-sm truncate" title={mf.scheme_name}>
                              {mf.scheme_name}
                            </td>
                            <td className="py-3.5 text-xs">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${
                                isBuy 
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}>
                                {isBuy ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                {mf.buy_sell || (isBuy ? 'Buy' : 'Sell')}
                              </span>
                            </td>
                            <td className={`py-3.5 text-right font-black text-xs font-mono ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {formatCurrency(mf.value)}
                            </td>
                            <td className="py-3.5 text-right text-xs font-mono font-bold text-slate-300">
                              {formatQty(mf.qty)}
                            </td>
                            <td className="py-3.5 text-right text-xs font-mono text-slate-400 font-bold">
                              {mf.isin}
                            </td>
                            <td className="py-3.5 text-right text-xs font-mono text-slate-400 pr-6">
                              {mf.date}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
