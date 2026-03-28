import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { ShieldAlert, TrendingDown, HelpCircle, Activity, Lightbulb } from 'lucide-react';
import { alphaDecayService, AlphaDecayReport } from '../../services/AlphaDecayService';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

export const AlphaDecayPanel: React.FC = () => {
  const [report, setReport] = useState<AlphaDecayReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadData = async () => {
    setLoading(true);
    const rep = await alphaDecayService.getDecayReport();
    setReport(rep);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Format Recharts data
  const chartData = React.useMemo(() => {
    if (!report || Object.keys(report.rollingStats).length === 0) return [];
    
    // Find the longest rates array to size the chart XAxis
    let maxLen = 0;
    Object.values(report.rollingStats).forEach(s => {
      if (s.rates.length > maxLen) maxLen = s.rates.length;
    });

    const data = [];
    for (let i = 0; i < maxLen; i++) {
      const row: any = { index: `T-${maxLen - i}` };
      [10, 20, 50, 100].forEach(w => {
        const stat = report.rollingStats[w];
        if (stat) {
          // Align arrays from the right (most recent)
          const offset = maxLen - stat.rates.length;
          const rateVal = stat.rates[i - offset];
          if (rateVal !== undefined) {
            row[`winRate_${w}`] = Math.round(rateVal * 100);
          }
        }
      });
      data.push(row);
    }
    return data.filter(r => Object.keys(r).length > 1); // remove empty indices
  }, [report]);

  return (
    <div className="bg-slate-900 rounded-2xl border border-indigo-500/20 p-6 text-white shadow-xl">
      <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
            <TrendingDown size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Alpha Decay Tracker</h2>
            <p className="text-xs text-slate-400">Identify win-rate degradation over rolling windows to prevent trailing into unprofitable cycles.</p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="bg-slate-950 border border-slate-800 hover:bg-slate-905 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-400 hover:text-white"
        >
          Refresh stats
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
          <Activity className="animate-spin text-indigo-500" size={32} />
          <p className="text-sm font-mono">Re-indexing paper and live database records...</p>
        </div>
      ) : report ? (
        <div className="space-y-6">
          {report.totalClosedTrades < 10 ? (
            <div className="text-center py-12 text-slate-500">
              <HelpCircle className="mx-auto mb-3 opacity-30" size={48} />
              <p className="max-w-md mx-auto text-sm leading-relaxed">
                A minimum of 10 closed trades or paper trades is required to begin tracking alpha decay.
                Currently, you have <span className="font-bold text-indigo-400">{report.totalClosedTrades}</span> closed trades.
              </p>
            </div>
          ) : (
            <>
              {/* Warnings Banner */}
              {report.hasDecay ? (
                <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                    <ShieldAlert size={18} />
                    <span>Edge Erosion Warning</span>
                  </div>
                  <ul className="list-disc list-inside text-xs text-rose-200/90 space-y-1 pl-1">
                    {report.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl text-xs text-emerald-400 font-medium">
                  ✓ Dynamic win rates are healthy. The quant model indicates your edge is performing within standard deviations.
                </div>
              )}

              {/* Chart */}
              <div className="bg-slate-950 border border-slate-850 p-5 rounded-2xl">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Rolling Win Rate Windows</h3>
                <div className="h-64">
                  <SafeChartContainer>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="index" tick={{ fill: '#64748b', fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tickFormatter={(val) => `${val}%`} tick={{ fill: '#64748b', fontSize: 10 }} />
                      <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b' }} formatter={(val) => [`${val}%`, 'Win Rate']} />
                      <Legend />
                      <Line type="monotone" dataKey="winRate_10" name="10 Trades" stroke="#6366f1" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="winRate_20" name="20 Trades" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                      {report.rollingStats[50] && (
                        <Line type="monotone" dataKey="winRate_50" name="50 Trades" stroke="#10b981" strokeWidth={2} dot={false} />
                      )}
                      {report.rollingStats[100] && (
                        <Line type="monotone" dataKey="winRate_100" name="100 Trades" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      )}
                    </LineChart>
                  </SafeChartContainer>
                </div>
              </div>

              {/* Attribution and Recommendations */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Attribution Table */}
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Factor Attribution</h4>
                  {report.attribution.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4">No significant negative performance attribution factors found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-500">
                            <th className="pb-2">Factor</th>
                            <th className="pb-2">Details</th>
                            <th className="pb-2 text-right">Impact</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.attribution.map((attr, idx) => (
                            <tr key={idx} className="border-b border-slate-900 last:border-0">
                              <td className="py-2.5 font-bold text-slate-300">{attr.factor}</td>
                              <td className="py-2.5 text-slate-400">{attr.details}</td>
                              <td className="py-2.5 text-right font-black">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                  attr.impact === 'HIGH' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
                                }`}>
                                  {attr.impact}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Recommendations */}
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl space-y-3">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Lightbulb size={14} className="text-yellow-400" /> Quant Action Recommendations
                  </h4>
                  <ul className="space-y-2 text-xs text-slate-300">
                    {report.recommendations.map((rec, idx) => (
                      <li key={idx} className="flex gap-2 items-start leading-relaxed">
                        <span className="text-indigo-400 font-bold">•</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500">
          <p>Failed to load performance metrics.</p>
        </div>
      )}
    </div>
  );
};

export default AlphaDecayPanel;
