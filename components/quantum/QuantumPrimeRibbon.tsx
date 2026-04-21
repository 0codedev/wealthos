import React from 'react';
import { Activity, Atom, Crown, Shield, TrendingUp } from 'lucide-react';
import { useQuantumStore } from '../../store/quantumStore';
import { useShallow } from 'zustand/react/shallow';
import { formatCurrency, formatCurrencyCompact } from '../../utils/helpers';

/**
 * QuantumPrimeRibbon — top KPI strip of the Quantum Terminal.
 * Shows: ProfitabilityScore, Portfolio Beta, Beta-Weighted Delta, VaR, CVaR.
 */
export const QuantumPrimeRibbon: React.FC = () => {
    const risk = useQuantumStore(useShallow(s => s.risk));
    const profitability = useQuantumStore(useShallow(s => s.profitability));

    const totalExposure = risk?.assets.reduce((s, a) => s + a.exposure, 0) ?? 0;
    const items = [
        {
            label: 'Profitability',
            value: profitability ? `${profitability.score}` : '—',
            sub: profitability ? profitability.tier : 'add trades to unlock',
            icon: <Crown size={14} className="text-amber-400" />,
            color: 'text-amber-300',
        },
        {
            label: 'Portfolio Beta',
            value: risk ? risk.portfolioBeta.toFixed(2) : '—',
            sub: risk ? `${risk.assets.length} assets` : '0 assets',
            icon: <TrendingUp size={14} className="text-cyan-400" />,
            color: 'text-cyan-300',
        },
        {
            label: 'NIFTY Δ',
            value: risk ? risk.portfolioDeltaWeighted.toFixed(1) : '—',
            sub: 'beta-weighted',
            icon: <Atom size={14} className="text-fuchsia-400" />,
            color: 'text-fuchsia-300',
        },
        {
            label: 'VaR 95% (1d)',
            value: risk ? formatCurrencyCompact(risk.var95) : '—',
            sub: risk ? `${((risk.var95 / Math.max(1, totalExposure)) * 100).toFixed(1)}% of book` : '—',
            icon: <Shield size={14} className="text-rose-400" />,
            color: 'text-rose-300',
        },
        {
            label: 'CVaR (tail)',
            value: risk ? formatCurrencyCompact(risk.cvar95) : '—',
            sub: 'expected shortfall',
            icon: <Shield size={14} className="text-rose-500" />,
            color: 'text-rose-400',
        },
        {
            label: 'Exposure',
            value: formatCurrencyCompact(totalExposure),
            sub: `${risk?.assets.length ?? 0} positions`,
            icon: <Activity size={14} className="text-emerald-400" />,
            color: 'text-emerald-300',
        },
    ];
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {items.map(it => (
                <div key={it.label} className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{it.label}</span>
                        {it.icon}
                    </div>
                    <div className={`text-lg font-bold ${it.color}`}>{it.value}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{it.sub}</div>
                </div>
            ))}
        </div>
    );
};

export default QuantumPrimeRibbon;
