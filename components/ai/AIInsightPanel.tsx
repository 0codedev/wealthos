import React, { useState } from 'react';
import {
    Brain, ChevronDown, ChevronUp, RefreshCw, AlertTriangle,
    TrendingUp, Info, Zap, ArrowRight, Loader2, Sparkles,
    CheckCircle2, XCircle, PauseCircle
} from 'lucide-react';
import { AIInsight, TabAIResult } from '../../services/AmbientAIBrain';
import { SkeletonLine } from '../ui/Skeleton';

interface AIInsightPanelProps {
    coachMessage: string;
    insights: AIInsight[];
    tradeSignal?: TabAIResult['tradeSignal'];
    tradeSignalReason?: string;
    isLoading: boolean;
    lastUpdated: number;
    onRefresh: () => void;
    onNavigate?: (tab: string) => void;
    defaultExpanded?: boolean;
    className?: string;
    model?: string; // Which model generated these insights
}

const SeverityConfig = {
    critical: {
        icon: XCircle,
        bg: 'bg-rose-50/80 dark:bg-rose-950/30',
        border: 'border-rose-200/60 dark:border-rose-800/40',
        iconColor: 'text-rose-500',
        badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400',
        label: 'CRITICAL',
    },
    warning: {
        icon: AlertTriangle,
        bg: 'bg-amber-50/80 dark:bg-amber-950/30',
        border: 'border-amber-200/60 dark:border-amber-800/40',
        iconColor: 'text-amber-500',
        badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400',
        label: 'ADVISORY',
    },
    positive: {
        icon: TrendingUp,
        bg: 'bg-emerald-50/80 dark:bg-emerald-950/30',
        border: 'border-emerald-200/60 dark:border-emerald-800/40',
        iconColor: 'text-emerald-500',
        badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400',
        label: 'POSITIVE',
    },
    info: {
        icon: Info,
        bg: 'bg-indigo-50/80 dark:bg-indigo-950/30',
        border: 'border-indigo-200/60 dark:border-indigo-800/40',
        iconColor: 'text-indigo-500',
        badge: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400',
        label: 'INFO',
    },
};

const TradeSignalConfig = {
    go: {
        icon: CheckCircle2,
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200/60 dark:border-emerald-800/40',
        dot: 'bg-emerald-500',
        label: 'GO — Trade Normal',
    },
    caution: {
        icon: PauseCircle,
        color: 'text-amber-600 dark:text-amber-400',
        bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200/60 dark:border-amber-800/40',
        dot: 'bg-amber-500',
        label: 'CAUTION — Reduce Size',
    },
    stop: {
        icon: XCircle,
        color: 'text-rose-600 dark:text-rose-400',
        bg: 'bg-rose-50 dark:bg-rose-900/20 border-rose-200/60 dark:border-rose-800/40',
        dot: 'bg-rose-500',
        label: 'STOP — Paper Trade Only',
    },
};

