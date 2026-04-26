import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { Investment, InvestmentType } from '../../types';
import {
    ShieldCheck, CalendarClock, TrendingDown, Coins, Lock,
    AlertTriangle, ArrowRight, IndianRupee, Info, CheckCircle2,
    PieChart as PieChartIcon, RefreshCw, Calculator, Scissors, Banknote,
    ChevronLeft, ChevronRight, Gavel, Percent, Skull
} from 'lucide-react';
import {
    PieChart, Pie, Cell, Tooltip
} from 'recharts';
import { CustomTooltip } from '../shared/CustomTooltip';
import { formatCurrency, getISTDate, calculateDaysDiff, calculateDaysHeld } from '../../utils/helpers';
import DividendTracker from '../DividendTracker';
import { useFiscalYear } from '../../hooks/useFiscalYear';
import { db, Trade } from '../../database';
import { motion, AnimatePresence } from 'framer-motion';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useFamily } from '../../contexts/FamilyContext';
import { selectInvestmentsForEntity } from '../../lib/domain/portfolio';
import { useShallow } from 'zustand/react/shallow';
import AuditLog from '../AuditLog';
import { ITRPreFillPanel } from '../compliance/ITRPreFillPanel';
import { CircularProgress, TaxCalculator, WashSaleDetector } from '../../components/compliance';
import { TaxHarvestingPanel } from '../tax/TaxHarvestingPanel';
import TabHero from '../shared/TabHero';
import { StateSurface } from '../shared/SurfacePrimitives';

interface ComplianceShieldProps {}

const LTCG_LIMIT = 125000; // New ₹1.25L Limit for FY 24-25
const TAX_RATE = 0.125; // 12.5% LTCG Rate

