import React from 'react';
import { EMIAnalyzer } from './EMIAnalyzer';

export const DebtCalculators: React.FC = () => {
    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <EMIAnalyzer />
        </div>
    );
};
