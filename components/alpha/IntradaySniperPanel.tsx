import React from 'react';
import { Upload, Clipboard, Info, Target, Zap } from 'lucide-react';
import { StockData } from './ShadowTerminal/StockTable';

interface IntradaySniperPanelProps {
  masterStocks: StockData[];
  isSniperActive: boolean;
  setIsSniperActive: (active: boolean) => void;
  stocks: StockData[];
  setStocks: (stocks: StockData[]) => void;
  setError: (error: string) => void;
  handleClipboardInjection: (source: 'master' | 'pulse' | 'sniper') => Promise<void>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const IntradaySniperPanel: React.FC<IntradaySniperPanelProps> = ({
  masterStocks,
  isSniperActive,
  setIsSniperActive,
  stocks,
  setStocks,
  setError,
  handleClipboardInjection,
  handleFileUpload,
}) => {
  return (
    <div className="p-6 bg-slate-900/40 border border-slate-800/60 rounded-[2rem] relative overflow-hidden backdrop-blur-md">
      {/* Title */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center">
          <Target className="text-indigo-400" size={20} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            Intraday Sniper Radar
            {isSniperActive && (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[8px] font-black uppercase tracking-wider rounded-md border border-emerald-500/20">
                ACTIVE
              </span>
            )}
          </h3>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">High-Strength Cash Breakouts</p>
        </div>
      </div>

      {/* Database Status Alert */}
      <div className={`p-4 rounded-2xl border mb-6 flex items-start gap-3 transition-all ${
        masterStocks.length > 0 
          ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400/80' 
          : 'bg-amber-500/5 border-amber-500/10 text-amber-400/80'
      }`}>
        <Zap size={16} className="mt-0.5 shrink-0" />
        <div className="text-xs">
          <span className="font-bold">
            {masterStocks.length > 0 ? 'Master Database Loaded' : 'Database Empty / Offline'}
          </span>
          <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
            {masterStocks.length > 0 
              ? `${masterStocks.length} tickers active. Toggle sniper mode below or paste sniper list.` 
              : 'Prime the scanner via live StockeZee proxy or paste Todayorb.json from Network > Response.'}
          </p>
        </div>
      </div>

      {/* Control Actions */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 text-white text-xs font-black rounded-2xl cursor-pointer transition-all active:scale-95 text-center shadow-lg shadow-indigo-600/10">
          <Upload size={14} />
          <span>Upload JSON</span>
          <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
        </label>
        <button
          onClick={() => handleClipboardInjection('sniper')}
          className="flex items-center justify-center gap-2 py-3 px-4 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/50 text-slate-200 text-xs font-black rounded-2xl transition-all active:scale-95"
        >
          <Clipboard size={14} />
          <span>Paste List</span>
        </button>
      </div>

      {/* Sniper Switch & Reset */}
      <div className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-850 rounded-2xl mb-6">
        <span className="text-xs font-black text-slate-300 uppercase tracking-wider">Sniper Filtering</span>
        <div className="flex items-center gap-3">
          {isSniperActive && (
            <button
              onClick={() => {
                setStocks(masterStocks);
                setIsSniperActive(false);
              }}
              className="text-[10px] font-black text-rose-400 hover:underline uppercase tracking-wider"
            >
              Reset
            </button>
          )}
          <button
            onClick={() => setIsSniperActive(!isSniperActive)}
            className={`w-10 h-6 rounded-full transition-all relative ${
              isSniperActive ? 'bg-emerald-500' : 'bg-slate-750 border border-slate-700'
            }`}
          >
            <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
              isSniperActive ? 'right-1' : 'left-1'
            }`} />
          </button>
        </div>
      </div>

      {/* Guide Info */}
      <div className="p-4 bg-slate-950/20 border border-slate-850 rounded-2xl flex gap-3 items-start">
        <Info size={16} className="text-slate-500 mt-0.5 shrink-0" />
        <div>
          <span className="text-xs font-bold text-slate-300">Quick Instructions</span>
          <ul className="list-disc list-inside text-[10px] text-slate-500 mt-2 space-y-1.5 leading-relaxed">
            <li>Open <span className="text-indigo-400">StockeZee Intraday</span></li>
            <li>Press <span className="font-bold">F12</span> and inspect Network tab</li>
            <li>Refresh page and locate <span className="text-indigo-400 font-mono">Todayorb.json</span></li>
            <li>Right click and select <span className="font-bold">Copy Response</span></li>
            <li>Click "Paste List" button above to inject!</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default IntradaySniperPanel;
