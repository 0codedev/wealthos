import React from 'react';
import { SIPLumpsumCalculator } from './SIPLumpsumCalculator';
import { FIRECalculator } from './FIRECalculator';
import { CAGRCalculator } from './CAGRCalculator';
import { ROICalculator } from './ROICalculator';
import { AdvancedCompoundCalculator } from './AdvancedCompoundCalculator';

export const InvestmentCalculators: React.FC = () => {
    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <AdvancedCompoundCalculator />

            <SIPLumpsumCalculator />

            <FIRECalculator />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <CAGRCalculator />

                <ROICalculator />

                {/* Future Additions
                <div className="p-6 bg-slate-800/30 rounded-2xl border border-slate-800 border-dashed flex items-center justify-center flex-col text-slate-500 min-h-[300px]">
                    <span className="text-sm font-bold uppercase tracking-widest mb-2">Coming Soon</span>
                    <p className="text-center text-xs px-8">More advanced investment planning calculators are currently in development.</p>
                </div>
                */}
            </div>
        </div>
    );
};
