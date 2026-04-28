import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { ShieldAlert, Gauge, TrendingUp, TrendingDown, Scale, Target, CheckCircle2, ArrowUpRight, ArrowRightLeft, Flame, Zap } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { CustomTooltip } from '../../shared/CustomTooltip';
import { Investment, InvestmentType } from '../../../types';
import { useSettingsStore } from '../../../store/settingsStore';
import { RiskEngine, inferMarketContext } from '../../../services/RiskEngine';
import TargetConfigModal from '../../TargetConfigModal';
import { useMarketSentiment } from '../../../hooks/useMarketSentiment';
import { usePageVisibility } from '../../../contexts/PageVisibilityContext';
import { useLiteModeStore } from '../../../store/liteModeStore';
import { formatCurrency } from '../../../utils/helpers';

interface RiskEngineViewProps {
    investments: Investment[];
    totalAssets: number;
    formatCurrency: (val: number) => string;
    setSimulatorAsset: (inv: Investment | null) => void;
}

const BETA_MAP: Record<InvestmentType, number> = {
    [InvestmentType.CRYPTO]: 2.5,
    [InvestmentType.STOCKS]: 1.3,
    [InvestmentType.SMALLCASE]: 1.2,
    [InvestmentType.MUTUAL_FUND]: 1.0,
    [InvestmentType.ETF]: 1.0,
    [InvestmentType.TRADING]: 1.5,
    [InvestmentType.REAL_ESTATE]: 0.3,
    [InvestmentType.DIGITAL_GOLD]: 0.1,
    [InvestmentType.DIGITAL_SILVER]: 0.2,
    [InvestmentType.FD]: 0.0,
    [InvestmentType.CASH]: 0.0,
    [InvestmentType.IPO]: 1.5,
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

export const RiskEngineView: React.FC<RiskEngineViewProps> = ({ investments, totalAssets, formatCurrency, setSimulatorAsset }) => {
    const [marketScenario, setMarketScenario] = useState<number>(0);
    const [isTargetConfigOpen, setIsTargetConfigOpen] = useState(false);
    const { vix } = useMarketSentiment();
    const isVisible = usePageVisibility();
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    const allocationTargets = useSettingsStore(state => state.allocationTargets);

    // Instantiate Risk Engine to get context
    const riskEngine = useMemo(() => new RiskEngine(), []);
    riskEngine.setContext(inferMarketContext(investments, vix, 92));
    const context = riskEngine.getContext();

    // --- Calculations ---

    const portfolioBeta = useMemo(() => {
        if (totalAssets === 0) return 0;
        let totalBetaVal = 0;
        investments.forEach(inv => {
            const beta = BETA_MAP[inv.type] || 1.0;
            totalBetaVal += (inv.currentValue * beta);
        });
        return totalBetaVal / totalAssets;
    }, [investments, totalAssets]);

    const projectedValues = useMemo(() => {
        const pnlChange = totalAssets * (marketScenario / 100) * portfolioBeta;
        return { pnlChange };
    }, [totalAssets, marketScenario, portfolioBeta]);

    const rebalancingPlan = useMemo(() => {
        const currentTotals: Record<string, number> = {};
        investments.forEach(inv => {
            if (inv.currentValue > 0) {
                const cls = getAssetClass(inv.type);
                currentTotals[cls] = (currentTotals[cls] || 0) + inv.currentValue;
            }
        });

        return Object.entries(allocationTargets as Record<string, number>).map(([cls, targetPct]) => {
            const currentVal = currentTotals[cls] || 0;
            const currentPct = totalAssets > 0 ? (currentVal / totalAssets) * 100 : 0;
            const deviation = currentPct - targetPct;
            const actionAmount = totalAssets * (Math.abs(deviation) / 100);

            return {
                class: cls,
                currentPct,
                targetPct,
                deviation,
                actionAmount,
                action: deviation > 0 ? 'SELL' : 'BUY'
            };
        }).filter(item => Math.abs(item.deviation) > 1).sort((a, b) => b.deviation - a.deviation);
    }, [investments, totalAssets, allocationTargets]);

    const driftChartData = useMemo(() => {
        return rebalancingPlan.map(p => ({
            name: p.class,
            Actual: p.currentPct,
            Target: p.targetPct,
            deviation: p.deviation
        }));
    }, [rebalancingPlan]);

    return (
        <div className="space-y-6 animate-in slide-in-from-right-4">
            {isLiteMode && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3">
                    <Zap size={16} className="text-amber-500" />
                    <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">
                        Lite Mode Active — High-density visuals simplified
                    </p>
                </div>
            )}

            {/* Header Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Risk Matrix & Market Context */}
                <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between shadow-sm">
                    <div className="absolute top-0 right-0 p-4 opacity-5 dark:opacity-10">
                        <Flame size={100} className="text-rose-500" />
                    </div>

                    <div>
                        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            Market Context
                        </h3>
                        <div className="flex items-center gap-2 mb-4">
                            <div className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${context.scenario === 'SILVER_CRASH' ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/30' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'}`}>
                                {context.scenario.replace('_', ' ')}
                            </div>
                            <span className="text-xs text-slate-500 font-mono font-medium">VIX: {context.vix}</span>
                        </div>

                        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                            <Gauge size={16} className="text-indigo-600 dark:text-indigo-400" /> Portfolio Beta
                        </h3>
                        <div className="flex items-baseline gap-2">
                            <h2 className={`text-4xl font-black ${portfolioBeta > 1.2 ? 'text-rose-600 dark:text-rose-500' : portfolioBeta < 0.8 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                {portfolioBeta.toFixed(2)}
                            </h2>
                            <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">vs NIFTY 1.0</span>
                        </div>
                    </div>

                    <div className="mt-4">
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-[200px] font-medium">
                            {portfolioBeta > 1.2 ? "High Volatility. Your portfolio swings harder than the market." :
                                portfolioBeta < 0.8 ? "Defensive. You are shielded from major crashes." :
                                    "Balanced. You track the market closely."}
                        </p>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full mt-4 overflow-hidden border border-slate-200 dark:border-transparent">
                            <div
                                className={`h-full transition-all duration-1000 ${portfolioBeta > 1.2 ? 'bg-rose-500' : portfolioBeta < 0.8 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                style={{ width: `${Math.min(portfolioBeta * 50, 100)}%` }} // Scale: 2.0 = 100%
                            ></div>
                        </div>
                    </div>
                </div>

                {/* Stress Test Simulator */}
                <div className="md:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2 uppercase tracking-tight">
                                <ShieldAlert size={20} className="text-rose-600 dark:text-rose-500" /> Stress Test Simulator
                            </h3>
                            <p className="text-xs text-slate-500 font-medium">Project impact of market crash or rally.</p>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Proj. Impact</p>
                            <p className={`text-2xl font-mono font-black ${projectedValues.pnlChange >= 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-600 dark:text-rose-500'}`}>
                                {projectedValues.pnlChange >= 0 ? '+' : ''}{formatCurrency(projectedValues.pnlChange)}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="relative pt-6">
                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step="1"
                                value={marketScenario}
                                onChange={(e) => setMarketScenario(parseInt(e.target.value))}
                                className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <div className="flex justify-between text-[10px] font-black text-slate-500 dark:text-slate-400 mt-2 uppercase tracking-widest">
                                <span>-20% Crash</span>
                                <span className="text-slate-900 dark:text-slate-200 font-mono">NIFTY: {marketScenario > 0 ? '+' : ''}{marketScenario}%</span>
                                <span>+20% Rally</span>
                            </div>
                        </div>

                        {marketScenario !== 0 && (
                            <div className={`p-4 rounded-xl border flex items-center gap-4 text-sm font-medium ${marketScenario < 0 ? 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-900/30 text-rose-700 dark:text-rose-300' : 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/30 text-emerald-700 dark:text-emerald-300'}`}>
                                {marketScenario < 0 ? <TrendingDown size={20} className="shrink-0" /> : <TrendingUp size={20} className="shrink-0" />}
                                <span>
                                    If Market moves <strong>{marketScenario}%</strong>, your portfolio moves <strong>{(marketScenario * portfolioBeta).toFixed(2)}%</strong>.
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Rebalancing Section */}
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm dark:shadow-xl">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-8">
                    <div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 uppercase tracking-tight">
                            <Scale className="text-indigo-600 dark:text-indigo-400" /> Rebalancing Engine
                        </h3>
                        <p className="text-slate-500 dark:text-slate-400 text-xs font-medium mt-1">
                            Align your portfolio with your defined target strategy.
                        </p>
                    </div>
                    <button
                        onClick={() => setIsTargetConfigOpen(true)}
                        className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all border border-slate-200 dark:border-slate-700 shadow-sm active:scale-95"
                    >
                        <Target size={14} className="text-indigo-600 dark:text-indigo-400" /> Configure Strategy
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Visualizer */}
                    <div className="h-64">
                        {!isLiteMode ? (
                            <SafeChartContainer>
                                <BarChart data={driftChartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10, fill: 'currentColor' }} className="text-slate-400 dark:text-slate-600" />
                                    <Tooltip
                                        content={<CustomTooltip />}
                                        cursor={{ fill: 'rgba(99, 102, 241, 0.05)' }}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    <Bar dataKey="Actual" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={12} name="Current %" isAnimationActive={isVisible} />
                                    <Bar dataKey="Target" fill="#10b981" radius={[0, 4, 4, 0]} barSize={12} name="Target %" isAnimationActive={isVisible} />
                                </BarChart>
                            </SafeChartContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50/50 dark:bg-transparent">
                                <p className="text-xs text-slate-500 dark:text-slate-500 uppercase font-black tracking-widest">Chart Paused in Lite Mode</p>
                            </div>
                        )}
                    </div>

                    {/* Shopping List */}
                    <div className="space-y-3 overflow-y-auto max-h-64 pr-2 custom-scrollbar">
                        {rebalancingPlan.map((item) => (
                            <div key={item.class} className="bg-white dark:bg-slate-950/50 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 flex items-center justify-between shadow-sm hover:border-indigo-500/20 transition-colors">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sm font-black text-slate-900 dark:text-slate-200 uppercase tracking-tight">{item.class}</span>
                                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${item.deviation > 0 ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
                                            {item.deviation > 0 ? '+' : ''}{item.deviation.toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-500 font-bold uppercase tracking-wider">
                                        Current: {item.currentPct.toFixed(1)}% / Target: {item.targetPct}%
                                    </div>
                                </div>

                                <div className={`flex items-center gap-3 px-3 py-2 rounded-xl border border-dashed ${item.action === 'SELL' ? 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400' : 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400'}`}>
                                    {item.action === 'SELL' ? <ArrowUpRight size={16} /> : <ArrowRightLeft size={16} />}
                                    <div className="text-right">
                                        <p className="text-[9px] font-black uppercase tracking-widest leading-none mb-0.5">{item.action}</p>
                                        <p className="text-xs font-mono font-black">
                                            {formatCurrency(item.actionAmount)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {rebalancingPlan.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 py-12">
                                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-full mb-3">
                                    <CheckCircle2 size={40} className="text-emerald-600 dark:text-emerald-500" />
                                </div>
                                <p className="text-sm font-bold uppercase tracking-widest">Portfolio Balanced</p>
                                <p className="text-xs mt-1">All asset classes within 1% of target.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Risk Heatmap (Visual Grid) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2 uppercase tracking-tight">
                    <Flame size={20} className="text-amber-600 dark:text-amber-500" /> Risk Heatmap
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {investments.map(inv => {
                        const beta = BETA_MAP[inv.type] || 1;
                        // Color based on Beta Risk
                        const colorClass = beta > 1.5 ? 'bg-rose-500' : beta > 1.0 ? 'bg-amber-500' : beta > 0.5 ? 'bg-emerald-500' : 'bg-slate-500';
                        // Size based on Value (Simulated by col-span)
                        const share = (inv.currentValue / totalAssets) * 100;
                        const spanClass = share > 20 ? 'col-span-2 row-span-2' : share > 10 ? 'col-span-2' : 'col-span-1';

                        return (
                            <div
                                key={inv.id}
                                onClick={() => setSimulatorAsset(inv)}
                                className={`${spanClass} ${colorClass} bg-opacity-10 dark:bg-opacity-20 border border-current rounded-2xl p-4 flex flex-col justify-between cursor-pointer hover:bg-opacity-20 dark:hover:bg-opacity-30 transition-all shadow-sm group`}
                                title={`Beta: ${beta}`}
                            >
                                <div className="flex justify-between items-start">
                                    <span className={`text-[10px] font-black uppercase tracking-tighter ${colorClass.replace('bg-', 'text-')}`}>β{beta}</span>
                                    {beta > 1.5 && <Flame size={14} className="text-rose-600 dark:text-rose-500 animate-pulse" />}
                                </div>
                                <div className="mt-4">
                                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:underline">{inv.name}</p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-bold mt-1">{formatCurrency(inv.currentValue)}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <TargetConfigModal isOpen={isTargetConfigOpen} onClose={() => setIsTargetConfigOpen(false)} />
        </div>
    );
};
