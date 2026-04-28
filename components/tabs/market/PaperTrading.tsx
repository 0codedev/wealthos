
import React, { useState } from 'react';
import { TradeJournal } from './TradeJournal';
import { LiveSimulator } from './LiveSimulator';
import { MarketReplay } from './MarketReplay';
import { AlgoTradingDesk } from './AlgoTradingDesk';
import {
    Activity, ClipboardList, MonitorPlay, Layers,
    ChevronRight, Info, Bot
} from 'lucide-react';

export const PaperTrading: React.FC = () => {
    // Mode State
    const [mode, setMode] = useState<'ALGO' | 'LEGACY'>('ALGO');
    
    // Legacy sub-mode State
    const [legacySubMode, setLegacySubMode] = useState<'LIVE' | 'REPLAY' | 'JOURNAL'>('LIVE');

    return (
        <div className="space-y-6 pb-20 animate-in fade-in duration-500">

            {/* Header / Mode Switcher */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg shadow-indigo-500/5">

                {/* Logo Area */}
                <div className="flex items-center gap-3 px-4">
                    <div className="bg-fuchsia-500/10 p-2 rounded-xl">
                        <Layers className="text-fuchsia-500" size={24} />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-slate-800 dark:text-white leading-none">Paper Sandbox</h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Risk-Free Environment</p>
                    </div>
                </div>

                {/* Switcher */}
                <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl self-stretch md:self-auto flex-wrap gap-1">
                    <button
                        onClick={() => setMode('ALGO')}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${mode === 'ALGO'
                            ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-md transform scale-105'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                    >
                        <Bot size={16} /> Algo Desk
                    </button>
                    <button
                        onClick={() => setMode('LEGACY')}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${mode === 'LEGACY'
                            ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-md transform scale-105'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                    >
                        <Activity size={16} /> Legacy Simulators
                    </button>
                </div>
            </div>

            {/* Context Info Banner */}
            {mode === 'ALGO' && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30 text-indigo-800 dark:text-indigo-200 text-sm">
                    <Info size={18} className="shrink-0 mt-0.5" />
                    <p>
                        <strong>Automated Algo Desk:</strong> Test your Opening Range Breakout (ORB) strategy in real-time.
                        Runs completely inside the Dhan Sandbox environment with no capital risk. Toggle <strong>Simulation Mode</strong> to test ticks during weekends and market holidays.
                    </p>
                </div>
            )}

            {mode === 'LEGACY' && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/20 border border-slate-200 dark:border-slate-800 text-slate-750 dark:text-slate-300 text-sm">
                    <Info size={18} className="shrink-0 mt-0.5" />
                    <p>
                        <strong>Legacy Practice Arena:</strong> Explore manual simulation tools. Track manual mock transactions in the Journal, play back historical sessions with Replay, or perform manual indicators testing.
                    </p>
                </div>
            )}

            {/* Main Content Area */}
            <div className="min-h-[600px] space-y-6">
                {mode === 'ALGO' ? (
                    <AlgoTradingDesk />
                ) : (
                    <div className="space-y-6">
                        {/* Sub Tab Switcher for Legacy Tools */}
                        <div className="flex border-b border-slate-200 dark:border-slate-800 pb-1 gap-4">
                            <button
                                onClick={() => setLegacySubMode('LIVE')}
                                className={`pb-2 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 ${
                                    legacySubMode === 'LIVE'
                                        ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                                }`}
                            >
                                <Activity size={14} /> Live Simulator
                            </button>
                            <button
                                onClick={() => setLegacySubMode('REPLAY')}
                                className={`pb-2 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 ${
                                    legacySubMode === 'REPLAY'
                                        ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                                }`}
                            >
                                <MonitorPlay size={14} /> Market Replay
                            </button>
                            <button
                                onClick={() => setLegacySubMode('JOURNAL')}
                                className={`pb-2 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 ${
                                    legacySubMode === 'JOURNAL'
                                        ? 'border-fuchsia-500 text-fuchsia-600 dark:text-fuchsia-400'
                                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                                }`}
                            >
                                <ClipboardList size={14} /> Trade Journal
                            </button>
                        </div>

                        {/* Render Sub Mode Components */}
                        <div className="animate-in fade-in duration-300">
                            {legacySubMode === 'LIVE' && <LiveSimulator />}
                            {legacySubMode === 'REPLAY' && <MarketReplay isOpen={true} />}
                            {legacySubMode === 'JOURNAL' && <TradeJournal />}
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
};

