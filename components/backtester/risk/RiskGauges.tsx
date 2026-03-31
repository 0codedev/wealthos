import React from 'react';
import { motion } from 'framer-motion';

interface GaugeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  color: string;
  description: string;
}

const Gauge: React.FC<GaugeProps> = ({ label, value, min, max, color, description }) => {
  const percentage = Math.min(Math.max(((value - min) / (max - min)) * 100, 0), 100);
  const strokeDasharray = 251.2; // 2 * PI * 40
  const strokeDashoffset = strokeDasharray - (strokeDasharray * (percentage * 0.75)) / 100; // 0.75 for a semi-circle effect

  return (
    <div className="flex flex-col items-center p-6 bg-slate-950/40 rounded-3xl border border-slate-800/40 shadow-inner group">
      <div className="relative w-32 h-24 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-225" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke="#1e293b"
            strokeWidth="10"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDasharray * 0.25}
            strokeLinecap="round"
          />
          <motion.circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeDasharray={strokeDasharray}
            initial={{ strokeDashoffset: strokeDasharray }}
            animate={{ strokeDashoffset }}
            strokeLinecap="round"
            transition={{ duration: 1.5, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <span className="text-xl font-black text-white">{value.toFixed(2)}</span>
        </div>
      </div>
      <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1 group-hover:text-white transition-colors">{label}</h5>
      <p className="text-[8px] font-bold text-slate-600 uppercase tracking-tighter text-center">{description}</p>
    </div>
  );
};

interface RiskGaugesProps {
  sharpe: number;
  sortino: number;
  calmar: number;
}

export const RiskGauges: React.FC<RiskGaugesProps> = ({ sharpe, sortino, calmar }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Gauge 
        label="Sharpe Ratio" 
        value={sharpe} 
        min={0} 
        max={3} 
        color="#6366f1" 
        description="Reward per unit of risk"
      />
      <Gauge 
        label="Sortino Ratio" 
        value={sortino} 
        min={0} 
        max={4} 
        color="#a855f7" 
        description="Downside risk efficiency"
      />
      <Gauge 
        label="Calmar Ratio" 
        value={calmar} 
        min={0} 
        max={5} 
        color="#10b981" 
        description="Return vs Max Drawdown"
      />
    </div>
  );
};
