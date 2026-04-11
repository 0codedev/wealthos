import React, { useState, useEffect, useMemo } from 'react';
import { orderFlowTapeService, CVDPoint, ZeroHesitationTriggerResult } from '../../services/microstructure/OrderFlowTapeService';
import { executionClockService, ExecutionClockState } from '../../services/execution/ExecutionClockService';
import { playbookGateService, PlaybookAuditResult } from '../../services/execution/PlaybookGateService';
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Zap, Lock, ArrowUpRight, ArrowDownRight, Crosshair, HelpCircle, Activity, Loader2 } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import { openAlgoClientService } from '../../services/OpenAlgoClientService';

export interface ZeroHesitationTriggerProps {
  defaultSymbol?: 'NIFTY' | 'BANKNIFTY';
  onOrderExecuted?: (result: ZeroHesitationTriggerResult) => void;
}

export const ZeroHesitationTrigger: React.FC<ZeroHesitationTriggerProps> = ({
  defaultSymbol = 'NIFTY',
  onOrderExecuted
}) => {
  const { toast } = useToast();
  const [symbol, setSymbol] = useState<'NIFTY' | 'BANKNIFTY'>(defaultSymbol);
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');

  // Execution Clock State
  const [clockState, setClockState] = useState<ExecutionClockState>(() => executionClockService.getClockState());

  // Market Telemetry Inputs
  const [spotPrice, setSpotPrice] = useState<number>(symbol === 'NIFTY' ? 24850 : 54200);
  const [ema20_5m, setEma20_5m] = useState<number>(symbol === 'NIFTY' ? 24810 : 54050);
  const [zeroGammaLevel, setZeroGammaLevel] = useState<number>(symbol === 'NIFTY' ? 24800 : 54000);
  const [leadSector, setLeadSector] = useState<string>('NIFTY BANK');
  const [leadSectorChangePct, setLeadSectorChangePct] = useState<number>(0.85);

  // Simulated live CVD points for order flow slope
  const [cvdPoints, setCvdPoints] = useState<CVDPoint[]>([
    { timestamp: '10:28:00', price: 24830, cvd: 1200, delta: 150 },
    { timestamp: '10:29:00', price: 24840, cvd: 1450, delta: 250 },
    { timestamp: '10:30:00', price: 24850, cvd: 1800, delta: 350 }
  ]);

  const [executedTrade, setExecutedTrade] = useState<ZeroHesitationTriggerResult | null>(null);
  const [isPunching, setIsPunching] = useState<boolean>(false);
  const [orderResult, setOrderResult] = useState<{ entryId?: string; slId?: string; targetId?: string; message?: string } | null>(null);

  // Update clock state in real time
  useEffect(() => {
    const update = () => setClockState(executionClockService.getClockState());
    const interval = setInterval(update, 1000);
    const onTradeRec = () => update();
    window.addEventListener('wealth-daily-trade-recorded', onTradeRec);
    return () => {
      clearInterval(interval);
      window.removeEventListener('wealth-daily-trade-recorded', onTradeRec);
    };
  }, []);

  // Update base values when symbol switches
  useEffect(() => {
    if (symbol === 'NIFTY') {
      setSpotPrice(24850);
      setEma20_5m(24810);
      setZeroGammaLevel(24800);
      setLeadSector('NIFTY BANK');
      setLeadSectorChangePct(0.85);
    } else {
      setSpotPrice(54200);
      setEma20_5m(54050);
      setZeroGammaLevel(54000);
      setLeadSector('HDFC BANK');
      setLeadSectorChangePct(1.10);
    }
  }, [symbol]);

  // Evaluate the 3-Point Checklist
  const triggerResult: ZeroHesitationTriggerResult = useMemo(() => {
    return orderFlowTapeService.evaluateTrigger({
      symbol,
      direction,
      spot: spotPrice,
      ema20_5m,
      zeroGammaLevel,
      cvdPoints,
      leadSector,
      leadSectorChangePct,
      leadSectorEma20: 100, // normalized proxy
      leadSectorPrice: leadSectorChangePct >= 0 ? 101 : 99
    });
  }, [symbol, direction, spotPrice, ema20_5m, zeroGammaLevel, cvdPoints, leadSector, leadSectorChangePct]);

  // Evaluate Playbook Gate
  const playbookResult: PlaybookAuditResult = useMemo(() => {
    return playbookGateService.auditPlaybooks({
      symbol,
      spot: spotPrice,
      vwap: ema20_5m,
      openRangeHigh: spotPrice * 0.998,
      openRangeLow: spotPrice * 0.992,
      currentVolume: 150000,
      avgVolume20: 100000,
      callWall: symbol === 'NIFTY' ? 25000 : 54500,
      putWall: symbol === 'NIFTY' ? 24600 : 53800,
      zeroGammaLevel,
      isLongGamma: false,
      hasCvdAbsorption: false
    });
  }, [symbol, spotPrice, ema20_5m, zeroGammaLevel]);

  // Overall Gate Status
  const isClockAllowed = clockState.canEnterNewTrade;
  const isChecklistApproved = triggerResult.isApproved;
  const isPlaybookApproved = playbookResult.isAllowedToTrade;
  const canExecute = isChecklistApproved && isClockAllowed && isPlaybookApproved;

  const handleExecute = async () => {
    if (!canExecute || isPunching) return;

    setIsPunching(true);
    setOrderResult(null);

    try {
      // 1. Record trade in 1-Trade Per Day discipline service
      executionClockService.recordTradeExecution();
      setExecutedTrade(triggerResult);

      // 2. Compute contract strike & quantities
      const lotSize = symbol === 'NIFTY' ? 25 : 15;
      const bracket = triggerResult.bracketLevels;
      const strikeBase = symbol === 'NIFTY' ? Math.round(spotPrice / 50) * 50 : Math.round(spotPrice / 100) * 100;
      const optionType = direction === 'LONG' ? 'CE' : 'PE';
      const contractSymbol = `${symbol}26SEP${strikeBase}${optionType}`;

      const entryPrice = bracket ? bracket.entryPrice : spotPrice;
      const stopLossPrice = bracket ? bracket.stopLoss : (direction === 'LONG' ? spotPrice - 30 : spotPrice + 30);
      const targetPrice = bracket ? bracket.target1 : (direction === 'LONG' ? spotPrice + 60 : spotPrice - 60);

      // 3. Dispatch atomic OCO Bracket order to OpenAlgo Gateway
      const punchRes = await openAlgoClientService.placeBracketOrder({
        symbol: contractSymbol,
        action: 'BUY',
        exchange: 'NFO',
        product: 'MIS',
        entryPrice,
        stopLossPrice,
        targetPrice,
        quantity: lotSize,
        strategy: 'WealthOS_ZeroHesitation_Bracket_SANDBOX',
        entryType: 'MARKET'
      });

      if (punchRes.status === 'success') {
        setOrderResult({
          entryId: punchRes.entryOrderId,
          slId: punchRes.slOrderId,
          targetId: punchRes.targetOrderId,
          message: punchRes.message
        });
        toast.success(`⚡ ORDER PUNCHED: ${direction} ${symbol} @ ₹${spotPrice.toFixed(1)} [OpenAlgo BO #${punchRes.entryOrderId}]`);
      } else {
        toast.error(`⚠️ Execution Warning: ${punchRes.message || 'Broker reject'}`);
      }

      if (onOrderExecuted) {
        onOrderExecuted(triggerResult);
      }

      // Dispatch global event for listeners / audit logs
      window.dispatchEvent(
        new CustomEvent('wealth-order-handoff', {
          detail: {
            symbol,
            direction,
            contractSymbol,
            triggerResult,
            bracketLevels: triggerResult.bracketLevels,
            openAlgoResult: punchRes,
            timestamp: new Date().toISOString()
          }
        })
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`❌ Execution Failed: ${msg}`);
    } finally {
      setIsPunching(false);
    }
  };

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-xl">
      {/* Header bar */}
      <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Crosshair size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
              ZERO-HESITATION TRIGGER TERMINAL
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-indigo-950 border border-indigo-700/50 text-indigo-300 font-bold">
                DOMAIN 07
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              3-Point Binary Trigger Matrix • Zero second-guessing • Bracketed OCO Handoff
            </p>
          </div>
        </div>

        {/* Toggles: Symbol & Direction */}
        <div className="flex items-center gap-2">
          {/* Symbol Selector */}
          <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-0.5">
            {(['NIFTY', 'BANKNIFTY'] as const).map(sym => (
              <button
                key={sym}
                onClick={() => setSymbol(sym)}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  symbol === sym
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>

          {/* Direction Selector */}
          <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-0.5">
            <button
              onClick={() => setDirection('LONG')}
              className={`px-3 py-1 text-xs font-bold rounded-lg flex items-center gap-1 transition-all ${
                direction === 'LONG'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowUpRight size={14} /> LONG (CALL)
            </button>
            <button
              onClick={() => setDirection('SHORT')}
              className={`px-3 py-1 text-xs font-bold rounded-lg flex items-center gap-1 transition-all ${
                direction === 'SHORT'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowDownRight size={14} /> SHORT (PUT)
            </button>
          </div>
        </div>
      </div>

      {/* Main Body: 3-Point Checklist & Order Action */}
      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column (2 spans): The 3-Point Checklist */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Binary Qualification Criteria
            </span>
            <span className={`font-mono text-xs font-black px-2.5 py-0.5 rounded-full border ${
              triggerResult.score === 3
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
            }`}>
              SCORE: {triggerResult.score} / 3 {triggerResult.score === 3 ? 'PASSED' : 'FAILED'}
            </span>
          </div>

          {/* Point 1 */}
          <div className={`p-4 rounded-xl border transition-all ${
            triggerResult.point1_trendStructure
              ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200'
              : 'bg-slate-950/50 border-slate-800/80 text-slate-300'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {triggerResult.point1_trendStructure ? (
                  <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                ) : (
                  <XCircle size={18} className="text-rose-400 mt-0.5 shrink-0" />
                )}
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    Point 1: Trend & Structure ({direction === 'LONG' ? 'Spot > 20 EMA & > S₀' : 'Spot < 20 EMA & < S₀'})
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    {triggerResult.point1_details}
                  </p>
                </div>
              </div>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                triggerResult.point1_trendStructure ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                {triggerResult.point1_trendStructure ? 'PASS' : 'FAIL'}
              </span>
            </div>
          </div>

          {/* Point 2 */}
          <div className={`p-4 rounded-xl border transition-all ${
            triggerResult.point2_orderFlowDelta
              ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200'
              : 'bg-slate-950/50 border-slate-800/80 text-slate-300'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {triggerResult.point2_orderFlowDelta ? (
                  <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                ) : (
                  <XCircle size={18} className="text-rose-400 mt-0.5 shrink-0" />
                )}
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    Point 2: Order-Flow Delta Confirmation ({direction === 'LONG' ? 'CVD Slope +' : 'CVD Slope -'})
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    {triggerResult.point2_details}
                  </p>
                </div>
              </div>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                triggerResult.point2_orderFlowDelta ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                {triggerResult.point2_orderFlowDelta ? 'PASS' : 'FAIL'}
              </span>
            </div>
          </div>

          {/* Point 3 */}
          <div className={`p-4 rounded-xl border transition-all ${
            triggerResult.point3_leadSectorAlign
              ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200'
              : 'bg-slate-950/50 border-slate-800/80 text-slate-300'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {triggerResult.point3_leadSectorAlign ? (
                  <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                ) : (
                  <XCircle size={18} className="text-rose-400 mt-0.5 shrink-0" />
                )}
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    Point 3: Lead Sector Alignment ({leadSector})
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    {triggerResult.point3_details}
                  </p>
                </div>
              </div>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                triggerResult.point3_leadSectorAlign ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                {triggerResult.point3_leadSectorAlign ? 'PASS' : 'FAIL'}
              </span>
            </div>
          </div>

          {/* Interactive Simulation Controls */}
          <div className="pt-2 flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400">
            <span>Inputs:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span>Spot:</span>
              <input
                type="number"
                value={spotPrice}
                onChange={e => setSpotPrice(Number(e.target.value))}
                className="w-20 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-white font-mono"
              />
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span>20 EMA:</span>
              <input
                type="number"
                value={ema20_5m}
                onChange={e => setEma20_5m(Number(e.target.value))}
                className="w-20 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-white font-mono"
              />
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span>S₀ Flip:</span>
              <input
                type="number"
                value={zeroGammaLevel}
                onChange={e => setZeroGammaLevel(Number(e.target.value))}
                className="w-20 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-white font-mono"
              />
            </label>
            <button
              onClick={() => {
                // Invert CVD slope to simulate delta shift
                setCvdPoints(prev => [
                  prev[1],
                  prev[2],
                  {
                    timestamp: new Date().toLocaleTimeString(),
                    price: spotPrice,
                    cvd: prev[2].cvd + (direction === 'LONG' ? -400 : 400),
                    delta: direction === 'LONG' ? -200 : 200
                  }
                ]);
              }}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border border-slate-700"
            >
              Toggle CVD Slope
            </button>
          </div>
        </div>

        {/* Right Column: Execution Action & Pre-bracketed OCO Levels */}
        <div className="flex flex-col justify-between p-4 rounded-xl bg-slate-950/70 border border-slate-800/80">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Pre-Bracketed OCO Orders
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/50 text-indigo-400 border border-indigo-800/30">
                1:2 R:R RATIO
              </span>
            </div>

            <div className="mt-4 space-y-2.5 font-mono text-xs">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Order Action:</span>
                <span className={`font-bold ${direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  BUY {direction === 'LONG' ? 'CE / FUT' : 'PE / FUT'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Entry Level:</span>
                <span className="font-bold text-white">₹{triggerResult.bracketLevels?.entryPrice.toFixed(1)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Stop Loss (Hard):</span>
                <span className="font-bold text-rose-400">₹{triggerResult.bracketLevels?.stopLoss.toFixed(1)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Target 1 (1:2):</span>
                <span className="font-bold text-emerald-400">₹{triggerResult.bracketLevels?.target1.toFixed(1)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Playbook Fit:</span>
                <span className="font-bold text-indigo-300">
                  {playbookResult.primaryPlaybook.title}
                </span>
              </div>
            </div>

            {/* Lockout / Gate Warning */}
            {(!isClockAllowed || !isChecklistApproved || !isPlaybookApproved) && (
              <div className="mt-4 p-3 rounded-lg bg-rose-950/30 border border-rose-800/40 text-rose-300 text-xs flex items-start gap-2">
                <Lock size={15} className="mt-0.5 shrink-0 text-rose-400" />
                <div className="space-y-1">
                  {!isClockAllowed && <p className="font-bold">{clockState.lockoutReason || 'Clock Lockout Active'}</p>}
                  {!isChecklistApproved && <p className="font-mono text-[11px]">{triggerResult.rejectionReason}</p>}
                  {!isPlaybookApproved && <p className="font-mono text-[11px]">{playbookResult.lockoutReason}</p>}
                </div>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="mt-5">
            <button
              onClick={handleExecute}
              disabled={!canExecute || isPunching}
              className={`w-full py-3.5 px-4 rounded-xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                isPunching
                  ? 'bg-amber-500 text-slate-950 opacity-90 cursor-wait'
                  : canExecute
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/25 active:scale-95 cursor-pointer animate-pulse'
                  : 'bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed opacity-75'
              }`}
            >
              {isPunching ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>PUNCHING BRACKET INTO OPENALGO...</span>
                </>
              ) : canExecute ? (
                <>
                  <Zap size={18} className="fill-current" />
                  <span>BINARY PUNCH (3/3) — FIRE ORDER</span>
                </>
              ) : (
                <>
                  <Lock size={16} />
                  <span>NO TRADE ({triggerResult.score}/3) — GATED</span>
                </>
              )}
            </button>

            {orderResult && (
              <div className="mt-2.5 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-[11px] font-mono text-emerald-300 flex flex-col gap-0.5 text-center">
                <span className="font-bold flex items-center justify-center gap-1">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  OpenAlgo OCO Bracket Placed: Entry #{orderResult.entryId}
                </span>
                <span className="text-[10px] text-slate-400">
                  SL Order: {orderResult.slId || 'Attached'} • Target: {orderResult.targetId || 'Attached'}
                </span>
              </div>
            )}

            {!orderResult && executedTrade && (
              <p className="mt-2 text-center text-[10px] font-mono text-emerald-400">
                ✓ Fill Handoff Confirmed at {executedTrade.timestamp}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
