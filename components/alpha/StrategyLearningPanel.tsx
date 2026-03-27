// components/alpha/StrategyLearningPanel.tsx
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, ChevronDown, ChevronRight, BookOpen, Lightbulb, GraduationCap } from 'lucide-react';
import { STRATEGY_CONFIGS, type StrategyId } from '../../services/alpha/StrategyEngine';

interface StrategyLearningPanelProps {
  strategyId: StrategyId;
}

export const StrategyLearningPanel: React.FC<StrategyLearningPanelProps> = ({ strategyId }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const config = STRATEGY_CONFIGS[strategyId];

  if (!config) return null;

  const renderStrategyDiagram = () => {
    switch (strategyId) {
      case 'ema_snapback':
        return (
          <svg viewBox="0 0 400 160" className="w-full h-32 rounded-lg bg-slate-950/40 p-2 border border-purple-500/10">
            {/* 9 EMA Curve */}
            <path d="M 20 120 Q 150 110 380 90" fill="none" stroke="#A855F7" strokeWidth="2" strokeDasharray="4 3" />
            <text x="340" y="80" fill="#A855F7" className="text-[10px] font-black uppercase">9 EMA</text>

            {/* Exhaustion Candles */}
            <rect x="50" y="60" width="12" height="30" fill="#10B981" rx="1" />
            <line x1="56" y1="50" x2="56" y2="100" stroke="#10B981" strokeWidth="1.5" />
            
            <rect x="80" y="40" width="12" height="25" fill="#10B981" rx="1" />
            <line x1="86" y1="30" x2="86" y2="75" stroke="#10B981" strokeWidth="1.5" />

            <rect x="110" y="20" width="12" height="25" fill="#10B981" rx="1" />
            <line x1="116" y1="10" x2="116" y2="55" stroke="#10B981" strokeWidth="1.5" />

            {/* Reversion/Snapback Candle */}
            <rect x="140" y="28" width="12" height="28" fill="#EF4444" rx="1" />
            <line x1="146" y1="20" x2="146" y2="65" stroke="#EF4444" strokeWidth="1.5" />

            {/* Snapback Arrow */}
            <path d="M 146 35 L 146 100" fill="none" stroke="#A855F7" strokeWidth="2" markerEnd="url(#arrow)" />
            <text x="160" y="70" fill="#A855F7" className="text-[10px] font-bold">Rubber-band Snapback</text>
            
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#A855F7" />
              </marker>
            </defs>
          </svg>
        );
      case 'morning_snapback':
        return (
          <svg viewBox="0 0 400 160" className="w-full h-32 rounded-lg bg-slate-950/40 p-2 border border-emerald-500/10">
            {/* VWAP Line */}
            <line x1="20" y1="100" x2="380" y2="100" stroke="#10B981" strokeWidth="2" strokeDasharray="3 3" />
            <text x="340" y="90" fill="#10B981" className="text-[10px] font-black uppercase">VWAP</text>

            {/* Open Momentum */}
            <rect x="40" y="60" width="12" height="30" fill="#10B981" rx="1" />
            <rect x="70" y="40" width="12" height="30" fill="#10B981" rx="1" />
            
            {/* Profit-taking pullback to VWAP */}
            <rect x="100" y="65" width="12" height="20" fill="#EF4444" rx="1" />
            <rect x="130" y="80" width="12" height="20" fill="#EF4444" rx="1" />

            {/* Bounce off VWAP & Breakout Continuation */}
            <rect x="160" y="75" width="12" height="20" fill="#10B981" rx="1" />
            <rect x="190" y="45" width="12" height="35" fill="#10B981" rx="1" />
            <path d="M 136 100 Q 155 100 195 40" fill="none" stroke="#22C55E" strokeWidth="2" markerEnd="url(#green_arrow)" />
            
            <defs>
              <marker id="green_arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#22C55E" />
              </marker>
            </defs>
          </svg>
        );
      case 'upper_circuit':
        return (
          <svg viewBox="0 0 400 160" className="w-full h-32 rounded-lg bg-slate-950/40 p-2 border border-blue-500/10">
            {/* Upper Circuit Ceiling */}
            <line x1="20" y1="30" x2="380" y2="30" stroke="#3B82F6" strokeWidth="2" strokeDasharray="5 3" />
            <text x="310" y="23" fill="#3B82F6" className="text-[10px] font-black uppercase">Upper Circuit</text>

            {/* Compression phase */}
            <circle cx="50" cy="110" r="4" fill="#64748B" />
            <circle cx="80" cy="108" r="4" fill="#64748B" />
            <circle cx="110" cy="112" r="4" fill="#64748B" />
            <line x1="45" y1="120" x2="120" y2="120" stroke="#475569" strokeWidth="1.5" />
            <text x="50" y="135" fill="#64748B" className="text-[9px] font-bold">NR4/NR7 Contraction</text>

            {/* Surge toward UC */}
            <rect x="150" y="85" width="12" height="25" fill="#3B82F6" rx="1" />
            <rect x="180" y="60" width="12" height="35" fill="#3B82F6" rx="1" />
            <rect x="210" y="32" width="12" height="40" fill="#3B82F6" rx="1" />
            <path d="M 120 120 C 150 110 180 80 215 35" fill="none" stroke="#3B82F6" strokeWidth="2" markerEnd="url(#blue_arrow)" />

            <defs>
              <marker id="blue_arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#3B82F6" />
              </marker>
            </defs>
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-slate-900/60 border border-slate-850 rounded-2xl p-4 shadow-xl backdrop-blur-md space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <GraduationCap className="w-5 h-5" style={{ color: config.color }} />
        <div>
          <h4 className="text-xs font-black text-white uppercase tracking-wider">Learning Laboratory</h4>
          <p className="text-[10px] text-slate-500 font-medium">Master the underlying technical mechanics of {config.badgeLabel}</p>
        </div>
      </div>

      {/* Visual Diagram */}
      <div className="space-y-2">
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Strategy Visual Thesis</span>
        {renderStrategyDiagram()}
      </div>

      {/* Accordion Questions */}
      <div className="space-y-2 pt-2 border-t border-slate-800/40">
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Under the Hood</span>
        <div className="space-y-1.5">
          {config.learningNotes.map((note, index) => {
            const isOpen = openIndex === index;
            return (
              <div 
                key={index} 
                className={`rounded-xl border transition-all duration-200 ${
                  isOpen ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-950/30 border-slate-900 hover:border-slate-850'
                }`}
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="w-full flex items-center justify-between p-3 text-left"
                >
                  <div className="flex items-start gap-2.5">
                    <Lightbulb className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] font-bold text-slate-200 leading-snug">
                      {index === 0 ? "What is the core edge of this setup?" : index === 1 ? "How do we enter and manage risk?" : "What is the rubber band effect?"}
                    </span>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="p-3 pt-0 text-[10.5px] text-slate-400 font-medium leading-relaxed border-t border-slate-900/60">
                        {note}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
