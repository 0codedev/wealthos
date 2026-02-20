import { useState, useEffect, useRef } from 'react';
import { z } from 'zod';
import { db, Trade, Strategy } from '../database';
import { useSettingsStore } from '../store/settingsStore';
import { compressImage, getISTDateString } from '../utils/helpers';
import { useToast } from '../components/shared/ToastProvider';
import { getBrokerReviewStatusMeta, resolveTradeReviewStatus } from '../services/BrokerReviewWorkflowService';
import { useMasteryStore } from '../store/masteryStore';
import { triggerXP } from '../components/mastery/XPCelebration';
import { safeAsync } from '../utils/safeAsync';
import { newIdempotencyKey, checkAndStoreIdempotencyKey, clearIdempotencyKey } from '../utils/idempotency';

export const useTradeForm = (isOpen: boolean, onSave: () => void, onClose: () => void, tradeToEdit?: Trade | null) => {
    const { toast } = useToast();
    const { refreshMastery } = useMasteryStore();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState<Partial<Trade>>({
        direction: 'Long',
        date: getISTDateString(),
        entryTime: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        mistakes: [],
        quantity: 1,
        grade: 'B',
        fees: 0,
        mae: 0,
        mfe: 0,
        complianceScore: 0,
        assetClass: 'Equity',
        setupTags: [],
        stopLossMoved: false,
        scaledOut: false,
        timeInTrade: '',
        tiltScore: 0,
        forcedTrade: false,
        // Phase 20
        setupConvexityScore: 0,
        correlatedAssets: [],
        macroEvents: [],
        timeOfDay: '',
        // Step 2
        brokerProfile: 'Intraday Equity',
        trailingStopType: 'None',
        takeProfit1: undefined,
        takeProfit2: undefined,
        takeProfit3: undefined,
        // Step 3
        convictionLevel: 5,
        fomoLevel: 1,
        stressLevel: 1,
        physicalState: 'Rested',
        focusState: 'Hyper-Focused',
        // Step 4
        loomUrl: '',
        chartAnnotations: { htf: '', entry: '', exit: '' },
        // Step 5
        wouldTakeAgain: true,
        isTextbook: false,
        coreLesson: '',
        adjustedGrade: 'B',
        marketThesis: '',
        // TradeDiary Integration
        tradeOutcome: 'Full Win',
        satisfactionRating: 5,
        rulesFollowed: [],
    });

    // Strategy State
    const [strategies, setStrategies] = useState<Strategy[]>([]);
    const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
    const [checkedRules, setCheckedRules] = useState<boolean[]>([]);

    // Risk Management State
    const [totalCapital, setTotalCapital] = useState<string>('10000');
    const [strictMode, setStrictModeState] = useState<boolean>(() => {
        const saved = localStorage.getItem('wealth_journal_strict_mode');
        return saved ? saved === 'true' : false;
    });
    const setStrictMode = (val: boolean) => {
        setStrictModeState(val);
        localStorage.setItem('wealth_journal_strict_mode', val ? 'true' : 'false');
    };
    const [enableAdvancedScaling, setEnableAdvancedScaling] = useState<boolean>(false);
    const [riskData, setRiskData] = useState({ riskAmount: 0, percentRisk: 0, isViolation: false, rMultiple: 0 });
    const [previews, setPreviews] = useState<{ htf: string | null, entry: string | null, exit: string | null }>({ htf: null, entry: null, exit: null });
    const [compressingType, setCompressingType] = useState<'HTF' | 'Entry' | 'Exit' | null>(null);
    const [newMistake, setNewMistake] = useState('');

    // Direct P&L Entry State — local state so fields are editable (not just computed displays)
    const [directGrossPnL, setDirectGrossPnL] = useState('');
    const [directNetPnL, setDirectNetPnL] = useState('');
    const [requiredMargin, setRequiredMargin] = useState<number | null>(null);
    // Auto-calc is OPT-IN — off by default. User enables it via toggle when needed.
    const [isAutoCalcEnabled, setIsAutoCalcEnabled] = useState(false);
    // plInputMode = true means user is driving from P&L side → avoid circular sync
    const plInputModeRef = useRef(false);

    const riskPerTrade = useSettingsStore(state => state.riskPerTrade);
    const htfRef = useRef<HTMLInputElement>(null);
    const entryRef = useRef<HTMLInputElement>(null);
    const exitRef = useRef<HTMLInputElement>(null);



    // Save draft progress to localStorage for new trades
    useEffect(() => {
        if (isOpen && !tradeToEdit) {
            const cleanFormData = { ...formData };
            delete cleanFormData.screenshot;
            delete cleanFormData.screenshotHTF;
            delete cleanFormData.screenshotEntry;
            delete cleanFormData.screenshotExit;

            const draftData = {
                formData: cleanFormData,
                step,
                directGrossPnL,
                directNetPnL,
                strictMode,
                totalCapital
            };
            localStorage.setItem('execution_desk_draft', JSON.stringify(draftData));
        }
    }, [formData, step, directGrossPnL, directNetPnL, strictMode, totalCapital, isOpen, tradeToEdit]);

    // Edit / Reset effect
    useEffect(() => {
        if (isOpen && tradeToEdit) {
            setFormData(tradeToEdit);
            setIsAutoCalcEnabled(false); // Default to OFF for edits (manual-first)
            // Always restore displayed P&L from stored values (works for both imported and manual)
            if (tradeToEdit.pnl !== undefined) {
               const net = tradeToEdit.pnl;
               const fees = tradeToEdit.fees || 0;
               setDirectGrossPnL((net + fees).toFixed(2));
               setDirectNetPnL(net.toFixed(2));
            } else {
               setDirectGrossPnL('');
               setDirectNetPnL('');
            }
            setStep(1);
        } else if (isOpen && !tradeToEdit) {
            // Load Draft if it exists
            const savedDraft = localStorage.getItem('execution_desk_draft');
            if (savedDraft) {
                try {
                    const parsed = JSON.parse(savedDraft);
                    if (parsed.formData) setFormData(parsed.formData);
                    if (parsed.step) setStep(parsed.step);
                    if (parsed.directGrossPnL !== undefined) setDirectGrossPnL(parsed.directGrossPnL);
                    if (parsed.directNetPnL !== undefined) setDirectNetPnL(parsed.directNetPnL);
                    if (parsed.strictMode !== undefined) setStrictModeState(parsed.strictMode);
                    if (parsed.totalCapital !== undefined) setTotalCapital(parsed.totalCapital);
                    return; // Loaded successfully, exit init
                } catch (e) {
                    console.error("Failed to parse saved draft", e);
                }
            }

            // Reset for New Trade (Fallback)
            setFormData({
                direction: 'Long',
                date: getISTDateString(),
                entryTime: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                mistakes: [],
                quantity: 1,
                grade: 'B',
                fees: 0,
                mae: 0,
                mfe: 0,
                complianceScore: 0,
                assetClass: 'Equity',
                setupTags: [],
                stopLossMoved: false,
                scaledOut: false,
                timeInTrade: '',
                tiltScore: 0,
                forcedTrade: false,
                setupConvexityScore: 0,
                correlatedAssets: [],
                macroEvents: [],
                timeOfDay: '',
                brokerProfile: 'Intraday Equity',
                trailingStopType: 'None',
                takeProfit1: undefined,
                takeProfit2: undefined,
                takeProfit3: undefined,
                convictionLevel: 5,
                fomoLevel: 1,
                stressLevel: 1,
                physicalState: 'Rested',
                focusState: 'Hyper-Focused',
                loomUrl: '',
                chartAnnotations: { htf: '', entry: '', exit: '' },
                wouldTakeAgain: true,
                isTextbook: false,
                coreLesson: '',
                adjustedGrade: 'B',
                marketThesis: '',
                // TradeDiary Integration
                tradeOutcome: 'Full Win',
                satisfactionRating: 5,
                rulesFollowed: [],
            });
            setIsAutoCalcEnabled(false); // new trade: auto-calc is off by default too
            setDirectGrossPnL('');
            setDirectNetPnL('');
            setStep(1);
        }
    }, [isOpen, tradeToEdit]);

    // Differentiation Fix: Ensure productType is synced with brokerProfile on init/change
    useEffect(() => {
        if (formData.brokerProfile && !formData.productType) {
            let pType = 'CNC';
            if (formData.brokerProfile === 'Intraday Equity') pType = 'INTRADAY';
            else if (formData.brokerProfile === 'Delivery Equity') pType = 'CNC';
            else if (formData.brokerProfile === 'MTF / Margin') pType = 'MTF';
            else if (formData.brokerProfile === 'Futures' || formData.brokerProfile === 'Options') pType = 'MARGIN';
            setFormData(prev => ({ ...prev, productType: pType }));
        }
    }, [formData.brokerProfile, formData.productType]);

    // Load Strategies on Open
    useEffect(() => {
        if (isOpen) {
            db.strategies.toArray().then(setStrategies);
        }
    }, [isOpen]);

    // Handle Strategy Selection & Reset Checklist
    useEffect(() => {
        if (formData.setup) {
            const strat = strategies.find(s => s.name === formData.setup);
            if (strat) {
                setSelectedStrategy(strat);
                if (checkedRules.length !== strat.rules.length) {
                    setCheckedRules(new Array(strat.rules.length).fill(false));
                }
            } else {
                setSelectedStrategy(null);
                setCheckedRules([]);
            }
        }
    }, [formData.setup, strategies]);

    // Calculate Compliance Score and Tilt Score
    useEffect(() => {
        let compScore = 0;
        if (selectedStrategy && selectedStrategy.rules.length > 0) {
            const checkedCount = checkedRules.filter(Boolean).length;
            compScore = Math.round((checkedCount / selectedStrategy.rules.length) * 100);
        }

        let newTilt = 0;
        if (selectedStrategy && selectedStrategy.rules.length > 0) {
            newTilt += (100 - compScore) * 0.4; // Up to 40% tilt from rule breaking
        }
        if (formData.forcedTrade) newTilt += 30; // 30% tilt for forcing trades
        if (formData.stopLossMoved) newTilt += 30; // 30% tilt for moving hard stop loss

        // Calculate Convexity Score based on multiple confluence factors
        let convexity = 0;
        const totalTags = (formData.setupTags?.length || 0) + (formData.correlatedAssets?.length || 0) + (formData.macroEvents?.length || 0);

        if (compScore > 0) convexity += (compScore * 0.4); // Rules compliance = 40% max weight
        convexity += Math.min(40, (formData.setupTags?.length || 0) * 8); // Technical tags
        convexity += Math.min(10, (formData.correlatedAssets?.length || 0) * 5); // Correlated edge
        convexity += Math.min(10, (formData.macroEvents?.length || 0) * 5); // Macro alignment
        // Penalize slightly if forced or over-tilted
        if (formData.forcedTrade) convexity -= 20;

        setFormData(prev => ({
            ...prev,
            complianceScore: compScore,
            tiltScore: Math.min(100, Math.max(0, Math.round(newTilt))),
            setupConvexityScore: Math.min(100, Math.max(0, Math.round(convexity)))
        }));
    }, [checkedRules, selectedStrategy, formData.forcedTrade, formData.stopLossMoved, formData.setupTags, formData.correlatedAssets, formData.macroEvents]);

    // Preview URLs
    useEffect(() => {
        const makeUrl = (f: any) => f instanceof Blob ? URL.createObjectURL(f) : typeof f === 'string' ? f : null;
        setPreviews({
            htf: makeUrl(formData.screenshotHTF),
            entry: makeUrl(formData.screenshotEntry),
            exit: makeUrl(formData.screenshotExit)
        });

        return () => {
            // Ideally URL.revokeObjectURL for blobs if we really cared about memory here, but keeping it simple
        };
    }, [formData.screenshotHTF, formData.screenshotEntry, formData.screenshotExit]);

    useEffect(() => {
        const qty = formData.quantity || 1;
        const cap = parseFloat(totalCapital) || 0;
        const entry = formData.entryPrice || 0;
        const sl = formData.stopLoss || 0;
        const exit = formData.exitPrice || 0;

        let riskAmount = 0;
        let rMultiple = 0;

        const riskPerShare = Math.abs(entry - sl);
        
        // SCENARIO 1: We have Entry and Stop Loss (Standard Risk Definition)
        if (entry > 0 && sl > 0) {
            riskAmount = riskPerShare * qty;
            
            // If we have an exit, calculate final R
            if (exit > 0 || directGrossPnL !== '') {
                const pnlToUse = directGrossPnL !== '' ? parseFloat(directGrossPnL) : (formData.direction === 'Long' ? (exit - entry) : (entry - exit)) * qty;
                if (!isNaN(pnlToUse) && riskAmount > 0) {
                    rMultiple = pnlToUse / riskAmount;
                }
            }
        } 
        // SCENARIO 2: Fallback - use direct P&L for risk if planning is absent but capital is known
        else if (directGrossPnL !== '') {
            const gross = parseFloat(directGrossPnL);
            if (!isNaN(gross)) {
               // If sl is 0, we can't calculate R-multiple, but we can still show % risked if user provided it elsewhere
               // For now, keep it 0 to avoid fake data
            }
        }

        const percentRisk = cap > 0 ? (riskAmount / cap) * 100 : 0;
        const isViolation = strictMode && ((sl === 0 && entry > 0) || (percentRisk > riskPerTrade));

        setRiskData({ riskAmount, percentRisk, isViolation, rMultiple });
        
    }, [formData.entryPrice, formData.stopLoss, formData.quantity, formData.exitPrice, formData.direction, totalCapital, riskPerTrade, directGrossPnL, formData.pnl, formData.fees]);

    const updateField = (field: keyof Trade, value: any) => {
        // Fix #12: Break P/L input circular dependency when manually changing prices
        if (field === 'entryPrice' || field === 'exitPrice' || field === 'quantity' || field === 'direction') {
            plInputModeRef.current = false;
        }

        // Differentiation Fix: Sync productType with brokerProfile for correct filtering/saving
        if (field === 'brokerProfile') {
            let pType = 'CNC';
            if (value === 'Intraday Equity') pType = 'INTRADAY';
            else if (value === 'Delivery Equity') pType = 'CNC';
            else if (value === 'MTF / Margin') pType = 'MTF';
            else if (value === 'Intraday Options' || value === 'Intraday Futures') pType = 'INTRADAY';
            else if (value === 'Futures' || value === 'Options' || value === 'Positional Options') pType = 'MARGIN';
            
            // Suggest the product type but allow manual override in form
            setFormData(prev => ({ ...prev, [field]: value, productType: pType }));
            return;
        }

        if (field === 'productType') {
            setFormData(prev => ({ ...prev, productType: value }));
            return;
        }

        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // ── Automated Brokerage Profiler ──
    useEffect(() => {
        if (!isAutoCalcEnabled) return; // auto-calc is opt-in
        const { brokerProfile, entryPrice, exitPrice, quantity, ticker: symbol } = formData;
        if (!entryPrice || !quantity) return;

        const currentExit = exitPrice || entryPrice; // fallback to entry if trade open
        const turnover = (entryPrice * quantity) + (currentExit * quantity);
        let estimatedFees = 0;
        let isMounted = true;

        const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;

        async function fetchRealBrokerage() {
            try {
                if (!symbol) return;
                // Resolve symbol to key
                const resolveRes = await fetch(`/api/python-nse/api/upstox/instruments/resolve?symbol=${encodeURIComponent(symbol)}`);
                if (!resolveRes.ok) return;
                const resolved = await resolveRes.json();
                const key = resolved.instrument_key;
                if (!key) return;

                // Map brokerProfile to product/transaction_type
                const product = brokerProfile && brokerProfile.includes('Intraday') ? 'I' : 'D'; // I = Intraday, D = Delivery etc.
                const txType = formData.direction?.toUpperCase() === 'SHORT' ? 'SELL' : 'BUY';
                
                const url = `/api/python-nse/api/upstox/charges/brokerage?instrument_token=${encodeURIComponent(key)}&quantity=${quantity}&product=${product}&transaction_type=${txType}&price=${entryPrice}`;
                const res = await fetch(url);
                if (res.ok && isMounted) {
                    const data = await res.json();
                    if (data.status === 'success' && data.data && data.data.charges) {
                        const totalCharges = data.data.charges.total_charges || 0;
                        if (!plInputModeRef.current) {
                            setFormData(prev => ({ ...prev, fees: Number(totalCharges.toFixed(2)) }));
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to fetch live Upstox brokerage:", err);
            }
        }

        async function fetchRealMargin() {
            try {
                if (!symbol) return;
                // Resolve symbol to key
                const resolveRes = await fetch(`/api/python-nse/api/upstox/instruments/resolve?symbol=${encodeURIComponent(symbol)}`);
                if (!resolveRes.ok) return;
                const resolved = await resolveRes.json();
                const key = resolved.instrument_key;
                if (!key) return;

                const product = brokerProfile && brokerProfile.includes('Intraday') ? 'INTRADAY' : 'DELIVERY'; 
                const txType = formData.direction?.toUpperCase() === 'SHORT' ? 'SELL' : 'BUY';

                const url = `/api/python-nse/api/upstox/charges/margin`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orders: [{
                            instrument_token: key,
                            quantity: quantity,
                            product: product,
                            transaction_type: txType,
                            price: entryPrice
                        }]
                    })
                });
                if (res.ok && isMounted) {
                    const data = await res.json();
                    if (data.status === 'success' && data.data) {
                        const required = data.data.margin_required || 0;
                        setRequiredMargin(required);
                    }
                }
            } catch (err) {
                console.error("Failed to fetch live Upstox margin:", err);
            }
        }

        if (isUpstoxEnabled && symbol && brokerProfile && (brokerProfile.includes('Equity') || brokerProfile.includes('MTF') || brokerProfile.includes('Futures') || brokerProfile.includes('Options'))) {
            fetchRealBrokerage();
            fetchRealMargin();
        } else {
            switch (brokerProfile) {
                case 'Intraday Equity':
                    // Typical: 0.03% or Rs 20 whichever is lower per side + STT (0.025% on sell) + Misc
                    const intraBrokerage = Math.min(20, (entryPrice * quantity * 0.0003)) + Math.min(20, (currentExit * quantity * 0.0003));
                    const intraSTT = currentExit * quantity * 0.00025;
                    const intraMisc = turnover * 0.00005; // exchange tx + stamp
                    estimatedFees = intraBrokerage + intraSTT + intraMisc;
                    break;
                case 'Delivery Equity':
                    // Typical: 0 brokerage + STT (0.1% on buy AND sell) + Misc
                    const delSTT = turnover * 0.001;
                    const delMisc = turnover * 0.00005;
                    estimatedFees = delSTT + delMisc;
                    break;
                case 'Futures':
                    // Typical: Rs 20 per side + STT (0.0125% on sell) + Misc
                    const futBrokerage = 40;
                    const futSTT = currentExit * quantity * 0.000125;
                    estimatedFees = futBrokerage + futSTT;
                    break;
                case 'Options':
                    // Typical: Rs 20 per trade (per lot sizing abstracted here) + STT (0.0625% on sell premium)
                    const optBrokerage = 40;
                    const optSTT = currentExit * quantity * 0.000625;
                    estimatedFees = optBrokerage + optSTT;
                    break;
                case 'MTF / Margin':
                    // Typical: Brokerage + STT (0.1% on buy AND sell for physical delivery) + Misc
                    const mtfSTT = turnover * 0.001;
                    const mtfMisc = turnover * 0.00005;
                    estimatedFees = mtfSTT + mtfMisc;
                    break;
                default:
                    estimatedFees = 0;
            }

            // Add 18% GST on brokerage + exchange charges (simplified)
            estimatedFees = estimatedFees * 1.18;

            if (estimatedFees > 0 && !plInputModeRef.current) {
                setFormData(prev => ({ ...prev, fees: Number(estimatedFees.toFixed(2)) }));
            }
        }

        return () => { isMounted = false; };
    }, [formData.brokerProfile, formData.entryPrice, formData.exitPrice, formData.quantity, formData.ticker, formData.direction, isAutoCalcEnabled]);

    // ── Sync P&L display states AND formData.pnl (Single Source of Truth) ──
    useEffect(() => {
        if (plInputModeRef.current) return;
        
        const { entryPrice, exitPrice, quantity, fees, direction } = formData;
        
        // If we have enough data to calculate, we always update the display.
        // We ONLY update the actual formData.pnl if:
        // a) Auto-calc is enabled
        // b) We are in a "New Trade" flow where no P&L exists yet
        if (entryPrice && exitPrice && quantity) {
            const diff = direction === 'Long' ? exitPrice - entryPrice : entryPrice - exitPrice;
            const gross = diff * quantity;
            const net = Number((gross - (fees || 0)).toFixed(2));
            
            setDirectGrossPnL(gross.toFixed(2));
            setDirectNetPnL(net.toFixed(2));
            
            // ALWAYS update the persistence state when prices change, unless the user 
            // is actively typing into the P&L fields. This prevents the "Timeline List"
            // from showing stale data.
            if (formData.pnl !== net) {
                setFormData(prev => ({ ...prev, pnl: net }));
            }
        }
    }, [formData.entryPrice, formData.exitPrice, formData.quantity, formData.fees, formData.direction, isAutoCalcEnabled]);

    // ── Update formData.pnl when manual entries happen ──
    useEffect(() => {
        if (!plInputModeRef.current) return;
        
        const netValue = parseFloat(directNetPnL);
        if (!isNaN(netValue) && formData.pnl !== netValue) {
            setFormData(prev => ({ ...prev, pnl: netValue }));
        }
    }, [directNetPnL]);

    // ── Handle GROSS P&L direct entry ──
    const handleGrossPnLChange = (value: string) => {
        setDirectGrossPnL(value);
        const grossPnL = parseFloat(value);
        if (value === '' || isNaN(grossPnL)) {
            setDirectNetPnL('');
            return;
        }

        // Lock auto-sync
        plInputModeRef.current = true;

        const currentNet = parseFloat(directNetPnL);
        let fees = formData.fees || 0;
        
        // If Net exists, solve for fees. Otherwise, solve for net using existing fees.
        const netValue = !isNaN(currentNet) ? currentNet : (grossPnL - fees);
        if (isNaN(currentNet)) setDirectNetPnL(netValue.toFixed(2));

        // Update BOTH the persistence state and display
        setFormData(prev => ({ 
            ...prev, 
            pnl: Number(netValue.toFixed(2)),
            // Don't auto-reset fees unless necessary
        }));

        // Release lock after small delay to let state settle
        setTimeout(() => { plInputModeRef.current = false; }, 200);
    };

    // ── Handle NET P&L direct entry ──
    const handleNetPnLChange = (value: string) => {
        setDirectNetPnL(value);
        const netPnL = parseFloat(value);
        if (value === '' || isNaN(netPnL)) {
            setDirectGrossPnL('');
            return;
        }

        // Lock auto-sync
        plInputModeRef.current = true;

        const currentGross = parseFloat(directGrossPnL);
        let fees = formData.fees || 0;

        // Balance equation: if gross exists, solve for fees. Otherwise, use current fees to solve for gross.
        const grossValue = !isNaN(currentGross) ? currentGross : (netPnL + fees);
        if (isNaN(currentGross)) setDirectGrossPnL(grossValue.toFixed(2));

        setFormData(prev => ({ 
            ...prev, 
            pnl: Number(netPnL.toFixed(2)),
        }));

        // Release lock after state has settled
        setTimeout(() => { plInputModeRef.current = false; }, 200);
    };

    // ── When fees change: update Net P&L display (only when auto-calc enabled) ──
    useEffect(() => {
        if (!isAutoCalcEnabled) return;
        if (directGrossPnL !== '' && !plInputModeRef.current) {
            const gross = parseFloat(directGrossPnL);
            if (!isNaN(gross)) {
                setDirectNetPnL((gross - (formData.fees || 0)).toFixed(2));
            }
        }
    }, [formData.fees, isAutoCalcEnabled]);

    const toggleSetupTag = (tag: string) => {
        const current = formData.setupTags || [];
        const updated = current.includes(tag)
            ? current.filter(t => t !== tag)
            : [...current, tag];
        updateField('setupTags', updated);
    };

    const toggleCorrelatedAsset = (asset: string) => {
        const current = formData.correlatedAssets || [];
        const updated = current.includes(asset)
            ? current.filter(a => a !== asset)
            : [...current, asset];
        updateField('correlatedAssets', updated);
    };

    const toggleMacroEvent = (event: string) => {
        const current = formData.macroEvents || [];
        const updated = current.includes(event)
            ? current.filter(e => e !== event)
            : [...current, event];
        updateField('macroEvents', updated);
    };

    const toggleMistake = (tag: string) => {
        const current = formData.mistakes || [];
        const updated = current.includes(tag)
            ? current.filter(t => t !== tag)
            : [...current, tag];
        updateField('mistakes', updated);
    };

    const handleAddMistake = () => {
        if (newMistake.trim()) {
            const tag = newMistake.trim();
            toggleMistake(tag);
            setNewMistake('');
        }
    };

    const handleRuleToggle = (index: number) => {
        const updated = [...checkedRules];
        updated[index] = !updated[index];
        setCheckedRules(updated);
    };

    const handleFileChange = async (type: 'HTF' | 'Entry' | 'Exit', e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setCompressingType(type);
            try {
                const compressedBlob = await compressImage(file);
                updateField(`screenshot${type}` as keyof Trade, compressedBlob);
            } catch (err) {
                toast.error(`Failed to process ${type} image.`);
            } finally {
                setCompressingType(null);
            }
        }
    };

    const handleSubmit = async () => {
        if (isSubmitting) return; // Pillar 3A: double-submit guard
        if (!formData.ticker) {
            toast.error('Please enter a ticker symbol (Step 1).');
            return;
        }

        // Strict Mode Validations
        if (strictMode) {
            if (!formData.entryPrice) {
                toast.error('Please enter an Entry Price (Step 2).');
                return;
            }
            if (!formData.exitPrice) {
                toast.error('Please enter an Exit Price (Step 2).');
                return;
            }
            if (!formData.marketThesis || formData.marketThesis.trim().length < 10) {
                toast.error('Mercury Law Violation: Provide a market thesis (min 10 chars) before committing.');
                return;
            }
            if (riskData.isViolation) {
                toast.error('Fix risk violations before saving (Strict Mode is ON).');
                return;
            }
        }

        // Pillar 3A: idempotency key — 60s de-dup window in sessionStorage.
        // Same key + same scope => short-circuit, prevents double-mutation on
        // rapid clicks, React 18 strict-mode double-invoke, or network retries.
        const idemKey = newIdempotencyKey('add-trade');
        if (checkAndStoreIdempotencyKey('add-trade', idemKey)) {
            return;
        }
        setIsSubmitting(true);

        // Clear draft on successful submit
        localStorage.removeItem('execution_desk_draft');

        const tradeToSave = { ...formData, riskRewardRatio: riskData.rMultiple } as Trade;

        // Runtime Schema Validation (Audit Fix: Prevent DB Poisoning)
        const RuntimeTradeSchema = z.object({
            ticker: z.string().min(1, 'Ticker is required'),
            entryPrice: z.number().positive('Entry price must be a positive number').finite(),
            exitPrice: z.number().nonnegative('Exit price cannot be negative').finite().optional().nullable(),
            quantity: z.number().positive('Quantity must be positive').finite(),
            pnl: z.number().finite().optional().nullable(),
            fees: z.number().finite().optional().nullable(),
        }).passthrough();

        const validationResult = RuntimeTradeSchema.safeParse(tradeToSave);
        if (!validationResult.success) {
            const errorMessages = validationResult.error.issues.map((e: any) => e.message).join(', ');
            toast.error(`Validation Failed: ${errorMessages}`);
            clearIdempotencyKey('add-trade', idemKey);
            setIsSubmitting(false);
            return;
        }

        const resolvedReviewStatus = resolveTradeReviewStatus(tradeToSave);
        const tradeWithReviewState = { ...tradeToSave, reviewStatus: resolvedReviewStatus } as Trade;
        const reviewMeta = getBrokerReviewStatusMeta(resolvedReviewStatus);

        // Pillar 3A: wrap the Dexie write + side-effects in safeAsync for typed
        // error handling, premium dismissable toast on failure, and stack
        // preservation for telemetry.
        const saveResult = await safeAsync(async () => {
            // Edit Mode: Update existing
            if (tradeWithReviewState.id) {
                await db.trades.put(tradeWithReviewState);
                if (resolvedReviewStatus && resolvedReviewStatus !== 'ANNOTATED') {
                    toast.success(`Trade updated. Review lane now: ${reviewMeta.label}.`);
                } else {
                    toast.success('Trade updated successfully!');
                }
            } else {
                // New Mode: Add new
                await db.trades.add(tradeWithReviewState);
                if (resolvedReviewStatus === 'ANNOTATED' && tradeWithReviewState.isImported) {
                    toast.success('Imported trade logged and fully reviewed.');
                } else {
                    toast.success('Trade logged successfully!');
                }
            }
            // Refresh Mastery State & Celebrate
            refreshMastery();
            triggerXP(250);
        });

        if (saveResult.ok) {
            clearIdempotencyKey('add-trade', idemKey);
            onClose();
        } else {
            // safeAsync already showed the dismissable error toast with "Copy details".
            // Reset the idempotency key so the user can retry after fixing the issue.
            clearIdempotencyKey('add-trade', idemKey);
        }
        setIsSubmitting(false);
    };

    const clearDraft = () => {
        localStorage.removeItem('execution_desk_draft');
        setFormData({
            direction: 'Long',
            date: getISTDateString(),
            entryTime: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            mistakes: [],
            quantity: 1,
            grade: 'B',
            fees: 0,
            mae: 0,
            mfe: 0,
            complianceScore: 0,
            assetClass: 'Equity',
            setupTags: [],
            stopLossMoved: false,
            scaledOut: false,
            timeInTrade: '',
            tiltScore: 0,
            forcedTrade: false,
            setupConvexityScore: 0,
            correlatedAssets: [],
            macroEvents: [],
            timeOfDay: '',
            brokerProfile: 'Intraday Equity',
            trailingStopType: 'None',
            takeProfit1: undefined,
            takeProfit2: undefined,
            takeProfit3: undefined,
            convictionLevel: 5,
            fomoLevel: 1,
            stressLevel: 1,
            physicalState: 'Rested',
            focusState: 'Hyper-Focused',
            loomUrl: '',
            chartAnnotations: { htf: '', entry: '', exit: '' },
            wouldTakeAgain: true,
            isTextbook: false,
            coreLesson: '',
            adjustedGrade: 'B',
            marketThesis: '',
            tradeOutcome: 'Full Win',
            satisfactionRating: 5,
            rulesFollowed: [],
        });
        setIsAutoCalcEnabled(false);
        setDirectGrossPnL('');
        setDirectNetPnL('');
        setStep(1);
        toast.success("Draft progress cleared.");
    };

    const nextStep = () => setStep(s => Math.min(s + 1, 5));
    const prevStep = () => setStep(s => Math.max(s - 1, 1));
    const goToStep = (targetStep: number) => setStep(Math.max(1, Math.min(targetStep, 5)));

    return {
        step,
        formData,
        strategies,
        selectedStrategy,
        checkedRules,
        totalCapital,
        riskData,
        compressingType,
        previews,
        newMistake,
        directGrossPnL,
        directNetPnL,
        setNewMistake,
        setTotalCapital,
        updateField,
        toggleSetupTag,
        toggleMistake,
        toggleCorrelatedAsset,
        toggleMacroEvent,
        handleAddMistake,
        handleRuleToggle,
        handleFileChange,
        handleSubmit,
        isSubmitting, // Pillar 3A: exposed for <MotionButton loading={isSubmitting}>
        nextStep,
        prevStep,
        goToStep,
        htfRef,
        entryRef,
        exitRef,
        handleGrossPnLChange,
        handleNetPnLChange,
        isAutoCalcEnabled,
        setIsAutoCalcEnabled,
        strictMode,
        setStrictMode,
        enableAdvancedScaling,
        setEnableAdvancedScaling,
        clearDraft,
        requiredMargin
    };
};
