import React, { useState } from 'react';
import { SIPCalculator } from './SIPCalculator';
import { BondCalculator } from './BondCalculator';
import { Settings, RefreshCw, BarChart2 } from 'lucide-react';

export const FixedIncomeHub: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'SIP' | 'BOND'>('SIP');

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-4">
                <h2 className="text-2xl font-bold rounded-lg text-white">Fixed Income & Capital Returns</h2>
                <div className="flex bg-slate-900 border border-slate-800 rounded-xl overflow-hidden p-1 shadow-lg">
                    <button 
                        onClick={() => setActiveTab('SIP')}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'SIP' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                    >
                        <RefreshCw size={16} /> SIP & Compound
                    </button>
                    <button 
                        onClick={() => setActiveTab('BOND')}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'BOND' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                    >
                        <BarChart2 size={16} /> Bond Pricing
                    </button>
                </div>
            </div>

            <div className="animate-in fade-in duration-300">
                {activeTab === 'SIP' && <SIPCalculator />}
                {activeTab === 'BOND' && <BondCalculator />}
            </div>
        </div>
    );
};
