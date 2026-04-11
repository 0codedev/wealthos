import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { executionClockService, ExecutionClockState } from '../../services/execution/ExecutionClockService';
import { Clock, ShieldAlert, CheckCircle2, Lock, Flame, AlertOctagon, RotateCcw, Award, AlertTriangle, PowerOff, Loader2 } from 'lucide-react';
import { CRODebriefModal } from '../journal/CRODebriefModal';
import { openAlgoClientService, OpenAlgoStatus } from '../../services/OpenAlgoClientService';
import { useToast } from '../shared/ToastProvider';

interface ExecutionClockBannerProps {
  compact?: boolean;
}

export const ExecutionClockBanner: React.FC<ExecutionClockBannerProps> = ({ compact = false }) => {
  const { toast } = useToast();
  const [clockState, setClockState] = useState<ExecutionClockState>(() => executionClockService.getClockState());
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [isDebriefModalOpen, setIsDebriefModalOpen] = useState(false);
  const [isFlattenModalOpen, setIsFlattenModalOpen] = useState(false);
  const [isFlattening, setIsFlattening] = useState(false);
  const [openAlgoStatus, setOpenAlgoStatus] = useState<OpenAlgoStatus>({ status: 'offline', broker: 'none' });

  useEffect(() => {
    const update = () => setClockState(executionClockService.getClockState());
    const interval = setInterval(update, 1000);

    const onTradeRecorded = () => update();
    window.addEventListener('wealth-daily-trade-recorded', onTradeRecorded);

    // Initial check of OpenAlgo broker gateway status
    openAlgoClientService.getStatus().then(setOpenAlgoStatus).catch(() => {});
    const oaInterval = setInterval(() => {
      openAlgoClientService.getStatus().then(setOpenAlgoStatus).catch(() => {});
    }, 15000);

    return () => {
      clearInterval(interval);
      clearInterval(oaInterval);
      window.removeEventListener('wealth-daily-trade-recorded', onTradeRecorded);
    };
  }, []);

  const handleEmergencyHalt = async () => {
    setIsFlattening(true);
    try {
      const res = await openAlgoClientService.emergencyHalt();
      if (res.success) {
        toast.success(`🚨 EMERGENCY FLATTEN EXECUTED: All open orders cancelled. Closed ${res.positionsClosed} positions.`);
      } else {
        toast.error(`⚠️ Emergency Halt partial completion. Errors: ${res.errors?.join(', ') || 'Unknown'}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`❌ Emergency Halt Error: ${msg}`);
    } finally {
      setIsFlattening(false);
      setIsFlattenModalOpen(false);
    }
  };

  const formatCountdown = (totalSeconds: number): string => {
    if (totalSeconds <= 0) return '00:00';
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const badgeClasses = useMemo(() => {
    switch (clockState.phaseBadgeColor) {
      case 'green':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.25)]';
      case 'red':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.2)]';
      case 'yellow':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'amber':
        return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
      case 'indigo':
        return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  }, [clockState.phaseBadgeColor]);

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-900/90 border border-slate-800/80 shadow-md">
        <Clock size={13} className="text-slate-400" />
        <span className="font-mono text-xs font-bold text-slate-200">{clockState.istTimeStr} IST</span>
        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${badgeClasses}`}>
          {clockState.phaseTitle}
        </span>
        <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 font-bold">
          {clockState.dailyTradeCount}/{clockState.maxDailyTrades} TRADES
        </span>
      </div>
    );
  }

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-xl border-b border-slate-800/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-lg">
      {/* Left: Time and Current Phase */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
          <Clock size={14} className="text-indigo-400 animate-spin-slow" />
          <span className="font-mono font-bold text-xs text-white tracking-wide">{clockState.istTimeStr} IST</span>
        </div>

        <div className={`px-3 py-1 rounded-lg border text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ${badgeClasses}`}>
          {clockState.phase === 'GOLDEN_WINDOW' && <Flame size={14} className="animate-bounce" />}
          {clockState.phase === 'RETAIL_TRAP_HANDS_OFF' && <ShieldAlert size={14} className="animate-pulse" />}
          {clockState.phase === 'HARD_LOCKOUT_THETA_CHOP' && <Lock size={14} />}
          {clockState.phase === 'MANDATORY_EXIT' && <AlertOctagon size={14} className="animate-pulse" />}
          <span>{clockState.phaseTitle}</span>
        </div>

        {clockState.secondsToNextPhase > 0 && (
          <span className="text-[10px] text-slate-400 font-mono hidden md:inline">
            Next: <strong className="text-slate-200">{clockState.nextPhaseTitle}</strong> in{' '}
            <span className="text-amber-400 font-bold">{formatCountdown(clockState.secondsToNextPhase)}</span>
          </span>
        )}
      </div>

      {/* Right: 1-Trade Discipline Gate & Order Status */}
      <div className="flex items-center gap-3">
        {/* Lockout status banner */}
        {clockState.lockoutReason && (
          <span className="text-[10px] font-mono text-slate-400 hidden xl:inline max-w-sm truncate">
            {clockState.lockoutReason}
          </span>
        )}

        {/* 1-Trade Per Day Counter */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-950 border border-slate-800">
          <span className="text-[9px] uppercase font-black text-slate-500 tracking-wider">Discipline Cap:</span>
          <span
            className={`font-mono font-black text-xs px-1.5 py-0.5 rounded ${
              clockState.dailyTradeCount >= clockState.maxDailyTrades
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            }`}
          >
            {clockState.dailyTradeCount} / {clockState.maxDailyTrades} TRADE
          </span>
          {clockState.dailyTradeCount >= clockState.maxDailyTrades ? (
            <span className="text-[10px] font-bold text-rose-400 flex items-center gap-0.5">
              <Lock size={11} /> LOCKED
            </span>
          ) : (
            <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-0.5">
              <CheckCircle2 size={11} /> READY
            </span>
          )}
        </div>

        {/* OpenAlgo Connection Status Pill */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[10px]"
          title={`OpenAlgo Broker Gateway: ${openAlgoStatus.broker || 'unknown'} (${openAlgoStatus.status})`}
        >
          <span className={`w-2 h-2 rounded-full ${openAlgoStatus.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="text-slate-400 font-bold">OA:</span>
          <span className={`font-bold ${openAlgoStatus.status === 'online' ? 'text-emerald-300' : 'text-amber-300'}`}>
            {openAlgoStatus.status === 'online' ? (openAlgoStatus.broker?.toUpperCase() || 'ONLINE') : 'SANDBOX'}
          </span>
        </div>

        {/* Emergency Account Flatten Button */}
        <button
          type="button"
          onClick={() => setIsFlattenModalOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 border border-rose-600/50 text-rose-300 text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 shadow-sm shadow-rose-950 cursor-pointer"
          title="Atomic Emergency Flatten: Cancel all orders & square off positions immediately"
        >
          <PowerOff size={12} className="text-rose-400" />
          <span className="hidden sm:inline">EMERGENCY FLATTEN</span>
          <span className="sm:hidden">FLATTEN</span>
        </button>

        {/* CRO Debrief Trigger */}
        <button
          type="button"
          onClick={() => setIsDebriefModalOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-700/50 text-indigo-300 text-[11px] font-bold transition-all active:scale-95"
          title="Open Post-Market AI CRO Debrief"
        >
          <Award size={13} />
          <span>CRO DEBRIEF</span>
        </button>

        {/* Reset button for Captain's manual override */}
        {clockState.dailyTradeCount > 0 && (
          <button
            type="button"
            onClick={() => setIsOverrideModalOpen(true)}
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
            title="Reset Daily Trade Counter"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {/* Modal for Reset Confirmation */}
      {isOverrideModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 -z-10"
            onClick={() => setIsOverrideModalOpen(false)}
            aria-hidden="true"
          />
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4 relative z-10 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-amber-400">
              <ShieldAlert size={24} />
              <h3 className="text-base font-black uppercase text-white">Reset 1-Trade Cap?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Institutional Discipline Rule: WealthOS v2 enforces <strong>1 high-conviction trade per day</strong> to eliminate overtrading, cognitive fatigue, and revenge tilt.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsOverrideModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-800"
              >
                Keep Locked
              </button>
              <button
                type="button"
                onClick={() => {
                  executionClockService.resetDailyTradeCount();
                  setIsOverrideModalOpen(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* CRO Debrief Modal */}
      <CRODebriefModal
        isOpen={isDebriefModalOpen}
        onClose={() => setIsDebriefModalOpen(false)}
      />

      {/* Emergency Account Flatten Confirmation Modal */}
      {isFlattenModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 -z-10"
            onClick={() => !isFlattening && setIsFlattenModalOpen(false)}
            aria-hidden="true"
          />
          <div className="bg-slate-900 border border-rose-600/50 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative z-10 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle size={28} className="animate-pulse" />
              <div>
                <h3 className="text-base font-black uppercase text-white">Emergency Account Flatten</h3>
                <span className="text-[10px] font-mono text-rose-400 font-bold">ATOMIC PANIC CIRCUIT BREAKER</span>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Executing this action immediately triggers two atomic operations in OpenAlgo:
              <br />
              1. <strong>Bulk cancels ALL open and pending orders</strong>.
              <br />
              2. <strong>Squares off ALL open positions</strong> at market to return account to 100% cash.
            </p>
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/40 text-[11px] text-rose-300 font-mono">
              ⚠️ Irreversible action. Active trailing brackets, limit fills, and intraday trades will be terminated immediately.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isFlattening}
                onClick={() => setIsFlattenModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel (Keep Open)
              </button>
              <button
                type="button"
                disabled={isFlattening}
                onClick={handleEmergencyHalt}
                className="px-4 py-2 rounded-lg text-xs font-black bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              >
                {isFlattening ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>FLATTENING ACCOUNT...</span>
                  </>
                ) : (
                  <>
                    <PowerOff size={14} />
                    <span>CONFIRM EMERGENCY FLATTEN</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
