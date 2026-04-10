import React, { useState, useMemo } from 'react';
import { liveQuery } from 'dexie';
import {
    Bell, Plus, Trash2, Target, TrendingDown, Calendar,
    AlertCircle, Check, X, ChevronDown, ChevronUp, Settings
} from 'lucide-react';
import { db, Alert } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import EmptyState from '../../shared/EmptyState';

type AlertType = Alert['type'];

const ALERT_TYPES: { id: AlertType; label: string; icon: React.ElementType; color: string }[] = [
    { id: 'price_target', label: 'Price Target', icon: Target, color: '#10b981' },
    { id: 'stop_loss', label: 'Stop Loss', icon: TrendingDown, color: '#ef4444' },
    { id: 'sip_reminder', label: 'SIP Reminder', icon: Calendar, color: '#6366f1' },
    { id: 'tax_deadline', label: 'Tax Deadline', icon: AlertCircle, color: '#f59e0b' },
    { id: 'custom', label: 'Custom Alert', icon: Bell, color: '#8b5cf6' },
];

interface SmartAlertsManagerProps {
    investments?: { id: string; name: string; currentValue: number }[];
}

export const SmartAlertsManager: React.FC<SmartAlertsManagerProps> = ({ investments = [] }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isAddingAlert, setIsAddingAlert] = useState(false);
    const [newAlert, setNewAlert] = useState<Partial<Alert>>({
        type: 'price_target',
        title: '',
        description: '',
        triggerValue: 0,
        isActive: true,
        notified: false,
    });

    // Fetch all alerts
    const [alerts, setAlerts] = useState<Alert[]>([]);

    React.useEffect(() => {
        const subscription = liveQuery(() =>
            db.alerts.orderBy('createdAt').reverse().toArray()
        ).subscribe(setAlerts);
        return () => subscription.unsubscribe();
    }, []);

    const activeAlerts = useMemo(() => alerts.filter(a => a.isActive), [alerts]);
    const triggeredAlerts = useMemo(() => alerts.filter(a => a.triggeredAt), [alerts]);

    const handleAddAlert = async () => {
        if (!newAlert.title?.trim()) return;

        await db.alerts.add({
            type: newAlert.type || 'custom',
            title: newAlert.title.trim(),
            description: newAlert.description?.trim() || '',
            triggerValue: newAlert.triggerValue,
            assetId: newAlert.assetId,
            isActive: true,
            createdAt: new Date().toISOString(),
            notified: false,
        });

        setNewAlert({
            type: 'price_target',
            title: '',
            description: '',
            triggerValue: 0,
            isActive: true,
            notified: false,
        });
        setIsAddingAlert(false);
    };

    const handleDeleteAlert = async (id: number) => {
        await db.alerts.delete(id);
    };

    const handleToggleActive = async (id: number, isActive: boolean) => {
        await db.alerts.update(id, { isActive: !isActive });
    };

    const getAlertTypeInfo = (type: AlertType) =>
        ALERT_TYPES.find(t => t.id === type) || ALERT_TYPES[4];

    return (
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-amber-500/20 rounded-xl relative">
                        <Bell className="text-amber-600 dark:text-amber-400" size={18} />
                        {activeAlerts.length > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                                {activeAlerts.length}
                            </span>
                        )}
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800 dark:text-white text-sm">Smart Alerts</h3>
                        <p className="text-[10px] text-slate-500">
                            {activeAlerts.length} active • {triggeredAlerts.length} triggered
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setIsAddingAlert(true)}
                        className="p-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-all"
                    >
                        <Plus size={14} />
                    </button>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                </div>
            </div>

            {/* Add Alert Form */}
            {isAddingAlert && (
                <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 mb-3 space-y-3">
                    <div className="flex gap-2">
                        {ALERT_TYPES.map(t => (
                            <button
                                key={t.id}
                                onClick={() => setNewAlert({ ...newAlert, type: t.id })}
                                className={`flex-1 p-2 rounded-lg text-[10px] font-bold flex flex-col items-center gap-1 transition-all border ${newAlert.type === t.id
                                    ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600'
                                    : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                    }`}
                                style={{ color: newAlert.type === t.id ? t.color : undefined }}
                            >
                                <t.icon size={14} />
                                {t.label.split(' ')[0]}
                            </button>
                        ))}
                    </div>

                    <input
                        type="text"
                        value={newAlert.title || ''}
                        onChange={(e) => setNewAlert({ ...newAlert, title: e.target.value })}
                        placeholder="Alert title (e.g., 'HDFC Bank hits ₹1800')"
                        className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-amber-500/50"
                    />

                    {(newAlert.type === 'price_target' || newAlert.type === 'stop_loss') && (
                        <div className="grid grid-cols-2 gap-2">
                            <select
                                value={newAlert.assetId || ''}
                                onChange={(e) => setNewAlert({ ...newAlert, assetId: e.target.value })}
                                className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                            >
                                <option value="">Select Asset</option>
                                {investments.map(inv => (
                                    <option key={inv.id} value={inv.id}>{inv.name}</option>
                                ))}
                            </select>
                            <input
                                type="number"
                                value={newAlert.triggerValue || ''}
                                onChange={(e) => setNewAlert({ ...newAlert, triggerValue: parseFloat(e.target.value) })}
                                placeholder="Target Price"
                                className="px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                            />
                        </div>
                    )}

                    <textarea
                        value={newAlert.description || ''}
                        onChange={(e) => setNewAlert({ ...newAlert, description: e.target.value })}
                        placeholder="Optional notes..."
                        rows={2}
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg resize-none"
                    />

                    <div className="flex gap-2">
                        <button
                            onClick={handleAddAlert}
                            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-lg transition-all"
                        >
                            <Check size={14} />
                            Create Alert
                        </button>
                        <button
                            onClick={() => setIsAddingAlert(false)}
                            className="px-3 py-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            )}

            {/* Alerts List */}
            {isExpanded && (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {alerts.length === 0 ? (
                        <EmptyState
                            type="no-alerts"
                            variant="minimal"
                            title="No alerts yet"
                            description="Set price, stop-loss, or SIP reminders to get pinged when something matters."
                        />
                    ) : (
                        alerts.map(alert => {
                            const typeInfo = getAlertTypeInfo(alert.type);
                            return (
                                <div
                                    key={alert.id}
                                    className={`p-3 rounded-xl border transition-all ${alert.isActive
                                        ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                                        : 'bg-slate-100 dark:bg-slate-800/50 border-transparent opacity-60'
                                        }`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-start gap-2">
                                            <div
                                                className="p-1.5 rounded-lg"
                                                style={{ backgroundColor: `${typeInfo.color}20` }}
                                            >
                                                <typeInfo.icon size={12} style={{ color: typeInfo.color }} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-800 dark:text-white">
                                                    {alert.title}
                                                </p>
                                                {alert.triggerValue && (
                                                    <p className="text-[10px] text-slate-500">
                                                        Target: {formatCurrency(alert.triggerValue)}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleToggleActive(alert.id!, alert.isActive)}
                                                className={`p-1 rounded ${alert.isActive ? 'text-emerald-500' : 'text-slate-400'}`}
                                            >
                                                {alert.isActive ? <Bell size={12} /> : <Bell size={12} />}
                                            </button>
                                            <button
                                                onClick={() => handleDeleteAlert(alert.id!)}
                                                className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* Quick Stats */}
            {!isExpanded && alerts.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                    {alerts.slice(0, 3).map(alert => {
                        const typeInfo = getAlertTypeInfo(alert.type);
                        return (
                            <div
                                key={alert.id}
                                className="flex items-center gap-2 px-2 py-1.5 bg-white/80 dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-bold shrink-0"
                            >
                                <typeInfo.icon size={10} style={{ color: typeInfo.color }} />
                                <span className="truncate max-w-[100px] text-slate-600 dark:text-slate-400">
                                    {alert.title}
                                </span>
                            </div>
                        );
                    })}
                    {alerts.length > 3 && (
                        <span className="text-[10px] text-slate-400 self-center px-2">
                            +{alerts.length - 3} more
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

export default SmartAlertsManager;
