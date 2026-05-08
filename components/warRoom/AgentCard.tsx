import React from 'react';
import { AGENT_PERSONAS } from '../../services/warRoom/AgentPersonas';
import {
  TrendingUp, TrendingDown, ShieldAlert, BarChart2, Loader2
} from 'lucide-react';

interface AgentCardProps {
  role: 'BULL' | 'BEAR' | 'QUANT' | 'RISK';
  text: string;
  isThinking: boolean;
}

export const AgentCard: React.FC<AgentCardProps> = ({ role, text, isThinking }) => {
  const config = AGENT_PERSONAS[role];

  const getIcon = () => {
    switch (role) {
      case 'BULL': return <TrendingUp size={14} className="text-emerald-400" />;
      case 'BEAR': return <TrendingDown size={14} className="text-rose-400" />;
      case 'QUANT': return <BarChart2 size={14} className="text-indigo-400" />;
      case 'RISK': return <ShieldAlert size={14} className="text-amber-400" />;
    }
  };

  return (
    <div className={`bg-gradient-to-br ${config.color} border rounded-2xl p-5 flex flex-col justify-between shadow-sm min-h-[180px] hover:scale-[1.01] transition-transform`}>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/40 pb-2">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider">
            {getIcon()}
            {config.name}
          </span>
          <span className="text-[9px] font-mono text-slate-500 uppercase">{role} AGENT</span>
        </div>

        {/* Content */}
        {isThinking ? (
          <div className="flex items-center gap-2 text-slate-500 italic py-6 text-xs">
            <Loader2 size={12} className="animate-spin" /> Gathering arguments...
          </div>
        ) : (
          <div className="text-xs text-slate-300 space-y-2 leading-relaxed whitespace-pre-wrap font-mono">
            {text || 'Awaiting research command.'}
          </div>
        )}
      </div>
    </div>
  );
};
export default AgentCard;
