
import React, { useState, useRef, useEffect } from 'react';
import { X, Camera, Loader2, Upload, Repeat, Calendar, Tag, Globe, Briefcase, Eye, EyeOff, Save, ScanLine, ImagePlus, Database, Edit2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { modalOverlayVariants, modalContentVariants } from './ui/animations';
import { Investment, InvestmentType, RecurringFrequency } from '../types';
import * as AIService from '../services/aiService';
import { useFamily } from '../contexts/FamilyContext';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { AccessibleButton, FocusTrap, VisuallyHidden } from './shared/AccessibleComponents';
import { MotionButton } from './ui/MotionButton';
import { safeAsync } from '../utils/safeAsync';
import { newIdempotencyKey, checkAndStoreIdempotencyKey, clearIdempotencyKey } from '../utils/idempotency';

interface AddInvestmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (investment: Omit<Investment, 'id'>, id?: string) => void;
  editingInvestment?: Investment | null;
}

const AddInvestmentModal: React.FC<AddInvestmentModalProps> = ({ isOpen, onClose, onSave, editingInvestment }) => {
  const { activeEntity } = useFamily();
  const isEditMode = !!editingInvestment && editingInvestment.id !== 'prefill';
  const modalId = useRef(`modal-${Math.random().toString(36).substr(2, 9)}`);

  // Basic Info
  const [name, setName] = useState('');
  const [type, setType] = useState<InvestmentType>(InvestmentType.MUTUAL_FUND);
  const [platform, setPlatform] = useState('');
  const [investedAmount, setInvestedAmount] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [dateInvested, setDateInvested] = useState(new Date().toISOString().split('T')[0]);

  // Advanced / Metadata
  const [sector, setSector] = useState('');
  const [country, setCountry] = useState('India');
  const [tagsInput, setTagsInput] = useState('');
  const [dhanSecurityId, setDhanSecurityId] = useState('');

  // Config
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<RecurringFrequency>(RecurringFrequency.MONTHLY);
  const [recurringAmount, setRecurringAmount] = useState('');
  const [sipDay, setSipDay] = useState(5);
  const [sipStartDate, setSipStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [isHiddenFromTotals, setIsHiddenFromTotals] = useState(false);

  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // Pillar 3A
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setName('');
    setType(InvestmentType.MUTUAL_FUND);
    setPlatform('');
    setInvestedAmount('');
    setCurrentValue('');
    setDateInvested(new Date().toISOString().split('T')[0]);
    setIsRecurring(false);
    setRecurringFrequency(RecurringFrequency.MONTHLY);
    setRecurringAmount('');
    setSipDay(5);
    setSipStartDate(new Date().toISOString().split('T')[0]);
    setSector('');
    setCountry('India');
    setTagsInput('');
    setDhanSecurityId('');
    setIsHiddenFromTotals(false);
    setError('');
  };

  useEffect(() => {
    if (editingInvestment) {
      setName(editingInvestment.name);
      setType(editingInvestment.type);
      setPlatform(editingInvestment.platform);
      setInvestedAmount(String(editingInvestment.investedAmount));
      setCurrentValue(String(editingInvestment.currentValue));
      setDateInvested(editingInvestment.lastUpdated.split('T')[0]);
      setSector(editingInvestment.sector || '');
      setCountry(editingInvestment.country || 'India');
      setTagsInput(editingInvestment.tags ? editingInvestment.tags.join(', ') : '');
      setDhanSecurityId(editingInvestment.dhanSecurityId || '');
      setIsHiddenFromTotals(editingInvestment.isHiddenFromTotals || false);

      if (editingInvestment.recurring && editingInvestment.recurring.isEnabled) {
        setIsRecurring(true);
        setRecurringFrequency(editingInvestment.recurring.frequency);
        setRecurringAmount(String(editingInvestment.recurring.amount));
        setSipDay(editingInvestment.recurring.sipDay || 5);
        setSipStartDate(editingInvestment.recurring.startDate || editingInvestment.lastUpdated.split('T')[0]);
      } else {
        setIsRecurring(false);
        setRecurringFrequency(RecurringFrequency.MONTHLY);
        setRecurringAmount('');
        setSipDay(5);
        setSipStartDate(new Date().toISOString().split('T')[0]);
      }
    } else {
      resetForm();
    }
  }, [editingInvestment, isOpen]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting) return; // Pillar 3A: double-submit guard

    // SPRINT 3.8: field-specific validation with precise, actionable errors
    // (the old single generic message made users hunt for the bad field).
    const missing: string[] = [];
    if (!name.trim()) missing.push('Name');
    if (!platform.trim()) missing.push('Platform');
    if (!investedAmount.trim()) missing.push('Invested Amount');
    if (!currentValue.trim()) missing.push('Current Value');
    if (missing.length > 0) {
      setError(`Please fill in: ${missing.join(', ')}.`);
      return;
    }
    const investedNum = Number(investedAmount);
    const currentNum = Number(currentValue);
    if (Number.isNaN(investedNum)) { setError(`Invested Amount "${investedAmount}" is not a valid number. Use digits only, e.g. 50000.`); return; }
    if (Number.isNaN(currentNum)) { setError(`Current Value "${currentValue}" is not a valid number. Use digits only, e.g. 62500.`); return; }
    if (investedNum < 0) { setError('Invested Amount cannot be negative.'); return; }
    if (currentNum < 0) { setError('Current Value cannot be negative.'); return; }
    const sipNum = recurringAmount.trim() ? Number(recurringAmount) : NaN;
    if (!Number.isNaN(sipNum) && sipNum <= 0) { setError('SIP amount must be a positive number.'); return; }

    // Pillar 3A: idempotency key — 60s de-dup window in sessionStorage
    const idemKey = newIdempotencyKey('add-investment');
    if (checkAndStoreIdempotencyKey('add-investment', idemKey)) {
      return;
    }
    setIsSubmitting(true);
    setError('');

    const investmentOwner = editingInvestment?.owner || (activeEntity === 'ALL' ? 'SELF' : activeEntity);

    const investmentData: Omit<Investment, 'id'> = {
      name,
      type,
      platform,
      investedAmount: parseFloat(investedAmount),
      currentValue: parseFloat(currentValue),
      lastUpdated: new Date(dateInvested).toISOString(),
      sector: sector || undefined,
      country: country || undefined,
      tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
      dhanSecurityId: dhanSecurityId || undefined,
      isHiddenFromTotals,
      owner: investmentOwner as Investment['owner'],
      recurring: isRecurring ? {
        isEnabled: true,
        frequency: recurringFrequency,
        amount: parseFloat(recurringAmount) || 0,
        sipDay: sipDay,
        startDate: sipStartDate,
        installmentsApplied: editingInvestment?.recurring?.installmentsApplied || 0
      } : undefined
    };

    // Pillar 3A: wrap the parent onSave callback in safeAsync for typed
    // error handling, premium dismissable toast on failure, and stack
    // preservation for telemetry.
    const result = await safeAsync(async () => {
      onSave(investmentData, editingInvestment?.id);
    });

    if (result.ok) {
      clearIdempotencyKey('add-investment', idemKey);
      if (!editingInvestment) resetForm();
      onClose();
    } else {
      // safeAsync already showed the dismissable error toast with "Copy details".
      // Reset the idempotency key so the user can retry after fixing the issue.
      clearIdempotencyKey('add-investment', idemKey);
    }
    setIsSubmitting(false);
  };

  const handleFile = async (file: File) => {
    setIsScanning(true);
    setError('');

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        const prompt = `Analyze this financial screenshot... Return ONLY JSON with keys: name, platform, investedAmount, currentValue, date, sector, type.`;
        try {
          const response = await AIService.analyzeImage(base64String, prompt);
          const cleanJson = response.replace(/```json|```/g, '').trim();
          const data = JSON.parse(cleanJson);
          if (data.name) setName(data.name);
          if (data.platform) setPlatform(data.platform);
          if (data.investedAmount) setInvestedAmount(String(data.investedAmount));
          if (data.currentValue) setCurrentValue(String(data.currentValue));
          if (data.date) setDateInvested(data.date);
          if (data.sector) setSector(data.sector);
          if (data.type) {
            const validTypes = Object.values(InvestmentType);
            if (validTypes.includes(data.type)) setType(data.type);
          }
        } catch (err) {
          console.error(err);
          setError("Could not extract data. Please enter manually.");
        } finally {
          setIsScanning(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setIsScanning(false);
      setError("Error reading file");
    }
  };

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
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const modalKeyboardRef = useModalKeyboard({
    isOpen,
    onClose
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <div ref={modalKeyboardRef} className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-auto" role="dialog" aria-modal="true" aria-labelledby={`${modalId.current}-title`}>
          <motion.div
            variants={modalOverlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute inset-0 bg-slate-900/40 dark:bg-slate-900/60"
            onClick={onClose}
          />

          <FocusTrap isActive={isOpen}>
            <motion.div
              variants={modalContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden relative z-10 flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="flex justify-between items-center px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <div>
                  <h2 id={`${modalId.current}-title`} className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    {isEditMode ? <Edit2 size={20} className="text-indigo-600 dark:text-indigo-400" /> : <ScanLine size={20} className="text-indigo-600 dark:text-indigo-400" />}
                    {isEditMode ? 'Edit Asset' : 'Add Asset'}
                  </h2>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Manual entry or AI Screenshot Scan</p>
                </div>
                <AccessibleButton 
                  onClick={onClose} 
                  variant="ghost"
                  aria-label="Close modal"
                  className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  <X size={18} />
                </AccessibleButton>
              </div>

              <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12">
                {/* Left Column: Smart Scan & Quick Figures */}
                <div className="md:col-span-4 bg-slate-50 dark:bg-slate-900/30 p-4 space-y-4 border-r border-slate-200 dark:border-slate-800 overflow-y-auto">

                  {/* Dropzone Scanner */}
                  <div
                    className={`relative group rounded-xl border-2 border-dashed transition-all duration-300 ${dragActive ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-300 dark:border-slate-700 hover:border-indigo-500/50 hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
                    onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
                    onPaste={(e) => {
                      const items = e.clipboardData.items;
                      for (let i = 0; i < items.length; i++) {
                        if (items[i].type.indexOf("image") !== -1) {
                          const blob = items[i].getAsFile();
                          if (blob) handleFile(blob);
                        }
                      }
                    }}
                  >
                    <input type="file" ref={fileInputRef} id={`${modalId.current}-file-input`} className="hidden" accept="image/*" onChange={handleFileChange} />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isScanning}
                      aria-label="Upload or drop screenshot for AI scanning"
                      className="w-full flex flex-col items-center justify-center gap-2 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
                    >
                      {isScanning ? (
                        <>
                          <Loader2 size={24} className="animate-spin text-indigo-600 dark:text-indigo-500" />
                          <p className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 animate-pulse">Analyzing...</p>
                        </>
                      ) : (
                        <>
                          <div className={`p-2 rounded-full bg-slate-100 dark:bg-slate-800 group-hover:bg-indigo-500/20 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors`}>
                            <ImagePlus size={20} />
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-200">Drop Screenshot</p>
                            <p className="text-[9px] text-slate-500 mt-0.5">or <span className="text-indigo-600 dark:text-indigo-400 hover:underline">Browse</span></p>
                          </div>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Core Numbers */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-inner space-y-3">
                    <div>
                      <label htmlFor={`${modalId.current}-invested`} className="block text-[9px] uppercase tracking-wider font-bold text-slate-500 mb-1">Invested Amount</label>
                      <div className="relative group">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 font-bold text-sm" aria-hidden="true">₹</span>
                        <input
                          id={`${modalId.current}-invested`}
                          type="number"
                          value={investedAmount}
                          onChange={(e) => setInvestedAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full pl-7 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-base font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor={`${modalId.current}-current`} className="block text-[9px] uppercase tracking-wider font-bold text-slate-500 mb-1">Current Value</label>
                      <div className="relative group">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 font-bold text-sm" aria-hidden="true">₹</span>
                        <input
                          id={`${modalId.current}-current`}
                          type="number"
                          value={currentValue}
                          onChange={(e) => setCurrentValue(e.target.value)}
                          placeholder="0.00"
                          className="w-full pl-7 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Private Asset Toggle */}
                  <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg ${isHiddenFromTotals ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                        {isHiddenFromTotals ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">Private Asset</p>
                        <p className="text-[9px] text-slate-500">Hide from Net Worth</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" id={`${modalId.current}-private-toggle`} checked={isHiddenFromTotals} onChange={(e) => setIsHiddenFromTotals(e.target.checked)} className="sr-only peer" />
                      <div className="w-8 h-4 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 dark:after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-white"></div>
                      <VisuallyHidden>Toggle Private Asset Status</VisuallyHidden>
                    </label>
                  </div>
                </div>

                {/* Right Column: Details Form */}
                <div className="md:col-span-8 p-4 overflow-y-auto max-h-[60vh] md:max-h-full scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-transparent">
                  <div className="space-y-4">
                    {/* Primary Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="group">
                        <label htmlFor={`${modalId.current}-name`} className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-tight">Asset Name</label>
                        <input id={`${modalId.current}-name`} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nifty 50 Index Fund" className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all" />
                      </div>
                      <div className="group">
                        <label htmlFor={`${modalId.current}-platform`} className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-tight">Platform / Broker</label>
                        <input id={`${modalId.current}-platform`} type="text" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="e.g. Zerodha" className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="group">
                        <label htmlFor={`${modalId.current}-type`} className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-tight">Category</label>
                        <div className="relative">
                          <select id={`${modalId.current}-type`} value={type} onChange={(e) => setType(e.target.value as InvestmentType)} className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white appearance-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all cursor-pointer">
                            {Object.values(InvestmentType).map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 dark:text-slate-500 text-[10px]" aria-hidden="true">▼</div>
                        </div>
                      </div>
                      <div className="group">
                        <label htmlFor={`${modalId.current}-date`} className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-tight">Date Invested</label>
                        <input id={`${modalId.current}-date`} type="date" value={dateInvested} onChange={(e) => setDateInvested(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all" />
                      </div>
                    </div>

                    {/* Metadata Section */}
                    <div className="pt-2">
                      <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
                        Metadata
                        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="group">
                          <label htmlFor={`${modalId.current}-sector`} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1"><Briefcase size={10} aria-hidden="true" /> Sector</label>
                          <input id={`${modalId.current}-sector`} type="text" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Tech" className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-white focus:border-indigo-500 outline-none transition-all" />
                        </div>
                        <div className="group">
                          <label htmlFor={`${modalId.current}-country`} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1"><Globe size={10} aria-hidden="true" /> Country</label>
                          <input id={`${modalId.current}-country`} type="text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="India" className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-white focus:border-indigo-500 outline-none transition-all" />
                        </div>
                        <div className="group">
                          <label htmlFor={`${modalId.current}-tags`} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1"><Tag size={10} aria-hidden="true" /> Tags</label>
                          <input id={`${modalId.current}-tags`} type="text" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="Long Term" className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-white focus:border-indigo-500 outline-none transition-all" />
                        </div>
                        <div className="group">
                          <label htmlFor={`${modalId.current}-dhan-id`} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1"><Database size={10} aria-hidden="true" /> Dhan ID</label>
                          <input id={`${modalId.current}-dhan-id`} type="text" value={dhanSecurityId} onChange={(e) => setDhanSecurityId(e.target.value)} placeholder="11532" className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-white focus:border-indigo-500 outline-none transition-all" />
                        </div>
                      </div>
                    </div>

                    {/* Recurring / SIP Section */}
                    <div className={`border rounded-xl transition-all duration-300 ${isRecurring ? 'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-500/30' : 'bg-transparent border-slate-200 dark:border-slate-800'}`}>
                      <button
                        type="button"
                        aria-expanded={isRecurring}
                        aria-label={isRecurring ? 'Collapse recurring investment section' : 'Expand recurring investment section'}
                        className="flex items-center justify-between w-full p-3 cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
                        onClick={() => setIsRecurring(!isRecurring)}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg ${isRecurring ? 'bg-indigo-600 dark:bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                            <Repeat size={14} aria-hidden="true" />
                          </div>
                          <p className={`text-xs font-bold ${isRecurring ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}>Recurring SIP</p>
                        </div>
                        {isRecurring && <span className="text-[8px] font-black tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-500/20 uppercase tracking-wider">Active</span>}
                      </button>

                      {isRecurring && (
                        <div className="p-3 pt-0 grid grid-cols-2 md:grid-cols-4 gap-3 animate-in slide-in-from-top-1">
                          <div>
                            <label htmlFor={`${modalId.current}-sip-freq`} className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-tight">Freq</label>
                            <select id={`${modalId.current}-sip-freq`} value={recurringFrequency} onChange={(e) => setRecurringFrequency(e.target.value as RecurringFrequency)} className="w-full px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none">
                              <option value={RecurringFrequency.MONTHLY}>Monthly</option>
                              <option value={RecurringFrequency.DAILY}>Daily</option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`${modalId.current}-sip-amt`} className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-tight">Amt</label>
                            <input id={`${modalId.current}-sip-amt`} type="number" value={recurringAmount} onChange={(e) => setRecurringAmount(e.target.value)} placeholder="5000" className="w-full px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none" />
                          </div>
                          {recurringFrequency === RecurringFrequency.MONTHLY && (
                            <>
                              <div>
                                <label htmlFor={`${modalId.current}-sip-day`} className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-tight">Day</label>
                                <select id={`${modalId.current}-sip-day`} value={sipDay} onChange={(e) => setSipDay(parseInt(e.target.value))} className="w-full px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none">
                                  {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                    <option key={day} value={day}>{day}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label htmlFor={`${modalId.current}-sip-start`} className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-tight">Start</label>
                                <input id={`${modalId.current}-sip-start`} type="date" value={sipStartDate} onChange={(e) => setSipStartDate(e.target.value)} className="w-full px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none" />
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3 z-20">
                <AccessibleButton onClick={onClose} variant="secondary" className="px-4 py-2 rounded-lg text-sm font-medium">
                  Cancel
                </AccessibleButton>
                <MotionButton
                  onClick={handleSubmit}
                  loading={isSubmitting}
                  disabled={isScanning}
                  variant="primary"
                  icon={<Save size={16} aria-hidden="true" />}
                  className="px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/20"
                >
                  {isEditMode ? 'Update Asset' : 'Save Asset'}
                </MotionButton>
              </div>

              {error && (
                <div 
                  role="alert"
                  className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-rose-600/95 backdrop-blur-sm text-white px-4 py-2 rounded-lg text-sm font-bold shadow-xl animate-in slide-in-from-bottom-2 z-50"
                >
                  {error}
                </div>
              )}
            </motion.div>
          </FocusTrap>
        </div>
      )}
    </AnimatePresence>
  );
};

export default AddInvestmentModal;

const Edit2Icon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-edit-2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
)
