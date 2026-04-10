import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2, AlertTriangle, Database, FileDigit } from 'lucide-react';
import { usePortfolio } from '../../hooks/usePortfolio';
import * as BackupService from '../../services/BackupService';
import SyncHealthPanel from './SyncHealthPanel';

interface DataHealthHubProps {
    onClose?: () => void;
}

const DataHealthHub: React.FC<DataHealthHubProps> = () => {
    const { investments } = usePortfolio();

    const healthStatus = useMemo(() => {
        const issues: { type: 'ERROR' | 'WARNING'; message: string }[] = [];
        const staleDate = new Date();
        staleDate.setDate(staleDate.getDate() - 30);

        const stale = investments.filter((inv) => {
            if (!inv.lastUpdated) return true;
            return new Date(inv.lastUpdated) < staleDate;
        });

        if (stale.length > 0) {
            issues.push({
                type: 'WARNING',
                message: `${stale.length} assets haven't been updated in 30 days.`,
            });
        }

        const zeroValue = investments.filter((inv) => inv.currentValue === 0 && inv.investedAmount > 0);
        if (zeroValue.length > 0) {
            issues.push({
                type: 'ERROR',
                message: `${zeroValue.length} assets have 0 value but non-zero investment.`,
            });
        }

        const groups: Record<string, string[]> = {};
        investments.forEach((inv) => {
            const qty = inv.quantity || 0;
            const key = `${inv.name}-${qty}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(inv.id!);
        });

        Object.entries(groups).forEach(([key, ids]) => {
            if (ids.length > 1) {
                issues.push({
                    type: 'WARNING',
                    message: `Possible duplicate: ${key.split('-')[0]} (x${ids.length})`,
                });
            }
        });

        return { issues, staleCount: stale.length, zeroCount: zeroValue.length };
    }, [investments]);

    return (
        <div className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="flex items-center justify-between border-b border-slate-200/70 bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-5 dark:border-slate-800 dark:from-indigo-950/20 dark:via-slate-900 dark:to-sky-950/20">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-indigo-500 dark:text-indigo-300">Recovery Ops</p>
                    <h3 className="mt-2 flex items-center gap-2 font-bold text-slate-800 dark:text-white">
                        <Database size={18} className="text-indigo-500" />
                        Data Health Monitor
                    </h3>
                </div>
                <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${healthStatus.issues.length === 0
                    ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:ring-emerald-500/20'
                    : 'bg-amber-100 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-500/20'
                    }`}>
                    {healthStatus.issues.length === 0 ? 'Healthy' : `${healthStatus.issues.length} Issues`}
                </span>
            </div>

            <div className="space-y-4 p-5">
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                    <p className="font-bold text-slate-800 dark:text-white">Operator Brief</p>
                    <p className="mt-1">Use this hub to verify sync trust, spot stale portfolio records, and take a backup before doing heavier recovery or cleanup actions.</p>
                </div>

                <SyncHealthPanel />

                {healthStatus.issues.length === 0 ? (
                    <div className="rounded-[26px] border border-emerald-100 bg-emerald-50/60 py-8 text-center dark:border-emerald-900/30 dark:bg-emerald-950/10">
                        <CheckCircle2 size={48} className="mx-auto mb-2 text-emerald-500" />
                        <p className="font-medium text-slate-600 dark:text-slate-300">All systems operational.</p>
                        <p className="text-xs text-slate-400">Data integrity matches professional standards.</p>
                    </div>
                ) : (
                    <div className="max-h-60 space-y-2 overflow-y-auto custom-scrollbar">
                        {healthStatus.issues.map((issue, idx) => (
                            <div key={idx} className="flex items-start gap-3 rounded-2xl border border-orange-100 bg-orange-50/80 p-3 dark:border-orange-900/30 dark:bg-orange-900/10">
                                {issue.type === 'ERROR' ? (
                                    <AlertCircle size={18} className="mt-0.5 shrink-0 text-rose-500" />
                                ) : (
                                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
                                )}
                                <div>
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{issue.message}</p>
                                    <p className="text-xs text-slate-500">Suggested Action: Review {issue.type === 'ERROR' ? 'immediately' : 'when possible'}.</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-center dark:border-slate-800 dark:bg-slate-800/50">
                        <p className="text-[10px] font-bold uppercase text-slate-400">Total Records</p>
                        <p className="text-lg font-mono font-bold text-slate-700 dark:text-slate-200">{investments.length}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-center dark:border-slate-800 dark:bg-slate-800/50">
                        <p className="text-[10px] font-bold uppercase text-slate-400">Stale (&gt;30d)</p>
                        <p className={`text-lg font-mono font-bold ${healthStatus.staleCount > 0 ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>
                            {healthStatus.staleCount}
                        </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-center dark:border-slate-800 dark:bg-slate-800/50">
                        <p className="text-[10px] font-bold uppercase text-slate-400">Zero Value</p>
                        <p className={`text-lg font-mono font-bold ${healthStatus.zeroCount > 0 ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200'}`}>
                            {healthStatus.zeroCount}
                        </p>
                    </div>
                </div>

                <div className="flex gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                    <button
                        onClick={() => BackupService.handleDownloadBackup()}
                        className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-100 py-2.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                        <Database size={14} />
                        Backup JSON
                    </button>
                    <button
                        onClick={() => BackupService.handleExportHoldings()}
                        className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-100 py-2.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                        <FileDigit size={14} />
                        Export CSV
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DataHealthHub;
