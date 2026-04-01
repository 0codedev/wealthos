import React, { useState } from 'react';
import { CompoundInterestCalculator } from './CompoundInterestCalculator';
import { DailyCompoundCalculator } from './DailyCompoundCalculator';
import { Calculator, Calendar, Clock } from 'lucide-react';

export const AdvancedCompoundCalculator: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'standard' | 'daily'>('standard');

    return (
        <div className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-white/5 overflow-hidden shadow-2xl relative animate-in fade-in duration-500">
            {/* Header Tabs */}
            <div className="flex border-b border-slate-800">
                <button
                    onClick={() => setActiveTab('standard')}
                    className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                        activeTab === 'standard'
                            ? 'bg-indigo-600/10 text-indigo-400 border-b-2 border-indigo-500'
                            : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                    }`}
                >
                    <Calendar size={18} />
                    Compound Interest
                </button>
                <button
                    onClick={() => setActiveTab('daily')}
                    className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                        activeTab === 'daily'
                            ? 'bg-emerald-600/10 text-emerald-400 border-b-2 border-emerald-500'
                            : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                    }`}
                >
                    <Clock size={18} />
                    Daily Compound
                </button>
            </div>

            {/* Content Area */}
            <div className="p-6">
                {activeTab === 'standard' ? <CompoundInterestCalculator /> : <DailyCompoundCalculator />}
            </div>
        </div>
    );
};
