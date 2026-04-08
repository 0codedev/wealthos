import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, Cell, ReferenceLine
} from 'recharts';
import {
    Skull, Shield, AlertTriangle, TrendingDown, ArrowRight,
    Activity, Zap, ChevronDown, ChevronUp, Heart
} from 'lucide-react';
import { Investment } from '../../../types';
import {
    BLACK_SWAN_EVENTS, calculateRecoveryPath,
    type BlackSwanEvent
} from '../../../utils/MonteCarlo';
import { formatCurrency } from '../../../utils/helpers';

interface BlackSwanWarRoomProps {
    investments: Investment[];
    totalCurrentValue: number;
    totalInvested: number;
    isPrivacyMode?: boolean;
}

// Asset type impact multipliers during crash
const CRASH_MULTIPLIERS: Record<string, number> = {
    'Stocks': 1.0,
    'Mutual Fund': 0.85,
    'ETF': 0.90,
    'Crypto': 1.4,
    'Digital Gold': -0.3,       // Gold usually rises
    'Digital Silver': -0.2,
    'Fixed Deposit': 0.02,      // Minimal impact
    'Smallcase': 0.9,
    'Real Estate': 0.6,
    'Cash/Bank': 0.0,           // No impact
    'IPO': 0.95,
    'Trading Alpha': 1.0,
};

interface HoldingImpact {
    name: string;
    ticker: string;
    currentValue: number;
    projectedLoss: number;
    postCrashValue: number;
    multiplier: number;
    type: string;
}

const CRASH_EMOJIS: Record<string, string> = {
    '2008 Financial Crisis': '🏦',
    'COVID-19 Crash': '🦠',
    'Tech Bubble Burst': '💻',
    'Currency Crisis': '💱',
    'Hyperinflation': '📈',
    '1997 Asian Financial Crisis': '🌏',
    'Eurozone Debt Crisis (2011)': '🇪🇺',
    'Flash Crash (2010)': '⚡',
    'Geopolitical Shock (War)': '⚔️',
};

