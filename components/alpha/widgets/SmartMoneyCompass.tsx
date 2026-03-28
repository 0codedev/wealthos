import React, { useEffect, useState } from 'react';
import { Compass, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { signalFusionService, SmartMoneySignal } from '../../../services/alpha/SignalFusionService';
import { logger } from '../../../services/Logger';

export const SmartMoneyCompass: React.FC = () => {
  const [compass, setCompass] = useState<SmartMoneySignal | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompass = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    setError(null);
    try {
      const data = await signalFusionService.getSmartMoneyCompass(isManual);
      setCompass(data);
    } catch (err) {
      logger.error('SmartMoneyCompass: Fetch failed', err);
      setError('Unable to load smart-money signal. Tap refresh to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCompass();
    const interval = setInterval(() => fetchCompass(), 180000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[220px] animate-pulse">
        <Compass className="h-8 w-8 text-indigo-400 animate-spin mb-2" />
        <span className="text-slate-500 text-xs font-mono">CALIBRATING COMPASS...</span>
      </div>
    );
  }

  const score = compass?.score ?? 0;
  const trend = compass?.trend ?? 'NEUTRAL';
  const colorClass = compass?.color ?? 'text-slate-400';

  // Map score (-100 to +100) to rotation angle (-90 to +90 degrees)
  const rotationAngle = (score / 100) * 90;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between min-h-[342px] shadow-2xl transition-all duration-300 hover:border-slate-700">
      
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Institutional Direction</span>
          <h3 className="text-slate-200 text-sm font-bold mt-0.5">Smart Money Compass</h3>
        </div>
        <button
          onClick={() => fetchCompass(true)}
          disabled={refreshing}
          className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
          title="Recalculate Compass"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
        </button>
      </div>

      {/* Compass Dial Visualizer */}
      <div className="flex flex-col items-center justify-center my-4 relative">
        {/* Semi-circle Gauge background */}
        <div className="w-40 h-20 overflow-hidden relative flex items-end justify-center border-b border-slate-800">
          <div className="absolute top-0 w-40 h-40 rounded-full border-[8px] border-slate-800/80 border-t-indigo-500/20 border-r-emerald-500/30 border-l-rose-500/30"></div>
          
          {/* Compass Needle */}
          <motion.div
            initial={{ rotate: 0 }}
            animate={{ rotate: rotationAngle }}
            transition={{ type: 'spring', stiffness: 60, damping: 15 }}
            style={{ originX: 0.5, originY: 1 }}
            className="w-1.5 h-16 bg-gradient-to-t from-slate-400 to-indigo-400 relative z-10 flex items-start justify-center"
          >
            {/* Pointer arrow tip */}
            <div className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[8px] border-l-transparent border-r-transparent border-b-indigo-400 -mt-2"></div>
          </motion.div>

          {/* Core cap */}
          <div className="w-4 h-4 bg-slate-900 border border-slate-700 rounded-full absolute -bottom-2 z-20"></div>
        </div>

        {/* Labels left/right */}
        <div className="w-44 flex justify-between text-[9px] text-slate-500 font-mono mt-1 px-1">
          <span className="text-rose-500 font-bold">BEARISH (-100)</span>
          <span className="text-slate-500 font-bold">0</span>
          <span className="text-emerald-500 font-bold">BULLISH (+100)</span>
        </div>
      </div>

      {/* Score and Trend Summary */}
      <div className="flex justify-between items-end">
        <div>
          <span className="text-[9px] text-slate-500 block font-mono">FLOW SENTIMENT</span>
          <span className={`text-sm font-black tracking-wider uppercase font-mono ${colorClass}`}>
            {trend}
          </span>
        </div>
        <div className="text-right">
          <span className="text-[9px] text-slate-500 block font-mono">COMPOSITE INDEX</span>
          <span className="text-lg font-black text-slate-200 font-mono">
            {score > 0 ? `+${score}` : score}
          </span>
        </div>
      </div>
    </div>
  );
};
