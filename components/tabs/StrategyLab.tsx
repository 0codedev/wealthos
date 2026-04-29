import React, { useState, useEffect, lazy, Suspense } from 'react';
import { 
    Beaker, Zap, Sliders, LineChart, Award, Clock, 
    BookOpen, TrendingUp, Layers, Play, Shield
} from 'lucide-react';
import SIPTimeMachine from './market/strategies/SIPTimeMachine';
import RebalanceAlpha from './market/strategies/RebalanceAlpha';
import StrategyBuilder from './market/strategies/StrategyBuilder';
import GTTManager from './market/strategies/GTTManager';
import MarginEstimator from './market/strategies/MarginEstimator';
import StrategyPlaybook from '../trading/StrategyPlaybook';

// Lazy loaded heavy panels
const StrategyLabV2 = lazy(() => import('../StrategyLab').then(m => ({ default: m.StrategyLab })));
const QuantDuelPanel = lazy(() => import('../alpha/QuantDuelPanel'));
const OptionsPlayground = lazy(() => import('../options/OptionsPlayground'));
const TradingViewLab = lazy(() => import('../backtester/tradingview/TradingViewLab'));

export type StrategyLabTab = 
    | 'multi-engine' 
    | 'backtest' 
    | 'tradingview' 
    | 'duel' 
    | 'simulators' 
    | 'playbook' 
    | 'options';

interface StrategyLabProps {
    initialSubTab?: string;
}

/**
 * StrategyLab - Comprehensive Quantitative Strategy & Simulation Desk
 * Features 7 dedicated engines with streamlined sub-navigation beside the header.
 */
