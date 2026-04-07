import React, { useMemo, useState } from 'react';
import { useTransactions } from '../../../contexts/TransactionContext';
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Calendar as CalendarIcon } from 'lucide-react';

interface CashFlowHeaderProps {
    formatCurrency: (val: number) => string;
}

type TimeRange = 'D' | 'W' | 'M' | 'Y' | 'ALL' | 'CUSTOM';

export const CashFlowHeader: React.FC<CashFlowHeaderProps> = ({ formatCurrency }) => {
    const { transactions } = useTransactions();
    const [range, setRange] = useState<TimeRange>('M');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [isCustomOpen, setIsCustomOpen] = useState(false);

    const filteredStats = useMemo(() => {
        const now = new Date();
        
        // Start of Today (00:00:00 local)
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // Sliding Week: Last 7 days (including today)
        const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        
        // Start of Current Month (1st 00:00:00 local)
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // Start of Current Year (Jan 1st 00:00:00 local)
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        const filteredTxns = transactions.filter(t => {
            if (t.excluded) return false;
            
            const tDate = new Date(t.date);
            if (range === 'D') return tDate >= startOfToday;
            if (range === 'W') return tDate >= sevenDaysAgo;
            if (range === 'M') return tDate >= startOfMonth;
            if (range === 'Y') return tDate >= startOfYear;
            if (range === 'CUSTOM') {
                const start = customStart ? new Date(customStart) : new Date(0);
                start.setHours(0, 0, 0, 0); // Start of local day
                
                const end = customEnd ? new Date(customEnd) : new Date();
                end.setHours(23, 59, 59, 999); // End of local day
                
                return tDate >= start && tDate <= end;
            }
            return true;
        });

        // Calculate totals
        const expense = filteredTxns
            .filter(t => t.type === 'debit')
            .reduce((sum, t) => sum + t.amount, 0);

        const income = filteredTxns
            .filter(t => t.type === 'credit')
            .reduce((sum, t) => sum + t.amount, 0);

        const savings = income - expense;
        const savingsRate = income > 0 ? Math.round((savings / income) * 100) : 0;

        return { income, expense, savings, savingsRate };
    }, [transactions, range, customStart, customEnd]);

    return (
        <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-xl relative border border-slate-800 z-40 overflow-visible">
            {/* Background Effects */}
            <div className="absolute top-0 right-0 p-12 bg-indigo-500/20 blur-3xl rounded-full pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 p-12 bg-emerald-500/10 blur-3xl rounded-full pointer-events-none"></div>

            <div className="relative z-10 overflow-visible">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <div>
                        <p className="text-slate-400 font-medium text-sm mb-1 uppercase tracking-wider">Net Cash Flow</p>
                        <h2 className="text-4xl font-black">{formatCurrency(filteredStats.savings)}</h2>
                        <p className={`text-sm mt-2 flex items-center gap-1 font-bold ${filteredStats.savings >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {filteredStats.savings >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                            {filteredStats.savingsRate}% Savings Rate
                        </p>
                    </div>

                    {/* Time Filters */}
                    <div className="flex flex-col items-end gap-2">
                        <div className="bg-slate-800/50 backdrop-blur-md p-1 rounded-xl border border-white/10 flex items-center">
                            {(['D', 'W', 'M', 'Y', 'ALL'] as TimeRange[]).map((r) => (
                                <button
                                    key={r}
                                    onClick={() => {
                                        setRange(r);
                                        setIsCustomOpen(false);
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${range === r && !isCustomOpen
                                            ? 'bg-indigo-500 text-white shadow-lg'
                                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    {r === 'ALL' ? 'End' : r}
                                </button>
                            ))}
                            <div className="w-px h-4 bg-white/10 mx-1"></div>
                            <button 
                                onClick={() => setIsCustomOpen(!isCustomOpen)}
                                className={`px-2 py-1.5 rounded-lg transition-all relative ${isCustomOpen || range === 'CUSTOM' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                            >
                                <CalendarIcon size={14} />
                                {range === 'CUSTOM' && !isCustomOpen && (
                                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-400 rounded-full border border-slate-900" />
                                )}
                            </button>
                        </div>

                        {/* Floating Custom Range Popover */}
                        {isCustomOpen && (
                            <div className="absolute top-[45%] right-0 z-[9999] bg-slate-900/98 backdrop-blur-3xl p-5 rounded-3xl border border-white/20 shadow-[0_30px_70px_rgba(0,0,0,0.8)] flex flex-col gap-4 animate-in fade-in zoom-in-95 slide-in-from-top-4 duration-300 min-w-[280px]">
                                <div className="flex items-center justify-between px-1">
                                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Select Range</span>
                                    {range === 'CUSTOM' && (
                                        <button 
                                            onClick={() => {
                                                setRange('M');
                                                setIsCustomOpen(false);
                                                setCustomStart('');
                                                setCustomEnd('');
                                            }}
                                            className="text-[9px] font-bold text-slate-500 hover:text-rose-400 transition-colors"
                                        >
                                            Reset
                                        </button>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <div className="group">
                                        <label className="text-[9px] font-black text-slate-500 uppercase ml-1 mb-1 block group-focus-within:text-indigo-400 transition-colors">Start Date</label>
                                        <div className="relative">
                                            <input 
                                                type="date" 
                                                value={customStart}
                                                onChange={(e) => {
                                                    setCustomStart(e.target.value);
                                                    setRange('CUSTOM');
                                                }}
                                                className="w-full bg-slate-800/50 border border-white/5 hover:border-white/10 focus:border-indigo-500/50 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex justify-center">
                                        <div className="w-1 h-4 bg-slate-800 rounded-full"></div>
                                    </div>

                                    <div className="group">
                                        <label className="text-[9px] font-black text-slate-500 uppercase ml-1 mb-1 block group-focus-within:text-indigo-400 transition-colors">End Date</label>
                                        <div className="relative">
                                            <input 
                                                type="date" 
                                                value={customEnd}
                                                onChange={(e) => {
                                                    setCustomEnd(e.target.value);
                                                    setRange('CUSTOM');
                                                }}
                                                className="w-full bg-slate-800/50 border border-white/5 hover:border-white/10 focus:border-indigo-500/50 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none transition-all"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <button 
                                    onClick={() => setIsCustomOpen(false)}
                                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black rounded-xl shadow-lg shadow-indigo-600/20 transition-all active:scale-95 uppercase tracking-widest mt-1"
                                >
                                    Apply Filter
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-8">
                    <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                        <p className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                            <ArrowDownRight size={14} className="text-emerald-400" /> Income
                        </p>
                        <p className="text-xl font-bold">{formatCurrency(filteredStats.income)}</p>
                    </div>
                    <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                        <p className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                            <ArrowUpRight size={14} className="text-rose-400" /> Expense
                        </p>
                        <p className="text-xl font-bold">{formatCurrency(filteredStats.expense)}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
