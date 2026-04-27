import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Brain, 
  Play, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Cpu, 
  Database, 
  BarChart3,
  ChevronRight,
  Terminal,
  Save
} from 'lucide-react';
import { agenticService, AgenticJobStatus } from '../../../services/agenticService';
import { db } from '../../../database';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const AgenticLab: React.FC = () => {
  const [ticker, setTicker] = useState('');
  const [activeJob, setActiveJob] = useState<AgenticJobStatus | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archived, setArchived] = useState(false);

  // Polling logic
  useEffect(() => {
    let pollInterval: any;

    if (isAnalyzing && activeJob?.job_id) {
      pollInterval = setInterval(async () => {
        try {
          const status = await agenticService.checkStatus(activeJob.job_id);
          setActiveJob(status);
          
          if (status.status === 'completed' || status.status === 'failed') {
            setIsAnalyzing(false);
            clearInterval(pollInterval);
          }
        } catch (err) {
          console.error('Polling error:', err);
          setError('Lost connection to TradingAgents Bridge.');
          setIsAnalyzing(false);
          clearInterval(pollInterval);
        }
      }, 5000); // Poll every 5 seconds
    }

    return () => clearInterval(pollInterval);
  }, [isAnalyzing, activeJob?.job_id]);

  const handleStartAnalysis = async () => {
    if (!ticker) return;
    setError(null);
    setIsAnalyzing(true);
    
    try {
      const jobId = await agenticService.startAnalysis(ticker);
      setActiveJob({
        job_id: jobId,
        ticker: ticker,
        status: 'pending',
        stats: { llm_calls: 0, tool_calls: 0, tokens_in: 0, tokens_out: 0 }
      });
    } catch (err) {
      setError('Could not reach the TradingAgents Bridge. Ensure bridge.py is running.');
      setIsAnalyzing(false);
    }
  };

  const handleArchive = async () => {
    if (!activeJob?.result) return;
    setIsArchiving(true);
    try {
      // Find the most recent trade for this ticker to link the AI report
      const lastTrade = await db.trades
        .where('ticker')
        .equals(activeJob.ticker)
        .reverse()
        .first();

      if (lastTrade?.id) {
        await agenticService.archiveToTrade(lastTrade.id, activeJob.result);
        setArchived(true);
        setTimeout(() => setArchived(false), 3000);
      } else {
        setError('No existing trade found for this ticker to archive to.');
      }
    } catch (err) {
      console.error('Archive error:', err);
      setError('Failed to archive report to database.');
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-6 overflow-hidden">
      {/* Header & Input */}
      <div className="flex items-center justify-between p-6 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-white/20 dark:border-slate-800/50 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
            <Brain className="w-6 h-6 text-indigo-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Agentic Intelligence Lab</h2>
            <p className="text-sm text-slate-500">Summon the 9-Agent Council for Deep Market Research</p>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="relative">
            <input 
              type="text"
              placeholder="Enter Ticker (e.g. RELIANCE.NS)"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="px-4 py-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none w-64 text-sm font-medium transition-all"
            />
          </div>
          <button 
            onClick={handleStartAnalysis}
            disabled={isAnalyzing || !ticker}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all shadow-lg ${
              isAnalyzing 
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed' 
                : 'bg-indigo-600 hover:bg-indigo-700 text-white hover:scale-105'
            }`}
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isAnalyzing ? 'Analyzing...' : 'Trigger Council'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">
        {/* Left Column: Progress & Stats */}
        <div className="flex flex-col gap-6">
          {/* Progress Board */}
          <div className="p-6 bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Flight Recorder</span>
              </div>
              {isAnalyzing && (
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse delay-75" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse delay-150" />
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar">
              {!activeJob ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                  <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center mb-4">
                    <Cpu className="w-8 h-8 text-slate-600" />
                  </div>
                  <p className="text-xs text-slate-500 font-medium italic">"System Idle. Waiting for ticker initiation..."</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Current Phase</span>
                      <span className="text-[10px] font-mono text-emerald-500">{activeJob.status.toUpperCase()}</span>
                    </div>
                    <p className="text-sm text-slate-200 font-medium">{activeJob.current_phase || 'Initializing Graph...'}</p>
                  </div>

                  {/* Real-time Stats Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Cpu className="w-3 h-3 text-indigo-400" />
                        <span className="text-[9px] text-indigo-400 uppercase font-bold">LLM Calls</span>
                      </div>
                      <span className="text-lg font-mono text-white">{activeJob.stats.llm_calls}</span>
                    </div>
                    <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Database className="w-3 h-3 text-amber-400" />
                        <span className="text-[9px] text-amber-400 uppercase font-bold">Tool Calls</span>
                      </div>
                      <span className="text-lg font-mono text-white">{activeJob.stats.tool_calls}</span>
                    </div>
                  </div>

                  <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="w-3 h-3 text-emerald-400" />
                      <span className="text-[9px] text-emerald-400 uppercase font-bold">Token Consumption</span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[8px] text-slate-500 uppercase">Input</p>
                        <p className="text-sm font-mono text-white">{(activeJob.stats.tokens_in / 1000).toFixed(1)}k</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] text-slate-500 uppercase">Output</p>
                        <p className="text-sm font-mono text-white">{(activeJob.stats.tokens_out / 1000).toFixed(1)}k</p>
                      </div>
                    </div>
                    <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, (activeJob.stats.llm_calls / 15) * 100)}%` }}
                        className="h-full bg-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4 p-3 bg-rose-500/10 rounded-xl border border-rose-500/20 flex items-center gap-3">
                <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                <p className="text-xs text-rose-500 font-medium leading-tight">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Debate Transcript Viewer */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-indigo-500" />
              </div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Council Transcript</h3>
            </div>
            
            {activeJob?.status === 'completed' && (
              <button 
                onClick={handleArchive}
                disabled={isArchiving || archived}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all shadow-md ${
                  archived ? 'bg-emerald-100 text-emerald-600' : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                }`}
              >
                {isArchiving ? <Loader2 className="w-3 h-3 animate-spin" /> : archived ? <CheckCircle2 className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                {archived ? 'Archived!' : 'Archive to Journal'}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/30 dark:bg-slate-900/30">
            {activeJob?.status === 'completed' && activeJob.result ? (
              <div className="prose prose-slate dark:prose-invert max-w-none">
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mb-4" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-xl font-bold text-slate-800 dark:text-white mt-8 mb-4 pb-2 border-b border-slate-200 dark:border-slate-800" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-6 mb-3" {...props} />,
                    blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/5 p-4 rounded-r-xl italic my-4" {...props} />,
                    table: ({node, ...props}) => <div className="overflow-x-auto my-6"><table className="min-w-full border-collapse border border-slate-200 dark:border-slate-800 rounded-xl" {...props} /></div>,
                    th: ({node, ...props}) => <th className="bg-slate-100 dark:bg-slate-800 p-3 text-left text-xs font-bold uppercase text-slate-500 border border-slate-200 dark:border-slate-800" {...props} />,
                    td: ({node, ...props}) => <td className="p-3 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800" {...props} />,
                    p: ({node, ...props}) => <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 mb-4" {...props} />
                  }}
                >
                  {activeJob.result.report_md}
                </ReactMarkdown>
              </div>
            ) : isAnalyzing ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                <p className="text-sm font-medium text-slate-500">The Council is deliberating...</p>
                <p className="text-[10px] text-slate-400 mt-2 italic">Typically takes 5-7 minutes for full multi-agent consensus</p>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center py-20">
                <div className="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-6">
                  <Brain className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                </div>
                <h4 className="text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest text-xs mb-2">Transcript Vault Empty</h4>
                <p className="text-slate-500 text-sm max-w-xs mx-auto">Trigger the council to generate a full, word-for-word debate history for your trade thesis.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
