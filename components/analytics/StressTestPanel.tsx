import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { Play, ShieldAlert, Sparkles, TrendingDown, HelpCircle, Activity } from 'lucide-react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { stressTestEngine, StressTestResult } from '../../services/StressTestEngine';
import { SCENARIOS } from '../../services/ScenarioLibrary';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { formatCurrency } from '../../utils/helpers';

export const StressTestPanel: React.FC = () => {
  const investments = usePortfolioStore((s) => s.investments);
  const [selectedScenario, setSelectedScenario] = useState<string>('Global Market Crash (2008)');
  const [customShocks, setCustomShocks] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [result, setResult] = useState<StressTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scenario = SCENARIOS[selectedScenario];

  // Initialize custom shocks when scenario changes
  useEffect(() => {
    if (scenario) {
      setCustomShocks({ ...scenario.shocks });
    }
  }, [selectedScenario]);

  const handleSliderChange = (type: string, val: number) => {
    setCustomShocks((prev) => ({
      ...prev,
      [type]: val / 100, // convert percentage back to decimal
    }));
  };

  const handleRun = () => {
    setIsLoading(true);
    setProgress(0);
    setError(null);
    setResult(null);

    stressTestEngine
      .onProgress((p) => setProgress(p))
      .onComplete((res) => {
        setResult(res);
        setIsLoading(false);
        setProgress(100);
      })
      .onError((err) => {
        setError(err);
        setIsLoading(false);
      });

    stressTestEngine.runSimulation(investments, selectedScenario, customShocks, {
      numSimulations: 2000,
      steps: 252,
    });
  };

  // Prepare chart data from sample paths
  const chartData = React.useMemo(() => {
    if (!result || !result.samplePaths || result.samplePaths.length === 0) return [];
    
    const stepsCount = result.samplePaths[0].length;
    const data = [];
    for (let step = 0; step < stepsCount; step++) {
      const row: any = { step: `Day ${step * 5}` };
      result.samplePaths.forEach((path, idx) => {
        row[`path_${idx}`] = Math.round(path[step]);
      });
      data.push(row);
    }
    return data;
  }, [result]);

  return (
    <div className="bg-slate-900 rounded-2xl border border-indigo-500/20 p-6 text-white shadow-xl">
      <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20 animate-pulse">
            <ShieldAlert size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Macro Stress Test Simulator</h2>
            <p className="text-xs text-slate-400">Run 2,000 multi-asset Monte Carlo paths matching macro risk scenarios.</p>
          </div>
        </div>
        <button
          onClick={handleRun}
          disabled={isLoading || investments.length === 0}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold transition-all shadow-lg shadow-indigo-600/20 text-sm"
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Simulating ({progress}%)</span>
            </>
          ) : (
            <>
              <Play size={14} fill="currentColor" />
              <span>Run Stress Test</span>
            </>
          )}
        </button>
      </div>

      {investments.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <HelpCircle className="mx-auto mb-3 opacity-30" size={48} />
          <p>Please add investments to your portfolio before running a stress test.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls Column */}
          <div className="space-y-6 lg:border-r lg:border-slate-800 lg:pr-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Scenario Preset</label>
              <select
                value={selectedScenario}
                onChange={(e) => setSelectedScenario(e.target.value)}
                disabled={isLoading}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                {Object.keys(SCENARIOS).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {scenario && (
              <div className="bg-slate-950/50 border border-slate-850 p-4 rounded-xl text-xs text-slate-300 leading-relaxed">
                <span className="font-bold text-indigo-400 block mb-1">Scenario Impact:</span>
                {scenario.description}
              </div>
            )}

            <div className="space-y-4">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Shock Adjustments (%)</label>
              {Object.keys(customShocks).map((assetClass) => {
                const percentVal = Math.round(customShocks[assetClass] * 100);
                return (
                  <div key={assetClass} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-400">{assetClass}</span>
                      <span className={percentVal >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {percentVal > 0 ? `+${percentVal}` : percentVal}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      value={percentVal}
                      disabled={isLoading}
                      onChange={(e) => handleSliderChange(assetClass, parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Results/Simulation Column */}
          <div className="lg:col-span-2 space-y-6">
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl text-sm">
                {error}
              </div>
            )}

            {isLoading && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-4">
                <Activity className="animate-spin text-indigo-500" size={32} />
                <p className="text-sm font-mono">Computing 2,000 portfolio vectors & covariance weights...</p>
                <div className="w-48 bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {!isLoading && !result && !error && (
              <div className="flex flex-col items-center justify-center py-24 text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-950/10">
                <Sparkles className="mb-3 opacity-25" size={40} />
                <p className="text-sm">Click "Run Stress Test" to execute simulation paths.</p>
              </div>
            )}

            {result && (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Value at Risk (95% VaR)</p>
                    <p className="text-base font-mono font-bold text-slate-100">{formatCurrency(result.var95)}</p>
                    <p className="text-xs text-rose-500">
                      -{((result.var95 / result.initialValue) * 100).toFixed(1)}% of portfolio
                    </p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Expected Tail Loss (CVaR)</p>
                    <p className="text-base font-mono font-bold text-slate-100">{formatCurrency(result.cvar95)}</p>
                    <p className="text-xs text-rose-500 font-semibold">
                      -{((result.cvar95 / result.initialValue) * 100).toFixed(1)}% in tail events
                    </p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Average Max Drawdown</p>
                    <p className="text-base font-mono font-bold text-slate-100">{result.avgMaxDrawdown.toFixed(1)}%</p>
                    <p className="text-xs text-slate-400">Standard shock cycle</p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Worst-case Drawdown</p>
                    <p className="text-base font-mono font-bold text-red-400">{result.worstDrawdown.toFixed(1)}%</p>
                    <p className="text-xs text-red-500/80 font-medium">Worst simulated path</p>
                  </div>
                </div>

                {/* Risk Probability Bandages */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950 border border-slate-850 p-4 rounded-xl">
                  <div className="flex items-center justify-between text-xs border-r border-slate-800 pr-4">
                    <span className="text-slate-400">Probability of portfolio loss &gt; 10%:</span>
                    <span className={`font-bold font-mono px-2 py-0.5 rounded ${result.probLoss10 > 50 ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {result.probLoss10.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs pl-4">
                    <span className="text-slate-400">Probability of portfolio loss &gt; 20%:</span>
                    <span className={`font-bold font-mono px-2 py-0.5 rounded ${result.probLoss20 > 25 ? 'bg-red-500/25 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {result.probLoss20.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Chart */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Sample Projection Bundles (20 Paths)</h3>
                  <div className="h-64">
                    <SafeChartContainer>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="step" tick={{ fill: '#64748b', fontSize: 10 }} />
                        <YAxis tickFormatter={(val) => `₹${formatCurrency(val).replace('₹', '')}`} tick={{ fill: '#64748b', fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b', color: '#fff' }}
                          formatter={(value) => [formatCurrency(Number(value)), 'Portfolio Val']}
                        />
                        {Array(20).fill(0).map((_, idx) => (
                          <Line
                            key={`path_${idx}`}
                            type="monotone"
                            dataKey={`path_${idx}`}
                            stroke={idx === 0 ? '#6366f1' : '#4f46e5'}
                            strokeWidth={idx === 0 ? 2 : 1}
                            dot={false}
                            opacity={idx === 0 ? 0.9 : 0.3}
                          />
                        ))}
                      </LineChart>
                    </SafeChartContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StressTestPanel;