export const StrategyLab: React.FC<StrategyLabProps> = ({ initialSubTab }) => {
    // Determine initial tab and initial engine if coming from specific route
    const getInitialTab = (): StrategyLabTab => {
        if (initialSubTab === 'vectorbt-lab' || initialSubTab === 'backtrader-lab' || initialSubTab === 'lumibot-lab') {
            return 'multi-engine';
        }
        return 'multi-engine';
    };

    const getInitialEngine = (): 'vectorbt' | 'backtrader' | 'lumibot' | 'comparison' => {
        if (initialSubTab === 'backtrader-lab') return 'backtrader';
        if (initialSubTab === 'lumibot-lab') return 'lumibot';
        return 'vectorbt';
    };

    const [activeTab, setActiveTab] = useState<StrategyLabTab>(getInitialTab);
    const [enginePreference, setEnginePreference] = useState<'vectorbt' | 'backtrader' | 'lumibot' | 'comparison'>(getInitialEngine);

    // Sync if initialSubTab prop changes
    useEffect(() => {
        if (initialSubTab === 'vectorbt-lab') {
            setActiveTab('multi-engine');
            setEnginePreference('vectorbt');
        } else if (initialSubTab === 'backtrader-lab') {
            setActiveTab('multi-engine');
            setEnginePreference('backtrader');
        } else if (initialSubTab === 'lumibot-lab') {
            setActiveTab('multi-engine');
            setEnginePreference('lumibot');
        }
    }, [initialSubTab]);

    return (
        <div className="w-full space-y-6 animate-in fade-in duration-300">
            {/* Header with Sub-Navigation Beside the Heading */}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400 shrink-0">
                        <Beaker className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white flex flex-wrap items-center gap-2">
                            Legacy Strategy Lab
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/40">
                                7 Quant Engines
                            </span>
                        </h1>
                        <p className="text-sm text-slate-400 mt-0.5">
                            Multi-engine simulation, rule prototyping, Pine Script execution, and quant duel arena
                        </p>
                    </div>
                </div>

                {/* Sub-Navigation Beside the Heading */}
                <div className="bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-800 flex flex-wrap items-center gap-1 shadow-inner">
                    <button
                        id="tab-multi-engine"
                        onClick={() => setActiveTab('multi-engine')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'multi-engine'
                                ? 'bg-emerald-600 text-white shadow-md'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                        }`}
                        title="VectorBT, Backtrader & Lumibot Multi-Engine Simulator"
                    >
                        <Zap size={13} /> Multi-Engine (VBT/BT/Lumi)
                    </button>

                    <button
                        id="tab-backtest-lab"
                        onClick={() => setActiveTab('backtest')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'backtest'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                        }`}
                        title="Strategy Rule Prototyper, GTT Manager & Margin Estimator"
                    >
                        <Sliders size={13} /> Backtest Lab
                    </button>

                    <button
                        id="tab-tradingview"
                        onClick={() => setActiveTab('tradingview')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'tradingview'
                                ? 'bg-sky-600 text-white shadow-md'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                        }`}
                        title="TradingView Pine Script Strategy Tester"
                    >
                        <LineChart size={13} /> TradingView
                    </button>

                    <button
                        id="tab-quant-duel"
                        onClick={() => setActiveTab('duel')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'duel'
                                ? 'bg-fuchsia-600 text-white shadow-md'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                        }`}
                        title="Quant Duel - User vs System Head-to-Head Arena"
                    >
                        <Award size={13} /> Quant Duel
                    </button>

                    <button
                        id="tab-simulators"
                        onClick={() => setActiveTab('simulators')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'simulators'
                                ? 'bg-amber-600 text-white shadow-md'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                        }`}
                        title="SIP Time Machine & Rebalance Alpha Simulators"
                    >
                        <Clock size={13} /> SIP & Rebalance
                    </button>

                    <button
                        id="tab-playbook"
                        onClick={() => setActiveTab('playbook')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'playbook'
                                ? 'bg-purple-600 text-white shadow-md'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                        }`}
                        title="My Strategy Playbook"
                    >
                        <BookOpen size={13} /> Playbook
                    </button>

                    <button
                        id="tab-options-lab"
                        onClick={() => setActiveTab('options')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'options'
                                ? 'bg-teal-600 text-white shadow-md'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                        }`}
                        title="Options Payoff Matrix & Greeks Playground"
                    >
                        <TrendingUp size={13} /> Options Lab
                    </button>
                </div>
            </div>

            {/* Tab Contents */}
            <div className="space-y-6">
                {activeTab === 'multi-engine' && (
                    <Suspense fallback={<div className="p-12 text-center animate-pulse text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Multi-Engine Lab...</div>}>
                        <StrategyLabV2 embedded={true} initialEngine={enginePreference} />
                    </Suspense>
                )}

                {activeTab === 'backtest' && (
                    <div className="space-y-6">
                        {/* Main Strategy Backtester */}
                        <StrategyBuilder />

                        {/* Forever Orders (GTT) Manager */}
                        <GTTManager />

                        {/* Margin Estimator */}
                        <MarginEstimator />
                    </div>
                )}

                {activeTab === 'tradingview' && (
                    <Suspense fallback={<div className="p-12 text-center animate-pulse text-xs font-bold text-slate-500 uppercase tracking-widest">Loading TradingView Strategy Tester...</div>}>
                        <TradingViewLab />
                    </Suspense>
                )}

                {activeTab === 'duel' && (
                    <Suspense fallback={<div className="p-12 text-center animate-pulse text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Quant Duel Arena...</div>}>
                        <QuantDuelPanel />
                    </Suspense>
                )}

                {activeTab === 'simulators' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        {/* SIP Time Machine */}
                        <div className="min-h-[420px] lg:h-[440px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-sm">
                            <SIPTimeMachine />
                        </div>

                        {/* Rebalance Alpha */}
                        <div className="min-h-[420px] lg:h-[440px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-sm">
                            <RebalanceAlpha />
                        </div>
                    </div>
                )}

                {activeTab === 'playbook' && (
                    <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-sm">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2 uppercase tracking-wider">
                            <BookOpen size={20} className="text-indigo-400" /> My Strategy Playbook
                        </h3>
                        <StrategyPlaybook />
                    </div>
                )}

                {activeTab === 'options' && (
                    <Suspense fallback={<div className="p-12 text-center animate-pulse text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Options Playground...</div>}>
                        <OptionsPlayground />
                    </Suspense>
                )}
            </div>
        </div>
    );
};

export default StrategyLab;

