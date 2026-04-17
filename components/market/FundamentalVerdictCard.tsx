import React, { useState, useEffect, useMemo } from 'react';
import { upstoxMarketDataService } from '../../services/UpstoxMarketDataService';
import { FundamentalVerdictEngine, FundamentalVerdict } from '../../services/alpha/FundamentalVerdictEngine';
import { Shield, ShieldCheck, ShieldAlert, Award, Star, Activity, AlertCircle } from 'lucide-react';

interface FundamentalVerdictCardProps {
  symbol: string;
}

export default function FundamentalVerdictCard({ symbol }: FundamentalVerdictCardProps) {
  const [verdict, setVerdict] = useState<FundamentalVerdict | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    const loadVerdict = async () => {
      try {
        const resolved = await upstoxMarketDataService.resolveSymbol(symbol);
        const resolvedIsin = resolved?.isin || 'MOCK_' + symbol;

        // Fetch fundamental aspects in parallel
        const [profData, ratioData, shareData, compData, bsData, cfData, incData] = await Promise.all([
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'profile', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'key-ratios', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'shareholding', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'competitors', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'balance-sheet', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'cash-flow', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'income-statement', symbol),
        ]);

        if (!active) return;

        const aspects = {
          'profile': profData,
          'key-ratios': ratioData,
          'shareholding': shareData,
          'competitors': compData,
          'balance-sheet': bsData,
          'cash-flow': cfData,
          'income-statement': incData
        };

        const result = FundamentalVerdictEngine.generateVerdict(aspects);
        setVerdict(result);
      } catch (err) {
        console.error('Failed to load fundamental verdict for ' + symbol, err);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadVerdict();

    return () => {
      active = false;
    };
  }, [symbol]);

  const ratingBadges = useMemo(() => {
    if (!verdict) return [];

    const getQualityColor = (quality: string) => {
      if (quality === 'excellent' || quality === 'strong' || quality === 'surplus' || quality === 'accumulation' || quality === 'cheap') {
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      }
      if (quality === 'weak' || quality === 'distressed' || quality === 'negative' || quality === 'distribution' || quality === 'expensive') {
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      }
      if (quality === 'leveraged' || quality === 'marginal' || quality === 'premium') {
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      }
      return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
    };

    return [
      { label: 'Business', value: verdict.businessQuality, color: getQualityColor(verdict.businessQuality) },
      { label: 'Balance Sheet', value: verdict.balanceSheetStrength, color: getQualityColor(verdict.balanceSheetStrength) },
      { label: 'Cash Flow', value: verdict.cashFlowQuality, color: getQualityColor(verdict.cashFlowQuality) },
      { label: 'Ownership', value: verdict.ownershipTrend, color: getQualityColor(verdict.ownershipTrend) },
      { label: 'Valuation', value: verdict.valuationVsPeers, color: getQualityColor(verdict.valuationVsPeers) },
      { label: 'Corp Risk', value: verdict.corporateRisk, color: verdict.corporateRisk === 'high' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : verdict.corporateRisk === 'medium' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' }
    ];
  }, [verdict]);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col items-center justify-center py-10 text-slate-500 min-h-[200px]">
        <Activity className="w-5 h-5 animate-spin text-indigo-500 mb-2" />
        <span className="text-[10px] font-black uppercase tracking-widest">Synthesizing Quality Metrics...</span>
      </div>
    );
  }

  if (!verdict) return null;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4 select-none">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
          <Award size={16} className="text-indigo-500" />
          Fundamental Verdict
        </h3>
        {verdict.alphaConfirmation ? (
          <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
            <ShieldCheck size={10} /> Alpha Approved
          </span>
        ) : (
          <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 flex items-center gap-1">
            <Shield size={10} /> Neutral Stance
          </span>
        )}
      </div>

      {/* Ratios Synthesis List */}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        {ratingBadges.map((badge) => (
          <div key={badge.label} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850">
            <span className="text-slate-500 font-bold uppercase tracking-wider">{badge.label}</span>
            <span className={`font-black uppercase tracking-wide px-1.5 py-0.5 rounded border text-[8px] ${badge.color}`}>
              {badge.value}
            </span>
          </div>
        ))}
      </div>

      {/* Synthesis Verdict plain English */}
      <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-200/50 dark:border-slate-800/80 rounded-xl p-3 flex gap-2.5 items-start">
        {verdict.corporateRisk === 'high' ? (
          <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
        ) : verdict.alphaConfirmation ? (
          <Star className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5 fill-emerald-500" />
        ) : (
          <AlertCircle className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
        )}
        <div className="text-[10px] leading-relaxed text-slate-600 dark:text-slate-300 font-medium">
          <span className="font-black text-slate-800 dark:text-white block mb-0.5">Synthesis Review</span>
          {verdict.plainEnglishLabel}
        </div>
      </div>
    </div>
  );
}
