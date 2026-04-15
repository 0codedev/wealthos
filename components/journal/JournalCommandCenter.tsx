
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Command, Search, X, Zap,
    Calendar, LayoutDashboard, Grid,
    Filter, TrendingUp, TrendingDown, AlertTriangle, Shield, Settings,
    ArrowUp, ArrowDown, CornerDownLeft, Brain
} from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import { EmptyState } from '../shared/EmptyState';
import { NoiseTexture } from '../ui/NoiseTexture';

// Define Command Types
type CommandAction = {
    id: string;
    label: string;
    icon: any;
    shortcut?: string;
    group: 'Navigation' | 'Actions' | 'Filters';
    action: () => void;
};

const JournalCommandCenter: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Toggle Command Center
    useHotkeys('ctrl+k, meta+k', (e) => {
        e.preventDefault();
        setIsOpen(prev => !prev);
    });

    // Close on Escape
    useHotkeys('escape', () => setIsOpen(false));

    // Define Actions
    const commands: CommandAction[] = useMemo(() => [
        // Navigation
        { id: 'nav-analytics', label: 'Go to Analytics', icon: LayoutDashboard, group: 'Navigation', action: () => dispatchNav('ANALYTICS') },
        { id: 'nav-journal', label: 'Go to Journal', icon: Calendar, group: 'Navigation', action: () => dispatchNav('JOURNAL') },
        { id: 'nav-playbook', label: 'Go to Playbook', icon: Grid, group: 'Navigation', action: () => dispatchNav('PLAYBOOK') },
        { id: 'nav-mirror', label: 'Open Mirror of Truth', icon: Shield, group: 'Navigation', action: () => dispatchNav('MIRROR') },

        // Actions
        { id: 'act-trade', label: 'Log New Trade', icon: Zap, group: 'Actions', shortcut: 'CTRL+N', action: () => dispatchAction('NEW_TRADE') },
        { id: 'act-review', label: 'Add Daily Review', icon: LayoutDashboard, group: 'Actions', action: () => dispatchAction('DAILY_REVIEW') },
        { id: 'act-speedrun', label: 'Speed-Run Journaling', icon: Brain, group: 'Actions', action: () => dispatchNav('REVIEW') },

        // Filters (Mock for now, could dispatch event to filter trades)
        { id: 'filt-wins', label: 'Show Recent Wins', icon: TrendingUp, group: 'Filters', action: () => { /* TODO: dispatch filter event */ } },
        { id: 'filt-losses', label: 'Show Recent Losses', icon: TrendingDown, group: 'Filters', action: () => { /* TODO: dispatch filter event */ } },
    ], []);

    // Dispatch Events for PsychDashboard to catch
    const dispatchNav = (view: string) => {
        window.dispatchEvent(new CustomEvent('PSYCH_NAVIGATE', { detail: view }));
        setIsOpen(false);
    };

    const dispatchAction = (action: string) => {
        window.dispatchEvent(new CustomEvent('PSYCH_ACTION', { detail: action }));
        setIsOpen(false);
    };

    // Filter Commands
    const filteredCommands = useMemo(() => {
        if (!query) return commands;
        return commands.filter(cmd =>
            cmd.label.toLowerCase().includes(query.toLowerCase()) ||
            cmd.group.toLowerCase().includes(query.toLowerCase())
        );
    }, [query, commands]);

    // Keyboard Navigation
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(i => (i + 1) % filteredCommands.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = filteredCommands[selectedIndex];
                if (cmd) cmd.action();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, filteredCommands, selectedIndex]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-sm flex items-start justify-center pt-[20vh]"
                role="dialog" aria-modal="true" aria-labelledby="journal-command-center-title"
                onClick={() => setIsOpen(false)}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -20 }}
                    transition={{ type: "spring", damping: 25, stiffness: 300 }}
                    className="w-full max-w-2xl bg-slate-900/90 border border-indigo-500/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col backdrop-blur-xl relative"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Background Noise */}
                    <div className="absolute inset-0 pointer-events-none opacity-50 mix-blend-overlay">
                        <NoiseTexture opacity={0.1} />
                    </div>

                    {/* Search Input */}
                    <div className="flex items-center gap-3 p-4 border-b border-white/5 relative z-10">
                        <Search className="text-indigo-400" size={20} />
                        <input
                            autoFocus
                            type="text"
                            placeholder="Type a command or filter..."
                            className="flex-1 bg-transparent text-lg text-white placeholder-slate-500 outline-none font-medium"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <div className="flex items-center gap-2">
                            <span className="px-2 py-1 rounded bg-slate-800 text-[10px] font-mono text-slate-400 border border-slate-700">ESC</span>
                        </div>
                    </div>

                    {/* Results Area */}
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar relative z-10 py-2">
                        {filteredCommands.length === 0 ? (
                            <EmptyState
                                variant="minimal"
                                type="no-results"
                                message="No results found."
                            />
                        ) : (
                            <div className="space-y-1 px-2">
                                {/* Group by type logic if needed, simplify flat list for speed */}
                                {filteredCommands.map((cmd, index) => (
                                    <button
                                        key={cmd.id}
                                        onClick={cmd.action}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                        className={`w-full flex items-center justify-between px-3 py-3 rounded-xl transition-all group text-left ${index === selectedIndex ? 'bg-indigo-600/20 text-white' : 'text-slate-400 hover:bg-white/5'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${index === selectedIndex ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500'
                                                }`}>
                                                <cmd.icon size={16} />
                                            </div>
                                            <span className={`font-medium ${index === selectedIndex ? 'text-indigo-300' : 'text-slate-300'}`}>
                                                {cmd.label}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {cmd.shortcut && (
                                                <span className="text-[10px] font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 border border-slate-700">
                                                    {cmd.shortcut}
                                                </span>
                                            )}
                                            {index === selectedIndex && (
                                                <CornerDownLeft size={14} className="text-indigo-400 animate-pulse" />
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="p-3 bg-slate-950/50 border-t border-white/5 flex justify-between items-center text-xs text-slate-500 relative z-10">
                        <div className="flex gap-4">
                            <span className="flex items-center gap-1"><ArrowUp size={10} /> <ArrowDown size={10} /> Navigate</span>
                            <span className="flex items-center gap-1"><CornerDownLeft size={10} /> Select</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Command size={12} /> <span className="font-mono text-indigo-400">COMMAND CENTER</span>
                        </div>
                    </div>

                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default JournalCommandCenter;
