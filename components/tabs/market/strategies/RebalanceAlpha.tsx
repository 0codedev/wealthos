import React, { useState, useMemo, useRef, useEffect } from 'react';
import { SafeChartContainer } from '../../../shared/SafeChartContainer';
import { RefreshCw, TrendingUp } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend
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

const RebalanceAlpha: React.FC = () => {
    // Simulation Parameters
    const [initialInvestment, setInitialInvestment] = useState(1000000);
    const [volatility, setVolatility] = useState(15); // Annual Volatility %

    const simulation = useMemo(() => {
        const years = 10;
        const months = years * 12;

        let portfolioRebalanced = initialInvestment;
        let portfolioDrifted = initialInvestment;

        // Asset Allocation: 60% Equity / 40% Debt initial
        let equityR = initialInvestment * 0.6;
        let debtR = initialInvestment * 0.4;

        // Drifted portfolio components
        let equityD = initialInvestment * 0.6;
        let debtD = initialInvestment * 0.4;

        const data = [];
        const volatilityMonthly = volatility / 100 / Math.sqrt(12);

        // Assumptions: Stocks 12% returns, Debt 7% returns (mean)
        const meanEquity = 0.12 / 12;
        const meanDebt = 0.07 / 12;

        // Seed random for consistency (pseudo-random)
        let seed = 42;
        const random = () => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };
        const normalRandom = () => {
            let u = 0, v = 0;
            while (u === 0) u = random();
            while (v === 0) v = random();
            return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        };

        for (let m = 0; m <= months; m++) {
            if (m === 0) {
                data.push({ x: 0, Rebalanced: initialInvestment, Drifted: initialInvestment });
                continue;
            }

            // Market Movements
            const equityReturn = meanEquity + (volatilityMonthly * normalRandom());
            const debtReturn = meanDebt; // Assume debt is stable

            // Update Rebalanced Portfolio (before rebalancing)
            equityR *= (1 + equityReturn);
            debtR *= (1 + debtReturn);

            // Check Rebalancing Trigger (Yearly)
            if (m % 12 === 0) {
                const totalR = equityR + debtR;
                // Rebalance back to 60/40
                equityR = totalR * 0.6;
                debtR = totalR * 0.4;
            }
            portfolioRebalanced = equityR + debtR;

            // Update Drifted Portfolio (Buy and Hold)
            equityD *= (1 + equityReturn);
            debtD *= (1 + debtReturn);
            portfolioDrifted = equityD + debtD;

            data.push({
                x: m,
                Rebalanced: Math.round(portfolioRebalanced),
                Drifted: Math.round(portfolioDrifted)
            });
        }

        return {
            data,
            finalRebal: Math.round(portfolioRebalanced),
            finalDrift: Math.round(portfolioDrifted),
            alpha: Math.round(portfolioRebalanced - portfolioDrifted)
        };
    }, [initialInvestment, volatility]);



    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 h-full flex flex-col">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-6">
                <RefreshCw className="text-emerald-500" /> Rebalancing Alpha
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="text-xs text-slate-500 font-bold uppercase">Corpus</label>
                    <input
                        type="number"
                        value={initialInvestment}
                        onChange={(e) => setInitialInvestment(Number(e.target.value))}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mt-1 font-mono font-bold text-slate-900 dark:text-white"
                    />
                </div>
                <div>
                    <label className="text-xs text-slate-500 font-bold uppercase">Volatility (Risk)</label>
                    <input
                        type="range"
                        min="10"
                        max="40"
                        value={volatility}
                        onChange={(e) => setVolatility(Number(e.target.value))}
                        className="w-full mt-2 accent-emerald-500"
                    />
                    <div className="text-right text-xs font-bold text-emerald-500">{volatility}% Annual</div>
                </div>
            </div>

            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-100 dark:border-emerald-900/30 mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase">Rebalancing Alpha Generated</p>
                        <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-1">+{formatCurrency(simulation.alpha)}</p>
                        <p className="text-xs text-emerald-600/70 mt-1">Risk Reduction Bonus</p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-slate-500">Portfolio w/ Rebalancing</p>
                        <p className="font-bold text-slate-900 dark:text-white">{formatCurrency(simulation.finalRebal)}</p>
                        <p className="text-xs text-slate-500 mt-2">Portfolio Drifted</p>
                        <p className="font-bold text-slate-900 dark:text-white">{formatCurrency(simulation.finalDrift)}</p>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-[200px]">
                <ChartGuard height="100%">
                    <SafeChartContainer>
                        <LineChart data={simulation.data}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                            <XAxis dataKey="x" hide />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                                formatter={((val: number | undefined) => val ? formatCurrency(val) : '') as any}
                                labelFormatter={() => ''}
                            />
                            <Legend />
                            <Line type="monotone" dataKey="Rebalanced" stroke="#10b981" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="Drifted" stroke="#64748b" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                        </LineChart>
                    </SafeChartContainer>
                </ChartGuard>
            </div>
            <p className="text-xs text-slate-400 text-center mt-4">
                "Rebalancing forces you to buy low and sell high automatically."
            </p>
        </div>
    );
};

export default RebalanceAlpha;
