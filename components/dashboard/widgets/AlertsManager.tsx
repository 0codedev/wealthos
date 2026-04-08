import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell, Plus, Trash2, ToggleLeft, ToggleRight, Target, TrendingUp, TrendingDown,
    Calendar, Briefcase, AlertCircle, X, Check, BellRing, BellOff, Zap, BarChart3,
    Clock, Sparkles, LayoutGrid, List, PieChart
} from 'lucide-react';
import { useAlertsStore, Alert, AlertType, AlertCondition, requestNotificationPermission, sendBrowserNotification } from '../../../store/alertsStore';
import EmptyState from '../../shared/EmptyState';

interface AlertsManagerProps {
    investments?: { id: string; name: string; currentValue: number; investedAmount: number }[];
    formatCurrency?: (val: number) => string;
}

const ALERT_TYPE_CONFIG: Record<AlertType, { label: string; icon: React.ReactNode; color: string }> = {
    PRICE: { label: 'Price Alert', icon: <Target size={14} />, color: 'text-blue-400' },
    PL_TARGET: { label: 'P/L Target', icon: <TrendingUp size={14} />, color: 'text-emerald-400' },
    SIP_REMINDER: { label: 'SIP Reminder', icon: <Calendar size={14} />, color: 'text-purple-400' },
    IPO: { label: 'IPO Alert', icon: <Briefcase size={14} />, color: 'text-amber-400' },
    CUSTOM: { label: 'Custom', icon: <Bell size={14} />, color: 'text-slate-400' },
};

// Smart Alert Templates
const ALERT_TEMPLATES = [
    {
        id: 'profit-10',
        name: 'Take Profit +10%',
        type: 'PL_TARGET' as AlertType,
        targetPLPercent: 10,
        icon: <TrendingUp size={12} />,
        color: 'emerald'
    },
    {
        id: 'stop-loss-5',
        name: 'Stop Loss -5%',
        type: 'PL_TARGET' as AlertType,
        targetPLPercent: -5,
        icon: <TrendingDown size={12} />,
        color: 'rose'
    },
    {
        id: 'sip-1st',
        name: 'SIP on 1st',
        type: 'SIP_REMINDER' as AlertType,
        sipDay: 1,
        icon: <Calendar size={12} />,
        color: 'purple'
    },
    {
        id: 'sip-5th',
        name: 'SIP on 5th',
        type: 'SIP_REMINDER' as AlertType,
        sipDay: 5,
        icon: <Calendar size={12} />,
        color: 'purple'
    },
    {
        id: 'portfolio-25',
        name: 'Portfolio +25%',
        type: 'PL_TARGET' as AlertType,
        targetPLPercent: 25,
        icon: <Sparkles size={12} />,
        color: 'amber'
    },
    {
        id: 'rebalance',
        name: 'Rebalance Alert',
        type: 'CUSTOM' as AlertType,
        icon: <LayoutGrid size={12} />,
        color: 'indigo'
    },
];

