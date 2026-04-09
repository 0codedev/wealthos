import React, { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { Activity, TrendingDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../database';
import { Trade } from '../../../database';
import { usePortfolioStore } from '../../../store/portfolioStore';
import { JargonTooltip } from '../../shared/JargonTooltip';
import { CountUp } from '../../shared/CountUp';
import { ValueFlash } from '../../shared/ValueFlash';
import { quantEngine, RiskScorecard } from '../../../utils/QuantEngine';

interface RiskScoreCardWidgetProps {
    /** Optional click handler — defaults to navigating to /analytics → quant subtab. */
    onNavigate?: () => void;
    isPrivacyMode?: boolean;
}

/**
 * RiskScoreCardWidget — compact dashboard widget that surfaces the headline
 * risk-adjusted score (Sharpe + Sortino + Calmar) at a glance. Click anywhere
 * to open the full Deep Quant dashboard.
 */
export const RiskScoreCardWidget: React.FC<RiskScoreCardWidgetProps> = ({ onNavigate, isPrivacyMode = false }) => {
    const history = usePortfolioStore((s: { history: { date: string; value: number }[] }) => s.history);
    const [trades, setTrades] = useState<Trade[]>([]);
    const navigate = useNavigate();

    useEffect(() => {
        const sub = liveQuery(() => db.trades.toArray()).subscribe({
            next: (rows: Trade[]) => setTrades(rows),
        });
        return () => sub.unsubscribe();
    }, []);

    const scorecard: RiskScorecard = useMemo(() => {
        if (history && history.length >= 4) {
            const returns = quantEngine.toReturns(history.map((h: { date: string; value: number }) => h.value));
            return quantEngine.computeRiskScorecard(returns);
        }
        // Fallback: synthesize a noisy series from trade P&L so the UI is never empty
        if (trades.length >= 4) {
            const pnlSeries = trades.map(t => (t.pnl || 0) / 10000);
            return quantEngine.computeRiskScorecard(pnlSeries);
        }
        return quantEngine.computeRiskScorecard([]);
    }, [history, trades]);

    const headline = scorecard.sharpe;
    const grade = headline >= 1.5 ? 'A' : headline >= 1 ? 'B' : headline >= 0.5 ? 'C' : 'D';
    const gradeColor = grade === 'A' ? 'emerald' : grade === 'B' ? 'cyan' : grade === 'C' ? 'amber' : 'rose';

    const handleClick = () => {
        if (onNavigate) {
            onNavigate();
        } else {
            // Deep-link into Analytics → Deep Quant
            window.dispatchEvent(new CustomEvent('app:navigate', { detail: { category: 'analytics', subTab: 'quant' } }));
            navigate('/');
        }
    };

    return (
        <div
            onClick={handleClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick();
                }
            }}
            className="group relative h-full min-h-[180px] bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950 rounded-2xl border border-slate-800 p-4 shadow-xl cursor-pointer overflow-hidden transition-all hover:border-indigo-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
        >
            {/* Glow */}
            <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />

            <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-indigo-300">
                    <Activity className="w-3.5 h-3.5" />
                    Risk Score
                    <JargonTooltip term="Sharpe Ratio" />
                </div>
                <div className={`px-2 py-0.5 rounded-full text-[10px] font-black bg-${gradeColor}-500/20 text-${gradeColor}-300 border border-${gradeColor}-500/30`}>
                    Grade {grade}
                </div>
            </div>

            <div className="flex items-end gap-2 mb-3">
                <ValueFlash value={isPrivacyMode ? 0 : headline} className="text-4xl font-black text-slate-50 leading-none">
                    {isPrivacyMode ? (
                        <span>•••</span>
                    ) : (
                        <CountUp
                            value={headline}
                            startFromZero
                            decimals={2}
                            format={(n) => n.toFixed(2)}
                        />
                    )}
                </ValueFlash>
                <div className="text-[10px] text-slate-400 pb-1">Sharpe</div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
                <Mini label="Sortino" rawValue={scorecard.sortino} decimals={2} isPrivacyMode={isPrivacyMode} tooltipTerm="Sortino Ratio" />
                <Mini label="Calmar" rawValue={scorecard.calmar} decimals={2} isPrivacyMode={isPrivacyMode} tooltipTerm="Calmar" />
                <Mini label="Max DD" rawValue={-scorecard.maxDrawdownPct} decimals={1} isPrivacyMode={isPrivacyMode} suffix="%" tooltipTerm={undefined} icon={<TrendingDown className="w-3 h-3 inline" />} />
            </div>

            <div className="mt-3 flex items-center justify-end text-[10px] font-bold uppercase tracking-widest text-indigo-300 group-hover:text-indigo-200 transition-colors">
                Open Deep Quant
                <ChevronRight className="w-3.5 h-3.5 ml-0.5 transition-transform group-hover:translate-x-0.5" />
            </div>
        </div>
    );
};

const Mini: React.FC<{
    label: string;
    rawValue: number;
    decimals?: number;
    suffix?: string;
    isPrivacyMode?: boolean;
    tooltipTerm?: string;
    icon?: React.ReactNode;
}> = ({ label, rawValue, decimals = 2, suffix = '', isPrivacyMode = false, tooltipTerm, icon }) => {
    const display = isPrivacyMode ? '•••' : `${rawValue.toFixed(decimals)}${suffix}`;
    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg py-1.5">
            <div className="text-[9px] uppercase tracking-widest text-slate-500 flex items-center justify-center gap-1">
                {icon}
                {label}
                {tooltipTerm && <JargonTooltip term={tooltipTerm} />}
            </div>
            <div className="text-sm font-black text-slate-100">
                {isPrivacyMode ? (
                    display
                ) : (
                    <ValueFlash value={rawValue} className="inline-block">
                        <CountUp
                            value={rawValue}
                            decimals={decimals}
                            startFromZero
                            format={(n) => `${n.toFixed(decimals)}${suffix}`}
                        />
                    </ValueFlash>
                )}
            </div>
        </div>
    );
};

export default RiskScoreCardWidget;
