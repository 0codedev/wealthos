import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    BrainCircuit, TrendingUp, TrendingDown, BarChart2,
    Target, AlertTriangle, ShieldCheck, Activity,
    Search, RefreshCw, Wand2, Zap, DollarSign
} from 'lucide-react';
import { btstEngine, BTSTPrediction } from '../../../services/BTSTEngine';
import { fetchIndianStockQuote, fetchLiveOptionPremium, blackScholesOptionPrice } from '../../../services/RealDataService';
import { formatCurrency } from '../../../utils/helpers';

// =============================================================
// INSTRUMENTS CONFIG
// =============================================================
const INSTRUMENTS = [
    { id: 'nifty',     name: 'Nifty 50',   lotSize: 75,  interval: 50,  typicalIV: 0.14 },
    { id: 'banknifty', name: 'Bank Nifty',  lotSize: 15,  interval: 100, typicalIV: 0.18 },
    { id: 'sensex',    name: 'Sensex',      lotSize: 20,  interval: 100, typicalIV: 0.14 },
    { id: 'finNifty',  name: 'Fin Nifty',   lotSize: 40,  interval: 50,  typicalIV: 0.16 },
    { id: 'midcap',    name: 'Midcap 150',  lotSize: 50,  interval: 25,  typicalIV: 0.20 },
];

// =============================================================
// BTST "GAP SNIPER" PnL ENGINE
//
// Strategy:
//   1. Buy CE at predicted gap-up landing price (currently far-OTM, cheap)
//   2. Buy PE at predicted gap-down landing price (symmetric hedge)
//   3. If gap happens: winning leg goes ATM/ITM → massive returns
//   4. If gap doesn't happen: both expire worthless → max loss = premium paid
//
// This is NOT a straddle at ATM.
// This is buying options PLACED AT THE TARGET PRICE OF THE PREDICTED MOVE.
// =============================================================

interface ScenarioPnL {
    // The "winning" leg
    winnerType: 'CE' | 'PE';
    winnerExit: number;
    winnerPnL: number;
    // The "losing" leg
    loserType: 'CE' | 'PE';
    loserExit: number;
    loserPnL: number;
    // Net
    netPnL: number;
    netROI: number;
    newSpot: number;
}

/**
 * Calculate what happens to an option when a big gap occurs.
 *
 * For the WINNING leg (e.g., CE when gap up):
 *   - Option goes from far-OTM → ATM or ITM
 *   - Intrinsic value appears, dominates
 *   - Some time value remains (depends on how far ITM)
 *
 * For the LOSING leg (e.g., PE when gap up):
 *   - Goes even further OTM
 *   - IV crush kills any remaining extrinsic
 *   - Value approaches 0 (total loss of premium paid)
 */
function calcGapPnL(
    newSpot: number,
    ceStrike: number,
    ceEntry: number,
    peStrike: number,
    peEntry: number,
    qty: number,
    isGapUp: boolean,
    ivCrushPct: number
): ScenarioPnL {
    // ─── CE exit at new spot ───────────────────────────────────────────
    // Intrinsic: how deep ITM the option lands (hard money floor)
    const ceIntrinsic = Math.max(0, newSpot - ceStrike);
    // Post-event extrinsic: very small (~5-10% of original extrinsic survives big event)
    const ceExtrinsicFactor = ceIntrinsic > 0 ? 0.08 : (1 - ivCrushPct / 100) * 0.2;
    const ceExtrinsic = ceEntry * ceExtrinsicFactor;
    const ceExit = Math.max(0.05, ceIntrinsic + ceExtrinsic);
    const cePnL = (ceExit - ceEntry) * qty;

    // ─── PE exit at new spot ───────────────────────────────────────────
    const peIntrinsic = Math.max(0, peStrike - newSpot);
    const peExtrinsicFactor = peIntrinsic > 0 ? 0.08 : (1 - ivCrushPct / 100) * 0.2;
    const peExtrinsic = peEntry * peExtrinsicFactor;
    const peExit = Math.max(0.05, peIntrinsic + peExtrinsic);
    const pePnL = (peExit - peEntry) * qty;

    const totalEntry = (ceEntry + peEntry) * qty;
    const netPnL = cePnL + pePnL;
    const netROI = totalEntry > 0 ? (netPnL / totalEntry) * 100 : 0;

    return {
        winnerType: isGapUp ? 'CE' : 'PE',
        winnerExit: isGapUp ? ceExit : peExit,
        winnerPnL: isGapUp ? cePnL : pePnL,
        loserType: isGapUp ? 'PE' : 'CE',
        loserExit: isGapUp ? peExit : ceExit,
        loserPnL: isGapUp ? pePnL : cePnL,
        netPnL,
        netROI,
        newSpot,
    };
}

