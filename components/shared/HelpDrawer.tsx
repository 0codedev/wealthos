import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    X, HelpCircle, Map, Keyboard, BookOpen, History, Bug, 
    RotateCcw, Sparkles, ShieldCheck, Cpu, Wallet, TrendingUp, ChevronRight
} from 'lucide-react';
import { COPY } from '../../utils/appCopy';
import { useToast } from './ToastProvider';
import { useSettingsStore } from '../../store/settingsStore';

interface HelpDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onRestartTour: () => void;
}

/**
 * HelpDrawer - slide-in drawer opened from the "?" icon in the
 * top-right of the dashboard. Contains guided walkthroughs, persona tier
 * references, zero-trust security architecture notes, and keyboard shortcuts.
 */
export const HelpDrawer: React.FC<HelpDrawerProps> = ({ isOpen, onClose, onRestartTour }) => {
    const { toast } = useToast();
    const settings = useSettingsStore();
    const [view, setView] = useState<'menu' | 'shortcuts' | 'tiers' | 'security'>('menu');

    const handleRestartTour = useCallback(() => {
        if (window.confirm(COPY.help.restartTourConfirm)) {
            onRestartTour();
            toast.info(COPY.help.restartTourDone);
        }
    }, [onRestartTour, toast]);

    const handleLaunchWizard = useCallback(() => {
        onClose();
        settings.setWelcomeWizardOpen(true);
    }, [onClose, settings]);

    const handleAbout = useCallback(() => {
        const readmeUrl = `${window.location.origin}/README.md`;
        window.open(readmeUrl, '_blank', 'noopener,noreferrer');
    }, []);

    const handleChangelog = useCallback(() => {
        const changelogUrl = `${window.location.origin}/CHANGELOG.md`;
        window.open(changelogUrl, '_blank', 'noopener,noreferrer');
    }, []);

    const handleReportBug = useCallback(() => {
        const subject = encodeURIComponent('Wealth Dashboard - Bug report');
        const body = encodeURIComponent(
            `What happened?\n\n\nSteps to reproduce:\n1. \n2. \n3. \n\nExpected:\n\nActual:\n\nUser agent: ${navigator.userAgent}`
        );
        window.location.href = `mailto:support@wealth-dashboard.local?subject=${subject}&body=${body}`;
    }, []);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 z-[120] flex items-stretch justify-end"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    <div
                        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
                        onClick={onClose}
                        aria-hidden="true"
                    />
                    <motion.aside
                        role="dialog"
                        aria-modal="true"
                        aria-label={COPY.help.drawerTitle}
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                        className="relative w-full max-w-sm h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
                    >
                        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <HelpCircle size={18} className="text-indigo-500" />
                                {view === 'menu' && COPY.help.drawerTitle}
                                {view === 'shortcuts' && COPY.help.shortcuts}
                                {view === 'tiers' && 'Workspace Personas'}
                                {view === 'security' && 'Zero-Trust Architecture'}
                            </h2>
                            <button
                                onClick={onClose}
                                aria-label="Close help"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </header>

                        <div className="flex-1 overflow-y-auto p-3">
                            {view === 'menu' && (
                                <div className="space-y-1">
                                    <HelpItem
                                        icon={Sparkles}
                                        label="Launch Onboarding Wizard"
                                        hint="Configure persona, capital, and sandbox"
                                        onClick={handleLaunchWizard}
                                        accent="emerald"
                                    />
                                    <HelpItem
                                        icon={Cpu}
                                        label="Workspace Personas & Tiers"
                                        hint="Investor vs Trader vs Quant Pro"
                                        onClick={() => setView('tiers')}
                                        accent="indigo"
                                    />
                                    <HelpItem
                                        icon={ShieldCheck}
                                        label="Zero-Trust Privacy Model"
                                        hint="Client-isolated data & encrypted secrets"
                                        onClick={() => setView('security')}
                                        accent="blue"
                                    />
                                    <HelpItem
                                        icon={Keyboard}
                                        label={COPY.help.shortcuts}
                                        hint="Global hotkeys and command shortcuts"
                                        onClick={() => setView('shortcuts')}
                                    />
                                    <HelpItem
                                        icon={Map}
                                        label={COPY.help.tour}
                                        hint="Replay the guided feature walkthrough"
                                        onClick={handleRestartTour}
                                    />
                                    <HelpItem
                                        icon={BookOpen}
                                        label={COPY.help.about}
                                        hint="Architecture and project overview"
                                        onClick={handleAbout}
                                    />
                                    <HelpItem
                                        icon={History}
                                        label={COPY.help.changelog}
                                        hint="Release versions and latest updates"
                                        onClick={handleChangelog}
                                    />
                                    <HelpItem
                                        icon={Bug}
                                        label={COPY.help.reportBug}
                                        hint="Send feedback or report an issue"
                                        onClick={handleReportBug}
                                    />
                                </div>
                            )}

                            {view === 'shortcuts' && (
                                <ShortcutsList onBack={() => setView('menu')} />
                            )}

                            {view === 'tiers' && (
                                <TiersHelpView onBack={() => setView('menu')} />
                            )}

                            {view === 'security' && (
                                <SecurityHelpView onBack={() => setView('menu')} />
                            )}
                        </div>

                        <footer className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                            Press <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-mono">?</kbd> at any time to open this drawer.
                        </footer>
                    </motion.aside>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

interface HelpItemProps {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    hint?: string;
    onClick: () => void;
    accent?: 'emerald' | 'indigo' | 'blue';
}

const HelpItem: React.FC<HelpItemProps> = ({ icon: Icon, label, hint, onClick, accent }) => {
    const accentClass = 
        accent === 'emerald' ? 'text-emerald-500 bg-emerald-500/10' :
        accent === 'indigo' ? 'text-indigo-500 bg-indigo-500/10' :
        accent === 'blue' ? 'text-blue-500 bg-blue-500/10' :
        'text-slate-400 bg-slate-100 dark:bg-slate-800';

    return (
        <button
            onClick={onClick}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors group cursor-pointer"
        >
            <div className={`p-2 rounded-lg shrink-0 ${accentClass}`}>
                <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {label}
                </div>
                {hint && (
                    <div className="text-[11px] text-slate-400 dark:text-slate-400 truncate">
                        {hint}
                    </div>
                )}
            </div>
            <ChevronRight size={14} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors shrink-0" />
        </button>
    );
};

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
    { keys: ['Ctrl', 'K'], label: 'Open command palette' },
    { keys: ['Ctrl', '1-9'], label: 'Switch category' },
    { keys: ['Ctrl', 'N'], label: 'Add new trade' },
    { keys: ['Ctrl', 'B'], label: 'Toggle privacy mode' },
    { keys: ['Ctrl', 'Space'], label: 'Open Jarvis Voice' },
    { keys: ['?'], label: 'Open this help drawer' },
    { keys: ['Esc'], label: 'Close drawer / modal' },
];

