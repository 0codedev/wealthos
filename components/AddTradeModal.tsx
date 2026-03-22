import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, Save, Upload, Target, ShieldAlert, ListChecks, CheckSquare, Award, Clock, AlertTriangle, Loader2, Plus } from 'lucide-react';
import { useTradeForm } from '../hooks/useTradeForm';
import { Trade } from '../database';
import { AccessibleButton, FocusTrap, VisuallyHidden } from './shared/AccessibleComponents';
import { MotionButton } from './ui/MotionButton';
import { formatCurrencyPrecise } from '../utils/helpers';
import { InstrumentSelector } from './shared/InstrumentSelector';
import { optionChainService } from '../services/OptionChainService';
import { quantGreeksService } from '../services/QuantGreeksService';


interface AddTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  tradeToEdit?: Trade | null; // Added prop
}

const MOODS_ENTRY = [
  { label: 'Focused', emoji: '🎯', color: 'border-emerald-500 text-emerald-600 dark:text-emerald-400' },
  { label: 'Anxious', emoji: '😰', color: 'border-amber-500 text-amber-600 dark:text-amber-400' },
  { label: 'Bored', emoji: '🥱', color: 'border-slate-500 text-slate-600 dark:text-slate-400' },
  { label: 'Revenge', emoji: '😡', color: 'border-rose-500 text-rose-600 dark:text-rose-400' },
  { label: 'Greedy', emoji: '🤑', color: 'border-green-400 text-green-600 dark:text-green-300' },
];

const MOODS_EXIT = [
  { label: 'Satisfied', emoji: '😌', color: 'border-emerald-500 text-emerald-600 dark:text-emerald-400' },
  { label: 'Relieved', emoji: '😅', color: 'border-blue-500 text-blue-600 dark:text-blue-400' },
  { label: 'Frustrated', emoji: '😤', color: 'border-rose-500 text-rose-600 dark:text-rose-400' },
  { label: 'Regretful', emoji: '😞', color: 'border-amber-500 text-amber-600 dark:text-amber-400' },
  { label: 'Euphoric', emoji: '🤩', color: 'border-purple-400 text-purple-600 dark:text-purple-300' },
];

const ASSET_CLASSES = ['Equity', 'Options', 'Crypto', 'Forex', 'Futures'];
const SETUP_TAGS = ['Breakout', 'Pullback', 'Reversal', 'Trend Following', 'Scalp', 'News Catalyst'];

const MISTAKE_TAGS = ['FOMO', 'Chasing', 'No Stop Loss', 'Overleveraged', 'Early Exit', 'Hesitation', 'Revenge Trade', 'News Trading', 'Averaged Down', 'Boredom Trade'];
const GRADES = ['A+', 'A', 'B', 'C', 'D', 'F'];

