import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { motion } from 'framer-motion';
import { 
    PieChart, 
    Pie, 
    Cell 
} from 'recharts';
import { Brain, ArrowUpRight } from 'lucide-react';
import { financialOracleService, OracleResult } from '../../services/FinancialOracleService';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useNavigate } from 'react-router-dom';

const GAUGE_DATA = [
    { name: 'Critical', value: 20, color: '#ef4444' },
    { name: 'Survival', value: 20, color: '#f59e0b' },
    { name: 'Comfortable', value: 20, color: '#eab308' },
    { name: 'Affluent', value: 20, color: '#2dd4bf' },
    { name: 'Generational', value: 20, color: '#fbbf24' }
];

export const WealthDestinyGauge: React.FC = () => {
    const investments = usePortfolioStore(s => s.investments);
    const navigate = useNavigate();
    const [result, setResult] = useState<OracleResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchResult = async () => {
            try {
                const res = await financialOracleService.runOracle(
                    investments,
                    50000,
                    20,
                    100000000,
                    []
                );
                setResult(res);
            } catch (err) {
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchResult();
    }, [investments]);

    // Map P50 result to gauge value (0-100)
    // 0 Cr = 0, 10 Cr = 100
    const p50Cr = (result?.baseline.percentiles.p50 || 0) / 10000000;
    const gaugeValue = Math.min(100, (p50Cr / 10) * 100);

    const needleRotation = -90 + (gaugeValue * 1.8); // -90 to 90 degrees

    return (
        <motion.div 
            whileHover={{ y: -4 }}
            onClick={() => navigate('/oracle')}
            className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl cursor-pointer group relative overflow-hidden shadow-sm"
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-500/10 rounded-lg">
                        <Brain className="w-4 h-4 text-indigo-550 dark:text-indigo-400" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Wealth Destiny</span>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
            </div>

            <div className="h-32 relative">
                <SafeChartContainer>
                    <PieChart>
                        <Pie
                            data={GAUGE_DATA}
                            cx="50%"
                            cy="100%"
                            startAngle={180}
                            endAngle={0}
                            innerRadius="70%"
                            outerRadius="100%"
                            paddingAngle={2}
                            dataKey="value"
                            stroke="none"
                        >
                            {GAUGE_DATA.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} opacity={0.3} />
                            ))}
                        </Pie>
                    </PieChart>
                </SafeChartContainer>

                {/* Needle */}
                {!isLoading && (
                    <motion.div 
                        initial={{ rotate: -90 }}
                        animate={{ rotate: needleRotation }}
                        transition={{ type: 'spring', damping: 10 }}
                        style={{ originX: '50%', originY: '100%' }}
                        className="absolute bottom-0 left-1/2 -ml-0.5 w-1 h-20 bg-gradient-to-t from-indigo-500 to-indigo-300 rounded-full z-10"
                    />
                )}
                <div className="absolute bottom-0 left-1/2 -ml-2 w-4 h-4 bg-slate-100 dark:bg-slate-800 rounded-full border-2 border-slate-300 dark:border-slate-700 z-20" />
            </div>

            <div className="text-center mt-4">
                {isLoading ? (
                    <div className="h-8 w-32 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-lg mx-auto" />
                ) : (
                    <>
                        <span className="text-2xl font-black tracking-tighter text-slate-800 dark:text-slate-100">₹{p50Cr.toFixed(2)} Cr</span>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter mt-1">
                            Projected Path (20 Years)
                        </p>
                    </>
                )}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800/50">
                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed italic">
                    "On your current path, you'll reach ₹{p50Cr.toFixed(1)} Crore by age 52."
                </p>
            </div>

            {/* Background Glow */}
            <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-indigo-500/5 blur-3xl rounded-full" />
        </motion.div>
    );
};

export default WealthDestinyGauge;
