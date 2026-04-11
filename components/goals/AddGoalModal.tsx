import React, { useState } from 'react';
import { X, Target, Calendar, DollarSign, Tag, FileText, Save } from 'lucide-react';
import { Goal } from '../../database';

interface AddGoalModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (goal: Omit<Goal, 'id' | 'createdAt'>) => void;
}

const CATEGORIES = [
    { id: 'Retirement', label: 'Retirement', emoji: '🏖️' },
    { id: 'House', label: 'House/Property', emoji: '🏠' },
    { id: 'Education', label: 'Education', emoji: '🎓' },
    { id: 'Travel', label: 'Travel', emoji: '✈️' },
    { id: 'Emergency', label: 'Emergency Fund', emoji: '🛡️' },
    { id: 'Wedding', label: 'Wedding', emoji: '💒' },
    { id: 'Vehicle', label: 'Vehicle', emoji: '🚗' },
    { id: 'Other', label: 'Other', emoji: '📦' },
];

const PRIORITIES = [
    { id: 'Critical', label: 'Critical', color: 'bg-rose-500', emoji: '🔥' },
    { id: 'Important', label: 'Important', color: 'bg-amber-500', emoji: '⚡' },
    { id: 'Nice-to-Have', label: 'Nice-to-Have', color: 'bg-blue-500', emoji: '💭' },
];

const COLORS = [
    '#6366f1', '#ec4899', '#10b981', '#f59e0b',
    '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16',
];

export const AddGoalModal: React.FC<AddGoalModalProps> = ({ isOpen, onClose, onAdd }) => {
    const [formData, setFormData] = useState({
        name: '',
        targetAmount: '',
        currentAmount: '0',
        targetDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 1 year from now
        category: 'Other' as Goal['category'],
        priority: 'Important' as Goal['priority'],
        color: COLORS[0],
        notes: '',
    });

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name.trim() || !formData.targetAmount) return;

        onAdd({
            name: formData.name.trim(),
            targetAmount: parseFloat(formData.targetAmount),
            currentAmount: parseFloat(formData.currentAmount) || 0,
            targetDate: formData.targetDate,
            category: formData.category,
            priority: formData.priority,
            color: formData.color,
            notes: formData.notes.trim() || undefined,
        });

        // Reset form
        setFormData({
            name: '',
            targetAmount: '',
            currentAmount: '0',
            targetDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            category: 'Other',
            priority: 'Important',
            color: COLORS[0],
            notes: '',
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-indigo-500/20 rounded-xl">
                            <Target className="text-indigo-500" size={20} />
                        </div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Add Financial Goal</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Goal Name */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                            Goal Name *
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="e.g., Dream Home Down Payment"
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                            required
                        />
                    </div>

                    {/* Amount Fields */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Target Amount *
                            </label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    type="number"
                                    value={formData.targetAmount}
                                    onChange={(e) => setFormData({ ...formData, targetAmount: e.target.value })}
                                    placeholder="500000"
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                    required
                                    min="0"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Saved So Far
                            </label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    type="number"
                                    value={formData.currentAmount}
                                    onChange={(e) => setFormData({ ...formData, currentAmount: e.target.value })}
                                    placeholder="0"
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                    min="0"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Target Date */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                            Target Date *
                        </label>
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="date"
                                value={formData.targetDate}
                                onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                required
                            />
                        </div>
                    </div>

                    {/* Category */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                            Category
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                            {CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, category: cat.id as Goal['category'] })}
                                    className={`p-2 rounded-xl border text-center transition-all ${formData.category === cat.id
                                            ? 'bg-indigo-500/20 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                                        }`}
                                >
                                    <div className="text-lg mb-1">{cat.emoji}</div>
                                    <div className="text-[10px] font-bold truncate">{cat.label}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Priority */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                            Priority
                        </label>
                        <div className="flex gap-2">
                            {PRIORITIES.map(pri => (
                                <button
                                    key={pri.id}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, priority: pri.id as Goal['priority'] })}
                                    className={`flex-1 p-3 rounded-xl border text-center transition-all ${formData.priority === pri.id
                                            ? `${pri.color}/20 border-${pri.color.replace('bg-', '')}/50`
                                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                                        }`}
                                    style={{
                                        backgroundColor: formData.priority === pri.id ? `${pri.color.replace('bg-', '')}20` : undefined,
                                    }}
                                >
                                    <span className="text-sm">{pri.emoji} {pri.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Color Picker */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                            Color
                        </label>
                        <div className="flex gap-2">
                            {COLORS.map(color => (
                                <button
                                    key={color}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, color })}
                                    className={`w-8 h-8 rounded-full transition-all ${formData.color === color ? 'ring-2 ring-offset-2 ring-indigo-500' : 'hover:scale-110'
                                        }`}
                                    style={{ backgroundColor: color }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                            Notes (Optional)
                        </label>
                        <textarea
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            placeholder="Any additional details..."
                            rows={2}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all resize-none"
                        />
                    </div>

                    {/* Submit */}
                    <button
                        type="submit"
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/30 transition-all"
                    >
                        <Save size={18} />
                        Create Goal
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AddGoalModal;
