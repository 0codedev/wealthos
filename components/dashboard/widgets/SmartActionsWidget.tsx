import React, { useEffect, useMemo, useState } from 'react';
import { PieChart, Wallet, Bell, Zap, ArrowRight, Check, Command, Sparkles } from 'lucide-react';
import { liveQuery } from 'dexie';
import { usePortfolioStore } from '../../../store/portfolioStore';
import { db, Trade, SyncRecordRow } from '../../../database';
import { generateSmartActions } from '../../../services/ActionCenterService';
import { SectionHeader, StateSurface } from '../../shared/SurfacePrimitives';

interface SmartAction {
    id: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    priority: 'high' | 'medium' | 'low';
    action: string;
}

interface SmartActionsWidgetProps {
    onQuickAction?: (action: string) => void;
}

const SmartActionCard: React.FC<{ action: SmartAction; onExecute: (id: string) => void }> = ({ action, onExecute }) => {
    const priorityConfig = {
        high: { color: 'text-rose-500', bg: 'bg-rose-500/10' },
        medium: { color: 'text-amber-500', bg: 'bg-amber-500/10' },
        low: { color: 'text-indigo-500', bg: 'bg-indigo-500/10' }
    };

    const config = priorityConfig[action.priority];

    return (
        <div className="group relative">
            <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 blur-sm transition-opacity duration-500 group-hover:opacity-100" />
            <button
                onClick={() => onExecute(action.id)}
                className="relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 text-left transition-all active:scale-[0.98] hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-600"
            >
                <div className={`absolute bottom-0 left-0 top-0 w-1 ${config.bg} ${config.color}`} />

                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 shadow-sm transition-transform duration-300 group-hover:scale-110 dark:border-slate-700 dark:bg-slate-800">
                    {action.icon}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between">
                        <span className="truncate text-xs font-bold text-slate-800 transition-colors group-hover:text-indigo-500 dark:text-white dark:group-hover:text-indigo-300">
                            {action.title}
                        </span>
                        {action.priority === 'high' && (
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-pulse" />
                        )}
                    </div>
                    <p className="line-clamp-1 text-[10px] font-medium text-slate-500">{action.description}</p>
                </div>

                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-all group-hover:border-indigo-500 group-hover:bg-indigo-500 group-hover:text-white dark:border-slate-700">
                    <ArrowRight size={10} className="-translate-x-2 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </div>
            </button>
        </div>
    );
};

const SmartActionsWidget: React.FC<SmartActionsWidgetProps> = ({ onQuickAction }) => {
    const investments = usePortfolioStore(state => state.investments);
    const [dismissedActions, setDismissedActions] = useState<string[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [syncRecords, setSyncRecords] = useState<SyncRecordRow[]>([]);

    useEffect(() => {
        const tradesSub = liveQuery(() => db.trades.toArray()).subscribe({
            next: (value) => setTrades(value || []),
        });
        const syncSub = liveQuery(() => db.sync_records.toArray()).subscribe({
            next: (value) => setSyncRecords(value || []),
        });

        return () => {
            tradesSub.unsubscribe();
            syncSub.unsubscribe();
        };
    }, []);

    const smartActions = useMemo(() => {
        const iconMap: Record<string, React.ReactNode> = {
            'rebalance': <PieChart size={16} className="text-amber-500" />,
            'tax-harvest': <Wallet size={16} className="text-rose-500" />,
            'idle-cash': <Bell size={16} className="text-indigo-500" />,
            'broker-sync': <Zap size={16} className="text-rose-500" />,
            'trade-review': <Command size={16} className="text-indigo-500" />,
        };

        return generateSmartActions(investments, trades, syncRecords)
            .filter(action => !dismissedActions.includes(action.id))
            .map<SmartAction>(action => ({
                ...action,
                icon: iconMap[action.action] || <Sparkles size={16} className="text-indigo-500" />,
            }));
    }, [dismissedActions, investments, trades, syncRecords]);

    const handleSmartAction = (actionId: string) => {
        setDismissedActions(prev => [...prev, actionId]);
        onQuickAction?.(actionId);
    };

    return (
        <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
            <SectionHeader
                className="relative z-10 mb-4"
                eyebrow="Command"
                title="Action Deck"
                description="Compact intervention queue from portfolio, broker, and journal signals."
                icon={Command}
                tone="info"
                badge={`${smartActions.length} pending`}
                chips={['Workflow shortcuts', 'Dismiss on action']}
            />

            <div className="relative z-10 flex-1 space-y-3 overflow-y-auto pr-1">
                {smartActions.length > 0 ? (
                    smartActions.map(action => (
                        <SmartActionCard key={action.id} action={action} onExecute={handleSmartAction} />
                    ))
                ) : (
                    <StateSurface
                        tone="success"
                        icon={Check}
                        title="All clear"
                        description="Zero pending actions. The compact command deck is quiet for now."
                        className="h-full"
                    />
                )}
            </div>

            <div className="pointer-events-none absolute bottom-0 right-0 h-32 w-32 rounded-full bg-indigo-500/5 blur-3xl" />
        </div>
    );
};

export default SmartActionsWidget;
