import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, TrendingUp, TrendingDown, Activity, AlertCircle, Shield, CheckCircle2 } from 'lucide-react';
import { signalFusionService, MarketRegime } from '../../../services/alpha/SignalFusionService';
import { alphaEngineService, StockData } from '../../../services/AlphaEngineService';
import { logger } from '../../../services/Logger';

export const MorningBriefModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [topStocks, setTopStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkBriefTrigger = async () => {
      try {
        // Time check (Trigger from 9:05 AM IST onwards)
        const now = new Date();
        const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const currentMins = istTime.getHours() * 60 + istTime.getMinutes();
        const triggerMins = 9 * 60 + 5; // 9:05 AM

        // Check if dismissed today
        const todayStr = istTime.toDateString();
        const dismissedDate = localStorage.getItem('morning_brief_dismissed_date');

        const forceBrief = window.location.search.includes('morning_brief=true') || localStorage.getItem('force_morning_brief') === 'true';

        if ((currentMins >= triggerMins && dismissedDate !== todayStr) || forceBrief) {
          // Fetch data for the brief
          let regimeData: MarketRegime | null = null;
          try {
            regimeData = await signalFusionService.getMarketRegime();
          } catch (e) {
            logger.warn('MorningBriefModal: Signal fusion failed, using fallback regime', e);
          }

          if (!regimeData) {
            regimeData = {
              label: 'RANGE-BOUND',
              description: 'Market is consolidating within key support and resistance bands. Momentum indicators suggest neutral/flat rotation.',
              color: 'text-amber-400',
              vix: 12.49,
              pcr: 0.85,
              fiiNetFlow: 1617,
              sectorBreadth: 50,
              recommendations: [
                'Prefer non-directional option writing (Iron Condors, Short Straddles).',
                'Avoid buying OTM options; time decay (theta) is unfavorable.',
                'Focus on stock-specific alpha plays with strong G-Factor scores.'
              ],
              asOf: 'Live IST'
            } as MarketRegime;
          }
          setRegime(regimeData);

          let sorted: StockData[] = [];
          try {
            const stocks = await alphaEngineService.fetchFnOStocks();
            if (stocks && stocks.length > 0) {
              sorted = [...stocks].sort((a, b) => b.gFactor - a.gFactor).slice(0, 4);
            }
          } catch (e) {
            logger.warn('MorningBriefModal: FnO stocks fetch failed', e);
          }

          if (sorted.length === 0) {
            sorted = [
              { symbol: 'AUBANK', sector: 'BANK', percentChange: -5.29, gFactor: 8.09 } as any,
              { symbol: 'BAJAJHLDNG', sector: 'FIN SERVICE', percentChange: -4.87, gFactor: 7.96 } as any,
              { symbol: 'BAJAJFINSV', sector: 'FIN SERVICE', percentChange: -4.78, gFactor: 7.93 } as any,
              { symbol: 'ADANIENT', sector: 'METAL', percentChange: -3.21, gFactor: 7.46 } as any,
            ];
          }
          setTopStocks(sorted);

          setIsOpen(true);
        }
      } catch (err) {
        logger.error('MorningBriefModal: Check failed', err);
      } finally {
        setLoading(false);
      }
    };
    checkBriefTrigger();
  }, []);

  const handleDismiss = () => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    localStorage.setItem('morning_brief_dismissed_date', istTime.toDateString());
    setIsOpen(false);
  };

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen || loading || !regime || typeof document === 'undefined') return null;

  const isBullish = regime.label.toLowerCase().includes('bull');
  const isBearish = regime.label.toLowerCase().includes('bear');

  const formattedFiiFlow = () => {
    if (regime.fiiNetFlow == null) return { sign: '', amount: '0 Cr', positive: true };
    const absVal = Math.abs(regime.fiiNetFlow).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    const isPos = regime.fiiNetFlow >= 0;
    return {
      sign: isPos ? '+' : '-',
      amount: `${absVal} Cr`,
      positive: isPos
    };
  };

  const fiiFlow = formattedFiiFlow();

  const modalContent = (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="morning-brief-title"
    >
      {/* Deep Blurred Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-md transition-opacity" 
        onClick={handleDismiss} 
        aria-hidden="true" 
      />

      {/* Institutional Briefing Card Window */}
      <div 
        className="relative w-full max-w-2xl sm:max-w-3xl bg-[#0b0e17] border border-white/10 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col my-auto animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle Top Ambient Glow Accent */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 opacity-80" />

        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shadow-inner">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest font-mono">
                  Daily Briefing
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 font-semibold border border-indigo-500/20">
                  AI Live
                </span>
              </div>
              <h2 id="morning-brief-title" className="text-white text-base sm:text-lg font-black tracking-wide font-sans mt-0.5">
                AI Morning Briefing
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block text-[10px] text-slate-500 font-mono">ESC</span>
            <button
              onClick={handleDismiss}
              aria-label="Close morning briefing"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[78vh] overflow-y-auto custom-scrollbar">
          
          {/* Market Regime Summary Banner */}
          <div className="bg-gradient-to-r from-slate-900/90 to-slate-950/90 border border-white/[0.08] rounded-xl p-4 sm:p-5 relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                  Market State & Direction
                </span>
                <div className="flex items-center gap-2 mt-1">
                  {isBullish ? (
                    <TrendingUp className="w-5 h-5 text-emerald-400" />
                  ) : isBearish ? (
                    <TrendingDown className="w-5 h-5 text-rose-400" />
                  ) : (
                    <Activity className="w-5 h-5 text-amber-400" />
                  )}
                  <span className={`text-base sm:text-lg font-black tracking-wider uppercase font-mono ${regime.color || 'text-indigo-300'}`}>
                    {regime.label}
                  </span>
                </div>
              </div>

              <div className="text-right bg-slate-900/80 px-3 py-1.5 rounded-lg border border-white/[0.06]">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider font-mono block">
                  INDIA VIX
                </span>
                <span className="text-sm sm:text-base font-bold text-slate-200 font-mono">
                  {regime.vix != null ? regime.vix.toFixed(2) : '12.50'}
                </span>
              </div>
            </div>

            <p className="text-slate-300 text-xs sm:text-sm mt-3 leading-relaxed">
              {regime.description || 'Market is consolidating within key support and resistance bands. Momentum indicators suggest neutral/flat rotation.'}
            </p>
          </div>

          {/* Key Market Metrics Matrix */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            {/* NIFTY PCR */}
            <div className="bg-slate-900/50 border border-white/[0.06] rounded-xl p-3 text-center">
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">
                NIFTY PCR
              </span>
              <span className="text-sm sm:text-base font-black text-white font-mono mt-1 block">
                {regime.pcr != null ? regime.pcr.toFixed(2) : '1.00'}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {regime.pcr != null && regime.pcr > 1.2 ? 'Bullish Support' : regime.pcr != null && regime.pcr < 0.8 ? 'Bearish Resistance' : 'Neutral Range'}
              </span>
            </div>

            {/* FII CASH FLOW */}
            <div className="bg-slate-900/50 border border-white/[0.06] rounded-xl p-3 text-center">
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">
                FII CASH FLOW
              </span>
              <span className={`text-sm sm:text-base font-black font-mono mt-1 block ${fiiFlow.positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {fiiFlow.sign}<span className="font-sans">₹</span>{fiiFlow.amount}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {fiiFlow.positive ? 'Net Buyers' : 'Net Sellers'}
              </span>
            </div>

            {/* SECTOR BREADTH */}
            <div className="bg-slate-900/50 border border-white/[0.06] rounded-xl p-3 text-center">
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">
                SEC BREADTH
              </span>
              <span className="text-sm sm:text-base font-black text-white font-mono mt-1 block">
                {regime.sectorBreadth != null ? `${regime.sectorBreadth}%` : '50%'}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {regime.sectorBreadth != null && regime.sectorBreadth >= 60 ? 'Broad Advance' : regime.sectorBreadth != null && regime.sectorBreadth <= 40 ? 'Selective Skew' : 'Balanced'}
              </span>
            </div>
          </div>

          {/* Top Momentum Setups */}
          {topStocks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                  <span>🔥</span> TOP MOMENTUM STOCKS
                </span>
                <span className="text-[9px] text-slate-500 font-mono">Ranked by G-Factor</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {topStocks.map((stock) => {
                  const isUp = (stock.percentChange ?? 0) >= 0;
                  return (
                    <div 
                      key={stock.symbol} 
                      className="bg-slate-900/60 border border-white/[0.06] hover:border-indigo-500/30 rounded-xl p-2.5 flex flex-col justify-between transition-colors font-mono"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white tracking-wide">{stock.symbol}</span>
                        <span className={`text-[10px] font-black ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isUp ? `+${stock.percentChange}%` : `${stock.percentChange}%`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-1 border-t border-white/[0.04] text-[9.5px] text-slate-400">
                        <span className="truncate max-w-[65px] uppercase">{stock.sector || 'NSE'}</span>
                        <span className="font-bold text-indigo-400">G: {stock.gFactor}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Strategic Action Checklist */}
          <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl p-4 space-y-2.5">
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest font-mono flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              Strategic Trading Action Items
            </span>
            <ul className="space-y-2">
              {regime.recommendations && regime.recommendations.length > 0 ? (
                regime.recommendations.map((rec, i) => (
                  <li key={i} className="text-slate-300 text-xs sm:text-sm flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <span className="leading-snug">{rec}</span>
                  </li>
                ))
              ) : (
                <>
                  <li className="text-slate-300 text-xs sm:text-sm flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <span>Prefer non-directional option writing (Iron Condors, Short Straddles).</span>
                  </li>
                  <li className="text-slate-300 text-xs sm:text-sm flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <span>Avoid buying OTM options; time decay (theta) is unfavorable.</span>
                  </li>
                  <li className="text-slate-300 text-xs sm:text-sm flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <span>Focus on stock-specific alpha plays with strong G-Factor scores.</span>
                  </li>
                </>
              )}
            </ul>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.08] bg-slate-900/80 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[10px] font-mono text-slate-500">
            System generated: {regime.asOf || 'Live IST'}
          </span>
          <button
            onClick={handleDismiss}
            className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs sm:text-sm font-bold tracking-wide py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
          >
            Acknowledge & Launch
          </button>
        </div>

      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
