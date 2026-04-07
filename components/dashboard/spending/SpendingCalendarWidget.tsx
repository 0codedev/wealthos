import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useTransactions } from '../../../contexts/TransactionContext';

interface SpendingCalendarWidgetProps {
    formatCurrency: (val: number) => string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const SpendingCalendarWidget: React.FC<SpendingCalendarWidgetProps> = ({ formatCurrency }) => {
    const { transactions } = useTransactions();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [showOverlay, setShowOverlay] = useState(false);

    // --- Calendar Logic ---
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // --- Data Aggregation ---
    const dailyData = useMemo(() => {
        const map: Record<string, { spent: number, count: number }> = {};

        transactions.forEach(t => {
            if (t.type === 'debit') {
                const d = new Date(t.date);
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // YYYY-MM-DD

                if (!map[dateStr]) map[dateStr] = { spent: 0, count: 0 };
                map[dateStr].spent += t.amount;
                map[dateStr].count += 1;
            }
        });

        return map;
    }, [transactions]);

    const monthStats = useMemo(() => {
        let totalSpent = 0;
        let activeDays = 0;

        Object.entries(dailyData).forEach(([date, data]) => {
            const d = new Date(date);
            if (d.getMonth() === month && d.getFullYear() === year && data.spent > 0) {
                totalSpent += data.spent;
                activeDays++;
            }
        });

        return { totalSpent, activeDays };
    }, [dailyData, month, year]);

    // --- Handlers ---
    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    // --- Render Helpers ---
    const renderDayCell = (day: number, isCurrentMonth: boolean) => {
        if (!isCurrentMonth) return <div className="h-14 bg-transparent border border-slate-100 dark:border-slate-800/50 rounded-lg opacity-20 pointer-events-none"></div>;

        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const data = dailyData[dateStr];
        const hasSpending = !!data && data.spent > 0;

        // Intensity Logic
        let bgClass = "bg-white dark:bg-slate-900";
        if (hasSpending) {
            if (data.spent > 10000) bgClass = "bg-indigo-600 dark:bg-indigo-600/90 text-white";
            else if (data.spent > 5000) bgClass = "bg-indigo-500/80 dark:bg-indigo-500/80 text-white";
            else if (data.spent > 1000) bgClass = "bg-indigo-400/60 dark:bg-indigo-400/40 text-slate-900 dark:text-white";
            else bgClass = "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400";
        }

        return (
            <div
                className={`h-14 rounded-lg border p-1 relative transition-all group overflow-hidden flex flex-col justify-between
                ${!hasSpending ? 'border-slate-100 dark:border-slate-800' : 'border-transparent shadow-sm'}
                ${bgClass}
            `}
            >
                <span className={`text-[10px] font-bold ${hasSpending && data.spent > 5000 ? 'text-white/70' : 'text-slate-400'}`}>
                    {day}
                </span>

                {hasSpending && (
                    <div className="text-center">
                        <div className={`text-[10px] md:text-xs font-black tracking-tight leading-none truncate`}>
                            {formatCurrency(data.spent).replace('.00', '')}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <button onClick={prevMonth} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500">
                        <ChevronLeft size={18} />
                    </button>
                    <span className="font-bold text-sm text-slate-800 dark:text-white w-24 text-center">
                        {MONTHS[month]} <span className="text-indigo-500">{year}</span>
                    </span>
                    <button onClick={nextMonth} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500">
                        <ChevronRight size={18} />
                    </button>
                </div>

                <div className="flex gap-4">
                    <div className="text-right">
                        <p className="text-[10px] uppercase font-bold text-slate-400">Total Spend</p>
                        <p className="text-sm font-black font-mono text-indigo-600 dark:text-indigo-400">
                            {formatCurrency(monthStats.totalSpent)}
                        </p>
                    </div>
                </div>
            </div>

            {/* Compressed Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
                {DAYS.map(d => (
                    <div key={d} className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        {d}
                    </div>
                ))}

                {/* Empty slots for previous month */}
                {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                    renderDayCell(i, false)
                ))}

                {/* Days of current month */}
                {Array.from({ length: daysInMonth }).map((_, i) => (
                    renderDayCell(i + 1, true)
                ))}
            </div>
        </div>
    );
};
