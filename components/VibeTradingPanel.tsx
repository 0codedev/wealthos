import React, { useState, useEffect } from 'react';
import { VibeTradingService } from '../services/VibeTradingService';
import { ExternalLink, RefreshCw, Globe, Server, Terminal, Play } from 'lucide-react';

export const VibeTradingPanel: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [scheduledJobs, setScheduledJobs] = useState<any[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showLaunchModal, setShowLaunchModal] = useState(false);

  const isLocalEnv = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '::1'
  );

  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    const online = await VibeTradingService.checkHealth();
    setIsOnline(online);
    if (online) {
      const jobs = await VibeTradingService.getScheduledResearchJobs();
      setScheduledJobs(jobs);
    }
  };

  const handleRefreshHealth = async () => {
    setIsChecking(true);
    await checkHealth();
    setIsChecking(false);
  };

  const handleServerAction = () => {
    if (isLocalEnv) {
      if (isOnline) {
        window.open('http://localhost:8899', '_blank');
      } else {
        setShowLaunchModal(true);
      }
    } else {
      window.open('https://vibe.wealthos-sudhanshu.xyz', '_blank');
    }
  };

  const handleSwitchEnv = () => {
    if (isLocalEnv) {
      window.open('https://vibe.wealthos-sudhanshu.xyz', '_blank');
    } else {
      window.open('http://localhost:8899', '_blank');
    }
  };

  const handleRunPrompt = async (customPrompt?: string) => {
    const activePrompt = customPrompt || prompt;
    if (!activePrompt.trim()) return;

    setLoading(true);
    setOutput(null);

    try {
      const res = await VibeTradingService.runPrompt(activePrompt);
      setOutput(res.output || JSON.stringify(res, null, 2));
    } catch (err: any) {
      setOutput(`Error: ${err.message || 'Failed to execute research prompt'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadStatus('Uploading trade journal CSV...');
    try {
      const res = await VibeTradingService.uploadTradeJournal(file);
      setUploadStatus(`Journal uploaded successfully! Target file: ${res.file || 'Dhan CSV'}`);
      handleRunPrompt(`Analyze my uploaded trade journal ${res.file} for behavioral biases, win rate, and drawdown.`);
    } catch (err: any) {
      setUploadStatus(`Upload failed: ${err.message}`);
    }
  };

  return (
    <div className="p-6 bg-slate-950 text-slate-100 min-h-screen font-sans space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/80 p-4 rounded-xl border border-slate-800 backdrop-blur-md shadow-lg">
        <div className="flex items-center space-x-3">
          <span className="text-3xl">🤖</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                Vibe-Trading AI Workspace
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                {isLocalEnv ? '💻 Local Dev' : '🌐 Cloud VPS'}
              </span>
            </div>
            <p className="text-xs text-slate-400">76 MCP Quantitative Tools • Indian Equity Engine (NSE/BSE) • Shadow Account</p>
          </div>
        </div>

        {/* Header Action Control Pills */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Health Status Pill */}
          <button
            onClick={handleRefreshHealth}
            title="Click to re-check API health status"
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-[1.02] cursor-pointer ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20'
            }`}
          >
            <span className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`}></span>
            <span>{isOnline ? (isLocalEnv ? 'Local Active (8899)' : 'VPS Cloud Online') : 'Server Offline'}</span>
            <RefreshCw className={`w-3.5 h-3.5 ml-2 text-slate-400 ${isChecking ? 'animate-spin' : ''}`} />
          </button>

          {/* Dynamic Server Action Button */}
          <button
            onClick={handleServerAction}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border border-emerald-400/30"
          >
            {isLocalEnv ? (
              isOnline ? (
                <>
                  <Server className="w-3.5 h-3.5" />
                  <span>Open Local App (:8899)</span>
                  <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-80" />
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Local Server</span>
                </>
              )
            ) : (
              <>
                <Globe className="w-3.5 h-3.5" />
                <span>Launch Cloud Subdomain</span>
                <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-80" />
              </>
            )}
          </button>

          {/* Environment Switcher Button */}
          <button
            onClick={handleSwitchEnv}
            title={isLocalEnv ? 'Switch to production cloud app' : 'Switch to local development server'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700 hover:border-slate-600 transition-all cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>{isLocalEnv ? 'Cloud App ↗' : 'Local Dev ↗'}</span>
          </button>
        </div>
      </div>

      {/* Local Server Launch Helper Modal */}
      {showLaunchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-slate-100">Start Local Vibe-Trading Server</h3>
              </div>
              <button 
                onClick={() => setShowLaunchModal(false)}
                className="text-slate-400 hover:text-white font-mono text-sm px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              The local Vibe-Trading FastAPI server on port <code className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400 font-mono">8899</code> is currently offline.
            </p>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Option 1: Windows Launcher</div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 font-mono text-xs text-emerald-400 select-all">
                run_dev_ready.bat
              </div>

              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pt-2">Option 2: Terminal Command</div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 font-mono text-xs text-cyan-300 select-all">
                cd vibe-trading && .venv\Scripts\vibe-trading.exe serve --port 8899
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => { handleRefreshHealth(); setShowLaunchModal(false); }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                Re-check Connection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Swarms & Presets */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <button
          onClick={() => handleRunPrompt('Scan NSE Nifty 50 stocks for 52-week breakouts with rising FII volume')}
          className="p-3 bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/40 rounded-xl text-left transition-all"
        >
          <div className="text-xs text-emerald-400 font-semibold mb-1">🔍 NSE Screener</div>
          <div className="text-sm font-medium">Nifty 50 Breakouts</div>
        </button>

        <button
          onClick={() => handleRunPrompt('Backtest a 20/50 moving average crossover strategy on RELIANCE.NS for 2024')}
          className="p-3 bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 hover:border-teal-500/40 rounded-xl text-left transition-all"
        >
          <div className="text-xs text-teal-400 font-semibold mb-1">📈 Backtest Engine</div>
          <div className="text-sm font-medium">RELIANCE 20/50 EMA</div>
        </button>

        <button
          onClick={() => handleRunPrompt('Run investment committee swarm debate on HDFCBANK.NS current valuation and risk')}
          className="p-3 bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 hover:border-cyan-500/40 rounded-xl text-left transition-all"
        >
          <div className="text-xs text-cyan-400 font-semibold mb-1">👥 Multi-Agent Swarm</div>
          <div className="text-sm font-medium">HDFCBANK Committee</div>
        </button>

        <button
          onClick={() => handleRunPrompt('Benchmark Alpha101 zoo signals on NIFTY50 universe for top Sharpe factors')}
          className="p-3 bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 hover:border-violet-500/40 rounded-xl text-left transition-all"
        >
          <div className="text-xs text-violet-400 font-semibold mb-1">⚡ Alpha Zoo</div>
          <div className="text-sm font-medium">Alpha101 Benchmark</div>
        </button>
      </div>

      {/* Main Research Console */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Natural Language Quant Assistant</h2>
        <div className="flex space-x-3">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRunPrompt()}
            placeholder="e.g. Backtest momentum strategy on NSE Midcap 150 for 2024 with STT tax costs..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
          />
          <button
            onClick={() => handleRunPrompt()}
            disabled={loading}
            className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-sm transition-all disabled:opacity-50"
          >
            {loading ? 'Analyzing...' : 'Run Prompt'}
          </button>
        </div>

        {/* Output Viewer */}
        {output && (
          <div className="mt-4 bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 max-h-96 overflow-y-auto whitespace-pre-wrap">
            {output}
          </div>
        )}
      </div>

      {/* Shadow Account & Active Crons Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Shadow Account Upload */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-200">Shadow Account Trading Coach</h3>
            <span className="text-xs text-slate-400">Dhan / Broker CSV</span>
          </div>
          <p className="text-xs text-slate-400">Upload your trade journal CSV to analyze win rate, disposition bias, and rule compliance counterfactuals.</p>

          <label className="block w-full border-2 border-dashed border-slate-800 hover:border-emerald-500/40 rounded-xl p-4 text-center cursor-pointer transition-all">
            <span className="text-xs text-slate-300 font-semibold">📁 Click to Upload Dhan CSV</span>
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          </label>

          {uploadStatus && <div className="text-xs text-emerald-400 font-mono">{uploadStatus}</div>}
        </div>

        {/* Scheduled Research Jobs */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-200">Scheduled Research Crons (Oracle VPS)</h3>
            <span className="text-xs text-emerald-400 font-semibold">4 Active</span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg flex justify-between items-center">
              <div>
                <div className="font-semibold text-slate-200">NSE Pre-Market Scan</div>
                <div className="text-slate-500">8:45 AM IST Mon-Fri → Telegram #26</div>
              </div>
              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20 text-[10px]">15 3 * * *</span>
            </div>

            <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg flex justify-between items-center">
              <div>
                <div className="font-semibold text-slate-200">FII / DII Flow Analysis</div>
                <div className="text-slate-500">4:30 PM IST Mon-Fri → Telegram #26</div>
              </div>
              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20 text-[10px]">0 11 * * *</span>
            </div>

            <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg flex justify-between items-center">
              <div>
                <div className="font-semibold text-slate-200">Thursday F&O Max Pain</div>
                <div className="text-slate-500">Thursday 9:30 AM IST → Telegram #26</div>
              </div>
              <span className="px-2 py-0.5 bg-teal-500/10 text-teal-400 rounded border border-teal-500/20 text-[10px]">0 4 * * 4</span>
            </div>

            <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg flex justify-between items-center">
              <div>
                <div className="font-semibold text-slate-200">Sunday Weekly Risk X-Ray</div>
                <div className="text-slate-500">Sunday 8:00 PM IST → Telegram #26</div>
              </div>
              <span className="px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded border border-violet-500/20 text-[10px]">30 14 * * 0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
