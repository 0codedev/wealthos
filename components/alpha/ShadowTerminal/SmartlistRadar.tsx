import React, { useState, useEffect } from 'react';
import { 
  Layers, RefreshCw, BarChart3, AlertCircle, Info, ChevronLeft, ArrowRight, Activity, TrendingUp, Cpu
} from 'lucide-react';
import { Tabs } from '../../ui/AnimatedTabs';
import { ActionButton } from '../../ui/ActionButton';

interface SmartlistRadarProps {
  onBack: () => void;
}

const OPTION_CATEGORIES = [
  { id: 'active_calls', name: 'Active Calls' },
  { id: 'active_puts', name: 'Active Puts' },
  { id: 'open_interest_gainers', name: 'OI Gainers' },
  { id: 'open_interest_losers', name: 'OI Losers' },
  { id: 'price_gainers', name: 'Price Gainers' },
  { id: 'price_losers', name: 'Price Losers' },
  { id: 'volume_gainers', name: 'Volume Gainers' },
  { id: 'volume_losers', name: 'Volume Losers' },
  { id: 'implied_volatility_gainers', name: 'IV Gainers' },
  { id: 'implied_volatility_losers', name: 'IV Losers' }
];

const FUTURE_CATEGORIES = [
  { id: 'open_interest_gainers', name: 'OI Gainers' },
  { id: 'open_interest_losers', name: 'OI Losers' },
  { id: 'price_gainers', name: 'Price Gainers' },
  { id: 'price_losers', name: 'Price Losers' },
  { id: 'volume_gainers', name: 'Volume Gainers' },
  { id: 'volume_losers', name: 'Volume Losers' },
  { id: 'most_active', name: 'Most Active' },
  { id: 'rollover_gainers', name: 'Rollover Gainers' }
];

