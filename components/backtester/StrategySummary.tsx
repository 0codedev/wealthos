import React from 'react';
import { StrategyDefinition } from '../../types/backtester.types';
import { BarChart3, Shield, Zap, Target, Coins, ChevronRight } from 'lucide-react';

interface StrategySummaryProps {
  strategy: StrategyDefinition;
  initialCapital: number;
}

export const StrategySummary: React.FC<StrategySummaryProps> = ({ strategy, initialCapital }) => {
  const SummaryCard = ({ icon: Icon, label, value, colorClass = "text-white" }: { icon: any, label: string, value: string | React.ReactNode, colorClass?: string }) => (
    <div className="flex items-center gap-4 p-4 glass-panel rounded-2xl flex-1">
      <div className="p-3 bg-white/10 dark:bg-black/30 rounded-xl border border-white/10 dark:border-slate-800/40">
        <Icon className="text-indigo-400" size={18} />
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
        <span className={`text-base font-bold tracking-wide mt-0.5 ${colorClass}`}>{value}</span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Live Manifesto</h2>
          <p className="text-xs font-medium text-slate-400 tracking-wider mt-1">Real-time Strategy Synthesis</p>
        </div>
        <div className="px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
          <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest animate-pulse">Online</span>
        </div>
      </div>

      <div className="flex-1 bg-white/5 dark:bg-black/10 rounded-[2rem] border border-white/5 dark:border-slate-800/40 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6">
        {/* Core Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard 
            icon={BarChart3} 
            label="Asset Class" 
            value={strategy.assetClass} 
            colorClass="text-indigo-400"
          />
          <SummaryCard 
            icon={Coins} 
            label="Initial Capital" 
            value={`₹ ${initialCapital.toLocaleString()}`} 
          />
          <SummaryCard 
            icon={Shield} 
            label="Risk Protocol" 
            value={strategy.positionSizing.type.split('_').join(' ')} 
          />
          <SummaryCard 
            icon={Target} 
            label="Exposure" 
            value={`${strategy.positionSizing.value}${strategy.positionSizing.type === 'PERCENT_OF_CAPITAL' ? '%' : ' UNIT'}`} 
          />
        </div>

        {/* Rules Layout */}
        {(strategy.entryRules.length > 0 || strategy.exitRules.length > 0 || (strategy.assetClass === 'Options' && strategy.legs)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
            {strategy.entryRules.length > 0 && (
              <div className="glass-panel p-5 rounded-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-amber-500/10 rounded-xl border border-amber-500/20">
                    <Zap className="text-amber-400" size={16} />
                  </div>
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Entry Pipeline</span>
                </div>
                <div className="space-y-3">
                  {strategy.entryRules.map((rule, idx) => {
                    const leftLabel = rule.leftIndicator.toUpperCase() + (rule.leftPeriod ? `(${rule.leftPeriod})` : '');
                    let opLabel = rule.operator as string;
                    if (rule.operator === 'GREATER_THAN') opLabel = '>';
                    else if (rule.operator === 'LESS_THAN') opLabel = '<';
                    else if (rule.operator === 'GREATER_EQUAL') opLabel = '>=';
                    else if (rule.operator === 'LESS_EQUAL') opLabel = '<=';
                    else if (rule.operator === 'EQUALS') opLabel = '=';
                    else if (rule.operator === 'NOT_EQUALS') opLabel = '!=';
                    else if (rule.operator === 'CROSSES_ABOVE') opLabel = '⊗';
                    else if (rule.operator === 'CROSSES_BELOW') opLabel = '⊖';
                    else if (rule.operator === 'IS_TRUE') opLabel = 'is True';
                    else if (rule.operator === 'BETWEEN') opLabel = 'Between';
                    
                    let rightLabel = '';
                    if (rule.operator !== 'IS_TRUE') {
                      if (rule.rightType === 'VALUE') {
                        if (rule.operator === 'BETWEEN') {
                          rightLabel = `${rule.rightValue} & ${rule.rightValueHigh}`;
                        } else {
                          rightLabel = String(rule.rightValue !== undefined ? rule.rightValue : '');
                        }
                      } else {
                        rightLabel = (rule.rightIndicator || '').toUpperCase() + (rule.rightPeriod ? `(${rule.rightPeriod})` : '');
                      }
                    }

                    return (
                      <div key={idx} className="flex items-center gap-2 text-xs font-medium text-slate-200 tracking-wide flex-wrap">
                        {idx > 0 && <span className="text-indigo-400 font-bold text-[10px] bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded mr-1">{rule.logic}</span>}
                        <ChevronRight size={12} className="text-amber-500 shrink-0" />
                        <span>{leftLabel}</span>
                        <span className="text-indigo-400 font-bold">{opLabel}</span>
                        <span className="text-white font-semibold">{rightLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {strategy.exitRules.length > 0 && (
              <div className="glass-panel p-5 rounded-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                    <Shield className="text-emerald-400" size={16} />
                  </div>
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Risk Guard</span>
                </div>
                <div className="space-y-3">
                  {strategy.exitRules.map((rule, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs font-medium text-slate-200 tracking-wide">
                      <div className="flex items-center gap-2">
                        <ChevronRight size={12} className="text-emerald-500 shrink-0" />
                        <span>{rule.type.replace(/_/g, ' ')}</span>
                      </div>
                      <span className="text-white font-semibold">{rule.value}{rule.unit === 'PERCENT' ? '%' : rule.unit === 'ABSOLUTE' ? '₹' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {strategy.assetClass === 'Options' && strategy.legs && (
              <div className="glass-panel p-5 rounded-2xl col-span-1 lg:col-span-2">
                <div className="flex items-center gap-3 mb-3">
                   <Zap className="text-indigo-400" size={14} />
                   <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Leg Structure</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {strategy.legs.map((leg, idx) => (
                    <div key={idx} className="px-3 py-2 bg-slate-900/80 rounded border border-slate-700 text-xs font-semibold uppercase tracking-wide flex items-center justify-between">
                      <span className={leg.action === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>{leg.action}</span>
                      <span className="text-slate-300">{leg.strikeSelection} {leg.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 glass-panel p-4 rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Logic Complexity</p>
            <span className="text-xs font-semibold text-white">LVL {strategy.entryRules.length + strategy.exitRules.length}</span>
          </div>
          <div className="w-2/3 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-indigo-500" 
              style={{ width: `${Math.min((strategy.entryRules.length + strategy.exitRules.length) * 10, 100)}%` }} 
            />
          </div>
        </div>
        <div className="flex-1 glass-panel p-4 rounded-2xl flex flex-col justify-center">
           <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Capital Load</p>
           <p className="text-base font-bold text-white">{(strategy.positionSizing.value).toFixed(1)}% <span className="text-slate-400 text-xs font-normal ml-1">ALLOC</span></p>
        </div>
      </div>
    </div>
  );
};
