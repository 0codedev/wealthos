import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Upload, Loader2, AlertCircle, Clock, ChevronDown } from 'lucide-react';
import { db, MissedTrade, MissedReason } from '../../database';
import { compressImage } from '../../utils/helpers';
import { EmptyState } from '../shared/EmptyState';

interface LogMissedTradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
}

const ASSET_CLASSES = ['Equity', 'Options', 'Crypto', 'Forex', 'Futures'];
const REASONS: MissedReason[] = ['FOMO', 'Hesitation', 'Distracted', 'Setup Invalidated Early', 'Too Fast', 'Other'];

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
                className={`w-full bg-slate-900 hover:bg-slate-800 border rounded-lg px-3 py-2 text-xs text-white flex items-center justify-between h-[38px] cursor-pointer transition-all ${
                    isOpen ? 'border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.25)]' : 'border-slate-700/50 hover:border-slate-650'
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
                        <span className="text-slate-500">{placeholder}</span>
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
                        className="absolute left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-[110] overflow-hidden flex flex-col max-h-60"
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
                                            className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-800 transition-colors ${
                                                isSelected ? 'bg-indigo-600/20 text-indigo-300 font-bold border-l-2 border-indigo-500' : 'text-slate-300 hover:text-white'
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

export const LogMissedTradeModal: React.FC<LogMissedTradeModalProps> = ({ isOpen, onClose, onSave }) => {
    const [formData, setFormData] = useState<Partial<MissedTrade>>({
        date: new Date().toISOString().split('T')[0],
        assetClass: 'Equity',
        direction: 'Long',
        reason: 'Hesitation',
        setup: ''
    });

    const [strategies, setStrategies] = useState<any[]>([]);
    const [isCompressingHTF, setIsCompressingHTF] = useState(false);
    const [isCompressingEntry, setIsCompressingEntry] = useState(false);
    const [previewHTF, setPreviewHTF] = useState<string | null>(null);
    const [previewEntry, setPreviewEntry] = useState<string | null>(null);
    const [hoveredSlot, setHoveredSlot] = useState<'HTF' | 'Entry' | null>(null);
    
    const htfRef = useRef<HTMLInputElement>(null);
    const entryRef = useRef<HTMLInputElement>(null);

    // Fetch existing strategies
    useEffect(() => {
        if (isOpen) {
            db.strategies.toArray()
                .then(data => {
                    setStrategies(data);
                })
                .catch(err => console.error("Failed to load strategies:", err));
        }
    }, [isOpen]);

    // Handle Ctrl+V Paste
    useEffect(() => {
        if (!isOpen) return;

        const handlePaste = async (e: ClipboardEvent) => {
            const item = e.clipboardData?.items[0];
            if (item?.type.includes('image')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (!file) return;

                const targetSlot = hoveredSlot || (previewHTF && !previewEntry ? 'Entry' : 'HTF');

                if (targetSlot === 'HTF') setIsCompressingHTF(true);
                else setIsCompressingEntry(true);

                try {
                    const compressedBlob = await compressImage(file);
                    const previewUrl = URL.createObjectURL(compressedBlob);
                    if (targetSlot === 'HTF') {
                        updateField('screenshotHTF', compressedBlob);
                        setPreviewHTF(previewUrl);
                    } else {
                        updateField('screenshotEntry', compressedBlob);
                        setPreviewEntry(previewUrl);
                    }
                } catch (error) {
                    console.error(`Error pasting ${targetSlot} image:`, error);
                } finally {
                    if (targetSlot === 'HTF') setIsCompressingHTF(false);
                    else setIsCompressingEntry(false);
                }
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [isOpen, hoveredSlot, previewHTF, previewEntry]);

    const updateField = (field: keyof MissedTrade, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleFileChange = async (type: 'HTF' | 'Entry', e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (type === 'HTF') setIsCompressingHTF(true);
        else setIsCompressingEntry(true);

        try {
            const compressedBlob = await compressImage(file);
            const previewUrl = URL.createObjectURL(compressedBlob);
            if (type === 'HTF') {
                updateField('screenshotHTF', compressedBlob);
                setPreviewHTF(previewUrl);
            } else {
                updateField('screenshotEntry', compressedBlob);
                setPreviewEntry(previewUrl);
            }
        } catch (error) {
            console.error(`Error compressing ${type} image:`, error);
            alert(`Failed to process ${type} image. Note: Only images are supported.`);
        } finally {
            if (type === 'HTF') setIsCompressingHTF(false);
            else setIsCompressingEntry(false);
        }
    };

    const handleSubmit = async () => {
        if (!formData.ticker || !formData.setup) {
            alert("Please fill in Ticker and Setup");
            return;
        }

        try {
            await db.missed_trades.add(formData as MissedTrade);
            onSave();
            onClose();
            // Reset
            setFormData({
                date: new Date().toISOString().split('T')[0],
                assetClass: 'Equity',
                direction: 'Long',
                reason: 'Hesitation',
                setup: ''
            });
            setPreviewHTF(null);
            setPreviewEntry(null);
        } catch (error) {
            console.error("Failed to save missed trade", error);
            alert("Failed to save missed trade");
        }
    };

    const strategyOptions = useMemo(() => {
        const list = strategies.map(s => ({
            value: s.name,
            label: s.name,
            subtext: s.rules && s.rules.length > 0 ? `${s.rules.length} rules` : undefined
        }));
        return [
            ...list,
            { value: 'Other', label: 'Other (Type custom setup...)' }
        ];
    }, [strategies]);

    const isCustomSetup = useMemo(() => {
        if (!formData.setup) return false;
        return formData.setup !== '' && !strategies.some(s => s.name === formData.setup);
    }, [formData.setup, strategies]);

    if (!isOpen) return null;

    return createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="log-missed-trade-title" className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-xl p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -20 }}
                className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
                <div className="flex justify-between items-center p-6 border-b border-white/10 bg-slate-950/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            <AlertCircle size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-wide text-white">Log Missed Trade</h2>
                            <p className="text-xs text-slate-500 font-mono tracking-wider">Document the ones that got away</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Close log missed trade" className="text-slate-500 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Left Column: Details */}
                        <div className="space-y-6">
                            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 space-y-4">
                                <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 pb-2">Trade Details</h4>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Ticker</label>
                                        <input
                                            type="text"
                                            value={formData.ticker || ''}
                                            onChange={e => updateField('ticker', e.target.value.toUpperCase())}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none font-mono tracking-wider"
                                            placeholder="e.g. AAPL"
                                            autoFocus
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500 uppercase font-bold mb-1 block flex items-center gap-1"><Clock size={12} /> Date</label>
                                        <input type="date" value={formData.date || ''} onChange={e => updateField('date', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none font-mono text-sm" />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-slate-500 uppercase font-bold mb-2 block">Asset Class</label>
                                        <select
                                            value={formData.assetClass}
                                            onChange={e => updateField('assetClass', e.target.value)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none text-sm"
                                        >
                                            {ASSET_CLASSES.map(ac => <option key={ac} value={ac}>{ac}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500 uppercase font-bold mb-2 block">Direction</label>
                                        <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
                                            <button onClick={() => updateField('direction', 'Long')} className={`flex-1 py-2 rounded text-sm font-bold transition-all ${formData.direction === 'Long' ? 'bg-emerald-600 shadow-md text-white' : 'text-slate-500 hover:text-slate-300'}`}>LONG</button>
                                            <button onClick={() => updateField('direction', 'Short')} className={`flex-1 py-2 rounded text-sm font-bold transition-all ${formData.direction === 'Short' ? 'bg-rose-600 shadow-md text-white' : 'text-slate-500 hover:text-slate-300'}`}>SHORT</button>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Setup / Strategy</label>
                                    <CustomSelect
                                        value={isCustomSetup ? 'Other' : (formData.setup || '')}
                                        onChange={val => {
                                            if (val === 'Other') {
                                                updateField('setup', 'Custom Strategy');
                                            } else {
                                                updateField('setup', val);
                                            }
                                        }}
                                        options={strategyOptions}
                                        placeholder="Select Strategy"
                                        showSearch={true}
                                    />
                                </div>

                                {isCustomSetup && (
                                    <div className="mt-3">
                                        <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Custom Setup Name</label>
                                        <input
                                            type="text"
                                            value={formData.setup === 'Custom Strategy' ? '' : formData.setup}
                                            onChange={e => updateField('setup', e.target.value)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none"
                                            placeholder="Type custom setup..."
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 space-y-4">
                                <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 pb-2 flex items-center gap-2">
                                    Why was it missed?
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                    {REASONS.map(reason => (
                                        <button
                                            key={reason}
                                            onClick={() => updateField('reason', reason)}
                                            className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${formData.reason === reason ? 'bg-amber-600 border-amber-500 text-white shadow-md' : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600'}`}
                                        >
                                            {reason}
                                        </button>
                                    ))}
                                </div>

                                <div className="pt-2">
                                    <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Notes & Lessons</label>
                                    <textarea
                                        value={formData.notes || ''}
                                        onChange={e => updateField('notes', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none resize-none h-24 custom-scrollbar text-sm"
                                        placeholder="What happened? What could be improved next time?"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Evidence */}
                        <div className="space-y-6 flex flex-col">
                            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 flex-1 flex flex-col space-y-4">
                                <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 pb-2">Evidence Locker</h4>

                                <div className="grid grid-cols-1 gap-4 flex-1">
                                    {/* HTF Chart */}
                                    <div className="flex-1 flex flex-col">
                                        <label className="text-[10px] text-slate-500 font-bold mb-1 uppercase text-center tracking-widest">HTF Context</label>
                                        <div
                                            onClick={() => !isCompressingHTF && htfRef.current?.click()}
                                            onMouseEnter={() => setHoveredSlot('HTF')}
                                            onMouseLeave={() => setHoveredSlot(null)}
                                            className={`flex-1 min-h-[140px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all ${isCompressingHTF ? 'border-slate-700 bg-slate-900' : 'border-slate-700 bg-slate-900/50 hover:border-indigo-500'} ${previewHTF ? 'p-1 border-indigo-500/50' : 'p-4'}`}
                                        >
                                            <input type="file" ref={htfRef} className="hidden" accept="image/*" onChange={e => handleFileChange('HTF', e)} />
                                            {previewHTF ? (
                                                <div className="relative w-full h-full group">
                                                    <img src={previewHTF} alt="HTF File Preview" className="w-full h-full object-contain rounded-lg" />
                                                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                                                        <span className="text-[9px] font-bold text-white uppercase bg-indigo-600 border border-indigo-500 rounded px-2 py-1 shadow">
                                                            Replace
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : isCompressingHTF ? (
                                                <Loader2 className="animate-spin text-indigo-400" size={24} />
                                            ) : (
                                                <div className="text-center">
                                                    <Upload className="text-slate-500 mx-auto mb-2" size={24} />
                                                    <span className="text-xs text-slate-400 font-medium">Upload HTF Chart</span>
                                                    <span className="text-[9px] text-slate-500 block mt-1">Or Ctrl+V here</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Entry Chart */}
                                    <div className="flex-1 flex flex-col">
                                        <label className="text-[10px] text-slate-500 font-bold mb-1 uppercase text-center tracking-widest">Setup / Trigger</label>
                                        <div
                                            onClick={() => !isCompressingEntry && entryRef.current?.click()}
                                            onMouseEnter={() => setHoveredSlot('Entry')}
                                            onMouseLeave={() => setHoveredSlot(null)}
                                            className={`flex-1 min-h-[140px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all ${isCompressingEntry ? 'border-slate-700 bg-slate-900' : 'border-slate-700 bg-slate-900/50 hover:border-indigo-500'} ${previewEntry ? 'p-1 border-indigo-500/50' : 'p-4'}`}
                                        >
                                            <input type="file" ref={entryRef} className="hidden" accept="image/*" onChange={e => handleFileChange('Entry', e)} />
                                            {previewEntry ? (
                                                <div className="relative w-full h-full group">
                                                    <img src={previewEntry} alt="Entry File Preview" className="w-full h-full object-contain rounded-lg" />
                                                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                                                        <span className="text-[9px] font-bold text-white uppercase bg-indigo-600 border border-indigo-500 rounded px-2 py-1 shadow">
                                                            Replace
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : isCompressingEntry ? (
                                                <Loader2 className="animate-spin text-indigo-400" size={24} />
                                            ) : (
                                                <div className="text-center">
                                                    <Upload className="text-slate-500 mx-auto mb-2" size={24} />
                                                    <span className="text-xs text-slate-400 font-medium">Upload Setup Chart</span>
                                                    <span className="text-[9px] text-slate-500 block mt-1">Or Ctrl+V here</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-white/10 bg-slate-950/80 flex justify-end z-20">
                    <button
                        onClick={handleSubmit}
                        disabled={isCompressingHTF || isCompressingEntry}
                        className={`px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/20`}
                    >
                        <Save size={18} /> Log Missed Trade
                    </button>
                </div>
            </motion.div>
        </div>,
        document.body
    );
};