// =============================================================
// COMPONENT
// =============================================================
export const BTSTPredictor: React.FC = () => {
    const [selectedId, setSelectedId]         = useState('nifty');
    const [spotPrice, setSpotPrice]           = useState<number | ''>(24000);
    const [lots, setLots]                     = useState<number>(1);
    // Defaults: 1.5% OTM CE/PE with spot=24000 → CE=24350, PE=23650, ~₹15-25 premium on weekly
    const [ceStrike, setCeStrike]             = useState<number | ''>(24350);
    const [cePremium, setCePremium]           = useState<number | ''>(15);
    const [peStrike, setPeStrike]             = useState<number | ''>(23650);
    const [pePremium, setPePremium]           = useState<number | ''>(15);
    const [prediction, setPrediction]         = useState<BTSTPrediction | null>(null);
    const [isScanning, setIsScanning]         = useState(false);
    const [isBuilding, setIsBuilding]         = useState(false);
    const [buildStatus, setBuildStatus]       = useState('');
    const [expectedGapUp, setExpectedGapUp]   = useState<number>(2.5);
    const [expectedGapDown, setExpectedGapDown] = useState<number>(2.5);
    const [ivCrush, setIvCrush]               = useState<number>(60);
    // Weekly options (5 days) give realistic ₹10-30 premiums for 1-2% OTM
    const [daysToExpiry, setDaysToExpiry]     = useState<number>(5);

    const inst = INSTRUMENTS.find(i => i.id === selectedId) || INSTRUMENTS[0];

    // ----------------------------------------------------------------
    // AUTO-BUILD: Gap Sniper — place strikes INSIDE the gap to ensure ITM on trigger
    // ----------------------------------------------------------------
    const handleAutoBuild = async () => {
        setIsBuilding(true);
        setBuildStatus('Fetching live spot...');
        try {
            // 1. Fetch live spot
            const liveQuote = await fetchIndianStockQuote(inst.name);
            const liveSpot = liveQuote && liveQuote.price > 0 ? liveQuote.price : (Number(spotPrice) || 24000);
            setSpotPrice(liveSpot);
            setBuildStatus(`Spot: ₹${liveSpot.toFixed(0)} | Computing strikes...`);

            const { interval } = inst;
            const atm = Math.round(liveSpot / interval) * interval;

            // 2. KEY FORMULA: Place CE/PE at 60% of the gap distance OTM
            //    ─────────────────────────────────────────────────────────
            //    If gap = 2.5%, offset = 1.5% OTM
            //    • Option priced at ₹10-30 (realistic for weekly options)
            //    • When 2.5% gap fires: CE is 1% ITM → intrinsic = 240pts on Nifty
            //    • PnL = (240pts - 15 paid) × 75lots = ₹16,875 profit!
            //    ─────────────────────────────────────────────────────────
            const ceOtmPct = expectedGapUp * 0.6;    // e.g. 2.5% × 0.6 = 1.5% OTM
            const peOtmPct = expectedGapDown * 0.6;
            const ceRawOffset = Math.round(liveSpot * (ceOtmPct / 100) / interval) * interval;
            const peRawOffset = Math.round(liveSpot * (peOtmPct / 100) / interval) * interval;
            const ceSt = atm + Math.max(interval, ceRawOffset); // at least 1 step OTM
            const peSt = atm - Math.max(interval, peRawOffset);

            setCeStrike(ceSt);
            setPeStrike(peSt);
            setBuildStatus(`CE: ${ceSt} (${((ceSt - liveSpot) / liveSpot * 100).toFixed(1)}% OTM) | PE: ${peSt} | Fetching LTP...`);

            // 3. Fetch live LTPs — NSE → Moneycontrol → Black-Scholes
            const [liveCe, livePe] = await Promise.all([
                fetchLiveOptionPremium(inst.name, ceSt, 'CE', liveSpot, daysToExpiry),
                fetchLiveOptionPremium(inst.name, peSt, 'PE', liveSpot, daysToExpiry),
            ]);

            const ceP = liveCe ?? blackScholesOptionPrice(liveSpot, ceSt, 'CE', daysToExpiry, inst.typicalIV);
            const peP = livePe ?? blackScholesOptionPrice(liveSpot, peSt, 'PE', daysToExpiry, inst.typicalIV);

            // Floor at ₹0.50 to avoid 0.05 edge cases — options below ₹0.50 aren't tradeable
            const clampedCeP = Math.max(0.5, Math.round(ceP * 20) / 20);
            const clampedPeP = Math.max(0.5, Math.round(peP * 20) / 20);
            setCePremium(clampedCeP);
            setPePremium(clampedPeP);

            const qty = lots * inst.lotSize;
            const totalCap = (clampedCeP + clampedPeP) * qty;
            setBuildStatus(`✅ CE ₹${clampedCeP} + PE ₹${clampedPeP} | Total: ₹${Math.round(totalCap).toLocaleString('en-IN')}`);
        } catch (e) {
            setBuildStatus('⚠️ Fallback to estimate (market may be closed)');
            console.error('Auto-Build failed', e);
        } finally {
            setIsBuilding(false);
        }
    };

    // ----------------------------------------------------------------
    // AI SCAN
    // ----------------------------------------------------------------
    const handleRunAIScan = async () => {
        setIsScanning(true);
        try {
            const result = await btstEngine.runLiveEODScan(inst.name, Number(spotPrice) || 0);
            setPrediction(result);
            setExpectedGapUp(result.expectedGapPercentage);
            setExpectedGapDown(result.expectedGapPercentage);
        } catch (e) {
            console.error('AI Scan failed', e);
        } finally {
            setIsScanning(false);
        }
    };

    // ----------------------------------------------------------------
    // PnL CALCULATIONS
    // ----------------------------------------------------------------
    const results = useMemo(() => {
        const spot = Number(spotPrice);
        const ceK  = Number(ceStrike);
        const ceP  = Number(cePremium);
        const peK  = Number(peStrike);
        const peP  = Number(pePremium);
        if (!spot || !ceK || !ceP || !peK || !peP || ceP <= 0 || peP <= 0) return null;

        const qty       = lots * inst.lotSize;
        const ceCap     = ceP * qty;
        const peCap     = peP * qty;
        const totalCap  = ceCap + peCap;

        // --- GAP UP scenario ---
        const upSpot   = spot * (1 + expectedGapUp / 100);
        const gapUp    = calcGapPnL(upSpot, ceK, ceP, peK, peP, qty, true,  ivCrush);

        // --- GAP DOWN scenario ---
        const downSpot = spot * (1 - expectedGapDown / 100);
        const gapDown  = calcGapPnL(downSpot, ceK, ceP, peK, peP, qty, false, ivCrush);

        // --- FLAT: iv crush destroys everything ---
        const ceFlatExit = ceP * (1 - ivCrush / 100) * 0.3; // < 30% of premium survives flat
        const peFlatExit = peP * (1 - ivCrush / 100) * 0.3;
        const pnlFlat    = ((ceFlatExit - ceP) + (peFlatExit - peP)) * qty;

        // Return multiplier (how much winner returns vs total capital at risk)
        const upMultiplier   = Math.abs(gapUp.winnerPnL)   / totalCap;
        const downMultiplier = Math.abs(gapDown.winnerPnL) / totalCap;

        return {
            spot, qty, ceCap, peCap, totalCap,
            gapUp, gapDown, pnlFlat,
            upMultiplier, downMultiplier,
        };
    }, [spotPrice, ceStrike, cePremium, peStrike, pePremium, lots, inst, expectedGapUp, expectedGapDown, ivCrush]);

    // ----------------------------------------------------------------
    // RENDER
    // ----------------------------------------------------------------
    return (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 xl:grid-cols-12 gap-6"
        >
            {/* ===== LEFT PANEL: INPUTS ===== */}
            <div className="xl:col-span-4">
                <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-5 space-y-5 shadow-2xl">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-purple-500/20 rounded-lg">
                            <BrainCircuit size={18} className="text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-white">BTST Gap Sniper</h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Buy Option at Gap Landing Price</p>
                        </div>
                    </div>

                    {/* Strategy explainer */}
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-[10px] text-blue-300/90 leading-relaxed">
                        <span className="font-black text-blue-400 uppercase tracking-widest block mb-1">How This Works</span>
                        CE strike is placed at where spot lands IF Gap Up. PE strike at Gap Down target.
                        These options cost ₹2–15 each. If the gap happens → option goes ATM/ITM → massive profit. If flat → premium is lost entirely.
                    </div>

                    {/* Market Layer */}
                    <div className="space-y-2">
                        <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Market Layer</label>
                        <div className="flex flex-wrap gap-1.5">
                            {INSTRUMENTS.map(i => (
                                <button key={i.id} onClick={() => setSelectedId(i.id)}
                                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                                        selectedId === i.id
                                            ? 'bg-purple-500 border-purple-400 text-white'
                                            : 'bg-slate-950/50 border-slate-800 text-slate-500 hover:text-slate-300'
                                    }`}
                                >{i.name}</button>
                            ))}
                        </div>
                    </div>

                    {/* Spot + Lots + DTE */}
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { label: 'Spot Price', val: spotPrice, set: (v: number) => setSpotPrice(v) },
                            { label: `Lots ×${inst.lotSize}`, val: lots, set: (v: number) => setLots(v) },
                            { label: 'Days to Exp', val: daysToExpiry, set: (v: number) => setDaysToExpiry(v) },
                        ].map(({ label, val, set }) => (
                            <div key={label} className="space-y-1">
                                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</label>
                                <input type="number" value={val}
                                    onChange={e => set(parseFloat(e.target.value) || 0)}
                                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-2 py-1.5 text-white font-mono text-xs focus:border-purple-500/50 outline-none"
                                />
                            </div>
                        ))}
                    </div>

                    {/* Gap % inputs */}
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { label: 'Gap Up %', val: expectedGapUp, set: setExpectedGapUp, color: 'text-emerald-400' },
                            { label: 'Gap Down %', val: expectedGapDown, set: setExpectedGapDown, color: 'text-rose-400' },
                            { label: 'IV Crush %', val: ivCrush, set: setIvCrush, color: 'text-amber-400' },
                        ].map(({ label, val, set, color }) => (
                            <div key={label}>
                                <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">{label}</label>
                                <div className="flex items-center gap-1 bg-slate-950/50 rounded-lg p-1.5 border border-slate-800">
                                    <input type="number" value={val} onChange={e => set(Number(e.target.value))}
                                        className={`w-10 bg-transparent ${color} font-mono text-xs font-bold focus:outline-none text-center`}
                                    />
                                    <span className="text-slate-600 text-[10px]">%</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Auto-Build */}
                    <button onClick={handleAutoBuild} disabled={isBuilding}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-xl text-[11px] font-black text-white uppercase tracking-wider transition-all shadow-lg shadow-purple-500/20 disabled:opacity-60"
                    >
                        {isBuilding ? <RefreshCw size={13} className="animate-spin" /> : <Wand2 size={13} />}
                        {isBuilding ? 'Fetching Live LTP...' : 'Auto-Build Gap Sniper Strategy'}
                    </button>
                    {buildStatus && (
                        <div className="text-[10px] text-slate-400 font-mono text-center">{buildStatus}</div>
                    )}

                    {/* CE + PE Strike/Premium inputs */}
                    <div className="grid grid-cols-2 gap-3">
                        {/* CE */}
                        <div className="space-y-2 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-2xl">
                            <div className="flex items-center gap-1.5 mb-1">
                                <TrendingUp size={10} className="text-emerald-400" />
                                <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Call CE</span>
                                {Number(ceStrike) > 0 && Number(spotPrice) > 0 && (
                                    <span className="ml-auto text-[9px] bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 text-emerald-500 font-mono font-bold">
                                        {(((Number(ceStrike) - Number(spotPrice)) / Number(spotPrice)) * 100).toFixed(1)}% OTM ↑
                                    </span>
                                )}
                            </div>
                            <div>
                                <label className="block text-[9px] text-slate-500 mb-1">Strike</label>
                                <input type="number" value={ceStrike}
                                    onChange={e => setCeStrike(parseFloat(e.target.value) || '')}
                                    className="w-full bg-slate-950/80 border border-emerald-500/20 rounded-lg px-2 py-1.5 text-emerald-400 font-mono text-xs focus:border-emerald-500/50 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] text-slate-500 mb-1">LTP / Premium ₹</label>
                                <input type="number" step="0.05" value={cePremium}
                                    onChange={e => setCePremium(parseFloat(e.target.value) || '')}
                                    className="w-full bg-slate-950/80 border border-emerald-500/20 rounded-lg px-2 py-1.5 text-emerald-400 font-mono text-xs focus:border-emerald-500/50 outline-none"
                                />
                            </div>
                            <div className="text-[9px] text-slate-500 font-mono border-t border-emerald-500/10 pt-1.5 flex justify-between">
                                <span>Capital</span>
                                <span className="text-emerald-500">{formatCurrency(Number(cePremium) * lots * inst.lotSize)}</span>
                            </div>
                        </div>

                        {/* PE */}
                        <div className="space-y-2 p-3 bg-rose-500/5 border border-rose-500/15 rounded-2xl">
                            <div className="flex items-center gap-1.5 mb-1">
                                <TrendingDown size={10} className="text-rose-400" />
                                <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest">Put PE</span>
                                {Number(peStrike) > 0 && Number(spotPrice) > 0 && (
                                    <span className="ml-auto text-[9px] bg-rose-500/10 border border-rose-500/20 rounded px-1.5 text-rose-500 font-mono font-bold">
                                        {(((Number(spotPrice) - Number(peStrike)) / Number(spotPrice)) * 100).toFixed(1)}% OTM ↓
                                    </span>
                                )}
                            </div>
                            <div>
                                <label className="block text-[9px] text-slate-500 mb-1">Strike</label>
                                <input type="number" value={peStrike}
                                    onChange={e => setPeStrike(parseFloat(e.target.value) || '')}
                                    className="w-full bg-slate-950/80 border border-rose-500/20 rounded-lg px-2 py-1.5 text-rose-400 font-mono text-xs focus:border-rose-500/50 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] text-slate-500 mb-1">LTP / Premium ₹</label>
                                <input type="number" step="0.05" value={pePremium}
                                    onChange={e => setPePremium(parseFloat(e.target.value) || '')}
                                    className="w-full bg-slate-950/80 border border-rose-500/20 rounded-lg px-2 py-1.5 text-rose-400 font-mono text-xs focus:border-rose-500/50 outline-none"
                                />
                            </div>
                            <div className="text-[9px] text-slate-500 font-mono border-t border-rose-500/10 pt-1.5 flex justify-between">
                                <span>Capital</span>
                                <span className="text-rose-500">{formatCurrency(Number(pePremium) * lots * inst.lotSize)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>


            {/* ===== RIGHT PANEL: OUTPUT ===== */}
            <div className="xl:col-span-8 flex flex-col gap-4">

                {/* Summary + AI Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Capital at Risk */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-5 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Target size={13} className="text-blue-400" />
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Max Capital Risk</span>
                        </div>
                        <div className="text-3xl font-black font-mono text-white tracking-tighter">
                            {results ? formatCurrency(results.totalCap) : '--'}
                        </div>
                        <div className="text-[10px] text-slate-500">{lots}L × {inst.lotSize}q per leg (CE + PE)</div>
                        {results && (
                            <div className="mt-1 space-y-0.5">
                                <div className="text-[9px] font-mono text-emerald-500/80">CE: {formatCurrency(results.ceCap)}</div>
                                <div className="text-[9px] font-mono text-rose-500/80">PE: {formatCurrency(results.peCap)}</div>
                            </div>
                        )}
                    </div>

                    {/* AI Radar */}
                    <div className="md:col-span-2 bg-gradient-to-br from-purple-900/20 to-slate-900/50 border border-purple-500/20 rounded-3xl p-5 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Activity size={14} className="text-purple-400 animate-pulse" />
                                <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Pre-Close AI Radar</span>
                            </div>
                            <button onClick={handleRunAIScan} disabled={isScanning}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                                    isScanning ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                              : 'bg-purple-500 hover:bg-purple-400 text-white shadow-lg shadow-purple-500/20'
                                }`}
                            >
                                {isScanning ? <><RefreshCw size={12} className="animate-spin" /> Scanning...</> : <><Search size={12} /> EOD Scan</>}
                            </button>
                        </div>

                        {prediction ? (
                            <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                                className="bg-slate-950/80 border border-purple-500/30 rounded-xl p-3"
                            >
                                <div className="flex items-center gap-3 mb-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 border-dashed shrink-0 text-xs font-black font-mono ${
                                        prediction.probability > 80 ? 'border-emerald-500 text-emerald-400'
                                        : prediction.probability > 65 ? 'border-amber-500 text-amber-400'
                                        : 'border-slate-500 text-slate-400'
                                    }`}>{prediction.probability}%</div>
                                    <div className="flex-1">
                                        <div className="text-[9px] text-slate-500 uppercase tracking-widest">Predicted Direction</div>
                                        <div className="text-sm font-black text-white">{prediction.direction.replace('_', ' ')}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[9px] text-slate-500 uppercase">Recommended</div>
                                        <div className="text-sm font-mono font-black text-blue-400">₹{prediction.recommendedCapital.toLocaleString('en-IN')}</div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-3 text-[9px] text-slate-400 font-bold mb-2">
                                    <span>GIFT: <span className="text-white">{prediction.signals.giftNiftyPremium > 0 ? '+' : ''}{prediction.signals.giftNiftyPremium}pts</span></span>
                                    <span>VIX: <span className="text-white">{prediction.signals.indiaVixChange > 0 ? '+' : ''}{prediction.signals.indiaVixChange}%</span></span>
                                    <span>PCR: <span className="text-white">{prediction.signals.pcr}</span></span>
                                </div>
                                <div className="text-[10px] text-purple-300/80 font-medium bg-purple-500/10 p-2 rounded-lg border border-purple-500/20">
                                    {prediction.action}
                                </div>
                            </motion.div>
                        ) : (
                            <div className="text-[10px] text-slate-500 text-center py-2">
                                Run EOD scan for AI gap direction prediction, GIFT Nifty signal & capital sizing.
                            </div>
                        )}
                    </div>
                </div>

                {/* ===== OUTCOME MATRIX ===== */}
                <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-3xl p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <BarChart2 size={14} className="text-slate-400" />
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Gap Sniper Outcome Matrix</span>
                    </div>

                    {results ? (
                        <div className="space-y-3">
                            {/* GAP UP CARD */}
                            {[
                                {
                                    scenario: 'Gap Up',
                                    pct: expectedGapUp,
                                    data: results.gapUp,
                                    headColor: 'text-emerald-400',
                                    headBg: 'bg-emerald-500/10 border-emerald-500/25',
                                    icon: <TrendingUp size={16} className="text-emerald-400" />,
                                    multiplier: results.upMultiplier,
                                },
                                {
                                    scenario: 'Gap Down',
                                    pct: expectedGapDown,
                                    data: results.gapDown,
                                    headColor: 'text-rose-400',
                                    headBg: 'bg-rose-500/10 border-rose-500/25',
                                    icon: <TrendingDown size={16} className="text-rose-400" />,
                                    multiplier: results.downMultiplier,
                                },
                            ].map(({ scenario, pct, data, headColor, headBg, icon, multiplier }) => (
                                <div key={scenario}
                                    className={`rounded-2xl border p-4 ${data.netPnL >= 0 ? 'bg-emerald-500/5 border-emerald-500/25' : 'bg-rose-500/5 border-rose-500/20'}`}
                                >
                                    <div className="flex flex-wrap items-start gap-3">
                                        {/* Scenario Label */}
                                        <div className={`flex items-center gap-2 p-2 rounded-xl border ${headBg} shrink-0 w-36`}>
                                            {icon}
                                            <div>
                                                <div className={`text-[9px] font-black uppercase tracking-widest ${headColor}`}>{scenario} {pct}%</div>
                                                <div className="text-[9px] text-slate-500 font-mono">→{data.newSpot.toFixed(0)}</div>
                                            </div>
                                        </div>

                                        {/* Per-leg breakdown */}
                                        <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
                                            {/* WINNER */}
                                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5">
                                                <div className="flex items-center gap-1 mb-1">
                                                    <Zap size={9} className="text-emerald-400" />
                                                    <span className="text-[9px] font-black text-emerald-400 uppercase">WIN: {data.winnerType}</span>
                                                </div>
                                                <div className="text-[9px] text-slate-500 font-mono mb-0.5">
                                                    {data.winnerType === 'CE' ? Number(cePremium) : Number(pePremium)} → <span className="text-emerald-300">{data.winnerExit.toFixed(2)}</span>
                                                </div>
                                                <div className="text-sm font-black font-mono text-emerald-400">
                                                    +{formatCurrency(Math.round(data.winnerPnL))}
                                                </div>
                                                <div className="text-[9px] text-emerald-600 font-mono">{multiplier.toFixed(1)}× on that leg</div>
                                            </div>

                                            {/* LOSER */}
                                            <div className="bg-rose-500/5 border border-rose-500/15 rounded-xl p-2.5">
                                                <div className="flex items-center gap-1 mb-1">
                                                    <AlertTriangle size={9} className="text-rose-400" />
                                                    <span className="text-[9px] font-black text-rose-400 uppercase">LOSE: {data.loserType}</span>
                                                </div>
                                                <div className="text-[9px] text-slate-500 font-mono mb-0.5">
                                                    {data.loserType === 'CE' ? Number(cePremium) : Number(pePremium)} → <span className="text-rose-300">~{data.loserExit.toFixed(2)}</span>
                                                </div>
                                                <div className="text-sm font-black font-mono text-rose-400">
                                                    -₹{Math.abs(Math.round(data.loserPnL)).toLocaleString('en-IN')}
                                                </div>
                                                <div className="text-[9px] text-rose-700 font-mono">Max loss = premium paid</div>
                                            </div>
                                        </div>

                                        {/* Net PnL */}
                                        <div className="text-right shrink-0 w-28">
                                            <div className="text-[9px] text-slate-500 font-bold uppercase mb-1">Net P&L</div>
                                            <div className={`text-2xl font-black font-mono tracking-tighter ${data.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {data.netPnL >= 0 ? '+' : ''}₹{Math.abs(Math.round(data.netPnL)).toLocaleString('en-IN')}
                                            </div>
                                            <div className={`text-xs font-mono font-black mt-0.5 ${data.netROI >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {data.netROI >= 0 ? '+' : ''}{data.netROI.toFixed(0)}% ROI
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* FLAT / IV CRUSH */}
                            <div className="bg-amber-900/10 border border-amber-500/20 rounded-xl p-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle size={13} className="text-amber-500" />
                                    <div>
                                        <span className="text-[10px] text-amber-400 font-black uppercase tracking-widest">Flat Market Risk</span>
                                        <span className="text-[9px] text-slate-500 ml-2">— if no gap, {ivCrush}% IV crush kills premium</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-mono font-black text-rose-400">
                                        -₹{Math.abs(Math.round(results.pnlFlat)).toLocaleString('en-IN')}
                                    </div>
                                    <div className="text-[9px] text-slate-500 font-mono">≈ full capital lost</div>
                                </div>
                            </div>

                            {/* Strategy Summary Banner */}
                            <div className="bg-slate-950/80 border border-slate-700/50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
                                <div>
                                    <div className="text-[9px] text-slate-500 uppercase font-bold mb-0.5">Max Win</div>
                                    <div className="text-sm font-black font-mono text-emerald-400">
                                        +₹{Math.abs(Math.round(Math.max(results.gapUp.netPnL, results.gapDown.netPnL))).toLocaleString('en-IN')}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[9px] text-slate-500 uppercase font-bold mb-0.5">Max Loss</div>
                                    <div className="text-sm font-black font-mono text-rose-400">
                                        -{formatCurrency(Math.round(results.totalCap))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[9px] text-slate-500 uppercase font-bold mb-0.5">Risk/Reward</div>
                                    <div className="text-sm font-black font-mono text-purple-400">
                                        1:{(Math.max(results.gapUp.netPnL, results.gapDown.netPnL) / results.totalCap).toFixed(0)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-48 border border-dashed border-slate-800 rounded-2xl flex flex-col justify-center items-center opacity-50">
                            <ShieldCheck size={32} className="text-slate-600 mb-2" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Enter Spot Price & Click Auto-Build to Begin</span>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};
