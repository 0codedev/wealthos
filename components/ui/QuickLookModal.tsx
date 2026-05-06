import React from 'react';
import { createPortal } from 'react-dom';
import { useQuickLookStore } from '../../hooks/useQuickLook';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { 
    X, 
    TrendingUp, 
    TrendingDown, 
    Sparkles, 
    Building, 
    Calendar, 
    Tag, 
    Activity, 
    Eye, 
    ArrowUpRight, 
    ArrowDownLeft,
    Zap,
    ExternalLink
} from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';

export const QuickLookModal: React.FC = () => {
    const { isOpen, current, closeQuickLook } = useQuickLookStore();

    const modalRef = useModalKeyboard({
        isOpen,
        onClose: closeQuickLook
    });

    if (!isOpen || !current || typeof document === 'undefined') return null;

    const renderSparkline = (data: number[] = [10, 12, 11, 14, 13, 16, 18, 17, 21, 24], isPositive = true) => {
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const width = 240;
        const height = 48;
        
        const points = data
            .map((val, idx) => {
                const x = (idx / (data.length - 1)) * width;
                const y = height - ((val - min) / range) * (height - 8) - 4;
                return `${x},${y}`;
            })
            .join(' ');

        return (
            <svg width={width} height={height} className="overflow-visible">
                <polyline
                    fill="none"
                    stroke={isPositive ? '#10b981' : '#f43f5e'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={points}
                />
            </svg>
        );
    };

    return createPortal(
        <div 
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[99999] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
            onClick={closeQuickLook}
        >
            <div 
                ref={modalRef}
                className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative"
                onClick={e => e.stopPropagation()}
            >
                {/* Top header badge */}
                <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
                    <div className="flex items-center gap-2.5">
                        <span className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                            <Sparkles size={16} />
                        </span>
                        <div>
                            <span className="text-[10px] font-mono uppercase font-bold text-slate-400 tracking-wider">
                                QuickLook Preview • {current.type}
                            </span>
                            <h2 className="text-lg font-bold text-white font-display">
                                {current.type === 'STOCK' && current.data.symbol}
                                {current.type === 'TRANSACTION' && (current.data.merchant || current.data.description)}
                                {current.type === 'INVESTMENT' && current.data.name}
                                {current.type === 'IPO' && current.data.companyName}
                            </h2>
                        </div>
                    </div>
                    <button 
                        onClick={closeQuickLook}
                        className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        aria-label="Close preview"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content Body Based on Type */}
                <div className="p-6 space-y-6">
                    {/* 1. STOCK PREVIEW */}
                    {current.type === 'STOCK' && (
                        <div className="space-y-5">
                            <div className="flex items-end justify-between">
                                <div>
                                    <div className="text-xs text-slate-400">Live Price (LTP)</div>
                                    <div className="text-3xl font-black text-white font-mono tracking-tight">
                                        ₹{current.data.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                    </div>
                                    <div className={`flex items-center gap-1.5 text-xs font-bold mt-1 ${current.data.pctChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {current.data.pctChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                        {current.data.pctChange >= 0 ? '+' : ''}{current.data.pctChange.toFixed(2)}%
                                    </div>
                                </div>
                                <div>
                                    {renderSparkline(current.data.sparkline, current.data.pctChange >= 0)}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <div className="p-3.5 rounded-2xl bg-slate-800/50 border border-slate-800">
                                    <div className="text-[10px] uppercase font-bold text-slate-400">R-Factor Score</div>
                                    <div className="text-base font-black text-amber-400 font-mono mt-0.5">
                                        {current.data.rFactor !== undefined ? current.data.rFactor.toFixed(2) : '1.85'}
                                    </div>
                                </div>
                                <div className="p-3.5 rounded-2xl bg-slate-800/50 border border-slate-800">
                                    <div className="text-[10px] uppercase font-bold text-slate-400">Sector / Category</div>
                                    <div className="text-base font-bold text-slate-200 truncate mt-0.5">
                                        {current.data.sector || 'EQUITY'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 2. TRANSACTION PREVIEW */}
                    {current.type === 'TRANSACTION' && (
                        <div className="space-y-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-xs text-slate-400">Amount</div>
                                    <div className={`text-3xl font-black font-mono tracking-tight ${current.data.type === 'credit' ? 'text-emerald-400' : 'text-slate-100'}`}>
                                        {current.data.type === 'credit' ? '+' : '-'}₹{current.data.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wide border ${
                                    current.data.type === 'credit' 
                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                }`}>
                                    {current.data.type}
                                </span>
                            </div>

                            <div className="space-y-2.5 p-4 rounded-2xl bg-slate-800/40 border border-slate-800">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-slate-400 flex items-center gap-1.5"><Tag size={13} /> Category</span>
                                    <span className="text-slate-200 font-semibold">{current.data.category}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-slate-400 flex items-center gap-1.5"><Calendar size={13} /> Date</span>
                                    <span className="text-slate-200 font-mono">{new Date(current.data.date).toLocaleDateString()}</span>
                                </div>
                                {current.data.bankName && (
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-slate-400 flex items-center gap-1.5"><Building size={13} /> Account</span>
                                        <span className="text-slate-200 font-semibold">{current.data.bankName}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 3. INVESTMENT PREVIEW */}
                    {current.type === 'INVESTMENT' && (
                        <div className="space-y-5">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3.5 rounded-2xl bg-slate-800/50 border border-slate-800">
                                    <div className="text-[10px] uppercase font-bold text-slate-400">Current Value</div>
                                    <div className="text-xl font-black text-white font-mono mt-0.5">
                                        ₹{current.data.currentValue.toLocaleString('en-IN')}
                                    </div>
                                </div>
                                <div className="p-3.5 rounded-2xl bg-slate-800/50 border border-slate-800">
                                    <div className="text-[10px] uppercase font-bold text-slate-400">Invested Amount</div>
                                    <div className="text-xl font-black text-slate-400 font-mono mt-0.5">
                                        ₹{current.data.investedAmount.toLocaleString('en-IN')}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 text-xs">
                                <span className="text-slate-400 font-medium">Asset Class / Type</span>
                                <span className="text-indigo-400 font-bold uppercase">{current.data.type}</span>
                            </div>
                        </div>
                    )}

                    {/* 4. IPO PREVIEW */}
                    {current.type === 'IPO' && (
                        <div className="space-y-5">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3.5 rounded-2xl bg-slate-800/50 border border-slate-800">
                                    <div className="text-[10px] uppercase font-bold text-slate-400">Issue Price</div>
                                    <div className="text-xl font-black text-white font-mono mt-0.5">
                                        ₹{current.data.issuePrice}
                                    </div>
                                </div>
                                <div className="p-3.5 rounded-2xl bg-slate-800/50 border border-slate-800">
                                    <div className="text-[10px] uppercase font-bold text-slate-400">GMP Premium</div>
                                    <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
                                        {current.data.gmp ? `+₹${current.data.gmp}` : 'N/A'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Dismiss Hint */}
                <div className="p-4 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5">
                        Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[10px]">Space</kbd> or <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[10px]">Esc</kbd> to close
                    </span>
                    <span className="text-indigo-400 font-semibold flex items-center gap-1">
                        <Zap size={12} /> WealthOS QuickLook
                    </span>
                </div>
            </div>
        </div>,
        document.body
    );
};