export const AIInsightPanel: React.FC<AIInsightPanelProps> = ({
    coachMessage,
    insights,
    tradeSignal,
    tradeSignalReason,
    isLoading,
    lastUpdated,
    onRefresh,
    onNavigate,
    defaultExpanded = false,
    className = '',
    model,
}) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    const hasContent = insights.length > 0 || coachMessage;
    const criticalCount = insights.filter(i => i.severity === 'critical').length;
    const warningCount = insights.filter(i => i.severity === 'warning').length;

    const timeAgo = lastUpdated > 0
        ? (() => {
            const diff = Math.floor((Date.now() - lastUpdated) / 1000);
            if (diff < 60) return 'just now';
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
            return `${Math.floor(diff / 3600)}h ago`;
        })()
        : null;

    return (
        <div className={`rounded-2xl border overflow-hidden transition-all duration-300 ${criticalCount > 0
            ? 'border-rose-200/70 dark:border-rose-800/40 bg-white/80 dark:bg-slate-900/80'
            : warningCount > 0
                ? 'border-amber-200/60 dark:border-amber-800/40 bg-white/80 dark:bg-slate-900/80'
                : 'border-indigo-200/60 dark:border-indigo-800/40 bg-white/80 dark:bg-slate-900/80'
            } backdrop-blur-sm shadow-sm ${className}`}>

            {/* Header Strip — Always Visible */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => setIsExpanded(e => !e)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setIsExpanded(prev => !prev);
                    }
                }}
                className="w-full cursor-pointer flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
            >
                {/* AI Brain Icon with Pulse */}
                <div className="relative shrink-0">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${criticalCount > 0
                        ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                        : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                        }`}>
                        {isLoading
                            ? <Loader2 size={16} className="animate-spin" />
                            : <Brain size={16} />
                        }
                    </div>
                    {(criticalCount > 0 || warningCount > 0) && !isLoading && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-900 animate-pulse" />
                    )}
                </div>

                {/* Coach Message */}
                <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-indigo-500">
                            AI Coach
                        </span>
                        {model && (
                            <span className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-tight bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md">
                                {model}
                            </span>
                        )}
                        {criticalCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-black bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400">
                                {criticalCount} CRITICAL
                            </span>
                        )}
                        {warningCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-black bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                                {warningCount} ADVISORY
                            </span>
                        )}
                    </div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate mt-0.5">
                        {isLoading && !coachMessage
                            ? 'Analyzing your data...'
                            : coachMessage || 'AI is thinking...'
                        }
                    </p>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-1.5 shrink-0">
                    {timeAgo && (
                        <span className="text-[9px] text-slate-400 hidden sm:block">{timeAgo}</span>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                        title="Refresh AI insights"
                    >
                        <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                    {isExpanded
                        ? <ChevronUp size={15} className="text-slate-400" />
                        : <ChevronDown size={15} className="text-slate-400" />
                    }
                </div>
            </div>

            {/* Expanded Body */}
            {isExpanded && (
                <div className="border-t border-slate-100 dark:border-slate-800/60 px-4 pt-3 pb-4 space-y-3 animate-in slide-in-from-top-2 duration-200">

                    {/* Trade Signal */}
                    {tradeSignal && (
                        <div className={`flex items-center gap-3 p-3 rounded-xl border ${TradeSignalConfig[tradeSignal].bg}`}>
                            <div className={`w-2.5 h-2.5 rounded-full ${TradeSignalConfig[tradeSignal].dot} animate-pulse shrink-0`} />
                            <div className="flex-1 min-w-0">
                                <p className={`text-xs font-black ${TradeSignalConfig[tradeSignal].color}`}>
                                    {TradeSignalConfig[tradeSignal].label}
                                </p>
                                {tradeSignalReason && (
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                                        {tradeSignalReason}
                                    </p>
                                )}
                            </div>
                            {React.createElement(TradeSignalConfig[tradeSignal].icon, {
                                size: 18,
                                className: `${TradeSignalConfig[tradeSignal].color} shrink-0`
                            })}
                        </div>
                    )}

                    {/* Insight Cards */}
                    {isLoading && insights.length === 0 ? (
                        <div className="space-y-4 p-1">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="space-y-2">
                                    <SkeletonLine width="30%" height={8} rounded />
                                    <SkeletonLine width="100%" height={12} />
                                    <SkeletonLine width="80%" height={12} />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {insights.map((insight) => {
                                const config = SeverityConfig[insight.severity];
                                const Icon = config.icon;
                                return (
                                    <div key={insight.id} className={`rounded-xl border p-3 ${config.bg} ${config.border}`}>
                                        <div className="flex items-start gap-2.5">
                                            <Icon size={15} className={`${config.iconColor} shrink-0 mt-0.5`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${config.badge}`}>
                                                        {config.label}
                                                    </span>
                                                    <span className="text-xs font-bold text-slate-800 dark:text-white">
                                                        {insight.title}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                                                    {insight.body}
                                                </p>
                                                {insight.action && (
                                                    <button
                                                        onClick={() => insight.actionTab && onNavigate?.(insight.actionTab)}
                                                        className={`mt-2 flex items-center gap-1 text-[10px] font-bold ${config.iconColor} hover:underline`}
                                                    >
                                                        {insight.action}
                                                        <ArrowRight size={10} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-1">
                        <p className="text-[9px] text-slate-400 flex items-center gap-1">
                            <Sparkles size={9} />
                            Powered by Gemini with Google Search Grounding
                        </p>
                        <button
                            onClick={onRefresh}
                            className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 flex items-center gap-1 hover:underline"
                        >
                            <Zap size={9} /> Refresh analysis
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
