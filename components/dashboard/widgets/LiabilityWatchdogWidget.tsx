import React, { useMemo } from 'react';
import { useTransactions } from '../../../contexts/TransactionContext';
import { findSubscriptionTraps } from '../../../utils/liabilityDetector';
import { ShieldCheck, Calendar, Zap, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../../utils/helpers';
import { CountUp } from '../../shared/CountUp';
import { ValueFlash } from '../../shared/ValueFlash';
import EmptyState from '../../shared/EmptyState';

export const LiabilityWatchdogWidget: React.FC = () => {
    const { transactions } = useTransactions();

    const traps = useMemo(() => {
        if (!transactions.length) return [];
        return findSubscriptionTraps(transactions);
    }, [transactions]);

    const totalYearlyDrag = traps.reduce((sum, t) => sum + t.yearlyImpact, 0);

    return (
        <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 relative overflow-hidden h-full flex flex-col group hover:border-emerald-500/20 transition-all">
            {/* Header */}
            <div className="flex justify-between items-start mb-6 w-full">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-500">
                        <ShieldCheck size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">DEBT RADAR</h3>
                        <p className="text-[10px] text-slate-500 font-mono font-bold uppercase">Perimeter Secure</p>
                    </div>
                </div>

                <div className="px-2 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    SECURE
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex flex-col items-center justify-center text-center relative z-10">
                {traps.length === 0 ? (
                    <div className="py-4">
                        <EmptyState
                            icon={ShieldCheck}
                            title="No active traps"
                            description="Cash flow signals are clean. No recurring leaks found."
                            variant="minimal"
                        />
                    </div>
                ) : (
                    <div className="w-full space-y-3">
                        {traps.slice(0, 3).map((trap) => (
                            <div key={`${trap.merchant}-${trap.frequency}`} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded flex items-center justify-center text-xs font-bold text-slate-500 uppercase">
                                        {trap.merchant.charAt(0)}
                                    </div>
                                    <div className="text-left">
                                        <p className="text-xs font-bold text-slate-600 dark:text-slate-300 capitalize">{trap.merchant}</p>
                                        <p className="text-[10px] text-slate-600 font-mono">{trap.frequency}</p>
                                    </div>
                                </div>
                                <p className="text-xs font-mono font-bold text-rose-500">
                                    <ValueFlash value={trap.amount} className="inline-block">
                                        <CountUp value={trap.amount} format={formatCurrency} />
                                    </ValueFlash>
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Background Radar Rings */}
            {traps.length === 0 && (
                <div className="absolute inset-0 pointer-events-none opacity-20">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border border-slate-800 rounded-full" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border border-slate-800 rounded-full" />
                </div>
            )}
        </div>
    );
};
