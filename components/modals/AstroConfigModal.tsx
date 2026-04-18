import React from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { X, Moon, Sun, Zap, Shield, AlertCircle } from 'lucide-react';

interface AstroConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AstroConfigModal: React.FC<AstroConfigModalProps> = ({ isOpen, onClose }) => {
    const astroProfile = useSettingsStore(state => state.astroProfile);
    const updateSetting = useSettingsStore(state => state.updateSetting);
    const isAstroPsychologyEnabled = useSettingsStore(state => state.isAstroPsychologyEnabled);

    if (!isOpen) return null;

    const handleUpdate = (field: string, value: any) => {
        updateSetting('astroProfile', { ...astroProfile, [field]: value });
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-slate-200/50 dark:border-slate-700/40 overflow-hidden animate-modal-pop">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-indigo-500/5 to-purple-500/5">
                    <div>
                        <h2 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                            <Moon size={20} className="text-indigo-500" />
                            Astro-Psychology Profile
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">Align your trading discipline with your planetary strengths.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Toggle */}
                    <div className="flex items-center justify-between p-4 rounded-3xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl ${isAstroPsychologyEnabled ? 'bg-indigo-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}`}>
                                <Zap size={18} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-white">Enable Astro-Intelligence</p>
                                <p className="text-[10px] text-slate-500">Injects astrological archetypes into AI coaching.</p>
                            </div>
                        </div>
                        <button 
                            onClick={() => updateSetting('isAstroPsychologyEnabled', !isAstroPsychologyEnabled)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${isAstroPsychologyEnabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isAstroPsychologyEnabled ? 'right-1' : 'left-1'}`} />
                        </button>
                    </div>

                    {/* Basic Info */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Lagna (Ascendant)</label>
                            <select 
                                value={astroProfile.lagna}
                                onChange={(e) => handleUpdate('lagna', e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            >
                                {['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'].map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Daily Trade Limit</label>
                            <input 
                                type="number"
                                value={astroProfile.maxTradesPerDay}
                                onChange={(e) => handleUpdate('maxTradesPerDay', parseInt(e.target.value))}
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                        </div>
                    </div>

                    {/* Archetypes */}
                    <div className="space-y-4 pt-2">
                        <div className="p-4 rounded-3xl border border-rose-100 dark:border-rose-900/30 bg-rose-50/30 dark:bg-rose-900/10">
                            <div className="flex items-center gap-2 mb-3">
                                <AlertCircle size={16} className="text-rose-500" />
                                <h3 className="text-sm font-bold text-rose-600 dark:text-rose-400">The Shadow (Rahu / Impulsivity)</h3>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                                Your shadow represents the emotional force behind over-trading, revenge trades, and chasing quick gains.
                            </p>
                            <select 
                                value={astroProfile.tradingShadow}
                                onChange={(e) => handleUpdate('tradingShadow', e.target.value)}
                                className="w-full bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800/50 rounded-2xl px-4 py-2.5 text-sm outline-none"
                            >
                                {['Rahu', 'Mars', 'Moon (Weak)', 'Mercury (Combust)'].map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>

                        <div className="p-4 rounded-3xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/30 dark:bg-emerald-900/10">
                            <div className="flex items-center gap-2 mb-3">
                                <Shield size={16} className="text-emerald-500" />
                                <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-400">The Anchor (Saturn / Discipline)</h3>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                                Your anchor is your inherent ability to resist noise and wait for high-probability setups.
                            </p>
                            <select 
                                value={astroProfile.disciplineStrength}
                                onChange={(e) => handleUpdate('disciplineStrength', e.target.value)}
                                className="w-full bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/50 rounded-2xl px-4 py-2.5 text-sm outline-none"
                            >
                                {['Saturn', 'Jupiter', 'Sun', 'Mars (Disciplined)'].map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                    <button 
                        onClick={onClose}
                        className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-3.5 rounded-2xl hover:opacity-90 transition-opacity shadow-lg"
                    >
                        Save Astro Profile
                    </button>
                </div>
            </div>
        </div>
    );
};
