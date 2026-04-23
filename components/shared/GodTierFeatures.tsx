import React, { useState, useEffect, useMemo } from 'react';
import {
    Mic, MicOff, Bell, BellRing, Settings, X, Upload, FileText,
    CreditCard, AlertTriangle, TrendingUp, TrendingDown, Newspaper,
    Users, Trophy, Swords, Share2, Lock, Fingerprint, History,
    Shield, Moon, Sun, Clock, ChevronRight, Check, Zap, Brain, Eye, EyeOff,
    Square, Loader2
} from 'lucide-react';
import { Investment } from '../../types';

interface GodTierFeaturesProps {
    investments: Investment[];
    isDarkMode: boolean;
    setIsDarkMode: (value: boolean) => void;
    formatCurrency: (val: number) => string;
}

import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { analyzeVoiceAudio } from '../../services/aiService';
import { motion, AnimatePresence } from 'framer-motion';
import { useGuardrailStore } from '../../store/useGuardrailStore';
import { getApiKey, storeApiKey } from '../../utils/Encryption';


// ===================== VOICE COMMAND BUTTON =====================
export const VoiceCommandButton: React.FC<{ 
    onNavigate?: (path: string) => void,
    onInsight?: (insight: any) => void,
    onStateChange?: (state: { isRecording: boolean, isProcessing: boolean, volume: number }) => void
}> = ({ onNavigate, onInsight, onStateChange }) => {
    const { isRecording, audioBlob, volume, startRecording, stopRecording } = useVoiceRecorder();
    const [isProcessing, setIsProcessing] = useState(false);

    // Sync state to parent
    useEffect(() => {
        onStateChange?.({ isRecording, isProcessing, volume });
    }, [isRecording, isProcessing, volume]);


    // Effect to trigger analysis when recording stops and blob is ready
    useEffect(() => {
        if (!isRecording && audioBlob) {
            handleAnalysis(audioBlob);
        }
    }, [isRecording, audioBlob]);

    const handleAnalysis = async (blob: Blob) => {
        setIsProcessing(true);
        try {
            const result = await analyzeVoiceAudio(blob);
            
            // --- EMOTIONAL GUARDRAIL ---
            if (result && typeof result.risk_score === 'number') {
                useGuardrailStore.getState().recordEmotionalRisk(
                    result.risk_score, 
                    result.sentiment || result.emotion
                );
            }

            // Robust Navigation Routing
            if (result.command) {

                const cmd = result.command.toLowerCase();
                if (cmd.includes('journal') || cmd.includes('trade')) onNavigate?.('journal');
                else if (cmd.includes('market') || cmd.includes('intel')) onNavigate?.('market');
                else if (cmd.includes('analytics') || cmd.includes('chart')) onNavigate?.('analytics');
                else if (cmd.includes('portfolio') || cmd.includes('hub') || cmd.includes('retirement') || cmd.includes('planning') || cmd.includes('legacy')) onNavigate?.('portfolio');
                else if (cmd.includes('dashboard') || cmd.includes('home')) onNavigate?.('dashboard');
            }

            onInsight?.(result);
        } catch (e) {
            console.error("Native Voice Analysis Error:", e);
        } finally {
            setIsProcessing(false);
        }
    };


    const handleToggle = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };


    return (
        <div className="relative flex items-center gap-2">
            <AnimatePresence>
                {isRecording && (
                    <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20"
                    >
                        <div className="flex gap-1 items-center">
                            {[1, 2, 3].map((i) => (
                                <motion.div
                                    key={i}
                                    animate={{ 
                                        height: [8, 16, 8],
                                        backgroundColor: ["#ef4444", "#f87171", "#ef4444"]
                                    }}
                                    transition={{ 
                                        duration: 0.6, 
                                        repeat: Infinity, 
                                        delay: i * 0.1 
                                    }}
                                    className="w-1 rounded-full"
                                />
                            ))}
                        </div>
                        <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Recording</span>
                    </motion.div>
                )}

                {isProcessing && (
                    <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20"
                    >
                        <motion.div 
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full"
                        />
                        <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Analyzing Audio...</span>
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleToggle}
                className={`p-2.5 rounded-xl transition-all duration-300 relative group ${
                    isRecording 
                        ? 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)]' 
                        : isProcessing
                        ? 'bg-blue-600 cursor-wait'
                        : 'bg-white/5 hover:bg-white/10 border border-white/10'
                }`}
                title={isRecording ? 'Stop Recording' : 'Voice Assistant (Ctrl+V)'}
            >
                {isProcessing ? (
                    <Brain className="w-5 h-5 text-white animate-pulse" />
                ) : (
                    <Mic className={`w-5 h-5 transition-colors ${isRecording ? 'text-white' : 'text-gray-400 group-hover:text-white'}`} />
                )}
            </motion.button>
        </div>
    );
};



