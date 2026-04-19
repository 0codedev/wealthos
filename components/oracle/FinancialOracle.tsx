import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { motion } from 'framer-motion';
import { 
    Brain, 
    TrendingUp, 
    Shield, 
    Zap, 
    ChevronRight,
    Loader2,
    Sparkles,
    Clock,
    Target,
    Play
} from 'lucide-react';
import { 
    AreaChart, 
    Area, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    Line 
} from 'recharts';
import { financialOracleService, OracleScenario, OracleResult } from '../../services/FinancialOracleService';
import { usePortfolioStore } from '../../store/portfolioStore';
import MarkdownRenderer from '../ai/MarkdownRenderer';
import { CHART_COLORS, CHART_DEFAULTS, getSeriesColor } from '../../utils/chartTheme';

const PRESET_SCENARIOS: OracleScenario[] = [
    { id: 'job-loss', name: 'Job Loss (12m)', isActive: false, type: 'JOB_LOSS', params: { startYear: 2 } },
    { id: 'medical', name: 'Medical Emergency', isActive: false, type: 'MEDICAL_EMERGENCY', params: { year: 5, cost: 2000000 } },
    { id: 'bull', name: 'Ultra Bull Market', isActive: false, type: 'BULL_MARKET', params: { boost: 0.05 } },
    { id: 'recession', name: 'Severe Recession', isActive: false, type: 'RECESSION', params: { year: 3, drawdown: 0.30 } },
    { id: 'retirement', name: 'Retire at 45', isActive: false, type: 'EARLY_RETIREMENT', params: { age: 45, currentAge: 32, withdrawalAmount: 200000 } }
];

