import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Award,
  CheckCircle2,
  XCircle,
  Info,
  ExternalLink,
  Database,
  ShieldCheck,
  ShieldAlert,
  X,
  Sparkles,
  Loader2
} from 'lucide-react';
import { VerdictResult, VerdictSignal } from '../../services/alpha/VerdictEngine';
import { openTradingView } from '../../utils/navigation';
import { alphaEngineService } from '../../services/AlphaEngineService';
import { formatINR } from '../../utils/indianFormatter';
import { IndianNumber } from '../shared/IndianNumber';

interface AlphaVerdictPanelProps {
  result: VerdictResult | null;
  variant?: 'badge' | 'detail';
  onOpenDetail?: () => void;
  onClose?: () => void;
  symbol?: string;
  stock?: any; // Full stock object containing PE, Volume, Market Cap
}

export const AlphaVerdictPanel: React.FC<AlphaVerdictPanelProps> = ({
  result,
  variant = 'badge',
  onOpenDetail,
  onClose,
  symbol,
  stock
}) => {
  const [aiOverlay, setAiOverlay] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    if (variant === 'detail' && stock && !aiOverlay) {
      setIsAiLoading(true);
      alphaEngineService.interpretSignalAI(stock).then(text => {
        setAiOverlay(text);
        setIsAiLoading(false);
      }).catch(() => setIsAiLoading(false));
    }
  }, [variant, stock]);

  if (!result) return null;

  const {
    totalScore,
    maxScore,
    verdict,
    verdictColor,
    signals,
    dataCompleteness,
    computedAt
  } = result;

  // Sentiment colors and styles
  const getBadgeStyles = () => {
    switch (verdict) {
      case 'HIGH CONVICTION':
        return {
          dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
          pill: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:border-emerald-500/40'
        };
      case 'MODERATE':
        return {
          dot: 'bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.8)]',
          pill: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 hover:border-indigo-500/40'
        };
      case 'SPECULATIVE':
        return {
          dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
          pill: 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:border-amber-500/40'
        };
      case 'AVOID':
      default:
        return {
          dot: 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.8)]',
          pill: 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:border-rose-500/40'
        };
    }
  };

  const styles = getBadgeStyles();

  if (variant === 'badge') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (onOpenDetail) onOpenDetail();
        }}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider transition-all duration-200 ${styles.pill} cursor-pointer`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
        <span>{totalScore}/{maxScore}</span>
      </button>
    );
  }

  // Count active signals and missing data warnings
  const earnedSignals = signals.filter(s => s.earned);
  const missedSignals = signals.filter(s => !s.earned);

  return (
    <div className="text-slate-100 font-sans w-full max-w-3xl bg-slate-950/95 backdrop-blur-2xl rounded-3xl border border-slate-800/80 overflow-hidden shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)]">
      {/* Detail Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 bg-slate-900/40 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Award className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-black tracking-wider text-white">ALPHA VERDICT</h3>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
              {symbol} · {computedAt}
            </p>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800/80 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Main Grid Content */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Left Column: Verdict metrics & actions */}
        <div className="space-y-5">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900/60 to-slate-950/80 border border-slate-850 flex items-center justify-between">
            <div>
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Verdict Status</span>
              <span className={`text-sm font-black tracking-tight ${verdictColor.split(' ')[0]}`}>{verdict}</span>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[9px] font-bold text-slate-400">Data Completeness:</span>
                <span className={`text-[9px] font-black font-mono px-1.5 py-0.5 rounded ${dataCompleteness >= 80
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : dataCompleteness >= 50
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-rose-500/10 text-rose-400'
                  }`}>
                  {dataCompleteness}%
                </span>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center w-16 h-16 rounded-2xl border border-slate-800/80 bg-slate-950/60 shadow-inner">
              <span className="text-2xl font-black text-white font-mono">{totalScore}</span>
              <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">/ {maxScore}</span>
            </div>
          </div>

          {/* Key Fundamental & Volatility Metrics Bar */}
          {stock && (
            <div className="grid grid-cols-3 gap-3 p-1">
              <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-900 flex flex-col justify-between">
                <span className="text-[7.5px] font-black text-slate-500 uppercase tracking-widest block mb-1">Market Cap</span>
                <span className="text-[11px] font-mono font-black tracking-tight text-indigo-400">
                  {stock.MarketCap || (stock as any).market_cap ? (
                    <IndianNumber
                      value={Math.round(stock.MarketCap || (stock as any).market_cap)}
                      notation="full"
                      suffix=" Cr"
                      tabular
                    />
                  ) : (
                    'N/A'
                  )}
                </span>
              </div>
              <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-900 flex flex-col justify-between">
                <span className="text-[7.5px] font-black text-slate-500 uppercase tracking-widest block mb-1">P/E Ratio</span>
                <span className="text-[11px] font-mono font-black tracking-tight text-amber-400 font-bold">
                  {stock.PE || (stock as any).stock_p_e ? (stock.PE || (stock as any).stock_p_e).toFixed(1) : 'N/A'}
                </span>
              </div>
              <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-900 flex flex-col justify-between">
                <span className="text-[7.5px] font-black text-slate-500 uppercase tracking-widest block mb-1">Volume</span>
                <span className="text-[11px] font-mono font-black tracking-tight text-white font-bold">
                  {stock.Volume || (stock as any).volume ? (
                    <IndianNumber
                      value={stock.Volume || (stock as any).volume}
                      showRupee={false}
                      notation="auto"
                      tabular
                    />
                  ) : (
                    'N/A'
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Score Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[8px] font-black text-slate-500 uppercase tracking-widest">
              <span>Score weight</span>
              <span>{totalScore} of {maxScore} Points</span>
            </div>
            <div className="h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800/50 p-0.5">
              <div
                className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${verdict === 'HIGH CONVICTION'
                    ? 'from-emerald-500 to-teal-400 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
                    : verdict === 'MODERATE'
                      ? 'from-indigo-500 to-purple-400 shadow-[0_0_10px_rgba(99,102,241,0.3)]'
                      : verdict === 'SPECULATIVE'
                        ? 'from-amber-500 to-orange-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                        : 'from-rose-500 to-red-400 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                  }`}
                style={{ width: `${(totalScore / maxScore) * 100}%` }}
              />
            </div>
          </div>

          {/* Data Quality Notice */}
          {dataCompleteness < 70 && (
            <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl flex gap-2">
              <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[9px] text-slate-400 leading-normal font-semibold">
                <strong className="text-amber-400 font-black block mb-0.5">LOW CACHE COVERAGE ({dataCompleteness}%)</strong>
                Visit other Shadow Screener tabs (ORB, Candlesticks, Shareholding, Valuation, Quality) to cache more stock data points and improve verdict confidence.
              </p>
            </div>
          )}

          {/* Action Button */}
          {symbol && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => openTradingView(symbol)}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 rounded-xl text-[10px] font-black text-white hover:shadow-[0_0_15px_rgba(99,102,241,0.3)] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open TradingView
              </button>
            </div>
          )}

          {/* AI Intelligence Overlay */}
          <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 relative overflow-hidden group">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
              <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Intelligence Overlay</span>
              {isAiLoading && <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />}
            </div>
            <p className="text-[11px] font-semibold text-slate-300 leading-relaxed italic">
              {isAiLoading ? "Synthesizing market context..." : aiOverlay || "Analyzing qualitative signal strength..."}
            </p>
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 blur-3xl rounded-full -mr-12 -mt-12 group-hover:bg-indigo-500/10 transition-colors" />
          </div>
        </div>

        {/* Right Column: Factors Checklist */}
        <div className="space-y-2 flex flex-col h-full">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">Confluence Checklist</span>
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 no-scrollbar flex-1">
            {signals.map((sig, idx) => (
              <div
                key={idx}
                className={`flex items-start justify-between p-2.5 rounded-xl border text-xs transition-colors ${sig.earned
                    ? 'bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10'
                    : 'bg-slate-950/40 border-slate-900 hover:bg-slate-900/20'
                  }`}
              >
                <div className="flex gap-2.5">
                  {sig.earned ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className={`font-black tracking-tight ${sig.earned ? 'text-white' : 'text-slate-500'}`}>
                      {sig.label}
                    </span>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5 leading-normal">
                      {sig.description}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <span className={`text-[10px] font-black font-mono ${sig.earned ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {sig.earned ? `+${sig.points}` : '+0'}
                  </span>
                  <span className="text-[8px] font-bold text-slate-500 block uppercase tracking-widest mt-1">
                    {sig.source}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
export default AlphaVerdictPanel;
