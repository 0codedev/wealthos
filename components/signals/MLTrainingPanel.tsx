import React, { useState, useEffect } from 'react';
import { Cpu, Award, RefreshCw, CheckCircle, HelpCircle, Activity } from 'lucide-react';
import { signalMLEngine, TrainingMetrics } from '../../services/SignalMLEngine';
import { db } from '../../database';

interface MLTrainingPanelProps {
  onTrainingComplete?: () => void;
}

export const MLTrainingPanel: React.FC<MLTrainingPanelProps> = ({ onTrainingComplete }) => {
  const [metrics, setMetrics] = useState<any>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState<string>('Idle');
  const [epochProgress, setEpochProgress] = useState<{ epoch: number; loss: number; acc: number }[]>([]);
  const [totalLabeledSignals, setTotalLabeledSignals] = useState(0);

  const loadMetrics = async () => {
    // Check total closed signals
    const signals = await db.parsed_signals
      .filter(s => s.status === 'TARGET_HIT' || s.status === 'SL_HIT')
      .toArray();
    setTotalLabeledSignals(signals.length);

    await signalMLEngine.init();
    const currentMetrics = signalMLEngine.getLastMetrics();
    setMetrics(currentMetrics);
  };

  useEffect(() => {
    loadMetrics();
  }, []);

  const handleTrain = async () => {
    setIsTraining(true);
    setEpochProgress([]);
    setTrainingStatus('Initializing TensorFlow...');

    try {
      const result = await signalMLEngine.train((epoch, loss, acc) => {
        setTrainingStatus(`Training Epoch ${epoch}/20`);
        setEpochProgress(prev => [...prev, { epoch, loss, acc }]);
      });

      if (result) {
        setTrainingStatus('Training completed successfully!');
        await loadMetrics();
        if (onTrainingComplete) onTrainingComplete();
      } else {
        setTrainingStatus('Training failed.');
      }
    } catch (e) {
      setTrainingStatus('Error during training.');
    } finally {
      setIsTraining(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to delete the local model? This will clear all trained weights.')) return;
    await signalMLEngine.resetModel();
    await loadMetrics();
    setEpochProgress([]);
    setTrainingStatus('Model weights reset.');
  };

  // Status variables
  const isLoaded = metrics?.isLoaded;
  const accuracyPct = metrics?.accuracy ? (metrics.accuracy * 100).toFixed(1) : '0';
  const lossVal = metrics?.loss ? metrics.loss.toFixed(4) : '0';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
      <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-2">
        <Cpu className="w-4 h-4 text-indigo-400 animate-pulse" />
        On-Device Neural Network Training
      </h3>
      <p className="text-xs text-slate-300 font-medium mb-4 leading-normal">
        Trains a feedforward network in your browser. Inputs feature-vector from past signals to estimate future outcomes.
      </p>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-4 text-center font-mono">
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Local Dataset</span>
          <span className="text-base font-bold text-white mt-0.5 block">{totalLabeledSignals} Labeled</span>
          <span className="text-[10px] text-slate-400 block mt-0.5 font-medium">TARGET_HIT / SL_HIT</span>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Model Status</span>
          <span className={`text-base font-bold mt-0.5 block ${isLoaded ? 'text-emerald-400' : 'text-amber-400'}`}>
            {isLoaded ? 'Trained' : 'Untrained'}
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5 font-medium">IndexedDB local store</span>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Net Accuracy</span>
          <span className="text-base font-bold text-indigo-300 mt-0.5 block">{accuracyPct}%</span>
          <span className="text-[10px] text-slate-400 block mt-0.5 font-medium">Loss: {lossVal}</span>
        </div>
      </div>

      {/* Dynamic Training Logs / Interactive graph visual */}
      {epochProgress.length > 0 && (
        <div className="mb-4 bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-300 space-y-1.5">
          <div className="flex justify-between font-bold text-indigo-300 border-b border-slate-800 pb-1 uppercase tracking-wider text-[10px]">
            <span>Epoch</span>
            <span>Accuracy</span>
            <span>Loss</span>
          </div>
          <div className="max-h-24 overflow-y-auto space-y-1">
            {epochProgress.map((ep, i) => (
              <div key={i} className="flex justify-between items-center text-slate-200">
                <span>#{ep.epoch}</span>
                <span className="text-emerald-300 font-bold">{(ep.acc * 100).toFixed(1)}%</span>
                <span className="text-rose-300 font-bold">{ep.loss.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 items-center justify-between mt-4 border-t border-slate-800 pt-4">
        <span className="text-xs text-slate-300 font-mono flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-indigo-400" />
          {trainingStatus}
        </span>

        <div className="flex gap-2 w-full sm:w-auto">
          {isLoaded && (
            <button
              onClick={handleReset}
              disabled={isTraining}
              className="flex-1 sm:flex-initial py-2 px-3 bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-bold uppercase rounded-xl transition-all cursor-pointer"
            >
              Reset Model
            </button>
          )}
          <button
            onClick={handleTrain}
            disabled={isTraining}
            className="flex-1 sm:flex-initial py-2 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold uppercase rounded-xl transition-all flex items-center justify-center gap-1.5 text-xs tracking-wider shadow-lg shadow-indigo-600/20 cursor-pointer"
          >
            {isTraining ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {isLoaded ? 'Retrain Model' : 'Train Model'}
          </button>
        </div>
      </div>
    </div>
  );
};
