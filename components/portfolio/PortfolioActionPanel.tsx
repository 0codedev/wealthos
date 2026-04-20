import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Bell, PieChart, Scissors, Wallet, CheckCircle2 } from 'lucide-react';
import { Investment } from '../../types';
import { useSettingsStore } from '../../store/settingsStore';
import { generatePortfolioActionProposals, PortfolioActionProposal, summarizePortfolioActionProposals } from '../../services/PortfolioActionService';
import { SectionHeader, StateSurface } from '../shared/SurfacePrimitives';

interface PortfolioActionPanelProps {
    investments: Investment[];
    formatCurrency: (val: number) => string;
    isPrivacyMode: boolean;
    focusCategory?: 'rebalance' | 'deploy-cash' | 'trim' | 'tax-harvest' | null;
    onFollowUp?: (proposal: PortfolioActionProposal) => void;
}

const iconMap = {
    rebalance: PieChart,
    'deploy-cash': Wallet,
    trim: ArrowUpRight,
    'tax-harvest': Scissors,
};

export const PortfolioActionPanel: React.FC<PortfolioActionPanelProps> = ({
    investments,
    formatCurrency,
    isPrivacyMode,
    focusCategory = null,
    onFollowUp,
}) => {
    const allocationTargets = useSettingsStore(state => state.allocationTargets);
    const [internalFilter, setInternalFilter] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<'priority' | 'amount'>('priority');
    const [isCompact, setIsCompact] = useState(false);

    const proposals = useMemo(
        () => generatePortfolioActionProposals(investments, allocationTargets),
        [allocationTargets, investments]
    );

    const activeFilter = focusCategory ?? internalFilter;

    const visibleProposals = useMemo(
        () => activeFilter ? proposals.filter((proposal) => proposal.category === activeFilter) : proposals,
        [activeFilter, proposals]
    );

    const sortedProposals = useMemo(() => {
        return [...visibleProposals].sort((a, b) => {
            if (sortBy === 'priority') {
                const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
                return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
            }
            return (b.amount ?? 0) - (a.amount ?? 0);
        });
    }, [visibleProposals, sortBy]);

    const summary = useMemo(() => summarizePortfolioActionProposals(proposals), [proposals]);
    const topProposal = visibleProposals[0] || null;

    return (
        <div className="relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-indigo-500/10 via-transparent to-amber-500/10" />
            <SectionHeader
                className="relative z-10 mb-4"
                eyebrow="Decision Workspace"
                title="Action Layer"
                description="What the portfolio is asking you to do next."
                icon={Bell}
                tone="info"
                badge={`${visibleProposals.length} proposals`}
                chips={focusCategory ? ['Operator surface', 'Actionable next steps', `Focused on ${focusCategory}`] : ['Operator surface', 'Actionable next steps']}
            />

            {/* Internal Filter Pills */}
            {!focusCategory && (
                <div className="flex flex-wrap gap-2 mb-4 relative z-10">
                    {['All', 'rebalance', 'deploy-cash', 'trim', 'tax-harvest'].map(cat => (
                        <button
                            key={cat}
                            onClick={() => setInternalFilter(cat === 'All' ? null : cat)}
                            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border shadow-sm ${
                                (cat === 'All' && internalFilter === null) || internalFilter === cat
                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-500/20'
                                    : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                        >
                            {cat === 'All'
                                ? `All (${proposals.length})`
                                : `${cat} (${proposals.filter(p => p.category === cat).length})`
                            }
                        </button>
                    ))}
                </div>
            )}

            {/* Sort & Compact Controls */}
            {visibleProposals.length > 0 && (
                <div className="flex items-center gap-2 mb-4 relative z-10 px-1">
                    <button
                        onClick={() => setIsCompact(!isCompact)}
                        className="text-[10px] text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-black uppercase tracking-widest mr-auto transition-colors"
                    >
                        {isCompact ? '⊞ Full View' : '⊟ Compact'}
                    </button>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-black">Sort:</span>
                    {(['priority', 'amount'] as const).map(opt => (
                        <button
                            key={opt}
                            onClick={() => setSortBy(opt)}
                            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border ${
                                sortBy === opt
                                    ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-600 shadow-sm'
                                    : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                            }`}
                        >
                            {opt === 'priority' ? '⬆ Priority' : '₹ Amount'}
                        </button>
                    ))}
                </div>
            )}

            <StateSurface
                className="mb-4 relative z-10"
                tone={topProposal ? 'neutral' : 'success'}
                title={topProposal ? topProposal.title : 'The action layer is currently quiet.'}
                description={topProposal ? topProposal.summary : 'The portfolio is not detecting urgent rebalance, deployment, trim, or harvesting work right now.'}
                icon={topProposal ? iconMap[topProposal.category] : CheckCircle2}
                badge="Operator brief"
                actions={topProposal ? (
                    <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-0.5 text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                            {summary.total} actions
                        </span>
                        <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-0.5 text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                            {topProposal.priority} priority
                        </span>
                        {topProposal.target && (
                            <span className="rounded-full border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-950/20 px-3 py-0.5 text-[10px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                                Focus: {topProposal.target}
                            </span>
                        )}
                    </div>
                ) : null}
            />

            {focusCategory && (
                <StateSurface
                    className="mb-4 relative z-10"
                    tone="info"
                    title="Command Center Task Focus"
                    description={
                        focusCategory === 'rebalance' ? 'Allocation drift triggered a rebalance task. Open the rebalance lab to turn this into an execution plan.'
                            : focusCategory === 'deploy-cash' ? 'Idle cash was promoted as the next portfolio action. Review holdings to decide where capital should be deployed.'
                                : focusCategory === 'trim' ? 'A concentration risk was promoted into the queue. Review holdings to decide what should be trimmed first.'
                                    : 'Loss-harvest candidates were promoted into the queue. Review holdings before realizing losses.'
                    }
                    icon={CheckCircle2}
                    actions={
                        <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border border-indigo-200 dark:border-indigo-500/30 bg-white dark:bg-slate-900 px-3 py-1 text-[10px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-widest">
                                {summary.total} tasks active
                            </span>
                            {onFollowUp && visibleProposals[0] && (
                                <button
                                    onClick={() => onFollowUp(visibleProposals[0])}
                                    className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-3.5 py-1.5 text-[10px] font-black text-white transition-all hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 active:scale-95 uppercase tracking-widest"
                                >
                                    <CheckCircle2 size={14} />
                                    {focusCategory === 'rebalance' ? 'Open Rebalance Lab' : 'Execute Top Proposal'}
                                </button>
                            )}
                        </div>
                    }
                />
            )}

            {sortedProposals.length > 0 ? (
                <div className={`grid grid-cols-1 gap-4 ${isCompact ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
                    {sortedProposals.map((proposal) => {
                        const Icon = iconMap[proposal.category];
                        const tone =
                            proposal.priority === 'high'
                                ? 'rose'
                                : proposal.priority === 'medium'
                                    ? 'amber'
                                    : 'indigo';

                        return (
                            <div
                                key={proposal.id}
                                className={`group rounded-[26px] border p-4 transition-all hover:-translate-y-0.5 hover:shadow-xl ${
                                    tone === 'rose'
                                        ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-500/20 shadow-rose-500/5'
                                        : tone === 'amber'
                                            ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-500/20 shadow-amber-500/5'
                                            : 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-500/20 shadow-indigo-500/5'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3 rounded-2xl transition-transform group-hover:scale-105 border ${
                                            tone === 'rose'
                                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-500 border-rose-200/50'
                                                : tone === 'amber'
                                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500 border-amber-200/50'
                                                    : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-500 border-indigo-200/50'
                                        }`}>
                                            <Icon size={20} />
                                        </div>
                                        <div>
                                            <h4 className="text-[14px] font-black text-slate-900 dark:text-white tracking-tight leading-tight">{proposal.title}</h4>
                                            <p className={`text-[9px] font-black uppercase tracking-[0.2em] mt-1.5 ${
                                                tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 
                                                tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 
                                                'text-indigo-600 dark:text-indigo-400'
                                            }`}>{proposal.priority} priority</p>
                                        </div>
                                    </div>
                                    {proposal.amount !== undefined && (
                                        <div className="text-right">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Amount</p>
                                            <p className="text-[14px] font-mono font-black text-slate-900 dark:text-white tracking-tighter">
                                                {isPrivacyMode ? '••••••' : formatCurrency(proposal.amount)}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {!isCompact && (
                                    <p className="mt-4 text-xs leading-relaxed text-slate-600 dark:text-slate-400 font-medium">{proposal.summary}</p>
                                )}

                                <div className="mt-5 flex items-center justify-between border-t border-slate-100 dark:border-white/5 pt-4">
                                    <div className="flex items-center gap-2">
                                        {proposal.target && (
                                            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-1 text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                                                Focus: {proposal.target}
                                            </div>
                                        )}
                                    </div>

                                    {onFollowUp && (
                                        <button
                                            onClick={() => onFollowUp(proposal)}
                                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-slate-800 px-4 py-2 text-[10px] font-black text-white transition-all hover:bg-black dark:hover:bg-slate-700 shadow-md uppercase tracking-widest active:scale-95"
                                        >
                                            {proposal.category === 'rebalance' ? 'Open Lab' : 'Work Proposal'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <StateSurface
                    tone="success"
                    title={focusCategory ? `No ${focusCategory} proposals are active right now.` : 'The portfolio action layer is clear right now.'}
                    description={focusCategory
                        ? 'That usually means the specific queue item has already cooled off or been worked down. You can return to holdings or analytics to verify the latest state.'
                        : 'No major rebalance, cash deployment, trim, or harvesting proposals are standing out. This is a good time to review long-range goals, journal lessons, or wait for the next meaningful shift in allocation or cash position.'}
                    icon={CheckCircle2}
                />
            )}
        </div>
    );
};
