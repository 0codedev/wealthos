import React from 'react';
import { 
  Activity, 
  TrendingUp, 
  Clock, 
  BarChart3, 
  Calendar, 
  PieChart, 
  Award, 
  Radio, 
  Compass, 
  Target,
  Layers,
  Users,
  Eye,
  Camera
} from 'lucide-react';


interface ScreenerGridMenuProps {
  setShadowMode: (mode: any) => void;
  fetchCandlestickData: () => void;
  fetchHistoricalData: () => void;
  fetchORBData: () => void;
  fetchValuationData: () => void;
  fetchResultsCalendarData: () => void;
  fetchShareholdingData: () => void;
  fetchQualityData: () => void;
  fetchPulseProxy: () => void;
  fetchLotSizesData: () => void;
  fetchFiiDiiAllData?: () => void;
  fetchPrebuildScreensAction?: () => void;
  convergenceResults: any[];
}

export const ScreenerGridMenu: React.FC<ScreenerGridMenuProps> = ({
  setShadowMode,
  fetchCandlestickData,
  fetchHistoricalData,
  fetchORBData,
  fetchValuationData,
  fetchResultsCalendarData,
  fetchShareholdingData,
  fetchQualityData,
  fetchPulseProxy,
  fetchLotSizesData,
  fetchFiiDiiAllData,
  fetchPrebuildScreensAction,
  convergenceResults,
}) => {
  const tools = [
    { id: 'candlestick', label: 'CandleSticks Screener', icon: Activity, color: 'text-orange-400', bg: 'bg-orange-500/10' },
    { id: 'tech_indicators_screener', label: 'Technical Indicators Screener', icon: Activity, color: 'text-violet-400', bg: 'bg-violet-500/10', badge: 'PRO' },
    { id: 'gainers', label: 'Top Gainers & Losers', icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { id: 'orb', label: 'Opening Range Breakout', icon: Clock, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { id: 'valuation', label: 'Intrinsic Value Audit', icon: BarChart3, color: 'text-indigo-400', bg: 'bg-indigo-500/10', badge: 'New' },
    { id: 'results', label: 'Earnings Calendar', icon: Calendar, color: 'text-rose-400', bg: 'bg-rose-500/10' },
    { id: 'shareholding', label: 'Institutional Radar', icon: PieChart, color: 'text-sky-400', bg: 'bg-sky-500/10' },
    { id: 'quality', label: 'Quality Scorecard', icon: Award, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { id: 'momentum', label: 'Momentum Hub (News)', icon: Radio, color: 'text-orange-400', bg: 'bg-orange-500/10', badge: 'Live' },
    { id: 'fno_movements', label: 'FnO Movements (Legacy)', icon: Compass, color: 'text-teal-400', bg: 'bg-teal-500/10' },
    { id: 'lot_size', label: 'F&O Lot Sizes', icon: Layers, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
    { id: 'fii_dii_pulse', label: 'FII/DII Sentiment & Radar', icon: TrendingUp, color: 'text-amber-400', bg: 'bg-amber-500/10', badge: 'Hot' },
    { id: 'delivery_radar', label: 'Institutional Delivery Radar', icon: BarChart3, color: 'text-sky-400', bg: 'bg-sky-500/10', badge: 'Stealth' },
    { id: 'insider_intelligence', label: 'Insider Governance Tracker', icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10', badge: 'Stealth' },
    { id: 'mf_flows', label: 'MF Smart Money Flow', icon: PieChart, color: 'text-indigo-400', bg: 'bg-indigo-500/10', badge: 'Stealth' },
    { id: 'order_flow', label: 'Order Flow Analytics', icon: Activity, color: 'text-indigo-400', bg: 'bg-indigo-500/10', badge: 'Apex' },
    { id: 'oi_command_center', label: 'OI / PCR Command Center', icon: Target, color: 'text-amber-400', bg: 'bg-amber-500/10', badge: 'Hot' },
    { id: 'smart_watchlist', label: 'Smart Watchlist', icon: Eye, color: 'text-cyan-400', bg: 'bg-cyan-500/10', badge: 'Apex' },
    { id: 'smartlist_radar', label: 'Smartlist Radar', icon: Layers, color: 'text-rose-455', bg: 'bg-rose-500/10', badge: 'Apex' },
    { id: 'snapshot_timeline', label: 'Snapshot Replay', icon: Camera, color: 'text-sky-400', bg: 'bg-sky-500/10', badge: 'Apex' },
  ];


  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4 md:gap-6">
      {tools.map((tool) => (
        <button
          key={tool.label}
          onClick={() => {
            setShadowMode(tool.id as any);
            if (tool.id === 'candlestick') fetchCandlestickData();
            if (tool.id === 'tech_indicators_screener' && fetchPrebuildScreensAction) fetchPrebuildScreensAction();
            if (tool.id === 'gainers') fetchHistoricalData();
            if (tool.id === 'orb') fetchORBData();
            if (tool.id === 'valuation') fetchValuationData();
            if (tool.id === 'results') fetchResultsCalendarData();
            if (tool.id === 'shareholding') fetchShareholdingData();
            if (tool.id === 'quality') fetchQualityData();
            if (tool.id === 'fno_movements') fetchPulseProxy();
            if (tool.id === 'lot_size') fetchLotSizesData();
            if (tool.id === 'fii_dii_pulse' && fetchFiiDiiAllData) fetchFiiDiiAllData();
            if (tool.id === 'oi_command_center' && fetchFiiDiiAllData) fetchFiiDiiAllData();
          }}
          className="flex items-center gap-3 sm:gap-4 p-3.5 sm:p-5 md:p-6 bg-slate-900/40 border border-slate-800/60 rounded-2xl md:rounded-[2rem] hover:bg-slate-800/60 transition-all group text-left relative overflow-hidden active:scale-[0.98]"
        >
          <div className={`w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 ${tool.bg} rounded-xl md:rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105 shrink-0`}>
            <tool.icon className={tool.color} size={20} />
          </div>
          <div className="min-w-0 flex-1 pr-6 sm:pr-8">
            <h3 className="text-xs sm:text-sm md:text-base font-bold text-white tracking-tight leading-snug truncate sm:whitespace-normal">{tool.label}</h3>
            {tool.badge && (
              <span className="absolute top-2.5 right-2.5 sm:top-4 sm:right-4 px-1.5 py-0.5 bg-orange-600 text-white text-[7.5px] sm:text-[8px] font-black uppercase rounded-md shadow-md shadow-orange-500/20">
                {tool.badge}
              </span>
            )}
          </div>
        </button>
      ))}

      {/* CONVERGENCE ENGINE CARD */}
      <button
        onClick={() => {
          setShadowMode('convergence');
        }}
        className="flex items-center gap-3 sm:gap-4 p-3.5 sm:p-5 md:p-6 bg-slate-900/40 border border-indigo-500/30 rounded-2xl md:rounded-[2rem] hover:bg-slate-800/60 transition-all group text-left relative overflow-hidden sm:col-span-2 lg:col-span-3 active:scale-[0.98]"
      >
        <div className={`w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 bg-indigo-500/20 rounded-xl md:rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105 shrink-0`}>
          <Target className="text-indigo-400" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs sm:text-base md:text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <span>⚡ Convergence Engine</span>
            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[8px] sm:text-[9px] font-black uppercase tracking-wider rounded-md border border-amber-500/30">HOT</span>
          </h3>
          <p className="text-[10px] sm:text-xs font-medium text-slate-400 mt-0.5 sm:mt-1 tracking-normal line-clamp-2 sm:line-clamp-none">
            Cross-references 7 data modules for max conviction trades
            {convergenceResults.length > 0 && (
              <span className="ml-2 text-yellow-500 font-bold">
                ({convergenceResults.filter((r: any) => r.tier === 'PERFECT').length} Perfect)
              </span>
            )}
          </p>
        </div>
      </button>
    </div>
  );
};

export default ScreenerGridMenu;
