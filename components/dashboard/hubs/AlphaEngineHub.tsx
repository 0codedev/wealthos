import React, { useState, useMemo } from 'react';
import { Rocket, TrendingUp, TrendingDown, LayoutGrid, Terminal, ShieldAlert, BarChart3, Target, Search, Globe, ChevronRight, Activity, MousePointer2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlphaStockStore } from '../../../store/alphaStockStore';

interface StockData {
  Symbol: string;
  LTP: number;
  Change: number;
  "Strength Factor": number;
}

type TabType = 'INTRADAY' | 'FNO' | 'SECTOR';

export const AlphaEngineHub = () => {
  const [activeTab, setActiveTab] = useState<TabType>('INTRADAY');
  const [rawData, setRawData] = useState('');
  const stocks = useAlphaStockStore(state => state.stocks);
  const setStocks = useAlphaStockStore(state => state.setStocks);
  const [isPasting, setIsPasting] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const handleProcessData = () => {
    try {
      const parsed = JSON.parse(rawData);
      let list = parsed.stockList || (parsed.json && parsed.json.stockList) || (Array.isArray(parsed) ? parsed : []);
      if (list.length === 0) throw new Error("No data found");
      setStocks(list);
      setIsPasting(false);
      setError('');
      setRawData('');
    } catch (err) {
      setError('Invalid Signal Packet. Please copy the full response.');
    }
  };

  const filteredStocks = useMemo(() => {
    return stocks.filter(s => s.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [stocks, searchTerm]);

  const bullishStocks = filteredStocks.filter(s => s["Strength Factor"] > 0).sort((a, b) => b["Strength Factor"] - a["Strength Factor"]);
  const bearishStocks = filteredStocks.filter(s => s["Strength Factor"] < 0).sort((a, b) => a["Strength Factor"] - b["Strength Factor"]);

  // Sector Data for the Bar Chart
  const sectorData = [
    { name: 'PHARMA', change: 1.85 },
    { name: 'MID SELECT', change: 1.50 },
    { name: 'PSU BANK', change: 1.20 },
    { name: 'REALTY', change: 1.05 },
    { name: 'FIN SERVICE', change: 0.95 },
    { name: 'AUTO', change: 0.90 },
    { name: 'IT', change: 0.85 },
    { name: 'BANK', change: 0.80 },
    { name: 'METAL', change: 0.60 },
    { name: 'NIFTY 50', change: 0.45 },
    { name: 'FMCG', change: -0.35 },
    { name: 'ENERGY', change: -0.55 },
  ].sort((a, b) => b.change - a.change);

  return (
    <div className="min-h-[500px] bg-white/60 dark:bg-slate-950/40 backdrop-blur-3xl border border-slate-200 dark:border-slate-800/50 rounded-3xl overflow-hidden flex flex-col shadow-[0_0_120px_rgba(0,0,0,0.1)] dark:shadow-[0_0_120px_rgba(0,0,0,0.6)] relative group/hub">
      {/* INSTITUTIONAL GLOWS */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />
      <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-indigo-500/10 blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-1/3 h-1/3 bg-emerald-500/5 blur-[150px] pointer-events-none" />

      {/* TOP NAVIGATION BAR */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/40 relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(79,70,225,0.3)]">
            <Rocket className="w-5 h-5 text-white fill-white/20 animate-pulse" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight uppercase italic leading-none">Alpha Engine</h2>
          </div>
        </div>

        <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                {(['INTRADAY', 'FNO'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all ${
                            activeTab === tab 
                            ? 'bg-white dark:bg-white text-black shadow-md shadow-slate-200/50 dark:shadow-white/10' 
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        {tab} BOOSTER
                    </button>
                ))}
            </div>
            
            <button 
                onClick={() => setIsPasting(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-[10px] tracking-widest transition-all shadow-[0_5px_15px_rgba(79,70,229,0.2)] group/btn"
            >
                <Terminal className="w-3.5 h-3.5" />
                IGNITE SIGNAL
            </button>
        </div>
      </div>

      {/* DASHBOARD CONTENT */}
      <div className="flex-1 p-6 relative z-10 flex flex-col min-h-0">
        <AnimatePresence mode="wait">
          {isPasting ? (
            <motion.div 
              key="paste" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="h-full flex flex-col gap-8"
            >
              <div className="flex-1 bg-white/40 dark:bg-slate-900/30 backdrop-blur-sm border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[3rem] p-12 relative overflow-hidden group/textarea">
                <textarea
                  className="w-full h-full bg-transparent border-none outline-none font-mono text-indigo-600 dark:text-indigo-400 text-lg leading-relaxed resize-none custom-scrollbar relative z-10"
                  placeholder="PASTE JSON RESPONSE FROM NETWORK LAYER..."
                  value={rawData}
                  onChange={(e) => setRawData(e.target.value)}
                />
                <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover/textarea:opacity-100 transition-opacity" />
              </div>
              
              {error && <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500 font-black text-xs uppercase tracking-widest flex items-center gap-3 animate-pulse"><ShieldAlert size={16} /> {error}</div>}

              <div className="flex gap-6">
                <button onClick={handleProcessData} className="flex-1 py-7 bg-white text-black rounded-[2rem] font-black tracking-[0.3em] text-xl shadow-2xl hover:bg-slate-100 transition-all uppercase">DECODE ALPHA</button>
                <button onClick={() => setIsPasting(false)} className="px-12 py-7 bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-500 rounded-[2rem] font-black tracking-widest hover:text-slate-900 dark:hover:text-white transition-all uppercase">ABORT</button>
              </div>
            </motion.div>
          ) : stocks.length > 0 ? (
            <motion.div key="data" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full gap-12">
                <div className="grid grid-cols-2 gap-12 flex-1 min-h-0">
                    {/* BULLISH COLUMN */}
                    <div className="flex flex-col gap-6">
                        <div className="flex items-center gap-3 px-2">
                            <TrendingUp className="w-5 h-5 text-emerald-500" />
                            <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">Bullish Alpha <span className="text-slate-500 ml-2">[{bullishStocks.length}]</span></h3>
                        </div>
                        <div className="flex-1 overflow-auto bg-white/40 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800/40 rounded-[2.5rem] p-8 custom-scrollbar shadow-inner">
                            <StockTable data={bullishStocks} type="bullish" />
                        </div>
                    </div>

                    {/* BEARISH COLUMN */}
                    <div className="flex flex-col gap-6">
                        <div className="flex items-center gap-3 px-2">
                            <TrendingDown className="w-5 h-5 text-rose-500" />
                            <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">Bearish Alpha <span className="text-slate-500 ml-2">[{bearishStocks.length}]</span></h3>
                        </div>
                        <div className="flex-1 overflow-auto bg-white/40 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800/40 rounded-[2.5rem] p-8 custom-scrollbar shadow-inner">
                            <StockTable data={bearishStocks} type="bearish" />
                        </div>
                    </div>
                </div>

                {/* SECTOR SCOPE SECTION */}
                <div className="bg-white/60 dark:bg-slate-900/10 border border-slate-200 dark:border-slate-800/40 rounded-[3rem] p-10 relative overflow-hidden">
                    <div className="flex items-center gap-4 mb-10">
                        <BarChart3 className="w-6 h-6 text-indigo-500" />
                        <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">Sector Scope <span className="text-[10px] text-slate-500 ml-3 tracking-[0.4em]">LIVE HEATMAP & RANKING</span></h3>
                    </div>

                    <div className="space-y-4">
                        {sectorData.map((sector) => (
                            <div key={sector.name} className="flex items-center group/sector">
                                <div className="w-32 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right pr-6 group-hover/sector:text-slate-900 dark:group-hover/sector:text-white transition-colors">{sector.name}</div>
                                <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-900/50 rounded-full overflow-hidden flex relative border border-slate-200 dark:border-slate-800/50">
                                    {sector.change > 0 ? (
                                        <div className="absolute left-1/2 h-full bg-indigo-500 rounded-full shadow-[0_0_15px_rgba(79,70,229,0.5)] transition-all duration-1000" style={{ width: `${Math.abs(sector.change) * 20}%` }} />
                                    ) : (
                                        <div className="absolute right-1/2 h-full bg-rose-500 rounded-full shadow-[0_0_15px_rgba(244,63,94,0.5)] transition-all duration-1000" style={{ width: `${Math.abs(sector.change) * 20}%` }} />
                                    )}
                                    {/* Center Line */}
                                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300 dark:bg-slate-700 z-10" />
                                </div>
                                <div className="w-20 text-[10px] font-bold text-slate-500 pl-6 group-hover/sector:text-indigo-600 dark:group-hover/sector:text-indigo-400 transition-colors">{(sector.change > 0 ? '+' : '') + sector.change}%</div>
                            </div>
                        ))}
                    </div>
                </div>
            </motion.div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center opacity-40 group cursor-pointer" onClick={() => setIsPasting(true)}>
                <div className="w-32 h-32 bg-white/60 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] flex items-center justify-center mb-8 group-hover:scale-110 group-hover:border-indigo-500/30 transition-all duration-700 shadow-2xl">
                    <Activity className="w-16 h-16 text-slate-400 dark:text-slate-800 group-hover:text-indigo-650 dark:group-hover:text-indigo-500 transition-all duration-500" />
                </div>
                <h3 className="text-3xl font-black text-slate-400 dark:text-slate-700 tracking-tighter uppercase italic group-hover:text-slate-900 dark:group-hover:text-white transition-all">Awaiting Signal Feed</h3>
                <p className="text-[10px] font-black text-slate-500 tracking-[0.4em] uppercase mt-4">Manual Uplink Protocol Required</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* FOOTER STATUS */}
      <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-900/40 border-t border-slate-200 dark:border-slate-800/40 flex items-center justify-between text-[10px] font-black text-slate-500 dark:text-slate-600 uppercase tracking-widest">
        <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                SYSTEM LIVE
            </div>
            <div className="flex items-center gap-2">
                <MousePointer2 size={12} />
                CLICK TO ANALYZE
            </div>
        </div>
        <div className="italic opacity-50">Wealth Dashboard Alpha Terminal // v2.5.0-ALPHA</div>
      </div>
    </div>
  );
};

const StockTable = ({ data, type }: { data: StockData[], type: 'bullish' | 'bearish' }) => (
  <table className="w-full text-left border-separate border-spacing-y-4">
    <thead>
      <tr className="text-[10px] font-black text-slate-500 dark:text-slate-600 uppercase tracking-[0.3em]">
        <th className="pb-2 pl-4">Asset Matrix</th>
        <th className="pb-2">Price Action</th>
        <th className="pb-2 text-right pr-4">Alpha Score</th>
      </tr>
    </thead>
    <tbody>
      {data.map((stock) => (
        <tr key={stock.Symbol} className="group cursor-default">
          <td className="py-5 pl-6 bg-white/60 dark:bg-slate-950/60 rounded-l-2xl border-y border-l border-slate-200 dark:border-slate-800/50 group-hover:bg-slate-50 dark:group-hover:bg-slate-900/60 transition-all">
            <div className="flex flex-col">
              <span className="text-base font-black text-slate-900 dark:text-white tracking-tight uppercase italic">{stock.Symbol}</span>
              <span className="text-[9px] font-black text-slate-400 dark:text-slate-600 tracking-widest uppercase">EQ // FNO</span>
            </div>
          </td>
          <td className="py-5 bg-white/60 dark:bg-slate-955/60 border-y border-slate-200 dark:border-slate-800/50 group-hover:bg-slate-50 dark:group-hover:bg-slate-900/60 transition-all font-mono">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300">₹{stock.LTP.toLocaleString()}</span>
              <span className={`text-[10px] font-black flex items-center gap-1 ${type === 'bullish' ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-650 dark:text-rose-500'}`}>
                {type === 'bullish' ? '+' : ''}{stock.Change.toFixed(2)}%
              </span>
            </div>
          </td>
          <td className="py-5 pr-6 bg-white/60 dark:bg-slate-955/60 rounded-r-2xl border-y border-r border-slate-200 dark:border-slate-800/50 text-right group-hover:bg-slate-50 dark:group-hover:bg-slate-900/60 transition-all">
            <div className="flex flex-col items-end gap-1">
                <span className={`px-4 py-1 rounded-lg text-xs font-black tracking-tighter shadow-lg ${
                type === 'bullish' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                }`}>
                {Math.abs(stock["Strength Factor"])}
                </span>
                <span className="text-[8px] font-black text-slate-400 dark:text-slate-700 uppercase tracking-widest">Strength Matrix</span>
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

export default AlphaEngineHub;
