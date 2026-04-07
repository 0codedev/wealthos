import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    ChevronLeft, ChevronRight, TrendingUp, TrendingDown,
    Utensils, Divide, ShoppingBag, CreditCard, Car,
    Zap, HeartPulse, GraduationCap, Home, MoreHorizontal,
    ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useTransactions, Transaction } from '../../../contexts/TransactionContext';

interface JupiterAnalyticsWidgetProps {
    formatCurrency: (val: number) => string;
}

type TabType = 'SPENDS' | 'INVESTED' | 'INCOMING';

// Helper to get category icon
const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
        case 'food & dining': return <Utensils size={16} />;
        case 'groceries': return <ShoppingBag size={16} />;
        case 'shopping': return <ShoppingBag size={16} />;
        case 'bills & utilities': return <Zap size={16} />;
        case 'transport': return <Car size={16} />;
        case 'healthcare': return <HeartPulse size={16} />;
        case 'education': return <GraduationCap size={16} />;
        case 'rent': return <Home size={16} />;
        case 'investment': return <TrendingUp size={16} />;
        default: return <MoreHorizontal size={16} />;
    }
};

export const JupiterAnalyticsWidget: React.FC<JupiterAnalyticsWidgetProps> = ({ formatCurrency }) => {
    const { transactions } = useTransactions();
    const [activeTab, setActiveTab] = useState<TabType>('SPENDS');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [chartMode, setChartMode] = useState<'DAILY' | 'MONTHLY'>('DAILY');

    // --- Date Logic ---
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // Previous Month for comparison
    const prevDate = new Date(year, month - 1, 1);
    const prevYear = prevDate.getFullYear();
    const prevMonthIdx = prevDate.getMonth();

    const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    const monthName = currentDate.toLocaleString('default', { month: 'long' });
    const prevMonthName = prevDate.toLocaleString('default', { month: 'short' });
    const currMonthShort = currentDate.toLocaleString('default', { month: 'short' });

    // --- Data Filtering & Aggregation ---
    const processData = (targetYear: number, targetMonth: number) => {
        let totalSpends = 0;
        let totalInvested = 0;
        let totalIncoming = 0;
        const dailyMap = new Map<number, number>(); // Day -> Value (Cumulative)
        const categoryMap = new Map<string, number>();

        // Filter transactions for specific month
        const monthlyTxns = transactions.filter(t => {
            const d = new Date(t.date);
            return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
        });

        // Compute Totals & Category Data
        monthlyTxns.forEach(t => {
            const isExpense = t.type === 'debit';
            const isInvestment = t.category.toLowerCase() === 'investment';

            if (t.type === 'credit') {
                totalIncoming += t.amount;
            } else if (isInvestment) {
                totalInvested += t.amount;
            } else {
                totalSpends += t.amount;
            }

            // Category Breakdown (only for active tab context)
            if (activeTab === 'SPENDS' && isExpense && !isInvestment) {
                categoryMap.set(t.category, (categoryMap.get(t.category) || 0) + t.amount);
            } else if (activeTab === 'INVESTED' && isInvestment) {
                categoryMap.set(t.category, (categoryMap.get(t.category) || 0) + t.amount);
            } else if (activeTab === 'INCOMING' && t.type === 'credit') {
                categoryMap.set(t.category, (categoryMap.get(t.category) || 0) + t.amount);
            }
        });

        // Compute Chart Data (Cumulative)
        // 1. Initialize days array
        const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
        let runningTotal = 0;
        const chartData = [];

        for (let i = 1; i <= daysInMonth; i++) {
            // Find txns for this day
            const dayTxns = monthlyTxns.filter(t => new Date(t.date).getDate() === i);

            let dayValue = 0;
            dayTxns.forEach(t => {
                const isExpense = t.type === 'debit';
                const isInvestment = t.category.toLowerCase() === 'investment';

                if (activeTab === 'SPENDS' && isExpense && !isInvestment) dayValue += t.amount;
                if (activeTab === 'INVESTED' && isInvestment) dayValue += t.amount;
                if (activeTab === 'INCOMING' && t.type === 'credit') dayValue += t.amount;
            });

            runningTotal += dayValue;

            // For chart display
            chartData.push({
                day: i,
                date: `${i} ${currMonthShort}`,
                value: runningTotal, // Cumulative
                daily: dayValue // Daily spike
            });
        }

        return {
            totalSpends, totalInvested, totalIncoming,
            chartData, categoryMap
        };
    };

    const currentStats = useMemo(() => processData(year, month), [year, month, transactions, activeTab]);
    const prevStats = useMemo(() => processData(prevYear, prevMonthIdx), [prevYear, prevMonthIdx, transactions, activeTab]);

    // Derived Values for UI
    const activeTotal =
        activeTab === 'SPENDS' ? currentStats.totalSpends :
            activeTab === 'INVESTED' ? currentStats.totalInvested :
                currentStats.totalIncoming;

    const prevTotal =
        activeTab === 'SPENDS' ? prevStats.totalSpends :
            activeTab === 'INVESTED' ? prevStats.totalInvested :
                prevStats.totalIncoming;

    // Convert Category Map to Array for List
    const categoryList = useMemo(() => {
        return Array.from(currentStats.categoryMap.entries())
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [currentStats.categoryMap]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-700">
            <div className="flex flex-col lg:flex-row h-full">

                {/* --- LEFT COLUMN: Controls & List --- */}
                <div className="w-full lg:w-1/3 p-6 border-b lg:border-b-0 lg:border-r border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">

                    {/* Month Navigator */}
                    <div className="flex items-center justify-between mb-6">
                        <button onClick={handlePrevMonth} className="p-2 bg-white dark:bg-slate-800 rounded-full shadow-sm hover:scale-105 transition-all text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                            <ChevronLeft size={20} />
                        </button>
                        <h2 className="text-lg font-black text-slate-800 dark:text-white">
                            {monthName} <span className="text-slate-400 font-medium">{year}</span>
                        </h2>
                        <button onClick={handleNextMonth} className="p-2 bg-white dark:bg-slate-800 rounded-full shadow-sm hover:scale-105 transition-all text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                            <ChevronRight size={20} />
                        </button>
                    </div>

                    {/* Tabs (Jupiter Style) */}
                    <div className="grid grid-cols-3 gap-2 bg-white dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700 mb-8 mx-auto shadow-sm">
                        {(['SPENDS', 'INVESTED', 'INCOMING'] as TabType[]).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all duration-300 ${activeTab === tab
                                    ? 'bg-slate-900 text-white shadow-md scale-[1.02]'
                                    : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
                                    }`}
                            >
                                <span className="text-[10px] uppercase font-bold tracking-wide opacity-70 mb-0.5">{tab}</span>
                                <span className="text-xs font-black truncate w-full text-center">
                                    {formatCurrency(
                                        tab === 'SPENDS' ? currentStats.totalSpends :
                                            tab === 'INVESTED' ? currentStats.totalInvested :
                                                currentStats.totalIncoming
                                    ).split('.')[0]}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Stats Comparison */}
                    <div className="flex justify-between items-center mb-8 px-2">
                        <div>
                            <p className="text-xs font-bold text-slate-400 mb-1">{currMonthShort} {year}</p>
                            <p className="text-2xl font-black text-slate-900 dark:text-white">
                                {formatCurrency(activeTotal)}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs font-bold text-slate-400 mb-1">{prevMonthName} {prevYear}</p>
                            <p className="text-xl font-bold text-slate-500 dark:text-slate-400 line-through decoration-slate-300">
                                {formatCurrency(prevTotal)}
                            </p>
                        </div>
                    </div>

                    {/* Transaction/Category List */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                            <span>Top categories in {monthName}</span>
                            <span>{categoryList.length}</span>
                        </div>

                        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                            {categoryList.length === 0 ? (
                                <div className="text-center py-8 text-slate-400 text-sm">No activity this month</div>
                            ) : categoryList.map((cat, idx) => (
                                <div key={idx} className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3 group hover:border-indigo-200 transition-colors">
                                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                                        {getCategoryIcon(cat.name)}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-bold text-slate-800 dark:text-white text-sm">{cat.name}</span>
                                            <span className="font-bold text-slate-900 dark:text-white">{formatCurrency(cat.value)}</span>
                                        </div>
                                        {/* Progress Bar */}
                                        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-slate-900 dark:bg-indigo-500"
                                                style={{ width: `${(cat.value / activeTotal) * 100}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* --- RIGHT COLUMN: Chart --- */}
                <div className="w-full lg:w-2/3 p-6 bg-white dark:bg-slate-950 relative flex flex-col">

                    {/* Header / Toggle */}
                    <div className="absolute top-6 left-6 right-6 z-10 flex justify-between items-start pointer-events-none">
                        <div>
                            {/* Empty for balance, could add title */}
                        </div>
                        <div className="pointer-events-auto flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                            <button
                                onClick={() => setChartMode('DAILY')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${chartMode === 'DAILY' ? 'bg-black text-white shadow-lg' : 'text-slate-500 hover:text-slate-800'}`}
                            >
                                Cumulative
                            </button>
                            <button
                                onClick={() => setChartMode('MONTHLY')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${chartMode === 'MONTHLY' ? 'bg-black text-white shadow-lg' : 'text-slate-500 hover:text-slate-800'}`}
                            >
                                Daily
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 min-h-[400px] w-full mt-10">
                        <SafeChartContainer>
                            <AreaChart data={currentStats.chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorSpends" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                    <pattern id="diagonalHatch" patternUnits="userSpaceOnUse" width="4" height="4">
                                        <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="#cbd5e1" strokeWidth="1" />
                                    </pattern>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis
                                    dataKey="date"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 'bold' }}
                                    dy={10}
                                    interval={Math.floor(currentStats.chartData.length / 5)}
                                />
                                <YAxis
                                    orientation="right"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 'bold' }}
                                    tickFormatter={(val) => `₹${val / 1000}k`}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', padding: '12px' }}
                                    cursor={{ stroke: '#0f172a', strokeWidth: 1 }}
                                    formatter={((value: number | undefined) => value ? [formatCurrency(value), chartMode === 'DAILY' ? 'Cumulative' : 'Daily'] : ['', '']) as any}
                                />
                                <Area
                                    type="monotone" // or "step" for step feel
                                    dataKey={chartMode === 'DAILY' ? 'value' : 'daily'}
                                    stroke="#6366f1"
                                    strokeWidth={3}
                                    fill="url(#colorSpends)"
                                    animationDuration={1500}
                                />
                                {/* Optional Overlay for pattern if desired */}
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};
