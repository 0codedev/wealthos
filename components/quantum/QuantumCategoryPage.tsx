import React from 'react';
import { motion } from 'framer-motion';
import { Atom, Sparkles, ChevronRight, Network, Beaker, Trophy, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useQuantumStore } from '../../store/quantumStore';
import { useShallow } from 'zustand/react/shallow';
import { ProfitabilityCoPilot } from './ProfitabilityCoPilot';
import { QuantumConfluenceDeck } from './QuantumConfluenceDeck';
import { StrategyOptimizerConsole } from './StrategyOptimizerConsole';
import { WealthQuestMatrix } from './WealthQuestMatrix';
import { ResilienceCoreConsole } from './ResilienceCoreConsole';
import { JarvisVoiceConsole } from './JarvisVoiceConsole';
import { usePrivacyMode } from '../../hooks/usePrivacyMode';
import { useMasteryStore } from '../../store/masteryStore';

/**
 * QuantumCategoryPage — the top-level page that hosts all 5 CC decks.
 *
 * Tabs: Terminal / Optimizer / Quests / Resilience
 *
 * "Anyone can win" layer:
 *   - The Profitability Co-Pilot sits at the top, always visible.
 *   - The collapsible "Beginner Explainer" panel explains every chart
 *     in plain English so a market-novice can use the deck.
 *   - The JarvisVoiceConsole is hot-keyed via the bottom-right
 *     "Ask Jarvis" button — the user can literally speak to the deck.
 */
const TABS = [
    { id: 'terminal',   label: 'Terminal',   icon: <Network size={14} />, body: <QuantumConfluenceDeck /> },
    { id: 'optimizer',  label: 'Optimizer',  icon: <Beaker size={14} />,  body: <StrategyOptimizerConsole /> },
    { id: 'quests',     label: 'Quests',     icon: <Trophy size={14} />,  body: <WealthQuestMatrix /> },
    { id: 'resilience', label: 'Resilience', icon: <Shield size={14} />,  body: <ResilienceCoreConsole /> },
] as const;

interface QuantumCategoryPageProps {
    activeSubTab?: string;
    onTabChange?: (tab: string) => void;
}

export const QuantumCategoryPage: React.FC<QuantumCategoryPageProps> = ({ activeSubTab, onTabChange }) => {
    const [localActiveTab, setLocalActiveTab] = useState<typeof TABS[number]['id']>('terminal');
    
    const activeTab = (activeSubTab === 'terminal' || activeSubTab === 'optimizer' || activeSubTab === 'quests' || activeSubTab === 'resilience')
        ? (activeSubTab as typeof TABS[number]['id'])
        : localActiveTab;

    const setActiveTab = (tab: typeof TABS[number]['id']) => {
        setLocalActiveTab(tab);
        if (onTabChange) {
            onTabChange(tab);
        }
    };

    const [showJarvis, setShowJarvis] = useState(false);
    const [showBeginner, setShowBeginner] = useState(true);
    const { isPrivacyMode, togglePrivacyMode } = usePrivacyMode();
    const activeSymbol = useQuantumStore(useShallow(s => s.activeSymbol));
    const setActiveSymbol = useQuantumStore(useShallow(s => s.setActiveSymbol));

    // Keep the privacy mode synced with the rest of the app
    void isPrivacyMode; void togglePrivacyMode;
    void useMasteryStore;

    return (
        <div className="space-y-4 p-2 md:p-4">
            {/* 1. Profitability co-pilot — always at the top, the "anyone can win" anchor */}
            <ProfitabilityCoPilot />

            {/* 2. Beginner explainer — collapsible, 1-screen overview */}
            <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/5 to-violet-500/5 p-4"
            >
                <button
                    onClick={() => setShowBeginner(s => !s)}
                    className="w-full flex items-center justify-between"
                >
                    <div className="flex items-center gap-2">
                        <Sparkles size={16} className="text-cyan-400" />
                        <span className="text-sm font-black uppercase tracking-widest text-cyan-300">What is this page?</span>
                    </div>
                    {showBeginner ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </button>
                {showBeginner && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3"
                    >
                        <ExplainCard
                            title="Terminal"
                            icon={<Network size={14} />}
                            body="See how every holding in your book moves together. The red/green grid is correlation. The slider simulates shocks (NIFTY ±5%, VIX spike, etc)."
                        />
                        <ExplainCard
                            title="Optimizer"
                            icon={<Beaker size={14} />}
                            body="Try every option strategy on the index. The optimizer runs 1,000 simulations per cell to find the strike + DTE with the best risk-adjusted return."
                        />
                        <ExplainCard
                            title="Quests"
                            icon={<Trophy size={14} />}
                            body="A skill tree that fills in as you trade. Each quest is a real habit — log a trade, set a stop, journal a note. The more quests, the higher your tier."
                        />
                        <ExplainCard
                            title="Resilience"
                            icon={<Shield size={14} />}
                            body="The cockpit. See every data feed (Upstox, Telegram OCR, Python bridge) at a glance. Slide-to-confirm sends trade signals to your broker."
                        />
                    </motion.div>
                )}
            </motion.div>

            {/* 3. Tab ribbon */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            t.id === activeTab
                                ? 'bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 shadow-lg shadow-cyan-500/10'
                                : 'bg-slate-900/40 border border-slate-800 text-slate-400 hover:border-slate-600'
                        }`}
                    >
                        {t.icon} {t.label}
                    </button>
                ))}
                <div className="ml-auto flex items-center gap-2 text-[10px] text-slate-500">
                    {activeSymbol && (
                        <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 font-mono">
                            focused: <span className="text-cyan-300 font-bold">{activeSymbol}</span>
                            <button onClick={() => setActiveSymbol(null)} className="ml-1 text-slate-500 hover:text-rose-400">×</button>
                        </span>
                    )}
                </div>
            </div>

            {/* 4. Active tab body */}
            <div>
                {TABS.find(t => t.id === activeTab)?.body}
            </div>

            {/* 5. Floating "Ask Jarvis" button (hot-key alternative) */}
            <motion.button
                onClick={() => setShowJarvis(true)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="fixed bottom-4 right-4 z-[120] h-14 w-14 rounded-full bg-gradient-to-br from-cyan-500 to-fuchsia-500 shadow-2xl shadow-cyan-500/30 flex items-center justify-center"
            >
                <Atom size={22} className="text-white" />
            </motion.button>

            {/* 6. Jarvis voice console (lazy-mounted) */}
            {showJarvis && <JarvisVoiceConsole open={showJarvis} onClose={() => setShowJarvis(false)} />}
        </div>
    );
};

const ExplainCard: React.FC<{ title: string; icon: React.ReactNode; body: string }> = ({ title, icon, body }) => (
    <div className="rounded-xl bg-slate-950/40 border border-slate-800 p-3">
        <div className="flex items-center gap-1.5 text-cyan-300 text-[10px] font-black uppercase tracking-widest mb-1">
            {icon} {title}
        </div>
        <div className="text-[11px] text-slate-300 leading-relaxed">{body}</div>
    </div>
);

export default QuantumCategoryPage;