export const FinancialOracle: React.FC = () => {
    const investments = usePortfolioStore(s => s.investments);
    const [scenarios, setScenarios] = useState<OracleScenario[]>(PRESET_SCENARIOS);
    const [result, setResult] = useState<OracleResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isNarrativeLoading, setIsNarrativeLoading] = useState(false);

    const paragraphs = useMemo(() => {
        if (!result || !result.aiNarrative) return [];
        return result.aiNarrative
            .split(/\n\n+/)
            .map(p => p.trim())
            .filter(Boolean);
    }, [result]);

    const runSimulation = async (updateNarrative: boolean = true) => {
        setIsLoading(true);
        if (updateNarrative) setIsNarrativeLoading(true);
        
        try {
            const res = await financialOracleService.runOracle(
                investments,
                50000, // Monthly SIP (mock or from store)
                20,    // Years
                100000000, // 10 Cr Target
                scenarios
            );
            setResult(res);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
            setIsNarrativeLoading(false);
        }
    };

    const toggleScenario = (id: string) => {
        setScenarios(prev => prev.map(s => s.id === id ? { ...s, isActive: !s.isActive } : s));
    };

    const chartData = useMemo(() => {
        if (!result) return [];
        return result.baseline.yearlyPaths.map((path, i) => {
            const data: any = {
                year: path.year,
                baseline: Math.round(path.p50 / 10000000 * 100) / 100,
                baselineP5: Math.round(path.p5 / 10000000 * 100) / 100,
                baselineP95: Math.round(path.p95 / 10000000 * 100) / 100,
            };

            scenarios.filter(s => s.isActive).forEach(s => {
                const sRes = result.scenarios[s.id];
                if (sRes) {
                    data[s.id] = Math.round(sRes.yearlyPaths[i].p50 / 10000000 * 100) / 100;
                    data[`${s.id}P5`] = Math.round(sRes.yearlyPaths[i].p5 / 10000000 * 100) / 100;
                    data[`${s.id}P95`] = Math.round(sRes.yearlyPaths[i].p95 / 10000000 * 100) / 100;
                }
            });

            return data;
        });
    }, [result, scenarios]);

    // Custom Tooltip component to format entries and hide helper percentile bands
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || !payload.length) return null;

        // Filter out helper P5 and P95 percentile bounds
        const visibleItems = payload.filter((item: any) => {
            const name = item.name;
            return name && !name.endsWith('P5') && !name.endsWith('P95') && item.value !== undefined && item.value !== null;
        });

        if (visibleItems.length === 0) return null;

        return (
            <div className="bg-slate-900/95 border border-indigo-500/30 p-4 rounded-xl shadow-xl backdrop-blur-md text-xs font-mono text-white space-y-2 max-w-sm">
                <div className="font-bold text-slate-400 border-b border-slate-800/80 pb-1.5 mb-1.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    Year {label} Projections
                </div>
                <div className="space-y-1.5">
                    {visibleItems.map((item: any) => {
                        let displayName = item.name;
                        if (item.name === 'baseline') {
                            displayName = 'Baseline (P50)';
                        } else {
                            const scenario = scenarios.find(s => s.id === item.name);
                            if (scenario) {
                                displayName = `${scenario.name} (P50)`;
                            }
                        }
                        return (
                            <div key={item.dataKey || item.name} className="flex items-center justify-between gap-4">
                                <span className="flex items-center gap-1.5" style={{ color: item.color || item.stroke }}>
                                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color || item.stroke }} />
                                    {displayName}
                                </span>
                                <span className="font-bold text-slate-100">₹{Number(item.value).toFixed(2)} Cr</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="p-4 md:p-6 space-y-6 bg-slate-50 dark:bg-slate-950 min-h-full text-slate-900 dark:text-slate-100">
            {/* Unified Header */}
            <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-2">
                        <Brain className="w-7 h-7 text-indigo-500" />
                        Predictive Oracle
                        <span className="ml-2 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-indigo-100 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 tracking-widest">
                            AI Simulation
                        </span>
                    </h1>
                    <p className="text-sm text-slate-550 dark:text-slate-400 mt-1 max-w-2xl">
                        Scenario-adjusted Monte Carlo engine with AI narrative projections. 
                        Simulate the likelihood of achieving your target milestones under tail risk events.
                    </p>
                </div>
                {result && (
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono text-right">
                        Simulation Accuracy: <span className="text-emerald-500 font-bold">2,000 paths/scenario</span>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Panel: Scenarios & Recommended Protocols */}
                <aside className="lg:col-span-3 space-y-6">
                    <div>
                        <h2 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-indigo-500" /> Scenario Modifiers
                        </h2>
                        <div className="space-y-3">
                            {scenarios.map(s => (
                                <motion.button
                                    key={s.id}
                                    whileHover={{ scale: 1.01 }}
                                    whileTap={{ scale: 0.99 }}
                                    onClick={() => toggleScenario(s.id)}
                                    className={`w-full p-4 rounded-xl border transition-all text-left group relative overflow-hidden ${
                                        s.isActive 
                                        ? 'bg-indigo-500/5 dark:bg-indigo-500/10 border-indigo-500/35 text-indigo-950 dark:text-indigo-300' 
                                        : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-755'
                                    }`}
                                >
                                    <div className="flex justify-between items-center relative z-10">
                                        <span className={`font-bold text-sm ${s.isActive ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-650 dark:text-slate-400'}`}>
                                            {s.name}
                                        </span>
                                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                            s.isActive ? 'border-indigo-400 bg-indigo-500' : 'border-slate-300 dark:border-slate-700'
                                        }`}>
                                            {s.isActive && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                        </div>
                                    </div>
                                </motion.button>
                            ))}
                        </div>

                        <button
                            onClick={() => runSimulation(true)}
                            disabled={isLoading}
                            className="w-full mt-4 py-3 px-4 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-widest rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Computing...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4" />
                                    Run Oracle
                                </>
                            )}
                        </button>
                    </div>

                    {/* Recommended Protocols in Left Column to conserve horizontal space at bottom */}
                    <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800/80">
                        <h2 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Recommended Protocols</h2>
                        <div className="grid gap-2">
                            {[
                                { title: 'Improve P95 Ceiling', icon: Target, color: 'text-emerald-600 dark:text-emerald-400' },
                                { title: 'Hedge P5 Floor', icon: Shield, color: 'text-indigo-650 dark:text-indigo-400' },
                                { title: 'Time Machine Adjust', icon: Clock, color: 'text-slate-500 dark:text-slate-400' }
                            ].map((action, i) => (
                                <button key={i} className="flex items-center justify-between p-3.5 bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl hover:border-slate-300 dark:hover:border-slate-700 transition-all group shadow-sm text-left">
                                    <div className="flex items-center gap-2.5">
                                        <action.icon className={`w-4 h-4 ${action.color}`} />
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{action.title}</span>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-600 group-hover:translate-x-0.5 transition-transform" />
                                </button>
                            ))}
                        </div>
                    </div>
                </aside>

                {/* Center Panel: Composite Chart */}
                <main className="lg:col-span-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 relative min-h-[500px] shadow-sm flex flex-col justify-between">
                    {result === null ? (
                        <div className="flex-grow flex flex-col items-center justify-center text-center p-12 min-h-[400px]">
                            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-500">
                                <Brain className="w-8 h-8" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Initialize Financial Oracle</h3>
                            <p className="text-xs text-slate-550 dark:text-slate-400 mt-2 max-w-sm leading-relaxed">
                                Toggle any scenario modifiers on the left (e.g. Job Loss, Medical Emergency, Bull Market) and run the projection engine to calculate survival odds and P50/P5 baseline values.
                            </p>
                            <button
                                onClick={() => runSimulation(true)}
                                disabled={isLoading}
                                className="mt-6 py-2.5 px-6 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center gap-2"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Running Simulation...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-4 h-4" />
                                        Start Calculations
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-6 z-10 mb-6">
                                <div>
                                    <span className="block text-[10px] text-slate-500 uppercase font-black mb-1">P50 Baseline</span>
                                    <span className="text-2xl font-black tracking-tighter text-slate-900 dark:text-slate-50">
                                        ₹{((result.baseline.percentiles.p50 || 0) / 10000000).toFixed(2)} Cr
                                    </span>
                                </div>
                                <div className="w-px h-8 bg-slate-200 dark:bg-slate-800" />
                                <div>
                                    <span className="block text-[10px] text-slate-500 uppercase font-black mb-1">Survival Odds</span>
                                    <span className={`text-2xl font-black tracking-tighter ${
                                        result.baseline.successProbability > 80 ? 'text-emerald-500' : 'text-amber-500'
                                    }`}>
                                        {result.baseline.successProbability.toFixed(1)}%
                                    </span>
                                </div>
                            </div>

                            {isLoading && (
                                <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-center justify-center rounded-2xl">
                                    <div className="text-center">
                                        <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4" />
                                        <p className="text-indigo-300 font-bold animate-pulse uppercase tracking-widest text-xs">Computing Future Paths...</p>
                                    </div>
                                </div>
                            )}

                            <div className="h-[380px] w-full flex-grow">
                                <SafeChartContainer>
                                    <AreaChart data={chartData}>
                                        <defs>
                                            <linearGradient id="baselineColor" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.1}/>
                                                <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0}/>
                                            </linearGradient>
                                            {scenarios.filter(s => s.isActive).map((s, i) => (
                                                <linearGradient key={`grad-${s.id}`} id={`color-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={getSeriesColor(i + 1)} stopOpacity={0.1}/>
                                                    <stop offset="95%" stopColor={getSeriesColor(i + 1)} stopOpacity={0}/>
                                                </linearGradient>
                                            ))}
                                        </defs>

                                        <CartesianGrid {...CHART_DEFAULTS.grid} />
                                        <XAxis 
                                            dataKey="year" 
                                            {...CHART_DEFAULTS.axis}
                                            tickFormatter={(val) => `Year ${val}`}
                                        />
                                        <YAxis 
                                            {...CHART_DEFAULTS.axis}
                                            tickFormatter={(val) => `₹${val}Cr`}
                                        />
                                        
                                        {/* Use CustomTooltip component to filter and style options */}
                                        <Tooltip content={<CustomTooltip />} cursor={CHART_DEFAULTS.tooltip.cursor} />

                                        {/* Baseline Bands */}
                                        <Area 
                                            type="monotone" 
                                            dataKey="baselineP95" 
                                            stroke="transparent" 
                                            fill={CHART_COLORS.primary} 
                                            fillOpacity={0.03} 
                                            tooltipType="none"
                                        />
                                        <Area 
                                            type="monotone" 
                                            dataKey="baselineP5" 
                                            stroke="transparent" 
                                            fill={CHART_COLORS.primary} 
                                            fillOpacity={0.07} 
                                            tooltipType="none"
                                        />
                                        <Line 
                                            type="monotone" 
                                            dataKey="baseline" 
                                            stroke={CHART_COLORS.primary} 
                                            strokeWidth={3} 
                                            dot={false} 
                                            activeDot={{ r: 6, stroke: CHART_COLORS.primary, strokeWidth: 2, fill: '#fff' }} 
                                        />

                                        {/* Scenarios */}
                                        {scenarios.filter(s => s.isActive).map((s, i) => (
                                            <React.Fragment key={s.id}>
                                                <Area 
                                                    type="monotone" 
                                                    dataKey={`${s.id}P95`} 
                                                    stroke="transparent" 
                                                    fill={getSeriesColor(i + 1)} 
                                                    fillOpacity={0.03} 
                                                    tooltipType="none"
                                                />
                                                <Line 
                                                    type="monotone" 
                                                    dataKey={s.id} 
                                                    stroke={getSeriesColor(i + 1)} 
                                                    strokeWidth={2} 
                                                    strokeDasharray="5 5"
                                                    dot={false} 
                                                />
                                            </React.Fragment>
                                        ))}
                                    </AreaChart>
                                </SafeChartContainer>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                <div className="flex items-center gap-1.5"><div className="w-3 h-1 bg-indigo-500 rounded-full" /> Baseline</div>
                                <div className="flex items-center gap-1.5"><div className="w-3 h-1 bg-indigo-500 opacity-20 rounded-full" /> Confidence Band (P5-P95)</div>
                                {scenarios.filter(s => s.isActive).map((s, i) => (
                                    <div key={s.id} className="flex items-center gap-1.5">
                                        <div className="w-3 h-1 rounded-full" style={{ backgroundColor: getSeriesColor(i + 1) }} /> {s.name}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </main>
            </div>

            {/* Bottom Row: AI Verdict full-width */}
            <div className="grid grid-cols-1 gap-6">
                {/* The Oracle's Verdict */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 relative overflow-hidden group shadow-sm w-full">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-800/80 pb-3">
                        <Sparkles className="w-4.5 h-4.5 text-indigo-500" />
                        <h2 className="text-sm font-black text-indigo-500 dark:text-indigo-400 uppercase tracking-widest">The Oracle's Verdict</h2>
                    </div>
                    
                    <div className="prose prose-slate dark:prose-invert prose-sm max-w-none">
                        {result === null ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                                Awaiting calculations to generate AI narrative report...
                            </p>
                        ) : isNarrativeLoading ? (
                            <div className="space-y-4 py-4">
                                <div className="h-4 bg-indigo-500/10 rounded-full w-3/4 animate-pulse" />
                                <div className="h-4 bg-indigo-500/10 rounded-full w-full animate-pulse" />
                                <div className="h-4 bg-indigo-500/10 rounded-full w-5/6 animate-pulse" />
                            </div>
                        ) : paragraphs.length >= 3 ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 not-prose mt-2">
                                {/* Column 1: Outlook */}
                                <div className="p-6 rounded-2xl border border-indigo-100 bg-indigo-50/15 dark:border-indigo-550/20 dark:bg-indigo-950/20 flex flex-col gap-3.5 shadow-sm hover:shadow-indigo-500/5 hover:border-indigo-500/30 transition-all duration-300">
                                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-455">
                                        <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-500/15">
                                            <TrendingUp className="w-4.5 h-4.5" />
                                        </div>
                                        <span className="text-xs font-black uppercase tracking-wider">Outlook & Trajectory</span>
                                    </div>
                                    <div className="text-xs text-slate-650 dark:text-slate-300 leading-relaxed font-medium">
                                        <MarkdownRenderer content={paragraphs[0]} />
                                    </div>
                                </div>

                                {/* Column 2: Risks */}
                                <div className="p-6 rounded-2xl border border-rose-100 bg-rose-50/15 dark:border-rose-550/20 dark:bg-rose-950/20 flex flex-col gap-3.5 shadow-sm hover:shadow-rose-500/5 hover:border-rose-500/30 transition-all duration-300">
                                    <div className="flex items-center gap-2 text-rose-600 dark:text-rose-455">
                                        <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-500/15">
                                            <Shield className="w-4.5 h-4.5" />
                                        </div>
                                        <span className="text-xs font-black uppercase tracking-wider">Vulnerabilities & Risk</span>
                                    </div>
                                    <div className="text-xs text-slate-650 dark:text-slate-300 leading-relaxed font-medium">
                                        <MarkdownRenderer content={paragraphs[1]} />
                                    </div>
                                </div>

                                {/* Column 3: Strategy */}
                                <div className="p-6 rounded-2xl border border-emerald-100 bg-emerald-50/15 dark:border-emerald-550/20 dark:bg-emerald-950/20 flex flex-col gap-3.5 shadow-sm hover:shadow-emerald-500/5 hover:border-emerald-500/30 transition-all duration-300">
                                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-455">
                                        <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-500/15">
                                            <Target className="w-4.5 h-4.5" />
                                        </div>
                                        <span className="text-xs font-black uppercase tracking-wider">Strategic Optimization</span>
                                    </div>
                                    <div className="text-xs text-slate-650 dark:text-slate-300 leading-relaxed font-medium">
                                        <MarkdownRenderer content={paragraphs[2]} />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="p-6 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 hover:border-indigo-500/30 transition-all duration-300 leading-relaxed text-sm text-slate-300 font-medium">
                                <MarkdownRenderer content={result.aiNarrative || ''} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FinancialOracle;
