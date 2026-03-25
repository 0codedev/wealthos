import React, { useEffect, useState, useMemo } from 'react';
import { 
  Flame, ShieldCheck, Activity, RefreshCw, Zap, 
  ArrowUpRight, ArrowDownRight, Clock, Target, AlertTriangle, ChevronRight
} from 'lucide-react';
import { quantGreeksService, HeroZeroResponse, HeroZeroCandidate, IVRankData } from '../../../services/QuantGreeksService';

export interface HeroZeroScannerCardProps {
  symbol?: 'NIFTY' | 'BANKNIFTY';
  onStrikeSelect?: (strike: number, optionType: 'CE' | 'PE') => void;
}

export const HeroZeroScannerCard: React.FC<HeroZeroScannerCardProps> = ({
  symbol = 'NIFTY',
  onStrikeSelect
}) => {
  const [activeSymbol, setActiveSymbol] = useState<'NIFTY' | 'BANKNIFTY'>(symbol);
  const [hzData, setHzData] = useState<HeroZeroResponse | null>(null);
  const [ivRank, setIvRank] = useState<IVRankData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = async (manual = false) => {
    if (manual) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const [hzRes, ivRes] = await Promise.all([
        quantGreeksService.fetchHeroZeroCandidates(activeSymbol),
        quantGreeksService.fetchIVRank(activeSymbol)
      ]);
      setHzData(hzRes);
      setIvRank(ivRes);
    } catch (err) {
      console.error('HeroZeroScannerCard load failed:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(false), 15000); // 15s refresh
    return () => clearInterval(interval);
  }, [activeSymbol]);

  const phaseBadge = useMemo(() => {
    const phase = hzData?.market_phase || 'OFF_SESSION';
    switch (phase) {
      case 'RISK_PARITY_GAMMA_ACTIVE':
        return {
          label: '14:04 RISK-PARITY ACTIVE',
          color: 'text-wa-bullish bg-wa-bullish-subtle border-wa-bullish/30 animate-pulse',
          desc: 'ER(u) ≤ 1.0 reached — Gamma buyers active'
        };
      case 'PRE_SCAN_FILTERING':
        return {
          label: '13:50 PRE-SCAN STAGE',
          color: 'text-wa-warning bg-wa-warning-subtle border-wa-warning/30',
          desc: 'Screening premium sweet-spot (₹10–₹35)'
        };
      case 'MANDATORY_SQUARE_OFF':
        return {
          label: '15:15 MANDATORY OFF-RAMP',
          color: 'text-wa-bearish bg-wa-bearish-subtle border-wa-bearish/30',
          desc: 'Hard square-off before cash settlement'
        };
      default:
        return {
          label: 'OFF-SESSION MONITORING',
          color: 'text-tf-text-muted bg-tf-bg-surface border-tf-border',
          desc: 'Hero-Zero active from 13:50 to 15:15 IST'
        };
    }
  }, [hzData?.market_phase]);

  const candidates = hzData?.candidates || [];
  const erValue = hzData?.risk_parity_er ?? 0;
  const isErTriggered = hzData?.risk_parity_breached ?? false;

  return (
    <div className="bg-tf-bg-card rounded-2xl p-4 md:p-6 border border-tf-border shadow-2xl flex flex-col gap-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-tf-border-subtle pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-black text-tf-text-primary uppercase tracking-tight flex items-center gap-2">
              <Zap className="w-5 h-5 text-wa-warning" />
              2:00 PM Hero-Zero Gamma Scanner
            </h3>
            <button
              type="button"
              onClick={() => loadData(true)}
              className="p-1.5 rounded-lg bg-tf-bg-surface border border-tf-border hover:border-tf-border-hover text-tf-text-secondary transition-colors"
              title="Refresh Scanner"
            >
              <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-tf-text-muted text-xs font-mono mt-0.5">
            Mathematical Risk-Parity $ER(u) = 1.0$ at 14:04 IST • Institutional Convexity Engine
          </p>
        </div>

        {/* Index Selector & Phase Badge */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="flex items-center bg-tf-bg-surface rounded-lg p-0.5 border border-tf-border">
            {(['NIFTY', 'BANKNIFTY'] as const).map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => setActiveSymbol(sym)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                  activeSymbol === sym
                    ? 'bg-wa-accent text-tf-text-primary shadow-sm'
                    : 'text-tf-text-muted hover:text-tf-text-secondary'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>

          <div className={`px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wider ${phaseBadge.color}`}>
            {phaseBadge.label}
          </div>
        </div>
      </div>

      {/* Quantitative Surface Telemetry HUD */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* Risk-Parity Ratio ER */}
        <div className="bg-tf-bg-surface border border-tf-border rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] uppercase font-bold text-tf-text-muted">Risk-Parity ER(u)</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className={`font-mono text-lg font-black ${isErTriggered ? 'text-wa-bullish' : 'text-tf-text-primary'}`}>
              {erValue.toFixed(3)}
            </span>
            <span className="text-[9px] font-mono text-tf-text-muted">
              {isErTriggered ? '≤ 1.0 (PARITY)' : 'Target: 1.0'}
            </span>
          </div>
          <span className="text-[9px] text-tf-text-muted mt-1">14:04 IST Mathematical Flip</span>
        </div>

        {/* 52-Week IV Rank */}
        <div className="bg-tf-bg-surface border border-tf-border rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] uppercase font-bold text-tf-text-muted">52-Week IV Rank</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="font-mono text-lg font-black text-tf-text-primary">
              {ivRank ? `${ivRank.iv_rank.toFixed(1)}%` : '--'}
            </span>
            <span className="text-[9px] font-mono text-wa-accent">
              {ivRank ? `IVP: ${ivRank.iv_percentile.toFixed(0)}%` : ''}
            </span>
          </div>
          <span className="text-[9px] text-tf-text-muted mt-1 truncate">
            {ivRank ? ivRank.regime.replace(/_/g, ' ') : 'ATM Volatility'}
          </span>
        </div>

        {/* Dealer Net GEX */}
        <div className="bg-tf-bg-surface border border-tf-border rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] uppercase font-bold text-tf-text-muted">Dealer Net GEX</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className={`font-mono text-lg font-black ${(hzData?.net_gex_crores ?? 0) < 0 ? 'text-wa-bearish' : 'text-wa-bullish'}`}>
              {hzData ? `₹${hzData.net_gex_crores.toFixed(1)} Cr` : '--'}
            </span>
          </div>
          <span className="text-[9px] text-tf-text-muted mt-1">
            {(hzData?.net_gex_crores ?? 0) < 0 ? 'Short Gamma (Trending)' : 'Long Gamma (Pinning)'}
          </span>
        </div>

        {/* Zero-Gamma Flip */}
        <div className="bg-tf-bg-surface border border-tf-border rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] uppercase font-bold text-tf-text-muted">Zero-Gamma Level</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="font-mono text-lg font-black text-wa-warning">
              {hzData ? `₹${hzData.zero_gamma_level.toFixed(0)}` : '--'}
            </span>
            <span className="text-[9px] font-mono text-tf-text-muted">
              Spot: {hzData ? `₹${hzData.spot.toFixed(0)}` : '--'}
            </span>
          </div>
          <span className="text-[9px] text-tf-text-muted mt-1">Convexity Acceleration Line</span>
        </div>
      </div>

      {/* Candidates List / Matrix */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-tf-text-secondary px-1">
          <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-wa-warning" />
            Screened Hero-Zero Opportunities ({candidates.length})
          </span>
          <span className="text-[10px] font-mono text-tf-text-muted">
            Filtered: ₹10–₹35 Premium • Δ: 0.08–0.22
          </span>
        </div>

        {isLoading && candidates.length === 0 ? (
          <div className="bg-tf-bg-surface rounded-xl p-8 border border-tf-border flex flex-col items-center justify-center gap-2">
            <Activity className="w-6 h-6 text-wa-accent animate-spin" />
            <span className="text-xs font-mono text-tf-text-muted">Scanning chain convexity surfaces...</span>
          </div>
        ) : candidates.length === 0 ? (
          <div className="bg-tf-bg-surface rounded-xl p-6 border border-tf-border text-center flex flex-col items-center justify-center gap-1.5">
            <ShieldCheck className="w-6 h-6 text-tf-text-muted" />
            <span className="text-xs font-bold text-tf-text-primary">No Explosive Strikes Detected</span>
            <span className="text-[11px] text-tf-text-muted max-w-md">
              No OTM strikes currently satisfy the strict liquidity, delta, and bid-ask spread filters. Scanner continuously monitors ticks.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {candidates.map((cand) => {
              const isCall = cand.option_type === 'CE';
              return (
                <div
                  key={`${cand.strike}_${cand.option_type}`}
                  onClick={() => onStrikeSelect?.(cand.strike, cand.option_type)}
                  className="bg-tf-bg-surface hover:bg-tf-bg-elevated border border-tf-border hover:border-tf-border-hover rounded-xl p-3.5 transition-all cursor-pointer flex flex-col justify-between gap-3 group"
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                        isCall ? 'bg-wa-bullish-subtle text-wa-bullish' : 'bg-wa-bearish-subtle text-wa-bearish'
                      }`}>
                        {cand.option_type}
                      </span>
                      <span className="font-mono text-base font-black text-tf-text-primary">
                        {cand.strike}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="font-mono text-sm font-black text-tf-text-primary block">
                        ₹{cand.ltp.toFixed(2)}
                      </span>
                      <span className="text-[9px] font-mono text-tf-text-muted">
                        Δ {cand.delta.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Quantitative Metrics Bar */}
                  <div className="grid grid-cols-3 gap-1.5 bg-tf-bg-card rounded-lg p-2 border border-tf-border-subtle text-center font-mono text-[10px]">
                    <div>
                      <span className="text-[8px] uppercase text-tf-text-muted block">Score</span>
                      <span className="font-black text-wa-warning">{cand.convexity_score.toFixed(1)}</span>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase text-tf-text-muted block">Gamma</span>
                      <span className="font-medium text-tf-text-secondary">{cand.gamma.toFixed(4)}</span>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase text-tf-text-muted block">OI</span>
                      <span className="font-medium text-tf-text-secondary">{(cand.oi / 1000).toFixed(0)}k</span>
                    </div>
                  </div>

                  {/* Targets & Stop Boundaries */}
                  <div className="flex items-center justify-between font-mono text-[10px] border-t border-tf-border-subtle pt-2">
                    <div>
                      <span className="text-[8px] uppercase text-tf-text-muted block">Stop (-50%)</span>
                      <span className="font-bold text-wa-bearish">₹{cand.stop_loss.toFixed(1)}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-[8px] uppercase text-tf-text-muted block">Target 1 (2x)</span>
                      <span className="font-bold text-wa-bullish">₹{cand.target_1.toFixed(1)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[8px] uppercase text-tf-text-muted block">Target 2 (3x)</span>
                      <span className="font-bold text-wa-accent">₹{cand.target_2.toFixed(1)}</span>
                    </div>
                  </div>

                  {/* Footer Action */}
                  <div className="flex items-center justify-between text-[9px] text-tf-text-muted font-mono pt-1">
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> Exit 15:15 IST
                    </span>
                    <span className="text-wa-accent group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                      Select Strike <ChevronRight size={10} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Execution Discipline & Rules Footer */}
      <div className="bg-tf-bg-surface border border-tf-border-subtle rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[10px] font-mono text-tf-text-muted">
        <div className="flex items-center gap-1.5 text-wa-warning">
          <AlertTriangle size={12} />
          <span className="font-bold uppercase tracking-wider">Trading Mandate:</span>
          <span>Target: 2.0x–3.0x | Stop: -50% | Hard Square-Off: 15:15 IST</span>
        </div>
        <div className="text-tf-text-secondary">
          Zero-Guesswork Black-76 Surface • WealthOS WP01
        </div>
      </div>
    </div>
  );
};

export default HeroZeroScannerCard;
