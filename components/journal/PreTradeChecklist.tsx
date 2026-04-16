import React, { useState, useEffect } from 'react';
import { CheckCircle2, Circle, AlertTriangle, Shield, Zap, Brain, Target, TrendingUp } from 'lucide-react';

interface ChecklistItem {
    id: string;
    category: 'SETUP' | 'RISK' | 'PSYCHOLOGY';
    question: string;
    critical: boolean;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
    // Setup Validation
    { id: 'setup-1', category: 'SETUP', question: 'Is this trade aligned with my strategy/playbook?', critical: true },
    { id: 'setup-2', category: 'SETUP', question: 'Have I identified clear entry, target, and stop-loss levels?', critical: true },
    { id: 'setup-3', category: 'SETUP', question: 'Is there a catalyst or technical trigger?', critical: false },

    // Risk Management
    { id: 'risk-1', category: 'RISK', question: 'Am I risking less than my max % per trade?', critical: true },
    { id: 'risk-2', category: 'RISK', question: 'Is my position size appropriate for volatility?', critical: true },
    { id: 'risk-3', category: 'RISK', question: 'Can I afford to lose this money completely?', critical: true },

    // Psychology
    { id: 'psych-1', category: 'PSYCHOLOGY', question: 'Am I calm and not trading emotionally (revenge/FOMO)?', critical: true },
    { id: 'psych-2', category: 'PSYCHOLOGY', question: 'Have I slept well and am I in a clear headspace?', critical: false },
    { id: 'psych-3', category: 'PSYCHOLOGY', question: 'Am I okay with the outcome, win or lose?', critical: true },
];

interface PreTradeChecklistProps {
    onComplete?: (passed: boolean, score: number) => void;
    onReset?: () => void;
}

