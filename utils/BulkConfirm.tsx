/**
 * CC109 — Bulk action typed confirmation.
 *
 * Production apps that perform destructive bulk actions (delete all,
 * reset, clear) require the user to **type a confirmation phrase** before
 * the action button enables. This is the "type the project name" pattern
 * from GitHub repo deletion, the "type DELETE" pattern from AWS, and the
 * "type the ticker" pattern from Robinhood position close.
 *
 * Why this matters:
 *   - Catches the "I clicked the wrong button" case
 *   - Forces the user to consciously engage with what they're about to do
 *   - Provides a clear "I really mean it" signal that screen readers can
 *     announce ("Type DELETE to confirm")
 *
 * This module ships:
 *   1. `BulkConfirmDialog` — a modal that asks the user to type a phrase
 *   2. `useBulkConfirm` — a hook that returns an `ask()` function and a
 *      promise-resolving state machine
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { useToast } from '../components/shared/ToastProvider';

export interface BulkConfirmOptions {
    /** Title shown in the modal. */
    title: string;
    /** Description of what will happen. */
    description: React.ReactNode;
    /** Phrase the user must type to enable the action. Case-insensitive. */
    confirmationPhrase: string;
    /** Optional label for the confirm button. */
    confirmLabel?: string;
    /** Variant — destructive is the default. */
    variant?: 'destructive' | 'caution';
}

interface BulkConfirmDialogProps extends BulkConfirmOptions {
    open: boolean;
    onCancel: () => void;
    onConfirm: () => void | Promise<void>;
}

export const BulkConfirmDialog: React.FC<BulkConfirmDialogProps> = ({
    open,
    title,
    description,
    confirmationPhrase,
    confirmLabel = 'Confirm',
    variant = 'destructive',
    onCancel,
    onConfirm,
}) => {
    const [typed, setTyped] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset on open.
    useEffect(() => {
        if (open) {
            setTyped('');
            setSubmitting(false);
            // Focus after the modal animates in.
            const t = setTimeout(() => inputRef.current?.focus(), 200);
            return () => clearTimeout(t);
        }
    }, [open]);

    const matches = typed.trim().toLowerCase() === confirmationPhrase.trim().toLowerCase();

    const handleConfirm = async () => {
        if (!matches || submitting) return;
        setSubmitting(true);
        try {
            await onConfirm();
        } finally {
            setSubmitting(false);
        }
    };

    const palette = variant === 'destructive'
        ? { icon: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-100 dark:bg-rose-500/15', btn: 'bg-rose-600 hover:bg-rose-500' }
        : { icon: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-500/15', btn: 'bg-amber-600 hover:bg-amber-500' };

    return (
        <AnimatePresence>
            {open && (
                <RouteErrorBoundary routeName="Bulk confirm dialog">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="bulk-confirm-title"
                        className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
                            onClick={onCancel}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-md w-full p-6"
                        >
                            <div className="flex items-start gap-4 mb-4">
                                <div className={`flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full ${palette.bg}`}>
                                    <AlertTriangle size={24} className={palette.icon} />
                                </div>
                                <div className="flex-1">
                                    <h2 id="bulk-confirm-title" className="text-lg font-bold text-slate-900 dark:text-white">
                                        {title}
                                    </h2>
                                    <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                        {description}
                                    </div>
                                </div>
                                <button
                                    onClick={onCancel}
                                    aria-label="Cancel"
                                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="mt-4">
                                <label htmlFor="bulk-confirm-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Type <span className="font-mono text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{confirmationPhrase}</span> to confirm
                                </label>
                                <input
                                    ref={inputRef}
                                    id="bulk-confirm-input"
                                    type="text"
                                    value={typed}
                                    onChange={(e) => setTyped(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && matches) handleConfirm();
                                        if (e.key === 'Escape') onCancel();
                                    }}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-500/30 focus:border-rose-400 transition-all"
                                />
                            </div>

                            <div className="mt-6 flex items-center justify-end gap-2">
                                <button
                                    onClick={onCancel}
                                    className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={!matches || submitting}
                                    className={`px-4 py-2 rounded-xl text-sm font-bold text-white ${palette.btn} disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
                                >
                                    {submitting ? 'Working…' : confirmLabel}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                </RouteErrorBoundary>
            )}
        </AnimatePresence>
    );
};

/**
 * Hook that gives any component a `ask(options)` function. The function
 * returns a Promise that resolves to `true` if the user confirmed, or
 * `false` if they cancelled.
 *
 * Example:
 *   const { ask, dialog } = useBulkConfirm();
 *   const handleDeleteAll = async () => {
 *       const ok = await ask({
 *           title: 'Delete all 1,234 trades?',
 *           description: 'This will permanently remove every trade in your journal. This action cannot be undone.',
 *           confirmationPhrase: 'delete all trades',
 *           confirmLabel: 'Delete everything',
 *       });
 *       if (ok) doDelete();
 *   };
 *
 *   return (
 *       <>
 *           <button onClick={handleDeleteAll}>Delete all</button>
 *           {dialog}
 *       </>
 *   );
 */
export function useBulkConfirm(): {
    ask: (options: BulkConfirmOptions) => Promise<boolean>;
    dialog: React.ReactNode;
} {
    const [state, setState] = useState<{
        options: BulkConfirmOptions | null;
        resolve: ((v: boolean) => void) | null;
    }>({ options: null, resolve: null });

    const ask = useCallback((options: BulkConfirmOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            setState({ options, resolve });
        });
    }, []);

    const handleCancel = useCallback(() => {
        state.resolve?.(false);
        setState({ options: null, resolve: null });
    }, [state.resolve]);

    const handleConfirm = useCallback(async () => {
        if (!state.resolve) return;
        // Close the dialog first so the caller's `await` doesn't block
        // on the dialog's exit animation.
        const resolve = state.resolve;
        setState({ options: null, resolve: null });
        resolve(true);
    }, [state.resolve]);

    const dialog = state.options ? (
        <BulkConfirmDialog
            open
            {...state.options}
            onCancel={handleCancel}
            onConfirm={handleConfirm}
        />
    ) : null;

    return { ask, dialog };
}

/**
 * Convenience: a one-shot call that just shows a confirmation toast +
 * runs the action. Use for low-stakes "are you sure?" cases that don't
 * need a full dialog.
 */
export function quickConfirm(message: string, onConfirm: () => void | Promise<void>): void {
    if (typeof window !== 'undefined' && window.confirm(message)) {
        void Promise.resolve(onConfirm()).catch((e) => {
            useToast; // (intentional placeholder; the consuming app context owns the toast)
            if (typeof console !== 'undefined') console.error('[quickConfirm]', e);
        });
    }
}

export default BulkConfirmDialog;
