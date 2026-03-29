
import React, { useState } from 'react';
import { Lock, Key, ArrowRight, ShieldCheck, AlertTriangle, Sparkles, ExternalLink } from 'lucide-react';

interface ApiKeyManagerProps {
  onKeySubmit: (key: string) => void;
}

const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({ onKeySubmit }) => {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedKey = keyInput.trim();
    
    if (!cleanedKey) {
      setError('Please enter a valid API Key');
      return;
    }

    // Basic validation for Google API Keys
    if (!cleanedKey.startsWith('AIza')) {
      setError('Invalid Key format. Google API keys usually start with "AIza"');
      return;
    }

    // Save to storage
    localStorage.setItem('gemini-api-key', cleanedKey);
    
    // Notify parent
    onKeySubmit(cleanedKey);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950 relative overflow-hidden font-sans selection:bg-indigo-500/30">
      {/* Background Elements matching the app theme */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[120px]"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150"></div>
      </div>

      <div className="relative z-10 w-full max-w-md p-6 animate-in fade-in zoom-in duration-300">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-8 backdrop-blur-xl relative overflow-hidden">
          {/* Top light accent */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>

          <div className="flex flex-col items-center text-center mb-8 mt-2">
            <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-6 shadow-inner border border-slate-200 dark:border-slate-700 group relative">
                <div className="absolute inset-0 bg-indigo-500/20 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <Lock className="text-indigo-500 group-hover:scale-110 transition-transform duration-300 relative z-10" size={28} />
            </div>
            
            <h1 className="text-3xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">
              Welcome
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium leading-relaxed">
              Enter your Gemini API Key to unlock your <br/> <span className="text-indigo-600 dark:text-indigo-400 font-bold">Wealth Aggregator</span>.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1 flex items-center gap-1">
                Your API Key
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Key className="text-slate-400 dark:text-slate-500 group-focus-within:text-indigo-600 dark:group-focus-within:text-indigo-400 transition-colors" size={18} />
                </div>
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value);
                    setError('');
                  }}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-sm rounded-xl pl-11 pr-4 py-4 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600 shadow-inner"
                  placeholder="Enter your secret API Key"
                  autoFocus
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-rose-500 text-xs font-bold animate-in slide-in-from-top-1 px-1">
                  <AlertTriangle size={12} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] group"
            >
              <span>Save & Continue</span>
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800/50">
            <div className="flex flex-col items-center gap-4">
                <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noreferrer"
                    className="flex items-center gap-2 text-xs font-bold text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-white transition-colors bg-indigo-500/10 px-4 py-2 rounded-full border border-indigo-500/20 hover:border-indigo-500/50 hover:bg-indigo-500/20 group"
                >
                    <Sparkles size={14} className="text-indigo-500 dark:text-indigo-400 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors"/>
                    Get a free Gemini API Key
                    <ExternalLink size={12} className="opacity-50"/>
                </a>
                
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <ShieldCheck size={12} className="text-emerald-500" />
                    <span>Keys are stored locally on your device.</span>
                </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyManager;
