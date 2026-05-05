import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Keyboard, X, Search, Command, Zap, Navigation, Shield, Sparkles } from 'lucide-react';
import { ShortcutDefinition } from '../../hooks/useKeyboardShortcuts';

interface KeyboardHelpOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    shortcuts: ShortcutDefinition[];
}

export const KeyboardHelpOverlay: React.FC<KeyboardHelpOverlayProps> = ({
    isOpen,
    onClose,
    shortcuts
}) => {
    const [filterQuery, setFilterQuery] = useState('');

    // Contextual & additional shortcuts for full reference
    const allShortcuts = useMemo(() => {
        const extraContextual: ShortcutDefinition[] = [
            { key: 'Esc', description: 'Close any open modal or overlay', category: 'General', action: () => {} },
            { key: '?', description: 'Toggle Keyboard Shortcut Guide', category: 'General', action: () => {} },
            { key: 'Ctrl+F', description: 'Focus Search Bar', category: 'General', action: () => {} },
            { key: 'Ctrl+Shift+D', description: 'Toggle Dark / Light Theme', category: 'General', action: () => {} },
            { key: 'Alt+→', description: 'Next Sub-tab', category: 'Sub-Tabs', action: () => {} },
            { key: 'Alt+←', description: 'Previous Sub-tab', category: 'Sub-Tabs', action: () => {} },
            { key: 'Alt+1..9', description: 'Jump to Sub-tab index 1-9', category: 'Sub-Tabs', action: () => {} },
            { key: 'Ctrl+I', description: 'Open Statement Import Modal', category: 'Spending Analytics', action: () => {} },
            { key: 'Ctrl+A', description: 'Open Add Manual Transaction Modal', category: 'Spending Analytics', action: () => {} },
            { key: '1', description: 'Switch to Tab 1 inside modal', category: 'Modals', action: () => {} },
            { key: '2', description: 'Switch to Tab 2 inside modal', category: 'Modals', action: () => {} },
            { key: 'Enter', description: 'Submit form / confirm modal action', category: 'Modals', action: () => {} },
            { key: 'T', description: 'Toggle Treemap ↔ Table view', category: 'TradeFinder', action: () => {} },
            { key: 'G', description: 'Toggle "Show All" sectors view', category: 'TradeFinder', action: () => {} },
            { key: 'R', description: 'Refresh sector & market data', category: 'TradeFinder', action: () => {} },
            { key: '↑ / ↓', description: 'Navigate active items / list rows', category: 'Lists & Tables', action: () => {} }
        ];

        // Format global shortcuts into unified list
        const registered = shortcuts.map(s => {
            const parts: string[] = [];
            if (s.ctrlKey || s.metaKey) parts.push('Ctrl');
            if (s.altKey) parts.push('Alt');
            if (s.shiftKey) parts.push('Shift');
            parts.push(s.key.toUpperCase());
            return {
                ...s,
                formattedKey: parts.join('+')
            };
        });

        const mergedMap = new Map<string, { keyDisplay: string; description: string; category: string }>();

        registered.forEach(s => {
            mergedMap.set(`${s.category}:${s.description}`, {
                keyDisplay: s.formattedKey,
                description: s.description,
                category: s.category
            });
        });

        extraContextual.forEach(s => {
            if (!mergedMap.has(`${s.category}:${s.description}`)) {
                mergedMap.set(`${s.category}:${s.description}`, {
                    keyDisplay: s.key,
                    description: s.description,
                    category: s.category
                });
            }
        });

        return Array.from(mergedMap.values());
    }, [shortcuts]);

    const filteredList = useMemo(() => {
        if (!filterQuery.trim()) return allShortcuts;
        const q = filterQuery.toLowerCase();
        return allShortcuts.filter(
            item =>
                item.description.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q) ||
                item.keyDisplay.toLowerCase().includes(q)
        );
    }, [allShortcuts, filterQuery]);

    // Group by category
    const grouped = useMemo(() => {
        const map: Record<string, typeof filteredList> = {};
        filteredList.forEach(item => {
            if (!map[item.category]) map[item.category] = [];
            map[item.category].push(item);
        });
        return map;
    }, [filteredList]);

    if (!isOpen) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[99999] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-3xl shadow-2xl my-auto overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                            <Keyboard size={22} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white font-display flex items-center gap-2">
                                Keyboard Command Reference
                                <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    Keyboard-First Active
                                </span>
                            </h2>
                            <p className="text-xs text-slate-400">Press keys to navigate instantly without a mouse</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        aria-label="Close shortcuts guide"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Search Bar inside Modal */}
                <div className="p-4 border-b border-slate-800/60 bg-slate-950/40">
                    <div className="relative">
                        <Search className="absolute left-3.5 top-3 text-slate-500" size={16} />
                        <input
                            type="text"
                            placeholder="Filter shortcuts (e.g. 'TradeFinder', 'Ctrl+N', 'Modal')..."
                            value={filterQuery}
                            onChange={e => setFilterQuery(e.target.value)}
                            autoFocus
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                        />
                    </div>
                </div>

                {/* Shortcut Categories */}
                <div className="p-6 max-h-[60vh] overflow-y-auto space-y-6 custom-scrollbar">
                    {Object.keys(grouped).length === 0 ? (
                        <div className="text-center py-10 text-slate-500 text-xs">
                            No matching shortcuts found for &quot;{filterQuery}&quot;
                        </div>
                    ) : (
                        Object.entries(grouped).map(([category, items]) => (
                            <div key={category} className="space-y-2.5">
                                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <Sparkles size={12} className="text-indigo-400" />
                                    {category}
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {items.map((item, idx) => (
                                        <div
                                            key={`${category}-${idx}`}
                                            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-slate-800/80 hover:border-slate-700 transition-colors"
                                        >
                                            <span className="text-xs text-slate-300 font-medium">
                                                {item.description}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                {item.keyDisplay.split('+').map((k, i) => (
                                                    <kbd
                                                        key={i}
                                                        className="px-2 py-1 rounded-md text-[10px] font-mono font-bold bg-slate-900 text-slate-200 border border-slate-700 shadow-sm"
                                                    >
                                                        {k}
                                                    </kbd>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer Hint */}
                <div className="p-4 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                        Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[10px]">?</kbd> anytime to toggle this view
                    </span>
                    <span className="text-indigo-400 font-medium flex items-center gap-1">
                        <Zap size={12} /> WealthOS Pro Keyboard Workflow
                    </span>
                </div>
            </div>
        </div>,
        document.body
    );
};
