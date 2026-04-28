import React, { useState, useMemo, useRef, useEffect } from 'react';
import { SafeChartContainer } from '../../../shared/SafeChartContainer';
import { TrendingUp, Clock, ArrowRight } from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import { formatCurrencyCompact as formatCurrency } from '../../../../utils/helpers';

/**
 * Local helper to guard charts against zero-size render warnings
 */
const ChartGuard: React.FC<{ children: React.ReactNode; height: number | string }> = ({ children, height }) => {
    const [isReady, setIsReady] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(([entry]) => {
            if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                setIsReady(true);
                observer.disconnect();
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={containerRef} style={{ width: '100%', height }}>
            {isReady ? children : <div className="w-full h-full bg-slate-900/10 animate-pulse rounded-xl" />}
        </div>
    );
};

const SIPTimeMachine: React.FC = () => {
    // State
    const [monthlyInvestment, setMonthlyInvestment] = useState(10000);
    const [expectedReturn, setExpectedReturn] = useState(12);
    const [durationYears, setDurationYears] = useState(10);
    const [delayYears, setDelayYears] = useState(5);

    // Calculations
    const data = useMemo(() => {
        const results = [];
        let invested = 0;
        let wealthNow = 0;
        let wealthDelayed = 0;
        let investedDelayed = 0;

        // Monthly Rate
        const r = expectedReturn / 12 / 100;

        for (let year = 1; year <= durationYears + delayYears; year++) {
            // Scenario 1: Start Now
            for (let m = 0; m < 12; m++) {
                invested += monthlyInvestment;
                wealthNow = (wealthNow + monthlyInvestment) * (1 + r);
            }

            // Scenario 2: Start Delayed
            if (year > delayYears) {
                for (let m = 0; m < 12; m++) {
                    investedDelayed += monthlyInvestment;
                    wealthDelayed = (wealthDelayed + monthlyInvestment) * (1 + r);
                }
            }

            results.push({
                year: `Year ${year}`,
                WealthNow: Math.round(wealthNow),
                WealthDelayed: Math.round(wealthDelayed),
            });
        }
        return { chartData: results, finalNow: wealthNow, finalDelayed: wealthDelayed, costOfDelay: wealthNow - wealthDelayed };
    }, [monthlyInvestment, expectedReturn, durationYears, delayYears]);



    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 h-full flex flex-col">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-6">
                <Clock className="text-indigo-500" /> SIP Time Machine
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="text-xs text-slate-500 font-bold uppercase">Monthly SIP</label>
                    <input
                        type="number"
                        value={monthlyInvestment}
                        onChange={(e) => setMonthlyInvestment(Number(e.target.value))}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mt-1 font-mono font-bold text-slate-900 dark:text-white"
                    />
                </div>
                <div>
                    <label className="text-xs text-slate-500 font-bold uppercase">Return (%)</label>
                    <input
                        type="number"
                        value={expectedReturn}
                        onChange={(e) => setExpectedReturn(Number(e.target.value))}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mt-1 font-mono font-bold text-slate-900 dark:text-white"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="text-xs text-slate-500 font-bold uppercase">Duration (Years)</label>
                    <input
                        type="range"
                        min="5"
                        max="30"
                        value={durationYears}
                        onChange={(e) => setDurationYears(Number(e.target.value))}
                        className="w-full mt-2 accent-indigo-500"
                    />
                    <div className="text-right text-xs font-bold text-indigo-500">{durationYears} Years</div>
                </div>
                <div>
                    <label className="text-xs text-slate-500 font-bold uppercase">Delay (Years)</label>
                    <input
                        type="range"
                        min="1"
                        max="10"
                        value={delayYears}
                        onChange={(e) => setDelayYears(Number(e.target.value))}
                        className="w-full mt-2 accent-rose-500"
                    />
                    <div className="text-right text-xs font-bold text-rose-500">{delayYears} Years Delay</div>
                </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 font-bold uppercase">Wealth if Started Now</p>
                    <p className="text-xl font-black text-indigo-700 dark:text-indigo-300 mt-1">{formatCurrency(data.finalNow)}</p>
                </div>
                <div className="p-4 bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-100 dark:border-rose-900/30">
                    <p className="text-xs text-rose-600 dark:text-rose-400 font-bold uppercase">Cost of Delay</p>
                    <p className="text-xl font-black text-rose-600 dark:text-rose-400 mt-1">-{formatCurrency(data.costOfDelay)}</p>
                </div>
            </div>

            <div className="flex-1 min-h-[200px]">
                <ChartGuard height="100%">
                    <SafeChartContainer>
                        <AreaChart data={data.chartData}>
                            <defs>
                                <linearGradient id="colorNow" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorDelay" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.8} />
                                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                            <XAxis dataKey="year" hide />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                            />
                            <Area type="monotone" dataKey="WealthNow" stroke="#6366f1" fillOpacity={1} fill="url(#colorNow)" name="Started Today" />
                            <Area type="monotone" dataKey="WealthDelayed" stroke="#f43f5e" fillOpacity={1} fill="url(#colorDelay)" name="Delayed Start" />
                        </AreaChart>
                    </SafeChartContainer>
                </ChartGuard>
            </div>

            <p className="text-xs text-slate-400 text-center mt-4">
                "The best time to plant a tree was 20 years ago. The second best time is now."
            </p>
        </div>
    );
};

export default SIPTimeMachine;
