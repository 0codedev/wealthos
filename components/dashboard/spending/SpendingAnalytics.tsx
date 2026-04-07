
import React, { useEffect, useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { CursorFollowTooltip } from '../../shared/CursorFollowTooltip';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend
} from 'recharts';
import { db, Transaction } from '../../../database';
import { format, subMonths, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { Loader2, TrendingDown, TrendingUp, DollarSign, Wallet } from 'lucide-react';
import { EmptyState } from '../../shared/LoadingStates';
import { motion } from 'framer-motion';
import { NoiseTexture } from '../../ui/NoiseTexture';

// ============================================================
// COLORS (Cyberpunk Neon Palette)
// ============================================================
const COLORS = ['#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];
const NEON_GRADIENTS = [
    'url(#colorViolet)', 'url(#colorPink)', 'url(#colorCyan)', 'url(#colorEmerald)'
];

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-950/90 border border-slate-800 p-3 rounded-xl shadow-2xl backdrop-blur-xl">
                <p className="text-slate-400 text-xs mb-1 font-mono uppercase tracking-wider">{label}</p>
                <p className="text-white font-black text-lg">
                    ₹{payload[0].value.toLocaleString()}
                </p>
            </div>
        );
    }
    return null;
};

// ============================================================
// COMPONENT
// ============================================================
export const SpendingAnalytics: React.FC = () => {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [timeRange, setTimeRange] = useState<'3M' | '6M' | '1Y'>('6M');

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch all transactions (optimized: could use ranges/limit)
                const data = await db.transactions.toArray();
                setTransactions(data);
            } catch (error) {
                console.error("Failed to fetch transactions:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, []);

    // ------------------------------------------------------------
    // DATA PROCESSING
    // ------------------------------------------------------------

    // 1. Monthly Spending (Bar Chart)
    const monthlyData = useMemo(() => {
        const months = timeRange === '3M' ? 3 : timeRange === '6M' ? 6 : 12;
        const result: Record<string, number> = {};

        // Initialize months with 0
        for (let i = months - 1; i >= 0; i--) {
            const d = subMonths(new Date(), i);
            const key = format(d, 'MMM');
            result[key] = 0;
        }

        transactions.forEach(t => {
            if (t.type === 'debit' && !t.excluded) {
                try {
                    const date = parseISO(t.date);
                    // Filter by range roughly
                    const cutoff = subMonths(new Date(), months);
                    if (date >= cutoff) {
                        const key = format(date, 'MMM');
                        if (result[key] !== undefined) {
                            result[key] += t.amount;
                        }
                    }
                } catch (e) { /* ignore invalid dates */ }
            }
        });

        return Object.entries(result).map(([name, amount]) => ({ name, amount }));
    }, [transactions, timeRange]);

    // 2. Category Breakdown (Donut Chart) for current month
    const categoryData = useMemo(() => {
        const currentMonthStart = startOfMonth(new Date());
        const result: Record<string, number> = {};

        transactions.forEach(t => {
            if (t.type === 'debit' && !t.excluded) {
                try {
                    const date = parseISO(t.date);
                    if (date >= currentMonthStart) {
                        const cat = t.category || 'Uncategorized';
                        result[cat] = (result[cat] || 0) + t.amount;
                    }
                } catch (e) { /* ignore */ }
            }
        });

        return Object.entries(result)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 6); // Top 6 + Others
    }, [transactions]);

    // 3. Totals
    const totalSpentThisMonth = useMemo(() => {
        return categoryData.reduce((acc, curr) => acc + curr.value, 0);
    }, [categoryData]);

    if (isLoading) {
        return (
            <div className="h-64 flex items-center justify-center">
                <Loader2 className="animate-spin text-indigo-500" size={32} />
            </div>
        );
    }

    if (transactions.length === 0) {
        return (
            <div className="bg-slate-900/50 rounded-2xl border border-slate-800 p-6 backdrop-blur-sm relative overflow-hidden group">
                <NoiseTexture opacity={0.05} />
                <EmptyState
                    type="no-data"
                    title="No Spending Data"
                    message="Import your bank statements or add transactions to see analytics."
                    icon={<Wallet size={48} className="text-slate-600 mb-4 group-hover:text-indigo-500 transition-colors" />}
                />
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Chart: Monthly Trend */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="lg:col-span-2 bg-slate-950 rounded-2xl border border-slate-800 p-6 relative overflow-hidden shadow-xl"
            >
                <NoiseTexture opacity={0.03} />
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[80px] rounded-full pointer-events-none" />

                <div className="flex items-center justify-between mb-6 relative z-10">
                    <div>
                        <h3 className="text-lg font-black text-white flex items-center gap-2 tracking-tight">
                            <TrendingUp className="text-indigo-400" size={20} />
                            Monthly Spending
                        </h3>
                        <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mt-1">
                            Last {timeRange === '3M' ? '3 Months' : timeRange === '6M' ? '6 Months' : '1 Year'} Trend
                        </p>
                    </div>
                    <div className="flex bg-slate-900/80 rounded-lg p-1 border border-slate-800">
                        {(['3M', '6M', '1Y'] as const).map((r) => (
                            <button
                                key={r}
                                onClick={() => setTimeRange(r)}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${timeRange === r
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                                    : 'text-slate-500 hover:text-slate-300'
                                    }`}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="h-[300px] w-full relative z-10">
                    <SafeChartContainer>
                        <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorViolet" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" opacity={0.5} />
                            <XAxis
                                dataKey="name"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                                dy={10}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                                tickFormatter={(value) => `₹${value / 1000}k`}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1e293b', opacity: 0.4 }} />
                            <Bar
                                dataKey="amount"
                                fill="url(#colorViolet)"
                                radius={[6, 6, 0, 0]}
                                barSize={40}
                                animationDuration={1500}
                                animationBegin={300}
                            />
                        </BarChart>
                    </SafeChartContainer>
                </div>
            </motion.div>

            {/* Side Chart: Category Breakdown */}
            <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="bg-slate-950 rounded-2xl border border-slate-800 p-6 flex flex-col relative overflow-hidden shadow-xl"
            >
                <NoiseTexture opacity={0.03} />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-pink-500/10 blur-[60px] rounded-full pointer-events-none" />

                <h3 className="text-lg font-black text-white flex items-center gap-2 mb-2 relative z-10 tracking-tight">
                    <TrendingDown className="text-pink-400" size={20} />
                    Top Categories
                </h3>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-6 relative z-10">Current Month</p>

                <div className="flex-1 min-h-[200px] relative z-10">
                    <SafeChartContainer>
                        <PieChart>
                            <Pie
                                data={categoryData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                                stroke="none"
                            >
                                {categoryData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip content={<CursorFollowTooltip />} isAnimationActive={false} />
                        </PieChart>
                    </SafeChartContainer>
                    {/* Center Text */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Total</span>
                        <span className="text-2xl font-black text-white drop-shadow-lg">₹{(totalSpentThisMonth / 1000).toFixed(1)}k</span>
                    </div>
                </div>

                {/* Legend */}
                <div className="mt-4 space-y-3 relative z-10">
                    {categoryData.slice(0, 4).map((entry, index) => (
                        <div key={index} className="flex items-center justify-between text-sm group cursor-default">
                            <div className="flex items-center gap-3">
                                <div className="w-2.5 h-2.5 rounded-full ring-2 ring-slate-900 group-hover:scale-125 transition-transform" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                                <span className="text-slate-400 font-medium group-hover:text-slate-200 transition-colors">{entry.name}</span>
                            </div>
                            <span className="text-slate-200 font-bold font-mono group-hover:text-white">₹{entry.value.toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            </motion.div>
        </div>
    );
};
