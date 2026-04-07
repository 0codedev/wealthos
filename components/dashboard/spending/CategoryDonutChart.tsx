import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { CursorFollowTooltip } from '../../shared/CursorFollowTooltip';
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { useTransactions } from '../../../contexts/TransactionContext';

interface CategoryDonutChartProps {
    formatCurrency: (val: number) => string;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const CategoryDonutChartBase: React.FC<CategoryDonutChartProps> = ({ formatCurrency }) => {
    const { spendingByCategory } = useTransactions();

    const data = useMemo(() => {
        // spendingByCategory is already sorted by amount usually, but let's take top 6 and group others
        if (spendingByCategory.length === 0) return [];

        const top = spendingByCategory.slice(0, 6);
        const others = spendingByCategory.slice(6);

        const result = top.map(c => ({ name: c.category, value: c.amount }));

        if (others.length > 0) {
            const otherTotal = others.reduce((sum, c) => sum + c.amount, 0);
            result.push({ name: 'Others', value: otherTotal });
        }

        return result;
    }, [spendingByCategory]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 md:p-6 border border-slate-200 dark:border-slate-800 h-[400px] flex flex-col">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Category Breakdown</h3>
            <div className="flex-1 min-h-[300px]">
                <SafeChartContainer>
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                            strokeWidth={2}
                            stroke="none"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            content={<CursorFollowTooltip formatter={(value: any) => formatCurrency(Number(value))} />}
                            isAnimationActive={false}
                        />
                        <Legend
                            verticalAlign="bottom"
                            height={36}
                            iconType="circle"
                            formatter={(value) => <span className="text-xs font-medium text-slate-500 ml-1">{value}</span>}
                        />
                    </PieChart>
                </SafeChartContainer>
            </div>
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export const CategoryDonutChart = React.memo(CategoryDonutChartBase);
