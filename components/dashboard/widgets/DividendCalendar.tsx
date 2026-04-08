import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { db, Dividend } from '../../../database';
import {
    Calendar, TrendingUp, Droplets, ChevronLeft, ChevronRight,
    Plus, DollarSign, BarChart3, Sparkles, ArrowUpRight
} from 'lucide-react';
import { formatCurrency } from '../../../utils/helpers';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LineChart, Line, Area, AreaChart } from 'recharts';

// ============================
// Types
// ============================
interface DividendCalendarProps {
    isPrivacyMode?: boolean;
}

interface MonthData {
    month: string; // 'Jan', 'Feb', etc
    shortMonth: string;
    fullMonth: string;
    year: number;
    amount: number;
    count: number;
    dividends: Dividend[];
}

interface DRIPProjection {
    year: number;
    withoutDRIP: number;
    withDRIP: number;
    cumulativeDividends: number;
}

// ============================
// Constants
// ============================
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ============================
// DRIP Calculator
// ============================
const calculateDRIP = (
    annualDividend: number,
    currentPortfolioValue: number,
    years: number = 20,
    dividendGrowthRate: number = 0.05, // 5% annual dividend growth
    priceAppreciation: number = 0.10  // 10% annual price growth
): DRIPProjection[] => {
    const projections: DRIPProjection[] = [];
    let withoutDRIP = currentPortfolioValue;
    let withDRIP = currentPortfolioValue;
    let cumulativeDividends = 0;
    let currentDividend = annualDividend;

    for (let year = 0; year <= years; year++) {
        projections.push({
            year,
            withoutDRIP: Math.round(withoutDRIP),
            withDRIP: Math.round(withDRIP),
            cumulativeDividends: Math.round(cumulativeDividends),
        });

        // For next year:
        cumulativeDividends += currentDividend;

        // Without DRIP: only price appreciation, dividends withdrawn
        withoutDRIP *= (1 + priceAppreciation);

        // With DRIP: price appreciation + reinvested dividends compound
        const dripYield = currentDividend / withDRIP;
        withDRIP *= (1 + priceAppreciation + dripYield);

        currentDividend *= (1 + dividendGrowthRate);
    }

    return projections;
};

