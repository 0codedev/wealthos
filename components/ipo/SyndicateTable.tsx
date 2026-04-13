import React from 'react';
import { LayoutList, GripVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { StatusBadge } from './StatusBadge';
import { ActionButtons } from './ActionButtons';
import { IPOApplication } from '../../database'; // Adjust import

interface SyndicateTableProps {
    viewMode: 'LIST' | 'GROUPED';
    setViewMode: (mode: 'LIST' | 'GROUPED') => void;
    displayApplications: IPOApplication[];
    groupedApps: Record<string, IPOApplication[]>;
    expandedGroups: string[];
    toggleGroup: (ipoName: string) => void;
    updateStatus: (id: number, status: IPOApplication['status']) => void;
    deleteApp: (id: number) => void;
}

export const SyndicateTable = React.memo(({
    viewMode, setViewMode, displayApplications, groupedApps, expandedGroups, toggleGroup, updateStatus, deleteApp
}: SyndicateTableProps) => {
    return (
        <div className="min-h-[200px]">
            <div className="flex justify-between items-center mb-3 px-1">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Applications</h4>
                <button
                    onClick={() => setViewMode(viewMode === 'LIST' ? 'GROUPED' : 'LIST')}
                    className="text-xs font-bold text-indigo-500 hover:text-indigo-600 flex items-center gap-1.5 bg-indigo-50/50 dark:bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-200/50 dark:border-indigo-500/20 transition-all active:scale-95"
                >
                    {viewMode === 'LIST' ? <LayoutList size={13} /> : <GripVertical size={13} />}
                    <span>{viewMode === 'LIST' ? 'Grouped View' : 'List View'}</span>
                </button>
            </div>

            {/* Empty State */}
            {displayApplications.length === 0 && (
                <div className="p-8 text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 text-xs font-medium">
                    No active syndicate applications.
                </div>
            )}

            {/* MOBILE CARD VIEW (< md) */}
            <div className="block md:hidden space-y-2.5">
                {viewMode === 'LIST' ? (
                    displayApplications.map(app => (
                        <div key={app.id} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-2.5">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <div className="font-bold text-sm text-slate-900 dark:text-white">{app.applicantName}</div>
                                    <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{app.ipoName}</div>
                                </div>
                                <StatusBadge status={app.status} />
                            </div>

                            <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800/60 text-xs font-mono">
                                <span className="text-slate-400 font-sans text-[11px] truncate max-w-[150px]">{app.upiHandle}</span>
                                <div className="text-right">
                                    {app.allottedAmount && app.allottedAmount !== app.amount ? (
                                        <div>
                                            <span className="font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(app.allottedAmount)}</span>
                                            <span className="text-[10px] text-slate-400 line-through ml-1.5">{formatCurrency(app.amount)}</span>
                                        </div>
                                    ) : (
                                        <span className="font-black text-slate-900 dark:text-white">{formatCurrency(app.amount)}</span>
                                    )}
                                </div>
                            </div>

                            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-end gap-2">
                                <ActionButtons app={app} updateStatus={updateStatus} deleteApp={deleteApp} />
                            </div>
                        </div>
                    ))
                ) : (
                    Object.entries(groupedApps).map(([ipoName, apps]) => {
                        const cleanNameLower = ipoName.trim().toLowerCase();
                        const isExpanded = expandedGroups.some(g => (g || '').trim().toLowerCase() === cleanNameLower);
                        const totalAmount = apps.reduce((sum, a) => sum + (a.allottedAmount ?? a.amount), 0);
                        const allottedCount = apps.filter(a => a.status === 'ALLOTTED' || a.status === 'LISTED').length;
                        const refundedCount = apps.filter(a => a.status === 'REFUNDED').length;
                        const blockedCount = apps.filter(a => a.status === 'BLOCKED').length;

                        return (
                            <div key={ipoName} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
                                <div
                                    onClick={() => toggleGroup(ipoName)}
                                    className="p-3.5 bg-slate-50/70 dark:bg-slate-900/90 cursor-pointer active:bg-slate-100 dark:active:bg-slate-800/80 transition-colors space-y-2"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 font-bold text-sm text-slate-900 dark:text-white">
                                            {isExpanded ? <ChevronDown size={16} className="text-indigo-500 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                                            <span className="truncate">{ipoName}</span>
                                            <span className="text-[11px] font-normal text-slate-400 shrink-0">({apps.length})</span>
                                        </div>
                                        <div className="font-mono font-black text-xs text-slate-900 dark:text-white shrink-0">
                                            {formatCurrency(totalAmount)}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {allottedCount > 0 && (
                                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-[10px] border border-emerald-500/20">
                                                {allottedCount}/{apps.length} Allotted
                                            </span>
                                        )}
                                        {blockedCount > 0 && (
                                            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold text-[10px] border border-amber-500/20">
                                                {blockedCount} In Review
                                            </span>
                                        )}
                                        {refundedCount > 0 && (
                                            <span className="px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium text-[10px] border border-slate-300/40 dark:border-slate-700/50">
                                                {refundedCount} Refunded
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="p-2.5 bg-slate-50/40 dark:bg-slate-950/40 divide-y divide-slate-100 dark:divide-slate-800/60 border-t border-slate-100 dark:border-slate-800/80">
                                        {apps.map(app => (
                                            <div key={app.id} className="py-2.5 first:pt-1 last:pb-1 space-y-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="font-medium text-xs text-slate-800 dark:text-slate-200">{app.applicantName}</div>
                                                    <StatusBadge status={app.status} />
                                                </div>
                                                <div className="flex items-center justify-between text-[11px] font-mono">
                                                    <span className="text-slate-400 font-sans truncate max-w-[140px]">{app.upiHandle}</span>
                                                    <div className="text-right">
                                                        {app.allottedAmount && app.allottedAmount !== app.amount ? (
                                                            <div>
                                                                <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(app.allottedAmount)}</span>
                                                                <span className="text-[9px] text-slate-400 line-through ml-1">{formatCurrency(app.amount)}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="font-bold text-slate-900 dark:text-white">{formatCurrency(app.amount)}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-end gap-1.5 pt-1">
                                                    <ActionButtons app={app} updateStatus={updateStatus} deleteApp={deleteApp} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* DESKTOP TABLE VIEW (>= md) */}
            <div className="hidden md:block table-scroll overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full min-w-[650px] text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-100 dark:bg-slate-800/50">
                        <tr>
                            <th className="px-4 py-3">Applicant / IPO</th>
                            <th className="px-4 py-3">UPI</th>
                            <th className="px-4 py-3 text-right">Amount</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {viewMode === 'LIST' ? (
                            displayApplications.map(app => (
                                <tr key={app.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-slate-800 dark:text-white">{app.applicantName}</div>
                                        <div className="text-xs text-slate-500">{app.ipoName}</div>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{app.upiHandle}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-right">
                                        {app.allottedAmount && app.allottedAmount !== app.amount ? (
                                            <div>
                                                <div className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(app.allottedAmount)}</div>
                                                <div className="text-[9px] text-slate-400 line-through">Blocked: {formatCurrency(app.amount)}</div>
                                            </div>
                                        ) : (
                                            <div className="font-bold text-slate-900 dark:text-white">{formatCurrency(app.amount)}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <StatusBadge status={app.status} />
                                    </td>
                                    <td className="px-4 py-3 text-right flex items-center justify-end gap-2">
                                        <ActionButtons app={app} updateStatus={updateStatus} deleteApp={deleteApp} />
                                    </td>
                                </tr>
                            ))
                        ) : (
                            Object.entries(groupedApps).map(([ipoName, apps]) => {
                                const cleanNameLower = ipoName.trim().toLowerCase();
                                const isExpanded = expandedGroups.some(g => (g || '').trim().toLowerCase() === cleanNameLower);
                                const totalAmount = apps.reduce((sum, a) => sum + (a.allottedAmount ?? a.amount), 0);
                                const allottedCount = apps.filter(a => a.status === 'ALLOTTED' || a.status === 'LISTED').length;
                                const refundedCount = apps.filter(a => a.status === 'REFUNDED').length;
                                const blockedCount = apps.filter(a => a.status === 'BLOCKED').length;

                                return (
                                    <React.Fragment key={ipoName}>
                                        {/* Parent Row */}
                                        <tr
                                            onClick={() => toggleGroup(ipoName)}
                                            className="bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-3 font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                                {isExpanded ? <ChevronDown size={14} className="text-indigo-500" /> : <ChevronRight size={14} className="text-slate-400" />}
                                                {ipoName}
                                                <span className="text-xs font-normal text-slate-500 ml-1">({apps.length} Apps)</span>
                                            </td>
                                            <td className="px-4 py-3 text-xs">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    {allottedCount > 0 && (
                                                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-[11px] border border-emerald-500/20">
                                                            {allottedCount}/{apps.length} Allotted
                                                        </span>
                                                    )}
                                                    {blockedCount > 0 && (
                                                        <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold text-[11px] border border-amber-500/20">
                                                            {blockedCount} In Review
                                                        </span>
                                                    )}
                                                    {refundedCount > 0 && (
                                                        <span className="px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium text-[11px] border border-slate-300/40 dark:border-slate-700/50">
                                                            {refundedCount} Refunded
                                                        </span>
                                                    )}
                                                    {allottedCount === 0 && blockedCount === 0 && refundedCount === 0 && (
                                                        <span className="text-slate-400 text-xs">Pending</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs font-black text-right">{formatCurrency(totalAmount)}</td>
                                            <td className="px-4 py-3"></td>
                                            <td className="px-4 py-3 text-right text-xs font-bold text-indigo-500">
                                                {isExpanded ? 'Hide' : 'View'}
                                            </td>
                                        </tr>

                                        {/* Child Rows */}
                                        {isExpanded && apps.map(app => (
                                            <tr key={app.id} className="bg-white dark:bg-slate-950/50 animate-in fade-in">
                                                <td className="px-4 py-2 pl-10 text-xs text-slate-600 dark:text-slate-300 border-l-4 border-indigo-500/10">
                                                    {app.applicantName}
                                                </td>
                                                <td className="px-4 py-2 font-mono text-xs text-slate-500">{app.upiHandle}</td>
                                                <td className="px-4 py-2 font-mono text-xs text-right">
                                                    {app.allottedAmount && app.allottedAmount !== app.amount ? (
                                                        <div>
                                                            <div className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(app.allottedAmount)}</div>
                                                            <div className="text-[9px] text-slate-400 line-through">Blocked: {formatCurrency(app.amount)}</div>
                                                        </div>
                                                    ) : (
                                                        <div className="font-bold text-slate-900 dark:text-white">{formatCurrency(app.amount)}</div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2">
                                                    <StatusBadge status={app.status} />
                                                </td>
                                                <td className="px-4 py-2 text-right flex items-center justify-end gap-2">
                                                    <ActionButtons app={app} updateStatus={updateStatus} deleteApp={deleteApp} />
                                                </td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