const AddTradeModal: React.FC<AddTradeModalProps> = ({ isOpen, onClose, onSave, tradeToEdit }) => {
  const {
    step, formData, strategies, selectedStrategy, checkedRules, totalCapital, riskData, compressingType, previews, newMistake,
    directGrossPnL, directNetPnL, handleGrossPnLChange, handleNetPnLChange,
    setNewMistake, setTotalCapital, updateField, toggleMistake, toggleSetupTag, handleAddMistake, handleRuleToggle, handleFileChange, handleSubmit,
    isSubmitting, // Pillar 3A: surfaces safeAsync submitting state for <MotionButton loading>
    nextStep, prevStep, htfRef,
    requiredMargin, isAutoCalcEnabled, setIsAutoCalcEnabled
  } = useTradeForm(isOpen, onSave, onClose, tradeToEdit);

  const isCompressing = compressingType !== null;
  const previewUrl = previews.htf;
  const fileInputRef = htfRef;
  const modalId = useRef(`trade-modal-${Math.random().toString(36).substr(2, 9)}`);
  const [mcsBadge, setMcsBadge] = useState<number | null>(null);
  const [entryGate, setEntryGate] = useState<any>(null);
  const [qcsResult, setQcsResult] = useState<any>(null);
  const [loadingGate, setLoadingGate] = useState(false);

  useEffect(() => {
    const onPrepare = (e: Event) => {
      const detail = (e as CustomEvent<{ symbol: string; snapshot?: { score: { total: number } } }>).detail;
      if (!detail?.symbol) return;
      updateField('ticker', detail.symbol);
      setMcsBadge(detail.snapshot?.score?.total ?? null);
    };
    window.addEventListener('mce:prepare-order', onPrepare);
    return () => window.removeEventListener('mce:prepare-order', onPrepare);
  }, [updateField]);

  useEffect(() => {
    if (step === 4 && formData.ticker && formData.direction) {
      setLoadingGate(true);
      const directionStr = formData.direction.toUpperCase() as 'LONG' | 'SHORT';
      optionChainService.fetchOptionChain(formData.ticker!).then(async (snapshot) => {
        if (snapshot) {
          const result = await quantGreeksService.computeQCS(formData.ticker!, 5.0, snapshot, 50);
          const gate = quantGreeksService.computeEntryGate(directionStr, result);
          setQcsResult(result);
          setEntryGate(gate);
        }
        setLoadingGate(false);
      }).catch(err => {
        console.error("Failed to compute entry gate:", err);
        setLoadingGate(false);
      });
    }
  }, [step, formData.ticker, formData.direction]);

  if (!isOpen) return null;

  const variants = {
    enter: (direction: number) => ({ x: direction > 0 ? 50 : -50, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({ x: direction < 0 ? 50 : -50, opacity: 0 }),
  };

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xl p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${modalId.current}-title`}
    >
      <FocusTrap isActive={isOpen}>
        <div
          className={`w-[95vw] max-w-7xl h-[95vh] bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 animate-modal-pop
          ${riskData.isViolation ? 'border-rose-500 shadow-[0_0_50px_rgba(225,29,72,0.4)]' : 'border-slate-200/50 dark:border-slate-700/40 shadow-[0_0_40px_-10px_rgba(99,102,241,0.2)]'}`}
        >
          {/* Header */}
          <div className="flex justify-between items-center p-6 border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-950/50">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg border ${riskData.isViolation ? 'bg-rose-900/20 text-rose-500 border-rose-500/30' : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-500 border-indigo-500/30'}`}>
                {riskData.isViolation ? <ShieldAlert size={20} className="animate-pulse" aria-hidden="true" /> : <Target size={20} aria-hidden="true" />}
              </div>
              <div>
                <h2 id={`${modalId.current}-title`} className={`text-xl font-bold tracking-wide ${riskData.isViolation ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                  {riskData.isViolation ? 'HARD DECK BREACHED' : tradeToEdit ? 'Edit Trade Log' : 'Log New Trade'}
                </h2>
                <p className="text-xs text-slate-500 font-mono uppercase tracking-wider flex items-center gap-2">
                  Step {step} / 4
                  {mcsBadge != null && (
                    <span className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 font-semibold">
                      MCS {mcsBadge} from alpha
                    </span>
                  )}
                </p>
              </div>
            </div>
            <AccessibleButton 
              onClick={onClose} 
              variant="ghost"
              aria-label="Close modal"
              className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <X size={24} />
            </AccessibleButton>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-8 relative flex flex-col">
            <AnimatePresence mode="wait" custom={step}>

              {/* STEP 1: STRATEGY & RULES */}
              {step === 1 && (
                <motion.div key="step1" variants={variants} initial="enter" animate="center" exit="exit" className="flex flex-col flex-1">
                  <div className="text-center mb-8">
                    <h3 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Trade Execution Engine</h3>
                    <p className="text-slate-500 dark:text-slate-400">Define your asset, structure, and edge.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 flex-1">

                    {/* Left Column: Basic Info & Asset */}
                    <div className="space-y-6">
                      <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50">
                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-4 border-b border-slate-200 dark:border-slate-700/50 pb-2">Asset Details</h4>
                        <div className="space-y-4">
                          {/* 1. Manual Classification (Primary Override) */}
                          <div className="bg-indigo-500/10 p-5 rounded-2xl border border-indigo-500/20 mb-4 shadow-inner shadow-indigo-500/5">
                            <label className="text-[11px] text-indigo-600 dark:text-indigo-400 uppercase font-black tracking-widest mb-3.5 block flex items-center gap-2">
                               <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.8)]" aria-hidden="true"></div>
                               Product Type Override
                            </label>
                            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Select Product Type">
                              {['INTRADAY', 'MIS', 'CNC', 'MARGIN', 'MTF'].map(pt => (
                                <button
                                  key={pt}
                                  type="button"
                                  onClick={() => updateField('productType', pt)}
                                  aria-pressed={formData.productType === pt || (pt === 'INTRADAY' && formData.productType === 'MIS') || (pt === 'MIS' && formData.productType === 'INTRADAY')}
                                  className={`py-2.5 px-2 rounded-xl text-[10px] font-black transition-all border ${
                                    (formData.productType === pt || (pt === 'INTRADAY' && formData.productType === 'MIS') || (pt === 'MIS' && formData.productType === 'INTRADAY'))
                                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/40 scale-105 z-10' 
                                      : 'bg-white dark:bg-slate-900/80 text-slate-500 border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 hover:text-slate-700 dark:hover:text-slate-300'
                                  }`}
                                >
                                  {pt}
                                </button>
                              ))}
                            </div>
                            <p className="text-[10px] text-slate-500 mt-3 font-medium italic opacity-70">
                              * Overrides broker defaults for manual P&L calculation and filtering.
                            </p>
                          </div>

                          <div>
                            <label htmlFor={`${modalId.current}-ticker`} className="text-xs text-slate-500 uppercase font-bold mb-2 block">Ticker Symbol / Instrument</label>
                            <InstrumentSelector
                              value={formData.ticker || ''}
                              onChange={val => updateField('ticker', val.toUpperCase())}
                              onSelect={instrument => {
                                updateField('ticker', instrument.symbol);
                                if (instrument.lot_size) {
                                  updateField('quantity', instrument.lot_size);
                                }
                                if (instrument.option_type) {
                                  updateField('assetClass', 'Options');
                                  updateField('brokerProfile', 'Intraday Options');
                                }
                              }}
                              placeholder="Search Equity or Option contracts..."
                            />
                          </div>

                          <div>
                            <label className="text-xs text-slate-500 uppercase font-bold mb-2 block">Asset Class</label>
                            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Select Asset Class">
                              {ASSET_CLASSES.map(ac => (
                                <button
                                  key={ac}
                                  onClick={() => updateField('assetClass', ac)}
                                  aria-pressed={formData.assetClass === ac}
                                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border ${formData.assetClass === ac ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600'}`}
                                >
                                  {ac}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label htmlFor={`${modalId.current}-profile`} className="text-xs text-slate-500 uppercase font-bold mb-2 block">Execution Profile</label>
                            <select 
                              id={`${modalId.current}-profile`}
                              value={formData.brokerProfile || 'Intraday Equity'} 
                              onChange={e => updateField('brokerProfile', e.target.value)}
                              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-slate-900 dark:text-white focus:border-indigo-500 outline-none font-sans text-sm"
                            >
                              <option value="Intraday Equity">Intraday Equity (MIS)</option>
                              <option value="Intraday Options">Intraday Options (MIS)</option>
                              <option value="Intraday Futures">Intraday Futures (MIS)</option>
                              <option value="Delivery Equity">Delivery Equity (CNC)</option>
                              <option value="Positional Options">Positional Options (MARGIN)</option>
                              <option value="Futures">Futures (MARGIN)</option>
                              <option value="MTF / Margin">MTF / Margin</option>
                            </select>
                          </div>


                          <div>
                            <label className="text-xs text-slate-500 uppercase font-bold mb-2 block">Direction</label>
                            <div className="flex bg-white dark:bg-slate-900 rounded-lg p-1 border border-slate-200 dark:border-slate-800" role="group" aria-label="Select Direction">
                              <button onClick={() => updateField('direction', 'Long')} aria-pressed={formData.direction === 'Long'} className={`flex-1 py-3 rounded text-sm font-bold transition-all ${formData.direction === 'Long' ? 'bg-emerald-600 shadow-md text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>LONG</button>
                              <button onClick={() => updateField('direction', 'Short')} aria-pressed={formData.direction === 'Short'} className={`flex-1 py-3 rounded text-sm font-bold transition-all ${formData.direction === 'Short' ? 'bg-rose-600 shadow-md text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>SHORT</button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-100/40 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700/50">
                          <label htmlFor={`${modalId.current}-date`} className="text-xs text-slate-500 uppercase font-bold mb-2 block">Date</label>
                          <input id={`${modalId.current}-date`} type="date" value={formData.date || ''} onChange={e => updateField('date', e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-200 focus:border-indigo-500 outline-none font-mono text-sm" />
                        </div>
                        <div className="bg-slate-100/40 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700/50">
                          <label htmlFor={`${modalId.current}-time`} className="text-xs text-slate-500 uppercase font-bold mb-2 flex items-center gap-1"><Clock size={12} aria-hidden="true" /> Time</label>
                          <input id={`${modalId.current}-time`} type="time" value={formData.entryTime || ''} onChange={e => updateField('entryTime', e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-200 focus:border-indigo-500 outline-none font-mono text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Middle Column: Strategy & Tags */}
                    <div className="space-y-6">
                      <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 h-full flex flex-col">
                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-4 border-b border-slate-200 dark:border-slate-700/50 pb-2">The Setup</h4>

                        <div className="mb-6">
                          <label className="text-xs text-slate-500 uppercase font-bold mb-2 block">Primary Strategy</label>
                          <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar" role="group" aria-label="Select Primary Strategy">
                            {strategies.map(s => (
                              <button
                                key={s.id}
                                onClick={() => updateField('setup', s.name)}
                                aria-pressed={formData.setup === s.name}
                                className={`p-3 rounded-xl border text-sm font-medium transition-all text-left ${formData.setup === s.name ? 'bg-indigo-600 border-indigo-500 text-white shadow-md' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-600'}`}
                              >
                                <span className="block font-bold">{s.name}</span>
                                <span className="text-[10px] opacity-70 truncate block">{s.description}</span>
                              </button>
                            ))}
                            {strategies.length === 0 && <p className="text-xs text-slate-500 italic p-4 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">No strategies found. Add them in Dashboard.</p>}
                          </div>
                        </div>

                        <div className="flex-1">
                          <label className="text-xs text-slate-500 uppercase font-bold mb-2 block">Setup Variables (Multi-Select)</label>
                          <div className="flex flex-wrap gap-2" role="group" aria-label="Select Setup Variables">
                            {SETUP_TAGS.map(tag => (
                              <button
                                key={tag}
                                onClick={() => toggleSetupTag(tag)}
                                aria-pressed={formData.setupTags?.includes(tag)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${formData.setupTags?.includes(tag) ? 'bg-indigo-500/20 border-indigo-500 text-indigo-600 dark:text-indigo-300' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-slate-400 dark:hover:border-slate-600 hover:text-slate-700 dark:hover:text-slate-300'}`}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Pre-Trade Checklist & Grade */}
                    <div className="space-y-6 flex flex-col">
                      <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 flex-1 flex flex-col">
                        <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-slate-700/50 pb-2">
                          <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                            <ListChecks size={16} className="text-indigo-600 dark:text-indigo-400" aria-hidden="true" /> Execution Checklist
                          </h4>
                          <span 
                            className={`text-xs font-mono font-bold px-2 py-1 rounded bg-white dark:bg-slate-900 border ${formData.complianceScore === 100 ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
                            aria-label={`Execution Compliance Score: ${formData.complianceScore}%`}
                          >
                            Score: {formData.complianceScore}%
                          </span>
                        </div>

                        {!selectedStrategy ? (
                          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm italic py-10 border border-dashed border-slate-200 dark:border-slate-700/50 rounded-xl">
                            Select a Primary Strategy first
                          </div>
                        ) : (
                          <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar max-h-[250px]" role="group" aria-label="Strategy Rules Checklist">
                            {selectedStrategy.rules.map((rule, idx) => (
                              <label key={idx} className="flex items-start gap-4 cursor-pointer group p-3 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800/50 hover:border-indigo-500/30 transition-all">
                                <div className={`w-6 h-6 rounded border flex items-center justify-center transition-all shrink-0 mt-0.5 ${checkedRules[idx] ? 'bg-indigo-600 border-indigo-600 shadow-md shadow-indigo-500/20' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-600 group-hover:border-indigo-400'}`}>
                                  {checkedRules[idx] && <CheckSquare size={16} className="text-white" aria-hidden="true" />}
                                </div>
                                <input type="checkbox" className="sr-only" checked={checkedRules[idx]} onChange={() => handleRuleToggle(idx)} />
                                <span className={`text-sm leading-relaxed ${checkedRules[idx] ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}>{rule}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50">
                        <label className="text-xs text-slate-500 uppercase font-bold mb-2 flex items-center gap-1"><Award size={14} aria-hidden="true" /> Execution Grade</label>
                        <div className="flex bg-white dark:bg-slate-900 rounded-lg p-1 border border-slate-200 dark:border-slate-800" role="group" aria-label="Select Execution Grade">
                          {GRADES.map(g => (
                            <button
                              key={g}
                              onClick={() => updateField('grade', g)}
                              aria-pressed={formData.grade === g}
                              className={`flex-1 py-2 rounded text-sm font-bold transition-all ${formData.grade === g ? (g.includes('A') ? 'bg-emerald-600 text-white' : g === 'F' ? 'bg-rose-600 text-white' : 'bg-indigo-600 text-white') : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                  </div>
                </motion.div>
              )}

              {/* STEP 2: MINDSET */}
              {step === 2 && (
                <motion.div key="step2" variants={variants} initial="enter" animate="center" exit="exit" className="flex flex-col flex-1">
                  <div className="text-center mb-8">
                    <h3 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Psychological Engine</h3>
                    <p className="text-slate-500 dark:text-slate-400">Track emotional capital and execution friction.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 flex-1">

                    {/* Left Column: Pre-Trade State */}
                    <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 flex flex-col">
                      <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-6 border-b border-slate-200 dark:border-slate-700/50 pb-2">Pre-Trade State</h4>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block text-center mb-4">Entry Mood</label>
                      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Select Entry Mood">
                        {MOODS_ENTRY.map(m => (
                          <button
                            key={m.label}
                            onClick={() => updateField('moodEntry', m.label)}
                            aria-pressed={formData.moodEntry === m.label}
                            className={`px-3 py-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${formData.moodEntry === m.label ? `${m.color} bg-white dark:bg-slate-800 shadow-[0_0_15px_-5px_currentColor]` : 'border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:border-slate-400 dark:hover:border-slate-700'}`}
                          >
                            <span className="text-3xl" aria-hidden="true">{m.emoji}</span>
                            <span className="text-xs font-bold">{m.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Middle Column: Post-Trade State */}
                    <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 flex flex-col">
                      <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-6 border-b border-slate-200 dark:border-slate-700/50 pb-2">Post-Trade State</h4>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block text-center mb-4">Exit Mood</label>
                      <div className="grid grid-cols-2 gap-3 mb-6" role="group" aria-label="Select Exit Mood">
                        {MOODS_EXIT.map(m => (
                          <button
                            key={m.label}
                            onClick={() => updateField('moodExit', m.label)}
                            aria-pressed={formData.moodExit === m.label}
                            className={`px-3 py-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${formData.moodExit === m.label ? `${m.color} bg-white dark:bg-slate-800 shadow-[0_0_15px_-5px_currentColor]` : 'border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:border-slate-400 dark:hover:border-slate-700'}`}
                          >
                            <span className="text-3xl" aria-hidden="true">{m.emoji}</span>
                            <span className="text-xs font-bold">{m.label}</span>
                          </button>
                        ))}
                      </div>

                      <div className="mt-auto">
                        <label htmlFor={`${modalId.current}-aha`} className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest block mb-2">💡 Ah-Ha Moment</label>
                        <textarea
                          id={`${modalId.current}-aha`}
                          value={formData.ahaMoment || ''}
                          onChange={(e) => updateField('ahaMoment', e.target.value)}
                          placeholder="What did you learn from this trade?"
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm text-slate-900 dark:text-white focus:border-indigo-500 outline-none resize-none h-24 custom-scrollbar"
                        />
                      </div>
                    </div>

                    {/* Right Column: Mistakes & Friction */}
                    <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 flex flex-col">
                      <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-6 border-b border-slate-200 dark:border-slate-700/50 pb-2">Mistakes & Friction</h4>
                      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2 mb-4">
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Select Mistakes">
                          {MISTAKE_TAGS.map(tag => (
                            <button
                              key={tag}
                              onClick={() => toggleMistake(tag)}
                              aria-pressed={formData.mistakes?.includes(tag)}
                              className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${formData.mistakes?.includes(tag) ? 'bg-rose-500/20 border-rose-500 text-rose-600 dark:text-rose-300 shadow-md shadow-rose-500/10' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-slate-400 dark:hover:border-slate-600 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mt-auto pt-4 border-t border-slate-200 dark:border-800">
                        <label htmlFor={`${modalId.current}-custom-mistake`} className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Custom Mistake</label>
                        <div className="flex gap-2">
                          <input
                            id={`${modalId.current}-custom-mistake`}
                            type="text"
                            value={newMistake}
                            onChange={(e) => setNewMistake(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddMistake()}
                            placeholder="e.g., Slept in"
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-indigo-500 flex-1"
                          />
                          <AccessibleButton 
                            onClick={handleAddMistake} 
                            disabled={!newMistake.trim()} 
                            variant="ghost"
                            aria-label="Add custom mistake"
                            className="px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-rose-600 hover:text-white hover:border-rose-500 disabled:opacity-50 transition-colors"
                          >
                            <Plus size={16} />
                          </AccessibleButton>
                        </div>
                      </div>
                    </div>

                  </div>
                </motion.div>
              )}

              {/* STEP 3: RISK */}
              {step === 3 && (
                <motion.div key="step3" variants={variants} initial="enter" animate="center" exit="exit" className="flex flex-col flex-1">
                  <div className="text-center mb-8">
                    <h3 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Risk Management</h3>
                    <p className="text-slate-500 dark:text-slate-400">Position sizing and risk modeling.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 flex-1">

                    {/* Left Column: Entry & SL */}
                    <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-6">
                      <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50 pb-2">Order Specifics</h4>

                      <div className="space-y-4">
                        <div>
                          <label htmlFor={`${modalId.current}-entry`} className="text-xs text-slate-500 uppercase font-bold mb-1 block">Entry Price</label>
                          <input id={`${modalId.current}-entry`} type="number" value={formData.entryPrice || ''} onChange={e => updateField('entryPrice', parseFloat(e.target.value))} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-slate-900 dark:text-white outline-none font-mono text-xl" placeholder="0.00" />
                        </div>

                        <div>
                          <label htmlFor={`${modalId.current}-sl`} className="text-xs text-rose-600 dark:text-rose-400 uppercase font-bold mb-1 block">Stop Loss</label>
                          <input id={`${modalId.current}-sl`} type="number" value={formData.stopLoss || ''} onChange={e => updateField('stopLoss', parseFloat(e.target.value))} className="w-full bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/50 rounded-lg p-4 text-slate-900 dark:text-white focus:border-rose-500 outline-none font-mono text-xl shadow-[0_0_15px_-5px_rgba(225,29,72,0.3)]" placeholder="0.00" />
                        </div>

                        <div>
                          <label htmlFor={`${modalId.current}-tp`} className="text-xs text-emerald-600 dark:text-emerald-400 uppercase font-bold mb-1 block">Take Profit (Target)</label>
                          <input id={`${modalId.current}-tp`} type="number" value={formData.takeProfit || ''} onChange={e => updateField('takeProfit', parseFloat(e.target.value))} className="w-full bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/50 rounded-lg p-4 text-slate-900 dark:text-white focus:border-emerald-500 outline-none font-mono text-xl shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]" placeholder="0.00" />
                        </div>
                      </div>
                    </div>

                    {/* Middle Column: Size & Exit */}
                    <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-6">
                      <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50 pb-2">Position & Exit</h4>

                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="col-span-2">
                            <label htmlFor={`${modalId.current}-exit`} className="text-xs text-slate-500 uppercase font-bold mb-1 block">Actual Exit Price</label>
                            <input id={`${modalId.current}-exit`} type="number" value={formData.exitPrice || ''} onChange={e => updateField('exitPrice', parseFloat(e.target.value))} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-slate-900 dark:text-white outline-none font-mono text-xl" placeholder="0.00" />
                          </div>
                          <div>
                            <label htmlFor={`${modalId.current}-qty`} className="text-xs text-slate-500 uppercase font-bold mb-1 block">Quantity</label>
                            <input id={`${modalId.current}-qty`} type="number" value={formData.quantity || ''} onChange={e => updateField('quantity', parseFloat(e.target.value))} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-slate-900 dark:text-white outline-none font-mono text-xl" placeholder="1" />
                          </div>
                          <div>
                            <label htmlFor={`${modalId.current}-fees`} className="text-xs text-slate-500 uppercase font-bold mb-1 block">Fees Paid</label>
                            <input id={`${modalId.current}-fees`} type="number" value={formData.fees || ''} onChange={e => updateField('fees', parseFloat(e.target.value))} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-slate-900 dark:text-white outline-none font-mono text-xl" placeholder="0.00" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Calculations */}
                    <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 flex flex-col space-y-6">
                      <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50 pb-2">Analysis Validation</h4>

                      {/* Live Auto-Calc Toggle & Margin Preview */}
                      <div className="bg-white dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-3 mt-auto">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] text-slate-500 uppercase font-bold block">Auto-Calc Charges & Margins</label>
                          <button
                            type="button"
                            onClick={() => setIsAutoCalcEnabled(!isAutoCalcEnabled)}
                            className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-colors ${
                              isAutoCalcEnabled 
                                ? 'bg-indigo-600 text-white shadow-md' 
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'
                            }`}
                          >
                            {isAutoCalcEnabled ? 'ON' : 'OFF'}
                          </button>
                        </div>
                        {isAutoCalcEnabled && requiredMargin !== null && (
                          <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-100 dark:border-slate-800 text-[11px] font-bold">
                            <span className="text-slate-500 uppercase tracking-wider">Required Margin:</span>
                            <span className="font-mono text-indigo-650 dark:text-indigo-400">
                              ₹{formatCurrencyPrecise(requiredMargin)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* P&L Forecast Preview */}
                      <div className="bg-white dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] text-slate-500 uppercase font-bold block">P&L Preview (Post-Fees)</label>
                          <span className="text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">Auto-Calculated</span>
                        </div>
                        <div className="flex flex-col gap-1 items-center justify-center py-2">
                          <div className={`text-4xl font-black font-mono tracking-tight ${Number(directNetPnL) >= 0 ? 'text-emerald-600 dark:text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.3)]' : 'text-rose-600 dark:text-rose-500 drop-shadow-[0_0_10px_rgba(244,63,94,0.3)]'}`}>
                            {Number(directNetPnL) >= 0 ? '+' : ''}₹{formatCurrencyPrecise(Number(directNetPnL))}
                          </div>
                          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                            Gross: ₹{formatCurrencyPrecise(Number(directGrossPnL))}
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                </motion.div>
              )}

              {/* STEP 4: EVIDENCE */}
              {step === 4 && (
                <motion.div key="step4" variants={variants} initial="enter" animate="center" exit="exit" className="flex flex-col flex-1">
                  <div className="text-center mb-8">
                    <h3 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Evidence Locker</h3>
                    <p className="text-slate-500 dark:text-slate-400">Advanced Metrics & Screenshots.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1">

                    {/* Left Column: Visual Evidence */}
                    <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 flex flex-col space-y-4">
                      <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50 pb-2">Visual Ledger</h4>
                      <div 
                        onClick={() => !isCompressing && fileInputRef.current?.click()} 
                        className={`flex-1 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all min-h-[300px] ${isCompressing ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-white dark:hover:bg-slate-900 shadow-inner shadow-slate-200 dark:shadow-slate-900/50'}`}
                        role="button"
                        aria-label="Upload chart screenshot"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (!isCompressing) fileInputRef.current?.click();
                          }
                        }}
                      >
                        <input type="file" ref={fileInputRef} id={`${modalId.current}-file`} className="hidden" accept="image/*" onChange={e => handleFileChange('HTF', e)} />
                        {previewUrl ? (
                          <img src={previewUrl} alt="Trade chart preview" className="w-full h-full object-contain rounded-xl p-2" />
                        ) : isCompressing ? (
                          <div className="flex flex-col items-center text-indigo-600 dark:text-indigo-400"><Loader2 className="animate-spin mb-2" size={48} aria-hidden="true" /><span className="font-bold tracking-widest text-sm uppercase">Compressing...</span></div>
                        ) : (
                          <>
                            <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-full mb-4 shadow-lg"><Upload className="text-slate-400" size={40} aria-hidden="true" /></div>
                            <p className="text-slate-700 dark:text-slate-300 font-bold text-lg mb-1">Upload Chart Screenshot</p>
                            <p className="text-slate-500 text-sm">Click or press Enter to browse files</p>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Metrics & Notes */}
                    <div className="flex flex-col gap-6">
                      <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-4">
                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50 pb-2">Trade Execution Metrics</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label htmlFor={`${modalId.current}-mae`} className="text-xs text-rose-600 dark:text-rose-400 uppercase font-bold mb-1 block">MAE (Max Pain)</label>
                            <input id={`${modalId.current}-mae`} type="number" value={formData.mae || ''} onChange={e => updateField('mae', parseFloat(e.target.value))} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-slate-900 dark:text-white outline-none font-mono text-lg" placeholder="Lowest price" />
                          </div>
                          <div>
                            <label htmlFor={`${modalId.current}-mfe`} className="text-xs text-emerald-600 dark:text-emerald-400 uppercase font-bold mb-1 block">MFE (Max Gain)</label>
                            <input id={`${modalId.current}-mfe`} type="number" value={formData.mfe || ''} onChange={e => updateField('mfe', parseFloat(e.target.value))} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-slate-900 dark:text-white outline-none font-mono text-lg" placeholder="Highest price" />
                          </div>
                        </div>
                      </div>

                      {/* Quant Greeks Entry Gate Checklist (P3.2) */}
                      <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-4">
                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50 pb-2 flex items-center justify-between">
                          <span>Quant Greeks Entry Gate</span>
                          {qcsResult && (
                            <span className="text-xs font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-lg">
                              QCS: {qcsResult.qcs}
                            </span>
                          )}
                        </h4>

                        {loadingGate ? (
                          <div className="flex items-center justify-center py-6 gap-2 text-xs text-slate-500">
                            <Loader2 className="animate-spin w-4 h-4 text-indigo-500" />
                            Evaluating institutional orderflow...
                          </div>
                        ) : entryGate ? (
                          <div className="space-y-3">
                            {/* Success / Warning Banners */}
                            {entryGate.approved ? (
                              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold rounded-xl">
                                Entry Confirmed — {entryGate.passedCount}/6 checks passed.
                              </div>
                            ) : (
                              <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold rounded-xl">
                                Only {entryGate.passedCount}/6 checks passed. Proceed with caution.
                              </div>
                            )}

                            {/* 6-check checklist */}
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              {Object.entries(entryGate.checks).map(([key, passed]) => {
                                const names: Record<string, string> = {
                                  gFactor: 'G-Factor (> 6.0)',
                                  convictionIndex: 'Conviction Index (> ±1.5)',
                                  gexRegime: 'GEX Regime (Negative)',
                                  gfiFlow: 'GFI Flow (> ±1.0)',
                                  mpgs: 'MPGS (> ±0.5σ)',
                                  ivSkewRank: 'IV Skew Rank (Bull <50, Bear >60)'
                                };
                                return (
                                  <div key={key} className="flex justify-between items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 ml-1 rounded-xl">
                                    <span className="text-slate-400 font-semibold truncate max-w-[130px]">{names[key] || key}</span>
                                    <span>{passed ? '✅' : '❌'}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-6 text-xs text-slate-500 italic">
                            Select a valid F&O stock and direction to run entry gate diagnostics.
                          </div>
                        )}
                      </div>

                      <div className="bg-slate-100/40 dark:bg-slate-800/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 flex-1 flex flex-col space-y-4">
                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50 pb-2">Journal Notes</h4>
                        <div className="flex-1 flex flex-col">
                          <label htmlFor={`${modalId.current}-notes`} className="sr-only">Journal Notes</label>
                          <textarea id={`${modalId.current}-notes`} value={formData.notes || ''} onChange={e => updateField('notes', e.target.value)} className="flex-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-slate-900 dark:text-white focus:border-indigo-500 outline-none resize-none custom-scrollbar text-sm leading-relaxed" placeholder="Trade rationale, execution details, overall thoughts..." />
                        </div>
                      </div>
                    </div>

                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-slate-950/80 flex justify-between z-20">
            <AccessibleButton 
              onClick={prevStep} 
              disabled={step === 1} 
              variant="ghost"
              className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all ${step === 1 ? 'opacity-0 pointer-events-none' : 'text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <ChevronLeft size={18} aria-hidden="true" /> Back
            </AccessibleButton>
            {step < 4 ? (
              <AccessibleButton 
                onClick={nextStep} 
                variant="primary"
                className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
              >
                Next <ChevronRight size={18} aria-hidden="true" />
              </AccessibleButton>
            ) : (
              <MotionButton
                onClick={handleSubmit}
                disabled={riskData.isViolation || isCompressing}
                loading={isSubmitting}
                variant={riskData.isViolation ? "secondary" : "primary"}
                icon={riskData.isViolation ? <AlertTriangle size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
                className={`px-8 py-3 rounded-xl font-bold flex items-center gap-2 ${riskData.isViolation ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'}`}
              >
                {riskData.isViolation ? 'Risk Error' : tradeToEdit ? 'Update Trade' : 'Log Trade'}
              </MotionButton>
            )}
          </div>
        </div>
      </FocusTrap>
    </div>
  );
};

export default AddTradeModal;
