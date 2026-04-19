import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Bell, X, CheckCheck, Trash2, Download, AlertTriangle, 
    TrendingUp, ShieldAlert, Info, Clock, Filter, CheckCircle2 
} from 'lucide-react';
import { 
    notificationPersistenceService, 
    PersistedNotification 
} from '../../services/NotificationPersistenceService';

interface NotificationCenterDrawerProps {
    isOpen: boolean;
    onClose: () => void;
}

export const NotificationCenterDrawer: React.FC<NotificationCenterDrawerProps> = ({ isOpen, onClose }) => {
    const [notifications, setNotifications] = useState<PersistedNotification[]>([]);
    const [activeFilter, setActiveFilter] = useState<'all' | 'alerts' | 'trades' | 'system' | 'info'>('all');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const unsubscribe = notificationPersistenceService.subscribe((items) => {
            setNotifications(items);
        });
        return () => unsubscribe();
    }, []);

    const filtered = notifications.filter(n => {
        const matchesSearch = !searchQuery || 
            n.message.toLowerCase().includes(searchQuery.toLowerCase()) || 
            (n.title && n.title.toLowerCase().includes(searchQuery.toLowerCase()));

        if (!matchesSearch) return false;

        if (activeFilter === 'alerts') return n.type === 'warning' || n.type === 'error';
        if (activeFilter === 'trades') return n.type === 'trade' || n.type === 'market';
        if (activeFilter === 'system') return n.type === 'system';
        if (activeFilter === 'info') return n.type === 'info' || n.type === 'success';
        return true;
    });

    const unreadCount = notifications.filter(n => !n.read).length;

    const handleExportJson = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(notifications, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `wealthos-notifications-7d-${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'error':
            case 'warning':
                return <AlertTriangle size={15} className="text-amber-400" />;
            case 'trade':
            case 'market':
                return <TrendingUp size={15} className="text-emerald-400" />;
            case 'system':
                return <ShieldAlert size={15} className="text-indigo-400" />;
            case 'success':
                return <CheckCircle2 size={15} className="text-emerald-400" />;
            default:
                return <Info size={15} className="text-sky-400" />;
        }
    };

    const formatRelativeTime = (ts: number) => {
        const diffSec = Math.floor((Date.now() - ts) / 1000);
        if (diffSec < 60) return 'Just now';
        if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
        if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
        return `${Math.floor(diffSec / 86400)}d ago`;
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
                    />

                    {/* Drawer */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                        className="fixed top-0 right-0 h-full max-h-[100dvh] w-full max-w-md bg-slate-900/95 border-l border-slate-800 shadow-2xl z-[201] flex flex-col backdrop-blur-xl"
                    >
                        {/* Header */}
                        <div className="p-4 sm:p-5 pt-[max(1rem,env(safe-area-inset-top))] sm:pt-5 border-b border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 relative">
                                    <Bell size={18} />
                                    {unreadCount > 0 && (
                                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 text-white font-mono text-[9px] font-bold rounded-full flex items-center justify-center">
                                            {unreadCount > 9 ? '9+' : unreadCount}
                                        </span>
                                    )}
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-white font-display">
                                        Notification Center
                                    </h3>
                                    <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        7-Day Rolling Retention Active
                                    </span>
                                </div>
                            </div>

                            <button
                                onClick={onClose}
                                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Search & Actions Bar */}
                        <div className="p-4 border-b border-slate-800/80 space-y-3">
                            <input
                                type="text"
                                placeholder="Search past 7 days..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full px-3.5 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                            />

                            {/* Filter Chips & Action Buttons */}
                            <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1">
                                <div className="flex items-center gap-1">
                                    {(['all', 'alerts', 'trades', 'system', 'info'] as const).map((filter) => (
                                        <button
                                            key={filter}
                                            onClick={() => setActiveFilter(filter)}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold capitalize transition-all ${
                                                activeFilter === filter
                                                    ? 'bg-indigo-600 text-white'
                                                    : 'bg-slate-800/60 text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            {filter}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={() => notificationPersistenceService.markAllAsRead()}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-colors"
                                        title="Mark all as read"
                                    >
                                        <CheckCheck size={14} />
                                    </button>
                                    <button
                                        onClick={handleExportJson}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                                        title="Export 7-day JSON"
                                    >
                                        <Download size={14} />
                                    </button>
                                    <button
                                        onClick={() => notificationPersistenceService.clearAll()}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                                        title="Clear all"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Notification Timeline List */}
                        <div className="flex-1 overflow-y-auto p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-2.5 custom-scrollbar">
                            {filtered.length === 0 ? (
                                <div className="h-48 flex flex-col items-center justify-center text-slate-500 space-y-2 text-center">
                                    <Bell size={28} className="text-slate-600" />
                                    <p className="text-xs">No notifications in the past 7 days</p>
                                </div>
                            ) : (
                                filtered.map((item) => (
                                    <div
                                        key={item.id}
                                        onClick={() => notificationPersistenceService.markAsRead(item.id)}
                                        className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                                            item.read
                                                ? 'bg-slate-900/40 border-slate-800/60 opacity-75'
                                                : 'bg-slate-850/90 border-slate-750 shadow-md'
                                        } hover:border-slate-700`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <span className="p-1.5 rounded-xl bg-slate-800 border border-slate-700/60 shrink-0 mt-0.5">
                                                {getIcon(item.type)}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-bold text-slate-200 truncate">
                                                        {item.title || item.source || 'Notification'}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-slate-500 shrink-0">
                                                        {formatRelativeTime(item.timestamp)}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-400 mt-1 line-clamp-3 leading-relaxed">
                                                    {item.message}
                                                </p>
                                                {item.actionLabel && (
                                                    <div className="mt-2">
                                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                                            {item.actionLabel}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            {!item.read && (
                                                <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-1.5" />
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer Info */}
                        <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 text-center text-[10px] text-slate-500 font-mono">
                            Auto-purges entries older than 7 calendar days • Total saved: {notifications.length}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
