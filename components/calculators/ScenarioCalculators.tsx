import React from 'react';
import { HindsightSimulator } from './HindsightSimulator';
import { GoalAttainmentSimulator } from './GoalAttainmentSimulator';

export const ScenarioCalculators: React.FC = () => {
    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <HindsightSimulator />
            <GoalAttainmentSimulator />
        </div>
    );
};
