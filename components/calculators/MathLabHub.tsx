import React, { useState } from 'react';
import { Activity, PieChart, ShieldAlert, TrendingUp, BarChart2, Calculator, AlertTriangle, BarChart3, CandlestickChart, Briefcase, LineChart, Scale, Target, Zap } from 'lucide-react';

// Modules
import { BSMCalculator } from './options/BSMCalculator';
import { BTSTPredictor } from './options/BTSTPredictor';
import { FixedIncomeHub } from './fixedIncome/FixedIncomeHub';
import { PortfolioTheoryCalculator } from './portfolio/PortfolioTheoryCalculator';
import { RiskDashboard } from './risk/RiskDashboard';
import { StatisticalDashboard } from './stats/StatisticalDashboard';
import { ProbabilityDashboard } from './probability/ProbabilityDashboard';
import { TADashboard } from './ta/TADashboard';
import { TaxDashboard } from './tax/TaxDashboard';
import { PositionPnLCalculator } from './pnl/PositionPnLCalculator';

// Classic Calculators Wrapper
import { ClassicCalculatorsHub } from './ClassicCalculatorsHub';
import { useSettingsStore } from '../../store/settingsStore';

const CATEGORIES = [
    { id: 'options', label: 'Options Pricing', icon: Calculator },
    { id: 'pnl', label: 'Position P&L', icon: Target },
    { id: 'btst', label: 'BTST Prediction Core', icon: Zap },
    { id: 'portfolio', label: 'Portfolio Theory', icon: PieChart },
    { id: 'risk', label: 'Risk Analytics', icon: AlertTriangle },
    { id: 'fixedIncome', label: 'Fixed Income & Wealth', icon: TrendingUp },
    { id: 'stats', label: 'Statistical Toolkit', icon: BarChart3 },
    { id: 'probability', label: 'Probability Engine', icon: CandlestickChart },
    { id: 'ta', label: 'Technical Analysis', icon: LineChart },
    { id: 'tax', label: 'Tax & Compliance', icon: Scale },
    { id: 'classic', label: 'Classic Personal Finance', icon: Briefcase },
];

export const MathLabHub: React.FC = () => {
    const designPreset = useSettingsStore((s) => s.designPreset);
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const [activeCategory, setActiveCategory] = useState('options');

    const renderCategory = () => {
        switch (activeCategory) {
            case 'options':
                return <BSMCalculator />;
            case 'pnl':
                return <PositionPnLCalculator />;
            case 'btst':
                return <BTSTPredictor />;
            case 'fixedIncome':
                return <FixedIncomeHub />;
            case 'portfolio':
                return <PortfolioTheoryCalculator />;
            case 'risk':
                return <RiskDashboard />;
            case 'stats':
                return <StatisticalDashboard />;
            case 'probability':
                return <ProbabilityDashboard />;
            case 'ta':
                return <TADashboard />;
            case 'tax':
                return <TaxDashboard />;
            
            // Classic Tools
            case 'classic':
                return <ClassicCalculatorsHub />;
                
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 px-4 md:px-0 lg:px-6 w-full max-w-[100vw] overflow-x-hidden">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
                            <Calculator size={24} />
                        </div>
                        <h1 className="text-3xl font-bold text-white">Quant Strategy Lab</h1>
                    </div>
                    <p className="text-slate-400 max-w-2xl">
                        A god-tier financial mathematics engine for options pricing, risk analytics, derivatives, and fixed income. Pure computational power.
                    </p>
                </div>
            </div>

            <div className="flex overflow-x-auto no-scrollbar gap-2 pb-2 -mx-4 px-4 md:mx-0 md:px-0 w-[100vw] md:w-auto">
                {CATEGORIES.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => setActiveCategory(cat.id)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all whitespace-nowrap shrink-0 border ${
                            isAstryx ? "rounded-[9999px] font-['Figtree',sans-serif]" : isReui ? "rounded-md font-sans" : "rounded-xl font-sans"
                        } ${activeCategory === cat.id
                            ? (isAstryx ? 'bg-[#262626] text-white border-white/[0.102] shadow-sm' : isReui ? 'bg-zinc-800 text-zinc-100 border-zinc-700 shadow-sm' : 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/25 border-emerald-500')
                            : (isAstryx ? 'bg-[#141414] border-white/[0.102] text-zinc-400 hover:text-white hover:bg-white/[0.04]' : isReui ? 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50' : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-800')
                        }`}
                    >
                        <cat.icon size={16} />
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Calculator Content */}
            <div className="mt-6">
                {renderCategory()}
            </div>
        </div>
    );
};
