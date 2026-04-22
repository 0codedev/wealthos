import React, { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { KeyRound, Shield, MessageSquareOff, ScrollText, Trash2, Lock } from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import { useToast } from '../shared/ToastProvider';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../database';
import {
    buildSensitiveFieldSummary,
    clearAdvisorRetention,
    clearAuditTrailData,
    getAuditTrailSummary,
    maskSecret,
} from '../../services/SecurityPrivacyService';
import { MetricTile, StateSurface } from '../shared/SurfacePrimitives';

const SecurityPrivacyPanel: React.FC = () => {
    const settings = useSettingsStore();
    const updateSetting = settings.updateSetting;
    const { toast } = useToast();
    const { changePin } = useAuth();
    const [conversationCount, setConversationCount] = useState(0);
    const [messageCount, setMessageCount] = useState(0);
    const [localArtifacts, setLocalArtifacts] = useState(0);
    const [auditCount, setAuditCount] = useState(0);
    const [lastAudit, setLastAudit] = useState<string | null>(null);

    // PIN Update states
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmNewPin, setConfirmNewPin] = useState('');
    const [pinLoading, setPinLoading] = useState(false);

    useEffect(() => {
        const convSub = liveQuery(() => db.conversations.count()).subscribe({
            next: (value) => setConversationCount(value || 0),
        });
        const msgSub = liveQuery(() => db.chat_messages.count()).subscribe({
            next: (value) => setMessageCount(value || 0),
        });

        const refreshAudit = () => {
            const audit = getAuditTrailSummary();
            setAuditCount(audit.count);
            setLastAudit(audit.lastEntry?.timestamp || null);
            setLocalArtifacts(['advisor_chat_history', 'advisor_report_data'].filter((key) => !!localStorage.getItem(key)).length);
        };

        refreshAudit();
        window.addEventListener('focus', refreshAudit);

        return () => {
            convSub.unsubscribe();
            msgSub.unsubscribe();
            window.removeEventListener('focus', refreshAudit);
        };
    }, []);

    const sensitiveSummary = useMemo(() => buildSensitiveFieldSummary(settings), [settings]);

    const clearSecrets = () => {
        updateSetting('dhanClientId', '');
        updateSetting('dhanAccessToken', '');
        updateSetting('dhanPin', '');
        updateSetting('dhanTotpSecret', '');
        updateSetting('geminiApiKey', '');
        updateSetting('groqApiKey', '');
        updateSetting('apiKeys', {
            rapidApi: '',
            alphaVantage: '',
            finnhub: '',
            fmp: '',
        });
        toast.success('Sensitive broker and API keys cleared from local settings.');
    };

    const handleClearAdvisor = async () => {
        await clearAdvisorRetention();
        setConversationCount(0);
        setMessageCount(0);
        setLocalArtifacts(0);
        toast.success('Advisor memory cleared from local database and storage.');
    };

    const handleClearAudit = () => {
        clearAuditTrailData();
        setAuditCount(0);
        setLastAudit(null);
        toast.success('Security audit trail cleared.');
    };

    const handleUpdatePin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentPin || !newPin || !confirmNewPin) {
            toast.error('All PIN fields are required.');
            return;
        }
        if (newPin.length < 4 || newPin.length > 8) {
            toast.error('New PIN must be between 4 and 8 digits.');
            return;
        }
        if (!/^\d+$/.test(newPin)) {
            toast.error('New PIN must contain only numbers.');
            return;
        }
        if (newPin !== confirmNewPin) {
            toast.error('New PINs do not match.');
            return;
        }

        setPinLoading(true);
        const res = await changePin(currentPin, newPin);
        setPinLoading(false);

        if (res.success) {
            toast.success('Security PIN updated successfully.');
            setCurrentPin('');
            setNewPin('');
            setConfirmNewPin('');
        } else {
            toast.error(res.error || 'Failed to update PIN.');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Shield size={16} className="text-indigo-500" />
                <h3 className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">Security & Privacy</h3>
            </div>

            <StateSurface
                tone="info"
                title="Inspect what sensitive data stays local"
                description="This surface helps you verify what secrets, advisor memory, and audit breadcrumbs exist locally, then clear them without digging through browser storage manually."
                icon={Shield}
                badge="Privacy command"
                className="rounded-[28px] bg-gradient-to-r from-indigo-50 via-white to-emerald-50 dark:from-indigo-950/20 dark:via-slate-900 dark:to-emerald-950/20"
            />

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
                <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                    <div className="flex items-center gap-2">
                        <KeyRound size={16} className="text-indigo-500" />
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Sensitive Keys</h4>
                    </div>
                    <div className="mt-3">
                        <MetricTile
                            label="Configured Secrets"
                            value={sensitiveSummary.configuredCount}
                            meta="Configured secrets stored locally."
                            tone={sensitiveSummary.configuredCount > 0 ? 'warning' : 'success'}
                        />
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                        <div className="space-y-2">
                            {sensitiveSummary.fields.filter((field) => field.configured).slice(0, 4).map((field) => (
                                <div key={field.label} className="flex items-center justify-between gap-2 text-xs">
                                    <span className="text-slate-500">{field.label}</span>
                                    <span className="font-mono text-slate-800 dark:text-slate-200">{maskSecret(field.value)}</span>
                                </div>
                            ))}
                            {sensitiveSummary.configuredCount === 0 && (
                                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                                    No active broker or API secrets stored right now.
                                </div>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={clearSecrets}
                        className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-500"
                    >
                        <Trash2 size={12} />
                        Clear Secrets
                    </button>
                </div>

                <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                    <div className="flex items-center gap-2">
                        <MessageSquareOff size={16} className="text-emerald-500" />
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Advisor Retention</h4>
                    </div>
                    <div className="mt-4 grid gap-2">
                        <MetricTile label="Conversations" value={conversationCount} tone="neutral" />
                        <MetricTile label="Messages" value={messageCount} tone="neutral" />
                        <MetricTile label="Local Artifacts" value={localArtifacts} tone={localArtifacts > 0 ? 'warning' : 'success'} />
                    </div>
                    <button
                        onClick={() => void handleClearAdvisor()}
                        className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-800 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600"
                    >
                        <Trash2 size={12} />
                        Clear Advisor Memory
                    </button>
                </div>

                <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                    <div className="flex items-center gap-2">
                        <ScrollText size={16} className="text-amber-500" />
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Audit Trail</h4>
                    </div>
                    <div className="mt-4 grid gap-2">
                        <MetricTile label="Security Events" value={auditCount} meta="Captured locally." tone={auditCount > 0 ? 'warning' : 'success'} />
                        <MetricTile label="Last Event" value={lastAudit ? new Date(lastAudit).toLocaleString() : 'None'} tone="neutral" />
                    </div>
                    <button
                        onClick={handleClearAudit}
                        className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-500"
                    >
                        <Trash2 size={12} />
                        Clear Audit Trail
                    </button>
                </div>

                <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <Lock size={16} className="text-indigo-500" />
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Change Security PIN</h4>
                        </div>
                        <form onSubmit={handleUpdatePin} className="mt-4 space-y-2">
                            <div>
                                <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Current PIN</label>
                                <input
                                    type="password"
                                    value={currentPin}
                                    onChange={(e) => {
                                        if (e.target.value.length <= 8 && /^\d*$/.test(e.target.value)) {
                                            setCurrentPin(e.target.value);
                                        }
                                    }}
                                    className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 border border-slate-200/80 focus:outline-none focus:border-indigo-500 dark:bg-slate-950/40 dark:border-slate-800 dark:text-white dark:focus:border-indigo-500"
                                    placeholder="••••"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">New PIN (4-8 digits)</label>
                                <input
                                    type="password"
                                    value={newPin}
                                    onChange={(e) => {
                                        if (e.target.value.length <= 8 && /^\d*$/.test(e.target.value)) {
                                            setNewPin(e.target.value);
                                        }
                                    }}
                                    className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 border border-slate-200/80 focus:outline-none focus:border-indigo-500 dark:bg-slate-950/40 dark:border-slate-800 dark:text-white dark:focus:border-indigo-500"
                                    placeholder="••••"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Confirm New PIN</label>
                                <input
                                    type="password"
                                    value={confirmNewPin}
                                    onChange={(e) => {
                                        if (e.target.value.length <= 8 && /^\d*$/.test(e.target.value)) {
                                            setConfirmNewPin(e.target.value);
                                        }
                                    }}
                                    className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 border border-slate-200/80 focus:outline-none focus:border-indigo-500 dark:bg-slate-950/40 dark:border-slate-800 dark:text-white dark:focus:border-indigo-500"
                                    placeholder="••••"
                                    required
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={pinLoading}
                                className="w-full mt-2 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
                            >
                                {pinLoading ? 'Updating...' : 'Update PIN'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SecurityPrivacyPanel;

