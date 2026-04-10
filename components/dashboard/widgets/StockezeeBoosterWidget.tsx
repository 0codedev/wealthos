import React, { useState } from 'react';
import { Terminal, Zap, Filter, AlertCircle, TrendingUp, BarChart3, Search } from 'lucide-react';
import { formatCurrency } from '../../../utils/helpers';
import { useAlphaStockStore } from '../../../store/alphaStockStore';

interface StockData {
  Symbol: string;
  LTP: number;
  Change: number;
  "Strength Factor": number;
}

export const StockezeeBoosterWidget = () => {
  const rawStocks = useAlphaStockStore(state => state.stocks);
  const setAlphaStocks = useAlphaStockStore(state => state.setStocks);
  const [rawData, setRawData] = useState('');
  const [localStocks, setLocalStocks] = useState<StockData[]>([]);
  const [isPasting, setIsPasting] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const stocks = rawStocks.length > 0 ? rawStocks : localStocks;

  const handleProcessData = () => {
    try {
      const parsed = JSON.parse(rawData);
      // Handle both raw stockList array or the full object with stockList property
      let list = [];
      if (parsed.stockList) {
        list = parsed.stockList;
      } else if (parsed.json && parsed.json.stockList) {
        list = parsed.json.stockList;
      } else if (Array.isArray(parsed)) {
        list = parsed;
      } else {
        throw new Error("No stock data found in JSON");
      }
      
      const sortedList = list.sort((a: any, b: any) => b["Strength Factor"] - a["Strength Factor"]);
      setAlphaStocks(sortedList);
      setLocalStocks(sortedList);
      setIsPasting(false);
      setError('');
      setRawData(''); // Clear for security
    } catch (err) {
      setError('Invalid JSON structure. Make sure you copied the full "stock-list" response.');
    }
  };

  const filteredStocks = stocks.filter(s => 
    s.Symbol.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-2xl p-6 h-full flex flex-col overflow-hidden shadow-2xl group/widget">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 rounded-lg group-hover/widget:scale-110 transition-transform">
            <Zap className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">Alpha Booster Lab</h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Institutional Momentum Scraper</p>
          </div>
        </div>
        
        {!isPasting && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input 
                type="text"
                placeholder="Search symbol..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-white/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-none w-32 focus:w-48 transition-all"
              />
            </div>
            <button 
              onClick={() => setIsPasting(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-650/20 dark:bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-lg transition-all text-xs font-bold"
            >
              <Terminal className="w-3.5 h-3.5" />
              PASTE JSON
            </button>
          </div>
        )}
      </div>

      {isPasting ? (
        <div className="flex-1 flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex-1 relative group">
            <textarea
              className="w-full h-full bg-white/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-[10px] font-mono text-indigo-600 dark:text-indigo-400 focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none custom-scrollbar"
              placeholder="Paste 'stock-list' response from Network Tab here..."
              value={rawData}
              onChange={(e) => setRawData(e.target.value)}
            />
            <div className="absolute top-3 right-3 text-[10px] text-slate-400 dark:text-slate-600 font-mono pointer-events-none">
              CTRL + V
            </div>
          </div>
          
          {error && (
            <div className="flex items-center gap-2 text-rose-500 dark:text-rose-400 text-xs px-2 bg-rose-500/5 py-2 rounded-lg border border-rose-500/10">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </div>
          )}

          <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-950/50 rounded-xl border border-slate-200 dark:border-slate-800/50">
            <button 
              onClick={handleProcessData}
              className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg font-black text-sm tracking-widest transition-all shadow-xl shadow-indigo-900/40 uppercase"
            >
              UNLOCK ALPHA DATA
            </button>
            <button 
              onClick={() => { setIsPasting(false); setError(''); }}
              className="px-6 py-3 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-bold text-sm transition-all"
            >
              CANCEL
            </button>
          </div>
        </div>
      ) : stocks.length > 0 ? (
        <div className="flex-1 overflow-auto custom-scrollbar -mx-2 px-2">
          <table className="w-full text-left border-separate border-spacing-y-2">
            <thead className="sticky top-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md z-10">
              <tr className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-black">
                <th className="pb-2 pl-4">Asset</th>
                <th className="pb-2">LTP</th>
                <th className="pb-2 text-right">Score</th>
                <th className="pb-2 pr-4 text-right">Alpha Grade</th>
              </tr>
            </thead>
            <tbody>
              {filteredStocks.map((stock, idx) => (
                <tr key={stock.Symbol} className="group/row bg-white/40 dark:bg-slate-950/30 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/5 border border-slate-200 dark:border-slate-800/50 transition-all cursor-default rounded-xl">
                  <td className="py-3 pl-4 rounded-l-xl">
                    <div className="flex flex-col">
                      <span className="font-mono font-black text-indigo-650 dark:text-indigo-300 text-sm tracking-tight">{stock.Symbol}</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">FNO SEGMENT</span>
                    </div>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-col">
                      <span className="text-slate-900 dark:text-white font-mono text-sm font-bold">{formatCurrency(stock.LTP)}</span>
                      <span className={`text-[10px] font-mono ${stock.Change >= 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-600 dark:text-rose-500'}`}>
                        {stock.Change >= 0 ? '+' : ''}{stock.Change.toFixed(2)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex flex-col items-end">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-black tracking-tighter ${
                        stock["Strength Factor"] > 800 ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 
                        stock["Strength Factor"] > 500 ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30' : 
                        'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                      }`}>
                        {stock["Strength Factor"]}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right rounded-r-xl">
                    <div className="flex flex-col items-end gap-1">
                      <div className="w-20 h-1.5 bg-slate-250 dark:bg-slate-800/50 rounded-full overflow-hidden border border-slate-200 dark:border-slate-800">
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ${
                            stock["Strength Factor"] > 800 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                            stock["Strength Factor"] > 500 ? 'bg-amber-500' : 'bg-slate-500'
                          }`}
                          style={{ width: `${(stock["Strength Factor"] / 1000) * 100}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-black text-slate-500 dark:text-slate-600 uppercase">
                        {stock["Strength Factor"] > 800 ? 'Tier 1 Alpha' : stock["Strength Factor"] > 500 ? 'Tier 2 Trend' : 'Neutral'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-white/60 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-3xl flex items-center justify-center mb-6 shadow-inner group-hover/widget:border-indigo-500/30 transition-all duration-500">
            <BarChart3 className="w-10 h-10 text-slate-400 dark:text-slate-700 group-hover/widget:text-indigo-600 dark:group-hover/widget:text-indigo-500 transition-colors" />
          </div>
          <h4 className="text-slate-900 dark:text-white font-bold text-xl mb-2">Alpha Stream Offline</h4>
          <p className="text-xs text-slate-500 max-w-[240px] leading-relaxed">
            Connect to the institutional momentum stream by pasting the <span className="text-indigo-600 dark:text-indigo-400 font-mono">stock-list</span> response from the network layer.
          </p>
          
          <div className="mt-8 grid grid-cols-2 gap-4 w-full">
            <div className="p-3 bg-white/60 dark:bg-slate-950/30 border border-slate-200 dark:border-slate-800/50 rounded-xl text-left">
              <TrendingUp className="w-4 h-4 text-emerald-500 mb-2" />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">Captures Opening Range Breakouts instantly.</p>
            </div>
            <div className="p-3 bg-white/60 dark:bg-slate-950/30 border border-slate-200 dark:border-slate-800/50 rounded-xl text-left">
              <Zap className="w-4 h-4 text-amber-500 mb-2" />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">Visualizes Strength Scores unblurred.</p>
            </div>
          </div>
        </div>
      )}
      
      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800/50 flex items-center justify-between">
        <div className="flex items-center gap-4 text-[9px] font-bold text-slate-500 dark:text-slate-600 uppercase tracking-widest">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50 animate-pulse" />
            Live Scraper Active
          </div>
        </div>
        {stocks.length > 0 && (
          <button 
            onClick={() => {
              setAlphaStocks([]);
              setLocalStocks([]);
            }}
            className="text-[9px] font-bold text-rose-500 hover:text-rose-600 uppercase tracking-widest transition-colors"
          >
            Clear Data
          </button>
        )}
      </div>
    </div>
  );
};

export default StockezeeBoosterWidget;
