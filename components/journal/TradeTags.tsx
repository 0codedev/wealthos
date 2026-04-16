import React, { useState, useMemo } from 'react';
import { Tag, Plus, X, Check, Hash, Zap, TrendingUp, AlertTriangle, Calendar, Flame, Target, Activity } from 'lucide-react';

// Predefined tag categories with colors
export const TRADE_TAG_PRESETS = {
    SETUP: [
        { id: 'breakout', label: 'Breakout', color: '#6366f1', icon: 'Zap' },
        { id: 'pullback', label: 'Pullback', color: '#10b981', icon: 'TrendingUp' },
        { id: 'reversal', label: 'Reversal', color: '#f59e0b', icon: 'Activity' },
        { id: 'momentum', label: 'Momentum', color: '#ec4899', icon: 'Flame' },
        { id: 'swing', label: 'Swing', color: '#8b5cf6', icon: 'Target' },
    ],
    CATALYST: [
        { id: 'earnings', label: 'Earnings', color: '#06b6d4', icon: 'Calendar' },
        { id: 'news', label: 'News', color: '#f43f5e', icon: 'AlertTriangle' },
        { id: 'sector_move', label: 'Sector Move', color: '#84cc16', icon: 'Hash' },
        { id: 'fii_dii', label: 'FII/DII', color: '#a855f7', icon: 'TrendingUp' },
    ],
    EMOTION: [
        { id: 'fomo', label: 'FOMO', color: '#ef4444', icon: 'Flame' },
        { id: 'revenge', label: 'Revenge', color: '#dc2626', icon: 'AlertTriangle' },
        { id: 'planned', label: 'Planned', color: '#22c55e', icon: 'Check' },
        { id: 'impulsive', label: 'Impulsive', color: '#f97316', icon: 'Zap' },
    ],
    OUTCOME: [
        { id: 'textbook', label: 'Textbook', color: '#10b981', icon: 'Check' },
        { id: 'lucky', label: 'Lucky', color: '#06b6d4', icon: 'Zap' },
        { id: 'lesson', label: 'Lesson', color: '#f59e0b', icon: 'Target' },
        { id: 'mistake', label: 'Mistake', color: '#ef4444', icon: 'AlertTriangle' },
    ],
};

export const ALL_PRESET_TAGS = [
    ...TRADE_TAG_PRESETS.SETUP,
    ...TRADE_TAG_PRESETS.CATALYST,
    ...TRADE_TAG_PRESETS.EMOTION,
    ...TRADE_TAG_PRESETS.OUTCOME,
];

interface TradeTagsProps {
    tags: string[];
    onChange: (tags: string[]) => void;
    readonly?: boolean;
    compact?: boolean;
}

export const TradeTags: React.FC<TradeTagsProps> = ({ tags, onChange, readonly = false, compact = false }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [customTag, setCustomTag] = useState('');

    const tagInfoMap = useMemo(() => {
        const map: Record<string, typeof ALL_PRESET_TAGS[0]> = {};
        ALL_PRESET_TAGS.forEach(t => { map[t.id] = t; });
        return map;
    }, []);

    const toggleTag = (tagId: string) => {
        if (readonly) return;
        if (tags.includes(tagId)) {
            onChange(tags.filter(t => t !== tagId));
        } else {
            onChange([...tags, tagId]);
        }
    };

    const addCustomTag = () => {
        if (!customTag.trim() || tags.includes(customTag.trim().toLowerCase())) return;
        onChange([...tags, customTag.trim().toLowerCase()]);
        setCustomTag('');
    };

    const removeTag = (tagId: string) => {
        if (readonly) return;
        onChange(tags.filter(t => t !== tagId));
    };

    // Compact display for list views
    if (compact) {
        return (
            <div className="flex flex-wrap gap-1">
                {tags.map(tag => {
                    const preset = tagInfoMap[tag];
                    return (
                        <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                            style={{
                                backgroundColor: preset ? `${preset.color}20` : '#64748b20',
                                color: preset?.color || '#64748b',
                            }}
                        >
                            {preset?.label || tag}
                        </span>
                    );
                })}
                {tags.length === 0 && (
                    <span className="text-[10px] text-slate-400 italic">No tags</span>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Selected Tags */}
            <div className="flex flex-wrap gap-2">
                {tags.map(tag => {
                    const preset = tagInfoMap[tag];
                    return (
                        <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all"
                            style={{
                                backgroundColor: preset ? `${preset.color}20` : '#64748b20',
                                color: preset?.color || '#64748b',
                                border: `1px solid ${preset?.color || '#64748b'}30`,
                            }}
                        >
                            <Tag size={10} />
                            {preset?.label || tag}
                            {!readonly && (
                                <button
                                    onClick={() => removeTag(tag)}
                                    className="ml-1 hover:bg-white/30 rounded p-0.5"
                                >
                                    <X size={10} />
                                </button>
                            )}
                        </span>
                    );
                })}
                {tags.length === 0 && !readonly && (
                    <span className="text-xs text-slate-400 italic">Click to add tags</span>
                )}
            </div>

            {/* Tag Picker (Expandable) */}
            {!readonly && (
                <>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600 font-bold"
                    >
                        <Plus size={12} />
                        {isExpanded ? 'Hide Tags' : 'Add Tags'}
                    </button>

                    {isExpanded && (
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                            {/* Category Sections */}
                            {Object.entries(TRADE_TAG_PRESETS).map(([category, categoryTags]) => (
                                <div key={category}>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">{category}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {categoryTags.map(preset => {
                                            const isSelected = tags.includes(preset.id);
                                            return (
                                                <button
                                                    key={preset.id}
                                                    onClick={() => toggleTag(preset.id)}
                                                    className={`px-2 py-1 rounded-lg text-xs font-bold transition-all border ${isSelected
                                                        ? 'ring-2 ring-offset-1'
                                                        : 'hover:scale-105'
                                                        }`}
                                                    style={{
                                                        backgroundColor: `${preset.color}${isSelected ? '30' : '10'}`,
                                                        color: preset.color,
                                                        borderColor: `${preset.color}${isSelected ? '50' : '20'}`,
                                                    }}
                                                >
                                                    {preset.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {/* Custom Tag Input */}
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                                <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Custom Tag</p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={customTag}
                                        onChange={(e) => setCustomTag(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && addCustomTag()}
                                        placeholder="Add custom tag..."
                                        className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500/50"
                                    />
                                    <button
                                        onClick={addCustomTag}
                                        disabled={!customTag.trim()}
                                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg transition-all"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default TradeTags;
