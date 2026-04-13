/**
 * VoiceOrderConfirmToast — CC32
 *
 * Glassmorphic, slide-up confirmation toast shown after a voice intent
 * has been parsed. Renders the parsed order (symbol, side, qty, price)
 * and requires either:
 *   - A manual click on CONFIRM, OR
 *   - A spoken "confirm" / "cancel" phrase (via SpeechRecognition), OR
 *   - A 10-second auto-cancel timer.
 *
 * Before showing the toast, the RiskSafetyGate is consulted. If the gate
 * blocks the order, the toast is shown in a "BLOCKED" state with the
 * reason inline — the CONFIRM button is disabled.
 *
 * This toast is intentionally portal-free: it renders inline at the
 * bottom of the screen and is intended to be hosted by a top-level
 * component (e.g. App.tsx).
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ShieldAlert, Mic, X, Check } from 'lucide-react';
import { VoiceOrderIntent } from '../../services/VoiceOrderConduit';
import { riskSafetyGate, RiskVerdict } from '../../services/jarvis3/RiskSafetyGate';
import { logger } from '../../services/Logger';

export interface VoiceOrderConfirmToastProps {
  intent: VoiceOrderIntent | null;
  onConfirm: (intent: VoiceOrderIntent) => void;
  onCancel: () => void;
  /** Auto-cancel timeout in ms. Default 10s. */
  timeoutMs?: number;
}

