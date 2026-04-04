import React from 'react';
import { PositionSizingCalculator } from './PositionSizingCalculator';
import { TradePnLCalculator } from './TradePnLCalculator';
import { AveragingCalculator } from './AveragingCalculator';

export const TradingCalculators: React.FC = () => {
    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <PositionSizingCalculator />
            <TradePnLCalculator />
            <AveragingCalculator />

            {/* Future Additions could go here */}
            <div className="p-6 bg-slate-800/30 rounded-2xl border border-slate-800 border-dashed flex items-center justify-center flex-col text-slate-500 min-h-[100px]">
                <span className="text-sm font-bold uppercase tracking-widest mb-2">More Tools Coming Soon</span>
            </div>
        </div>
    );
};
