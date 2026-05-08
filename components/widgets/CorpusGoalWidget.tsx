import React, { useState, useEffect } from 'react';
import { Target, Calendar, Save, TrendingUp } from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import { formatCurrencyCompact } from '../../utils/helpers';

interface CorpusGoalWidgetProps {
    formatCurrency?: (val: number) => string;
}

export const CorpusGoalWidget: React.FC<CorpusGoalWidgetProps> = ({ formatCurrency = (v) => `₹${v.toLocaleString('en-IN')}` }) => {
    const targetNetWorth = useSettingsStore(state => state.targetNetWorth);
    const targetDate = useSettingsStore(state => state.targetDate);
    const updateSetting = useSettingsStore(state => state.updateSetting);
    const [localTarget, setLocalTarget] = useState(targetNetWorth.toString());
    const [localDate, setLocalDate] = useState(targetDate);
    const [saved, setSaved] = useState(false);

    const handleSave = () => {
        const parsed = parseFloat(localTarget.replace(/,/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
            updateSetting('targetNetWorth', parsed);
            updateSetting('targetDate', localDate);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        }
    };

    return (
        <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-700 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
            {/* Background decoration */}
            <div className="absolute top-0 right-0 opacity-10">
                <Target size={120} />
            </div>

            <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                    <Target size={20} />
                    <h3 className="text-lg font-bold">Set Your Corpus Goal</h3>
                </div>

                <div className="space-y-4">
                    {/* Target Amount */}
                    <div>
                        <label htmlFor="corpus-goal-amount" className="text-xs text-white/70 block mb-1">
                            Target Amount (₹)
                        </label>
                        <input
                            id="corpus-goal-amount"
                            type="text"
                            inputMode="numeric"
                            aria-label="Target corpus amount in rupees"
                            value={localTarget}
                            onChange={(e) => setLocalTarget(e.target.value)}
                            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/30"
                            placeholder="500000"
                        />
                        {localTarget && !isNaN(parseFloat(localTarget.replace(/,/g, ''))) && parseFloat(localTarget.replace(/,/g, '')) > 0 && (
                            <p className="text-[10px] text-white/60 mt-1.5 font-mono">
                                ≈ {formatCurrencyCompact(parseFloat(localTarget.replace(/,/g, '')))}
                            </p>
                        )}
                    </div>

                    {/* Target Date */}
                    <div>
                        <label htmlFor="corpus-goal-date" className="text-xs text-white/70 block mb-1 flex items-center gap-1">
                            <Calendar size={12} /> Target Date
                        </label>
                        <input
                            id="corpus-goal-date"
                            type="date"
                            aria-label="Target date to reach the corpus goal"
                            value={localDate}
                            onChange={(e) => setLocalDate(e.target.value)}
                            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-white/30"
                        />
                    </div>

                    {/* Save Button */}
                    <button
                        type="button"
                        onClick={handleSave}
                        aria-label="Save corpus goal"
                        className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${saved
                            ? 'bg-emerald-500 text-white'
                            : 'bg-white text-indigo-600 hover:bg-white/90'
                        }`}
                    >
                        {saved ? (
                            <>✓ Saved</>
                        ) : (
                            <>
                                <Save size={16} /> Save Goal
                            </>
                        )}
                    </button>
                </div>

                {/* Pro Tip */}
                <div className="mt-4 p-3 bg-white/10 rounded-xl">
                    <p className="text-xs text-white/80 flex items-start gap-2">
                        <span className="text-yellow-300">💡</span>
                        Pro tip: Set a goal that challenges you but is achievable. Start with ₹1L!
                    </p>
                </div>
            </div>
        </div>
    );
};

export default CorpusGoalWidget;
