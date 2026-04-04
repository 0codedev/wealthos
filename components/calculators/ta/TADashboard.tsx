import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { parkinsonVolatility, garmanKlassVolatility } from '../../../lib/quant/ta/volatility';
import { standardPivots, fibonacciPivots, camarillaPivots, woodiePivots, PivotPoints } from '../../../lib/quant/ta/pivots';
import { calculateSMA, calculateRSI, calculateBollingerBands, calculateATR } from '../../../lib/quant/ta/indicators';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ComposedChart, Area } from 'recharts';
import { CandlestickChart, Database, Map } from 'lucide-react';

export const TADashboard: React.FC = () => {

    // --- PIVOTS STATE ---
    const [pivotInputs, setPivotInputs] = useState({ high: 155, low: 148, close: 152 });
    const allPivots = useMemo(() => {
        const { high, low, close } = pivotInputs;
        if (high <= low) return null;
        return {
            standard: standardPivots(high, low, close),
            fibonacci: fibonacciPivots(high, low, close),
            camarilla: camarillaPivots(high, low, close),
            woodie: woodiePivots(high, low, close)
        };
    }, [pivotInputs]);

    // --- OHLC ARRAY STATE ---
    const [ohlcText, setOhlcText] = useState('');
    const [indicatorParams, setIndicatorParams] = useState({ rsiPeriod: 14, bbPeriod: 20 });
    const [taResults, setTaResults] = useState<any>(null);

    const loadSampleData = () => {
        // Simulated 30 days of TSLA-like OHLC data (Open, High, Low, Close)
        const sample = `
180.5, 185.2, 179.0, 184.1
183.0, 186.5, 182.1, 185.5
185.0, 188.0, 184.5, 187.2
186.5, 190.1, 185.0, 189.5
190.0, 192.5, 188.5, 191.0
191.5, 194.0, 190.0, 193.2
194.0, 196.5, 192.5, 195.0
195.5, 198.0, 194.0, 197.5
198.0, 201.5, 197.0, 200.1
201.0, 204.0, 199.5, 203.5
204.0, 206.5, 202.0, 205.0
205.5, 208.0, 204.0, 207.2
207.0, 210.5, 206.0, 209.5
210.0, 212.0, 208.5, 211.0
211.5, 214.0, 210.0, 213.5
214.0, 216.5, 212.5, 215.0
215.5, 218.0, 214.0, 217.5
218.0, 221.5, 217.0, 220.1
221.0, 224.0, 219.5, 223.5
224.0, 226.5, 222.0, 225.0
225.5, 228.0, 224.0, 227.2
227.0, 230.5, 226.0, 229.5
230.0, 232.0, 228.5, 231.0
231.5, 234.0, 230.0, 233.5
234.0, 236.5, 232.5, 235.0
235.5, 238.0, 234.0, 237.5
238.0, 241.5, 237.0, 240.1
241.0, 244.0, 239.5, 243.5
244.0, 246.5, 242.0, 245.0
        `.trim();
        setOhlcText(sample);
    };

    const processOHLC = () => {
        if (!ohlcText.trim()) return;
        const lines = ohlcText.split('\n');
        const O: number[] = [], H: number[] = [], L: number[] = [], C: number[] = [];
        
        for (const line of lines) {
            const parts = line.split(/[,\s]+/).filter(x => x).map(Number);
            if (parts.length >= 4 && !parts.includes(NaN)) {
                O.push(parts[0]); H.push(parts[1]); L.push(parts[2]); C.push(parts[3]);
            }
        }
        
        if (C.length < 2) return;

        // Volatilities
        const pVol = parkinsonVolatility(H, L);
        const gkVol = garmanKlassVolatility(O, H, L, C);
        
        // Indicators
        const smaFast = calculateSMA(C, 5);
        const rsi = calculateRSI(C, indicatorParams.rsiPeriod);
        const bb = calculateBollingerBands(C, indicatorParams.bbPeriod, 2);
        const atr = calculateATR(H, L, C, indicatorParams.rsiPeriod); // share period for ATR

        // Chart Data Builder
        const chartData = C.map((close, i) => ({
            day: i + 1,
            close,
            sma: smaFast[i] || null,
            rsi: rsi[i] || null,
            bbUpper: bb.upper[i] || null,
            bbLower: bb.lower[i] || null,
            atr: atr[i] || null
        }));

        setTaResults({ O, H, L, C, pVol, gkVol, chartData });
    };

    React.useEffect(() => { processOHLC() }, [ohlcText, indicatorParams]);

    const GridCell = ({ label, val }: { label: string, val: number }) => (
        <div className="flex justify-between items-center py-1 border-b border-slate-800/50 last:border-0">
            <span className="text-xs text-slate-500">{label}</span>
            <span className="text-sm font-mono text-slate-300">{val.toFixed(2)}</span>
        </div>
    );
    const PivotCol = ({ title, p }: { title: string, p: PivotPoints }) => (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <h4 className="text-xs font-bold text-center text-slate-400 mb-2 uppercase">{title}</h4>
            <div className="space-y-1">
                 <GridCell label="R3" val={p.r3} />
                 <GridCell label="R2" val={p.r2} />
                 <GridCell label="R1" val={p.r1} />
                 <div className="flex justify-between items-center py-2 border-y border-slate-700 my-1 bg-slate-900/50 px-2 rounded">
                    <span className="text-xs font-bold text-emerald-500">PIVOT</span>
                    <span className="text-sm font-mono font-bold text-emerald-400">{p.pivot.toFixed(2)}</span>
                 </div>
                 <GridCell label="S1" val={p.s1} />
                 <GridCell label="S2" val={p.s2} />
                 <GridCell label="S3" val={p.s3} />
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-bold text-slate-200">Technical Analysis Engine</h2>

            {/* PIVOTS */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h3 className="font-bold text-white flex items-center gap-2"><Map size={18} className="text-emerald-500"/> Intraday Pivot Extractors</h3>
                        <p className="text-xs text-slate-400 mt-1">Given yesterday's High, Low, and Close, dynamically draw key resistance/support zones.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div>
                        <label className="block text-xs text-slate-400 mb-1 font-bold">Yesterday's High</label>
                        <input type="number" step="0.1" value={pivotInputs.high} onChange={e => setPivotInputs({...pivotInputs, high: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1 font-bold">Yesterday's Low</label>
                        <input type="number" step="0.1" value={pivotInputs.low} onChange={e => setPivotInputs({...pivotInputs, low: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1 font-bold">Yesterday's Close</label>
                        <input type="number" step="0.1" value={pivotInputs.close} onChange={e => setPivotInputs({...pivotInputs, close: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm outline-none focus:border-emerald-500" />
                    </div>
                </div>

                {allPivots && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <PivotCol title="Standard (Floor)" p={allPivots.standard} />
                        <PivotCol title="Fibonacci" p={allPivots.fibonacci} />
                        <PivotCol title="Woodie's" p={allPivots.woodie} />
                        <PivotCol title="Camarilla (Extreme)" p={allPivots.camarilla} />
                    </div>
                )}
            </div>

            {/* OHLC INDICATOR SUITE */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h3 className="font-bold text-white flex items-center gap-2"><CandlestickChart size={18} className="text-blue-500"/> Array Indicator Pipeline</h3>
                        <p className="text-xs text-slate-400 mt-1">Paste historical dataset to plot Bollinger Bands, RSI momentum, and OHLC Volatilities.</p>
                    </div>
                    <button onClick={loadSampleData} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 px-4 rounded-lg flex items-center gap-2 border border-slate-700 transition-colors">
                        <Database size={14} /> Load Sample TSLA Data
                    </button>
                </div>

                <div className="flex flex-col lg:flex-row gap-6 mb-6">
                    <div className="w-full lg:w-1/3">
                        <label className="block text-xs text-slate-400 mb-1 font-bold">Pasted Array: O, H, L, C (per day)</label>
                        <textarea 
                            value={ohlcText}
                            onChange={(e) => setOhlcText(e.target.value)}
                            onBlur={processOHLC}
                            placeholder="180.5, 185.2, 179.0, 184.1..."
                            className="w-full h-48 bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-400 font-mono text-sm focus:outline-none focus:border-blue-500 resize-none"
                        />
                    </div>
                    
                    {taResults && (
                        <div className="w-full lg:w-2/3 space-y-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 border-b border-slate-800 pb-2">Extracted Estimators</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-center">
                                    <span className="text-xs text-slate-500 uppercase font-bold block mb-1 hover:text-white" title="High/Low historical Volatility (Annualized) - Good for mapping intraday extremes">Parkinson Volatility</span>
                                    <span className="text-2xl font-mono font-black text-rose-400">{(taResults.pVol * 100).toFixed(2)}%</span>
                                </div>
                                <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-center">
                                    <span className="text-xs text-slate-500 uppercase font-bold block mb-1 hover:text-white" title="Open/High/Low/Close historical Volatility (Annualized) - Most reliable options pricing assumption">Garman-Klass Volatility</span>
                                    <span className="text-2xl font-mono font-black text-blue-400">{(taResults.gkVol * 100).toFixed(2)}%</span>
                                </div>
                            </div>
                            
                            <div className="flex gap-4 mt-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
                                <div className="flex-1">
                                    <label className="block text-xs text-slate-500 mb-1">RSI Period</label>
                                    <input type="number" value={indicatorParams.rsiPeriod} onChange={e => setIndicatorParams({...indicatorParams, rsiPeriod: parseInt(e.target.value)||14})} className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-white font-mono text-sm" />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs text-slate-500 mb-1">Bollinger Period</label>
                                    <input type="number" value={indicatorParams.bbPeriod} onChange={e => setIndicatorParams({...indicatorParams, bbPeriod: parseInt(e.target.value)||20})} className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-white font-mono text-sm" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* TA RECHARTS SUITE */}
                {taResults && taResults.chartData.length > 0 && (
                    <div className="space-y-4">
                        {/* PRICE & BOLLINGER BANDS */}
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 h-[300px]">
                            <h4 className="text-xs font-bold text-slate-500 absolute z-10">Price vs Bollinger Bands (2σ)</h4>
                            <SafeChartContainer>
                                <ComposedChart data={taResults.chartData} margin={{ top: 20, right: 10, bottom: 0, left: -20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                    <XAxis dataKey="day" tick={{fill: '#64748b', fontSize: 10}} minTickGap={30} />
                                    <YAxis domain={['auto', 'auto']} tick={{fill: '#64748b', fontSize: 10}} />
                                    <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px', fontFamily: 'monospace' }} />
                                    
                                    <Area type="monotone" dataKey="bbUpper" stroke="none" fill="#3b82f6" fillOpacity={0.1} />
                                    <Area type="monotone" dataKey="bbLower" stroke="none" fill="#0f172a" fillOpacity={1} /> {/* Mask to create band visual */}
                                    
                                    <Line type="monotone" dataKey="bbUpper" stroke="#3b82f6" strokeWidth={1} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                                    <Line type="monotone" dataKey="bbLower" stroke="#3b82f6" strokeWidth={1} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                                    
                                    <Line type="monotone" dataKey="close" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
                                </ComposedChart>
                            </SafeChartContainer>
                        </div>

                        {/* RSI OSCILLATOR */}
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 h-[150px]">
                            <h4 className="text-xs font-bold text-slate-500 absolute z-10">RSI ({indicatorParams.rsiPeriod})</h4>
                            <SafeChartContainer>
                                <ComposedChart data={taResults.chartData} margin={{ top: 20, right: 10, bottom: 0, left: -20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                    <XAxis dataKey="day" hide />
                                    <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={{fill: '#64748b', fontSize: 10}} />
                                    <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px', fontFamily: 'monospace' }} />
                                    {/* Over/Underbought lines */}
                                    <Line type="linear" dataKey={() => 70} stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                                    <Line type="linear" dataKey={() => 30} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                                    <Line type="monotone" dataKey="rsi" stroke="#c084fc" strokeWidth={2} dot={false} isAnimationActive={false} />
                                </ComposedChart>
                            </SafeChartContainer>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
