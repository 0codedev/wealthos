import React, { useEffect } from 'react';
import { useMLModelStore } from '../../store/mlModelStore';
import { modelVersioning } from '../../services/ml/ModelVersioning';
import { signalMLEngine } from '../../services/SignalMLEngine';
import {
  Brain, Award, ShieldAlert, CheckCircle, RotateCcw, Play, RefreshCw, BarChart2
} from 'lucide-react';

export const NeuralEnginePanel: React.FC = () => {
  const store = useMLModelStore();

  useEffect(() => {
    store.fetchHistory();
  }, []);

  const handleRetrain = async () => {
    if (store.isTraining) return;
    store.updateMetrics({ isTraining: true });
    try {
      const metrics = await signalMLEngine.train();
      if (metrics) {
        // Register version
        const nextVer = store.versionsHistory.length + 1;
        await modelVersioning.registerVersion({
          version: nextVer,
          accuracy: metrics.accuracy,
          loss: metrics.loss,
          sampleCount: metrics.samples,
          isCurrent: 1
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      store.updateMetrics({ isTraining: false });
      await store.fetchHistory();
    }
  };

  const handleRollback = async (version: number) => {
    const ok = await modelVersioning.rollbackToVersion(version);
    if (ok) {
      await store.fetchHistory();
    }
  };

  const handleReset = async () => {
    if (window.confirm('Are you sure you want to completely reset the Neural model? This will delete all trained weights.')) {
      await signalMLEngine.resetModel();
      await store.fetchHistory();
    }
  };

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Active Version */}
        <div className="bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 border border-indigo-500/20 rounded-2xl p-5 flex flex-col gap-1.5 shadow-sm hover:scale-[1.01] transition-transform">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-indigo-400">
            <span className="flex items-center gap-1">
              <Brain size={12} /> Active Model
            </span>
          </div>
          <div className="text-3xl font-black text-white mt-1">v{store.currentVersion}</div>
          <div className="text-[10px] text-slate-400">On-device TF.js instance</div>
        </div>

        {/* Accuracy */}
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5 flex flex-col gap-1.5 shadow-sm hover:scale-[1.01] transition-transform">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-emerald-400">
            <span className="flex items-center gap-1">
              <Award size={12} /> Accuracy
            </span>
          </div>
          <div className="text-3xl font-black text-emerald-400 mt-1">{(store.accuracy * 100).toFixed(1)}%</div>
          <div className="text-[10px] text-slate-400">Target hit prediction accuracy</div>
        </div>

        {/* Loss */}
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/20 rounded-2xl p-5 flex flex-col gap-1.5 shadow-sm hover:scale-[1.01] transition-transform">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-amber-400">
            <span className="flex items-center gap-1">
              <ShieldAlert size={12} /> Loss Rate
            </span>
          </div>
          <div className="text-3xl font-black text-amber-400 mt-1">{store.loss.toFixed(4)}</div>
          <div className="text-[10px] text-slate-400">Binary Crossentropy loss</div>
        </div>

        {/* RL Replay Buffer */}
        <div className="bg-gradient-to-br from-violet-500/10 to-violet-500/5 border border-violet-500/20 rounded-2xl p-5 flex flex-col gap-1.5 shadow-sm hover:scale-[1.01] transition-transform">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-violet-400">
            <span className="flex items-center gap-1">
              <RotateCcw size={12} /> RL buffer
            </span>
            <span className="text-[10px] font-bold text-violet-300">{store.rlBufferSize}/15</span>
          </div>
          <div className="text-3xl font-black text-white mt-1">
            {Math.round((store.rlBufferSize / 15) * 100)}%
          </div>
          <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden mt-1">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300"
              style={{ width: `${Math.min(100, (store.rlBufferSize / 15) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Control Panel Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Version History Table */}
        <div className="lg:col-span-8 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart2 size={16} className="text-indigo-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Model Checkpoints</h3>
            </div>
            <button
              onClick={handleReset}
              className="text-[9px] font-black uppercase text-rose-400 hover:text-rose-300 border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Reset Weights
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] font-bold text-slate-500 uppercase border-b border-slate-800/80 pb-2">
                  <th className="text-left pb-2">Version</th>
                  <th className="text-left pb-2">Accuracy</th>
                  <th className="text-left pb-2">Loss</th>
                  <th className="text-left pb-2">Samples</th>
                  <th className="text-left pb-2">Checkpoint Date</th>
                  <th className="text-right pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {store.versionsHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-500 py-6 italic font-mono">
                      No checkpoints recorded yet. Run a training cycle to register v1.
                    </td>
                  </tr>
                ) : (
                  store.versionsHistory.map((version) => (
                    <tr key={version.id} className="border-b border-slate-800/40 hover:bg-slate-800/10">
                      <td className="py-2.5 font-mono text-slate-300 flex items-center gap-1.5">
                        {version.isCurrent === 1 ? (
                          <CheckCircle size={12} className="text-emerald-400" />
                        ) : (
                          <span className="w-3" />
                        )}
                        v{version.version}
                      </td>
                      <td className="py-2.5 font-semibold text-slate-200">{(version.accuracy * 100).toFixed(1)}%</td>
                      <td className="py-2.5 font-mono text-slate-400">{version.loss.toFixed(4)}</td>
                      <td className="py-2.5 text-slate-400">{version.sampleCount}</td>
                      <td className="py-2.5 text-slate-500">
                        {new Date(version.timestamp).toLocaleString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>
                      <td className="py-2.5 text-right">
                        {version.isCurrent !== 1 && (
                          <button
                            onClick={() => handleRollback(version.version)}
                            className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                          >
                            Rollback
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Retraining Controls */}
        <div className="lg:col-span-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Reinforcement Engine</h4>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              The neural model learns from trade outcomes in real-time. When a signal is resolved, it is added to the experience buffer. The model incrementally trains once the buffer hits 15 samples.
            </p>
            <div className="bg-slate-950/40 border border-slate-850 rounded-xl p-3 space-y-2">
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>A/B Exploration</span>
                <span className="text-slate-300 font-bold">5% Rate</span>
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>Increment Rate</span>
                <span className="text-slate-300 font-bold">5 Epochs</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleRetrain}
            disabled={store.isTraining}
            className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-850 disabled:text-slate-600 text-white text-xs font-bold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-600/10 cursor-pointer"
          >
            {store.isTraining ? (
              <>
                <RefreshCw size={14} className="animate-spin" /> Training Model...
              </>
            ) : (
              <>
                <Play size={14} /> Force Retraining Cycle
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
export default NeuralEnginePanel;
