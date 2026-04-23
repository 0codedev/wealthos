import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard } from 'lucide-react';

const formatShortcut = (s: any) => {
    const parts: string[] = [];
    if (s.ctrlKey) parts.push('Ctrl');
    if (s.altKey) parts.push('Alt');
    if (s.shiftKey) parts.push('Shift');
    if (s.metaKey) parts.push('Cmd');
    
    const keyDisplay = s.key === ' ' ? 'Space' : s.key.toUpperCase();
    parts.push(keyDisplay);
    return parts.join(' + ');
};

interface ShortcutItem {
    key: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    description: string;
}

interface KeyboardShortcutsHelpProps {
    isOpen: boolean;
    onClose: () => void;
    shortcuts: ShortcutItem[];
}

/**
 * Keyboard shortcuts help modal
 * Press ? to open, Escape to close
 */
export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
    isOpen,
    onClose,
    shortcuts,
}) => {
    // Group shortcuts by category
    const navigationShortcuts = shortcuts.filter(s => s.altKey);
    const actionShortcuts = shortcuts.filter(s => s.ctrlKey);
    const generalShortcuts = shortcuts.filter(s => !s.altKey && !s.ctrlKey);

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl 
                                   shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="shortcuts-title"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2">
                                <Keyboard className="w-5 h-5 text-indigo-500" />
                                <h2 id="shortcuts-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                                    Keyboard Shortcuts
                                </h2>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white 
                                           rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800
                                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                aria-label="Close"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-4 max-h-[60vh] overflow-y-auto">
                            {/* General */}
                            <ShortcutGroup title="General" shortcuts={generalShortcuts} />

                            {/* Actions */}
                            <ShortcutGroup title="Actions" shortcuts={actionShortcuts} />

                            {/* Navigation */}
                            <ShortcutGroup title="Navigation" shortcuts={navigationShortcuts} />
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                                Press <kbd className="px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded text-xs font-mono">?</kbd> anytime to show this help
                            </p>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

// Shortcut group component
const ShortcutGroup: React.FC<{ title: string; shortcuts: ShortcutItem[] }> = ({ title, shortcuts }) => {
    if (shortcuts.length === 0) return null;

    return (
        <div className="mb-6 last:mb-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                {title}
            </h3>
            <div className="space-y-2">
                {shortcuts.map((shortcut, index) => (
                    <div
                        key={index}
                        className="flex items-center justify-between py-2 px-3 rounded-lg
                                   bg-slate-50 dark:bg-slate-800/50"
                    >
                        <span className="text-sm text-slate-700 dark:text-slate-300">
                            {shortcut.description}
                        </span>
                        <ShortcutKeys shortcut={shortcut} />
                    </div>
                ))}
            </div>
        </div>
    );
};

// Shortcut keys display
const ShortcutKeys: React.FC<{ shortcut: ShortcutItem }> = ({ shortcut }) => {
    const parts: string[] = [];

    if (shortcut.ctrlKey) parts.push('Ctrl');
    if (shortcut.altKey) parts.push('Alt');
    if (shortcut.shiftKey) parts.push('Shift');

    const keyDisplay = shortcut.key === 'Escape' ? 'Esc' :
        shortcut.key === ' ' ? 'Space' :
            shortcut.key.length === 1 ? shortcut.key.toUpperCase() :
                shortcut.key;
    parts.push(keyDisplay);

    return (
        <div className="flex items-center gap-1">
            {parts.map((part, index) => (
                <React.Fragment key={part}>
                    <kbd className="px-2 py-1 bg-white dark:bg-slate-700 border border-slate-300 
                                    dark:border-slate-600 rounded text-xs font-mono text-slate-700 
                                    dark:text-slate-300 shadow-sm">
                        {part}
                    </kbd>
                    {index < parts.length - 1 && (
                        <span className="text-slate-400">+</span>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
};

export default KeyboardShortcutsHelp;
