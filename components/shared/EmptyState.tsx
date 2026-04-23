import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, Plus, Upload, Search, FileText, BarChart3, Bell, Settings, Inbox } from 'lucide-react';

export type EmptyStateType =
    | 'no-data'
    | 'no-investments'
    | 'no-results'
    | 'no-trades'
    | 'no-alerts'
    | 'error'
    | 'setup-required'
    | 'mce';

interface EmptyStateProps {
    icon?: LucideIcon;
    title?: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    secondaryActionLabel?: string;
    onSecondaryAction?: () => void;
    variant?: 'default' | 'minimal' | 'card';
    /** Pillar 3A: short-hand vocabulary mapping. Overrides icon/title/description defaults. */
    type?: EmptyStateType;
    /** Pillar 3A: short message, used with `type` for "no-trades" + message. */
    message?: string;
}

// Pillar 3A: 7-type vocabulary with default copy. Consumers can still pass
// icon/title/description/actionLabel explicitly to override.
const TYPE_DEFAULTS: Record<EmptyStateType, { icon: LucideIcon; title: string; description: string }> = {
    'no-data': {
        icon: Inbox,
        title: 'Nothing here yet',
        description: 'Once you start tracking, your data will show up here.',
    },
    'no-investments': {
        icon: Plus,
        title: 'No investments yet',
        description: 'Add your first asset to start tracking your portfolio.',
        // actionLabel is the caller's job — they know the modal to open.
    },
    'no-results': {
        icon: Search,
        title: 'No results found',
        description: 'Try adjusting your filters or search terms.',
    },
    'no-trades': {
        icon: BarChart3,
        title: 'No trades yet',
        description: 'Log your first trade to see your expectancy curve, edge matrix, and pattern insights.',
    },
    'no-alerts': {
        icon: Bell,
        title: 'You\'re all caught up',
        description: 'No active alerts. We\'ll ping you when something important happens.',
    },
    'error': {
        icon: Settings,
        title: 'Something went wrong',
        description: 'We hit a snag loading this. Try again, or check your connection.',
    },
    'setup-required': {
        icon: Settings,
        title: 'Setup required',
        description: 'A few quick steps and this will be ready to go.',
    },
    'mce': {
        icon: BarChart3,
        title: 'No ticker selected',
        description: 'Open Dashboard → Smart Watchlist → expand a row → click "Score in Alpha Engine →". The Momentum Continuation Score will load here in ~1s.',
    },
};

const entry = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

export const EmptyState: React.FC<EmptyStateProps> = ({
    icon: IconProp,
    title: titleProp,
    description: descriptionProp,
    actionLabel,
    onAction,
    secondaryActionLabel,
    onSecondaryAction,
    variant = 'default',
    type,
    message,
}) => {
    // Pillar 3A: if `type` is supplied, use the vocabulary defaults unless the
    // caller explicitly overrode icon/title/description.
    const defaults = type ? TYPE_DEFAULTS[type] : undefined;
    const Icon = IconProp ?? defaults?.icon ?? FileText;
    const title = titleProp ?? defaults?.title ?? 'Nothing to show';
    // `message` is the Pillar 3A-friendly second-line copy; falls back to description.
    const description = descriptionProp ?? message ?? defaults?.description;
    if (variant === 'minimal') {
        return (
            <motion.div
                initial={entry.initial}
                animate={entry.animate}
                className="text-center py-8"
            >
                <Icon size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
                {description && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{description}</p>
                )}
                {actionLabel && onAction && (
                    <button
                        onClick={onAction}
                        className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors inline-flex items-center gap-2"
                    >
                        <Plus size={14} /> {actionLabel}
                    </button>
                )}
            </motion.div>
        );
    }

    if (variant === 'card') {
        return (
            <motion.div
                initial={entry.initial}
                animate={entry.animate}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center"
            >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
                    <Icon size={28} className="text-slate-400 dark:text-slate-500" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{title}</h3>
                {description && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
                        {description}
                    </p>
                )}
                <div className="flex items-center justify-center gap-3">
                    {actionLabel && onAction && (
                        <button
                            onClick={onAction}
                            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors inline-flex items-center gap-2"
                        >
                            <Plus size={18} /> {actionLabel}
                        </button>
                    )}
                    {secondaryActionLabel && onSecondaryAction && (
                        <button
                            onClick={onSecondaryAction}
                            className="px-6 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-2"
                        >
                            <Upload size={18} /> {secondaryActionLabel}
                        </button>
                    )}
                </div>
            </motion.div>
        );
    }

    // Default variant
    return (
        <motion.div
            initial={entry.initial}
            animate={entry.animate}
            className="flex flex-col items-center justify-center py-12 px-4"
        >
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center mb-4">
                <Icon size={36} className="text-slate-400 dark:text-slate-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{title}</h3>
            {description && (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md mb-6">
                    {description}
                </p>
            )}
            <div className="flex items-center gap-3">
                {actionLabel && onAction && (
                    <button
                        onClick={onAction}
                        className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-medium hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/25 inline-flex items-center gap-2"
                    >
                        <Plus size={18} /> {actionLabel}
                    </button>
                )}
                {secondaryActionLabel && onSecondaryAction && (
                    <button
                        onClick={onSecondaryAction}
                        className="px-6 py-3 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-2"
                    >
                        {secondaryActionLabel}
                    </button>
                )}
            </div>
        </motion.div>
    );
};

export default EmptyState;
