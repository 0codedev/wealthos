import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, ReferenceLine
} from 'recharts';
import { Activity, Skull } from 'lucide-react';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';

interface TiltMeterProps {
    trades: Trade[];
    isVisible?: boolean;
}

const RADIAN = Math.PI / 180;

// (needle fn removed in Sprint 3.3 — replaced by CSS-transform needle that
//  anchors to the responsive gauge center instead of hardcoded pixels.)

export const TiltMeter = React.memo(({ trades, isVisible = true }: TiltMeterProps) => {
    const tiltStats = useMemo(() => {
        const emotionalStates = ['Anxious', 'Revenge', 'Greedy', 'Panic', 'Regret', 'Euphoric'];
        const total = trades.length;
        if (total === 0) return { score: 0, label: 'NO DATA', color: '#64748b', emotionalStreak: 0 };
        let tiltCount = 0;
        trades.forEach(t => {
            if (emotionalStates.includes(t.moodEntry) || emotionalStates.includes(t.moodExit)) {
                tiltCount++;
            }
        });
        const score = Math.min(100, Math.round((tiltCount / total) * 100));
        let label = 'ZEN MASTER';
        let color = '#10b981'; // Green
        if (score > 20) { label = 'FOCUSED'; color = '#34d399'; }
        if (score > 40) { label = 'DISTRACTED'; color = '#f59e0b'; }
        if (score > 60) { label = 'ON TILT'; color = '#f43f5e'; }
        if (score > 80) { label = 'RAGE TRADING'; color = '#ef4444'; }
        // Compute emotional streak (consecutive emotional trades from most recent)
        const sortedTrades = [...trades].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        let emotionalStreak = 0;
        for (const t of sortedTrades) {
            if (emotionalStates.includes(t.moodEntry) || emotionalStates.includes(t.moodExit)) {
                emotionalStreak++;
            } else {
                break;
            }
        }

        return { score, label, color, tiltCount, total, emotionalStreak };
    }, [trades]);

    const mistakeData = useMemo(() => {
        const map: Record<string, { cost: number, count: number }> = {};
        trades.forEach(t => {
            if ((t.pnl || 0) < 0 && t.mistakes && t.mistakes.length > 0) {
                t.mistakes.forEach(m => {
                    if (!map[m]) map[m] = { cost: 0, count: 0 };
                    map[m].count++;
                    map[m].cost += Math.abs(t.pnl || 0);
                });
            }
        });
        return Object.entries(map)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 6);
    }, [trades]);

    const tiltTrend = useMemo(() => {
        if (trades.length === 0) return [];
        const emotionalStates = ['Anxious', 'Revenge', 'Greedy', 'Panic', 'Regret', 'Euphoric'];
        const getWeek = (d: Date) => {
            const oneJan = new Date(d.getFullYear(), 0, 1);
            return Math.ceil((((d.getTime() - oneJan.getTime()) / 86400000) + oneJan.getDay() + 1) / 7);
        };
        const weekMap: Record<number, { emotional: number; total: number }> = {};
        trades.forEach(t => {
            const d = new Date(t.date);
            if (isNaN(d.getTime())) return;
            const week = getWeek(d);
            if (!weekMap[week]) weekMap[week] = { emotional: 0, total: 0 };
            weekMap[week].total++;
            if (emotionalStates.includes(t.moodEntry) || emotionalStates.includes(t.moodExit)) {
                weekMap[week].emotional++;
            }
        });
        return Object.entries(weekMap)
            .map(([week, stats]) => ({
                week: `W${week}`,
                score: stats.total > 0 ? Math.round((stats.emotional / stats.total) * 100) : 0,
                count: stats.total,
            }))
            .slice(-8);
    }, [trades]);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl flex flex-col items-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 opacity-50"></div>
                {tiltStats.emotionalStreak >= 3 && (
                    <div className="w-full mb-3 p-2 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 animate-pulse">
                        <Skull size={12} className="text-rose-500 shrink-0" />
                        <p className="text-[10px] font-black text-rose-400 uppercase tracking-wide">
                            {tiltStats.emotionalStreak} consecutive emotional trades
                        </p>
                    </div>
                )}
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Activity size={16} /> Tilt-O-Meter
                </h3>
                <div className="w-full h-48 relative flex justify-center" style={{ contain: 'layout' }}>
                    <SafeChartContainer>
                        <PieChart>
                            <Pie
                                dataKey="value"
                                startAngle={180}
                                endAngle={0}
                                data={[{ value: tiltStats.score }, { value: 100 - tiltStats.score }]}
                                cx="50%"
                                cy="85%"
                                innerRadius={50}
                                outerRadius={70}
                                paddingAngle={0}
                                stroke="none"
                                isAnimationActive={isVisible}
                            >
                            <Cell fill={tiltStats.color} />
                            <Cell fill="rgba(255,255,255,0.02)" />
                            </Pie>
                        </PieChart>
                    </SafeChartContainer>
                    {/* SPRINT 3.3 — CSS-transform needle anchored to the gauge's
                        true geometric center (left:50%, top:85% = the Pie's cy).
                        The old version called needle(score, 200, 220, ...) with
                        HARDCODED pixels, so on any viewport whose rendered center
                        differed, the needle floated outside the component. This
                        one rotates around its own base and always fits. */}
                    <div
                        className="absolute pointer-events-none"
                        style={{ left: '50%', top: '85%', transform: 'translate(-50%, -100%)' }}
                    >
                        <div
                            style={{
                                width: 3,
                                height: 56,
                                borderRadius: 3,
                                background: tiltStats.color,
                                transformOrigin: 'bottom center',
                                transform: `rotate(${tiltStats.score * 1.8 - 90}deg)`,
                                boxShadow: `0 0 12px ${tiltStats.color}55`,
                                transition: 'transform 600ms cubic-bezier(0.34, 1.3, 0.64, 1)'
                            }}
                        />
                    </div>
                    {/* Hub cap sitting exactly on the pivot */}
                    <div
                        className="absolute pointer-events-none rounded-full border-2 border-slate-950"
                        style={{
                            left: '50%', top: '85%', width: 14, height: 14,
                            transform: 'translate(-50%, -50%)',
                            background: tiltStats.color,
                            boxShadow: '0 0 10px rgba(0,0,0,0.4)'
                        }}
                    />
                    <div className="absolute bottom-10 flex flex-col items-center">
                        <h2 className="text-3xl font-black" style={{ color: tiltStats.color }}>{tiltStats.score}%</h2>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{tiltStats.label}</p>
                    </div>
                </div>

                {/* 8-Week Tilt Trend Sparkline */}
                {tiltTrend.length > 0 && (
                    <div className="w-full mt-4">
                        <div style={{ height: 60, contain: 'layout' }}>
                            <SafeChartContainer>
                                <LineChart data={tiltTrend} margin={{ top: 4, right: 4, left: -40, bottom: 0 }}>
                                    <YAxis domain={[0, 100]} hide />
                                    <XAxis dataKey="week" tick={{ fontSize: 8, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                    <Line
                                        type="monotone"
                                        dataKey="score"
                                        stroke={tiltStats.color}
                                        strokeWidth={2}
                                        dot={{ r: 2, fill: tiltStats.color }}
                                        isAnimationActive={isVisible}
                                    />
                                    <ReferenceLine y={50} stroke="#334155" strokeDasharray="2 2" />
                                </LineChart>
                            </SafeChartContainer>
                        </div>
                        <p className="text-[9px] text-slate-600 text-center mt-1 uppercase tracking-widest">8-Week Tilt Trend</p>
                    </div>
                )}

                <div className="w-full mt-4 p-3 bg-slate-900/50 rounded-xl text-center border border-white/5">
                    <p className="text-xs text-slate-500 mb-1">Impact Analysis</p>
                    <p className="text-sm font-medium text-slate-300">
                        You trade <span className="font-bold text-white">{tiltStats.score > 50 ? 'WORSE' : 'BETTER'}</span> when emotional.
                    </p>
                </div>
            </div>

            <div className="md:col-span-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Skull size={16} className="text-rose-500" /> The Cost of Errors
                    </h3>
                    <span className="text-xs text-rose-500 font-bold bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded">
                        Total Waste: {formatCurrency(mistakeData.reduce((a, b) => a + b.cost, 0))}
                    </span>
                </div>
                {mistakeData.length === 0 ? (
                    <div className="h-48 flex items-center justify-center text-slate-500 text-sm italic border border-dashed border-white/10 rounded-xl">
                        No mistakes logged yet. Good job!
                    </div>
                ) : (
                    <div className="space-y-3">
                        {(() => {
                            const maxCost = mistakeData.length > 0 ? mistakeData[0].cost : 1;
                            return mistakeData.map((m) => (
                                <div key={m.name} className="relative group">
                                    <div className="flex items-center justify-between text-sm relative z-10 mb-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-200">{m.name}</span>
                                            <span className="text-xs text-slate-500">({m.count}x)</span>
                                        </div>
                                        <span className="font-mono font-bold text-rose-500">-{formatCurrency(m.cost)}</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                        Avg: {formatCurrency(m.cost / m.count)}/occurrence
                                    </p>
                                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mt-1">
                                        <div
                                            className="h-full rounded-full"
                                            style={{
                                                width: `${Math.max((m.cost / maxCost) * 100, 2)}%`,
                                                background: `linear-gradient(90deg, rgba(244,63,94,0.4) 0%, #f43f5e ${Math.max((m.cost / maxCost) * 100, 2)}%)`
                                            }}
                                        ></div>
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
});