export const PreTradeChecklist: React.FC<PreTradeChecklistProps> = ({ onComplete, onReset }) => {
    const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
    const [isSubmitted, setIsSubmitted] = useState(false);

    const toggleItem = (id: string) => {
        if (isSubmitted) return;
        setCheckedItems(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const handleSubmit = () => {
        const criticalItems = DEFAULT_CHECKLIST.filter(i => i.critical);
        const criticalChecked = criticalItems.filter(i => checkedItems.has(i.id)).length;
        const score = (checkedItems.size / DEFAULT_CHECKLIST.length) * 100;
        const passed = criticalChecked === criticalItems.length;

        setIsSubmitted(true);
        onComplete?.(passed, score);
    };

    const handleReset = () => {
        setCheckedItems(new Set());
        setIsSubmitted(false);
        onReset?.();
    };

    const criticalItems = DEFAULT_CHECKLIST.filter(i => i.critical);
    const criticalChecked = criticalItems.filter(i => checkedItems.has(i.id)).length;
    const allCriticalPassed = criticalChecked === criticalItems.length;
    const score = (checkedItems.size / DEFAULT_CHECKLIST.length) * 100;

    const getCategoryIcon = (cat: string) => {
        switch (cat) {
            case 'SETUP': return Target;
            case 'RISK': return Shield;
            case 'PSYCHOLOGY': return Brain;
            default: return Zap;
        }
    };

    const getCategoryColor = (cat: string) => {
        switch (cat) {
            case 'SETUP': return 'text-indigo-500 bg-indigo-500/20';
            case 'RISK': return 'text-rose-500 bg-rose-500/20';
            case 'PSYCHOLOGY': return 'text-amber-500 bg-amber-500/20';
            default: return 'text-slate-500 bg-slate-500/20';
        }
    };

    const groupedItems = {
        SETUP: DEFAULT_CHECKLIST.filter(i => i.category === 'SETUP'),
        RISK: DEFAULT_CHECKLIST.filter(i => i.category === 'RISK'),
        PSYCHOLOGY: DEFAULT_CHECKLIST.filter(i => i.category === 'PSYCHOLOGY'),
    };

    return (
        <div className="glass-panel rounded-2xl p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-indigo-500/20">
                        <Shield className="text-indigo-500" size={18} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-700 dark:text-white">Pre-Trade Checklist</h3>
                        <p className="text-[10px] text-slate-500">Complete before every trade entry</p>
                    </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold ${isSubmitted
                    ? allCriticalPassed
                        ? 'bg-emerald-500/20 text-emerald-500'
                        : 'bg-rose-500/20 text-rose-500'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                    }`}>
                    {isSubmitted ? (allCriticalPassed ? 'CLEARED' : 'BLOCKED') : `${checkedItems.size}/${DEFAULT_CHECKLIST.length}`}
                </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
                <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-200 ${score >= 100 ? 'bg-emerald-500' : score >= 70 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                        style={{ width: `${score}%` }}
                    />
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-slate-500">
                    <span>Critical: {criticalChecked}/{criticalItems.length}</span>
                    <span>{score.toFixed(0)}%</span>
                </div>
            </div>

            {/* Checklist Groups */}
            <div className="space-y-4">
                {Object.entries(groupedItems).map(([category, items]) => {
                    const CategoryIcon = getCategoryIcon(category);
                    const colorClass = getCategoryColor(category);

                    return (
                        <div key={category}>
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`p-1 rounded ${colorClass}`}>
                                    <CategoryIcon size={12} />
                                </div>
                                <span className="text-[10px] font-bold uppercase text-slate-500">{category}</span>
                            </div>
                            <div className="space-y-2">
                                {items.map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => toggleItem(item.id)}
                                        disabled={isSubmitted}
                                        className={`w-full flex items-start gap-3 p-3 rounded-xl border transition-all ${checkedItems.has(item.id)
                                            ? 'bg-emerald-500/10 border-emerald-500/30'
                                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-indigo-500/50'
                                            } ${isSubmitted ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                    >
                                        <div className="mt-0.5">
                                            {checkedItems.has(item.id) ? (
                                                <CheckCircle2 className="text-emerald-500" size={18} />
                                            ) : (
                                                <Circle className="text-slate-400" size={18} />
                                            )}
                                        </div>
                                        <div className="flex-1 text-left">
                                            <p className={`text-sm ${checkedItems.has(item.id) ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                                {item.question}
                                            </p>
                                            {item.critical && (
                                                <span className="text-[10px] font-bold text-rose-500 uppercase">Required</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Actions */}
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex gap-2">
                {!isSubmitted ? (
                    <button
                        onClick={handleSubmit}
                        disabled={criticalChecked < criticalItems.length}
                        className={`flex-1 py-2 px-4 rounded-xl font-bold text-sm transition-all ${criticalChecked >= criticalItems.length
                            ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/30'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        <span className="flex items-center justify-center gap-2">
                            <Zap size={16} />
                            {criticalChecked >= criticalItems.length ? 'Confirm Ready to Trade' : `Complete ${criticalItems.length - criticalChecked} Required Items`}
                        </span>
                    </button>
                ) : (
                    <>
                        <button
                            onClick={handleReset}
                            className="flex-1 py-2 px-4 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-300 dark:hover:bg-slate-700 transition-all"
                        >
                            Reset Checklist
                        </button>
                        {allCriticalPassed && (
                            <button
                                className="flex-1 py-2 px-4 rounded-xl bg-indigo-500 text-white font-bold text-sm hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/30"
                            >
                                <span className="flex items-center justify-center gap-2">
                                    <TrendingUp size={16} />
                                    Proceed to Trade
                                </span>
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Blocked Warning */}
            {isSubmitted && !allCriticalPassed && (
                <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={18} />
                    <div>
                        <p className="text-sm font-bold text-rose-500">Trade Blocked</p>
                        <p className="text-xs text-rose-400">
                            You haven't confirmed all required items. Reset and complete the checklist before trading.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PreTradeChecklist;
