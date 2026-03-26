import React from 'react';
import { Upload, RefreshCw, Clock, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { openTradingView } from '../../utils/navigation';
import { formatCurrencyPrecise } from '../../utils/helpers';

export interface SectorStockItem {
  symbol_name: string;
  last_trade_price: number;
  change_per: number;
  current_score: number;
  company_name: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  change_value?: number;
}

export interface SectorBoosterItem {
  sector: string;
  stock: number;
  positive: number;
  negative: number;
  sector_change_percent: number;
  stock_list: SectorStockItem[];
}

interface SectorBoosterPanelProps {
  boosterRawData: SectorBoosterItem[];
  isFetchingBooster: boolean;
  fetchSectorBooster: () => void;
  handleBoosterFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setSelectedStock: (stock: any) => void;
}

export const SectorBoosterPanel: React.FC<SectorBoosterPanelProps> = ({
  boosterRawData,
  isFetchingBooster,
  fetchSectorBooster,
  handleBoosterFileUpload,
  setSelectedStock,
}) => {
  if (boosterRawData.length === 0) {
    return (
      <div className="min-h-[450px] flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900/10 border border-slate-200 dark:border-slate-800/40 rounded-[2.5rem] p-12 text-center shadow-inner">
        <Clock className="w-16 h-16 text-slate-300 dark:text-slate-700 mb-6 animate-pulse" />
        <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] mb-2">Waiting for Sector Booster</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm max-w-md mb-8 leading-relaxed font-medium">Sync Live via the API bridge or drop your fno sectors.json file to bypass the premium paywall and activate the institutional sector breakout tracker.</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <label className="flex items-center gap-2 px-5 py-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-black text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white uppercase tracking-widest transition-all duration-200 cursor-pointer shadow-sm">
            <Upload className="w-4 h-4" />
            Load fno sectors.json
            <input
              type="file"
              accept=".json"
              onChange={handleBoosterFileUpload}
              className="hidden"
            />
          </label>
          <button
            onClick={fetchSectorBooster}
            className="flex items-center gap-2 px-6 py-3 bg-sky-600 hover:bg-sky-500 rounded-2xl text-xs font-black text-white uppercase tracking-widest transition-all duration-200 shadow-lg shadow-sky-600/20 active:scale-95"
          >
            <RefreshCw className="w-4 h-4" />
            Sync Live
          </button>
        </div>
      </div>
    );
  }

  const averageChange = (() => {
    const sum = boosterRawData.reduce((acc, curr) => acc + (curr.sector_change_percent || 0), 0);
    return sum / boosterRawData.length;
  })();

  return (
    <div className="space-y-6">
      {/* STATS HEADER */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white/60 dark:bg-slate-900/30 p-5 rounded-[2rem] border border-slate-200 dark:border-slate-800/40 mt-2 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-4">
          <div className="h-10 w-1 bg-sky-500 rounded-full shadow-[0_0_10px_rgba(14,165,233,0.5)]" />
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-slate-200 tracking-wider uppercase italic">F&O Sector Booster Panel</h3>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1 font-mono">
              Average Sector Change:{' '}
              <span className={averageChange >= 0 ? 'text-emerald-600 dark:text-emerald-400 font-black' : 'text-rose-600 dark:text-rose-400 font-black'}>
                {(averageChange >= 0 ? '+' : '') + averageChange.toFixed(2)}%
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 rounded-xl text-[10px] font-black text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white uppercase tracking-widest transition-all duration-200 cursor-pointer shadow-sm">
            <Upload className="w-3.5 h-3.5" />
            Load Sector.json
            <input
              type="file"
              accept=".json"
              onChange={handleBoosterFileUpload}
              className="hidden"
            />
          </label>

          <button
            onClick={fetchSectorBooster}
            disabled={isFetchingBooster}
            className="flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-500 border border-sky-500/50 shadow-lg shadow-sky-600/20 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all duration-200 disabled:opacity-50 active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetchingBooster ? 'animate-spin' : ''}`} />
            {isFetchingBooster ? 'Syncing...' : 'Sync Live'}
          </button>
        </div>
      </div>

      {/* SECTOR CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {[...boosterRawData]
          .sort((a, b) => (b.sector_change_percent || 0) - (a.sector_change_percent || 0))
          .map((sector) => {
            const isPositiveChange = (sector.sector_change_percent || 0) >= 0;
            const totalStocks = sector.stock || 0;
            const posCount = sector.positive || 0;
            const negCount = sector.negative || 0;
            const totalRatio = posCount + negCount;
            const posPct = totalRatio > 0 ? (posCount / totalRatio) * 100 : 0;
            const negPct = totalRatio > 0 ? (negCount / totalRatio) * 100 : 0;

            const sortedStocks = [...(sector.stock_list || [])]
              .sort((a, b) => (b.current_score || 0) - (a.current_score || 0));

            return (
              <div key={sector.sector} className="bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 hover:border-indigo-500/30 dark:hover:border-slate-700/80 rounded-[2rem] p-6 shadow-sm hover:shadow-xl flex flex-col justify-between transition-all duration-300 group relative overflow-hidden">
                <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
                    {isPositiveChange ? <TrendingUp size={100} className="text-emerald-600 dark:text-emerald-500" /> : <TrendingDown size={100} className="text-rose-600 dark:text-rose-500" />}
                </div>
                
                <div className="space-y-4 mb-6 relative z-10">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-base font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight italic">{sector.sector}</h4>
                      <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">{totalStocks} Assets Tracked</p>
                    </div>
                    <span className={`inline-flex items-center px-3 py-1 rounded-xl text-xs font-black font-mono tracking-tight shadow-sm ${
                      isPositiveChange
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                        : 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20'
                    }`}>
                      {isPositiveChange ? '+' : ''}{(sector.sector_change_percent || 0).toFixed(2)}%
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden flex border border-slate-200 dark:border-slate-850 shadow-inner">
                      {posPct > 0 && (
                        <div 
                          className="bg-emerald-500 h-full transition-all duration-700 shadow-[0_0_10px_rgba(16,185,129,0.3)]" 
                          style={{ width: `${posPct}%` }} 
                        />
                      )}
                      {negPct > 0 && (
                        <div 
                          className="bg-rose-500 h-full transition-all duration-700 shadow-[0_0_10px_rgba(239,68,68,0.3)]" 
                          style={{ width: `${negPct}%` }} 
                        />
                      )}
                    </div>
                    <div className="flex justify-between items-center text-[9px] font-black text-slate-500 dark:text-slate-500 tracking-wider uppercase">
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse"></div> {posCount} Bulls</span>
                      <span className="font-mono">Ratio {posPct.toFixed(0)} / {negPct.toFixed(0)}</span>
                      <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">{negCount} Bears <div className="w-1 h-1 bg-rose-500 rounded-full"></div></span>
                    </div>
                  </div>
                </div>

                {/* Alpha 2.0 Rotation Tag */}
                <div className="px-2 pt-3 pb-1 flex items-center justify-between text-[8px] font-black uppercase tracking-widest text-slate-500">
                    <span>Alpha 2.0 Rotation</span>
                    <span className={
                        (sector.sector_change_percent ?? 0) >= 1 ? 'text-emerald-500'
                        : (sector.sector_change_percent ?? 0) <= -1 ? 'text-rose-500'
                        : 'text-amber-500'
                    }>
                        {(sector.sector_change_percent ?? 0) >= 1
                            ? 'LEADER · Buy Dips'
                            : (sector.sector_change_percent ?? 0) <= -1
                                ? 'LAGGARD · Avoid'
                                : 'NEUTRAL · Wait'}
                    </span>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-900 pt-4 relative z-10">
                  <div className="flex items-center justify-between text-[8px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest mb-3 px-2">
                    <span>Symbol Name</span>
                    <div className="flex items-center gap-4">
                      <span className="text-right w-16">Price / Pct</span>
                      <span className="text-right w-14">Force</span>
                    </div>
                  </div>
                  
                  <div className="space-y-1 max-h-[220px] overflow-y-auto custom-scrollbar pr-0.5">
                    {sortedStocks.map((stock) => {
                      const isStockGreen = (stock.change_per || 0) >= 0;
                      const score = stock.current_score || 0;
                      const isScoreGreen = score >= 0;

                      return (
                        <div 
                          key={stock.symbol_name} 
                          onClick={() => {
                            const stdStock = {
                              Symbol: stock.symbol_name,
                              LTP: stock.last_trade_price || 0,
                              Change: stock.change_per || 0,
                              "Strength Factor": score,
                              CompanyName: stock.company_name || '',
                              Sector: sector.sector,
                              Open: stock.open || 0,
                              High: stock.high || 0,
                              Low: stock.low || 0,
                              Close: stock.close || 0,
                              Volume: stock.volume || 0,
                              prevClose: (stock.close || 0) - (stock.change_value || 0),
                              todayOpen: stock.open || 0
                            };
                            setSelectedStock(stdStock as any);
                            openTradingView(stock.symbol_name);
                          }}
                          className="flex items-center justify-between py-2 px-2.5 hover:bg-slate-50 dark:hover:bg-slate-900/60 border border-transparent hover:border-slate-200 dark:hover:border-slate-800/80 rounded-xl transition-all duration-200 cursor-pointer group/row"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-900 dark:text-slate-200 group-hover/row:text-indigo-600 dark:group-hover/row:text-sky-400 transition-colors tracking-tight">
                              {stock.symbol_name}
                            </span>
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover/row:opacity-100 text-slate-400 transition-all" />
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="flex flex-col items-end w-16">
                              <span className="text-[10px] font-bold text-slate-900 dark:text-slate-300 font-mono">
                                {formatCurrencyPrecise(stock.last_trade_price || 0)}
                              </span>
                              <span className={`text-[8px] font-black font-mono leading-none ${
                                isStockGreen ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {isStockGreen ? '+' : ''}{(stock.change_per || 0).toFixed(1)}%
                              </span>
                            </div>

                            <span className={`text-xs font-black font-mono text-right w-14 tracking-tight tabular-nums ${
                              isScoreGreen ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                            }`}>
                              {isScoreGreen ? '+' : ''}{score.toFixed(0)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default SectorBoosterPanel;