// ============================
// Mini Calendar Heatmap
// ============================
const CalendarHeatmap: React.FC<{
    monthData: MonthData[];
    selectedMonth: number;
    onSelectMonth: (idx: number) => void;
}> = ({ monthData, selectedMonth, onSelectMonth }) => {
    const maxAmount = Math.max(...monthData.map(m => m.amount), 1);

    return (
        <div className="grid grid-cols-6 gap-1.5">
            {monthData.map((m, idx) => {
                const intensity = m.amount / maxAmount;
                const isSelected = idx === selectedMonth;
                return (
                    <button
                        key={idx}
                        onClick={() => onSelectMonth(idx)}
                        className={`relative p-2 rounded-lg text-center transition-all ${isSelected
                            ? 'ring-2 ring-emerald-500/50 bg-emerald-500/20'
                            : 'hover:bg-white/10'
                            }`}
                        style={{
                            backgroundColor: isSelected
                                ? undefined
                                : m.amount > 0
                                    ? `rgba(16, 185, 129, ${Math.max(0.05, intensity * 0.3)})`
                                    : 'rgba(255,255,255,0.03)',
                        }}
                    >
                        <div className="text-[10px] text-white/50">{m.shortMonth}</div>
                        {m.count > 0 && (
                            <div className="text-[9px] text-emerald-400 font-bold mt-0.5">
                                {m.count}
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

// ============================
// Main Component
// ============================
const DividendCalendar: React.FC<DividendCalendarProps> = ({ isPrivacyMode = false }) => {
    const [dividends, setDividends] = useState<Dividend[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const [activeView, setActiveView] = useState<'calendar' | 'drip'>('calendar');
    const [dripYears, setDripYears] = useState(15);

    // Load dividends from DB
    useEffect(() => {
        const loadDividends = async () => {
            try {
                const all = await db.dividends.toArray();
                setDividends(all);
            } catch (err) {
                console.error('DividendCalendar: failed to load dividends', err);
            } finally {
                setLoading(false);
            }
        };
        loadDividends();
    }, []);

    // Monthly aggregation for the selected year
    const monthlyData: MonthData[] = useMemo(() => {
        return MONTHS.map((month, idx) => {
            const filtered = dividends.filter(d => {
                const date = new Date(d.date);
                return date.getFullYear() === selectedYear && date.getMonth() === idx;
            });

            return {
                month,
                shortMonth: month,
                fullMonth: MONTH_FULL[idx],
                year: selectedYear,
                amount: filtered.reduce((sum, d) => sum + d.amount, 0),
                count: filtered.length,
                dividends: filtered,
            };
        });
    }, [dividends, selectedYear]);

    // Annual stats
    const annualStats = useMemo(() => {
        const yearDividends = dividends.filter(d =>
            new Date(d.date).getFullYear() === selectedYear
        );
        const totalAmount = yearDividends.reduce((sum, d) => sum + d.amount, 0);
        const monthlyAvg = totalAmount / 12;
        const bestMonth = [...monthlyData].sort((a, b) => b.amount - a.amount)[0];
        const uniqueTickers = new Set(yearDividends.map(d => d.ticker)).size;

        return { totalAmount, monthlyAvg, bestMonth, uniqueTickers, count: yearDividends.length };
    }, [dividends, selectedYear, monthlyData]);

    // DRIP projections
    const dripProjections = useMemo(() => {
        return calculateDRIP(
            annualStats.totalAmount || 25000, // Default to ₹25K if no data
            500000, // Assume ₹5L portfolio for demo
            dripYears,
            0.05,
            0.10
        );
    }, [annualStats.totalAmount, dripYears]);

    // DRIP advantage at end of projection
    const dripAdvantage = useMemo(() => {
        if (!dripProjections.length) return 0;
        const last = dripProjections[dripProjections.length - 1];
        return last.withDRIP - last.withoutDRIP;
    }, [dripProjections]);

    // Monthly bar chart data
    const chartData = useMemo(() => {
        return monthlyData.map(m => ({
            month: m.shortMonth,
            amount: m.amount,
        }));
    }, [monthlyData]);

    // Selected month's dividends
    const selectedMonthDividends = monthlyData[selectedMonth]?.dividends || [];

    return (
        <div className="glass-card p-5 rounded-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20">
                        <Droplets className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white">Dividend Hub</h3>
                        <p className="text-[10px] text-white/40">Income tracking + DRIP simulator</p>
                    </div>
                </div>

                {/* View Toggle */}
                <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
                    <button
                        onClick={() => setActiveView('calendar')}
                        className={`text-xs px-2.5 py-1 rounded-md transition-all ${activeView === 'calendar'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'text-white/40 hover:text-white/60'
                            }`}
                    >
                        <Calendar className="w-3 h-3 inline mr-1" />
                        Calendar
                    </button>
                    <button
                        onClick={() => setActiveView('drip')}
                        className={`text-xs px-2.5 py-1 rounded-md transition-all ${activeView === 'drip'
                            ? 'bg-violet-500/20 text-violet-300'
                            : 'text-white/40 hover:text-white/60'
                            }`}
                    >
                        <Sparkles className="w-3 h-3 inline mr-1" />
                        DRIP
                    </button>
                </div>
            </div>

            {/* Annual Stats Strip */}
            <div className="grid grid-cols-4 gap-2">
                <div className="bg-white/5 rounded-xl p-2.5 text-center">
                    <div className="text-[10px] text-white/40">FY Total</div>
                    <div className="text-sm font-bold text-emerald-400">
                        {isPrivacyMode ? '•••' : formatCurrency(annualStats.totalAmount)}
                    </div>
                </div>
                <div className="bg-white/5 rounded-xl p-2.5 text-center">
                    <div className="text-[10px] text-white/40">Monthly Avg</div>
                    <div className="text-sm font-bold text-white">
                        {isPrivacyMode ? '•••' : formatCurrency(annualStats.monthlyAvg)}
                    </div>
                </div>
                <div className="bg-white/5 rounded-xl p-2.5 text-center">
                    <div className="text-[10px] text-white/40">Stocks</div>
                    <div className="text-sm font-bold text-cyan-400">{annualStats.uniqueTickers}</div>
                </div>
                <div className="bg-white/5 rounded-xl p-2.5 text-center">
                    <div className="text-[10px] text-white/40">Payouts</div>
                    <div className="text-sm font-bold text-white">{annualStats.count}</div>
                </div>
            </div>

            {/* ==== CALENDAR VIEW ==== */}
            {activeView === 'calendar' && (
                <>
                    {/* Year Navigator */}
                    <div className="flex items-center justify-center gap-4">
                        <button
                            onClick={() => setSelectedYear(y => y - 1)}
                            className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/80 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-sm font-bold text-white">{selectedYear}</span>
                        <button
                            onClick={() => setSelectedYear(y => y + 1)}
                            className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/80 transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Calendar Heatmap */}
                    <CalendarHeatmap
                        monthData={monthlyData}
                        selectedMonth={selectedMonth}
                        onSelectMonth={setSelectedMonth}
                    />

                    {/* Monthly Bar Chart */}
                    <div className="h-32">
                        <SafeChartContainer>
                            <BarChart data={chartData}>
                                <XAxis
                                    dataKey="month"
                                    tick={{ fill: '#ffffff40', fontSize: 9 }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis hide />
                                <Tooltip
                                    contentStyle={{
                                        background: 'rgba(15, 15, 30, 0.95)',
                                        border: '1px solid rgba(16, 185, 129, 0.3)',
                                        borderRadius: '12px',
                                        fontSize: '11px',
                                        color: '#fff',
                                    }}
                                    formatter={(value: number | string | Array<number | string> | undefined) => [formatCurrency(Number(value ?? 0)), 'Dividends']}
                                />
                                <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                                    {chartData.map((entry, idx) => (
                                        <Cell
                                            key={idx}
                                            fill={idx === selectedMonth
                                                ? '#10b981'
                                                : entry.amount > 0 ? '#10b98140' : '#ffffff08'
                                            }
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </SafeChartContainer>
                    </div>

                    {/* Selected Month Details */}
                    <div className="space-y-1.5">
                        <div className="text-xs text-white/50 font-medium">
                            {monthlyData[selectedMonth]?.fullMonth} {selectedYear}
                            {monthlyData[selectedMonth]?.count > 0 && (
                                <span className="text-emerald-400 ml-2">
                                    {formatCurrency(monthlyData[selectedMonth].amount)}
                                </span>
                            )}
                        </div>

                        {selectedMonthDividends.length > 0 ? (
                            <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                                {selectedMonthDividends.map((d, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <DollarSign className="w-3 h-3 text-emerald-400" />
                                            <span className="text-xs font-medium text-white">{d.ticker}</span>
                                            <span className="text-[10px] text-white/30">{d.date}</span>
                                        </div>
                                        <span className={`text-xs font-bold ${d.credited ? 'text-emerald-400' : 'text-amber-400'}`}>
                                            {isPrivacyMode ? '•••' : formatCurrency(d.amount)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-4 text-white/20 text-xs">
                                No dividends recorded for this month
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ==== DRIP SIMULATOR VIEW ==== */}
            {activeView === 'drip' && (
                <>
                    {/* DRIP Headline */}
                    <div className="bg-gradient-to-r from-violet-500/10 to-emerald-500/10 rounded-xl p-4 text-center">
                        <div className="text-[10px] text-white/40 mb-1">
                            DRIP Advantage over {dripYears} years
                        </div>
                        <div className="text-2xl font-black text-emerald-400">
                            {isPrivacyMode ? '•••' : (
                                <>+{formatCurrency(dripAdvantage)}</>
                            )}
                        </div>
                        <div className="text-[10px] text-white/40 mt-1">
                            Extra wealth from reinvesting dividends
                        </div>
                    </div>

                    {/* Time Horizon Slider */}
                    <div className="space-y-1">
                        <div className="flex justify-between text-[10px] text-white/40">
                            <span>Projection Period</span>
                            <span className="text-white/60 font-medium">{dripYears} years</span>
                        </div>
                        <input
                            type="range"
                            min={5}
                            max={30}
                            value={dripYears}
                            onChange={e => setDripYears(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-violet-500"
                        />
                        <div className="flex justify-between text-[9px] text-white/30">
                            <span>5Y</span>
                            <span>30Y</span>
                        </div>
                    </div>

                    {/* DRIP Chart */}
                    <div className="h-44">
                        <SafeChartContainer>
                            <AreaChart data={dripProjections}>
                                <defs>
                                    <linearGradient id="dripGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="noDripGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.15} />
                                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis
                                    dataKey="year"
                                    tick={{ fill: '#ffffff40', fontSize: 10 }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={v => `Y${v}`}
                                />
                                <YAxis
                                    tick={{ fill: '#ffffff40', fontSize: 9 }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(v: number) => {
                                        if (v >= 10000000) return `${(v / 10000000).toFixed(1)}Cr`;
                                        if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
                                        return `${(v / 1000).toFixed(0)}K`;
                                    }}
                                    width={45}
                                />
                                <Tooltip
                                    contentStyle={{
                                        background: 'rgba(15, 15, 30, 0.95)',
                                        border: '1px solid rgba(139, 92, 246, 0.3)',
                                        borderRadius: '12px',
                                        fontSize: '11px',
                                        color: '#fff',
                                    }}
                                    formatter={(value: number | string | Array<number | string> | undefined, name?: string) => [
                                        formatCurrency(Number(value ?? 0)),
                                        name === 'withDRIP' ? 'With DRIP' : name === 'withoutDRIP' ? 'Without DRIP' : 'Dividends'
                                    ]}
                                    labelFormatter={v => `Year ${v}`}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="withDRIP"
                                    stroke="#10b981"
                                    strokeWidth={2}
                                    fill="url(#dripGrad)"
                                    name="withDRIP"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="withoutDRIP"
                                    stroke="#6366f1"
                                    strokeWidth={1.5}
                                    strokeDasharray="4 4"
                                    fill="url(#noDripGrad)"
                                    name="withoutDRIP"
                                />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>

                    {/* Legend + End Values */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-emerald-500/5 rounded-xl p-3 border border-emerald-500/10">
                            <div className="flex items-center gap-1 mb-1">
                                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                <span className="text-[10px] text-emerald-400/60">With DRIP</span>
                            </div>
                            <div className="text-sm font-bold text-emerald-400">
                                {isPrivacyMode ? '•••' : formatCurrency(
                                    dripProjections[dripProjections.length - 1]?.withDRIP || 0
                                )}
                            </div>
                        </div>
                        <div className="bg-indigo-500/5 rounded-xl p-3 border border-indigo-500/10">
                            <div className="flex items-center gap-1 mb-1">
                                <div className="w-2 h-2 rounded-full bg-indigo-500" />
                                <span className="text-[10px] text-indigo-400/60">Without DRIP</span>
                            </div>
                            <div className="text-sm font-bold text-indigo-400">
                                {isPrivacyMode ? '•••' : formatCurrency(
                                    dripProjections[dripProjections.length - 1]?.withoutDRIP || 0
                                )}
                            </div>
                        </div>
                    </div>

                    {/* DRIP Assumptions */}
                    <div className="bg-white/3 rounded-xl p-3 space-y-1">
                        <div className="text-[10px] text-white/40 font-medium mb-1">Assumptions</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                            <span className="text-white/30">Dividend Growth</span>
                            <span className="text-white/60">5% p.a.</span>
                            <span className="text-white/30">Price Appreciation</span>
                            <span className="text-white/60">10% p.a.</span>
                            <span className="text-white/30">Annual Dividend</span>
                            <span className="text-white/60">{formatCurrency(annualStats.totalAmount || 25000)}</span>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default React.memo(DividendCalendar);
