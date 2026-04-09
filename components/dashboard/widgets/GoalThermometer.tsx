import React, { useMemo } from 'react';
import { Target, TrendingUp, Calendar, Rocket, Flag, Zap } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { usePortfolio } from '../../../hooks/usePortfolio';
import { formatCurrency } from '../../../utils/helpers';
import { CountUp } from '../../shared/CountUp';
import { ValueFlash } from '../../shared/ValueFlash';

interface GoalThermometerProps {
    currentNetWorth?: number;
}

export const GoalThermometer: React.FC<GoalThermometerProps> = ({ currentNetWorth: propNetWorth }) => {
    const { stats } = usePortfolio();
    const targetNetWorth = useSettingsStore(state => state.targetNetWorth);
    const targetDate = useSettingsStore(state => state.targetDate);

    const currentNetWorth = propNetWorth ?? stats?.totalCurrent ?? 0;

    const progress = useMemo(() => {
        if (!targetNetWorth || targetNetWorth <= 0) return 0;
        return Math.min((currentNetWorth / targetNetWorth) * 100, 100);
    }, [currentNetWorth, targetNetWorth]);

    const daysRemaining = useMemo(() => {
        if (!targetDate) return 0;
        const target = new Date(targetDate);
        const today = new Date();
        const diff = target.getTime() - today.getTime();
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }, [targetDate]);

    const monthsRemaining = Math.max(1, Math.ceil(daysRemaining / 30));
    const gap = targetNetWorth - currentNetWorth;
    const monthlySavingsNeeded = gap > 0 ? gap / monthsRemaining : 0;

    return (
        <div className="h-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 relative overflow-hidden group flex flex-col hover:border-cyan-500/30 transition-colors duration-500">
            {/* Background Sky */}
            <div className="absolute inset-0 bg-gradient-to-b from-cyan-50/50 dark:from-cyan-950/20 to-white dark:to-slate-950 pointer-events-none" />

            {/* Header */}
            <div className="flex justify-between items-start mb-4 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-cyan-50 dark:bg-cyan-950/50 rounded-xl flex items-center justify-center border border-cyan-200 dark:border-cyan-500/20 shadow-lg shadow-cyan-100 dark:shadow-cyan-900/10">
                        <Rocket size={20} className="text-cyan-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Ascension</h3>
                        <p className="text-[10px] text-cyan-400/80 font-mono">Goal Tracker</p>
                    </div>
                </div>

                <div className="flex flex-col items-end">
                    <span className="text-[9px] text-slate-500 font-bold uppercase">Completion</span>
                    <span className="text-2xl font-black text-cyan-400 font-mono tracking-tight">
                        <ValueFlash value={progress} className="inline-block">
                            <CountUp
                                value={progress}
                                startFromZero
                                format={(n) => n.toFixed(0)}
                            />
                        </ValueFlash>
                        <span className="text-sm">%</span>
                    </span>
                </div>
            </div>

            <div className="flex-1 flex gap-4 relative z-10">
                {/* Vertical Tracker */}
                <div className="w-10 relative">
                    <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-1.5 bg-slate-200 dark:bg-slate-800 rounded-full" />
                    {/* Fill */}
                    <div
                        className="absolute left-1/2 -translate-x-1/2 bottom-0 w-1.5 bg-gradient-to-t from-cyan-600 to-blue-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.5)] transition-all duration-1000"
                        style={{ height: `${progress}%` }}
                    />

                    {/* Moving Rocket */}
                    <div
                        className="absolute left-1/2 -translate-x-1/2 transition-all duration-1000"
                        style={{ bottom: `calc(${progress}% - 12px)` }}
                    >
                        <div className="w-6 h-6 bg-slate-950 border-2 border-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-cyan-500/50 z-20 relative">
                            <Rocket size={12} className="text-white fill-current -rotate-45 ml-0.5 mt-0.5" />
                        </div>
                    </div>

                    {/* Top Flag */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-1 rounded z-10">
                        <Flag size={10} className="text-amber-400 fill-current" />
                    </div>
                </div>

                {/* Metrics */}
                <div className="flex-1 flex flex-col justify-between py-1">
                    {/* Gap Analysis */}
                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[9px] text-slate-500 font-bold uppercase">To Go</span>
                            <span className="text-[9px] text-slate-500 font-mono">{monthsRemaining} mos left</span>
                        </div>
                        <p className="text-lg font-bold text-slate-800 dark:text-white font-mono">
                            <ValueFlash value={gap} className="inline-block">
                                <CountUp value={gap} format={formatCurrency} />
                            </ValueFlash>
                        </p>
                    </div>

                    {/* Required Rate */}
                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-2 mb-1">
                            <TrendingUp size={12} className="text-emerald-400" />
                            <span className="text-[9px] text-slate-500 font-bold uppercase">Req. Monthly</span>
                        </div>
                        <p className="text-xl font-black text-emerald-400 font-mono">
                            <ValueFlash value={monthlySavingsNeeded} className="inline-block">
                                <CountUp value={monthlySavingsNeeded} format={formatCurrency} />
                            </ValueFlash>
                        </p>
                        <p className="text-[9px] text-slate-600 mt-1">to hit target by date</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GoalThermometer;
