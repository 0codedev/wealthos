import React from 'react';
import { X, AlertTriangle, Save, RefreshCw, Cpu, Database, Signal, Eye, Brain, Activity, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { modalOverlayVariants, modalContentVariants } from './ui/animations';
import { useSettingsStore, SettingsState } from '../store/settingsStore';
import DataBackupSettings from './DataBackupSettings';
import SecurityPrivacyPanel from './settings/SecurityPrivacyPanel';
import { MODEL_REGISTRY } from '../services/llm/models';
import { PremiumSelect } from './ui/PremiumSelect';
import { KeyPoolManager } from '../services/llm/keyPool';
import { AIProvider } from '../types/ai';

interface LogicConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const inputClassName = 'w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-2.5 text-sm text-slate-900 dark:text-white outline-none transition-colors focus:border-indigo-500';
const compactInputClassName = 'w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-2.5 text-xs text-slate-900 dark:text-white outline-none transition-colors focus:border-indigo-500';

const LogicConfigModal: React.FC<LogicConfigModalProps> = ({ isOpen, onClose }) => {
    const settings = useSettingsStore();
    const updateSetting = settings.updateSetting;
    const [selectedPoolProvider, setSelectedPoolProvider] = React.useState<AIProvider>('gemini');
    const [poolKeysText, setPoolKeysText] = React.useState('');

    React.useEffect(() => {
        if (isOpen) {
            const keys = KeyPoolManager.getInstance().getKeys(selectedPoolProvider);
            setPoolKeysText(keys.join('\n'));
        }
    }, [selectedPoolProvider, isOpen]);

    const handlePoolKeysChange = (text: string) => {
        setPoolKeysText(text);
        const keysArray = text.split('\n').map(k => k.trim()).filter(Boolean);
        KeyPoolManager.getInstance().setKeys(selectedPoolProvider, keysArray);
    };

    const handleChange = (key: keyof SettingsState, value: string) => {
        if (key === 'targetDate' || key === 'geminiApiKey' || key === 'groqApiKey' || key === 'openRouterApiKey' || key === 'preferredModelId') {
            updateSetting(key, value);
            return;
        }
        let numValue = parseFloat(value);
        if (isNaN(numValue)) numValue = 0;
        updateSetting(key, numValue);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <motion.div
                        variants={modalOverlayVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        onClick={onClose}
                    />
                    <motion.div
                        variants={modalContentVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="relative z-10 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-slate-200/50 dark:border-slate-700/40 bg-white/80 dark:bg-slate-950/80 backdrop-blur-2xl shadow-[0_30px_80px_rgba(15,23,42,0.7)]"
                    >
                        <div className="border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-indigo-50/50 via-white to-red-50/20 dark:from-indigo-950/50 dark:via-slate-950 dark:to-red-950/20 p-6">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/20">
                                        <Cpu size={24} />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-indigo-600 dark:text-indigo-300">Logic Core</p>
                                        <h2 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">System Configuration</h2>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">High-impact controls for intelligence, risk, broker trust, and recovery behavior.</p>
                                    </div>
                                </div>
                                <button onClick={onClose} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white">
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="mb-6 rounded-[26px] border border-amber-500/20 bg-amber-500/10 p-4">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={18} />
                                    <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-100">
                                        <strong className="font-black uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">High impact zone.</strong> Changes here alter portfolio guidance, broker execution safeguards, recovery behavior, and AI routing across the app.
                                    </p>
                                </div>
                            </div>

                            <div className="grid gap-6 lg:grid-cols-2">
                                <div className="rounded-[26px] border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/60 p-5">
                                    <h3 className="border-b border-slate-200 dark:border-slate-800 pb-3 text-xs font-black uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Targets & Risk</h3>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Project 5L Target (₹)</label>
                                            <input type="number" value={settings.targetNetWorth} onChange={(e) => handleChange('targetNetWorth', e.target.value)} className={inputClassName} />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Target Date</label>
                                            <input type="date" value={settings.targetDate} onChange={(e) => handleChange('targetDate', e.target.value)} className={inputClassName} />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Max Risk Per Trade (%)</label>
                                            <input type="number" value={settings.riskPerTrade} onChange={(e) => handleChange('riskPerTrade', e.target.value)} className={inputClassName} />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Bullion Cap (%)</label>
                                            <input type="number" value={settings.bullionCap} onChange={(e) => handleChange('bullionCap', e.target.value)} className={inputClassName} />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Loan Principal (₹)</label>
                                            <input type="number" value={settings.loanPrincipal} onChange={(e) => handleChange('loanPrincipal', e.target.value)} className={inputClassName} />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Interest Rate (%)</label>
                                            <input type="number" value={settings.loanInterest} onChange={(e) => handleChange('loanInterest', e.target.value)} className={inputClassName} />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Greed Killer ROI (%)</label>
                                            <input type="number" value={settings.greedKillerRoi} onChange={(e) => handleChange('greedKillerRoi', e.target.value)} className={inputClassName} />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">IPO Fresh Issue Limit (%)</label>
                                            <input type="number" value={settings.ipoFreshIssueThreshold} onChange={(e) => handleChange('ipoFreshIssueThreshold', e.target.value)} className={inputClassName} />
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-[26px] border border-indigo-500/20 bg-indigo-500/10 p-5">
                                    <div className="flex items-center justify-between gap-3">
                                        <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">
                                            <Brain size={14} /> Intelligence Core
                                        </h3>
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">
                                            <Signal size={12} /> AIR active
                                        </div>
                                    </div>
                                    <div className="mt-4 space-y-4">
                                        <div>
                                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Google Gemini Key</label>
                                            <input type="password" value={settings.geminiApiKey} onChange={(e) => handleChange('geminiApiKey', e.target.value)} className={compactInputClassName} placeholder="AIzaSy..." />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Groq Key</label>
                                                <input type="password" value={settings.groqApiKey} onChange={(e) => handleChange('groqApiKey', e.target.value)} className={compactInputClassName} placeholder="gsk_..." />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">OpenRouter Key</label>
                                                <input type="password" value={settings.openRouterApiKey} onChange={(e) => handleChange('openRouterApiKey', e.target.value)} className={compactInputClassName} placeholder="sk-or-v1-..." />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Mistral Key</label>
                                                <input type="password" value={settings.mistralApiKey} onChange={(e) => handleChange('mistralApiKey', e.target.value)} className={compactInputClassName} placeholder="Mistral Key..." />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Cerebras Key</label>
                                                <input type="password" value={settings.cerebrasApiKey} onChange={(e) => handleChange('cerebrasApiKey', e.target.value)} className={compactInputClassName} placeholder="Cerebras Key..." />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">GitHub Token</label>
                                                <input type="password" value={settings.githubToken} onChange={(e) => handleChange('githubToken', e.target.value)} className={compactInputClassName} placeholder="ghp_..." />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">CF Account ID</label>
                                                <input type="text" value={settings.cloudflareAccountId} onChange={(e) => handleChange('cloudflareAccountId', e.target.value)} className={compactInputClassName} placeholder="CF ID..." />
                                            </div>
                                        </div>
                                        <div className="border-t border-indigo-500/20 pt-4">
                                            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300 mb-2">API Key Pool (Multi-Account Rotation)</label>
                                            <div className="grid gap-3 sm:grid-cols-3 mb-3">
                                                <div className="sm:col-span-1">
                                                    <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Select Provider</label>
                                                    <select 
                                                        value={selectedPoolProvider} 
                                                        onChange={(e) => setSelectedPoolProvider(e.target.value as any)}
                                                        className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-2 text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-500"
                                                    >
                                                        <option value="gemini">Gemini</option>
                                                        <option value="groq">Groq</option>
                                                        <option value="cerebras">Cerebras</option>
                                                        <option value="mistral">Mistral</option>
                                                        <option value="openrouter">OpenRouter</option>
                                                        <option value="github">GitHub</option>
                                                        <option value="cloudflare">Cloudflare</option>
                                                    </select>
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Keys (One per line)</label>
                                                    <textarea
                                                        value={poolKeysText}
                                                        onChange={(e) => handlePoolKeysChange(e.target.value)}
                                                        placeholder="Enter keys, one per line..."
                                                        rows={2}
                                                        className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-2 text-xs text-slate-900 dark:text-white font-mono outline-none focus:border-indigo-500 resize-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="border-t border-indigo-500/20 pt-4">
                                            <div className="mb-4 flex items-center justify-between">
                                               <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300">AIR Pipeline Routing</label>
                                               <a href="https://github.com/cheahjs/free-llm-api-resources" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[9px] font-bold text-indigo-500 hover:text-indigo-900 dark:hover:text-white transition-colors">
                                                   <Sparkles size={10} /> Get Free Keys
                                               </a>
                                            </div>
                                            
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                {/* Ambient Insights */}
                                                <PremiumSelect
                                                    label="Ambient Insights"
                                                    value={settings.modelGeneralId || ''}
                                                    onChange={(val) => settings.updateSetting('modelGeneralId', val)}
                                                    options={MODEL_REGISTRY}
                                                />

                                                {/* AI Coach */}
                                                <PremiumSelect
                                                    label="AI Trading Coach"
                                                    value={settings.modelCoachId || ''}
                                                    onChange={(val) => settings.updateSetting('modelCoachId', val)}
                                                    options={MODEL_REGISTRY}
                                                />

                                                {/* Deep Insights */}
                                                <PremiumSelect
                                                    label="Deep Logic Engine"
                                                    value={settings.modelInsightsId || ''}
                                                    onChange={(val) => settings.updateSetting('modelInsightsId', val)}
                                                    options={MODEL_REGISTRY}
                                                />

                                                {/* Alpha Engine */}
                                                <PremiumSelect
                                                    label="Alpha Predator Engine"
                                                    value={settings.modelAlphaEngineId || ''}
                                                    onChange={(val) => settings.updateSetting('modelAlphaEngineId', val)}
                                                    options={MODEL_REGISTRY}
                                                />

                                                {/* Macro Pulse */}
                                                <PremiumSelect
                                                    label="Macro Pulse AI"
                                                    value={settings.modelMacroPulseId || ''}
                                                    onChange={(val) => settings.updateSetting('modelMacroPulseId', val)}
                                                    options={MODEL_REGISTRY}
                                                />

                                                {/* Trade Journal */}
                                                <PremiumSelect
                                                    label="Trade Journal AI"
                                                    value={settings.modelJournalId || ''}
                                                    onChange={(val) => settings.updateSetting('modelJournalId', val)}
                                                    options={MODEL_REGISTRY}
                                                />

                                                <div className="md:col-span-2 pt-2">
                                                    <PremiumSelect
                                                        label="Global Fallback Chain Target"
                                                        value={settings.preferredModelId || ''}
                                                        onChange={(val) => settings.updateSetting('preferredModelId', val)}
                                                        options={MODEL_REGISTRY}
                                                    />
                                                </div>
                                            </div>
                                            <p className="mt-4 text-[10px] leading-relaxed text-slate-500 italic text-center">The AIR pipeline auto-rotates across Groq → Cerebras → Mistral → Gemini to ensure zero downtime.</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-[26px] border border-emerald-500/20 bg-emerald-500/10 p-5">
                                    <div className="flex items-center justify-between gap-3">
                                        <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-300">
                                            <Activity size={14} /> Broker & Feeds
                                        </h3>
                                        <button
                                            onClick={() => settings.updateSetting('dataMode', settings.dataMode === 'LIVE' ? 'SIMULATION' : 'LIVE')}
                                            className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${settings.dataMode === 'LIVE' ? 'bg-emerald-400 text-slate-950' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                                        >
                                            {settings.dataMode === 'LIVE' ? 'Live Sync' : 'Offline'}
                                        </button>
                                    </div>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                        <div>
                                            <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Dhan Client ID</label>
                                            <input type="text" value={settings.dhanClientId} onChange={(e) => settings.updateSetting('dhanClientId', e.target.value)} className={compactInputClassName} placeholder="Client ID..." />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Trading PIN</label>
                                            <input type="password" maxLength={6} value={settings.dhanPin} onChange={(e) => settings.updateSetting('dhanPin', e.target.value)} className={compactInputClassName} placeholder="6-digit PIN" />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Dhan Access Token</label>
                                            <input type="password" value={settings.dhanAccessToken} onChange={(e) => settings.updateSetting('dhanAccessToken', e.target.value)} className={compactInputClassName} placeholder="Access Token..." />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">TOTP Secret</label>
                                            <input type="password" value={settings.dhanTotpSecret} onChange={(e) => settings.updateSetting('dhanTotpSecret', e.target.value)} className={compactInputClassName} placeholder="TOTP Secret..." />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">RapidAPI Key</label>
                                            <input type="password" value={settings.apiKeys?.rapidApi || ''} onChange={(e) => settings.updateSetting('apiKeys', { ...settings.apiKeys, rapidApi: e.target.value })} className={compactInputClassName} />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">FMP Key</label>
                                            <input type="password" value={settings.apiKeys?.fmp || ''} onChange={(e) => settings.updateSetting('apiKeys', { ...settings.apiKeys, fmp: e.target.value })} className={compactInputClassName} />
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-[26px] border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/60 p-5">
                                    <h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                                        <Eye size={14} /> Accessibility
                                    </h3>
                                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 p-4">
                                        <div>
                                            <label className="text-sm font-bold text-slate-900 dark:text-white">High Contrast Mode</label>
                                            <p className="mt-1 text-xs text-slate-500">Maximizes contrast for bright environments and dense workflow screens.</p>
                                        </div>
                                        <button
                                            onClick={() => settings.updateSetting('isHighContrast', !settings.isHighContrast)}
                                            className={`relative h-6 w-12 rounded-full transition-colors ${settings.isHighContrast ? 'bg-yellow-400' : 'bg-slate-300 dark:bg-slate-700'}`}
                                        >
                                            <div className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-black shadow-sm transition-transform ${settings.isHighContrast ? 'translate-x-6' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-6">
                                <h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                                    <Database size={14} /> Data & Recovery
                                </h3>
                                <DataBackupSettings />
                            </div>

                            <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-6">
                                <SecurityPrivacyPanel />
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 p-6">
                            <button
                                onClick={settings.resetDefaults}
                                className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-white"
                            >
                                <RefreshCw size={14} /> Reset Defaults
                            </button>
                            <button
                                onClick={onClose}
                                className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-indigo-500"
                            >
                                <Save size={16} /> Apply Config
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default LogicConfigModal;