// Analytics Component
const AlertsAnalytics: React.FC<{ alerts: Alert[] }> = React.memo(({ alerts }) => {
    const stats = useMemo(() => {
        const total = alerts.length;
        const active = alerts.filter(a => a.isActive).length;
        const triggered = alerts.filter(a => a.isTriggered).length;
        const byType = alerts.reduce((acc, a) => {
            acc[a.type] = (acc[a.type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return { total, active, triggered, byType };
    }, [alerts]);

    const typeData = Object.entries(stats.byType).map(([type, count]) => ({
        type,
        count,
        config: ALERT_TYPE_CONFIG[type as AlertType]
    }));

    return (
        <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-700/50">
                    <p className="text-2xl font-black text-slate-900 dark:text-white">{stats.total}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Total</p>
                </div>
                <div className="bg-emerald-500/10 rounded-xl p-3 text-center border border-emerald-500/20">
                    <p className="text-2xl font-black text-emerald-400">{stats.active}</p>
                    <p className="text-[10px] text-emerald-400/60 uppercase font-bold">Active</p>
                </div>
                <div className="bg-amber-500/10 rounded-xl p-3 text-center border border-amber-500/20">
                    <p className="text-2xl font-black text-amber-400">{stats.triggered}</p>
                    <p className="text-[10px] text-amber-400/60 uppercase font-bold">Triggered</p>
                </div>
            </div>

            {/* Types Breakdown */}
            <div className="bg-slate-100 dark:bg-slate-800/30 rounded-xl p-4 border border-slate-200 dark:border-slate-700/50">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
                    <PieChart size={12} /> By Type
                </h4>
                <div className="space-y-2">
                    {typeData.length > 0 ? typeData.map(({ type, count, config }) => (
                        <div key={type} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className={config?.color}>{config?.icon}</span>
                                <span className="text-xs text-slate-700 dark:text-slate-300">{config?.label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-amber-500 to-orange-500"
                                        style={{ width: `${(count / stats.total) * 100}%` }}
                                    />
                                </div>
                                <span className="text-xs font-mono text-slate-400">{count}</span>
                            </div>
                        </div>
                    )) : (
                        <p className="text-xs text-slate-500 text-center py-2">No alerts yet</p>
                    )}
                </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-slate-100 dark:bg-slate-800/30 rounded-xl p-4 border border-slate-200 dark:border-slate-700/50">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                    <Clock size={12} /> Alert Effectiveness
                </h4>
                <div className="flex items-center justify-between text-center">
                    <div>
                        <p className="text-lg font-bold text-blue-400">
                            {stats.total > 0 ? Math.round((stats.triggered / stats.total) * 100) : 0}%
                        </p>
                        <p className="text-[9px] text-slate-500">Trigger Rate</p>
                    </div>
                    <div className="w-px h-8 bg-slate-200 dark:bg-slate-700" />
                    <div>
                        <p className="text-lg font-bold text-emerald-400">
                            {stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0}%
                        </p>
                        <p className="text-[9px] text-slate-500">Active Rate</p>
                    </div>
                    <div className="w-px h-8 bg-slate-200 dark:bg-slate-700" />
                    <div>
                        <p className="text-lg font-bold text-amber-400">{typeData.length}</p>
                        <p className="text-[9px] text-slate-500">Categories</p>
                    </div>
                </div>
            </div>
        </div>
    );
});

const AlertsManager: React.FC<AlertsManagerProps> = ({ investments = [], formatCurrency = (v) => `₹${v.toLocaleString()}` }) => {
    const { alerts, addAlert, removeAlert, toggleAlert } = useAlertsStore();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'alerts' | 'templates' | 'analytics'>('alerts');
    const [notificationEnabled, setNotificationEnabled] = useState(Notification?.permission === 'granted');

    // Form state
    const [newAlertType, setNewAlertType] = useState<AlertType>('PRICE');
    const [newAlertName, setNewAlertName] = useState('');
    const [selectedAsset, setSelectedAsset] = useState('');
    const [targetPrice, setTargetPrice] = useState<number | ''>('');
    const [condition, setCondition] = useState<AlertCondition>('ABOVE');
    const [targetPL, setTargetPL] = useState<number | ''>('');
    const [sipDay, setSipDay] = useState<number>(1);

    const handleEnableNotifications = async () => {
        const granted = await requestNotificationPermission();
        setNotificationEnabled(granted);
        if (granted) {
            sendBrowserNotification('Alerts Enabled', 'You will now receive browser notifications for your alerts.');
        }
    };

    const handleApplyTemplate = (template: typeof ALERT_TEMPLATES[0]) => {
        addAlert({
            type: template.type,
            name: template.name,
            isActive: true,
            notifyVia: ['BROWSER'],
            ...(template.targetPLPercent !== undefined && {
                targetPLPercent: template.targetPLPercent,
                condition: template.targetPLPercent >= 0 ? 'ABOVE' : 'BELOW'
            }),
            ...(template.sipDay !== undefined && { sipDay: template.sipDay }),
        });
    };

    const handleAddAlert = () => {
        if (!newAlertName.trim()) return;

        const baseAlert = {
            type: newAlertType,
            name: newAlertName.trim(),
            isActive: true,
            notifyVia: ['BROWSER'] as ('BROWSER' | 'TELEGRAM')[],
        };

        if (newAlertType === 'PRICE' && selectedAsset && targetPrice) {
            addAlert({
                ...baseAlert,
                assetName: selectedAsset,
                targetPrice: Number(targetPrice),
                condition,
            });
        } else if (newAlertType === 'PL_TARGET' && targetPL) {
            addAlert({
                ...baseAlert,
                targetPLPercent: Number(targetPL),
                condition: Number(targetPL) >= 0 ? 'ABOVE' : 'BELOW',
            });
        } else if (newAlertType === 'SIP_REMINDER') {
            addAlert({
                ...baseAlert,
                sipDay,
            });
        } else if (newAlertType === 'CUSTOM') {
            addAlert(baseAlert);
        }

        // Reset form
        setNewAlertName('');
        setSelectedAsset('');
        setTargetPrice('');
        setTargetPL('');
        setIsAddModalOpen(false);
    };

    const activeAlerts = alerts.filter(a => a.isActive);
    const triggeredAlerts = alerts.filter(a => a.isTriggered);

    return (
        <div className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl relative overflow-hidden h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                        <Bell size={20} className="text-white" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Alerts Engine 2.0</h3>
                        <p className="text-xs text-slate-500">{activeAlerts.length} active • {triggeredAlerts.length} triggered</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleEnableNotifications}
                        className={`p-2 rounded-lg transition-colors ${notificationEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                        title={notificationEnabled ? 'Notifications enabled' : 'Enable notifications'}
                    >
                        {notificationEnabled ? <BellRing size={16} /> : <BellOff size={16} />}
                    </button>
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setIsAddModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 transition-shadow"
                    >
                        <Plus size={16} /> Add
                    </motion.button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50">
                {[
                    { id: 'alerts', label: 'Alerts', icon: <Bell size={12} /> },
                    { id: 'templates', label: 'Templates', icon: <Zap size={12} /> },
                    { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={12} /> },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === tab.id
                            ? 'bg-amber-500 text-white shadow-lg'
                            : 'text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700/50'
                            }`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-auto">
                {/* ALERTS TAB */}
                {activeTab === 'alerts' && (
                    <div className="space-y-3 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent pr-2">
                        {alerts.length === 0 ? (
                            <EmptyState
                                type="no-alerts"
                                actionLabel="Add Alert"
                                onAction={() => setIsAddModalOpen(true)}
                                variant="minimal"
                            />
                        ) : (
                            <AnimatePresence>
                                {alerts.map((alert) => (
                                    <motion.div
                                        key={alert.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, x: -50 }}
                                        className={`flex items-center justify-between p-4 rounded-xl border transition-all ${alert.isTriggered
                                            ? 'bg-amber-500/10 border-amber-500/30'
                                            : alert.isActive
                                                ? 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50 hover:border-slate-400 dark:hover:border-slate-600'
                                                : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800/50 opacity-60'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${alert.isTriggered ? 'bg-amber-500/20' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                                <span className={ALERT_TYPE_CONFIG[alert.type].color}>
                                                    {ALERT_TYPE_CONFIG[alert.type].icon}
                                                </span>
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                                    {alert.name}
                                                    {alert.isTriggered && (
                                                        <span className="text-[10px] bg-amber-500 text-black px-1.5 py-0.5 rounded font-bold animate-pulse">
                                                            TRIGGERED
                                                        </span>
                                                    )}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    {alert.type === 'PRICE' && `${alert.assetName} ${alert.condition} ${formatCurrency(alert.targetPrice || 0)}`}
                                                    {alert.type === 'PL_TARGET' && `Portfolio P/L ${alert.targetPLPercent}%`}
                                                    {alert.type === 'SIP_REMINDER' && `Day ${alert.sipDay} of every month`}
                                                    {alert.type === 'CUSTOM' && 'Custom alert'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => toggleAlert(alert.id)}
                                                className={`p-2 rounded-lg transition-colors ${alert.isActive ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-slate-500 hover:bg-slate-800'}`}
                                            >
                                                {alert.isActive ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                                            </button>
                                            <button
                                                onClick={() => removeAlert(alert.id)}
                                                className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        )}
                    </div>
                )}

                {/* Add Alert Modal - Outside tab content */}
                <AnimatePresence>
                    {isAddModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                            onClick={() => setIsAddModalOpen(false)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 sm:p-5 md:p-6 w-full max-w-md shadow-2xl"
                            >
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create New Alert</h3>
                                    <button onClick={() => setIsAddModalOpen(false)} aria-label="Close create alert" className="text-slate-400 hover:text-white">
                                        <X size={20} />
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    {/* Alert Type Selector */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Alert Type</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {(['PRICE', 'PL_TARGET', 'SIP_REMINDER', 'CUSTOM'] as AlertType[]).map((type) => (
                                                <button
                                                    key={type}
                                                    onClick={() => setNewAlertType(type)}
                                                    className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${newAlertType === type
                                                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                                                        : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                                                        }`}
                                                >
                                                    {ALERT_TYPE_CONFIG[type].icon}
                                                    {ALERT_TYPE_CONFIG[type].label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Alert Name */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Alert Name</label>
                                        <input
                                            type="text"
                                            value={newAlertName}
                                            onChange={(e) => setNewAlertName(e.target.value)}
                                            placeholder="e.g. HDFC Bank Price Target"
                                            className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm outline-none focus:border-amber-500 transition-colors"
                                        />
                                    </div>

                                    {/* Conditional Fields */}
                                    {newAlertType === 'PRICE' && (
                                        <>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Asset</label>
                                                <select
                                                    value={selectedAsset}
                                                    onChange={(e) => setSelectedAsset(e.target.value)}
                                                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm outline-none focus:border-amber-500"
                                                >
                                                    <option value="">Select an asset...</option>
                                                    {investments.map((inv) => (
                                                        <option key={inv.id} value={inv.name}>{inv.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Condition</label>
                                                    <select
                                                        value={condition}
                                                        onChange={(e) => setCondition(e.target.value as AlertCondition)}
                                                        className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm outline-none focus:border-amber-500"
                                                    >
                                                        <option value="ABOVE">Above</option>
                                                        <option value="BELOW">Below</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Target Price</label>
                                                    <input
                                                        type="number"
                                                        value={targetPrice}
                                                        onChange={(e) => setTargetPrice(parseFloat(e.target.value) || '')}
                                                        placeholder="₹0"
                                                        className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm outline-none focus:border-amber-500"
                                                    />
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {newAlertType === 'PL_TARGET' && (
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Target P/L %</label>
                                            <input
                                                type="number"
                                                value={targetPL}
                                                onChange={(e) => setTargetPL(parseFloat(e.target.value) || '')}
                                                placeholder="e.g. 10 for +10%"
                                                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm outline-none focus:border-amber-500"
                                            />
                                        </div>
                                    )}

                                    {newAlertType === 'SIP_REMINDER' && (
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Reminder Day (1-31)</label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="31"
                                                value={sipDay}
                                                onChange={(e) => setSipDay(Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
                                                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm outline-none focus:border-amber-500"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3 mt-6">
                                    <button
                                        onClick={() => setIsAddModalOpen(false)}
                                        className="flex-1 py-3 bg-slate-800 text-slate-300 rounded-xl font-semibold hover:bg-slate-700 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleAddAlert}
                                        disabled={!newAlertName.trim()}
                                        className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-amber-500/40 transition-shadow flex items-center justify-center gap-2"
                                    >
                                        <Check size={16} /> Create Alert
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* TEMPLATES TAB */}
                {activeTab === 'templates' && (
                    <div className="space-y-3">
                        <p className="text-xs text-slate-400 mb-3">Quick presets to get started instantly</p>
                        <div className="grid grid-cols-2 gap-2">
                            {ALERT_TEMPLATES.map(template => (
                                <motion.button
                                    key={template.id}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => handleApplyTemplate(template)}
                                    className={`p-3 rounded-xl border text-left transition-all hover:shadow-lg bg-${template.color}-500/10 border-${template.color}-500/30 hover:border-${template.color}-500/50`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-${template.color}-400`}>{template.icon}</span>
                                        <span className="text-xs font-bold text-slate-800 dark:text-white">{template.name}</span>
                                    </div>
                                    <p className="text-[9px] text-slate-500">{template.type}</p>
                                </motion.button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ANALYTICS TAB */}
                {activeTab === 'analytics' && (
                    <AlertsAnalytics alerts={alerts} />
                )}
            </div>
        </div>
    );
};

export default AlertsManager;