const BlackSwanWarRoom: React.FC<BlackSwanWarRoomProps> = ({
    investments,
    totalCurrentValue,
    totalInvested,
    isPrivacyMode = false,
}) => {
    const [selectedEvent, setSelectedEvent] = useState<BlackSwanEvent>(BLACK_SWAN_EVENTS[0]);
    const [showAllHoldings, setShowAllHoldings] = useState(false);
    const [monthlySIP, setMonthlySIP] = useState(25000);

    // Calculate per-holding impact
    const holdingImpacts = useMemo((): HoldingImpact[] => {
        return investments
            .filter(inv => inv.currentValue > 0)
            .map(inv => {
                const multiplier = CRASH_MULTIPLIERS[inv.type] || 0.5;
                const impactOnThis = selectedEvent.impact * multiplier;
                const projectedLoss = inv.currentValue * Math.abs(impactOnThis);
                const postCrashValue = Math.max(0, inv.currentValue + inv.currentValue * impactOnThis);

                return {
                    name: inv.name,
                    ticker: inv.ticker || inv.name.substring(0, 4).toUpperCase(),
                    currentValue: inv.currentValue,
                    projectedLoss,
                    postCrashValue,
                    multiplier,
                    type: inv.type,
                };
            })
            .sort((a, b) => b.projectedLoss - a.projectedLoss);
    }, [investments, selectedEvent]);

    // Total projected loss
    const totalProjectedLoss = useMemo(() =>
        holdingImpacts.reduce((sum, h) => sum + h.projectedLoss, 0),
        [holdingImpacts]
    );

    const postCrashTotal = totalCurrentValue - totalProjectedLoss;

    // Survival Score (0-100)
    const survivalScore = useMemo(() => {
        let score = 50; // Base

        // Diversification bonus (unique types)
        const uniqueTypes = new Set(investments.map(i => i.type)).size;
        score += Math.min(20, uniqueTypes * 3);

        // Gold/FD hedge bonus
        const hedgeValue = investments
            .filter(i => (['Digital Gold', 'Digital Silver', 'Fixed Deposit', 'Cash/Bank'] as string[]).includes(i.type))
            .reduce((sum, i) => sum + i.currentValue, 0);
        const hedgeRatio = totalCurrentValue > 0 ? hedgeValue / totalCurrentValue : 0;
        score += Math.min(20, hedgeRatio * 60);

        // Concentration penalty
        const maxHolding = investments.length > 0 ? Math.max(...investments.map(i => i.currentValue)) : 0;
        const concentrationRatio = totalCurrentValue > 0 ? maxHolding / totalCurrentValue : 0;
        if (concentrationRatio > 0.4) score -= 15;
        else if (concentrationRatio > 0.25) score -= 5;

        // Crash severity penalty
        score += selectedEvent.impact * 10; // Harsher crashes = lower score

        return Math.max(0, Math.min(100, Math.round(score)));
    }, [investments, totalCurrentValue, selectedEvent]);

    // Recovery path
    const recoveryPath = useMemo(() => {
        if (postCrashTotal <= 0) return [];
        return calculateRecoveryPath(postCrashTotal, monthlySIP, selectedEvent, 10);
    }, [postCrashTotal, monthlySIP, selectedEvent]);

    // Recovery chart data
    const recoveryChartData = useMemo(() => {
        return recoveryPath.map(yp => ({
            year: `Y${yp.year}`,
            pessimistic: Math.round(yp.p10),
            median: Math.round(yp.p50),
            optimistic: Math.round(yp.p90),
        }));
    }, [recoveryPath]);

    // Impact chart data
    const impactChartData = useMemo(() => {
        return holdingImpacts.slice(0, 8).map(h => ({
            name: h.ticker,
            loss: -Math.round(h.projectedLoss),
            type: h.type,
        }));
    }, [holdingImpacts]);

    // Recommendations
    const recommendations = useMemo(() => {
        const recs: { icon: string; text: string; priority: 'high' | 'medium' | 'low' }[] = [];

        const hedgeValue = investments
            .filter(i => (['Digital Gold', 'Digital Silver', 'Fixed Deposit', 'Cash/Bank'] as string[]).includes(i.type))
            .reduce((sum, i) => sum + i.currentValue, 0);
        const hedgeRatio = totalCurrentValue > 0 ? hedgeValue / totalCurrentValue : 0;

        if (hedgeRatio < 0.15) {
            recs.push({ icon: '🛡️', text: 'Add gold/debt hedge (only ' + Math.round(hedgeRatio * 100) + '% hedged)', priority: 'high' });
        }

        const maxHolding = investments.reduce((max, i) => i.currentValue > max.currentValue ? i : max, investments[0]);
        if (maxHolding && totalCurrentValue > 0 && maxHolding.currentValue / totalCurrentValue > 0.3) {
            recs.push({ icon: '⚠️', text: `Reduce concentration in ${maxHolding.name} (${Math.round(maxHolding.currentValue / totalCurrentValue * 100)}% of portfolio)`, priority: 'high' });
        }

        const cryptoValue = investments.filter(i => (i.type as string) === 'Crypto').reduce((sum, i) => sum + i.currentValue, 0);
        if (totalCurrentValue > 0 && cryptoValue / totalCurrentValue > 0.10) {
            recs.push({ icon: '₿', text: 'Crypto exposure above 10% — extreme crash vulnerability', priority: 'medium' });
        }

        if (monthlySIP > 0) {
            recs.push({ icon: '💰', text: `Continue ₹${monthlySIP.toLocaleString()} SIP — accelerates recovery by ${Math.round(selectedEvent.recoveryYears * 0.3)} years`, priority: 'low' });
        }

        if (recs.length === 0) {
            recs.push({ icon: '✨', text: 'Portfolio is well-hedged — strong crash resilience!', priority: 'low' });
        }

        return recs;
    }, [investments, totalCurrentValue, monthlySIP, selectedEvent]);

    const scoreColor = survivalScore >= 70 ? 'text-emerald-400' : survivalScore >= 40 ? 'text-amber-400' : 'text-red-400';
    const scoreLabel = survivalScore >= 70 ? 'Strong' : survivalScore >= 40 ? 'Moderate' : 'Vulnerable';

    const displayedHoldings = showAllHoldings ? holdingImpacts : holdingImpacts.slice(0, 5);

    return (
        <div className="glass-card p-5 rounded-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-red-500/20 to-orange-500/20">
                        <Skull className="w-5 h-5 text-red-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white">Black Swan War Room</h3>
                        <p className="text-[10px] text-white/40">Stress-test your portfolio</p>
                    </div>
                </div>
                {/* Survival Score Badge */}
                <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-1.5">
                    <Shield className={`w-4 h-4 ${scoreColor}`} />
                    <div className="text-right">
                        <div className={`text-sm font-black ${scoreColor}`}>{survivalScore}</div>
                        <div className="text-[9px] text-white/40">{scoreLabel}</div>
                    </div>
                </div>
            </div>

            {/* Event Selector — Horizontal scrolling cards */}
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                {BLACK_SWAN_EVENTS.map(event => {
                    const isActive = selectedEvent.name === event.name;
                    return (
                        <button
                            key={event.name}
                            onClick={() => setSelectedEvent(event)}
                            className={`flex-shrink-0 rounded-xl px-3 py-2 text-left transition-all border ${isActive
                                ? 'bg-red-500/15 border-red-500/30 shadow-lg shadow-red-500/5'
                                : 'bg-white/5 border-white/5 hover:bg-white/10'
                                }`}
                        >
                            <div className="text-sm">{CRASH_EMOJIS[event.name] || '📉'}</div>
                            <div className="text-[10px] font-medium text-white/70 mt-0.5 whitespace-nowrap">
                                {event.name.length > 18 ? event.name.substring(0, 18) + '…' : event.name}
                            </div>
                            <div className="text-[10px] font-bold text-red-400">{(event.impact * 100).toFixed(0)}%</div>
                        </button>
                    );
                })}
            </div>

            {/* Impact Summary */}
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-red-500/10 rounded-xl p-3 text-center border border-red-500/10">
                    <div className="text-[10px] text-white/40 mb-1">Projected Loss</div>
                    <div className="text-sm font-black text-red-400">
                        {isPrivacyMode ? '•••' : `-${formatCurrency(totalProjectedLoss)}`}
                    </div>
                </div>
                <div className="bg-amber-500/10 rounded-xl p-3 text-center border border-amber-500/10">
                    <div className="text-[10px] text-white/40 mb-1">Post-Crash Value</div>
                    <div className="text-sm font-bold text-amber-400">
                        {isPrivacyMode ? '•••' : formatCurrency(postCrashTotal)}
                    </div>
                </div>
                <div className="bg-blue-500/10 rounded-xl p-3 text-center border border-blue-500/10">
                    <div className="text-[10px] text-white/40 mb-1">Recovery Time</div>
                    <div className="text-sm font-bold text-blue-400">
                        ~{selectedEvent.recoveryYears < 1
                            ? `${Math.round(selectedEvent.recoveryYears * 12)}mo`
                            : `${selectedEvent.recoveryYears}yr`
                        }
                    </div>
                </div>
            </div>

            {/* Per-Holding Impact Table */}
            <div>
                <div className="text-[10px] font-bold text-white/40 uppercase mb-2 flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" /> Holding-Level Damage
                </div>
                <div className="space-y-1">
                    {displayedHoldings.map(h => {
                        const lossPct = h.currentValue > 0 ? (h.projectedLoss / h.currentValue * 100) : 0;
                        return (
                            <div key={h.name} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-white truncate">{h.ticker}</div>
                                    <div className="text-[9px] text-white/30">{h.type}</div>
                                </div>
                                {!isPrivacyMode && (
                                    <>
                                        <div className="text-xs text-white/50 w-20 text-right">
                                            {formatCurrency(h.currentValue)}
                                        </div>
                                        <ArrowRight className="w-3 h-3 text-white/20" />
                                        <div className="text-xs font-bold text-red-400 w-20 text-right">
                                            -{formatCurrency(h.projectedLoss)}
                                        </div>
                                    </>
                                )}
                                {/* Impact bar */}
                                <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${h.multiplier < 0 ? 'bg-emerald-500' : lossPct > 40 ? 'bg-red-500' : lossPct > 20 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                        style={{ width: `${Math.min(100, Math.abs(lossPct))}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
                {holdingImpacts.length > 5 && (
                    <button
                        onClick={() => setShowAllHoldings(!showAllHoldings)}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-2 flex items-center gap-1"
                    >
                        {showAllHoldings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {showAllHoldings ? 'Show less' : `Show all ${holdingImpacts.length} holdings`}
                    </button>
                )}
            </div>

            {/* Recovery Timeline Chart */}
            {recoveryChartData.length > 1 && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] font-bold text-white/40 uppercase flex items-center gap-1">
                            <Activity className="w-3 h-3" /> Recovery Timeline
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] text-white/30">Monthly SIP:</span>
                            <select
                                value={monthlySIP}
                                onChange={e => setMonthlySIP(Number(e.target.value))}
                                className="text-[10px] bg-white/5 border border-white/10 rounded-md px-2 py-0.5 text-white outline-none"
                            >
                                <option value={10000}>₹10K</option>
                                <option value={25000}>₹25K</option>
                                <option value={50000}>₹50K</option>
                                <option value={100000}>₹1L</option>
                            </select>
                        </div>
                    </div>
                    <div className="h-36">
                        <SafeChartContainer>
                            <AreaChart data={recoveryChartData}>
                                <defs>
                                    <linearGradient id="recoveryGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                                        <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="year" tick={{ fill: '#ffffff40', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: '#ffffff30', fontSize: 9 }} axisLine={false} tickLine={false}
                                    tickFormatter={v => isPrivacyMode ? '•••' : `₹${(v / 100000).toFixed(0)}L`}
                                    width={45}
                                />
                                <Tooltip
                                    contentStyle={{
                                        background: 'rgba(15,15,30,0.95)',
                                        border: '1px solid rgba(34,197,94,0.3)',
                                        borderRadius: '12px',
                                        fontSize: '11px',
                                        color: '#fff'
                                    }}
                                    formatter={(value: number | string | Array<number | string> | undefined, name?: string) => [
                                        isPrivacyMode ? '•••' : formatCurrency(Number(value ?? 0)),
                                        name === 'median' ? 'Expected' : name === 'optimistic' ? 'Best Case' : 'Worst Case'
                                    ]}
                                />
                                {!isPrivacyMode && (
                                    <ReferenceLine y={totalCurrentValue} stroke="#ffffff20" strokeDasharray="3 3" label={{ value: 'Pre-crash', fill: '#ffffff30', fontSize: 9 }} />
                                )}
                                <Area type="monotone" dataKey="pessimistic" stroke="#ef4444" strokeWidth={1} fill="none" strokeDasharray="3 3" />
                                <Area type="monotone" dataKey="median" stroke="#22c55e" strokeWidth={2} fill="url(#recoveryGrad)" />
                                <Area type="monotone" dataKey="optimistic" stroke="#3b82f6" strokeWidth={1} fill="none" strokeDasharray="3 3" />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                    {/* Legend */}
                    <div className="flex justify-center gap-4 mt-1">
                        <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-red-500 rounded" style={{ borderStyle: 'dashed' }} /><span className="text-[9px] text-white/30">Worst</span></div>
                        <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-emerald-500 rounded" /><span className="text-[9px] text-white/30">Expected</span></div>
                        <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-blue-500 rounded" style={{ borderStyle: 'dashed' }} /><span className="text-[9px] text-white/30">Best</span></div>
                    </div>
                </div>
            )}

            {/* Recommendations */}
            <div>
                <div className="text-[10px] font-bold text-white/40 uppercase mb-2 flex items-center gap-1">
                    <Heart className="w-3 h-3" /> Action Items
                </div>
                <div className="space-y-1.5">
                    {recommendations.map((rec, i) => (
                        <div
                            key={i}
                            className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] ${rec.priority === 'high'
                                ? 'bg-red-500/10 border border-red-500/10 text-red-300'
                                : rec.priority === 'medium'
                                    ? 'bg-amber-500/10 border border-amber-500/10 text-amber-300'
                                    : 'bg-white/5 border border-white/5 text-white/60'
                                }`}
                        >
                            <span className="text-sm flex-shrink-0">{rec.icon}</span>
                            <span>{rec.text}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-2 bg-white/5 rounded-xl p-3">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400/50 mt-0.5 flex-shrink-0" />
                <p className="text-[9px] text-white/30 leading-relaxed">
                    Simulations use historical crash data and asset-class correlation estimates.
                    Actual performance may vary. Recovery paths use Monte Carlo simulations (~1000 iterations).
                </p>
            </div>
        </div>
    );
};

export default React.memo(BlackSwanWarRoom);
