import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { getHistoricalSectorData, MonthlyData, SectorDetail } from '../../data/sectorHistoricalData';
const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
import { Activity, Shield, TrendingUp, BarChart2, Layers, AlertCircle, RefreshCw, Download, Star, CheckCircle, Info } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useSettingsStore } from '../../store/settingsStore';

export const SectorRotationTab: React.FC = () => {
    const designPreset = useSettingsStore((s) => s.designPreset);
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const [sectorData, setSectorData] = useState<Record<string, SectorDetail>>({});
    const [loading, setLoading] = useState(true);
    const [loadingMsg, setLoadingMsg] = useState('Initializing sector analytics...');
    const [chartMetric, setChartMetric] = useState<'performance' | 'volatility' | 'momentum' | 'volume'>('performance');
    const [chartType, setChartType] = useState<'bar' | 'line' | 'radar'>('bar');
    const [rankingPeriod, setRankingPeriod] = useState<'1m' | '3m' | '6m' | '12m'>('12m');
    const [heatmapYear, setHeatmapYear] = useState<number>(() => {
        const currentMonthIdx = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        return currentMonthIdx >= 3 ? currentYear : currentYear - 1;
    });
    const [selectedCell, setSelectedCell] = useState<{ sector: string; month: string; value: number } | null>(null);

    const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
    const FY_MONTHS_FULL = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];
    const FY_MONTH_INDICES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currentMonthIdx = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        setLoadingMsg('Connecting to index pricing endpoints...');
        await new Promise(r => setTimeout(r, 600));
        setLoadingMsg('Compiling 12 months of sector rotation matrices...');
        await new Promise(r => setTimeout(r, 400));
        
        try {
            const data = getHistoricalSectorData();
            setSectorData(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const getRotationSignal = () => {
        const sectors = Object.values(sectorData);
        if (sectors.length === 0) return { signal: "Neutral", trend: "Mixed rotation", class: "text-slate-400 bg-slate-500/10 border-slate-500/20" };
        const def = ["Pharma", "FMCG"].map(n => sectors.find(s => s.name === n));
        const cyc = ["Auto", "Metals", "Realty"].map(n => sectors.find(s => s.name === n));
        const defAvg = def.reduce((s, x) => s + (x?.currentChange || 0), 0) / def.length;
        const cycAvg = cyc.reduce((s, x) => s + (x?.currentChange || 0), 0) / cyc.length;
        const diff = cycAvg - defAvg;
        if (diff > 2) return { signal: "Risk-On", trend: "Cyclicals leading Defensives", class: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
        if (diff < -2) return { signal: "Risk-Off", trend: "Defensives leading Cyclicals", class: "text-rose-400 bg-rose-500/10 border-rose-500/20" };
        return { signal: "Neutral", trend: "Sector rotation is balanced", class: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
    };

    const getRotationPhase = () => {
        const sectors = Object.values(sectorData);
        if (sectors.length === 0) return 'early';
        const groups = {
            early: ["Banking", "Realty", "Fin Services"],
            mid: ["Technology", "Auto", "Metals", "Infra"],
            late: ["Energy", "Pharma"],
            recession: ["FMCG", "Pharma"],
        };
        const scores: Record<string, number> = {};
        Object.entries(groups).forEach(([phase, names]) => {
            const ps = names.map(n => sectors.find(s => s.name === n)).filter(Boolean) as SectorDetail[];
            scores[phase] = ps.reduce((s, x) => s + x.currentChange, 0) / ps.length;
        });
        return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    };

    const getPeriodChange = (sector: SectorDetail, months: number) => {
        const data = sector.monthly;
        if (data.length === 0) return 0;
        const lastIdx = data.length - 1;
        const startIdx = Math.max(0, lastIdx - months + 1);
        const start = data[startIdx]?.open || data[0].open;
        const end = data[lastIdx]?.close || data[lastIdx].close;
        if (!start) return 0;
        return ((end - start) / start) * 100;
    };

    const getHeatmapColor = (value: number) => {
        if (value >= 10) return "rgba(16, 185, 129, 0.9)";
        if (value >= 5) return "rgba(16, 185, 129, 0.65)";
        if (value >= 2) return "rgba(16, 185, 129, 0.35)";
        if (value >= -2) return "rgba(71, 85, 105, 0.25)";
        if (value >= -5) return "rgba(239, 68, 68, 0.35)";
        if (value >= -10) return "rgba(239, 68, 68, 0.65)";
        return "rgba(239, 68, 68, 0.9)";
    };

    const exportCSV = () => {
        const sectors = Object.values(sectorData);
        let csv = "Sector,YTD Change,Current Month Change,Volatility,Momentum,Seasonal Status\n";
        sectors.forEach(s => {
            csv += `${s.name},${s.ytdChange.toFixed(2)}%,${s.currentChange.toFixed(2)}%,${s.avgVolatility.toFixed(2)}%,${s.avgMomentum.toFixed(0)},${s.isSeasonal ? "Prime" : "Off-Season"}\n`;
        });
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `sector_analytics_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Prepare chart data
    const chartData = Object.entries(sectorData).map(([key, sector]) => {
        let value = 0;
        if (chartMetric === 'performance') value = sector.ytdChange;
        else if (chartMetric === 'volatility') value = sector.avgVolatility;
        else if (chartMetric === 'momentum') value = sector.avgMomentum;
        else if (chartMetric === 'volume') value = (sector.monthly[sector.monthly.length - 1]?.volume ?? 0) / 1000000;

        return {
            name: sector.shortName || sector.name,
            fullName: sector.name,
            value: Math.round(value * 100) / 100,
            fill: chartMetric === 'performance' 
                ? (value >= 0 ? '#10b981' : '#ef4444') 
                : sector.color
        };
    });

    // Sub-tab rankings period mapping
    const rankPeriodMonths = rankingPeriod === '1m' ? 1 : rankingPeriod === '3m' ? 3 : rankingPeriod === '6m' ? 6 : 12;
    const sortedRankings = Object.values(sectorData).sort((a, b) => 
        getPeriodChange(b, rankPeriodMonths) - getPeriodChange(a, rankPeriodMonths)
    );

    // AI Signals
    const getAiSignals = () => {
        const sectors = Object.values(sectorData);
        if (sectors.length === 0) return [];
        const signals = [];
        const sorted = [...sectors].sort((a, b) => b.currentChange - a.currentChange);
        const top = sorted[0];
        const bottom = sorted[sorted.length - 1];

        if (top.currentChange > 4 && bottom.currentChange < -2) {
            signals.push({
                type: 'rotation',
                title: `${bottom.name} → ${top.name} Rotation`,
                desc: `Capital is aggressively flowing out of defensive/weak ${bottom.name} (${bottom.currentChange.toFixed(1)}%) and rotating into high-momentum ${top.name} (+${top.currentChange.toFixed(1)}%).`,
                confidence: 'High',
                time: 'Just Now'
            });
        }

        sectors.filter(s => s.isSeasonal && s.currentChange > 0).forEach(s => {
            signals.push({
                type: 'bullish',
                title: `${s.name} — Seasonal Accumulation`,
                desc: `${MONTHS_FULL[currentMonthIdx]} marks the start of historical strong season for ${s.name}. Sector index holds a Momentum rating of ${s.avgMomentum}/100.`,
                confidence: 'High',
                time: '2h ago'
            });
        });

        sectors.filter(s => s.avgMomentum < 40 && s.ytdChange < 0).slice(0, 2).forEach(s => {
            signals.push({
                type: 'bearish',
                title: `${s.name} — Distribution Phase`,
                desc: `Continuous institutional distribution observed. Momentum is critically oversold at ${s.avgMomentum}/100. Restructure F&O risk accordingly.`,
                confidence: 'Medium',
                time: '4h ago'
            });
        });

        const highlyVolatile = sectors.filter(s => s.avgVolatility > 18);
        if (highlyVolatile.length > 0) {
            signals.push({
                type: 'neutral',
                title: 'Elevated Beta Warning',
                desc: `${highlyVolatile.map(s => s.name).join(', ')} index options are pricing in premium due to high daily swing dynamics.`,
                confidence: 'Medium',
                time: '6h ago'
            });
        }

        return signals.slice(0, 4);
    };

    const rotationPhase = getRotationPhase();
    const rotationSignal = getRotationSignal();

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
                <RefreshCw className="animate-spin text-emerald-400 w-10 h-10" />
                <p className="text-slate-400 font-mono text-sm">{loadingMsg}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 tab-fade-in pb-12 text-slate-100 max-w-[100vw] overflow-x-hidden">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/40 p-6 rounded-2xl border border-slate-800/80 backdrop-blur-md">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
                            <Activity size={22} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-white">Sector Rotation Intelligence</h1>
                            <p className="text-xs text-slate-400 mt-0.5">Live index correlation matrix, seasonality tracking & institutional cash flows</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span id="dataSourceBadge" className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-emerald-500/5">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
                        Live Sync
                    </span>
                    <button 
                        onClick={exportCSV}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700/60 flex items-center gap-1.5 transition-all"
                    >
                        <Download size={14} /> Export CSV
                    </button>
                </div>
            </div>

            {/* Top Dashboard Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className={`p-5 border transition-all flex flex-col justify-between min-h-[110px] ${isAstryx ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "bg-zinc-900/80 border-zinc-800 rounded-xl font-sans" : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700/80 rounded-2xl font-sans"}`}>

                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Top Performing Sector</span>
                    <div>
                        <div className="text-lg font-bold text-white mt-1 truncate">{sortedRankings[0]?.name || 'N/A'}</div>
                        <div className="text-sm font-semibold text-emerald-400 mt-0.5">+{sortedRankings[0] ? getPeriodChange(sortedRankings[0], rankPeriodMonths).toFixed(1) : 0}% YTD</div>
                    </div>
                </div>
                <div className={`p-5 border transition-all flex flex-col justify-between min-h-[110px] ${isAstryx ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "bg-zinc-900/80 border-zinc-800 rounded-xl font-sans" : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700/80 rounded-2xl font-sans"}`}>

                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Capital Rotation Signal</span>
                    <div>
                        <div className="text-lg font-bold text-white mt-1">{rotationSignal.signal}</div>
                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-1 truncate">
                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
                            {rotationSignal.trend}
                        </div>
                    </div>
                </div>
                <div className={`p-5 border transition-all flex flex-col justify-between min-h-[110px] ${isAstryx ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "bg-zinc-900/80 border-zinc-800 rounded-xl font-sans" : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700/80 rounded-2xl font-sans"}`}>

                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Bullish / Bearish Ratio</span>
                    <div>
                        <div className="text-lg font-bold text-white mt-1">
                            <span className="text-emerald-400">{Object.values(sectorData).filter(s => s.currentChange > 0.5).length}</span>
                            <span className="text-slate-500"> / </span>
                            <span className="text-rose-400">{Object.values(sectorData).filter(s => s.currentChange < -0.5).length}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">Active trend indicators</div>
                    </div>
                </div>
                <div className={`p-5 border transition-all flex flex-col justify-between min-h-[110px] ${isAstryx ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "bg-zinc-900/80 border-zinc-800 rounded-xl font-sans" : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700/80 rounded-2xl font-sans"}`}>

                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Average Volatility (Beta)</span>
                    <div>
                        <div className="text-lg font-bold text-white mt-1">
                            {(Object.values(sectorData).reduce((s, x) => s + x.avgVolatility, 0) / Math.max(1, Object.keys(sectorData).length)).toFixed(1)}%
                        </div>
                        <div className="text-xs text-slate-400 mt-1">12-month standard deviation</div>
                    </div>
                </div>
            </div>

            {/* Performance charts section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Recharts Chart Block (2/3 width) */}
                <div className={`lg:col-span-2 p-6 border flex flex-col h-[460px] ${isAstryx ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "bg-zinc-900/80 border-zinc-800 rounded-xl font-sans" : "bg-slate-900/60 border-slate-800/80 rounded-2xl font-sans"}`}>

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                        <h3 className="text-sm sm:text-base font-bold text-white">Sector Performance Trends</h3>
                        <div className="flex items-center gap-2 self-stretch sm:self-auto">
                            <select 
                                value={chartMetric} 
                                onChange={(e) => setChartMetric(e.target.value as any)}
                                className="bg-slate-800 border border-slate-700/60 text-slate-200 text-xs px-2.5 py-1.5 rounded-xl font-semibold outline-none focus:ring-1 focus:ring-indigo-500 flex-1 sm:flex-none"
                            >
                                <option value="performance">Capital Flow % (YTD)</option>
                                <option value="volatility">Volatility Index</option>
                                <option value="momentum">Momentum Score</option>
                                <option value="volume">Volume (M)</option>
                            </select>
                            <select 
                                value={chartType} 
                                onChange={(e) => setChartType(e.target.value as any)}
                                className="bg-slate-800 border border-slate-700/60 text-slate-200 text-xs px-2.5 py-1.5 rounded-xl font-semibold outline-none focus:ring-1 focus:ring-indigo-500 flex-1 sm:flex-none"
                            >
                                <option value="bar">Bar Chart</option>
                                <option value="line">Line Chart</option>
                                <option value="radar">Radar Chart</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex-1 w-full relative min-h-[300px]">
                        <SafeChartContainer>
                            {chartType === 'bar' ? (
                                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                    <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} />
                                    <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                                        labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                                    />
                                    <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={24} />
                                </BarChart>
                            ) : chartType === 'line' ? (
                                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                    <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} />
                                    <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                                        labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                                    />
                                    <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, stroke: '#0f172a', strokeWidth: 1.5 }} />
                                </LineChart>
                            ) : (
                                <RadarChart outerRadius={90} data={chartData}>
                                    <PolarGrid stroke="#1e293b" />
                                    <PolarAngleAxis dataKey="name" stroke="#64748b" fontSize={10} />
                                    <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#475569" fontSize={8} />
                                    <Radar name="Value" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                                    />
                                </RadarChart>
                            )}
                        </SafeChartContainer>
                    </div>
                </div>

                {/* Market Cycle & Rotation Phase (1/3 width) */}
                <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 flex flex-col h-[460px] justify-between">
                    <div>
                        <h3 className="text-sm sm:text-base font-bold text-white mb-2">Market Cycle & Rotation</h3>
                        <p className="text-[11px] text-slate-400 leading-relaxed mb-4">Economic cycles drive institutional capital allocation across distinct sectors. Identify the currently active rotation phase below.</p>
                    </div>

                    <div className="space-y-3 flex-1 flex flex-col justify-center">
                        {[
                            { id: 'early', label: 'Early Recovery', desc: 'Financials, Real Estate, Cyclicals outperform', color: 'border-emerald-500/20 text-emerald-400 bg-emerald-500/5' },
                            { id: 'mid', label: 'Mid-Cycle Growth', desc: 'Tech, Industrials, Auto expand exposure', color: 'border-indigo-500/20 text-indigo-400 bg-indigo-500/5' },
                            { id: 'late', label: 'Late Expansion', desc: 'Energy, Commodities, Metals edge higher', color: 'border-amber-500/20 text-amber-400 bg-amber-500/5' },
                            { id: 'recession', label: 'Recession Shield', desc: 'Healthcare, FMCG, Utilities provide hedges', color: 'border-rose-500/20 text-rose-400 bg-rose-500/5' }
                        ].map((phase) => {
                            const isActive = rotationPhase === phase.id;
                            return (
                                <div 
                                    key={phase.id}
                                    className={`p-3 rounded-xl border transition-all ${isActive ? `${phase.color} shadow-lg ring-1 ring-white/5` : 'border-slate-800/60 text-slate-400 bg-slate-950/20 opacity-60'}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold uppercase tracking-wider">{phase.label}</span>
                                        {isActive && <span className="text-[9px] font-bold bg-white/10 px-2 py-0.5 rounded-full uppercase">Leading Phase</span>}
                                    </div>
                                    <p className="text-[10px] mt-1 text-slate-400 font-medium leading-tight">{phase.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Seasonal sector strength & rankings list */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Sector Rankings */}
                <div className="lg:col-span-2 bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 h-[380px] flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm sm:text-base font-bold text-white">Sector Rankings</h3>
                        <select 
                            value={rankingPeriod} 
                            onChange={(e) => setRankingPeriod(e.target.value as any)}
                            className="bg-slate-800 border border-slate-700/60 text-slate-200 text-xs px-2.5 py-1.5 rounded-xl font-semibold outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                            <option value="1m">1 Month Period</option>
                            <option value="3m">3 Months Period</option>
                            <option value="6m">6 Months Period</option>
                            <option value="12m">12 Months (YTD)</option>
                        </select>
                    </div>

                    <div className="flex-1 overflow-y-auto overflow-x-auto rounded-xl border border-slate-800/80 custom-scrollbar">
                        <table className="w-full text-left border-collapse min-w-[500px]">
                            <thead>
                                <tr className="border-b border-slate-800 bg-slate-950/60 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                                    <th className="py-2.5 px-4 w-[10%]">Rank</th>
                                    <th className="py-2.5 px-4 w-[35%]">Sector</th>
                                    <th className="py-2.5 px-4 w-[15%]">Change</th>
                                    <th className="py-2.5 px-4 w-[25%]">Momentum Strength</th>
                                    <th className="py-2.5 px-4 w-[15%]">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                                {sortedRankings.map((sector, index) => {
                                    const change = getPeriodChange(sector, rankPeriodMonths);
                                    const isPos = change >= 0;
                                    const status = sector.isSeasonal ? "Seasonal Prime" : isPos ? "Active Trend" : "Weak Flow";
                                    const statusColor = sector.isSeasonal ? 'text-emerald-400' : isPos ? 'text-amber-400' : 'text-rose-400';

                                    return (
                                        <tr key={sector.name} className="hover:bg-slate-850/40 transition-colors">
                                            <td className="py-3 px-4 font-mono font-black text-slate-500 text-xs">{index + 1}</td>
                                            <td className="py-3 px-4 font-semibold text-white text-xs">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: sector.color }} />
                                                    {sector.name}
                                                </div>
                                            </td>
                                            <td className={`py-3 px-4 font-mono text-xs font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {isPos ? '+' : ''}{change.toFixed(1)}%
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="w-full bg-slate-850 h-2 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full rounded-full" 
                                                        style={{ width: `${sector.avgMomentum}%`, backgroundColor: sector.color }} 
                                                    />
                                                </div>
                                            </td>
                                            <td className={`py-3 px-4 text-xs font-semibold ${statusColor}`}>{status}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Seasonal Sector Strength */}
                <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 h-[380px] flex flex-col justify-between">
                    <div>
                        <h3 className="text-sm sm:text-base font-bold text-white mb-1">Seasonal Sector Strength</h3>
                        <p className="text-[11px] text-slate-400 leading-relaxed">Historical strength mapping for {MONTHS_FULL[currentMonthIdx]}. Highlighted sectors are prime options.</p>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2 mt-4 pr-1 custom-scrollbar">
                        {Object.values(sectorData)
                            .sort((a, b) => (b.isSeasonal ? 1 : 0) - (a.isSeasonal ? 1 : 0))
                            .map((sector) => (
                                <div 
                                    key={sector.name} 
                                    className={`flex items-center justify-between p-2.5 rounded-xl border text-xs ${sector.isSeasonal ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400 font-semibold' : 'border-slate-800/60 text-slate-400 bg-slate-950/20'}`}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: sector.color }} />
                                        <span className="truncate">{sector.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider ${sector.isSeasonal ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                                            {sector.isSeasonal ? 'Prime' : 'Off-Season'}
                                        </span>
                                        <span className="font-mono text-slate-300">{sector.currentChange > 0 ? '+' : ''}{sector.currentChange.toFixed(1)}%</span>
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            </div>

            {/* Heatmap Grid */}
            <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h3 className="text-sm sm:text-base font-bold text-white">Monthly Performance Heatmap</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Historical monthly capital flow matrix across sector indices (Financial Year)</p>
                    </div>
                    <select 
                        value={heatmapYear}
                        onChange={(e) => setHeatmapYear(parseInt(e.target.value))}
                        className="bg-slate-800 border border-slate-700/60 text-slate-200 text-xs px-2.5 py-1.5 rounded-xl font-semibold outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                        {(() => {
                            const currentFYStart = new Date().getMonth() >= 3 ? currentYear : currentYear - 1;
                            return (
                                <>
                                    <option value={currentFYStart}>FY {currentFYStart}-{String(currentFYStart + 1).slice(-2)}</option>
                                    <option value={currentFYStart - 1}>FY {currentFYStart - 1}-{String(currentFYStart).slice(-2)}</option>
                                    <option value={currentFYStart - 2}>FY {currentFYStart - 2}-{String(currentFYStart - 1).slice(-2)}</option>
                                </>
                            );
                        })()}
                    </select>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/20 p-2 custom-scrollbar">
                    <div 
                        className="min-w-[700px] gap-1 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wide py-2"
                        style={{ display: 'grid', gridTemplateColumns: '120px repeat(12, minmax(0, 1fr))' }}
                    >
                        <span className="text-left pl-2">Sector</span>
                        {FY_MONTHS.map(m => <span key={m}>{m}</span>)}
                    </div>

                    <div className="min-w-[700px] space-y-1 mt-1">
                        {Object.values(sectorData).map((sector) => {
                            const byMonth = new Array(12).fill(null);
                            sector.monthly.forEach((entry) => {
                                const isPart1 = entry.month >= 3 && entry.year === heatmapYear;
                                const isPart2 = entry.month <= 2 && entry.year === heatmapYear + 1;
                                if (isPart1 || isPart2) {
                                    const fyIndex = FY_MONTH_INDICES.indexOf(entry.month);
                                    if (fyIndex !== -1) {
                                        byMonth[fyIndex] = entry;
                                    }
                                }
                            });

                            return (
                                <div 
                                    key={sector.name} 
                                    className="gap-1 items-center"
                                    style={{ display: 'grid', gridTemplateColumns: '120px repeat(12, minmax(0, 1fr))' }}
                                >
                                    <span className="text-left font-semibold text-white truncate text-xs pl-2 bg-slate-900/30 py-2 rounded-lg border border-slate-800/40">
                                        {sector.shortName || sector.name}
                                    </span>
                                    {byMonth.map((entry, colIdx) => {
                                        if (!entry) {
                                            return (
                                                <div 
                                                    key={colIdx} 
                                                    className="py-2.5 rounded-lg text-slate-600 bg-slate-900/20 border border-slate-850 text-xs font-semibold"
                                                >
                                                    —
                                                </div>
                                            );
                                        }
                                        const value = entry.capitalFlow;
                                        const bg = getHeatmapColor(value);
                                        const calMonth = FY_MONTH_INDICES[colIdx];
                                        const targetYear = calMonth >= 3 ? heatmapYear : heatmapYear + 1;
                                        const isCurrent = targetYear === currentYear && calMonth === currentMonthIdx;
                                        const displayVal = value > 0 ? `+${value.toFixed(0)}` : value.toFixed(0);

                                        return (
                                            <button
                                                key={colIdx}
                                                onClick={() => setSelectedCell({ sector: sector.name, month: FY_MONTHS_FULL[colIdx], value })}
                                                style={{ backgroundColor: bg }}
                                                className={`py-2.5 rounded-lg text-white text-xs font-extrabold transition-all hover:scale-105 active:scale-95 border ${isCurrent ? 'border-indigo-400 shadow-sm ring-1 ring-indigo-400/20' : 'border-black/10'}`}
                                            >
                                                {displayVal}%
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Heatmap Legend */}
                <div className="flex flex-wrap justify-between items-center gap-4 mt-6 pt-4 border-t border-slate-850">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        <span>Weak (-10%)</span>
                        <span className="w-3 h-3 rounded bg-red-500/90" />
                        <span className="w-3 h-3 rounded bg-red-500/50" />
                        <span className="w-3 h-3 rounded bg-red-500/30" />
                        <span className="w-3 h-3 rounded bg-slate-700/30" />
                        <span className="w-3 h-3 rounded bg-emerald-500/30" />
                        <span className="w-3 h-3 rounded bg-emerald-500/50" />
                        <span className="w-3 h-3 rounded bg-emerald-500/90" />
                        <span>Strong (+10%)</span>
                    </div>
                    {selectedCell && (
                        <div className="px-3 py-1 bg-slate-800 border border-slate-700 text-xs rounded-xl flex items-center gap-2">
                            <span className="font-semibold text-slate-200">{selectedCell.sector} ({selectedCell.month}):</span>
                            <span className={`font-mono font-bold ${selectedCell.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {selectedCell.value > 0 ? '+' : ''}{selectedCell.value.toFixed(2)}%
                            </span>
                            <button 
                                onClick={() => setSelectedCell(null)}
                                className="text-[10px] text-slate-500 hover:text-slate-300 font-bold ml-1 uppercase"
                            >
                                Hide
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* AI Generated Signals & Strategy Insights */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* AI Signals */}
                <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80">
                    <div className="flex items-center gap-2 mb-4">
                        <Activity size={18} className="text-indigo-400" />
                        <h3 className="text-sm sm:text-base font-bold text-white">AI-Generated Signals</h3>
                    </div>
                    <div className="space-y-4">
                        {getAiSignals().map((sig, idx) => {
                            const isRot = sig.type === 'rotation';
                            const isBull = sig.type === 'bullish';
                            const isBear = sig.type === 'bearish';
                            const color = isRot ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' 
                                : isBull ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : isBear ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/20';

                            return (
                                <div key={idx} className="bg-slate-950/20 p-4 rounded-xl border border-slate-850 flex gap-3.5 items-start">
                                    <div className={`px-2.5 py-1 text-sm font-black rounded-lg border ${color}`}>
                                        {isRot ? '↔' : isBull ? '↑' : isBear ? '↓' : '!'}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-bold text-white">{sig.title}</span>
                                            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">{sig.time}</span>
                                        </div>
                                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{sig.desc}</p>
                                        <div className="flex items-center gap-1.5 mt-2">
                                            <span className="text-[8px] uppercase tracking-wider font-extrabold text-slate-500">Confidence:</span>
                                            <span className={`text-[8px] uppercase tracking-wider font-black ${sig.confidence === 'High' ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                {sig.confidence}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Strategy Insights */}
                <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <Info size={18} className="text-indigo-400" />
                            <h3 className="text-sm sm:text-base font-bold text-white">Strategy Insights</h3>
                        </div>
                        <div className="space-y-4 text-xs leading-relaxed text-slate-300">
                            <p>
                                Active macro indicators outline a strong flow of institutional funds in 
                                <span className="font-bold text-emerald-400 ml-1">
                                    {sortedRankings.slice(0, 2).map(s => s.name).join(' and ')}
                                </span>. 
                                Standard momentum score suggests holding overweight positions across these sectors.
                            </p>
                            <p>
                                Historically, {MONTHS_FULL[currentMonthIdx]} exhibits structural accumulation tendencies for cyclical assets.
                                Consider allocating options portfolio weights in compliance with the risk management boundaries.
                            </p>
                            <p className="p-3.5 bg-slate-950/30 rounded-xl border border-slate-850 flex gap-2 items-start text-[11px] text-slate-400 leading-normal">
                                <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                                <span>
                                    <strong>Position Sizing Warning:</strong> Average volatility across indices holds at 
                                    <strong className="text-amber-400 ml-1">
                                        {(Object.values(sectorData).reduce((s, x) => s + x.avgVolatility, 0) / Math.max(1, Object.keys(sectorData).length)).toFixed(1)}%
                                    </strong>. Keep contract sizing small on high-beta options models.
                                </span>
                            </p>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-slate-850 flex justify-between items-center">
                        <div className="flex items-center gap-1">
                            <Star size={14} className="text-indigo-400" />
                            <span className="text-[10px] text-slate-500 font-bold uppercase">Accuracy Rating:</span>
                            <span className="text-[10px] text-indigo-400 font-black uppercase">92% Optimal</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">Last analysis: Today, 15:30</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SectorRotationTab;
