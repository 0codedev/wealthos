
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Star, Save, Calendar, ThumbsUp, ThumbsDown, Activity, Moon, Battery, Dumbbell, Smile } from 'lucide-react';
import { db, DailyReview } from '../../database';

const MOODS = ['Focused', 'Confident', 'Neutral', 'Anxious', 'Tilted'];

interface DailyReviewModalProps {
    date: string;
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
}

const MARKET_CONDITIONS = ['Trending', 'Choppy', 'Volatile', 'Sideways'];

const DailyReviewModal: React.FC<DailyReviewModalProps> = ({ date, isOpen, onClose, onSave }) => {
    const [formData, setFormData] = useState<DailyReview>({
        date,
        rating: 3,
        marketCondition: 'Sideways',
        notes: '',
        didWell: '',
        didPoorly: '',
        sleepHours: 7,
        energyLevel: 5,
        exercise: false,
        mood: 'Neutral'
    });

    useEffect(() => {
        if (isOpen && date) {
            loadReview();
        }
    }, [isOpen, date]);

    const loadReview = async () => {
        const existing = await db.daily_reviews.get(date);
        if (existing) {
            setFormData(existing);
        } else {
            // Reset for new date
            setFormData({
                date,
                rating: 3,
                marketCondition: 'Sideways',
                notes: '',
                didWell: '',
                didPoorly: '',
                sleepHours: 7,
                energyLevel: 5,
                exercise: false,
                mood: 'Neutral'
            });
        }
    };

    const handleSave = async () => {
        await db.daily_reviews.put(formData);
        onSave();
        onClose();
    };

    if (!isOpen) return null;
    if (typeof window === 'undefined') return null;

    return createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="daily-review-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950/50 backdrop-blur-md">
                    <div className="flex items-center gap-4">
                        <div className="p-2.5 bg-indigo-500/10 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-800/50">
                            <Calendar size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic">
                                Daily Report Card
                            </h2>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-bold tracking-[0.2em]">{date}</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Close modal" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-900 dark:hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-8 space-y-8 overflow-y-auto custom-scrollbar">

                    {/* Rating Section */}
                    <div className="flex flex-col items-center py-4 border-b border-slate-100 dark:border-slate-800/50">
                        <label className="text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest mb-4">Performance Session Grade</label>
                        <div className="flex gap-4">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    onClick={() => setFormData({ ...formData, rating: star })}
                                    className={`p-2 rounded-full transition-all duration-300 ${formData.rating >= star ? 'text-amber-500 scale-125 drop-shadow-sm' : 'text-slate-200 dark:text-slate-750 hover:text-slate-300 dark:hover:text-slate-700'}`}
                                >
                                    <Star size={36} fill={formData.rating >= star ? "currentColor" : "none"} strokeWidth={formData.rating >= star ? 0 : 2} />
                                </button>
                            ))}
                        </div>
                        <p className="text-xs font-black mt-4 text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">
                            {formData.rating === 5 ? 'Elite Performance' :
                                formData.rating === 4 ? 'Solid Execution' :
                                    formData.rating === 3 ? 'Average Day' :
                                        formData.rating === 2 ? 'Subpar Session' : 'Execution Disaster'}
                        </p>
                    </div>

                    {/* Market Conditions */}
                    <div>
                        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1">Market Environment</label>
                        <div className="flex flex-wrap gap-2">
                            {MARKET_CONDITIONS.map(cond => (
                                <button
                                    key={cond}
                                    onClick={() => setFormData({ ...formData, marketCondition: cond as any })}
                                    className={`flex-1 min-w-[100px] py-3 rounded-xl text-xs font-black uppercase tracking-wider border transition-all ${formData.marketCondition === cond ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-500/20' : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-700 shadow-inner'}`}
                                >
                                    {cond}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* The Mirror */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                                <ThumbsUp size={14} /> Wins & Bright Spots
                            </label>
                            <textarea
                                value={formData.didWell}
                                onChange={(e) => setFormData({ ...formData, didWell: e.target.value })}
                                className="w-full h-28 bg-emerald-50/30 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-900/30 rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none shadow-inner"
                                placeholder="Disciplined exits, stayed patient..."
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-rose-600 dark:text-rose-500 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                                <ThumbsDown size={14} /> Friction & Errors
                            </label>
                            <textarea
                                value={formData.didPoorly}
                                onChange={(e) => setFormData({ ...formData, didPoorly: e.target.value })}
                                className="w-full h-28 bg-rose-50/30 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-900/30 rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-200 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all resize-none shadow-inner"
                                placeholder="FOMO, revenge trading, sizing..."
                            />
                        </div>
                    </div>

                    {/* General Notes */}
                    <div>
                        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1">Session Narrative</label>
                        <textarea
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            className="w-full h-32 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none shadow-inner"
                            placeholder="Deep reflections on internal state..."
                        />
                    </div>

                    {/* Phase 15: Holistic Life Journal */}
                    <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2 mb-6 uppercase tracking-wider italic">
                            <Activity size={18} className="text-emerald-500" /> Life Optimization Layer
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Sleep and Energy */}
                            <div className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 flex items-center justify-between gap-1 mb-3 uppercase tracking-widest">
                                        <span className="flex items-center gap-1.5"><Moon size={14} /> Sleep Quality</span>
                                        <span className="font-mono text-indigo-600 dark:text-indigo-400">{formData.sleepHours} Hours</span>
                                    </label>
                                    <input
                                        type="range" min="0" max="14" step="0.5"
                                        value={formData.sleepHours || 7}
                                        onChange={(e) => setFormData({ ...formData, sleepHours: parseFloat(e.target.value) })}
                                        className="w-full accent-indigo-600 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full appearance-none cursor-pointer"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 flex items-center justify-between gap-1 mb-3 uppercase tracking-widest">
                                        <span className="flex items-center gap-1.5"><Battery size={14} /> Energy Level</span>
                                        <span className="font-mono text-emerald-600 dark:text-emerald-400">{formData.energyLevel}/10</span>
                                    </label>
                                    <input
                                        type="range" min="1" max="10" step="1"
                                        value={formData.energyLevel || 5}
                                        onChange={(e) => setFormData({ ...formData, energyLevel: parseInt(e.target.value) })}
                                        className="w-full accent-emerald-600 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>

                            {/* Mood and Exercise */}
                            <div className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-3 uppercase tracking-widest">
                                        <Smile size={14} /> Internal State
                                    </label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {MOODS.map(m => (
                                            <button
                                                key={m}
                                                onClick={() => setFormData({ ...formData, mood: m as any })}
                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all ${formData.mood === m ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-500 hover:border-slate-400 dark:hover:border-slate-700'}`}
                                            >
                                                {m}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-inner">
                                    <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 flex items-center gap-2 uppercase tracking-widest">
                                        <Dumbbell size={16} className="text-emerald-500" /> Physical Training
                                    </label>
                                    <button
                                        onClick={() => setFormData({ ...formData, exercise: !formData.exercise })}
                                        className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${formData.exercise ? 'bg-emerald-600' : 'bg-slate-200 dark:bg-slate-800'}`}
                                    >
                                        <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-300 ${formData.exercise ? 'translate-x-6' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex justify-end backdrop-blur-md">
                    <button
                        onClick={handleSave}
                        className="px-10 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-600/30 transition-all active:scale-95"
                    >
                        <Save size={18} className="inline mr-2" /> Commit Report
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default DailyReviewModal;
