import React, { useState, useMemo } from 'react';
import { X, RefreshCw, ArrowRight, CheckCircle, AlertTriangle } from 'lucide-react';
import { Investment, InvestmentType } from '../types';
import { useToast } from './shared/ToastProvider';
import { safeAsync } from '../utils/safeAsync';
import { newIdempotencyKey, checkAndStoreIdempotencyKey, clearIdempotencyKey } from '../utils/idempotency';
import { MotionButton } from './ui/MotionButton';

interface RebalanceModalProps {
    investments: Investment[];
    totalAssets: number;
    onClose: () => void;
    formatCurrency: (val: number) => string;
}

const TARGET_ALLOCATIONS: Record<string, number> = {
    'Equity & Related': 50,
    'Commodities': 15,
    'Fixed Income': 20,
    'Crypto': 10,
    'Real Estate': 5,
    'Other': 0
};

const getAssetClass = (type: InvestmentType): string => {
    switch (type) {
        case InvestmentType.STOCKS:
        case InvestmentType.MUTUAL_FUND:
        case InvestmentType.SMALLCASE:
        case InvestmentType.ETF:
        case InvestmentType.TRADING:
            return 'Equity & Related';
        case InvestmentType.DIGITAL_GOLD:
        case InvestmentType.DIGITAL_SILVER:
            return 'Commodities';
        case InvestmentType.CRYPTO:
            return 'Crypto';
        case InvestmentType.FD:
        case InvestmentType.CASH:
            return 'Fixed Income';
        case InvestmentType.REAL_ESTATE:
            return 'Real Estate';
        default:
            return 'Other';
    }
};

const RebalanceModal: React.FC<RebalanceModalProps> = ({ investments, totalAssets, onClose, formatCurrency }) => {
    const { toast } = useToast();
    const [targets, setTargets] = useState(TARGET_ALLOCATIONS);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleApplyTargets = async () => {
        if (isSubmitting) return; // Pillar 3A: double-submit guard
        // Pillar 3A: idempotency key — 60s de-dup window
        const idemKey = newIdempotencyKey('rebalance');
        if (checkAndStoreIdempotencyKey('rebalance', idemKey)) {
            return;
        }
        setIsSubmitting(true);

        const result = await safeAsync(async () => {
            // Persist the rebalance targets to local settings so the next
            // session reopens with the user's custom allocation. Real broker
            // order placement is out of scope for this modal — it is a
            // planning surface, not an execution surface.
            try {
                localStorage.setItem('rebalance_targets_v1', JSON.stringify(targets));
            } catch (err) {
                // localStorage may be unavailable (private mode, quota) —
                // bubble up to safeAsync so it shows the dismissable error toast.
                throw err;
            }
        });

        if (result.ok) {
            toast.success('Allocation targets saved. Next rebalance will use these.');
            clearIdempotencyKey('rebalance', idemKey);
            onClose();
        } else {
            // safeAsync already showed the dismissable error toast with "Copy details".
            clearIdempotencyKey('rebalance', idemKey);
        }
        setIsSubmitting(false);
    };

    const analysis = useMemo(() => {
        const currentMap: Record<string, number> = {};
        investments.forEach(inv => {
            const cls = getAssetClass(inv.type);
            currentMap[cls] = (currentMap[cls] || 0) + inv.currentValue;
        });

        return Object.keys(targets).map(cls => {
            const currentVal = currentMap[cls] || 0;
            const currentPct = (currentVal / totalAssets) * 100;
            const targetPct = targets[cls];
            const targetVal = (targetPct / 100) * totalAssets;
            const diffVal = targetVal - currentVal;
            const action = diffVal > 0 ? 'BUY' : 'SELL';

            return {
                class: cls,
                currentVal,
                currentPct,
                targetPct,
                targetVal,
                diffVal,
                action
            };
        }).filter(item => Math.abs(item.diffVal) > 1000); // Filter small noise
    }, [investments, totalAssets, targets]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                            <RefreshCw size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Auto-Rebalance Bot</h3>
                            <p className="text-xs text-slate-500">AI-driven portfolio alignment suggestions</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X size={20} className="text-slate-500" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex gap-3">
                        <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0" size={20} />
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                            These are suggestions based on standard models. Please consult a financial advisor before executing large trades.
                        </p>
                    </div>

                    <div className="space-y-4">
                        {analysis.map((item) => (
                            <div key={item.class} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="font-bold text-slate-900 dark:text-white">{item.class}</h4>
                                        <span className="text-xs font-mono px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-slate-600 dark:text-slate-300">
                                            {item.currentPct.toFixed(1)}% → {item.targetPct}%
                                        </span>
                                    </div>
                                    <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-2">
                                        <div className="h-full bg-slate-400" style={{ width: `${Math.min(100, (item.currentVal / item.targetVal) * 100)}%` }}></div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 ml-4">
                                    <ArrowRight className="text-slate-300" size={16} />
                                    <div className={`text-right min-w-[100px] ${item.action === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        <p className="text-xs font-bold opacity-70">{item.action}</p>
                                        <p className="font-bold font-mono">{formatCurrency(Math.abs(item.diffVal))}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-end">
                    <button onClick={onClose} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20">
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RebalanceModal;
