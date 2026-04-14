import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend
} from 'recharts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { CustomTooltip } from '../../shared/CustomTooltip';

interface AssetClassDistributionProps {
    trades: Trade[];
    isVisible?: boolean;
}

export const AssetClassDistribution = React.memo(({ trades, isVisible = true }: AssetClassDistributionProps) => {
    const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];

    const data = useMemo(() => {
        const map: Record<string, { pnl: number; count: number }> = {};
        
        trades.forEach(t => {
            const assetClass = t.assetClass || 'Equity'; // Default to equity if not set
            if (!map[assetClass]) map[assetClass] = { pnl: 0, count: 0 };
            
            map[assetClass].pnl += (t.pnl || 0);
            map[assetClass].count++;
        });

        // For donut chart we just want counts usually, but let's do PnL (only positive to avoid chart breaking, or just count)
        // Let's visualize Volume (count)
        return Object.entries(map).map(([name, stats]) => ({
            name,
            value: stats.count,
            pnl: stats.pnl
        })).sort((a, b) => b.value - a.value);

    }, [trades]);

    if (!data || data.length === 0) return null;

    return (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl w-full h-full flex flex-col overflow-hidden">
            <div className="flex justify-between items-start mb-6 shrink-0">
                <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <PieChartIcon size={16} className="text-pink-500" /> Asset Distribution
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Trade Volume by Segment</p>
                </div>
            </div>
            
            <div className="flex-1 w-full min-h-[200px]" style={{ contain: 'layout' }}>
                <SafeChartContainer>
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                            isAnimationActive={isVisible}
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <RechartsTooltip content={<CustomTooltip />} />
                        <Legend 
                            verticalAlign="bottom" 
                            height={36} 
                            iconType="circle" 
                            formatter={(value, entry, index) => <span className="text-xs text-slate-300 font-bold">{value}</span>}
                        />
                    </PieChart>
                </SafeChartContainer>
            </div>
        </div>
    );
});