// ===================== ALERTS PANEL =====================
// Now uses centralized alertsStore for user-created alerts
// and InsightService for auto-generated portfolio insights

import { InsightService } from '../../services/InsightService';
import { useAlertsStore, Alert as StoredAlert } from '../../store/alertsStore';

// Combined alert type for UI display
interface DisplayAlert {
    id: string;
    type: 'anomaly' | 'price' | 'sip' | 'tax' | 'news' | 'risk' | 'milestone' | 'user';
    title: string;
    message: string;
    time: string;
    read: boolean;
    severity?: 'low' | 'medium' | 'high';
    isUserAlert?: boolean;
}

export const AlertsDropdown: React.FC<{ investments: Investment[] }> = ({ investments }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [readIds, setReadIds] = useState<Set<string>>(new Set());

    // Get user-created alerts from store
    const { alerts: userAlerts, triggerAlert } = useAlertsStore();

    // Combine user alerts with smart insights
    const combinedAlerts: DisplayAlert[] = useMemo(() => {
        const result: DisplayAlert[] = [];

        // Add user-created alerts (from AlertsManager)
        userAlerts.filter(a => a.isActive).forEach(alert => {
            result.push({
                id: alert.id,
                type: 'user',
                title: alert.name,
                message: alert.type === 'PRICE'
                    ? `${alert.assetName} ${alert.condition} ₹${alert.targetPrice?.toLocaleString()}`
                    : alert.type === 'SIP_REMINDER'
                        ? `SIP reminder on day ${alert.sipDay}`
                        : alert.type === 'PL_TARGET'
                            ? `P/L target at ${alert.targetPLPercent}%`
                            : 'Custom alert',
                time: alert.isTriggered ? 'Triggered!' : 'Active',
                read: readIds.has(alert.id),
                severity: alert.isTriggered ? 'high' : 'low',
                isUserAlert: true
            });
        });

        // Add smart portfolio insights
        if (investments.length > 0) {
            const smartAlerts = InsightService.analyzePortfolio(investments);
            smartAlerts.forEach(a => {
                result.push({
                    ...a,
                    read: readIds.has(a.id)
                });
            });
        }

        // Add a welcome message if no alerts
        if (result.length === 0) {
            result.push({
                id: 'welcome',
                type: 'news',
                title: 'Alerts Active',
                message: 'No active alerts. Create one from the Alerts Engine widget.',
                time: 'Now',
                read: true
            });
        }

        return result;
    }, [userAlerts, investments, readIds]);

    const unreadCount = combinedAlerts.filter(a => !a.read).length;

    const markAllRead = () => {
        setReadIds(new Set(combinedAlerts.map(a => a.id)));
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'anomaly': return <AlertTriangle className="text-rose-500" size={16} />;
            case 'risk': return <AlertTriangle className="text-orange-500" size={16} />;
            case 'price': return <TrendingUp className="text-emerald-500" size={16} />;
            case 'sip': return <Clock className="text-blue-500" size={16} />;
            case 'tax': return <Shield className="text-amber-500" size={16} />;
            case 'news': return <Newspaper className="text-purple-500" size={16} />;
            case 'milestone': return <Trophy className="text-yellow-500" size={16} />;
            case 'user': return <Bell className="text-indigo-500" size={16} />;
            default: return <Bell size={16} />;
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
            >
                {unreadCount > 0 ? <BellRing size={20} className="animate-bounce" /> : <Bell size={20} />}
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 top-12 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 z-50 overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900 dark:text-white">Smart Alerts</h3>
                            <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">
                                Mark all read
                            </button>
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                            {combinedAlerts.map(alert => (
                                <div
                                    key={alert.id}
                                    className={`p-4 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer ${!alert.read ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                                        }`}
                                    onClick={() => setReadIds(prev => new Set([...prev, alert.id]))}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`p-2 rounded-lg ${alert.isUserAlert ? 'bg-indigo-100 dark:bg-indigo-900/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                            {getIcon(alert.type)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between">
                                                <p className="text-sm font-bold text-slate-900 dark:text-white">{alert.title}</p>
                                                {alert.severity === 'high' && <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold">HIGH</span>}
                                                {alert.isUserAlert && <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold">USER</span>}
                                            </div>
                                            <p className="text-xs text-slate-500 mt-0.5 truncate">{alert.message}</p>
                                            <p className="text-[10px] text-slate-400 mt-1">{alert.time}</p>
                                        </div>
                                        {!alert.read && <div className="w-2 h-2 bg-indigo-500 rounded-full" />}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

// ===================== SETTINGS PANEL =====================
export const SettingsPanel: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    isDarkMode: boolean;
    setIsDarkMode: (val: boolean) => void;
}> = ({ isOpen, onClose, isDarkMode, setIsDarkMode }) => {
    const [darkModeSchedule, setDarkModeSchedule] = useState<'manual' | 'sunset' | 'scheduled'>('manual');
    const [biometricEnabled, setBiometricEnabled] = useState(false);
    const [encryptionEnabled, setEncryptionEnabled] = useState(false);
    const [auditLogs, setAuditLogs] = useState([
        { action: 'Added Investment', asset: 'Nifty 50 ETF', time: '2 hours ago' },
        { action: 'Updated Value', asset: 'HDFC Bank', time: '5 hours ago' },
        { action: 'Deleted Investment', asset: 'Old FD', time: '1 day ago' },
        { action: 'Deleted Investment', asset: 'Old FD', time: '1 day ago' },
        { action: 'Backup Created', asset: '-', time: '2 days ago' },
    ]);

    // API Key State
    const [apiKey, setApiKey] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const key = getApiKey('gemini') || '';
            setApiKey(key);
        }
    }, [isOpen]);

    const handleSaveApiKey = (key: string) => {
        setApiKey(key);
        storeApiKey('gemini', key);
        // Force reload if needed, or rely on service reading it next time
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white dark:bg-slate-900 p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Settings className="text-indigo-500" size={24} /> Settings
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    {/* Dark Mode Schedule */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                            <Moon size={18} className="text-indigo-500" /> Dark Mode Schedule
                        </h3>
                        <div className="space-y-2">
                            {[
                                { value: 'manual', label: 'Manual Toggle', desc: 'Control dark mode yourself' },
                                { value: 'sunset', label: 'Sunset/Sunrise', desc: 'Auto switch based on sun position' },
                                { value: 'scheduled', label: 'Scheduled', desc: '6 PM - 6 AM' },
                            ].map(option => (
                                <label key={option.value} className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                                    <div>
                                        <p className="font-medium text-slate-900 dark:text-white">{option.label}</p>
                                        <p className="text-xs text-slate-500">{option.desc}</p>
                                    </div>
                                    <input
                                        type="radio"
                                        name="darkMode"
                                        value={option.value}
                                        checked={darkModeSchedule === option.value}
                                        onChange={() => setDarkModeSchedule(option.value as any)}
                                        className="w-4 h-4 text-indigo-600"
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Security */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                            <Shield size={18} className="text-emerald-500" /> Security
                        </h3>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                <div className="flex items-center gap-3">
                                    <Fingerprint size={20} className="text-rose-500" />
                                    <div>
                                        <p className="font-medium text-slate-900 dark:text-white">Biometric Lock</p>
                                        <p className="text-xs text-slate-500">Use Face/Fingerprint to access app</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setBiometricEnabled(!biometricEnabled)}
                                    className={`w-12 h-6 rounded-full transition-colors ${biometricEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                                >
                                    <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${biometricEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                                </button>
                            </div>
                            <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                <div className="flex items-center gap-3">
                                    <Lock size={20} className="text-blue-500" />
                                    <div>
                                        <p className="font-medium text-slate-900 dark:text-white">End-to-End Encryption</p>
                                        <p className="text-xs text-slate-500">Encrypt all local data</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setEncryptionEnabled(!encryptionEnabled)}
                                    className={`w-12 h-6 rounded-full transition-colors ${encryptionEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                                >
                                    <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${encryptionEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* AI Configuration */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                            <Brain size={18} className="text-purple-500" /> AI Configuration
                        </h3>
                        <div className="space-y-3">
                            <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Gemini API Key
                                </label>
                                <div className="relative">
                                    <input
                                        type={showApiKey ? "text" : "password"}
                                        value={apiKey}
                                        onChange={(e) => handleSaveApiKey(e.target.value)}
                                        placeholder="Paste your Gemini API key here"
                                        className="w-full pl-3 pr-10 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white text-sm"
                                    />
                                    <button
                                        onClick={() => setShowApiKey(!showApiKey)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    >
                                        {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                                <p className="text-xs text-slate-500 mt-2">
                                    Key is stored locally in your browser. Get one at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">Google AI Studio</a>.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Audit Trail */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                            <History size={18} className="text-purple-500" /> Audit Trail
                        </h3>
                        <div className="space-y-2">
                            {auditLogs.map((log, idx) => (
                                <div key={idx} className="flex items-center justify-between p-2 rounded-lg hover:bg-white dark:hover:bg-slate-800">
                                    <div>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white">{log.action}</p>
                                        <p className="text-xs text-slate-500">{log.asset}</p>
                                    </div>
                                    <span className="text-xs text-slate-400">{log.time}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
};

// ===================== BANK STATEMENT PARSER =====================
export const BankStatementParser: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [parsing, setParsing] = useState(false);
    const [parsed, setParsed] = useState(false);
    const [transactions, setTransactions] = useState<any[]>([]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setParsing(true);
        // Simulate parsing
        setTimeout(() => {
            setParsing(false);
            setParsed(true);
            setTransactions([
                { category: 'Groceries', amount: 8500, count: 12 },
                { category: 'Dining', amount: 4200, count: 8 },
                { category: 'Shopping', amount: 15000, count: 5 },
                { category: 'Bills & Utilities', amount: 6800, count: 4 },
                { category: 'Transport', amount: 2500, count: 15 },
                { category: 'Entertainment', amount: 3200, count: 6 },
            ]);
        }, 2000);
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:opacity-90 transition-all"
            >
                <Upload size={16} /> Import Bank Statement
            </button>

            {isOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsOpen(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <FileText className="text-blue-500" /> Bank Statement Parser
                            </h2>
                            <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6">
                            {!parsed ? (
                                <div className="text-center">
                                    <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-8 hover:border-indigo-500 transition-colors">
                                        <Upload className="mx-auto text-slate-400 mb-4" size={48} />
                                        <p className="text-slate-600 dark:text-slate-400 mb-2">
                                            Drop your bank statement here or click to upload
                                        </p>
                                        <p className="text-xs text-slate-400">Supports PDF, CSV, XLS</p>
                                        <input
                                            type="file"
                                            accept=".pdf,.csv,.xls,.xlsx"
                                            onChange={handleFileUpload}
                                            className="absolute inset-0 opacity-0 cursor-pointer"
                                        />
                                    </div>
                                    {parsing && (
                                        <div className="mt-4 flex items-center justify-center gap-2 text-indigo-600">
                                            <Brain className="animate-spin" size={20} />
                                            <span>AI is analyzing your statement...</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div>
                                    <p className="text-emerald-600 font-bold mb-4 flex items-center gap-2">
                                        <Check size={20} /> Statement Parsed Successfully!
                                    </p>
                                    <div className="space-y-2">
                                        {transactions.map((t, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
                                                <span className="font-medium text-slate-900 dark:text-white">{t.category}</span>
                                                <div className="text-right">
                                                    <p className="font-bold text-slate-900 dark:text-white">₹{t.amount.toLocaleString()}</p>
                                                    <p className="text-xs text-slate-500">{t.count} transactions</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => { setParsed(false); setTransactions([]); }}
                                        className="mt-4 w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                                    >
                                        Upload Another
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// ===================== UPI TRACKER WIDGET =====================
export const UPITrackerWidget: React.FC = () => {
    const [spending] = useState([
        { category: 'Food & Dining', amount: 12500, change: -5 },
        { category: 'Shopping', amount: 8200, change: 15 },
        { category: 'Bills', amount: 6800, change: 0 },
        { category: 'Transport', amount: 3500, change: -10 },
        { category: 'Entertainment', amount: 2800, change: 25 },
    ]);

    const total = spending.reduce((sum, s) => sum + s.amount, 0);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <CreditCard className="text-purple-500" /> UPI Spending Tracker
            </h3>
            <div className="text-center mb-4">
                <p className="text-3xl font-black text-slate-900 dark:text-white">₹{total.toLocaleString()}</p>
                <p className="text-xs text-slate-500">This Month</p>
            </div>
            <div className="space-y-2">
                {spending.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">
                        <span className="text-sm text-slate-700 dark:text-slate-300">{item.category}</span>
                        <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900 dark:text-white">₹{item.amount.toLocaleString()}</span>
                            <span className={`text-xs font-bold ${item.change > 0 ? 'text-rose-500' : item.change < 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
                                {item.change > 0 ? '+' : ''}{item.change}%
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ===================== CREDIT CARD OPTIMIZER =====================
export const CreditCardOptimizer: React.FC = () => {
    const [cards] = useState([
        { name: 'HDFC Regalia', cashback: 2450, suggestion: 'Best for Travel' },
        { name: 'SBI Cashback', cashback: 1800, suggestion: 'Best for Groceries' },
        { name: 'Axis Flipkart', cashback: 1200, suggestion: 'Best for Online Shopping' },
    ]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <CreditCard className="text-amber-500" /> Credit Card Optimizer
            </h3>
            <p className="text-slate-500 text-sm mb-4">Monthly rewards earned: <span className="font-bold text-amber-600 dark:text-amber-500">₹{cards.reduce((sum, c) => sum + c.cashback, 0).toLocaleString()}</span></p>
            <div className="space-y-2">
                {cards.map((card, idx) => (
                    <div key={idx} className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 border border-slate-100 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 dark:text-white">{card.name}</span>
                            <span className="text-amber-600 dark:text-amber-500 font-bold">₹{card.cashback}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{card.suggestion}</p>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ===================== NEWS SENTIMENT WIDGET =====================
export const NewsSentimentWidget: React.FC = () => {
    const [news] = useState([
        { headline: 'RBI keeps repo rate unchanged at 6.5%', sentiment: 'neutral', impact: 'Banks' },
        { headline: 'TCS wins $500M deal from UK client', sentiment: 'positive', impact: 'IT' },
        { headline: 'Crude oil prices surge 5% on OPEC cuts', sentiment: 'negative', impact: 'OMCs' },
        { headline: 'FIIs turn net buyers after 3 months', sentiment: 'positive', impact: 'Market' },
    ]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <Newspaper className="text-purple-500" /> News Sentiment
            </h3>
            <div className="space-y-3">
                {news.map((item, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                        <div className="flex items-start gap-2">
                            <span className={`text-lg ${item.sentiment === 'positive' ? '📈' :
                                item.sentiment === 'negative' ? '📉' : '➡️'
                                }`} />
                            <div>
                                <p className="text-sm text-slate-900 dark:text-white">{item.headline}</p>
                                <p className="text-xs text-slate-500 mt-1">Impact: {item.impact}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ===================== INVESTMENT CLUBS WIDGET =====================
export const InvestmentClubsWidget: React.FC = () => {
    const [clubs] = useState([
        { name: 'Family Wealth', members: 4, goal: 5000000, current: 1250000 },
        { name: 'College Buddies', members: 6, goal: 1000000, current: 420000 },
    ]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <Users className="text-indigo-500" /> Investment Clubs
            </h3>
            <div className="space-y-3">
                {clubs.map((club, idx) => (
                    <div key={idx} className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-100 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-slate-900 dark:text-white">{club.name}</span>
                            <span className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-full font-bold">{club.members} members</span>
                        </div>
                        <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-indigo-500 rounded-full"
                                style={{ width: `${(club.current / club.goal) * 100}%` }}
                            />
                        </div>
                        <div className="flex justify-between mt-2 text-xs text-slate-500">
                            <span>₹{(club.current / 100000).toFixed(1)}L</span>
                            <span>Goal: ₹{(club.goal / 100000).toFixed(0)}L</span>
                        </div>
                    </div>
                ))}
            </div>
            <button className="mt-4 w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-bold">
                + Create New Club
            </button>
        </div>
    );
};

// ===================== CHALLENGES WIDGET =====================
export const ChallengesWidget: React.FC = () => {
    const [challenges] = useState([
        { name: '30-Day Savings Challenge', progress: 18, total: 30, reward: '🏆 Gold Badge' },
        { name: 'No Impulse Buy Week', progress: 5, total: 7, reward: '💎 Diamond Hands' },
    ]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <Swords className="text-rose-500" /> Active Challenges
            </h3>
            <div className="space-y-4">
                {challenges.map((challenge, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-gradient-to-r from-rose-50 to-orange-50 dark:from-rose-900/20 dark:to-orange-900/20 border border-rose-100 dark:border-rose-800">
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-slate-900 dark:text-white">{challenge.name}</span>
                            <span className="text-xs">{challenge.reward}</span>
                        </div>
                        <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-rose-500 to-orange-500 rounded-full"
                                style={{ width: `${(challenge.progress / challenge.total) * 100}%` }}
                            />
                        </div>
                        <p className="text-xs text-slate-500 mt-2">{challenge.progress}/{challenge.total} days completed</p>
                    </div>
                ))}
            </div>
            <button className="mt-4 w-full py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors text-sm font-bold">
                Join New Challenge
            </button>
        </div>
    );
};

// ===================== SHARE PORTFOLIO BUTTON =====================
export const SharePortfolioButton: React.FC = () => {
    const [copied, setCopied] = useState(false);

    const handleShare = () => {
        // Create shareable link (in real app, this would be encrypted)
        const shareableData = btoa(JSON.stringify({
            allocation: { Stocks: 45, MFs: 35, Gold: 10, FD: 10 },
            shareable: true
        }));
        const link = `${window.location.origin}/share/${shareableData.slice(0, 20)}`;

        navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
        >
            {copied ? <Check size={16} className="text-emerald-500" /> : <Share2 size={16} />}
            {copied ? 'Link Copied!' : 'Share Portfolio'}
        </button>
    );
};

// ===================== ACHIEVEMENTS WIDGET =====================
export const AchievementsWidget: React.FC<{ investments: Investment[]; stats: any; assetClassData: { name: string; value: number }[] }> = ({ investments, stats, assetClassData }) => {
    const [achievements] = useState([
        { id: 1, name: 'First Investment', description: 'Made your first investment', icon: '🎯', unlocked: true },
        { id: 2, name: 'Diversifier', description: 'Invested in 3+ asset classes', icon: '🌈', unlocked: assetClassData.length >= 3 },
        { id: 3, name: '₹1 Lakh Club', description: 'Portfolio crossed ₹1,00,000', icon: '💰', unlocked: stats?.totalValue >= 100000 },
        { id: 4, name: 'Half-Centurion', description: 'Portfolio crossed ₹50,00,000', icon: '🛡️', unlocked: stats?.totalValue >= 5000000 },
        { id: 5, name: 'Crorepati', description: 'Portfolio crossed ₹1 Cr', icon: '👑', unlocked: stats?.totalValue >= 10000000 },
        { id: 6, name: 'Consistent Investor', description: '12 months of SIP', icon: '📈', unlocked: false },
        { id: 7, name: 'Diamond Hands', description: 'Held through 20% drop', icon: '💎', unlocked: false },
        { id: 8, name: 'Debt Slayers', description: 'Zero active loans', icon: '🕊️', unlocked: false },
        { id: 9, name: 'Market Wizard', description: 'Returns > 20%', icon: '🧙‍♂️', unlocked: stats?.totalPLPercent > 20 },
        { id: 10, name: 'IPO Hunter', description: 'Won an IPO allotment', icon: '🎟️', unlocked: false },
        { id: 11, name: 'Crisis Manager', description: 'Rebalanced during crash', icon: '⚖️', unlocked: false },
        { id: 12, name: 'Dividend King', description: 'Earned ₹10k dividends', icon: '💸', unlocked: false },
        { id: 13, name: 'Tax Ninja', description: 'Maxed out 80C', icon: '🥷', unlocked: true },
        { id: 14, name: 'Visionary', description: 'Created a 10-year goal', icon: '🔭', unlocked: true },
    ]);

    const unlockedCount = achievements.filter(a => a.unlocked).length;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <Trophy className="text-amber-500" /> Achievements
                <span className="ml-auto text-sm font-normal text-slate-500">{unlockedCount}/{achievements.length}</span>
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {achievements.map(achievement => (
                    <div
                        key={achievement.id}
                        className={`p-4 rounded-xl border text-center transition-all ${achievement.unlocked
                            ? 'bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border-amber-200 dark:border-amber-800'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-50'
                            }`}
                    >
                        <span className="text-3xl mb-2 block">{achievement.icon}</span>
                        <p className="font-bold text-sm text-slate-900 dark:text-white">{achievement.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{achievement.description}</p>
                        {achievement.unlocked && (
                            <span className="inline-block mt-2 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full text-[10px] font-bold">
                                UNLOCKED
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// ===================== PEER COMPARISON WIDGET =====================
export const PeerComparisonWidget: React.FC<{ stats: any }> = ({ stats }) => {
    const yourScore = 72;
    const peerAvg = 65;
    const [investorCount] = useState(() => Math.floor(Math.random() * 5000 + 10000));

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <Users className="text-blue-500" /> Peer Comparison
            </h3>
            <div className="text-center mb-4">
                <p className="text-4xl font-black text-indigo-600">{yourScore}</p>
                <p className="text-xs text-slate-500">Your Investment Score</p>
            </div>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Diversification</span>
                    <div className="flex items-center gap-2">
                        <span className="text-emerald-500 text-sm font-bold">Better than 78%</span>
                        <TrendingUp size={14} className="text-emerald-500" />
                    </div>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Returns</span>
                    <div className="flex items-center gap-2">
                        <span className="text-amber-500 text-sm font-bold">Average</span>
                    </div>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">SIP Consistency</span>
                    <div className="flex items-center gap-2">
                        <span className="text-emerald-500 text-sm font-bold">Top 10%</span>
                        <TrendingUp size={14} className="text-emerald-500" />
                    </div>
                </div>
            </div>
            <p className="text-xs text-slate-400 text-center mt-4">
                Compared with {investorCount.toLocaleString()} investors in your age group
            </p>
        </div>
    );
};

export default {
    VoiceCommandButton,
    AlertsDropdown,
    SettingsPanel,
    BankStatementParser,
    UPITrackerWidget,
    CreditCardOptimizer,
    NewsSentimentWidget,
    InvestmentClubsWidget,
    ChallengesWidget,
    SharePortfolioButton,
    PeerComparisonWidget
};
