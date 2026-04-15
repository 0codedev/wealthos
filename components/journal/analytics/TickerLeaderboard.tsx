import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid, ReferenceLine
} from 'recharts';
import { Award, Zap, TrendingUp, TrendingDown, Target } from 'lucide-react';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { CustomTooltip } from '../../shared/CustomTooltip';

interface TickerLeaderboardProps {
    trades: Trade[];
    isVisible?: boolean;
}

export const TickerLeaderboard = React.memo(({ trades, isVisible = true }: TickerLeaderboardProps) => {
    const data = useMemo(() => {
        const map: Record<string, { pnl: number; count: number; win: number }> = {};

        trades.forEach(t => {
            const ticker = t.ticker.toUpperCase();
            if (!map[ticker]) map[ticker] = { pnl: 0, count: 0, win: 0 };
            
            const pnl = t.pnl || 0;
            map[ticker].pnl += pnl;
            map[ticker].count++;
            if (pnl > 0) map[ticker].win++;
        });

        const sorted = Object.entries(map).map(([ticker, stats]) => ({
            ticker,
            pnl: stats.pnl,
            winRate: stats.count > 0 ? (stats.win / stats.count) * 100 : 0,
            count: stats.count
        })).sort((a, b) => b.pnl - a.pnl);

        // Top 3 and Bottom 3 (if different)
        let displayData = [];
        if (sorted.length <= 6) {
            displayData = sorted;
        } else {
            const top3 = sorted.slice(0, 3);
            const bottom3 = sorted.slice(-3);
            displayData = [...top3, ...bottom3].sort((a, b) => b.pnl - a.pnl);
        }

        return displayData;
    }, [trades]);

    if (!data || data.length === 0) return null;

    return (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl w-full h-full flex flex-col overflow-hidden">
            <div className="flex justify-between items-start mb-6 shrink-0">
                <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Award size={16} className="text-amber-500" /> Ticker Leaderboard
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Cash Cows vs Capital Bleeds</p>
                </div>
            </div>
            
            <div className="flex-1 w-full min-h-[200px]" style={{ contain: 'layout' }}>
                <SafeChartContainer>
                    <BarChart layout="vertical" data={data} margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#334155" opacity={0.3} />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="ticker" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#cbd5e1', fontWeight: 'bold' }} width={80} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                        <ReferenceLine x={0} stroke="#64748b" strokeDasharray="3 3" opacity={0.5} />
                        <Bar dataKey="pnl" name="Total PnL" radius={[0, 4, 4, 0]} isAnimationActive={isVisible}>
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                            ))}
                        </Bar>
                    </BarChart>
                </SafeChartContainer>
            </div>
        </div>
    );
});
