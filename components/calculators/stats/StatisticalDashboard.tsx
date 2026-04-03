import React, { useState } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { mean, median, mode, stdDev, skewness, kurtosis, iqr, variance } from '../../../lib/quant/stats/descriptive';
import { zTest1Sample } from '../../../lib/quant/stats/hypothesisTesting';
import { simpleLinearRegression } from '../../../lib/quant/stats/regression';

import { BarChart2, TrendingUp, AlertCircle, FileDigit } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Line } from 'recharts';

export const StatisticalDashboard: React.FC = () => {
    // ---------------------------------------------------------
    const [rawInput, setRawInput] = useState('10, 12, 14, 15, 18, 20, 22, 25, 29, 31, 35');
    const [descResult, setDescResult] = useState<{
        size: number;
        mean: number;
        median: number;
        mode: number | null;
        stdDev: number;
        variance: number;
        skewness: number;
        kurtosis: number;
        iqr: number;
    } | null>(null);

    const parseArray = (str: string) => {
        return str.split(/[,\s]+/)
                  .map(val => parseFloat(val))
                  .filter(val => !isNaN(val));
    };

    const runDescriptive = () => {
        const arr = parseArray(rawInput);
        if (arr.length === 0) return;
        setDescResult({
            size: arr.length,
            mean: mean(arr),
            median: median(arr),
            mode: mode(arr),
            stdDev: stdDev(arr),
            variance: variance(arr),
            skewness: skewness(arr),
            kurtosis: kurtosis(arr),
            iqr: iqr([...arr].sort((a,b)=>a-b))
        });
    };

    // Auto-run on mount
    React.useEffect(() => { runDescriptive() }, []);

    // ---------------------------------------------------------
    // 2. Regression State
    // ---------------------------------------------------------
    const [regX, setRegX] = useState('1.5, 2.0, 2.5, 3.0, 3.5, 4.0');
    const [regY, setRegY] = useState('100, 150, 210, 250, 305, 350');
    const [regResult, setRegResult] = useState<{
        slope: number;
        intercept: number;
        rSquared: number;
        points: { x: number; y: number }[];
    } | null>(null);

    const runRegression = () => {
        const x = parseArray(regX);
        const y = parseArray(regY);
        setRegResult(simpleLinearRegression(x, y));
    };
    React.useEffect(() => { runRegression() }, []);

    // ---------------------------------------------------------
    // 3. Hypothesis State
    // ---------------------------------------------------------
    const [hypInputs, setHypInputs] = useState({
        popMean: 20,
        alpha: 0.05
    });
    const [hypResult, setHypResult] = useState<{
        testStatistic: number;
        pValue: number;
        rejectNull: boolean;
    } | null>(null);

    const runHypothesis = () => {
        const sample = parseArray(rawInput);
        setHypResult(zTest1Sample(sample, hypInputs.popMean, null, hypInputs.alpha, 'two'));
    };
    React.useEffect(() => { runHypothesis() }, [descResult]);

    // Format utility
    const num = (n: number) => typeof n === 'number' ? n.toFixed(4) : '-';

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-bold text-slate-200">Statistical Toolkit</h2>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Descriptive Statistics Column */}
                <div className="lg:col-span-5 space-y-6">
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                        <h3 className="font-bold text-white flex items-center gap-2 mb-4"><FileDigit size={18} className="text-emerald-500"/> Dataset Analyzer</h3>
                        <p className="text-xs text-slate-400 mb-2">Paste comma or space-separated numbers (Returns, Prices, etc.)</p>
                        <textarea 
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-emerald-400 font-mono text-sm max-h-32 mb-4 focus:outline-none focus:border-emerald-500"
                            rows={3}
                            value={rawInput}
                            onChange={(e) => setRawInput(e.target.value)}
                            onBlur={runDescriptive}
                        />

                        {descResult && (
                            <div className="grid grid-cols-2 gap-3 mt-2">
                                <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex flex-col items-center">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Obs (N)</span>
                                    <span className="text-lg font-mono text-white">{descResult.size}</span>
                                </div>
                                <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex flex-col items-center">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Mean (μ)</span>
                                    <span className="text-lg font-mono text-white">{num(descResult.mean)}</span>
                                </div>
                                <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex flex-col items-center">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Median</span>
                                    <span className="text-lg font-mono text-white">{num(descResult.median)}</span>
                                </div>
                                <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex flex-col items-center">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Volatility (σ)</span>
                                    <span className="text-lg font-mono text-rose-400">{num(descResult.stdDev)}</span>
                                </div>
                                <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex flex-col items-center">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Skewness</span>
                                    <span className={`text-lg font-mono ${descResult.skewness < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{num(descResult.skewness)}</span>
                                </div>
                                <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex flex-col items-center">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Kurtosis</span>
                                    <span className="text-lg font-mono text-indigo-400">{num(descResult.kurtosis)}</span>
                                </div>
                            </div>
                        )}
                        <p className="text-xs text-slate-500 mt-4 text-center">Skew &gt; 0 (Right Tail), Kurtosis &gt; 0 (Fat Tails / Leptokurtic)</p>
                    </div>

                    {/* Hypothesis Testing */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                        <h3 className="font-bold text-white flex items-center gap-2 mb-4"><AlertCircle size={18} className="text-amber-500"/> Z-Test (Hypothesis)</h3>
                        <p className="text-xs text-slate-400 mb-4">Uses the dataset above to test against a hypothesized population mean.</p>
                        
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Null Hypothesis Mean (H₀)</label>
                                <input type="number" value={hypInputs.popMean} onChange={e => {setHypInputs({...hypInputs, popMean: parseFloat(e.target.value)||0}); runHypothesis();}} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Significance (α)</label>
                                <select value={hypInputs.alpha} onChange={e => {setHypInputs({...hypInputs, alpha: parseFloat(e.target.value)}); runHypothesis();}} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm outline-none">
                                    <option value={0.10}>10%</option>
                                    <option value={0.05}>5%</option>
                                    <option value={0.01}>1%</option>
                                </select>
                            </div>
                        </div>

                        {hypResult && (
                            <div className={`p-4 rounded-xl border ${hypResult.rejectNull ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
                                <h4 className={`font-bold mb-2 uppercase text-sm ${hypResult.rejectNull ? 'text-emerald-400' : 'text-slate-400'}`}>
                                    {hypResult.rejectNull ? 'Reject Null Hypothesis (H₀)' : 'Fail to Reject Null (H₀)'}
                                </h4>
                                <div className="flex justify-between items-center text-sm font-mono text-slate-300">
                                    <span>Z-Score: {hypResult.testStatistic.toFixed(3)}</span>
                                    <span>P-Value: {hypResult.pValue.toFixed(4)}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Regression Column */}
                <div className="lg:col-span-7">
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 h-full flex flex-col">
                        <h3 className="font-bold text-white flex items-center gap-2 mb-4"><TrendingUp size={18} className="text-blue-500"/> OLS Linear Regression</h3>
                        <p className="text-xs text-slate-400 mb-4">Find the line of best fit $Y = \beta_0 + \beta_1 X$ and the R² determination coefficient.</p>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1 font-bold">X Array (Independent variable)</label>
                                <textarea value={regX} onChange={(e) => setRegX(e.target.value)} onBlur={runRegression} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 font-mono text-sm max-h-24 focus:outline-none focus:border-blue-500" rows={2} />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1 font-bold">Y Array (Dependent variable)</label>
                                <textarea value={regY} onChange={(e) => setRegY(e.target.value)} onBlur={runRegression} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-blue-400 font-mono text-sm max-h-24 focus:outline-none focus:border-blue-500" rows={2} />
                            </div>
                        </div>

                        {regResult && regResult.points.length > 0 ? (
                            <div className="flex-1 flex flex-col">
                                <div className="flex justify-between items-center bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl mb-4">
                                    <div>
                                        <div className="text-xs text-blue-300 font-bold uppercase mb-1">R-Squared (R²)</div>
                                        <div className="text-2xl font-black text-blue-400 font-mono">{regResult.rSquared.toFixed(4)}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-blue-300 font-bold uppercase mb-1">Equation</div>
                                        <div className="text-lg font-bold text-white font-mono">
                                            Y = {regResult.intercept.toFixed(2)} + {regResult.slope.toFixed(2)}X
                                        </div>
                                    </div>
                                </div>

                                {/* Plot */}
                                <div className="flex-1 min-h-[300px] w-full mt-4">
                                    <SafeChartContainer>
                                        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                                            <XAxis type="number" dataKey="x" name="X" tick={{fill: '#64748b', fontSize: 12}} domain={['auto', 'auto']} />
                                            <YAxis type="number" dataKey="y" name="Y" tick={{fill: '#64748b', fontSize: 12}} domain={['auto', 'auto']} />
                                            <RechartsTooltip 
                                                cursor={{strokeDasharray: '3 3'}}
                                                content={({ active, payload }) => {
                                                    if (active && payload && payload.length) {
                                                        const p = payload[0].payload;
                                                        return (
                                                            <div className="bg-slate-950 border border-slate-800 p-2 rounded-lg text-xs font-mono">
                                                                <p className="text-slate-300">X: {p.x}</p>
                                                                <p className="text-blue-400 font-bold">Y: {p.y}</p>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }}
                                            />
                                            {/* We plot the points */}
                                            <Scatter name="Data" data={regResult.points} fill="#3b82f6" />
                                            {/* We plot the regression line - simple trick is plotting another scatter with line connected */}
                                            <Scatter 
                                                name="Best Fit" 
                                                data={[
                                                    {x: Math.min(...regResult.points.map((p:any)=>p.x)), y: regResult.intercept + regResult.slope * Math.min(...regResult.points.map((p:any)=>p.x))},
                                                    {x: Math.max(...regResult.points.map((p:any)=>p.x)), y: regResult.intercept + regResult.slope * Math.max(...regResult.points.map((p:any)=>p.x))}
                                                ]} 
                                                line={{ stroke: '#10b981', strokeWidth: 2 }} 
                                                fill="transparent" 
                                                shape={() => <></>} // hide dots
                                            />
                                        </ScatterChart>
                                    </SafeChartContainer>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-slate-500 border border-dashed border-slate-700 rounded-xl">
                                Enter valid equal-length X and Y arrays above.
                            </div>
                        )}

                    </div>
                </div>

            </div>
        </div>
    );
};
