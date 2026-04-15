import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Target, ListChecks, CheckSquare, Award, Clock,
    Upload, Loader2, Plus, ArrowLeft, Save, AlertTriangle, ChevronRight, ChevronLeft, ChevronDown,
    Activity, ActivitySquare, Crosshair, TrendingUp, TrendingDown, BookOpen, Sun, AlertCircle,
    Compass, Layers, Globe, Brain, ShieldAlert, BadgeCheck, X, Download, Info, Zap
} from 'lucide-react';
import { LogMissedTradeModal } from './LogMissedTradeModal';
import { PreMarketRoutineModal } from './PreMarketRoutineModal';
import { useTradeForm } from '../../hooks/useTradeForm';
import { Trade } from '../../database';
import { EmptyState } from '../shared/EmptyState';
import { formatCurrency, compressImage, getISTDateString } from '../../utils/helpers';
import { openTradingView } from '../../utils/navigation';
import { ExternalLink } from 'lucide-react';
import { dhanBrokerService } from '../../services/DhanBrokerService';
import { getBrokerReviewStatusMeta, resolveTradeReviewStatus } from '../../services/BrokerReviewWorkflowService';
import { useCosmicGovernorStore } from '../../store/cosmicGovernorStore';
import { CosmicTradeGovernor } from '../../services/CosmicTradeGovernor';

interface ExecutionDeskProps {
    onClose: () => void;
    tradeToEdit?: Trade | null;
    onPushToMirror?: (data: { title: string; coreLesson: string; emotionalContext: string }) => void;
}

const OUTCOME_SUMMARY = ['Full Win', 'Partial Success', 'Breakeven', 'Partial Loss', 'Full Loss', 'Stopped Out'];


const MOODS_ENTRY = [
    { label: 'Focused', emoji: '🎯', color: 'border-emerald-500 text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Anxious', emoji: '😰', color: 'border-amber-500 text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Bored', emoji: '🥱', color: 'border-slate-500 text-slate-600 dark:text-slate-400', bg: 'bg-slate-500/10' },
    { label: 'Revenge', emoji: '😡', color: 'border-rose-500 text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10' },
    { label: 'Greedy', emoji: '🤑', color: 'border-green-400 text-green-600 dark:text-green-300', bg: 'bg-green-500/10' },
];

const MOODS_EXIT = [
    { label: 'Satisfied', emoji: '😌', color: 'border-emerald-500 text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Relieved', emoji: '😅', color: 'border-blue-500 text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Frustrated', emoji: '😤', color: 'border-rose-500 text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10' },
    { label: 'Regretful', emoji: '😞', color: 'border-amber-500 text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Euphoric', emoji: '🤩', color: 'border-purple-400 text-purple-600 dark:text-purple-300', bg: 'bg-purple-500/10' },
];

const ASSET_CLASSES = ['Equity', 'Options', 'Crypto', 'Forex', 'Futures', 'Commodities'];
const SETUP_TAGS = ['Breakout', 'Pullback', 'Reversal', 'Trend Following', 'Scalp', 'News Catalyst', 'Mean Reversion', 'Momentum'];
const PRODUCT_TYPES = ['INTRADAY', 'CNC', 'MARGIN', 'MTF'];

const MISTAKE_TAGS = ['FOMO', 'Chasing', 'No Stop Loss', 'Overleveraged', 'Early Exit', 'Hesitation', 'Revenge Trade', 'News Trading', 'Averaged Down', 'Boredom Trade', 'Ignored Rules', 'Poor Sleep'];
const GRADES = ['A+', 'A', 'B', 'C', 'D', 'F'];

interface CustomSelectOption {
    value: string;
    label: string;
    subtext?: string;
    color?: string;
}

interface CustomSelectProps {
    value: string;
    onChange: (val: string) => void;
    options: CustomSelectOption[];
    placeholder?: string;
    showSearch?: boolean;
}

const CustomSelect = React.memo(({ value, onChange, options, placeholder = 'Select option', showSearch = false }: CustomSelectProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setSearchQuery('');
        }
    }, [isOpen]);

    const selectedOption = options.find(o => o.value === value);

    const filteredOptions = useMemo(() => {
        if (!searchQuery.trim()) return options;
        return options.filter(option =>
            option.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (option.subtext && option.subtext.toLowerCase().includes(searchQuery.toLowerCase()))
        );
    }, [options, searchQuery]);

    return (
        <div ref={containerRef} className="relative w-full">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full bg-slate-900 hover:bg-slate-800 border rounded-lg px-3 py-2 text-xs text-white flex items-center justify-between h-[38px] cursor-pointer transition-all ${isOpen ? 'border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.25)]' : 'border-slate-700/50 hover:border-slate-650'
                    }`}
            >
                <div className="flex items-center gap-2 truncate">
                    {selectedOption ? (
                        <>
                            {selectedOption.color && (
                                <span className={`w-2.5 h-2.5 rounded-full ${selectedOption.color}`} />
                            )}
                            <span className="truncate font-medium">{selectedOption.label}</span>
                        </>
                    ) : (
                        <span className="text-slate-505">{placeholder}</span>
                    )}
                </div>
                <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.12 }}
                        className="absolute left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 overflow-hidden flex flex-col max-h-60"
                    >
                        {showSearch && (
                            <div className="p-2 border-b border-slate-800 bg-slate-950">
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                                    autoFocus
                                />
                            </div>
                        )}
                        <div className="py-1 overflow-y-auto custom-scrollbar max-h-48">
                            {filteredOptions.length > 0 ? (
                                filteredOptions.map((option) => {
                                    const isSelected = option.value === value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => {
                                                onChange(option.value);
                                                setIsOpen(false);
                                            }}
                                            className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-800 transition-colors ${isSelected ? 'bg-indigo-600/20 text-indigo-300 font-bold border-l-2 border-indigo-500' : 'text-slate-300 hover:text-white'
                                                }`}
                                        >
                                            {option.color && (
                                                <span className={`w-2 h-2 rounded-full ${option.color}`} />
                                            )}
                                            <div className="flex flex-col">
                                                <span>{option.label}</span>
                                                {option.subtext && (
                                                    <span className="text-[9px] text-slate-500 font-normal mt-0.5">{option.subtext}</span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })
                            ) : (
                                <EmptyState
                                    variant="minimal"
                                    type="no-results"
                                    message="No matches found"
                                />
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

CustomSelect.displayName = 'CustomSelect';

// --- MEMOIZED SUB-COMPONENTS ---
const MoodSelector = React.memo(({ moods, selectedMood, onSelect, label }: any) => (
    <div className="flex flex-col gap-2">
        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{label}</span>
        <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
            {moods.map((m: any) => (
                <button
                    key={m.label}
                    onClick={() => onSelect(m.label)}
                    className={`flex flex-col items-center gap-1 min-w-[70px] p-2 rounded-xl border-2 transition-all ${selectedMood === m.label ? `${m.bg} ${m.color.split(' ')[0]}` : 'bg-slate-950/50 border-slate-800/50 text-slate-500 hover:border-slate-700'}`}
                >
                    <span className="text-xl">{m.emoji}</span>
                    <span className="text-[10px] font-bold uppercase">{m.label}</span>
                </button>
            ))}
        </div>
    </div>
));

const StrategyGrid = React.memo(({ strategies, selectedSetup, onSelect, deepReflection }: any) => (
    <div className={`grid grid-cols-1 ${deepReflection ? 'sm:grid-cols-2' : 'sm:grid-cols-3 lg:grid-cols-4'} gap-3 ${deepReflection ? 'max-h-[220px]' : 'max-h-[160px]'} overflow-y-auto pr-2 custom-scrollbar`}>
        {strategies.map((s: any) => (
            <button
                key={s.id}
                onClick={() => onSelect(s.name)}
                className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${selectedSetup === s.name ? 'bg-indigo-600/10 border-indigo-500 shadow-sm' : 'bg-slate-900 border-slate-700 hover:border-slate-500'}`}
            >
                <span className={`block font-bold text-xs ${selectedSetup === s.name ? 'text-indigo-300' : 'text-slate-300'}`}>{s.name}</span>
                {deepReflection && <span className="text-[10px] text-slate-500 line-clamp-1 leading-relaxed">{s.description}</span>}
            </button>
        ))}
    </div>
));

const ChecklistGrid = React.memo(({ rules, checkedRules, onToggle }: any) => (
    <div className="flex-1 overflow-y-auto pr-2 space-y-2.5 custom-scrollbar min-h-[160px] max-h-[180px]">
        {rules.map((rule: string, idx: number) => (
            <label key={idx} className="flex items-start gap-3 cursor-pointer group transition-all p-1.5 rounded-md hover:bg-slate-900/50">
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 mt-0.5 ${checkedRules[idx] ? 'bg-indigo-500 border-indigo-500 shadow-sm' : 'bg-slate-900 border-slate-600 group-hover:border-indigo-400'}`}>
                    {checkedRules[idx] && <CheckSquare size={12} className="text-white" />}
                </div>
                <input type="checkbox" className="hidden" checked={checkedRules[idx]} onChange={() => onToggle(idx)} />
                <span className={`text-xs font-medium leading-relaxed transition-colors ${checkedRules[idx] ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-300'}`}>{rule}</span>
            </label>
        ))}
    </div>
));

