import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowUpDown, Check, X, TrendingUp, TrendingDown,
    Heart, AlertTriangle, CheckCircle, BarChart3,
    RefreshCw, Download, Share2, ChevronDown
} from 'lucide-react';
import { Investment } from '../../types';
import {
    compareAssets,
    calculateHoldingsHealthScore,
    calculateRebalance
} from '../../utils/FinancialCalculators';

// ==================== ASSET COMPARISON TOOL ====================

interface AssetComparisonProps {
    investments: Investment[];
    onClose?: () => void;
}

export const AssetComparisonTool: React.FC<AssetComparisonProps> = ({ investments, onClose }) => {
    const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
    const maxSelection = 3;

    const toggleAsset = (id: string) => {
        if (selectedAssets.includes(id)) {
            setSelectedAssets(prev => prev.filter(a => a !== id));
        } else if (selectedAssets.length < maxSelection) {
            setSelectedAssets(prev => [...prev, id]);
        }
    };

    const selectedInvestments = investments.filter(inv => selectedAssets.includes(inv.id!));
    const comparison = useMemo(() =>
        selectedInvestments.length > 0 ? compareAssets(selectedInvestments) : null,
        [selectedInvestments]
    );

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-indigo-500" />
                    Asset Comparison Tool
                </h3>
                {onClose && (
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                )}
            </div>

            {/* Asset Selection */}
            <div className="mb-6">
                <p className="text-sm text-slate-500 mb-3">
                    Select up to {maxSelection} assets to compare ({selectedAssets.length}/{maxSelection})
                </p>
                <div className="flex flex-wrap gap-2">
                    {investments.map(inv => (
                        <button
                            key={inv.id}
                            onClick={() => toggleAsset(inv.id!)}
                            className={`px-3 py-1.5 rounded-full text-sm transition-all ${selectedAssets.includes(inv.id!)
                                ? 'bg-indigo-500 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                                }`}
                        >
                            {inv.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* Comparison Table */}
            {comparison && comparison.comparison.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700">
                                <th className="text-left py-3 px-4 text-sm font-medium text-slate-500">Metric</th>
                                {comparison.comparison.map(asset => (
                                    <th key={asset.name} className="text-right py-3 px-4 text-sm font-medium text-slate-900 dark:text-white">
                                        {asset.name}
                                        {asset.rank === 1 && <span className="ml-1">👑</span>}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="border-b border-slate-100 dark:border-slate-800">
                                <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-400">Invested</td>
                                {comparison.comparison.map(asset => (
                                    <td key={asset.name} className="text-right py-3 px-4 text-sm font-medium text-slate-900 dark:text-white">
                                        ₹{asset.invested.toLocaleString()}
                                    </td>
                                ))}
                            </tr>
                            <tr className="border-b border-slate-100 dark:border-slate-800">
                                <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-400">Current Value</td>
                                {comparison.comparison.map(asset => (
                                    <td key={asset.name} className="text-right py-3 px-4 text-sm font-medium text-slate-900 dark:text-white">
                                        ₹{asset.current.toLocaleString()}
                                    </td>
                                ))}
                            </tr>
                            <tr className="border-b border-slate-100 dark:border-slate-800">
                                <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-400">Returns</td>
                                {comparison.comparison.map(asset => (
                                    <td key={asset.name} className={`text-right py-3 px-4 text-sm font-medium ${asset.returnsPercent >= 0 ? 'text-emerald-500' : 'text-red-500'
                                        }`}>
                                        {asset.returnsPercent >= 0 ? '+' : ''}{asset.returnsPercent.toFixed(2)}%
                                    </td>
                                ))}
                            </tr>
                            <tr>
                                <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-400">Health Score</td>
                                {comparison.comparison.map(asset => (
                                    <td key={asset.name} className="text-right py-3 px-4">
                                        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${asset.healthScore >= 70 ? 'bg-emerald-100 text-emerald-700' :
                                            asset.healthScore >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-red-100 text-red-700'
                                            }`}>
                                            {asset.healthScore >= 70 ? <CheckCircle size={12} /> :
                                                asset.healthScore >= 50 ? <AlertTriangle size={12} /> :
                                                    <X size={12} />}
                                            {asset.healthScore}/100
                                        </div>
                                    </td>
                                ))}
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// ==================== HOLDINGS HEALTH SCORE ====================

interface HealthScoreCardProps {
    investment: Investment;
}

export const HealthScoreCard: React.FC<HealthScoreCardProps> = ({ investment }) => {
    const health = useMemo(() => calculateHoldingsHealthScore(investment), [investment]);

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-emerald-500';
        if (score >= 60) return 'text-yellow-500';
        if (score >= 40) return 'text-orange-500';
        return 'text-red-500';
    };

    const getScoreGradient = (score: number) => {
        if (score >= 80) return 'from-emerald-500 to-teal-500';
        if (score >= 60) return 'from-yellow-500 to-orange-500';
        if (score >= 40) return 'from-orange-500 to-red-500';
        return 'from-red-500 to-pink-500';
    };

    return (
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{investment.name}</span>
                <div className={`text-2xl font-bold ${getScoreColor(health.score)}`}>
                    {health.score}
                </div>
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-3">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${health.score}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className={`h-full bg-gradient-to-r ${getScoreGradient(health.score)}`}
                />
            </div>

            {/* Factors */}
            <div className="space-y-1">
                {Object.entries(health.factors).map(([factor, score]) => (
                    <div key={factor} className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 capitalize">{factor.replace(/([A-Z])/g, ' $1')}</span>
                        <span className={score >= 70 ? 'text-emerald-500' : score >= 50 ? 'text-yellow-500' : 'text-red-500'}>
                            {score.toFixed(0)}
                        </span>
                    </div>
                ))}
            </div>

            {/* Recommendation */}
            <div className={`mt-3 text-xs font-medium px-2 py-1 rounded-full text-center ${health.recommendation.includes('Strong') ? 'bg-emerald-100 text-emerald-700' :
                health.recommendation.includes('Monitor') ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                }`}>
                {health.recommendation}
            </div>
        </div>
    );
};

// ==================== SMART REBALANCE ====================

interface SmartRebalanceProps {
    investments: Investment[];
    onExecute?: (actions: ReturnType<typeof calculateRebalance>) => void;
}

export const SmartRebalance: React.FC<SmartRebalanceProps> = ({ investments, onExecute }) => {
    const [targetAllocation, setTargetAllocation] = useState<Record<string, number>>({
        'Stocks': 50,
        'Mutual Fund': 30,
        'Gold': 10,
        'Fixed Deposit': 10
    });

    const rebalanceActions = useMemo(() =>
        calculateRebalance(investments, targetAllocation),
        [investments, targetAllocation]
    );

    const totalValue = investments.reduce((sum, inv) => sum + inv.currentValue, 0);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 text-indigo-500" />
                    Smart Rebalance
                </h3>
                <span className="text-sm text-slate-500">
                    Portfolio: ₹{totalValue.toLocaleString()}
                </span>
            </div>

            {/* Rebalance Actions */}
            <div className="space-y-3">
                {rebalanceActions.map(action => (
                    <div
                        key={action.type}
                        className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl"
                    >
                        <div>
                            <span className="font-medium text-slate-900 dark:text-white">{action.type}</span>
                            <div className="text-xs text-slate-500">
                                {action.currentPercent}% → {action.targetPercent}%
                            </div>
                        </div>
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${action.action === 'BUY' ? 'bg-emerald-100 text-emerald-700' :
                            action.action === 'SELL' ? 'bg-red-100 text-red-700' :
                                'bg-slate-100 text-slate-600'
                            }`}>
                            {action.action === 'BUY' && <TrendingUp size={14} />}
                            {action.action === 'SELL' && <TrendingDown size={14} />}
                            {action.action === 'HOLD' ? 'Balanced' : `${action.action} ₹${action.amount.toLocaleString()}`}
                        </div>
                    </div>
                ))}
            </div>

            {/* Execute Button */}
            {onExecute && rebalanceActions.some(a => a.action !== 'HOLD') && (
                <button
                    onClick={() => onExecute(rebalanceActions)}
                    className="w-full mt-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium rounded-xl hover:shadow-lg transition-all"
                >
                    Execute Rebalance
                </button>
            )}
        </div>
    );
};

// ==================== BULK EDIT MODE ====================

interface BulkEditProps {
    investments: Investment[];
    onBulkUpdate: (ids: string[], updates: Partial<Investment>) => void;
    onBulkDelete: (ids: string[]) => void;
}

export const BulkEditMode: React.FC<BulkEditProps> = ({ investments, onBulkUpdate, onBulkDelete }) => {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [bulkAction, setBulkAction] = useState<string>('');

    const toggleSelect = (id: string) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const selectAll = () => {
        setSelectedIds(investments.map(i => i.id!));
    };

    const clearSelection = () => {
        setSelectedIds([]);
    };

    const executeBulkAction = () => {
        if (selectedIds.length === 0) return;

        switch (bulkAction) {
            case 'delete':
                if (confirm(`Delete ${selectedIds.length} assets?`)) {
                    onBulkDelete(selectedIds);
                    clearSelection();
                }
                break;
            case 'update-type':
                // Update category to PORTFOLIO
                onBulkUpdate(selectedIds, { category: 'PORTFOLIO' });
                clearSelection();
                break;
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                    <button
                        onClick={selectAll}
                        className="text-sm text-indigo-500 hover:text-indigo-600"
                    >
                        Select All
                    </button>
                    <button
                        onClick={clearSelection}
                        className="text-sm text-slate-500 hover:text-slate-600"
                    >
                        Clear
                    </button>
                    <span className="text-sm text-slate-400">
                        {selectedIds.length} selected
                    </span>
                </div>

                {selectedIds.length > 0 && (
                    <div className="flex items-center gap-2">
                        <select
                            value={bulkAction}
                            onChange={(e) => setBulkAction(e.target.value)}
                            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800"
                        >
                            <option value="">Select action...</option>
                            <option value="delete">Delete Selected</option>
                            <option value="update-type">Set Category: Portfolio</option>
                        </select>
                        <button
                            onClick={executeBulkAction}
                            disabled={!bulkAction}
                            className="px-4 py-1.5 bg-indigo-500 text-white text-sm rounded-lg disabled:opacity-50"
                        >
                            Apply
                        </button>
                    </div>
                )}
            </div>

            {/* Asset List */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
                {investments.map(inv => (
                    <div
                        key={inv.id}
                        onClick={() => toggleSelect(inv.id!)}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${selectedIds.includes(inv.id!)
                            ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                    >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${selectedIds.includes(inv.id!)
                            ? 'bg-indigo-500 border-indigo-500'
                            : 'border-slate-300'
                            }`}>
                            {selectedIds.includes(inv.id!) && <Check size={12} className="text-white" />}
                        </div>
                        <div className="flex-1">
                            <span className="font-medium text-slate-900 dark:text-white">{inv.name}</span>
                            <span className="text-xs text-slate-500 ml-2">{inv.type}</span>
                        </div>
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                            ₹{inv.currentValue.toLocaleString()}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default {
    AssetComparisonTool,
    HealthScoreCard,
    SmartRebalance,
    BulkEditMode
};
