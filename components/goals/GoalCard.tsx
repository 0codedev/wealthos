import React, { useState } from 'react';
import {
    Target, Calendar, TrendingUp, Trash2, Edit2, Check, X,
    AlertCircle, Zap, Trophy, Home, GraduationCap, Plane, Shield, Heart, Car, Package
} from 'lucide-react';
import { Goal } from '../../database';
import { formatCurrency } from '../../utils/helpers';

interface GoalCardProps {
    goal: Goal;
    progress: number;
    onUpdate: (id: number, updates: Partial<Goal>) => void;
    onDelete: (id: number) => void;
    onComplete: (id: number) => void;
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
    'Retirement': Trophy,
    'House': Home,
    'Education': GraduationCap,
    'Travel': Plane,
    'Emergency': Shield,
    'Wedding': Heart,
    'Vehicle': Car,
    'Other': Package,
};

const PRIORITY_STYLES = {
    'Critical': { bg: 'bg-rose-500/20', border: 'border-rose-500/30', text: 'text-rose-500', label: '🔥 Critical' },
    'Important': { bg: 'bg-amber-500/20', border: 'border-amber-500/30', text: 'text-amber-500', label: '⚡ Important' },
    'Nice-to-Have': { bg: 'bg-blue-500/20', border: 'border-blue-500/30', text: 'text-blue-500', label: '💭 Nice-to-Have' },
};

export const GoalCard: React.FC<GoalCardProps> = ({ goal, progress, onUpdate, onDelete, onComplete }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editAmount, setEditAmount] = useState(goal.currentAmount.toString());

    const CategoryIcon = CATEGORY_ICONS[goal.category] || Target;
    const priorityStyle = PRIORITY_STYLES[goal.priority];

    const daysRemaining = Math.ceil(
        (new Date(goal.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    const monthsRemaining = Math.ceil(daysRemaining / 30);

    const gap = goal.targetAmount - goal.currentAmount;
    const monthlyNeeded = monthsRemaining > 0 ? gap / monthsRemaining : gap;

    const handleSaveAmount = () => {
        const newAmount = parseFloat(editAmount) || 0;
        onUpdate(goal.id!, { currentAmount: newAmount });
        setIsEditing(false);
    };

    const isCompleted = !!goal.completedAt || progress >= 100;

    return (
        <div
            className={`glass-panel rounded-2xl p-4 transition-all hover:scale-[1.01] ${isCompleted ? 'opacity-70 border-emerald-500/50' : ''
                }`}
            style={{ borderLeftColor: goal.color, borderLeftWidth: 4 }}
        >
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div
                        className="p-2 rounded-xl"
                        style={{ backgroundColor: `${goal.color}20` }}
                    >
                        <CategoryIcon size={20} style={{ color: goal.color }} />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">
                            {goal.name}
                        </h4>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${priorityStyle.bg} ${priorityStyle.text}`}>
                            {priorityStyle.label}
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                    {!isCompleted && (
                        <button
                            onClick={() => onComplete(goal.id!)}
                            className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors"
                            title="Mark Complete"
                        >
                            <Check size={14} />
                        </button>
                    )}
                    <button
                        onClick={() => onDelete(goal.id!)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                        title="Delete"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-3">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                    <span>{progress.toFixed(0)}% Complete</span>
                    <span>{monthsRemaining > 0 ? `${monthsRemaining} mo left` : 'Overdue'}</span>
                </div>
                <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className="h-full transition-all duration-500 rounded-full"
                        style={{
                            width: `${progress}%`,
                            backgroundColor: progress >= 100 ? '#10b981' : goal.color
                        }}
                    />
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
                {/* Current Amount */}
                <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Current</p>
                    {isEditing ? (
                        <div className="flex items-center gap-1">
                            <input
                                type="number"
                                value={editAmount}
                                onChange={(e) => setEditAmount(e.target.value)}
                                className="w-full px-2 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded font-mono"
                                autoFocus
                            />
                            <button onClick={handleSaveAmount} className="p-1 text-emerald-500">
                                <Check size={12} />
                            </button>
                            <button onClick={() => setIsEditing(false)} aria-label="Cancel goal edit" className="p-1 text-rose-500">
                                <X size={12} />
                            </button>
                        </div>
                    ) : (
                        <p
                            className="font-bold text-slate-800 dark:text-white cursor-pointer hover:text-indigo-500"
                            onClick={() => { setEditAmount(goal.currentAmount.toString()); setIsEditing(true); }}
                        >
                            {formatCurrency(goal.currentAmount)}
                        </p>
                    )}
                </div>

                {/* Target */}
                <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Target</p>
                    <p className="font-bold" style={{ color: goal.color }}>
                        {formatCurrency(goal.targetAmount)}
                    </p>
                </div>

                {/* Gap */}
                <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Gap</p>
                    <p className={`font-bold ${gap > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {gap > 0 ? formatCurrency(gap) : 'Done!'}
                    </p>
                </div>

                {/* Monthly Needed */}
                <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Monthly</p>
                    <p className="font-bold text-amber-500">
                        {monthlyNeeded > 0 ? formatCurrency(monthlyNeeded) : '-'}
                    </p>
                </div>
            </div>

            {/* Deadline */}
            <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
                <span className="flex items-center gap-1">
                    <Calendar size={10} />
                    Target: {new Date(goal.targetDate).toLocaleDateString()}
                </span>
                {isCompleted && (
                    <span className="flex items-center gap-1 text-emerald-500 font-bold">
                        <Trophy size={10} />
                        ACHIEVED
                    </span>
                )}
            </div>
        </div>
    );
};

export default GoalCard;