export const SmartlistRadar: React.FC<SmartlistRadarProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'options' | 'futures' | 'mtf'>('options');
  const [assetType, setAssetType] = useState<'EQUITY' | 'CURRENCY' | 'COMMODITY'>('EQUITY');
  
  const [optionCategory, setOptionCategory] = useState('active_calls');
  const [futureCategory, setFutureCategory] = useState('open_interest_gainers');
  
  const [listData, setListData] = useState<any[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadSmartlist = async () => {
    setIsFetching(true);
    setErrorMessage('');
    try {
      let endpoint = '';
      if (activeTab === 'options') {
        endpoint = `/api/python-nse/api/upstox/smartlist/options?asset_type=${assetType}&category=${optionCategory}`;
      } else if (activeTab === 'futures') {
        endpoint = `/api/python-nse/api/upstox/smartlist/futures?asset_type=${assetType}&category=${futureCategory}`;
      } else {
        endpoint = `/api/python-nse/api/upstox/smartlist/mtf`;
      }
      
      const response = await fetch(endpoint);
      if (response.ok) {
        const res = await response.json();
        setListData(res.data || []);
      } else {
        setErrorMessage(`Server returned status code: ${response.status}`);
      }
    } catch (err) {
      setErrorMessage('Failed to connect to Upstox Smartlist API.');
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    loadSmartlist();
  }, [activeTab, assetType, optionCategory, futureCategory]);

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/30 p-4 border border-slate-800/60 rounded-3xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <ActionButton 
            size="md"
            icon={<ChevronLeft size={16} />}
            onClick={onBack}
            title="Back"
          />
          <div>
            <h2 className="text-base font-black text-white tracking-tight uppercase">Smartlist Radar</h2>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Live F&O Concentration & MTF Candidates</p>
          </div>
        </div>

        <Tabs.Root
          value={activeTab}
          onChange={(val) => setActiveTab(val as 'options' | 'futures' | 'mtf')}
          variant="solid-indigo"
          layoutId="smartlist-radar-tabs"
          motionPreset="spring"
          className="shrink-0"
        >
          <Tabs.List className="bg-slate-950 p-1 rounded-xl border border-slate-800">
            {(['options', 'futures', 'mtf'] as const).map(tab => (
              <Tabs.Trigger
                key={tab}
                value={tab}
                className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest"
              >
                {tab}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
      </div>

      {/* Filter Options Row */}
      {activeTab !== 'mtf' && (
        <div className="flex flex-wrap items-center gap-4 bg-slate-900/20 border border-slate-800/40 p-4 rounded-2xl">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Asset Segment:</span>
            <select
              value={assetType}
              onChange={(e) => setAssetType(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 text-[10px] font-black text-slate-350 rounded-lg px-3 py-1.5 focus:border-indigo-500 outline-none"
            >
              <option value="EQUITY">Equity F&O</option>
              <option value="CURRENCY">Currency F&O</option>
              <option value="COMMODITY">Commodity F&O</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Category list:</span>
            {activeTab === 'options' ? (
              <select
                value={optionCategory}
                onChange={(e) => setOptionCategory(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-[10px] font-black text-slate-350 rounded-lg px-3 py-1.5 focus:border-indigo-500 outline-none"
              >
                {OPTION_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <select
                value={futureCategory}
                onChange={(e) => setFutureCategory(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-[10px] font-black text-slate-350 rounded-lg px-3 py-1.5 focus:border-indigo-500 outline-none"
              >
                {FUTURE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          <button
            onClick={loadSmartlist}
            disabled={isFetching}
            className="ml-auto p-1.5 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-white rounded-lg transition-colors border border-slate-700/50"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2 px-4 py-3 bg-rose-500/10 border border-rose-500/20 text-rose-455 rounded-2xl text-xs font-bold uppercase tracking-wide">
          <AlertCircle size={14} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Smartlist Data Table */}
      <div className="bg-slate-900/35 border border-slate-800/80 rounded-[32px] overflow-hidden">
        <div className="p-4 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <Layers size={12} className="text-indigo-400" />
            {activeTab === 'mtf' ? 'Margin Trading Facility (MTF) Candidates' : 'Upstox Smartlist Candidates'}
          </span>
          <span className="text-[9px] font-black uppercase text-slate-500">
            {listData.length} records returned
          </span>
        </div>

        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-xs text-left border-collapse font-mono">
            <thead>
              <tr className="bg-slate-950/60 border-b border-slate-800 text-[9px] uppercase tracking-wider text-slate-500 sticky top-0">
                <th className="px-4 py-3 font-black">Symbol</th>
                {activeTab !== 'mtf' && <th className="px-4 py-3 font-black text-right">LTP</th>}
                {activeTab !== 'mtf' && <th className="px-4 py-3 font-black text-right">OI</th>}
                {activeTab !== 'mtf' && <th className="px-4 py-3 font-black text-right">OI Chg %</th>}
                {activeTab === 'mtf' && <th className="px-4 py-3 font-black">Segment</th>}
                {activeTab === 'mtf' && <th className="px-4 py-3 font-black text-right">Margin Allowed</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-850">
              {isFetching ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-slate-500">
                    <RefreshCw className="animate-spin inline-block mr-2" size={14} />
                    Loading smartlist data...
                  </td>
                </tr>
              ) : listData.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-slate-500">
                    No active smartlist records available for selected configuration.
                  </td>
                </tr>
              ) : (
                listData.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-850/40 transition-colors">
                    <td className="px-4 py-3 text-white font-bold">{item.trading_symbol || item.symbol_name || item.symbol}</td>
                    {activeTab !== 'mtf' && <td className="px-4 py-3 text-right text-slate-300">₹{(item.last_price || item.close_price || 0).toLocaleString()}</td>}
                    {activeTab !== 'mtf' && <td className="px-4 py-3 text-right text-slate-350">{(item.oi || 0).toLocaleString()}</td>}
                    {activeTab !== 'mtf' && (
                      <td className={`px-4 py-3 text-right font-black ${
                        (item.oi_change_percent || item.change_percent || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {(item.oi_change_percent || item.change_percent || 0).toFixed(2)}%
                      </td>
                    )}
                    {activeTab === 'mtf' && <td className="px-4 py-3 text-slate-400 uppercase">{item.segment || 'EQUITY'}</td>}
                    {activeTab === 'mtf' && <td className="px-4 py-3 text-right text-emerald-400 font-bold">{(item.margin_leverage || '2.0x')}</td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