const ComplianceShield: React.FC<ComplianceShieldProps> = () => {
    // Use Fiscal Engine
    const { startDate, endDate, label, prevYear, nextYear, offset } = useFiscalYear();

    // Active sub-tab state
    const [activeTab, setActiveTab] = useState<'ITR' | 'OPTIMIZER'>('ITR');

    // Zustand store slicing
    const { activeEntity } = useFamily();
    const allInvestments = usePortfolioStore(useShallow(s => s.investments));
    const investments = useMemo(() => selectInvestmentsForEntity(allInvestments, activeEntity), [allInvestments, activeEntity]);

    // State for realized gain tracking (Now DB backed)
    const [realizedLTCG, setRealizedLTCG] = useState(0);
    const [isEditingTax, setIsEditingTax] = useState(false);
    const [tempTaxVal, setTempTaxVal] = useState('');

    // Wash Sale State
    const [washSaleWarnings, setWashSaleWarnings] = useState<{ ticker: string, lossDate: string, lossAmount: number }[]>([]);

    // Load Tax Record from DB when FY changes
    useEffect(() => {
        const loadTaxRecord = async () => {
            try {
                const record = await db.tax_records.where('fy').equals(label).first();
                if (record) {
                    setRealizedLTCG(record.realizedLTCG);
                    setTempTaxVal(record.realizedLTCG.toString());
                } else {
                    setRealizedLTCG(0);
                    setTempTaxVal('');
                }
            } catch (e) {
                console.error("Failed to load tax record", e);
            }
        };
        loadTaxRecord();
    }, [label]);

    // Wash Sale Detection Logic
    useEffect(() => {
        const detectWashSales = async () => {
            try {
                const trades = await db.trades.toArray();
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                const warnings: { ticker: string, lossDate: string, lossAmount: number }[] = [];

                // 1. Find recent losses
                const recentLosses = (trades || []).filter(t => (t.pnl || 0) < 0 && new Date(t.date) >= thirtyDaysAgo);

                // 2. Check if we currently hold them
                recentLosses.forEach(lossTrade => {
                    if (!lossTrade?.ticker) return;
                    const isHolding = (investments || []).some(inv =>
                        (inv.name || '').toUpperCase().includes(lossTrade.ticker.toUpperCase()) ||
                        lossTrade.ticker.toUpperCase().includes((inv.name || '').toUpperCase())
                    );

                    if (isHolding) {
                        warnings.push({
                            ticker: lossTrade.ticker,
                            lossDate: lossTrade.date,
                            lossAmount: Math.abs(lossTrade.pnl || 0)
                        });
                    }
                });
                setWashSaleWarnings(warnings);
            } catch (err) {
                console.error('[ComplianceShield] Error detecting wash sales:', err);
            }
        };
        detectWashSales();
    }, [investments]);

    const saveTax = async () => {
        const val = parseFloat(tempTaxVal) || 0;
        setRealizedLTCG(val);
        setIsEditingTax(false);

        try {
            const existing = await db.tax_records.where('fy').equals(label).first();
            if (existing) {
                await db.tax_records.update(existing.id!, {
                    realizedLTCG: val,
                    lastUpdated: new Date().toISOString()
                });
            } else {
                await db.tax_records.add({
                    fy: label,
                    realizedLTCG: val,
                    realizedSTCG: 0,
                    lastUpdated: new Date().toISOString()
                });
            }
        } catch (e) {
            console.error("Failed to save tax record", e);
        }
    };

    // Logic: Dates & FY (IST-aware for tax compliance)
    const today = getISTDate();
    const daysToDeadline = calculateDaysDiff(today, endDate);

    // Logic: Harvesting Candidates & Action Card
    const taxableExcess = Math.max(0, realizedLTCG - LTCG_LIMIT);
    const estimatedTaxLiability = taxableExcess * TAX_RATE;

    const harvestAction = useMemo(() => {
        // Find assets with unrealized losses
        const losers = investments
            .filter(inv => (inv.currentValue - inv.investedAmount) < -500) // Minimum loss threshold
            .map(inv => {
                const totalLoss = Math.abs(inv.currentValue - inv.investedAmount);
                const lossPct = (totalLoss / inv.investedAmount);

                let targetLossToBook = taxableExcess > 0 ? taxableExcess : totalLoss;
                targetLossToBook = Math.min(targetLossToBook, totalLoss);

                const sellRatio = targetLossToBook / totalLoss;
                const sellValue = inv.currentValue * sellRatio;
                const taxSaved = targetLossToBook * TAX_RATE;

                return {
                    ...inv,
                    totalLoss,
                    targetLossToBook,
                    sellValue,
                    taxSaved,
                    isFullExit: sellRatio > 0.99
                };
            })
            .sort((a, b) => b.taxSaved - a.taxSaved);

        // Find a "Pair" (Gain to offset)
        const winner = investments
            .filter(inv => (inv.currentValue - inv.investedAmount) > 1000)
            .sort((a, b) => (b.currentValue - b.investedAmount) - (a.currentValue - a.investedAmount))[0];

        return losers.length > 0 ? { ...losers[0], pair: winner } : null;
    }, [investments, taxableExcess]);

    // Logic: STT Eater (The Government's Share)
    const sttStats = useMemo(() => {
        const totalPortfolioValue = investments.reduce((acc, curr) => acc + curr.currentValue, 0);
        const totalUnrealizedProfit = investments.reduce((acc, curr) => acc + (curr.currentValue - curr.investedAmount), 0);

        // Assumptions for Liquidation Scenario
        const estimatedSTT = totalPortfolioValue * 0.001; // 0.1% STT on Delivery Sell
        const estimatedExchCharges = totalPortfolioValue * 0.0005; // ~0.05% Exchange + Stamp + GST
        // Rough Tax Estimate (Assuming mixed bag, flat 12.5% on profits > 1L)
        const taxableProfit = Math.max(0, totalUnrealizedProfit - 100000);
        const estimatedTax = taxableProfit * 0.125;

        const govtShare = estimatedSTT + estimatedExchCharges + estimatedTax;
        const netProfit = Math.max(0, totalUnrealizedProfit - govtShare);

        return {
            totalUnrealizedProfit,
            govtShare,
            netProfit,
            breakdown: [
                { name: 'Your Profit', value: netProfit, color: '#10b981' },
                { name: 'Govt Share', value: govtShare, color: '#f43f5e' }
            ]
        };
    }, [investments]);

    // Logic: Holding Periods (Using centralized IST-aware utility)
    // calculateDaysHeld is now imported from helpers

    const equityAssets = investments.filter(i =>
        [InvestmentType.STOCKS, InvestmentType.MUTUAL_FUND, InvestmentType.ETF, InvestmentType.SMALLCASE].includes(i.type)
    );

    const bullionAssets = investments.filter(i =>
        [InvestmentType.DIGITAL_GOLD, InvestmentType.DIGITAL_SILVER].includes(i.type)
    );

    return (
        <div className="space-y-6 animate-in fade-in duration-300 pb-20 md:pb-0">

            <TabHero
                eyebrow="Tax & Rules"
                title="Compliance Shield"
                description="Tax harvesting, holding-period intelligence, and regulatory guardrails organized into one guided control surface."
                icon={ShieldCheck}
                iconTone="text-emerald-500"
                gradientClassName="from-emerald-50 via-white to-indigo-50 dark:from-emerald-950/20 dark:via-slate-950 dark:to-indigo-950/20"
                chips={['Tax harvesting', 'Rule engine', label]}
                actions={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="inline-flex min-h-[38px] items-center gap-1 rounded-full border border-slate-200 bg-white/85 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900/80">
                            <button onClick={prevYear} aria-label="Previous year" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-900 dark:hover:text-white"><ChevronLeft size={11} /></button>
                            <span className="px-2 font-mono text-[11px] font-bold text-indigo-500 dark:text-indigo-300">{label}</span>
                            <button onClick={nextYear} disabled={offset >= 0} className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${offset >= 0 ? 'cursor-not-allowed text-slate-300 dark:text-slate-700' : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}><ChevronRight size={11} /></button>
                        </div>
                        <div className="flex min-h-[38px] items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900/80">
                            <div className="rounded-full bg-indigo-100 p-1.5 text-indigo-500 dark:bg-indigo-500/20 dark:text-indigo-300">
                                <CalendarClock size={12} />
                            </div>
                            <div>
                                <p className="text-[9px] font-bold uppercase text-slate-500">Tax Deadline</p>
                                <p className="text-[10px] font-mono font-bold text-slate-900 dark:text-white">
                                    {offset === 0 ? `${daysToDeadline} Days Left` : offset < 0 ? 'Closed' : 'Future'}
                                </p>
                            </div>
                        </div>
                    </div>
                }
            />

            {/* Sub-tab Navigation */}
            <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl w-fit border border-slate-200 dark:border-slate-800 relative z-25">
                <button
                    onClick={() => setActiveTab('ITR')}
                    className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                        activeTab === 'ITR'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                >
                    Tax & ITR Dashboard
                </button>
                <button
                    onClick={() => setActiveTab('OPTIMIZER')}
                    className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                        activeTab === 'OPTIMIZER'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                >
                    Tax Optimizer Pro
                </button>
            </div>

            <AnimatePresence mode="wait">
                {activeTab === 'ITR' ? (
                    <motion.div
                        key="itr-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-6"
                    >
                        {/* ITR Pre-Fill Generator (P2 Enhancement) */}
                        <ITRPreFillPanel />

                        {/* ALERTS SECTION: Wash Sale & STT Eater */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            {/* 1. STT Eater (The Government's Share) */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col justify-between">
                                <div className="absolute top-0 right-0 p-4 opacity-5">
                                    <Skull size={100} className="text-rose-500" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                        <Percent size={18} className="text-rose-600 dark:text-rose-500" /> The Tax Bite
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Liquidation Scenario: What you keep vs. What they take.</p>
                                </div>

                                <div className="flex items-center gap-6">
                                    <div className="w-24 h-24 md:w-32 md:h-32 relative shrink-0">
                                        <SafeChartContainer>
                                            <PieChart>
                                                <Pie
                                                    data={sttStats.breakdown}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={25}
                                                    outerRadius={40}
                                                    paddingAngle={5}
                                                    dataKey="value"
                                                    stroke="none"
                                                >
                                                    {sttStats.breakdown.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'none' }} />
                                            </PieChart>
                                        </SafeChartContainer>
                                    </div>
                                    <div className="flex-1 space-y-3">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Net Profit</span>
                                            <span className="font-bold text-slate-900 dark:text-white">{formatCurrency(sttStats.netProfit)}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-rose-500"></div> Govt Share</span>
                                            <span className="font-bold text-rose-600 dark:text-rose-400">-{formatCurrency(sttStats.govtShare)}</span>
                                        </div>
                                        <div className="h-px bg-slate-100 dark:bg-slate-800 my-2"></div>
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic font-medium">Includes STT, Exchange Charges, Stamp Duty & Est. Tax.</p>
                                    </div>
                                </div>
                            </div>

                            {/* 2. Wash Sale Detector */}
                            <WashSaleDetector warnings={washSaleWarnings} />
                        </div>

                        {/* TOP ROW: TAX BAR & ACTION CARD */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                            {/* 1. TAX BAR (Realized Gain Monitor) */}
                            <TaxCalculator
                                realizedLTCG={realizedLTCG}
                                ltcgLimit={LTCG_LIMIT}
                                taxableExcess={taxableExcess}
                                saveTax={saveTax}
                                isEditing={isEditingTax}
                                setIsEditing={setIsEditingTax}
                                tempVal={tempTaxVal}
                                setTempVal={setTempTaxVal}
                            />

                            {/* 2. ACTION CARD (Harvesting Sniper) */}
                            <div className="lg:col-span-2">
                                {harvestAction ? (
                                    <div className="h-full bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900 dark:via-slate-900 dark:to-slate-900 rounded-2xl p-1 border border-indigo-200 dark:border-indigo-500/30 shadow-xl relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-4 opacity-5 dark:opacity-10 group-hover:opacity-10 dark:group-hover:opacity-20 transition-opacity">
                                            <Scissors size={140} className="text-indigo-600 dark:text-white" />
                                        </div>

                                        <div className="h-full bg-white/40 dark:bg-slate-900/50 backdrop-blur-sm rounded-xl p-6 flex flex-col justify-between relative z-10">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <span className="px-2 py-0.5 bg-rose-500/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 rounded text-[10px] font-black uppercase tracking-wider animate-pulse">
                                                            Priority Action
                                                        </span>
                                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                            Tax Harvesting Pair
                                                        </h3>
                                                    </div>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">
                                                        {taxableExcess > 0
                                                            ? "Offset your taxable gains immediately to reduce liability."
                                                            : "Harvest losses now to carry forward and offset future gains."}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[10px] font-black text-indigo-600 dark:text-indigo-300 uppercase tracking-widest mb-1">Potential Tax Saved</p>
                                                    <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                                                        {formatCurrency(harvestAction.taxSaved)}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="mt-6 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 flex flex-col md:flex-row items-center gap-6 shadow-inner">
                                                <div className="flex-1 w-full">
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-black uppercase tracking-widest mb-2">Sell Candidate (Loss)</p>
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-3 bg-rose-500/10 dark:bg-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-500/20">
                                                            <TrendingDown size={24} />
                                                        </div>
                                                        <div>
                                                            <p className="font-black text-slate-900 dark:text-white text-lg leading-none">{harvestAction.name}</p>
                                                            <p className="text-xs font-bold text-rose-600 dark:text-rose-300 mt-1.5">Unrealized Loss: -{formatCurrency(harvestAction.totalLoss)}</p>
                                                        </div>
                                                    </div>
                                                </div>

                                                {harvestAction.pair && (
                                                    <>
                                                        <div className="hidden md:flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
                                                            <ArrowRight size={24} className="animate-pulse" />
                                                            <span className="text-[9px] uppercase font-black tracking-tighter">Offsets</span>
                                                        </div>

                                                        <div className="flex-1 w-full">
                                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-black uppercase tracking-widest mb-2">Offset Target (Gain)</p>
                                                            <div className="flex items-center gap-3">
                                                                <div className="p-3 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20">
                                                                    <IndianRupee size={24} />
                                                                </div>
                                                                <div>
                                                                    <p className="font-black text-slate-900 dark:text-white text-lg leading-none">{harvestAction.pair.name}</p>
                                                                    <p className="text-xs font-bold text-emerald-600 dark:text-emerald-300 mt-1.5">Unrealized Gain: +{formatCurrency(harvestAction.pair.currentValue - harvestAction.pair.investedAmount)}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            <div className="mt-5 flex gap-3">
                                                <button className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-black py-3.5 rounded-xl shadow-lg shadow-indigo-500/30 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs active:scale-[0.98]">
                                                    <Scissors size={18} /> Execute Harvest
                                                </button>
                                                <div className="px-5 py-3.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-[11px] text-slate-500 dark:text-slate-400 flex items-center font-bold border border-slate-200 dark:border-transparent">
                                                    Book loss: <span className="text-rose-600 dark:text-rose-400 font-black ml-1.5">-{formatCurrency(harvestAction.targetLossToBook)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-full">
                                        <StateSurface
                                            title="Tax Efficient"
                                            description="No significant loss-making assets found for harvesting. Your portfolio is currently optimized."
                                            icon={ShieldCheck}
                                            tone="success"
                                            badge="no action needed"
                                            className="h-full flex items-center bg-white/40 dark:bg-slate-900/30 border-dashed"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 4. AUDIT LOG & DIVIDENDS */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <AuditLog />
                            <DividendTracker />
                        </div>

                        {/* 3. VISUAL COUNTDOWNS (HOLDING PERIODS) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            {/* Equity Ring List */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 rounded-lg">
                                        <Coins size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800 dark:text-white">Equity & ETFs</h3>
                                        <p className="text-xs text-slate-500">LTCG Maturity: 12 Months</p>
                                    </div>
                                </div>

                                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                                    {equityAssets.map(inv => {
                                        const days = calculateDaysHeld(inv.lastUpdated);
                                        const isMature = days >= 365;
                                        return (
                                            <div key={inv.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800">
                                                <div className="flex items-center gap-3 overflow-hidden">
                                                    <CircularProgress value={days} max={365} size={48} color={isMature ? "text-emerald-500" : "text-cyan-500"} />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{inv.name}</p>
                                                        <p className="text-xs text-slate-500 font-mono">
                                                            {isMature ? 'Long Term Capital Asset' : `${365 - days} days to LTCG`}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs font-bold text-slate-400 uppercase">Invested</p>
                                                    <p className="text-sm font-mono font-medium text-slate-700 dark:text-slate-300">{formatCurrency(inv.investedAmount)}</p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {equityAssets.length === 0 && (
                                        <StateSurface
                                            title="No Equity Assets"
                                            description="Add equity or ETF holdings to unlock holding-period maturity tracking."
                                            icon={Coins}
                                            tone="neutral"
                                            badge="empty"
                                            compact
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Bullion Ring List */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg">
                                        <Lock size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800 dark:text-white">Digital Gold</h3>
                                        <p className="text-xs text-slate-500">LTCG Maturity: 24 Months</p>
                                    </div>
                                </div>

                                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                                    {bullionAssets.map(inv => {
                                        const days = calculateDaysHeld(inv.lastUpdated);
                                        const isMature = days >= 730;
                                        return (
                                            <div key={inv.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800 relative overflow-hidden">
                                                <div className="flex items-center gap-3 overflow-hidden relative z-10">
                                                    <CircularProgress value={days} max={730} size={48} color={isMature ? "text-emerald-500" : "text-amber-500"} />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{inv.name}</p>
                                                        <p className="text-xs text-slate-500 font-mono">
                                                            {isMature ? 'Safe to withdraw' : 'Slab Rate Risk!'}
                                                        </p>
                                                    </div>
                                                </div>
                                                {!isMature && (
                                                    <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-amber-500/5 to-transparent pointer-events-none"></div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {bullionAssets.length === 0 && (
                                        <StateSurface
                                            title="No Bullion Assets"
                                            description="Add digital gold or silver to monitor 24-month holding maturity."
                                            icon={Lock}
                                            tone="neutral"
                                            badge="empty"
                                            compact
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="optimizer-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                    >
                        <TaxHarvestingPanel investments={investments} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(ComplianceShield);
