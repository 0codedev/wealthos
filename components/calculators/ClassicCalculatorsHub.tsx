import React, { useState } from 'react';
import { Calculator, TrendingUp, Target, CreditCard } from 'lucide-react';

import { InvestmentCalculators } from './InvestmentCalculators';
import { TradingCalculators } from './TradingCalculators';
import { ScenarioCalculators } from './ScenarioCalculators';
import { DebtCalculators } from './DebtCalculators';

const CLASSIC_CATEGORIES = [
    { id: 'investment', label: 'Investment & Wealth', icon: TrendingUp },
    { id: 'trading', label: 'Active Trading', icon: Target },
    { id: 'scenario', label: 'Simulations', icon: Calculator },
    { id: 'debt', label: 'Debt & Loans', icon: CreditCard },
];

export const ClassicCalculatorsHub: React.FC = () => {
    const [activeSubCategory, setActiveSubCategory] = useState('investment');

    const renderSubCategory = () => {
        switch (activeSubCategory) {
            case 'investment':
                return <InvestmentCalculators />;
            case 'trading':
                return <TradingCalculators />;
            case 'scenario':
                return <ScenarioCalculators />;
            case 'debt':
                return <DebtCalculators />;
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex overflow-x-auto no-scrollbar gap-2 pb-2">
                {CLASSIC_CATEGORIES.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => setActiveSubCategory(cat.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${
                            activeSubCategory === cat.id
                                ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                                : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:bg-slate-800'
                        }`}
                    >
                        <cat.icon size={16} />
                        {cat.label}
                    </button>
                ))}
            </div>

            <div>
                {renderSubCategory()}
            </div>
        </div>
    );
};