const ShortcutsList: React.FC<{ onBack: () => void }> = ({ onBack }) => (
    <div className="space-y-2">
        <button
            onClick={onBack}
            className="text-[11px] font-bold uppercase tracking-widest text-indigo-500 hover:text-indigo-400 mb-2 flex items-center gap-1 cursor-pointer"
        >
            ← Back to Help Menu
        </button>
        {SHORTCUTS.map((s) => (
            <div
                key={s.label}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800"
            >
                <span className="text-xs text-slate-700 dark:text-slate-200">{s.label}</span>
                <span className="flex items-center gap-1">
                    {s.keys.map((k) => (
                        <kbd
                            key={k}
                            className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-[10px] font-mono text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-xs"
                        >
                            {k}
                        </kbd>
                    ))}
                </span>
            </div>
        ))}
    </div>
);

const TiersHelpView: React.FC<{ onBack: () => void }> = ({ onBack }) => (
    <div className="space-y-3">
        <button
            onClick={onBack}
            className="text-[11px] font-bold uppercase tracking-widest text-indigo-500 hover:text-indigo-400 mb-1 flex items-center gap-1 cursor-pointer"
        >
            ← Back to Help Menu
        </button>

        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-1">
                <Wallet size={16} /> 🌱 Investor Tier (5 Modules)
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Designed for calm, passive compounding. Prioritizes Mutual Funds, Gold Sovereign Bonds, SIP schedules, and long-term financial freedom goals without intraday noise.
            </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center gap-2 text-blue-400 font-bold text-sm mb-1">
                <TrendingUp size={16} /> ⚡ Trader Tier (12 Modules)
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Tailored for active positional and swing traders. Unlocks Trade Finder, Alpha Scanner, Sector Heatmaps, Breakout alerts, and tactical execution tools.
            </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
            <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm mb-1">
                <Cpu size={16} /> 🔬 Quant Pro Tier (All 19 Modules)
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Institutional prop desk cockpit. Access live Telegram Ears, OpenAlgo Python execution engine, Option Greeks calculation, Scalp simulation, and AI hyperparameter tuning.
            </p>
        </div>
    </div>
);

const SecurityHelpView: React.FC<{ onBack: () => void }> = ({ onBack }) => (
    <div className="space-y-3">
        <button
            onClick={onBack}
            className="text-[11px] font-bold uppercase tracking-widest text-indigo-500 hover:text-indigo-400 mb-1 flex items-center gap-1 cursor-pointer"
        >
            ← Back to Help Menu
        </button>

        <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-1.5 flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-400" />
                Zero-Trust Multi-Tenant Containers
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Every user runs in a dedicated, isolated sandbox. Your trades, portfolio holdings, and strategies are stored in local client IndexedDB and are never shared or visible to other users.
            </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-1.5 flex items-center gap-2">
                <ShieldCheck size={16} className="text-indigo-400" />
                Hardware-Encrypted Broker Secrets
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Broker keys (Dhan / Upstox) and LLM API tokens are encrypted with AES-256 before storage and are never baked into public production builds or broadcast over unauthenticated channels.
            </p>
        </div>
    </div>
);

export default HelpDrawer;