export const VoiceOrderConfirmToast: React.FC<VoiceOrderConfirmToastProps> = ({
  intent,
  onConfirm,
  onCancel,
  timeoutMs = 10_000
}) => {
  const [verdict, setVerdict] = useState<RiskVerdict | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState<string>('');
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Evaluate the gate whenever the intent changes
  useEffect(() => {
    if (!intent) {
      setVerdict(null);
      return;
    }
    const v = riskSafetyGate.evaluate({
      symbol: intent.symbol,
      quantity: intent.quantity,
      price: intent.price,
      side: intent.side
    });
    setVerdict(v);
  }, [intent]);

  // Auto-cancel timer
  useEffect(() => {
    if (!intent) return;
    timerRef.current = setTimeout(() => {
      logger.info('[VoiceOrderConfirmToast] auto-cancelled after timeout');
      onCancel();
    }, timeoutMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [intent, timeoutMs, onCancel]);

  // Voice confirmation via SpeechRecognition
  useEffect(() => {
    if (!intent) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try {
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-IN';
      recognition.onresult = (e: any) => {
        const last = e.results[e.results.length - 1];
        const text = last[0].transcript.trim().toLowerCase();
        setVoiceTranscript(text);
        if (text.includes('confirm') && verdict?.allowed) {
          onConfirm(intent);
        } else if (text.includes('cancel') || text.includes('stop')) {
          onCancel();
        }
      };
      recognition.onend = () => setListening(false);
      recognition.onerror = () => setListening(false);
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch (err) {
      logger.debug('[VoiceOrderConfirmToast] SpeechRecognition unavailable', err);
    }
    return () => {
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
    };
  }, [intent, verdict?.allowed, onConfirm, onCancel]);

  if (!intent) return null;

  const blocked = verdict ? !verdict.allowed : false;

  return (
    <AnimatePresence>
      <motion.div
        key="toast"
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 220 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[min(420px,calc(100vw-2rem))]"
        role="alertdialog"
        aria-label="Voice order confirmation"
      >
        <div className={`
          relative overflow-hidden rounded-2xl border backdrop-blur-2xl p-5 shadow-2xl
          ${blocked
            ? 'bg-rose-950/80 border-rose-500/40 shadow-rose-500/20'
            : 'bg-slate-900/85 border-emerald-500/40 shadow-emerald-500/20'}
        `}>
          {/* Top accent gradient */}
          <div className={`absolute top-0 left-0 right-0 h-1 ${
            blocked ? 'bg-gradient-to-r from-rose-500 via-rose-400 to-rose-500'
                    : 'bg-gradient-to-r from-emerald-500 via-emerald-300 to-emerald-500'
          }`} aria-hidden="true" />

          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {blocked ? <ShieldAlert className="text-rose-400" size={20} /> : <ShieldCheck className="text-emerald-400" size={20} />}
              <h3 className={`text-sm font-black uppercase tracking-widest ${blocked ? 'text-rose-300' : 'text-emerald-300'}`}>
                {blocked ? 'Voice Order Blocked' : 'Confirm Voice Order'}
              </h3>
            </div>
            <button
              onClick={onCancel}
              className="text-slate-400 hover:text-white transition-colors p-1"
              aria-label="Dismiss confirmation"
            >
              <X size={16} />
            </button>
          </div>

          {/* Order summary */}
          <div className="bg-black/30 rounded-xl p-4 mb-4 font-mono text-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-400 text-[10px] uppercase tracking-wider">Side</span>
              <span className={`font-black ${intent.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {intent.side}
              </span>
            </div>
            <div className="text-white font-bold text-lg leading-tight mb-1">
              {intent.symbol}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-slate-500 text-[10px] uppercase">Qty</div>
                <div className="text-slate-200 font-bold">{intent.quantity}</div>
              </div>
              <div>
                <div className="text-slate-500 text-[10px] uppercase">Price</div>
                <div className="text-slate-200 font-bold">₹{intent.price.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-slate-500 text-[10px] uppercase">Notional</div>
                <div className="text-slate-200 font-bold">₹{(intent.quantity * intent.price).toFixed(0)}</div>
              </div>
            </div>
            {(intent.stopLoss > 0 || intent.target > 0) && (
              <div className="grid grid-cols-2 gap-2 text-xs mt-2 pt-2 border-t border-white/10">
                {intent.stopLoss > 0 && (
                  <div>
                    <div className="text-rose-400 text-[10px] uppercase">Stop-Loss</div>
                    <div className="text-rose-300 font-bold">₹{intent.stopLoss.toFixed(2)}</div>
                  </div>
                )}
                {intent.target > 0 && (
                  <div>
                    <div className="text-emerald-400 text-[10px] uppercase">Target</div>
                    <div className="text-emerald-300 font-bold">₹{intent.target.toFixed(2)}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Block reason */}
          {blocked && verdict?.reason && (
            <div className="text-rose-300 text-xs mb-3 px-3 py-2 bg-rose-900/30 border border-rose-500/30 rounded-lg">
              {verdict.reason}
            </div>
          )}

          {/* Voice transcript (live) */}
          {listening && voiceTranscript && (
            <div className="flex items-center gap-2 text-xs text-indigo-300 mb-3 font-mono">
              <Mic size={12} className="animate-pulse" />
              <span>"{voiceTranscript}"</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 rounded-xl text-sm font-bold transition-all active:scale-95"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(intent)}
              disabled={blocked}
              className={`flex-1 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all active:scale-95 ${
                blocked
                  ? 'bg-slate-800/40 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-500/30'
              }`}
            >
              <Check size={16} />
              Confirm
            </button>
          </div>

          {/* Utilization rings */}
          {verdict && (
            <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/5 text-[10px] text-slate-400">
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span>Margin</span>
                  <span className="font-mono">₹{verdict.remainingMargin.toFixed(0)}</span>
                </div>
                <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, verdict.utilization.margin * 100)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span>Loss</span>
                  <span className="font-mono">₹{verdict.remainingLossBudget.toFixed(0)}</span>
                </div>
                <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-rose-500 transition-all" style={{ width: `${Math.min(100, verdict.utilization.loss * 100)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span>Orders</span>
                  <span className="font-mono">{verdict.remainingOrders}</span>
                </div>
                <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-amber-500 transition-all" style={{ width: `${Math.min(100, verdict.utilization.orders * 100)}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default VoiceOrderConfirmToast;