const RulesFollowedSelector = React.memo(({ selectedStrategy, formData, updateField, handleRuleToggle }: any) => {
    const [searchQuery, setSearchQuery] = useState('');

    const globalDefaultRules = useMemo(() => [
        "Traded within preferred time window",
        "Checked for upcoming news events",
        "Exercised patience before entry",
        "Avoided revenge trading",
        "Had volume confirmation",
        "Traded in direction of higher timeframe trend"
    ], []);

    const allRules = useMemo(() => {
        const strategyRules = selectedStrategy ? selectedStrategy.rules : [];
        const merged = Array.from(new Set([...strategyRules, ...globalDefaultRules]));
        return merged;
    }, [selectedStrategy, globalDefaultRules]);

    const filteredRules = useMemo(() => {
        if (!searchQuery.trim()) return allRules.slice(0, 6);
        return allRules.filter(rule => rule.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [allRules, searchQuery]);

    return (
        <div className="flex flex-col gap-2">
            <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Rules Followed</label>
            <input
                type="text"
                placeholder="Search or add rules..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-white focus:border-indigo-500 outline-none h-[38px] transition-colors"
            />
            <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto pr-1 custom-scrollbar">
                {filteredRules.map((rule) => {
                    const isChecked = formData.rulesFollowed?.includes(rule) || false;
                    const handleRuleClick = () => {
                        const current = formData.rulesFollowed || [];
                        const updated = isChecked
                            ? current.filter((r: string) => r !== rule)
                            : [...current, rule];
                        updateField('rulesFollowed', updated);

                        if (selectedStrategy) {
                            const ruleIdx = selectedStrategy.rules.indexOf(rule);
                            if (ruleIdx !== -1) {
                                handleRuleToggle(ruleIdx);
                            }
                        }
                    };

                    return (
                        <button
                            key={rule}
                            onClick={handleRuleClick}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all text-left ${isChecked
                                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-sm'
                                : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-400'
                                }`}
                        >
                            {rule}
                        </button>
                    );
                })}
            </div>
        </div>
    );
});

const TradeScreenshotsUpload = React.memo(({
    previews,
    compressingType,
    htfRef,
    entryRef,
    exitRef,
    handleFileChange,
    onHoverSlot,
    onRemoveFile,
    activeTab,
    setActiveTab,
    showAnnotations = false,
    chartAnnotations,
    updateField
}: any) => {
    const [dragActive, setDragActive] = useState(false);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            const type = activeTab;

            const fakeEvent = {
                target: {
                    files: [file]
                }
            } as any;
            handleFileChange(type, fakeEvent);
        }
    };

    const activePreview = previews[activeTab.toLowerCase() as keyof typeof previews];
    const isActiveCompressing = compressingType === activeTab;

    return (
        <div className="flex flex-col gap-2 h-full justify-between">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Trade Screenshots</span>

            <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => {
                    const ref = activeTab === 'HTF' ? htfRef : activeTab === 'Entry' ? entryRef : exitRef;
                    ref.current?.click();
                }}
                className={`flex-1 min-h-[220px] rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-2 cursor-pointer relative overflow-hidden ${dragActive ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                    }`}
            >
                {activePreview ? (
                    <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-slate-950/90 overflow-hidden group">
                        {/* Blurred background image */}
                        <img src={activePreview} className="absolute inset-0 w-full h-full object-cover opacity-25 blur-md" alt="" />
                        {/* Sharp centered image */}
                        <img src={activePreview} className="relative z-10 max-w-full max-h-full object-contain" alt={activeTab} />

                        {/* Selected View Badge */}
                        <div className="absolute top-3 left-3 z-20 bg-slate-950/80 border border-slate-800 rounded px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-400">
                            {activeTab} View
                        </div>

                        {/* Hover Overlay info */}
                        <div className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-15 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white uppercase bg-indigo-600/90 border border-indigo-500 rounded-lg px-3 py-1.5 shadow-lg flex items-center gap-1.5">
                                <Upload size={12} /> Click or Drop to Replace
                            </span>
                        </div>

                        {/* Clear image button */}
                        {onRemoveFile && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveFile(activeTab);
                                }}
                                className="absolute top-3 right-3 z-30 p-1.5 bg-rose-500/80 hover:bg-rose-600 text-white rounded-md transition-all shadow-md hover:scale-105"
                                title="Remove screenshot"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                ) : isActiveCompressing ? (
                    <div className="flex flex-col items-center text-indigo-400">
                        <Loader2 className="animate-spin mb-3" size={24} />
                        <span className="font-bold tracking-widest text-[10px] uppercase">Optimizing {activeTab}...</span>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center gap-2 pointer-events-none text-center p-4">
                        <Upload className="text-slate-500 animate-pulse" size={24} />
                        <span className="text-xs font-bold text-slate-300">Drag &amp; drop {activeTab} screenshot here</span>
                        <span className="text-[10px] text-slate-500">Or click to select (Supports JPG, PNG Max 5MB)</span>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-3 gap-3 mt-3">
                {(['HTF', 'Entry', 'Exit'] as const).map(type => {
                    const prevUrl = previews[type.toLowerCase() as keyof typeof previews];
                    const isComp = compressingType === type;
                    const ref = type === 'HTF' ? htfRef : type === 'Entry' ? entryRef : exitRef;
                    const isActive = activeTab === type;

                    return (
                        <div key={type} className="flex flex-col gap-1">
                            <div
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (activeTab !== type) {
                                        setActiveTab(type);
                                        if (!prevUrl) {
                                            ref.current?.click();
                                        }
                                    } else {
                                        ref.current?.click();
                                    }
                                }}
                                onMouseEnter={() => onHoverSlot?.(type)}
                                onMouseLeave={() => onHoverSlot?.(null)}
                                className={`h-20 rounded-lg border flex items-center justify-center cursor-pointer group relative overflow-hidden transition-all ${isActive
                                        ? 'border-indigo-500 bg-indigo-500/10 shadow-[0_0_10px_rgba(99,102,241,0.25)]'
                                        : prevUrl
                                            ? 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                                            : 'border-slate-800 bg-slate-900/50 hover:border-slate-750'
                                    }`}
                            >
                                {prevUrl ? (
                                    <>
                                        <img src={prevUrl} alt={type} className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${isActive ? 'opacity-90' : 'opacity-40 group-hover:opacity-75'}`} />
                                        <div className="absolute inset-0 bg-slate-950/20" />
                                        <span className={`relative z-10 text-[9px] font-black uppercase px-2 py-0.5 rounded shadow-sm ${isActive ? 'text-white bg-indigo-600' : 'text-slate-400 bg-slate-950/80'}`}>{type}</span>
                                    </>
                                ) : isComp ? (
                                    <Loader2 className="animate-spin text-indigo-400" size={16} />
                                ) : (
                                    <div className="flex flex-col items-center gap-0.5">
                                        <Upload size={14} className="text-slate-500 group-hover:text-indigo-400" />
                                        <span className="text-[9px] font-bold text-slate-400 group-hover:text-slate-200">{type}</span>
                                    </div>
                                )}
                            </div>
                            <input type="file" ref={ref} onChange={e => handleFileChange(type, e)} className="hidden" accept="image/*" />
                        </div>
                    );
                })}
            </div>

            {showAnnotations && (
                <div className="mt-3">
                    <label className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block mb-1">
                        {activeTab} Screenshot Annotation
                    </label>
                    <input
                        type="text"
                        placeholder={`Describe what you see in the ${activeTab} chart...`}
                        value={chartAnnotations?.[activeTab.toLowerCase()] || ''}
                        onChange={e => {
                            const newAnns = { ...chartAnnotations, [activeTab.toLowerCase()]: e.target.value };
                            updateField?.('chartAnnotations', newAnns);
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-500 transition-colors shadow-inner"
                    />
                </div>
            )}
        </div>
    );
});

const ExecutionDesk: React.FC<ExecutionDeskProps> = React.memo(({ onClose, tradeToEdit, onPushToMirror }) => {
    const [isPreMarketOpen, setIsPreMarketOpen] = useState(false);
    const [isMissedTradeModalOpen, setIsMissedTradeModalOpen] = useState(false);
    const [deepReflection, setDeepReflection] = useState(false);

    // DhanHQ Auto-Fill State
    const [isPullingTrades, setIsPullingTrades] = useState(false);
    const [pulledTrades, setPulledTrades] = useState<any[]>([]);
    const [showTradePickerModal, setShowTradePickerModal] = useState(false);
    const [pullError, setPullError] = useState<string | null>(null);

    const { isCircuitBreakerActive, incrementTradeCount, updateFees, addTilt } = useCosmicGovernorStore();

    // Block entry if circuit breaker is active (safety fallback)
    useEffect(() => {
        if (isCircuitBreakerActive) {
            onClose();
        }
    }, [isCircuitBreakerActive, onClose]);

    const {
        step, nextStep, prevStep,
        formData, strategies, selectedStrategy, checkedRules, totalCapital, riskData, compressingType, previews, newMistake,
        directGrossPnL, directNetPnL,
        setNewMistake, setTotalCapital, updateField, toggleMistake, toggleSetupTag, toggleCorrelatedAsset, toggleMacroEvent, handleAddMistake, handleRuleToggle, handleFileChange, handleSubmit,
        htfRef, entryRef, exitRef, handleGrossPnLChange, handleNetPnLChange,
        isAutoCalcEnabled, setIsAutoCalcEnabled, goToStep,
        strictMode, setStrictMode,
        enableAdvancedScaling, setEnableAdvancedScaling,
        clearDraft
    } = useTradeForm(true, () => { }, onClose, tradeToEdit);

    const strategyOptions = useMemo(() => {
        const list = strategies.map(s => ({
            value: s.name,
            label: s.name,
            subtext: s.rules && s.rules.length > 0 ? `${s.rules.length} rules defined` : undefined
        }));
        return [...list, { value: 'Other', label: 'Other' }];
    }, [strategies]);

    const outcomeOptions = useMemo(() => {
        return OUTCOME_SUMMARY.map(outcome => {
            let color = 'bg-slate-500';
            if (outcome === 'Full Win') color = 'bg-emerald-500 border border-emerald-400/30';
            else if (outcome === 'Partial Success') color = 'bg-teal-500 border border-teal-400/30';
            else if (outcome === 'Breakeven') color = 'bg-slate-400 border border-slate-300/30';
            else if (outcome === 'Partial Loss') color = 'bg-amber-500 border border-amber-400/30';
            else if (outcome === 'Full Loss') color = 'bg-rose-500 border border-rose-400/30';
            else if (outcome === 'Stopped Out') color = 'bg-orange-500 border border-orange-400/30';

            return {
                value: outcome,
                label: outcome,
                color
            };
        });
    }, []);

    const [hoveredSlot, setHoveredSlot] = useState<'HTF' | 'Entry' | 'Exit' | null>(null);
    const [activeScreenshotTab, setActiveScreenshotTab] = useState<'HTF' | 'Entry' | 'Exit'>('HTF');

    const handleRemoveFile = React.useCallback((type: 'HTF' | 'Entry' | 'Exit') => {
        updateField(`screenshot${type}` as keyof Trade, null);
    }, [updateField]);

    useEffect(() => {
        const handleGlobalPaste = (e: any) => {
            const item = e.clipboardData?.items[0];
            if (item?.type.includes('image')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    const targetType = hoveredSlot || activeScreenshotTab;
                    if (targetType) {
                        handleFileChange(targetType, { target: { files: [file] } } as any);
                    }
                }
            }
        };

        window.addEventListener('paste', handleGlobalPaste);
        return () => {
            window.removeEventListener('paste', handleGlobalPaste);
        };
    }, [handleFileChange, hoveredSlot, activeScreenshotTab]);

    const isImportedReviewTrade = Boolean(
        formData.isImported || formData.broker === 'dhan' || formData.source === 'dhan' || formData.reviewStatus
    );
    const hasReviewNotes = Boolean(formData.notes?.trim() || formData.ahaMoment?.trim());
    const hasReviewScreenshots = Boolean(
        formData.screenshot ||
        formData.screenshotHTF ||
        formData.screenshotEntry ||
        formData.screenshotExit ||
        formData.screenshots?.length
    );
    const hasReviewLesson = Boolean(formData.coreLesson?.trim());
    const reviewStatusPreview = useMemo(
        () => resolveTradeReviewStatus(formData as Trade),
        [formData]
    );
    const reviewMeta = useMemo(
        () => getBrokerReviewStatusMeta(reviewStatusPreview),
        [reviewStatusPreview]
    );
    const reviewChecklist = useMemo(
        () => [
            { key: 'annotation', label: 'Annotation', done: hasReviewNotes },
            { key: 'screenshots', label: 'Screenshots', done: hasReviewScreenshots },
            { key: 'lesson', label: 'Core Lesson', done: hasReviewLesson },
        ],
        [hasReviewLesson, hasReviewNotes, hasReviewScreenshots]
    );

    // Memoize handlers for stability
    const memoizedUpdateField = React.useCallback(updateField, [updateField]);
    const memoizedToggleMistake = React.useCallback(toggleMistake, [toggleMistake]);
    const memoizedHandleRuleToggle = React.useCallback(handleRuleToggle, [handleRuleToggle]);
    const memoizedHandleGrossPnLChange = React.useCallback(handleGrossPnLChange, [handleGrossPnLChange]);
    const memoizedHandleNetPnLChange = React.useCallback(handleNetPnLChange, [handleNetPnLChange]);

    const reviewCompletedCount = reviewChecklist.filter((item) => item.done).length;
    const lastAutoFocusedTradeKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!tradeToEdit || !isImportedReviewTrade) return;

        const tradeKey = tradeToEdit.id
            ? `trade:${tradeToEdit.id}`
            : `draft:${tradeToEdit.ticker}:${tradeToEdit.date}:${tradeToEdit.reviewStatus || 'pending'}`;

        if (lastAutoFocusedTradeKeyRef.current === tradeKey) return;

        lastAutoFocusedTradeKeyRef.current = tradeKey;
        goToStep(reviewMeta.recommendedStep);
    }, [goToStep, isImportedReviewTrade, reviewMeta.recommendedStep, tradeToEdit]);

    // Pull today's DhanHQ/OpenAlgo trade executions and pre-fill the form
    const handlePullTodaysTrades = async () => {
        setIsPullingTrades(true);
        setPullError(null);
        try {
            const today = getISTDateString();
            const isDhanConfigured = dhanBrokerService.isConfigured();
            let trades: any[] = [];
            let pulledFromOpenAlgo = false;

            // 1. Try to fetch from OpenAlgo tradebook first (if available and contains trades)
            try {
                const oaResp = await fetch('/api/python-nse/api/openalgo/tradebook');
                if (oaResp.ok) {
                    const oaData = await oaResp.json();
                    if (oaData.status === 'success' && Array.isArray(oaData.data) && oaData.data.length > 0) {
                        const openAlgoTrades = oaData.data;
                        // Prefer OpenAlgo trades if Dhan is not configured, or if we have automated/sandbox trades
                        if (!isDhanConfigured || openAlgoTrades.some((t: any) => t.strategy === 'FNO_SectorRotation' || t.strategy.includes('Autopilot') || t.strategy.includes('UI'))) {
                            trades = openAlgoTrades.map((t: any) => ({
                                tradingSymbol: t.symbol,
                                customSymbol: t.symbol,
                                transactionType: t.action.toUpperCase(),
                                tradedQuantity: t.quantity,
                                tradedPrice: t.average_price || t.price || 0,
                                exchangeSegment: t.exchange || 'NFO',
                                productType: t.product || 'MIS',
                                exchangeTime: t.timestamp,
                                drvOptionType: t.symbol.endsWith('CE') ? 'CE' : t.symbol.endsWith('PE') ? 'PE' : undefined
                            }));
                            pulledFromOpenAlgo = true;
                        }
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch trades from OpenAlgo Sandbox:', err);
            }

            // 2. Fallback to DhanHQ if we didn't pull from OpenAlgo and Dhan is configured
            if (!pulledFromOpenAlgo) {
                if (isDhanConfigured) {
                    trades = await dhanBrokerService.fetchTrades();
                } else {
                    setPullError('Neither Dhan credentials nor OpenAlgo Sandbox trades could be retrieved.');
                    setIsPullingTrades(false);
                    return;
                }
            }

            if (!trades || trades.length === 0) {
                setPullError(pulledFromOpenAlgo 
                    ? 'No trades found for today from OpenAlgo Sandbox.' 
                    : 'No trades found for today from DhanHQ. Markets may be closed or no trades were executed today.'
                );
                setIsPullingTrades(false);
                return;
            }

            // Group fills by symbol to show meaningful entries for the picker
            const grouped = trades.reduce((acc: Record<string, any[]>, t: any) => {
                const key = t.customSymbol || t.tradingSymbol || 'UNKNOWN';
                if (!acc[key]) acc[key] = [];
                acc[key].push(t);
                return acc;
            }, {});

            const summary = Object.entries(grouped).map(([symbol, fills]) => {
                const buyFills = fills.filter((f: any) => f.transactionType === 'BUY');
                const sellFills = fills.filter((f: any) => f.transactionType === 'SELL');
                const totalBuyQty = buyFills.reduce((s: number, f: any) => s + (f.tradedQuantity || 0), 0);
                const totalSellQty = sellFills.reduce((s: number, f: any) => s + (f.tradedQuantity || 0), 0);
                const avgBuyPrice = totalBuyQty > 0 ? buyFills.reduce((s: number, f: any) => s + (f.tradedPrice || 0) * (f.tradedQuantity || 0), 0) / totalBuyQty : 0;
                const avgSellPrice = totalSellQty > 0 ? sellFills.reduce((s: number, f: any) => s + (f.tradedPrice || 0) * (f.tradedQuantity || 0), 0) / totalSellQty : 0;
                const pnl = avgSellPrice > 0 && avgBuyPrice > 0 ? (avgSellPrice - avgBuyPrice) * Math.min(totalBuyQty, totalSellQty) : undefined;
                const segment = (fills[0]?.exchangeSegment || '');
                const productType = (fills[0]?.productType || '');
                const assetClass = segment.includes('FNO') ? (fills[0]?.drvOptionType ? 'Options' : 'Futures') : segment.includes('CDS') ? 'Forex' : 'Equity';
                const direction = totalBuyQty >= totalSellQty ? 'Long' : 'Short';
                const firstTime = fills.sort((a: any, b: any) => new Date(a.exchangeTime).getTime() - new Date(b.exchangeTime).getTime())[0]?.exchangeTime;
                return { symbol, totalBuyQty, totalSellQty, avgBuyPrice, avgSellPrice, pnl, assetClass, direction, productType, firstTime, fills };
            });

            setPulledTrades(summary);
            setShowTradePickerModal(true);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setPullError(message || 'Failed to fetch trades. Please check connection and settings.');
        } finally {
            setIsPullingTrades(false);
        }
    };

    // Pre-fill form from a selected DhanHQ trade summary
    const handleSelectPulledTrade = (tradeData: any) => {
        const today = getISTDateString();
        const entryTime = tradeData.firstTime
            ? new Date(tradeData.firstTime).toTimeString().slice(0, 5)
            : '';

        updateField('ticker', tradeData.symbol);
        updateField('date', today);
        updateField('entryTime', entryTime);
        updateField('direction', tradeData.direction);
        updateField('assetClass', tradeData.assetClass);
        updateField('quantity', tradeData.totalBuyQty || tradeData.totalSellQty);
        if (tradeData.avgBuyPrice > 0) updateField('entryPrice', Math.round(tradeData.avgBuyPrice * 100) / 100);
        if (tradeData.avgSellPrice > 0) updateField('exitPrice', Math.round(tradeData.avgSellPrice * 100) / 100);
        if (tradeData.productType === 'INTRADAY') updateField('brokerProfile', 'Intraday Equity');
        else if (tradeData.productType === 'CNC') updateField('brokerProfile', 'Delivery Equity');
        if (tradeData.pnl !== undefined) {
            const grossStr = String(Math.round(tradeData.pnl * 100) / 100);
            handleGrossPnLChange(grossStr);
        }
        setShowTradePickerModal(false);
    };

    const handlePaste = async (type: 'HTF' | 'Entry' | 'Exit', e: React.ClipboardEvent) => {
        const item = e.clipboardData.items[0];
        if (item?.type.includes('image')) {
            const file = item.getAsFile();
            if (file) {
                handleFileChange(type, { target: { files: [file] } } as any);
            }
        }
    };


    const variants = {
        enter: (direction: number) => ({ x: direction > 0 ? 20 : -20, opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (direction: number) => ({ x: direction < 0 ? 20 : -20, opacity: 0 }),
    };

    return (
        <>
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="h-full flex flex-col pt-2 pb-6 relative overflow-hidden"
            >
                {/* Compact Header */}
                <div className="flex justify-between items-center mb-3 pl-3 pr-3 border-b border-slate-800/50 pb-2.5">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="p-2 bg-slate-900 border border-slate-700/50 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all shadow-sm"
                        >
                            <ArrowLeft size={16} />
                        </button>
                        <div>
                            <h2 className="text-[18px] font-bold text-white tracking-tight flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <Crosshair className="text-indigo-400" size={18} />
                                    <span>Execution Desk</span>
                                </div>

                                {formData.ticker && (
                                    <div className="flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 rounded-xl">
                                        <span className="text-sm font-black text-indigo-200 tracking-wider uppercase">{formData.ticker}</span>
                                        <button
                                            onClick={() => openTradingView(formData.ticker as string)}
                                            className="p-1 hover:bg-indigo-400/20 rounded-md transition-all group"
                                            title="Open in TradingView"
                                        >
                                            <ExternalLink size={12} className="text-indigo-400 group-hover:text-white" />
                                        </button>
                                    </div>
                                )}

                                {formData.isImported && (
                                    <span className="text-[9px] px-2 py-0.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 flex items-center gap-1 uppercase tracking-wider shadow-sm">
                                        <Globe size={10} /> Imported
                                    </span>
                                )}
                            </h2>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Pull Today's DhanHQ Trades Button */}
                        <button
                            onClick={handlePullTodaysTrades}
                            disabled={isPullingTrades}
                            className="px-3 py-1.5 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 hover:from-indigo-500/20 hover:to-violet-500/20 text-indigo-400 rounded-full font-bold border border-indigo-500/20 flex items-center gap-2 transition-all shadow-sm text-[11px] disabled:opacity-50"
                            title="Pull today's executed trades from DhanHQ to auto-fill this form"
                        >
                            {isPullingTrades ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            {isPullingTrades ? 'Fetching...' : 'Pull'}
                        </button>

                        {/* Pre-Market Routine Button */}
                        <button
                            onClick={() => setIsPreMarketOpen(true)}
                            className="px-3 py-1.5 bg-gradient-to-r from-amber-500/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20 text-amber-500 rounded-full font-bold border border-amber-500/20 flex items-center gap-2 transition-all shadow-sm text-[11px]"
                        >
                            <Sun size={14} /> Pre-Market
                        </button>

                        {/* Deep Reflection Toggle */}
                        <button
                            onClick={() => setDeepReflection(prev => !prev)}
                            className={`px-3 py-1.5 rounded-full font-bold border flex items-center gap-2 transition-all text-[11px] ${deepReflection
                                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.1)]'
                                : 'bg-slate-900 border-slate-700/50 text-slate-400'
                                }`}
                        >
                            <Brain size={14} />
                            {deepReflection ? 'Deep Mode' : 'Deep Reflection'}
                        </button>

                        {/* Reset / Clear Draft Button */}
                        {!tradeToEdit && localStorage.getItem('execution_desk_draft') && (
                            <button
                                onClick={clearDraft}
                                className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-450 rounded-full font-bold border border-rose-500/20 flex items-center gap-2 transition-all shadow-sm text-[11px]"
                                title="Clear current draft progress and start fresh"
                            >
                                <X size={14} /> Clear Form
                            </button>
                        )}

                        {/* Push to Mirror Button */}
                        {onPushToMirror && (
                            <button
                                onClick={() => onPushToMirror({
                                    title: formData.ticker ? `${formData.ticker} — ${formData.date || new Date().toISOString().split('T')[0]}` : 'Trade Reflection',
                                    coreLesson: formData.coreLesson || '',
                                    emotionalContext: [formData.moodEntry, formData.moodExit, formData.physicalState, formData.focusState].filter(Boolean).join(' · ') || ''
                                })}
                                className="px-3 py-1.5 bg-gradient-to-r from-rose-500/10 to-pink-500/10 hover:from-rose-500/20 hover:to-pink-500/20 text-rose-400 rounded-full font-bold border border-rose-500/20 flex items-center gap-2 transition-all shadow-sm text-[11px]"
                                title="Push this trade's core lesson & emotional context to Mirror of Truth"
                            >
                                <ShieldAlert size={14} /> Push to Mirror
                            </button>
                        )}

                        {/* Missed Trade Button */}
                        <button
                            onClick={() => setIsMissedTradeModalOpen(true)}
                            className="px-3 py-1.5 bg-slate-900 border border-slate-700/50 hover:bg-slate-800 hover:text-white text-slate-400 rounded-full font-bold flex items-center gap-2 transition-all shadow-sm text-[11px]"
                        >
                            <AlertCircle size={14} /> Log Missed
                        </button>
                    </div>
                </div>

                {isImportedReviewTrade && (
                    <div className="mx-4 mb-4 rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-500/10 via-slate-950 to-emerald-500/10 p-4 shadow-lg">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-300">Broker Review Lane</p>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-bold text-indigo-200">
                                        {reviewMeta.label}
                                    </span>
                                    <span className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs font-bold text-slate-300">
                                        {reviewCompletedCount}/3 complete
                                    </span>
                                </div>
                                <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-300">
                                    {reviewMeta.description}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => goToStep(reviewMeta.recommendedStep)}
                                    className="rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-indigo-500"
                                >
                                    Open Step {reviewMeta.recommendedStep}
                                </button>
                                {reviewStatusPreview === 'ANNOTATED' && (
                                    <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-300">
                                        Ready to save as reviewed
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {reviewChecklist.map((item) => (
                                <span
                                    key={item.key}
                                    className={`rounded-full border px-3 py-1 text-[11px] font-bold ${item.done
                                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                        : 'border-slate-700 bg-slate-900/70 text-slate-400'
                                        }`}
                                >
                                    {item.done ? 'Done' : 'Pending'}: {item.label}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Full-width Step Container */}
                <div className="flex-1 flex flex-col mx-4 bg-slate-900/40 border border-slate-800/60 rounded-2xl shadow-xl overflow-hidden relative">

                    {/* Progress Bar Header */}
                    <div className="flex px-6 py-4 border-b border-slate-800/60 bg-slate-950/20 gap-3 items-center">
                        {[
                            { num: 1, title: 'Context & Edge' },
                            { num: 2, title: 'Risk & Execution' },
                            { num: 3, title: 'Psychology' },
                            { num: 4, title: 'Evidence' },
                            { num: 5, title: 'Mastery' }
                        ].map(s => (
                            <div key={s.num} className="flex-1 flex flex-col gap-1.5">
                                <div className={`h-1.5 rounded-full w-full transition-all duration-500 ${step >= s.num ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-slate-800/50'}`} />
                                <div className="flex justify-between items-center">
                                    <span className={`text-[10px] font-bold uppercase tracking-widest ${step >= s.num ? 'text-indigo-400' : 'text-slate-500'}`}>0{s.num}</span>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= s.num ? 'text-slate-300' : 'text-slate-500'}`}>{s.title}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex-1 overflow-x-hidden overflow-y-auto relative p-6 md:p-8 custom-scrollbar">
                        <AnimatePresence mode="wait" custom={step}>

                            {/* STEP 1: CONTEXT & EDGE */}
                            {step === 1 && (
                                <motion.div key="step1" variants={variants} custom={1} initial="enter" animate="center" exit="exit" className="flex flex-col gap-6 max-w-6xl mx-auto w-full">

                                    {/* Row 1: Core Trade Details (Simplified Grid) */}
                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-slate-950/40 p-5 rounded-xl border border-slate-800/40">
                                        <div className="md:col-span-3">
                                            <label className="text-[10px] text-slate-500 uppercase font-bold mb-2 block tracking-wider">Ticker Symbol</label>
                                            <div className="relative group/ticker">
                                                <input
                                                    type="text"
                                                    value={formData.ticker || ''}
                                                    onChange={e => updateField('ticker', e.target.value.toUpperCase())}
                                                    className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500 outline-none font-bold tracking-widest text-lg uppercase shadow-inner transition-colors pr-12"
                                                    placeholder="SYMBOL"
                                                    autoFocus
                                                />
                                                {formData.ticker && (
                                                    <button
                                                        onClick={() => openTradingView(formData.ticker as string)}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-slate-800 text-slate-500 hover:text-indigo-400 rounded-md transition-all"
                                                        title="Open in TradingView"
                                                    >
                                                        <ExternalLink size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="md:col-span-3">
                                            <label className="text-[10px] text-slate-500 uppercase font-bold mb-2 block tracking-wider">Direction</label>
                                            <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700/50 shadow-inner h-[46px]">
                                                <button onClick={() => updateField('direction', 'Long')} className={`flex-1 rounded-md text-sm font-bold tracking-widest transition-all ${formData.direction === 'Long' ? 'bg-emerald-600 shadow text-white' : 'text-slate-400 hover:text-slate-200'}`}>LONG</button>
                                                <button onClick={() => updateField('direction', 'Short')} className={`flex-1 rounded-md text-sm font-bold tracking-widest transition-all ${formData.direction === 'Short' ? 'bg-rose-600 shadow text-white' : 'text-slate-400 hover:text-slate-200'}`}>SHORT</button>
                                            </div>
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="text-[10px] text-slate-500 uppercase font-bold mb-2 block tracking-wider">Quantity</label>
                                            <input
                                                type="number"
                                                value={formData.quantity || ''}
                                                onChange={e => updateField('quantity', parseFloat(e.target.value))}
                                                className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500 outline-none font-mono font-bold text-lg shadow-inner transition-colors"
                                                placeholder="0"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="text-[10px] text-slate-500 uppercase font-bold mb-2 block tracking-wider">Date</label>
                                            <input type="date" value={formData.date || ''} onChange={e => updateField('date', e.target.value)} className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 outline-none font-mono text-sm shadow-inner transition-colors h-[46px]" />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="text-[10px] text-slate-500 uppercase font-bold mb-2 block tracking-wider flex items-center gap-1.5"><Clock size={12} /> Time</label>
                                            <input type="time" value={formData.entryTime || ''} onChange={e => updateField('entryTime', e.target.value)} className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 outline-none font-mono text-sm shadow-inner transition-colors h-[46px]" />
                                        </div>

                                        {/* Simple Mode Secondary Row */}
                                        {!deepReflection && (
                                            <div className="md:col-span-12 pt-4 border-t border-slate-800/40">
                                                <div className="flex flex-col gap-2">
                                                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Asset & Product</span>
                                                    <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                                                        {ASSET_CLASSES.slice(0, 3).map(ac => (
                                                            <button
                                                                key={ac}
                                                                onClick={() => updateField('assetClass', ac)}
                                                                className={`py-1.5 px-4 rounded-md text-[10px] font-bold whitespace-nowrap transition-all border ${formData.assetClass === ac ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-sm' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                                            >
                                                                {ac}
                                                            </button>
                                                        ))}
                                                        <div className="w-px h-6 bg-slate-800 mx-1 self-center" />
                                                        {PRODUCT_TYPES.map(pt => (
                                                            <button
                                                                key={pt}
                                                                onClick={() => updateField('productType', pt)}
                                                                className={`py-1.5 px-4 rounded-md text-[10px] font-bold whitespace-nowrap transition-all border ${formData.productType === pt ? 'bg-amber-600/20 border-amber-500 text-amber-300 shadow-sm' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                                            >
                                                                {pt}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Deep Mode Category Grid */}
                                        {deepReflection && (
                                            <div className="md:col-span-12 pt-2 border-t border-slate-800/50 mt-1 flex flex-col gap-4">
                                                <div className="flex flex-col gap-2">
                                                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Asset Class</span>
                                                    <div className="flex flex-wrap gap-2">
                                                        {ASSET_CLASSES.map(ac => (
                                                            <button
                                                                key={ac}
                                                                onClick={() => updateField('assetClass', ac)}
                                                                className={`py-1.5 px-4 rounded-md text-xs font-bold transition-all border ${formData.assetClass === ac ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-sm' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                                            >
                                                                {ac}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-2">
                                                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Product Type (MIS/CNC/MTF)</span>
                                                    <div className="flex flex-wrap gap-2">
                                                        {PRODUCT_TYPES.map(pt => (
                                                            <button
                                                                key={pt}
                                                                onClick={() => updateField('productType', pt)}
                                                                className={`py-1.5 px-4 rounded-md text-xs font-bold transition-all border ${formData.productType === pt ? 'bg-amber-600/20 border-amber-500 text-amber-300 shadow-sm' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                                            >
                                                                {pt === 'INTRADAY' ? 'MIS / Intraday' : pt}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {!deepReflection ? (
                                        /* Step 1 Simple Mode Layout */
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="flex flex-col gap-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="flex flex-col gap-2">
                                                        <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Strategy</label>
                                                        <CustomSelect
                                                            value={formData.setup || ''}
                                                            onChange={val => updateField('setup', val)}
                                                            options={strategyOptions}
                                                            placeholder="Select Strategy"
                                                            showSearch={true}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-2">
                                                        <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Outcome Summary</label>
                                                        <CustomSelect
                                                            value={formData.tradeOutcome || 'Full Win'}
                                                            onChange={val => updateField('tradeOutcome', val)}
                                                            options={outcomeOptions}
                                                            placeholder="Select Outcome"
                                                        />
                                                    </div>
                                                </div>

                                                <RulesFollowedSelector
                                                    selectedStrategy={selectedStrategy}
                                                    formData={formData}
                                                    updateField={updateField}
                                                    handleRuleToggle={handleRuleToggle}
                                                />

                                                <div className="flex flex-col gap-2">
                                                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Trade Analysis</label>
                                                    <textarea
                                                        value={formData.marketThesis || ''}
                                                        onChange={(e) => updateField('marketThesis', e.target.value)}
                                                        placeholder="Why did you take this trade? What was your analysis?"
                                                        className="w-full bg-slate-900 border border-slate-700/50 rounded-lg p-3 text-xs text-slate-300 focus:border-indigo-500 outline-none h-28 resize-none transition-all placeholder:text-slate-600 shadow-inner leading-relaxed"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-4">
                                                <TradeScreenshotsUpload
                                                    previews={previews}
                                                    compressingType={compressingType}
                                                    htfRef={htfRef}
                                                    entryRef={entryRef}
                                                    exitRef={exitRef}
                                                    handleFileChange={handleFileChange}
                                                    onHoverSlot={setHoveredSlot}
                                                    onRemoveFile={handleRemoveFile}
                                                    activeTab={activeScreenshotTab}
                                                    setActiveTab={setActiveScreenshotTab}
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        /* Step 1 Original/Deep Mode Layout */
                                        <>
                                            {/* Middle Section: Rules & Strategy */}
                                            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                                                <div className="md:col-span-3 bg-slate-950/40 p-5 rounded-xl border border-slate-800/40">
                                                    <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-3">
                                                        <label className="text-xs text-indigo-400 uppercase font-bold flex items-center gap-2 tracking-wider">
                                                            <BookOpen size={14} /> Primary Playbook
                                                        </label>
                                                        {!deepReflection && (
                                                            <span className="text-[10px] text-slate-500 italic">Select your core execution model</span>
                                                        )}
                                                    </div>
                                                    <StrategyGrid
                                                        strategies={strategies}
                                                        selectedSetup={formData.setup}
                                                        onSelect={(name: string) => memoizedUpdateField('setup', name)}
                                                        deepReflection={deepReflection}
                                                    />
                                                </div>

                                                <div className="md:col-span-2 bg-slate-950/40 p-5 rounded-xl border border-slate-800/40 flex flex-col relative overflow-hidden">
                                                    <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800/60">
                                                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                                            <ListChecks size={14} className="text-indigo-400" /> Checklist
                                                        </h4>
                                                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${formData.complianceScore === 100 ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-400 bg-slate-800'}`}>
                                                            {formData.complianceScore}%
                                                        </span>
                                                    </div>

                                                    {!selectedStrategy ? (
                                                        <div className="flex-1 flex items-center justify-center text-slate-500 text-xs italic opacity-80 text-center">
                                                            Select a playbook to load criteria.
                                                        </div>
                                                    ) : (
                                                        <ChecklistGrid
                                                            rules={selectedStrategy.rules}
                                                            checkedRules={checkedRules}
                                                            onToggle={memoizedHandleRuleToggle}
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                            {/* Rules Followed Tag Cloud (Simple Mode Only) */}
                                            {!deepReflection && selectedStrategy && (
                                                <div className="bg-slate-950/40 p-5 rounded-xl border border-slate-800/40">
                                                    <div className="flex justify-between items-center mb-3">
                                                        <label className="text-xs text-indigo-400 uppercase font-bold flex items-center gap-2 tracking-wider">
                                                            <BadgeCheck size={14} /> Rules Followed
                                                        </label>
                                                        <span className="text-[10px] text-slate-500">Tagging based on {selectedStrategy.name} protocol</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {selectedStrategy.rules.map((rule, idx) => (
                                                            <button
                                                                key={idx}
                                                                onClick={() => handleRuleToggle(idx)}
                                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${checkedRules[idx] ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-sm' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500'}`}
                                                            >
                                                                {rule}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Market Thesis & Screenshots (Deep Mode Grid) */}
                                            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                                <div className="md:col-span-7 bg-slate-950/40 p-5 rounded-xl border border-slate-800/40 flex flex-col justify-between">
                                                    <div>
                                                        <label className="text-xs text-indigo-400 uppercase font-bold mb-3 flex items-center gap-2 tracking-wider">
                                                            <Brain size={14} className="text-indigo-400" /> Mercury Law: Market Thesis
                                                        </label>
                                                        <textarea
                                                            value={formData.marketThesis || ''}
                                                            onChange={(e) => updateField('marketThesis', e.target.value)}
                                                            placeholder="Why are you taking this trade? (Required: Intelligence Over Impulse)"
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-300 focus:border-indigo-500 outline-none h-32 resize-none transition-all placeholder:text-slate-600"
                                                        />
                                                    </div>
                                                    <p className="text-[10px] text-slate-500 mt-2 italic flex items-center gap-1.5">
                                                        <ShieldAlert size={10} className="text-amber-500" />
                                                        The Mercury Law: You must state your logical rationale before committing.
                                                        {(!formData.marketThesis || formData.marketThesis.trim().length < 10) && <span className="text-rose-400 ml-1">Min 10 characters required.</span>}
                                                    </p>
                                                </div>

                                                <div className="md:col-span-5 bg-slate-950/40 p-5 rounded-xl border border-slate-800/40">
                                                    <TradeScreenshotsUpload
                                                        previews={previews}
                                                        compressingType={compressingType}
                                                        htfRef={htfRef}
                                                        entryRef={entryRef}
                                                        exitRef={exitRef}
                                                        handleFileChange={handleFileChange}
                                                        onHoverSlot={setHoveredSlot}
                                                        onRemoveFile={handleRemoveFile}
                                                        activeTab={activeScreenshotTab}
                                                        setActiveTab={setActiveScreenshotTab}
                                                    />
                                                </div>
                                            </div>

                                            {/* Confluence Builder (Deep Mode Only) */}
                                            {deepReflection && (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-950/40 p-5 rounded-xl border border-slate-800/40">
                                                    <div>
                                                        <label className="text-xs text-indigo-400 uppercase font-bold mb-3 block tracking-wider flex items-center gap-1.5"><Target size={14} /> Confluence Builder</label>

                                                        {/* Technical Indicators */}
                                                        <div className="mb-3">
                                                            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest block mb-1.5">Technical</span>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {['EMA Alignment', 'RSI Divergence', 'MACD Cross', 'VWAP Hold', 'Bollinger Squeeze', 'Fibonacci Level'].map(tag => (
                                                                    <button
                                                                        key={tag}
                                                                        onClick={() => toggleSetupTag(tag)}
                                                                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all ${formData.setupTags?.includes(tag) ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                                                    >
                                                                        {tag}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* Price Action */}
                                                        <div className="mb-3">
                                                            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest block mb-1.5">Price Action</span>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {SETUP_TAGS.map(tag => (
                                                                    <button
                                                                        key={tag}
                                                                        onClick={() => toggleSetupTag(tag)}
                                                                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all ${formData.setupTags?.includes(tag) ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                                                    >
                                                                        {tag}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* Market Structure */}
                                                        <div>
                                                            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest block mb-1.5">Structure</span>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {['Higher High', 'Lower Low', 'ChoCH', 'BOS', 'Liquidity Sweep', 'Order Block', 'Fair Value Gap', 'Volume Surge'].map(tag => (
                                                                    <button
                                                                        key={tag}
                                                                        onClick={() => toggleSetupTag(tag)}
                                                                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all ${formData.setupTags?.includes(tag) ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                                                    >
                                                                        {tag}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* Pro: Correlated Assets & Macro */}
                                                        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-800/40 pt-4">
                                                            <div>
                                                                <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest block mb-1.5 flex items-center gap-1"><Layers size={10} /> Correlated Assets</span>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {['VIX Spiked', 'Sector RS', 'Nifty/BNF Divergence', 'Yields Up', 'DXY Strong'].map(tag => (
                                                                        <button
                                                                            key={tag}
                                                                            onClick={() => toggleCorrelatedAsset(tag)}
                                                                            className={`px-2 py-1 rounded text-[9px] font-bold border transition-all ${formData.correlatedAssets?.includes(tag) ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' : 'bg-slate-900 border-slate-700/50 text-slate-500 hover:border-slate-500'}`}
                                                                        >
                                                                            {tag}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest block mb-1.5 flex items-center gap-1"><Globe size={10} /> Macro Events</span>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {['Fed Policy', 'RBI Policy', 'Inflation Data', 'Earnings Release', 'Geopolitics'].map(tag => (
                                                                        <button
                                                                            key={tag}
                                                                            onClick={() => toggleMacroEvent(tag)}
                                                                            className={`px-2 py-1 rounded text-[9px] font-bold border transition-all ${formData.macroEvents?.includes(tag) ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-slate-900 border-slate-700/50 text-slate-500 hover:border-slate-500'}`}
                                                                        >
                                                                            {tag}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Pro: Time of Day Setup */}
                                                        <div className="mt-4 border-t border-slate-800/40 pt-4">
                                                            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest block mb-1.5 flex items-center gap-1"><Clock size={10} /> Time of Day Setup</span>
                                                            <div className="flex gap-2">
                                                                {['Opening Drive', 'Mid-Day Chop', 'Power Hour', 'After Hours'].map(time => (
                                                                    <button
                                                                        key={time}
                                                                        onClick={() => updateField('timeOfDay', time)}
                                                                        className={`flex-1 py-1.5 rounded text-[10px] font-bold border transition-all ${formData.timeOfDay === time ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-slate-900 border-slate-700/50 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
                                                                    >
                                                                        {time}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* Convexity Score Badge */}
                                                        <div className="mt-5 flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1"><Compass size={12} className="text-indigo-400" /> Setup Convexity Score</span>
                                                                <span className="text-[10px] text-slate-500 italic mt-0.5">Weighted confluence &amp; edge</span>
                                                            </div>
                                                            <div className={`text-xl font-black font-mono px-3 py-1 rounded-md border ${(formData.setupConvexityScore || 0) >= 70 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : (formData.setupConvexityScore || 0) >= 40 ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
                                                                {formData.setupConvexityScore || 0}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500 uppercase font-bold mb-3 flex items-center gap-1.5 tracking-wider"><Award size={14} /> Execution Grade</label>
                                                        <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700/50 shadow-inner">
                                                            {GRADES.map(g => (
                                                                <button
                                                                    key={g}
                                                                    onClick={() => updateField('grade', g)}
                                                                    className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${formData.grade === g ? (g.includes('A') ? 'bg-emerald-600 text-white shadow-sm' : g === 'F' ? 'bg-rose-600 text-white shadow-sm' : 'bg-indigo-500 text-white shadow-sm') : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800 border border-transparent'}`}
                                                                >
                                                                    {g}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </motion.div>
                            )}


                            {/* STEP 2: RISK & SCALE (Flight Deck HUD) */}
                            {step === 2 && (
                                <motion.div key="step2" variants={variants} custom={1} initial="enter" animate="center" exit="exit" className="flex flex-col gap-6 max-w-5xl mx-auto w-full">

                                    {/* Risk Assessment HUD (Always Visible) */}
                                    <div className={`w-full rounded-xl border flex flex-col p-5 shadow-lg transition-all duration-300
                                        ${riskData.isViolation
                                            ? 'bg-rose-950/20 border-rose-500/30'
                                            : 'bg-slate-950/60 border-slate-800/80'}`}>

                                        <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/5">
                                            <h3 className="font-bold text-white uppercase tracking-wider flex items-center gap-2 text-sm">
                                                <ActivitySquare size={16} className={riskData.isViolation ? 'text-rose-500' : 'text-indigo-400'} />
                                                Risk Assessment HUD
                                            </h3>
                                            <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${riskData.isViolation ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'}`}>
                                                {riskData.isViolation ? <AlertTriangle size={12} /> : <Target size={12} />}
                                                {riskData.isViolation ? 'Violated' : 'Approved'}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                            {/* Capital */}
                                            <div className="bg-slate-900/80 p-3 rounded-lg border border-white/5 flex flex-col shadow-inner justify-between">
                                                <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Base Capital</label>
                                                <div className="flex items-center text-white">
                                                    <span className="text-slate-500 text-sm font-bold mr-1">₹</span>
                                                    <input type="number" value={totalCapital} onChange={(e) => setTotalCapital(e.target.value)} className="bg-transparent text-lg font-mono font-bold outline-none w-full tracking-tight" />
                                                </div>
                                            </div>

                                            {/* Amount Used */}
                                            <div className="bg-slate-900/80 p-3 rounded-lg border border-white/5 flex flex-col shadow-inner justify-between">
                                                <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Amount Used</label>
                                                <div className="flex items-center text-white">
                                                    <span className="text-slate-500 text-sm font-bold mr-1">₹</span>
                                                    <span className="text-lg font-mono font-bold tracking-tight text-indigo-300">
                                                        {formatCurrency((formData.entryPrice || 0) * (formData.quantity || 0)).replace('₹', '')}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* R-Multiple */}
                                            <div className="bg-slate-900/80 p-3 rounded-lg border border-white/5 flex flex-col shadow-inner justify-between relative group">
                                                <div className="flex justify-between items-center mb-1">
                                                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">R-Multiple</label>
                                                    <div className="relative">
                                                        <Info size={10} className="text-indigo-400 cursor-help" />
                                                        <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-slate-900 border border-slate-800 rounded shadow-xl text-[9px] text-slate-300 font-normal opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                                            R-Multiple measures your return relative to your initial risk.
                                                            <br /><br />
                                                            <span className="text-emerald-400 font-bold">2.0R</span> means you gained 2x what you risked.
                                                            <br />
                                                            <span className="text-rose-400 font-bold">-1.0R</span> means you lost your full planned risk.
                                                        </div>
                                                    </div>
                                                </div>
                                                <span className={`text-lg font-mono font-black ${riskData.rMultiple >= 2 ? 'text-emerald-400' : riskData.rMultiple > 0 ? 'text-indigo-400' : riskData.rMultiple < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                                                    {riskData.rMultiple.toFixed(2)}R
                                                </span>
                                            </div>

                                            {/* Risked */}
                                            <div className="bg-slate-900/80 p-3 rounded-lg border border-white/5 flex flex-col shadow-inner justify-between relative overflow-hidden">
                                                {riskData.isViolation && <div className="absolute top-0 left-0 w-full h-0.5 bg-rose-500" />}
                                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">% Risked (₹{formatCurrency(riskData.riskAmount).replace('₹', '')})</span>
                                                <span className={`text-lg font-mono font-black ${riskData.isViolation ? 'text-rose-400' : 'text-emerald-400'}`}>
                                                    {riskData.percentRisk.toFixed(2)}%
                                                </span>
                                            </div>

                                            {/* Enforce Rules */}
                                            <div className="bg-slate-900/80 p-3 rounded-lg border border-white/5 flex flex-col shadow-inner justify-between">
                                                <label className="flex items-center gap-2 cursor-pointer group" title="Strict Mode: Enforces Mercury Law (Market Thesis) and Risk Thresholds">
                                                    <div className={`w-8 h-4 rounded-full transition-colors relative ${strictMode ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                                                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${strictMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                                    </div>
                                                    <input type="checkbox" className="hidden" checked={strictMode} onChange={(e) => setStrictMode(e.target.checked)} />
                                                    <span className="text-[9px] uppercase font-bold text-slate-400 group-hover:text-indigo-400 transition-colors">Strict Mode</span>
                                                </label>
                                                <p className="text-[8px] text-slate-500 mt-1 italic leading-tight">If OFF, thesis & risk won't block save</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Trade Economics (Always Visible) */}
                                    <div className="bg-slate-950/60 p-5 rounded-xl border border-indigo-900/30 shadow-inner flex flex-col gap-4 transition-colors">
                                        <div className="flex justify-between items-center mb-1 border-b border-indigo-500/20 pb-2">
                                            <h4 className="text-xs text-indigo-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                                                <ActivitySquare size={14} /> Trade Economics
                                            </h4>
                                            <label className="flex items-center gap-2 cursor-pointer group" title="Enable to auto-calculate P&L and Fees from Entry/Exit prices">
                                                <span className="text-[10px] uppercase font-bold text-slate-400 group-hover:text-indigo-400 transition-colors">Auto-Calc P&amp;L</span>
                                                <div className={`w-8 h-4 rounded-full transition-colors relative ${isAutoCalcEnabled ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                                                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${isAutoCalcEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                                </div>
                                                <input type="checkbox" className="hidden" checked={isAutoCalcEnabled} onChange={(e) => setIsAutoCalcEnabled(e.target.checked)} />
                                            </label>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                            {/* GROSS P&L */}
                                            <div className="flex flex-col gap-1.5">
                                                <label className="text-[10px] text-emerald-500/80 uppercase font-bold tracking-wider flex items-center gap-1">
                                                    <TrendingUp size={10} /> Gross P&amp;L (₹)
                                                </label>
                                                <input
                                                    type="number"
                                                    value={directGrossPnL}
                                                    onChange={e => handleGrossPnLChange(e.target.value)}
                                                    className={`w-full bg-slate-900 border rounded-lg px-4 py-2.5 outline-none font-mono text-base placeholder:text-slate-600 shadow-inner transition-colors ${directGrossPnL && parseFloat(directGrossPnL) >= 0
                                                        ? 'border-emerald-800/50 text-emerald-400 focus:border-emerald-500'
                                                        : directGrossPnL && parseFloat(directGrossPnL) < 0
                                                            ? 'border-rose-800/50 text-rose-400 focus:border-rose-500'
                                                            : 'border-slate-700/50 text-slate-300 focus:border-indigo-500'
                                                        }`}
                                                    placeholder="Type to auto-fill Exit Price"
                                                />
                                            </div>

                                            {/* NET P&L */}
                                            <div className="flex flex-col gap-1.5">
                                                <label className="text-[10px] text-indigo-400 uppercase font-bold tracking-wider flex items-center gap-1">
                                                    <TrendingDown size={10} /> Net P&amp;L (₹)
                                                </label>
                                                <input
                                                    type="number"
                                                    value={directNetPnL}
                                                    onChange={e => handleNetPnLChange(e.target.value)}
                                                    className={`w-full bg-slate-900 border rounded-lg px-4 py-2.5 outline-none font-mono text-base placeholder:text-slate-600 shadow-inner transition-colors ${directNetPnL && parseFloat(directNetPnL) >= 0
                                                        ? 'border-emerald-800/50 text-indigo-400 focus:border-indigo-500'
                                                        : directNetPnL && parseFloat(directNetPnL) < 0
                                                            ? 'border-rose-800/50 text-rose-400 focus:border-rose-500'
                                                            : 'border-slate-700/50 text-slate-400 focus:border-indigo-500'
                                                        }`}
                                                    placeholder="Net after charges"
                                                />
                                            </div>

                                            {/* CHARGES & BROKERAGE */}
                                            <div className="flex flex-col gap-1.5">
                                                <div className="flex justify-between items-center">
                                                    <label className="text-[10px] text-rose-400 uppercase font-bold tracking-wider flex items-center gap-1">
                                                        ⚡ Charges / Fees (₹)
                                                    </label>
                                                    <div className="w-[120px]">
                                                        <select
                                                            value={formData.brokerProfile || 'Intraday Equity'}
                                                            onChange={e => updateField('brokerProfile', e.target.value)}
                                                            className="w-full bg-slate-900 border border-slate-700 rounded text-[9px] px-1 py-0.5 text-slate-400 outline-none"
                                                        >
                                                            <option value="Intraday Equity">Intraday Eq</option>
                                                            <option value="Delivery Equity">Delivery Eq</option>
                                                            <option value="MTF / Margin">MTF / Margin</option>
                                                            <option value="Futures">Futures</option>
                                                            <option value="Options">Options</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                <input
                                                    type="number"
                                                    value={formData.fees || ''}
                                                    onChange={e => updateField('fees', parseFloat(e.target.value) || 0)}
                                                    className="w-full bg-slate-900 border border-rose-900/40 rounded-lg px-4 py-2.5 text-rose-400 outline-none font-mono text-base placeholder:text-slate-600 focus:border-rose-500 shadow-inner"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Pricing, Quantity & Risk Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                        {/* Entry, Qty, SL (Always Visible) */}
                                        <div className={`${deepReflection ? 'md:col-span-7' : 'md:col-span-12'} grid grid-cols-1 sm:grid-cols-3 gap-4`}>
                                            <div className="bg-slate-950/40 p-5 rounded-xl border border-slate-800/40 shadow-inner flex flex-col gap-2 transition-colors">
                                                <label className="text-xs text-slate-400 uppercase font-bold tracking-wider">Target Entry Price</label>
                                                <input type="number" value={formData.entryPrice || ''} onChange={e => updateField('entryPrice', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-3 text-white outline-none font-mono text-base placeholder:text-slate-600 focus:border-indigo-500" placeholder="0.00" />
                                            </div>
                                            <div className="bg-slate-950/40 p-5 rounded-xl border border-indigo-900/20 shadow-inner flex flex-col gap-2 transition-colors">
                                                <label className="text-xs text-indigo-400 uppercase font-bold tracking-wider">Quantity</label>
                                                <input type="number" value={formData.quantity || ''} onChange={e => updateField('quantity', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-3 text-white outline-none font-mono text-base placeholder:text-slate-600 focus:border-indigo-500" placeholder="0" />
                                            </div>
                                            <div className="bg-slate-950/40 p-5 rounded-xl border border-rose-900/20 shadow-inner flex flex-col gap-2 transition-colors">
                                                <div className="flex justify-between items-center">
                                                    <label className="text-xs text-rose-400 uppercase font-bold tracking-wider">Hard SL</label>
                                                    <select
                                                        value={formData.trailingStopType || 'None'}
                                                        onChange={e => updateField('trailingStopType', e.target.value)}
                                                        className="bg-transparent border border-rose-900/40 rounded text-[9px] px-1 py-0.5 text-rose-400 outline-none"
                                                    >
                                                        <option className="bg-slate-900 text-white" value="None">No Trailing</option>
                                                        <option className="bg-slate-900 text-white" value="Manual">Manual Trail</option>
                                                        <option className="bg-slate-900 text-white" value="Auto (ATR)">ATR Trail</option>
                                                        <option className="bg-slate-900 text-white" value="Auto (Moving Average)">MA Trail</option>
                                                    </select>
                                                </div>
                                                <input type="number" value={formData.stopLoss || ''} onChange={e => updateField('stopLoss', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-3 text-white outline-none font-mono text-base placeholder:text-slate-600 focus:border-rose-500" placeholder="0.00" />
                                            </div>
                                        </div>

                                        {/* Advanced Scaling System (Deep Mode Only) */}
                                        {deepReflection && (
                                            <div className="md:col-span-5 bg-slate-950/40 p-5 rounded-xl border border-emerald-900/20 shadow-inner flex flex-col gap-2 transition-colors relative overflow-hidden">
                                                {!enableAdvancedScaling && (
                                                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center text-center p-4">
                                                        <span className="text-xs font-bold text-slate-400 mb-2">Advanced Scaling is Disabled</span>
                                                        <button
                                                            onClick={() => setEnableAdvancedScaling(true)}
                                                            className="px-4 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold rounded-lg hover:bg-emerald-500/20 transition-all"
                                                        >
                                                            Enable Multi-TP System
                                                        </button>
                                                    </div>
                                                )}
                                                <div className="flex justify-between items-center mb-2">
                                                    <label className="text-xs text-emerald-400 uppercase font-bold tracking-wider">Advanced Scaling System</label>
                                                    {enableAdvancedScaling && (
                                                        <button
                                                            onClick={() => setEnableAdvancedScaling(false)}
                                                            className="text-[9px] text-rose-400/60 hover:text-rose-400 font-bold uppercase"
                                                        >
                                                            Disable
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[9px] text-emerald-500/70 font-bold uppercase w-10">Targ. 1</span>
                                                        <input type="number" value={formData.takeProfit1 || ''} onChange={e => updateField('takeProfit1', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-emerald-900/30 rounded-md px-2 py-2 text-white outline-none font-mono text-sm focus:border-emerald-500 placeholder:text-slate-600" placeholder="0.00" />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[9px] text-emerald-500/70 font-bold uppercase w-10">Targ. 2</span>
                                                        <input type="number" value={formData.takeProfit2 || ''} onChange={e => updateField('takeProfit2', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-emerald-900/30 rounded-md px-2 py-2 text-white outline-none font-mono text-sm focus:border-emerald-500 placeholder:text-slate-600" placeholder="0.00" />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[9px] text-emerald-500/70 font-bold uppercase w-10">Targ. 3</span>
                                                        <input type="number" value={formData.takeProfit3 || ''} onChange={e => updateField('takeProfit3', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-emerald-900/30 rounded-md px-2 py-2 text-white outline-none font-mono text-sm focus:border-emerald-500 placeholder:text-slate-600" placeholder="0.00" />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Outcome & Evaluation Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-5 mt-2">
                                        {/* Final Exit Price (Always Visible) */}
                                        <div className={`${deepReflection ? 'md:col-span-6' : 'md:col-span-12'} bg-slate-950/40 p-5 rounded-xl border border-slate-800/40 shadow-inner flex flex-col gap-4`}>
                                            <div className="flex flex-col gap-2">
                                                <label className="text-xs text-amber-500/80 uppercase font-bold tracking-wider flex items-center gap-1"><Crosshair size={14} /> Final Exit Price</label>
                                                <input type="number" value={formData.exitPrice || ''} onChange={e => updateField('exitPrice', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-3 text-amber-400 outline-none font-mono text-lg font-bold placeholder:text-slate-600 focus:border-amber-500/50" placeholder="Final Exit Price" />
                                            </div>

                                            {/* MAE/MFE (Deep Mode Only) */}
                                            {deepReflection && (
                                                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/40">
                                                    <div className="flex flex-col gap-1">
                                                        <label className="text-[10px] text-rose-500/80 uppercase font-bold tracking-wider">MAE (Max Pain)</label>
                                                        <input type="number" value={formData.mae || ''} onChange={e => updateField('mae', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-rose-900/30 rounded-md px-3 py-2 text-rose-300 outline-none font-mono text-sm placeholder:text-slate-600 focus:border-rose-500/50" placeholder="0.00" />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <label className="text-[10px] text-emerald-500/80 uppercase font-bold tracking-wider">MFE (Max Gain)</label>
                                                        <input type="number" value={formData.mfe || ''} onChange={e => updateField('mfe', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-emerald-900/30 rounded-md px-3 py-2 text-emerald-300 outline-none font-mono text-sm placeholder:text-slate-600 focus:border-emerald-500/50" placeholder="0.00" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Heat of the Moment & Time in Trade (Deep Mode Only) */}
                                        {deepReflection && (
                                            <div className="md:col-span-6 bg-slate-950/40 p-5 rounded-xl border border-slate-800/40 shadow-inner flex flex-col gap-2 h-full justify-between">
                                                <div>
                                                    <label className="text-xs text-indigo-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5"><Activity size={14} /> Heat of the Moment</label>

                                                    <div className="space-y-2 mt-3">
                                                        <label className="flex items-center gap-3 cursor-pointer group p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all">
                                                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${formData.stopLossMoved ? 'bg-rose-500 border-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]' : 'bg-slate-950 border-slate-600 group-hover:border-rose-400'}`}>
                                                                {formData.stopLossMoved && <CheckSquare size={12} className="text-white" />}
                                                            </div>
                                                            <input type="checkbox" className="hidden" checked={formData.stopLossMoved || false} onChange={e => updateField('stopLossMoved', e.target.checked)} />
                                                            <div className="flex flex-col">
                                                                <span className={`text-xs font-bold transition-colors ${formData.stopLossMoved ? 'text-rose-400' : 'text-slate-300'}`}>Moved Stop Loss</span>
                                                                <span className="text-[9px] text-slate-500">I violated my initial risk box</span>
                                                            </div>
                                                        </label>

                                                        <label className="flex items-center gap-3 cursor-pointer group p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all">
                                                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${formData.scaledOut ? 'bg-emerald-500 border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-slate-950 border-slate-600 group-hover:border-emerald-400'}`}>
                                                                {formData.scaledOut && <CheckSquare size={12} className="text-white" />}
                                                            </div>
                                                            <input type="checkbox" className="hidden" checked={formData.scaledOut || false} onChange={e => updateField('scaledOut', e.target.checked)} />
                                                            <div className="flex flex-col">
                                                                <span className={`text-xs font-bold transition-colors ${formData.scaledOut ? 'text-emerald-400' : 'text-slate-300'}`}>Scaled Out (Partial Exits)</span>
                                                                <span className="text-[9px] text-slate-500">I secured profit into strength</span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>

                                                <div className="mt-4 relative">
                                                    <Clock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                                    <input type="text" value={formData.timeInTrade || ''} onChange={e => updateField('timeInTrade', e.target.value)} placeholder="Duration in trade (e.g. 2h 15m)" className="w-full bg-slate-900 border border-slate-700/50 rounded-lg pl-8 pr-3 py-2 text-xs text-white outline-none placeholder:text-slate-500 focus:border-indigo-500/50 transition-colors shadow-inner" />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}


                            {/* STEP 3: PSYCHOLOGICAL CAPITAL */}
                            {step === 3 && (
                                <motion.div key="step3" variants={variants} custom={1} initial="enter" animate="center" exit="exit" className="flex flex-col gap-6 max-w-5xl mx-auto w-full">

                                    {/* Simple Mode: TradeDiary Interaction Model */}
                                    {!deepReflection && (
                                        <div className="flex flex-col gap-6">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-950/40 p-6 rounded-xl border border-slate-800/40">
                                                <div className="flex flex-col gap-5">
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-3 block tracking-widest">Entry Confidence (1-10)</label>
                                                        <div className="flex items-center gap-4">
                                                            <input
                                                                type="range" min="1" max="10" step="1"
                                                                value={formData.convictionLevel || 5}
                                                                onChange={e => updateField('convictionLevel', parseInt(e.target.value))}
                                                                className="flex-1 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                                            />
                                                            <span className="text-xl font-black text-indigo-400 w-8 text-center font-mono">{formData.convictionLevel || 5}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-3 block tracking-widest">Satisfaction Rating (1-10)</label>
                                                        <div className="flex items-center gap-4">
                                                            <input
                                                                type="range" min="1" max="10" step="1"
                                                                value={formData.satisfactionRating || 5}
                                                                onChange={e => updateField('satisfactionRating', parseInt(e.target.value))}
                                                                className="flex-1 accent-emerald-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                                            />
                                                            <span className="text-xl font-black text-emerald-400 w-8 text-center font-mono">{formData.satisfactionRating || 5}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-4">
                                                    <MoodSelector
                                                        moods={MOODS_ENTRY}
                                                        selectedMood={formData.moodEntry}
                                                        onSelect={(label: string) => memoizedUpdateField('moodEntry', label)}
                                                        label="Emotional State During Trade"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="bg-slate-950/40 p-6 rounded-xl border border-slate-800/40">
                                                    <label className="text-xs text-rose-400 uppercase tracking-wider font-bold mb-4 block flex items-center gap-2"><Activity size={14} /> Common Mistakes</label>
                                                    <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                                                        {[
                                                            'Overtrading', 'Revenge Trading',
                                                            'Risked Too Much', 'Exited Too Early',
                                                            'Exited Too Late', 'FOMO Entry',
                                                            'Ignored Signals', 'No Clear Plan',
                                                            'Ignored Stop Loss', 'No Mistakes'
                                                        ].map(m => (
                                                            <label key={m} className="flex items-center gap-2.5 cursor-pointer group">
                                                                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${formData.mistakes?.includes(m) ? 'bg-rose-500 border-rose-500 shadow-sm' : 'bg-slate-900 border-slate-700 group-hover:border-slate-500'}`}>
                                                                    {formData.mistakes?.includes(m) && <CheckSquare size={12} className="text-white" />}
                                                                </div>
                                                                <input type="checkbox" className="hidden" checked={formData.mistakes?.includes(m) || false} onChange={() => toggleMistake(m)} />
                                                                <span className={`text-[11px] font-medium transition-colors ${formData.mistakes?.includes(m) ? 'text-slate-200' : 'text-slate-500 group-hover:text-slate-400'}`}>{m}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="bg-slate-950/40 p-6 rounded-xl border border-slate-800/40 flex flex-col h-full">
                                                    <label className="text-xs font-bold text-indigo-400 uppercase tracking-wider block mb-3 flex items-center gap-2"><Brain size={14} /> Core Lesson Learned</label>
                                                    <textarea
                                                        value={formData.coreLesson || ''}
                                                        onChange={(e) => updateField('coreLesson', e.target.value)}
                                                        placeholder="What is the single biggest takeaway from this execution?"
                                                        className="flex-1 w-full bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-sm text-white focus:border-indigo-500/50 outline-none resize-none min-h-[120px] custom-scrollbar shadow-inner transition-colors leading-relaxed"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Deep Mode: Institutional Metrics */}
                                    {deepReflection && (
                                        <div className="flex flex-col gap-6">
                                            {/* Physiological & Cognitive Layer */}
                                            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                                <div className="md:col-span-4 bg-slate-950/40 p-6 rounded-xl border border-slate-800/40 flex flex-col gap-6">
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-4 block tracking-widest">Entry Conviction Level</label>
                                                        <div className="flex items-center gap-4">
                                                            <input type="range" min="1" max="10" step="1" value={formData.convictionLevel || 5} onChange={e => updateField('convictionLevel', parseInt(e.target.value))} className="flex-1 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                                                            <span className="text-lg font-black text-indigo-400 w-8 text-center font-mono">{formData.convictionLevel || 5}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-4 block tracking-widest">FOMO Intensity</label>
                                                        <div className="flex items-center gap-4">
                                                            <input type="range" min="1" max="10" step="1" value={formData.fomoLevel || 1} onChange={e => updateField('fomoLevel', parseInt(e.target.value))} className="flex-1 accent-rose-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                                                            <span className="text-lg font-black text-rose-400 w-8 text-center font-mono">{formData.fomoLevel || 1}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-4 block tracking-widest">Current Stress Score</label>
                                                        <div className="flex items-center gap-4">
                                                            <input type="range" min="1" max="10" step="1" value={formData.stressLevel || 1} onChange={e => updateField('stressLevel', parseInt(e.target.value))} className="flex-1 accent-amber-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                                                            <span className="text-lg font-black text-amber-400 w-8 text-center font-mono">{formData.stressLevel || 1}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="md:col-span-8 bg-slate-950/40 p-6 rounded-xl border border-slate-800/40 flex flex-col gap-6">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div className="flex justify-between items-center p-3 rounded-lg border border-slate-700/50 bg-slate-900/50 hover:bg-slate-800/50 transition-colors">
                                                            <label className="text-xs text-slate-300 uppercase font-bold tracking-wider flex items-center gap-2">
                                                                <ActivitySquare size={14} className="text-emerald-400" />
                                                                Physical State
                                                            </label>
                                                            <select
                                                                value={formData.physicalState || 'Rested'}
                                                                onChange={e => updateField('physicalState', e.target.value)}
                                                                className="bg-slate-950 border border-slate-700 rounded text-xs px-2 py-1.5 text-slate-300 outline-none focus:border-emerald-500/50 cursor-pointer"
                                                            >
                                                                <option value="Rested">🌱 Well Rested</option>
                                                                <option value="Fatigued">🔋 Fatigued</option>
                                                                <option value="Caffeinated">☕ Over-Caffeinated</option>
                                                                <option value="Hungover">🍷 Hungover</option>
                                                                <option value="Sick">🤒 Sick/Ailing</option>
                                                            </select>
                                                        </div>

                                                        <div className="flex justify-between items-center p-3 rounded-lg border border-slate-700/50 bg-slate-900/50 hover:bg-slate-800/50 transition-colors">
                                                            <label className="text-xs text-slate-300 uppercase font-bold tracking-wider flex items-center gap-2">
                                                                <Target size={14} className="text-indigo-400" />
                                                                Mental Focus
                                                            </label>
                                                            <select
                                                                value={formData.focusState || 'Hyper-Focused'}
                                                                onChange={e => updateField('focusState', e.target.value)}
                                                                className="bg-slate-950 border border-slate-700 rounded text-xs px-2 py-1.5 text-slate-300 outline-none focus:border-indigo-500/50 cursor-pointer"
                                                            >
                                                                <option value="Hyper-Focused">🎯 Hyper-Focused</option>
                                                                <option value="Flow State">🌊 Flow State</option>
                                                                <option value="Distracted">📱 Distracted</option>
                                                                <option value="Bored">🥱 Bored/Restless</option>
                                                            </select>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-950/40 p-4 rounded-lg border border-slate-800/40">
                                                        <MoodSelector
                                                            moods={MOODS_ENTRY}
                                                            selectedMood={formData.moodEntry}
                                                            onSelect={(label: string) => memoizedUpdateField('moodEntry', label)}
                                                            label="Mental State (Entry)"
                                                        />
                                                        <MoodSelector
                                                            moods={MOODS_EXIT}
                                                            selectedMood={formData.moodExit}
                                                            onSelect={(label: string) => memoizedUpdateField('moodExit', label)}
                                                            label="Mental State (Exit)"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Friction & Insights */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="bg-slate-950/40 p-6 rounded-xl border border-slate-800/40 flex flex-col gap-4 relative overflow-hidden">
                                                    <div className="flex justify-between items-center">
                                                        <label className="text-xs text-rose-400 uppercase tracking-wider font-bold flex items-center gap-1.5"><Activity size={14} /> Trade Friction</label>
                                                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${formData.tiltScore && formData.tiltScore > 50 ? 'bg-rose-500/20 border-rose-500 text-rose-500' : formData.tiltScore && formData.tiltScore > 20 ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400'}`}>
                                                            <TrendingDown size={12} />
                                                            <span className="text-[10px] font-bold tracking-widest uppercase">Tilt Meter: {formData.tiltScore || 0}%</span>
                                                        </div>
                                                    </div>

                                                    <label className="flex items-center gap-2 cursor-pointer group bg-slate-900/50 p-2 rounded-lg border border-slate-800 hover:border-rose-500/50 transition-colors">
                                                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${formData.forcedTrade ? 'bg-rose-500 border-rose-500 shadow-sm' : 'bg-slate-900 border-slate-600 group-hover:border-rose-400'}`}>
                                                            {formData.forcedTrade && <CheckSquare size={12} className="text-white" />}
                                                        </div>
                                                        <input type="checkbox" className="hidden" checked={formData.forcedTrade || false} onChange={e => updateField('forcedTrade', e.target.checked)} />
                                                        <span className={`text-xs font-bold transition-colors ${formData.forcedTrade ? 'text-rose-400' : 'text-slate-500 group-hover:text-slate-300'}`}>Forced Trade / Boredom Entry (30% Penalty)</span>
                                                    </label>
                                                    <div className="w-full h-px bg-slate-800/60 my-1" />
                                                    <div className="flex flex-wrap gap-2 mb-1">
                                                        {MISTAKE_TAGS.map(tag => (
                                                            <button
                                                                key={tag}
                                                                onClick={() => toggleMistake(tag)}
                                                                className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${formData.mistakes?.includes(tag) ? 'bg-rose-500/10 border-rose-500/50 text-rose-400' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300'}`}
                                                            >
                                                                {tag}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="flex gap-2 mt-auto">
                                                        <input
                                                            type="text"
                                                            value={newMistake}
                                                            onChange={(e) => setNewMistake(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && handleAddMistake()}
                                                            placeholder="Add custom friction..."
                                                            className="bg-slate-900 border border-slate-700/50 rounded-lg px-3 py-2 text-sm font-medium text-white outline-none focus:border-rose-500/50 flex-1 shadow-inner transition-colors"
                                                        />
                                                        <button onClick={handleAddMistake} disabled={!newMistake.trim()} className="px-3 bg-slate-800 border border-slate-700 rounded-lg hover:bg-rose-600 hover:text-white hover:border-rose-500 disabled:opacity-50 transition-all font-bold flex items-center justify-center">
                                                            <Plus size={16} />
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="bg-slate-950/40 p-6 rounded-xl border border-slate-800/40 flex flex-col gap-4 h-full">
                                                    <label className="text-xs font-bold text-indigo-400 uppercase tracking-wider block flex items-center gap-1.5">💡 Aha Moment / Key Insight</label>
                                                    <textarea
                                                        value={formData.ahaMoment || ''}
                                                        onChange={(e) => updateField('ahaMoment', e.target.value)}
                                                        placeholder="Key takeaway, realization, or market nuance discovered during this execution..."
                                                        className="flex-1 w-full bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-sm text-white focus:border-indigo-500/50 outline-none resize-none min-h-[140px] custom-scrollbar shadow-inner transition-colors leading-relaxed"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            )}

                            {/* STEP 4: EVIDENCE LOCKER */}
                            {step === 4 && (
                                <motion.div key="step4" variants={variants} custom={1} initial="enter" animate="center" exit="exit" className="flex flex-col gap-6 max-w-5xl mx-auto w-full">

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
                                        {/* Notes and Loom Video */}
                                        <div className="flex flex-col gap-5 h-full bg-slate-950/40 p-5 rounded-xl border border-slate-800/40">
                                            {deepReflection && (
                                                <div className="flex flex-col">
                                                    <label className="text-[10px] text-indigo-400 uppercase font-bold mb-1.5 flex items-center gap-1.5 tracking-wider">
                                                        <Globe size={12} /> Loom / Video Proof URL
                                                    </label>
                                                    <input type="url" value={formData.loomUrl || ''} onChange={e => updateField('loomUrl', e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white outline-none font-mono text-sm placeholder:text-slate-700 focus:border-indigo-500/50 shadow-inner transition-colors" placeholder="https://www.loom.com/share/..." />
                                                </div>
                                            )}
                                            <div className="flex-1 flex flex-col pt-4 border-t border-slate-800/40 h-full mt-1">
                                                <label className="text-[10px] text-slate-500 uppercase font-bold mb-2 block tracking-wider">Execution Notes</label>
                                                <textarea value={formData.notes || ''} onChange={e => updateField('notes', e.target.value)} className="flex-1 w-full bg-slate-900 border border-slate-800 rounded-lg p-4 text-slate-300 focus:border-indigo-500/50 outline-none resize-none custom-scrollbar text-sm leading-relaxed shadow-inner transition-all min-h-[160px]" placeholder="Detailed breakdown of your rationale, setups seen on lower timeframes, multi-timeframe alignment, and thoughts during the trade..." />
                                            </div>
                                        </div>

                                        {/* Chart Upload / Unified Drag & Drop (Step 4) */}
                                        <div className="flex flex-col h-full justify-between">
                                            <TradeScreenshotsUpload
                                                previews={previews}
                                                compressingType={compressingType}
                                                htfRef={htfRef}
                                                entryRef={entryRef}
                                                exitRef={exitRef}
                                                handleFileChange={handleFileChange}
                                                onHoverSlot={setHoveredSlot}
                                                onRemoveFile={handleRemoveFile}
                                                activeTab={activeScreenshotTab}
                                                setActiveTab={setActiveScreenshotTab}
                                                showAnnotations={deepReflection}
                                                chartAnnotations={formData.chartAnnotations}
                                                updateField={updateField}
                                            />
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {/* STEP 5: MASTERY & POST-MORTEM */}
                            {step === 5 && (
                                <motion.div key="step5" variants={variants} custom={1} initial="enter" animate="center" exit="exit" className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
                                    <div className="bg-slate-950/40 p-6 rounded-xl border border-slate-800/40 shadow-inner flex flex-col gap-6">
                                        <div className="flex items-center gap-2 mb-2 border-b border-white/5 pb-3">
                                            <Award size={18} className="text-amber-400" />
                                            <h4 className="text-sm font-bold text-white uppercase tracking-wider">Post-Mortem & Mastery Review</h4>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            {/* Left side: Toggles & Grades */}
                                            <div className="flex flex-col gap-5">
                                                <div className="bg-slate-900/40 p-4 rounded-lg border border-slate-800/60">
                                                    <label className="text-xs text-indigo-400 font-bold tracking-wider mb-2 block flex items-center gap-2">
                                                        <ActivitySquare size={14} /> The Ultimate Question
                                                    </label>
                                                    <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">Knowing what you know now, with the benefit of hindsight and ignoring the PNL, would you take this exact trade again?</p>
                                                    <div className="flex bg-slate-950 rounded border border-slate-800 h-[38px] p-1 shadow-inner">
                                                        <button onClick={() => updateField('wouldTakeAgain', true)} className={`flex-1 rounded text-[10px] font-bold tracking-wider transition-all ${formData.wouldTakeAgain ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'text-slate-500 hover:text-slate-300'}`}>YES, ABSOLUTELY</button>
                                                        <button onClick={() => updateField('wouldTakeAgain', false)} className={`flex-1 rounded text-[10px] font-bold tracking-wider transition-all ${!formData.wouldTakeAgain ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50' : 'text-slate-500 hover:text-slate-300'}`}>NO, AVOID</button>
                                                    </div>
                                                </div>

                                                <label className="flex items-center gap-4 cursor-pointer group bg-slate-900/40 p-4 rounded-lg border border-slate-800/60 transition-colors hover:bg-slate-800/20">
                                                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${formData.isTextbook ? 'bg-amber-500 border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' : 'bg-slate-950 border-slate-600 group-hover:border-amber-400/50'}`}>
                                                        {formData.isTextbook && <CheckSquare size={14} className="text-slate-900" />}
                                                    </div>
                                                    <input type="checkbox" className="hidden" checked={formData.isTextbook || false} onChange={e => updateField('isTextbook', e.target.checked)} />
                                                    <div className="flex flex-col">
                                                        <span className={`text-sm font-bold tracking-wide transition-colors ${formData.isTextbook ? 'text-amber-400' : 'text-slate-300 group-hover:text-amber-100'}`}>Textbook Example Flag</span>
                                                        <span className="text-[10px] text-slate-500 mt-0.5">Save this trade to the Playbook Gallery for future reference. A+ setups only.</span>
                                                    </div>
                                                </label>

                                                <div className="bg-slate-900/40 p-4 rounded-lg border border-slate-800/60 mt-auto">
                                                    <div className="flex justify-between items-center">
                                                        <label className="text-xs text-slate-300 font-bold uppercase tracking-wider flex items-center gap-2">
                                                            <BadgeCheck size={14} className="text-indigo-400" /> System Grade
                                                            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded tracking-widest">{formData.complianceScore || 0}%</span>
                                                        </label>
                                                        <div className="w-[1px] h-6 bg-slate-800 mx-3"></div>
                                                        <div className="flex flex-col items-end">
                                                            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Adjusted Grade</label>
                                                            <select
                                                                value={formData.adjustedGrade || 'B'}
                                                                onChange={e => updateField('adjustedGrade', e.target.value)}
                                                                className="bg-slate-950 border border-slate-700/50 rounded text-xs font-bold px-3 py-1.5 text-indigo-300 outline-none focus:border-indigo-500/50 cursor-pointer shadow-inner"
                                                            >
                                                                <option value="A">Grade A (Elite Execution)</option>
                                                                <option value="B">Grade B (Good/Acceptable)</option>
                                                                <option value="C">Grade C (Sloppy Mistakes)</option>
                                                                <option value="D">Grade D (Poor Discipline)</option>
                                                                <option value="F">Grade F (Total Failure)</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right side: Core Lesson & Submit */}
                                            <div className="flex flex-col gap-5 h-full">
                                                <div className="flex-1 flex flex-col pt-2 h-full">
                                                    <label className="text-xs text-emerald-400 uppercase font-bold mb-3 block tracking-wider flex items-center gap-2"><Brain size={14} /> One Core Lesson</label>
                                                    <textarea value={formData.coreLesson || ''} onChange={e => updateField('coreLesson', e.target.value)} className="flex-1 w-full bg-slate-900/80 border border-slate-800 rounded-lg p-5 text-emerald-50 focus:border-emerald-500/50 outline-none resize-none custom-scrollbar text-sm leading-relaxed shadow-inner transition-all min-h-[160px]" placeholder="What is the single biggest takeaway, pattern, or mental correction generated from reviewing this full execution log?" />
                                                </div>

                                                {isImportedReviewTrade && (
                                                    <div className={`rounded-xl border px-4 py-3 text-xs ${reviewStatusPreview === 'ANNOTATED'
                                                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                                        : 'border-indigo-500/20 bg-indigo-500/10 text-indigo-200'
                                                        }`}>
                                                        <p className="font-bold uppercase tracking-wider">
                                                            {reviewStatusPreview === 'ANNOTATED' ? 'Review Ready' : `Next Save Result: ${reviewMeta.label}`}
                                                        </p>
                                                        <p className="mt-1 leading-relaxed">
                                                            {reviewStatusPreview === 'ANNOTATED'
                                                                ? 'Saving now will keep this imported trade marked as fully reviewed and ready for lesson tracking.'
                                                                : reviewMeta.description}
                                                        </p>
                                                    </div>
                                                )}

                                                <button
                                                    onClick={handleSubmit}
                                                    disabled={riskData.isViolation || compressingType !== null}
                                                    className={`w-full py-4 mt-2 rounded-xl font-bold text-base transition-all flex justify-center items-center gap-2 tracking-wider uppercase shadow-lg ${riskData.isViolation ? 'bg-slate-900 text-slate-600 cursor-not-allowed border border-rose-900/50' : 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 hover:shadow-indigo-500/20'}`}
                                                >
                                                    {riskData.isViolation ? <AlertTriangle size={18} className="text-rose-500" /> : <Save size={18} className="text-indigo-200" />}
                                                    {riskData.isViolation ? 'Fix Risk Violations' : tradeToEdit ? 'Update Execution Log' : 'Commit & Save Trade'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Footer Navigation */}
                    <div className="py-4 px-6 border-t border-slate-800/60 bg-slate-950/40 flex justify-between items-center shadow-inner">
                        <button onClick={prevStep} className={`px-5 py-2.5 rounded-lg font-bold flex items-center gap-1.5 transition-all text-xs uppercase tracking-wider ${step === 1 ? 'opacity-0 pointer-events-none' : 'text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-700'}`}>
                            <ChevronLeft size={16} /> Backward
                        </button>

                        <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map(i => (
                                <div key={i} onClick={() => i < step ? prevStep() : null} className={`w-2 h-2 rounded-full transition-all ${step === i ? 'bg-indigo-500 scale-125' : step > i ? 'bg-indigo-500/40 cursor-pointer' : 'bg-slate-800'}`} />
                            ))}
                        </div>

                        {step < 5 ? (
                            <button onClick={nextStep} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold transition-all flex items-center gap-1.5 text-xs uppercase tracking-wider">
                                Forward <ChevronRight size={16} />
                            </button>
                        ) : (
                            <button
                                onClick={async () => {
                                    if (isCircuitBreakerActive) return;

                                    // 1. Calculate Tilt Impact
                                    let tiltImpact = 0;
                                    if (formData.moodEntry === 'Revenge') tiltImpact += 30;
                                    if (formData.moodEntry === 'Greedy') tiltImpact += 15;
                                    if (formData.grade === 'F' || formData.adjustedGrade === 'F') tiltImpact += 40;
                                    if (formData.stopLossMoved) tiltImpact += 20;

                                    // 2. Perform regular submit
                                    await handleSubmit();

                                    // 3. Update Cosmic Stats
                                    if (!tradeToEdit) { // Only count new trades
                                        incrementTradeCount();
                                        if (formData.fees) updateFees(formData.fees);
                                    }
                                    if (tiltImpact > 0) addTilt(tiltImpact);

                                    // 4. Force check
                                    CosmicTradeGovernor.checkAndLock();
                                }}
                                disabled={riskData.isViolation || compressingType !== null}
                                className={`px-5 py-2.5 rounded-lg font-bold transition-all flex items-center gap-1.5 text-xs uppercase tracking-wider ${riskData.isViolation ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'}`}
                            >
                                {tradeToEdit ? 'Update' : 'Commit & Save'} <Save size={16} />
                            </button>
                        )}
                    </div>

                </div>
            </motion.div>

            <PreMarketRoutineModal
                isOpen={isPreMarketOpen}
                onClose={() => setIsPreMarketOpen(false)}
            />

            <LogMissedTradeModal
                isOpen={isMissedTradeModalOpen}
                onClose={() => setIsMissedTradeModalOpen(false)}
                onSave={() => { }}
            />

            {/* DhanHQ Trade Picker Modal */}
            <AnimatePresence>
                {showTradePickerModal && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200]"
                            onClick={() => setShowTradePickerModal(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.92, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.92, y: 20 }}
                            transition={{ type: 'spring', damping: 20, stiffness: 200 }}
                            className="fixed inset-0 z-[201] flex items-center justify-center p-4"
                            role="dialog" aria-modal="true" aria-labelledby="execution-desk-title"
                        >
                            <div className="bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                                {/* Modal Header */}
                                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-gradient-to-r from-indigo-900/30 to-violet-900/20">
                                    <div>
                                        <h3 className="font-bold text-white flex items-center gap-2 text-base">
                                            <Download size={18} className="text-indigo-400" />
                                            Today's Executed Trades
                                        </h3>
                                        <p className="text-xs text-slate-400 mt-0.5">Select a trade to auto-fill the form. You can edit before saving.</p>
                                    </div>
                                    <button
                                        onClick={() => setShowTradePickerModal(false)}
                                        className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                {/* Trade List */}
                                <div className="overflow-y-auto max-h-[60vh] custom-scrollbar divide-y divide-slate-800/60">
                                    {pulledTrades.map((t, i) => (
                                        <button
                                            key={i}
                                            onClick={() => handleSelectPulledTrade(t)}
                                            className="w-full text-left px-5 py-4 hover:bg-indigo-600/10 hover:border-l-2 hover:border-l-indigo-500 transition-all group"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2 rounded-lg ${t.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                                        {t.direction === 'Long' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-white text-sm">{t.symbol}</span>
                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${t.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                                                {t.direction}
                                                            </span>
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-800 text-slate-400">
                                                                {t.assetClass}
                                                            </span>
                                                        </div>
                                                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                                                            <span>Qty: <span className="text-slate-300 font-mono">{t.totalBuyQty || t.totalSellQty}</span></span>
                                                            {t.avgBuyPrice > 0 && <span>Buy: <span className="text-emerald-400 font-mono">₹{t.avgBuyPrice.toFixed(2)}</span></span>}
                                                            {t.avgSellPrice > 0 && <span>Sell: <span className="text-rose-400 font-mono">₹{t.avgSellPrice.toFixed(2)}</span></span>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    {t.pnl !== undefined ? (
                                                        <span className={`font-bold font-mono text-sm ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                            {t.pnl >= 0 ? '+' : ''}₹{t.pnl.toFixed(2)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-slate-500 font-mono">Open/Partial</span>
                                                    )}
                                                    <div className="text-[10px] text-slate-600 text-right mt-0.5 group-hover:text-indigo-400 transition-colors">
                                                        Click to fill →
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>

                                {/* Modal Footer */}
                                <div className="px-5 py-3 border-t border-slate-800 bg-slate-950">
                                    <p className="text-[11px] text-slate-600 text-center">
                                        Auto-fill populates: Ticker · Date · Direction · Qty · Avg Entry/Exit · Asset Class · Est. P&amp;L
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Pull Error Alert */}
            <AnimatePresence>
                {pullError && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] bg-rose-950/90 border border-rose-700/50 text-rose-300 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium flex items-center gap-3 max-w-md backdrop-blur-sm"
                    >
                        <AlertTriangle size={16} className="text-rose-400 flex-shrink-0" />
                        <span>{pullError}</span>
                        <button onClick={() => setPullError(null)} aria-label="Dismiss error" className="ml-auto p-1 hover:bg-rose-900 rounded-lg text-rose-400">
                            <X size={14} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
});

export default ExecutionDesk;
