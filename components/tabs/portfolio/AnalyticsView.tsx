import React, { useMemo } from 'react';
import { Investment, CHART_COLORS, InvestmentType } from '../../../types';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Globe, Briefcase, Tag, TrendingDown, AlertTriangle, Zap } from 'lucide-react';
import { usePageVisibility } from '../../../contexts/PageVisibilityContext';
import { ConcentrationAlerts } from '../../portfolio/ConcentrationAlerts';
import { RiskEngine } from '../../../services/RiskEngine';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { RiskIntelligence } from './RiskIntelligence';
import { PortfolioActionPanel } from '../../portfolio/PortfolioActionPanel';
import { EmptyState } from '../../shared/EmptyState';
import { PortfolioActionProposal } from '../../../services/PortfolioActionService';
import { useLiteModeStore } from '../../../store/liteModeStore';

interface AnalyticsViewProps {
    investments: Investment[];
    formatCurrency: (val: number) => string;
    isPrivacyMode: boolean;
    focusCategory?: 'rebalance' | 'deploy-cash' | 'trim' | 'tax-harvest' | null;
    onFollowUp?: (proposal: PortfolioActionProposal) => void;
}

// Smart Sector Keyword Mapper
const inferSector = (name: string, type: InvestmentType, currentSector?: string): string => {
    if (currentSector && currentSector !== 'Unclassified') return currentSector;

    const n = name.toLowerCase();

    // 1. Check Investment Type first
    if (type === InvestmentType.CRYPTO) return 'Crypto';
    if (type === InvestmentType.DIGITAL_GOLD || type === InvestmentType.DIGITAL_SILVER) return 'Commodities';
    if (type === InvestmentType.REAL_ESTATE) return 'Real Estate';
    if (type === InvestmentType.FD) return 'Lending/Debt';

    // 2. Keyword Matching for Stocks/MFs
    if (n.includes('tech') || n.includes('infosys') || n.includes('tcs') || n.includes('wipro') || n.includes('hcl') || n.includes('digital') || n.includes('soft') || n.includes('s&p 500')) return 'Technology';
    if (n.includes('bank') || n.includes('finance') || n.includes('hdfc') || n.includes('kotak') || n.includes('axis') || n.includes('bajaj') || n.includes('icici') || n.includes('sbi') || n.includes('fund')) return 'Financials';
    if (n.includes('pharma') || n.includes('health') || n.includes('dr redox') || n.includes('sun') || n.includes('cipla') || n.includes('apollo')) return 'Healthcare';
    if (n.includes('auto') || n.includes('tata motor') || n.includes('maruti') || n.includes('mahindra') || n.includes('eicher')) return 'Automotive';
    if (n.includes('energy') || n.includes('power') || n.includes('adani') || n.includes('reliance') || n.includes('ntpc') || n.includes('coal')) return 'Energy';
    if (n.includes('consumer') || n.includes('itc') || n.includes('hul') || n.includes('nestle') || n.includes('titan') || n.includes('asian paints')) return 'Consumer Goods';
    if (n.includes('infra') || n.includes('l&t') || n.includes('ultratech') || n.includes('dlf')) return 'Infrastructure';
    if (n.includes('nifty') || n.includes('sensex') || n.includes('index') || n.includes('etf')) return 'Diversified (Index)';

    return 'Other';
};

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ investments, formatCurrency, isPrivacyMode, focusCategory = null, onFollowUp }) => {
    const isVisible = usePageVisibility();
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    // Instantiate Risk Engine (Memoized)
    const riskEngine = useMemo(() => new RiskEngine(), []);
    const totalAssets = useMemo(() => investments.reduce((sum, inv) => sum + inv.currentValue, 0), [investments]);

    // Group by Sector (with Smart Inference)
    const sectorData = useMemo(() => {
        const groups: Record<string, number> = {};
        investments.forEach(inv => {
            const sector = inferSector(inv.name, inv.type, inv.sector);
            groups[sector] = (groups[sector] || 0) + inv.currentValue;
        });
        return Object.entries(groups)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [investments]);

    // Group by Country
    const countryData = useMemo(() => {
        const groups: Record<string, number> = {};
        investments.forEach(inv => {
            const country = inv.country || 'Unknown';
            groups[country] = (groups[country] || 0) + inv.currentValue;
        });
        return Object.entries(groups)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [investments]);

    // Group by Tags
    const tagData = useMemo(() => {
        const groups: Record<string, number> = {};
        investments.forEach(inv => {
            if (inv.tags && inv.tags.length > 0) {
                inv.tags.forEach(tag => {
                    groups[tag] = (groups[tag] || 0) + inv.currentValue;
                });
            } else {
                groups['No Tags'] = (groups['No Tags'] || 0) + inv.currentValue;
            }
        });
        return Object.entries(groups)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [investments]);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-white p-2.5 rounded-xl text-xs shadow-xl border border-slate-200 dark:border-slate-700 backdrop-blur-md">
                    <p className="font-bold mb-1">{payload[0].name}</p>
                    <p className="font-mono font-black">{isPrivacyMode ? '••••••' : formatCurrency(payload[0].value)}</p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-16">
            {isLiteMode && (
                <div className="md:col-span-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3">
                    <Zap size={16} className="text-amber-500" />
                    <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">
                        Lite Mode Active — Throttling visualization layers
                    </p>
                </div>
            )}

            {/* RISK INTELLIGENCE CENTER - AI Layer */}
            {!isLiteMode && (
                <div className="md:col-span-2">
                    <RiskIntelligence investments={investments} totalNetWorth={totalAssets} riskEngine={riskEngine} />
                </div>
            )}

            <div className="md:col-span-2">
                <PortfolioActionPanel investments={investments} formatCurrency={formatCurrency} isPrivacyMode={isPrivacyMode} focusCategory={focusCategory} onFollowUp={onFollowUp} />
            </div>

            {/* CONCENTRATION RISK ALERTS - P0 Enhancement */}
            <div className="md:col-span-2 relative overflow-hidden bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-800">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-r from-rose-500/10 via-transparent to-indigo-500/10" />
                <ConcentrationAlerts investments={investments} threshold={20} />
            </div>

            {/* SECTOR BREAKDOWN */}
            <div className="relative overflow-hidden bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-800">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-r from-indigo-500/10 to-transparent" />
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-xl text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                        <Briefcase size={20} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">Sector Allocation</h3>
                </div>

                {!isLiteMode ? (
                    <div className="h-[250px] w-full">
                        <SafeChartContainer height={250}>
                            <PieChart>
                                <Pie
                                    data={sectorData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    paddingAngle={2}
                                    dataKey="value"
                                    isAnimationActive={isVisible}
                                >
                                    {sectorData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="none" />
                                    ))}
                                </Pie>
                                <Tooltip content={<CustomTooltip />} cursor={false} />
                            </PieChart>
                        </SafeChartContainer>
                    </div>
                ) : (
                    <div className="h-[150px] flex items-center justify-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl mb-4 bg-slate-50/50 dark:bg-transparent">
                        <p className="text-xs text-slate-500 uppercase font-black tracking-widest">Chart Paused in Lite Mode</p>
                    </div>
                )}

                <div className="mt-6 grid grid-cols-2 gap-3">
                    {sectorData.slice(0, 6).map((entry, index) => (
                        <div key={index} className="flex items-center gap-2.5 text-xs">
                            <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}></span>
                            <span className="text-slate-600 dark:text-slate-400 truncate flex-1 font-medium">{entry.name}</span>
                            <span className="font-mono font-black text-slate-900 dark:text-slate-200">
                                {totalAssets > 0 ? ((entry.value / totalAssets) * 100).toFixed(0) : '0'}%
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* COUNTRY EXPOSURE */}
            <div className="relative overflow-hidden bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-800">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-r from-emerald-500/10 to-transparent" />
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/50">
                        <Globe size={20} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">Geographic Exposure</h3>
                </div>

                {!isLiteMode ? (
                    <div className="h-[250px] w-full">
                        <SafeChartContainer height={250}>
                            <BarChart data={countryData} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" opacity={0.1} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={72} tick={{ fontSize: 10, fill: 'currentColor' }} stroke="none" className="text-slate-400 dark:text-slate-600 font-bold" />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(16,185,129,0.05)' }} />
                                <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={isVisible} />
                            </BarChart>
                        </SafeChartContainer>
                    </div>
                ) : (
                    <div className="h-[150px] flex items-center justify-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-transparent">
                        <p className="text-xs text-slate-500 uppercase font-black tracking-widest">Chart Paused in Lite Mode</p>
                    </div>
                )}
            </div>

            {/* TAG CLOUD */}
            <div className="md:col-span-2 relative overflow-hidden bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-800">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-r from-amber-500/10 to-transparent" />
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-amber-500/10 dark:bg-amber-500/20 rounded-xl text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800/50">
                        <Tag size={20} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">Investment Tags</h3>
                </div>

                <div className="flex flex-wrap gap-3">
                    {tagData.map((tag, i) => (
                        <div key={i} className="group relative px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 transition-all cursor-default shadow-inner">
                            <div className="text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest mb-1">{tag.name}</div>
                            <div className="text-sm font-black text-slate-900 dark:text-white font-mono">
                                {isPrivacyMode ? '••••••' : formatCurrency(tag.value)}
                            </div>
                        </div>
                    ))}
                    {tagData.length === 0 && (
                        <EmptyState
                            variant="minimal"
                            type="no-data"
                            message="No tags found. Edit assets to add tags."
                        />
                    )}
                </div>
            </div>

            {/* TAX HARVEST OPPORTUNITIES */}
            <div className="md:col-span-2 relative overflow-hidden bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-slate-200 dark:border-slate-800">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-r from-rose-500/10 to-transparent" />
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-rose-500/10 dark:bg-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-800/50">
                        <TrendingDown size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">Tax Harvesting Opportunities</h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Unrealized losses that can be realized to offset current capital gains liability.</p>
                    </div>
                </div>

                <div className="overflow-hidden">
                    {investments.filter(i => i.currentValue < i.investedAmount).length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {investments
                                .filter(i => i.currentValue < i.investedAmount)
                                .sort((a, b) => (a.currentValue - a.investedAmount) - (b.currentValue - b.investedAmount))
                                .map(inv => (
                                    <div key={inv.id} className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-inner group hover:border-rose-500/30 transition-colors">
                                        <div>
                                            <p className="font-black text-slate-900 dark:text-white text-sm tracking-tight">{inv.name}</p>
                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">{inv.type}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black text-sm text-rose-600 dark:text-rose-400 font-mono">
                                                {isPrivacyMode ? '••••••' : formatCurrency(inv.currentValue - inv.investedAmount)}
                                            </p>
                                            <p className="text-[10px] font-black font-mono text-rose-500/70">
                                                {inv.investedAmount > 0 ? (((inv.currentValue - inv.investedAmount) / inv.investedAmount) * 100).toFixed(1) : '0.0'}%
                                            </p>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    ) : (
                        <div className="rounded-[24px] border border-emerald-200 dark:border-emerald-500/20 bg-gradient-to-r from-emerald-50 to-white dark:from-emerald-950/20 dark:to-slate-950 p-6 text-center shadow-inner">
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">No significant harvest opportunities found.</p>
                            <p className="mt-2 text-xs text-emerald-600/80 dark:text-emerald-500/60 max-w-lg mx-auto leading-relaxed">This side of the book looks clean right now, so you can stay focused on allocation, execution, or journal quality instead.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
