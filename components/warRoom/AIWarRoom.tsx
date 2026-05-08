import React, { useState } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { agentOrchestrator, WarRoomReport } from '../../services/warRoom/AgentOrchestrator';
import { AgentCard } from './AgentCard';
import { SynthesisPanel } from './SynthesisPanel';
import {
  Sparkles, Send, HelpCircle, BarChart3, AlertOctagon
} from 'lucide-react';

export const AIWarRoom: React.FC = () => {
  const [query, setQuery] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [report, setReport] = useState<WarRoomReport | null>(null);
  
  const investments = usePortfolioStore(s => s.investments);

  const handleRunSwarm = async (textToSend?: string) => {
    const targetQuery = (textToSend || query).trim();
    if (!targetQuery || isThinking) return;

    if (!textToSend) setQuery('');
    setIsThinking(true);
    setReport(null);

    // Build context snippet
    const totalVal = investments.reduce((sum, i) => sum + (i.currentValue || 0), 0);
    const topHoldings = [...investments]
      .sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0))
      .slice(0, 3)
      .map(h => `${h.name}: ₹${h.currentValue?.toLocaleString() || 'N/A'}`)
      .join(', ');
    const contextSnippet = `Portfolio contains ${investments.length} holdings. Total value is ₹${totalVal.toLocaleString()}. Top holdings are ${topHoldings}.`;

    try {
      const res = await agentOrchestrator.runResearchSwarm(targetQuery, contextSnippet);
      if (res) {
        setReport(res);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Search / Command Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">AI War Room Orchestrator</h3>
        </div>
        
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRunSwarm();
          }}
          className="flex items-center gap-3"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a research topic, e.g. 'Should I add to RELIANCE this week?'"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
            disabled={isThinking}
          />
          <button
            type="submit"
            disabled={!query.trim() || isThinking}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-850 disabled:text-slate-650 text-white font-bold py-2.5 px-5 rounded-xl text-xs flex items-center gap-2 transition-colors cursor-pointer shadow-md shadow-indigo-600/10"
          >
            <Send size={12} /> Run Swarm
          </button>
        </form>

        {/* Suggestion Chips */}
        {!report && !isThinking && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/40">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mr-1">Templates:</span>
            {[
              'Should I add more banking exposure this week?',
              'Is it time to harvest losses or hold tight?',
              'Analyze current India VIX levels and Nifty support.'
            ].map((s) => (
              <button
                key={s}
                onClick={() => handleRunSwarm(s)}
                className="text-[10px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:border-indigo-500/50 hover:text-white transition-colors cursor-pointer"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Agents Output Grid */}
      {(report || isThinking) && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <AgentCard role="BULL" text={report?.bull || ''} isThinking={isThinking} />
            <AgentCard role="BEAR" text={report?.bear || ''} isThinking={isThinking} />
            <AgentCard role="QUANT" text={report?.quant || ''} isThinking={isThinking} />
            <AgentCard role="RISK" text={report?.risk || ''} isThinking={isThinking} />
          </div>

          {/* Synthesis Verdict Panel */}
          <SynthesisPanel consensus={report?.judge || null} isThinking={isThinking} />
        </div>
      )}
    </div>
  );
};
export default AIWarRoom;
