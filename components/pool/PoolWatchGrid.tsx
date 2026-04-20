/**
 * PoolWatchGrid - Momentum Pool 2.0
 *
 * Renders watched items in an obsidian/glass grid card with live price update flashes.
 * Displays:
 *  - ActionabilityRing with 4-tier proximity states & breach alarms
 *  - Platform discovery badge (Twitter/X, IG, YouTube, Telegram) & creator handle
 *  - Time horizon pill & catalyst setup tags
 *  - Multi-stage levels (Trigger, SL, T1, T2, T3) and R:R ratio
 *  - Real-time distance-to-trigger countdown
 *  - Direct 1-click Sandbox execution
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Trash2, Zap, Bell, BellOff, Play, Edit2, Activity, Sparkles, 
  Target, ShieldAlert, TrendingUp, ExternalLink, CheckCircle2,
  Clock, AtSign, Flame
} from 'lucide-react';
import { usePoolStore, PoolItemExtended } from '../../store/poolStore';
import { useShallow } from 'zustand/react/shallow';
import { poolPollEngine } from '../../services/PoolPollEngine';
import { useToast } from '../shared/ToastProvider';
import { db, PoolItem, ParsedSignal } from '../../database';
import { ParsedSignal as TelegramParsedSignal } from '../../services/TelegramSignalParser';
import { PositionSizerModal } from '../telegram/PositionSizerModal';
import { TrustAuditor } from '../../services/TrustAuditor';
import { poolAIAnalyzerService } from '../../services/PoolAIAnalyzerService';
import { useSettingsStore } from '../../store/settingsStore';
import { TradingViewPineScriptDialog } from './TradingViewPineScriptDialog';
import { UpstoxGTTDialog } from './UpstoxGTTDialog';
import { ActionabilityRing } from './ActionabilityRing';
import { poolAudioAlertService } from '../../services/PoolAudioAlertService';

interface PoolWatchGridProps {
  onEdit?: (item: PoolItemExtended) => void;
}

const PLATFORM_ICONS: Record<string, string> = {
  TWITTER: '🐦',
  INSTAGRAM: '📸',
  YOUTUBE: '▶️',
  TELEGRAM: '✈️',
  TRADINGVIEW: '📈',
  PERSONAL_RESEARCH: '🔬',
  BROKER_REPORT: '📑',
  TV_MEDIA: '📺',
};

const HORIZON_LABELS: Record<string, { label: string; color: string }> = {
  INTRADAY_SCALP: { label: 'Scalp', color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  BTST_STBT: { label: 'BTST', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
  POSITIONAL_SWING: { label: 'Swing', color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  MOMENTUM_SHORT_TERM: { label: 'Short-Term', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  MULTIBAGGER_LONG_TERM: { label: 'Long-Term', color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
};

export const PoolWatchGrid: React.FC<PoolWatchGridProps> = ({ onEdit }) => {
  const { items, verdicts, removeItem, toggleAlert, updateItem, updateProximity, sendToSandbox } = usePoolStore(
    useShallow(state => ({
      items: state.items,
      verdicts: state.verdicts,
      removeItem: state.removeItem,
      toggleAlert: state.toggleAlert,
      updateItem: state.updateItem,
      updateProximity: state.updateProximity,
      sendToSandbox: state.sendToSandbox,
    }))
  );
  const { toast } = useToast();
  const [runningVerdicts, setRunningVerdicts] = useState<Set<number>>(new Set());
  const [sizerItem, setSizerItem] = useState<PoolItemExtended | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [analyzingTickers, setAnalyzingTickers] = useState<Set<string>>(new Set());
  const [activePineItem, setActivePineItem] = useState<PoolItemExtended | null>(null);
  const [activeGttItem, setActiveGttItem] = useState<PoolItemExtended | null>(null);
  const [punchingIds, setPunchingIds] = useState<Set<number>>(new Set());

  const onRunAIAnalysis = async (ticker: string) => {
    setAnalyzingTickers((s) => new Set(s).add(ticker));
    try {
      const depth = useSettingsStore.getState().aiAnalysisDepth || 'deep';
      const result = await poolAIAnalyzerService.analyzeSymbol(ticker, depth);
      if (result) {
        toast.success(`AI Analysis done for ${ticker}. Entry: ${result.entryZone}, T1: ${result.target1}, SL: ${result.stopLoss}`);
      } else {
        toast.error(`AI Analysis failed for ${ticker}`);
      }
    } catch (err: any) {
      toast.error(`AI Analysis failed: ${err?.message || 'unknown'}`);
    } finally {
      setAnalyzingTickers((s) => { const ns = new Set(s); ns.delete(ticker); return ns; });
    }
  };

  const handleResolve = async (item: PoolItemExtended, success: boolean) => {
    if (!item.id) return;
    try {
      const nextStatus = success ? 'EXECUTED' : 'DISMISSED';
      await updateItem(item.id, { status: nextStatus, alertEnabled: 0 });
      if (item.sourceMeta?.channelId) {
        TrustAuditor.recordOutcome(item.sourceMeta.channelId, success, success ? 1.0 : 0.0);
        toast.success(`Trade resolved as ${success ? 'WIN' : 'LOSS'}. Trust score for ${item.sourceMeta.channelId} updated!`);
      } else {
        toast.success(`Trade resolved as ${success ? 'WIN' : 'LOSS'}.`);
      }
    } catch (err: any) {
      toast.error(`Resolution failed: ${err?.message || 'unknown'}`);
    } finally {
      setResolvingId(null);
    }
  };

  const handlePunchSandbox = async (item: PoolItemExtended) => {
    if (!item.id) return;
    setPunchingIds(s => new Set(s).add(item.id!));
    try {
      const res = await sendToSandbox(item);
      if (res.success) {
        toast.success(res.message || `Order dispatched to OpenAlgo Sandbox`);
      } else {
        toast.error(res.message || 'Sandbox punch rejected');
      }
    } catch (e: any) {
      toast.error(`Sandbox dispatch error: ${e.message}`);
    } finally {
      setPunchingIds(s => { const ns = new Set(s); ns.delete(item.id!); return ns; });
    }
  };

  // Live price map + per-ticker flash state
  const [prices, setPrices] = useState<Record<string, { price: number; prev?: number; at: number }>>({});
  const [flashMap, setFlashMap] = useState<Record<string, 'up' | 'down' | null>>({});
  const [matchingSignals, setMatchingSignals] = useState<Record<string, ParsedSignal>>({});

  useEffect(() => {
    const scanInitialMatches = async () => {
      try {
        const activeSignals = await db.parsed_signals.where('status').equals('ACTIVE').toArray();
        const matches: Record<string, ParsedSignal> = {};
        for (const sig of activeSignals) {
          matches[sig.instrument.toUpperCase()] = sig;
        }
        setMatchingSignals(matches);
      } catch (err) {
        console.warn('PoolWatchGrid: initial active signal scan failed', err);
      }
    };
    scanInitialMatches();
  }, []);

  useEffect(() => {
    return poolPollEngine.onEvent((event) => {
      if (event.type === 'pool:price-update') {
        setPrices((prev) => ({ ...prev, [event.ticker]: { price: event.price, prev: event.prevPrice, at: event.at } }));
        const dir: 'up' | 'down' = (event.prevPrice ?? event.price) < event.price ? 'up' : 'down';
        setFlashMap((prev) => ({ ...prev, [event.ticker]: dir }));
        setTimeout(() => {
          setFlashMap((prev2) => {
            const next = { ...prev2 };
            if (next[event.ticker] === dir) delete next[event.ticker];
            return next;
          });
        }, 900);

        // Update proximity in store
        const matchingItem = items.find(i => i.ticker.toUpperCase() === event.ticker.toUpperCase());
        if (matchingItem?.id) {
          updateProximity(matchingItem.id, event.price);
        }
      } else if (event.type === 'pool:signal-match') {
        setMatchingSignals((prev) => ({ ...prev, [event.ticker.toUpperCase()]: event.signal }));
      }
    });
  }, [items, updateProximity]);

  const lastVerdictByTicker = useMemo(() => {
    const m: Record<string, { verdict: string; score: number; at: number }> = {};
    for (const v of verdicts) {
      const cur = m[v.ticker];
      if (!cur || v.generatedAt > cur.at) m[v.ticker] = { verdict: v.verdict, score: v.score, at: v.generatedAt };
    }
    return m;
  }, [verdicts]);

  const onRunVerdict = async (item: PoolItemExtended) => {
    if (!item.id) return;
    setRunningVerdicts((s) => new Set(s).add(item.id!));
    try {
      const v = await poolPollEngine.forceVerdict(item.id, 'MANUAL');
      if (v) toast.success(`${item.ticker} verdict: ${v.verdict} (${v.score})`);
      else toast.warning('No verdict produced - try again.');
    } catch (err: any) {
      toast.error(`Verdict failed: ${err?.message || 'unknown'}`);
    } finally {
      setRunningVerdicts((s) => { const ns = new Set(s); ns.delete(item.id!); return ns; });
    }
  };

  const onRemove = async (item: PoolItemExtended) => {
    if (!item.id) return;
    if (!confirm(`Remove ${item.ticker} from the Pool? Verdicts will also be cleared.`)) return;
    await removeItem(item.id);
    toast.info(`${item.ticker} removed from Pool.`);
  };

  if (items.length === 0) {
    return (
      <div className="pool-empty p-12 text-center rounded-2xl bg-[#08090C] border border-white/[0.06] text-slate-400">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto mb-3">
          <Sparkles size={24} />
        </div>
        <h2 className="text-base font-bold text-white mb-1">Momentum Pool 2.0 is empty</h2>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Add stocks from Twitter, Instagram, YouTube, or your research. The live engine tracks proximity rings, calculates risk sizing, and can auto-punch into OpenAlgo Sandbox upon breach.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      className="pool-watch-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5"
      initial="hidden"
      animate="show"
      variants={{
        hidden: { opacity: 1 },
        show: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
      }}
    >
      {items.map((item) => {
        if (!item.id) return null;
        const live = prices[item.ticker];
        const displayPrice = live?.price ?? item.lastPrice;
        const flash = flashMap[item.ticker];
        const lastV = lastVerdictByTicker[item.ticker];
        const isRunning = runningVerdicts.has(item.id);
        const isPunching = punchingIds.has(item.id);

        const trig = item.triggerPrice || item.targetBuyPrice;
        const isBreached = item.isTriggerBreached || item.status === 'TRIGGERED' || (trig && displayPrice && displayPrice >= trig);
        const horizonMeta = item.horizon ? HORIZON_LABELS[item.horizon] : null;

        // Compute live distance
        let distPct: number | null = null;
        if (displayPrice && trig && trig > 0) {
          distPct = Math.round(((displayPrice - trig) / trig) * 10000) / 100;
        }

        return (
          <motion.div
            key={item.id}
            variants={{
              hidden: { opacity: 0, y: 8 },
              show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
            }}
            className={`pool-card p-4 rounded-2xl bg-[#08090C] border transition-all relative overflow-hidden ${
              isBreached 
                ? 'border-emerald-500/40 shadow-lg shadow-emerald-950/30' 
                : 'border-white/[0.06] hover:border-white/[0.12]'
            }`}
          >
            {/* Top Bar: Platform & Horizon Badges */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                {item.platformSource && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#131620] border border-white/[0.06] text-slate-300">
                    <span>{PLATFORM_ICONS[item.platformSource] || '📌'}</span>
                    <span>{item.creatorHandle || item.platformSource}</span>
                  </span>
                )}
                {horizonMeta && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${horizonMeta.color}`}>
                    {horizonMeta.label}
                  </span>
                )}
              </div>

              {/* Status or Breached Tag */}
              {isBreached ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                  <Flame size={11} /> TRIGGER BREACHED
                </span>
              ) : distPct != null ? (
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  Math.abs(distPct) <= 0.5 
                    ? 'text-amber-400 bg-amber-400/10 border border-amber-400/20 animate-pulse' 
                    : 'text-slate-400 bg-white/[0.02]'
                }`}>
                  {distPct > 0 ? `+${distPct}%` : `${distPct}%`} to Trigger
                </span>
              ) : null}
            </div>

            {/* Main Row: Actionability Ring + Ticker + Price */}
            <div className="flex items-center gap-3">
              <ActionabilityRing
                ticker={item.ticker}
                lastPrice={displayPrice ?? undefined}
                targetBuy={trig ?? undefined}
                verdictScore={lastV?.score ?? null}
                proximityPct={distPct ?? undefined}
                isBreached={Boolean(isBreached)}
                size={46}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black tracking-tight text-white">{item.ticker}</span>
                  {item.sourceUrl && (
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-300">
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {item.displayName || item.exchange}
                </div>
              </div>

              <div className="text-right">
                <div className={`text-sm font-mono font-bold ${
                  flash === 'up' ? 'text-emerald-400 scale-105 transition-transform' : 
                  flash === 'down' ? 'text-red-400 scale-105 transition-transform' : 
                  'text-white'
                }`}>
                  {displayPrice ? `₹${displayPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '-'}
                </div>
                {item.riskRewardRatio ? (
                  <div className="text-[10px] font-mono text-emerald-400 font-semibold">
                    1 : {item.riskRewardRatio} R:R
                  </div>
                ) : null}
              </div>
            </div>

            {/* Levels Bar */}
            <div className="grid grid-cols-3 gap-1.5 mt-3 py-2 px-2.5 rounded-xl bg-[#0D0E14] border border-white/[0.04] text-[11px] font-mono">
              <div>
                <span className="text-[9px] text-slate-500 uppercase block">Trigger</span>
                <span className="font-bold text-slate-200">{trig ? `₹${trig}` : '-'}</span>
              </div>
              <div>
                <span className="text-[9px] text-red-400/80 uppercase block">Stop Loss</span>
                <span className="font-bold text-red-300">{item.stopLoss ? `₹${item.stopLoss}` : '-'}</span>
              </div>
              <div>
                <span className="text-[9px] text-emerald-400/80 uppercase block">Target 1</span>
                <span className="font-bold text-emerald-300">{item.target1 || item.targetSellPrice ? `₹${item.target1 || item.targetSellPrice}` : '-'}</span>
              </div>
            </div>

            {/* Catalyst Tags */}
            {item.catalystTags && item.catalystTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2.5">
                {item.catalystTags.map((tag) => (
                  <span key={tag} className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-white/[0.03] text-slate-400 border border-white/[0.04]">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Notes */}
            {item.notes && (
              <div className="text-[11px] text-slate-400 italic mt-2 line-clamp-1">
                "{item.notes}"
              </div>
            )}

            {/* Verdict & Signal Match Strip */}
            <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-white/[0.04] flex-wrap text-xs">
              {lastV ? (
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  lastV.verdict.includes('BUY') ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' :
                  lastV.verdict.includes('SELL') ? 'bg-red-500/15 text-red-400 border border-red-500/20' :
                  'bg-slate-800 text-slate-300'
                }`}>
                  {lastV.verdict.replace('_', ' ')} · {lastV.score}
                </span>
              ) : (
                <span className="text-[10px] text-slate-500">No verdict</span>
              )}

              {matchingSignals[item.ticker.toUpperCase()] && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                  🎯 Telegram Signal Match
                </span>
              )}

              {/* Direct Punch Sandbox Button */}
              <button
                onClick={() => handlePunchSandbox(item)}
                disabled={isPunching}
                className="ml-auto px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 flex items-center gap-1 transition-all"
                title="Punch into OpenAlgo Sandbox"
              >
                <Zap size={11} />
                <span>{isPunching ? 'Punching...' : '⚡ Punch Sandbox'}</span>
              </button>
            </div>

            {/* Card Action Controls */}
            <div className="flex items-center justify-between gap-1 mt-3 pt-2 border-t border-white/[0.04] text-xs">
              {resolvingId === item.id ? (
                <div className="flex items-center gap-1.5 w-full">
                  <button 
                    onClick={() => handleResolve(item, true)} 
                    className="flex-1 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] font-bold"
                  >
                    Win
                  </button>
                  <button 
                    onClick={() => handleResolve(item, false)} 
                    className="flex-1 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[10px] font-bold"
                  >
                    Loss
                  </button>
                  <button 
                    onClick={() => setResolvingId(null)} 
                    className="px-2 py-1 rounded-lg bg-white/5 text-slate-400 text-[10px]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onRunVerdict(item)}
                      disabled={isRunning}
                      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-[10px] flex items-center gap-1"
                      title="Run quantitative verdict"
                    >
                      <Play size={10} />
                      <span className="hidden sm:inline">Verdict</span>
                    </button>
                    <button
                      onClick={() => onRunAIAnalysis(item.ticker)}
                      disabled={analyzingTickers.has(item.ticker)}
                      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-[10px] flex items-center gap-1"
                      title="Run AI technical analysis"
                    >
                      <Sparkles size={10} />
                      <span className="hidden sm:inline">AI</span>
                    </button>
                    <button
                      onClick={() => setActiveGttItem(item)}
                      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-[10px]"
                      title="Set Upstox GTT order"
                    >
                      GTT
                    </button>
                    <button
                      onClick={() => setActivePineItem(item)}
                      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-[10px]"
                      title="Pine Script"
                    >
                      Pine
                    </button>
                    <button
                      onClick={() => setSizerItem(item)}
                      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-[10px]"
                      title="Position Sizer"
                    >
                      <Activity size={10} />
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleAlert(item.id!, item.alertEnabled !== 1)}
                      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200"
                      title="Toggle alert"
                    >
                      {item.alertEnabled === 1 ? <Bell size={12} className="text-indigo-400" /> : <BellOff size={12} />}
                    </button>
                    {onEdit && (
                      <button
                        onClick={() => onEdit(item)}
                        className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200"
                        title="Edit item"
                      >
                        <Edit2 size={12} />
                      </button>
                    )}
                    <button
                      onClick={() => onRemove(item)}
                      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-red-500/20 text-slate-400 hover:text-red-400"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        );
      })}

      <PositionSizerModal
        isOpen={sizerItem !== null}
        signal={sizerItem ? buildSizerSignal(sizerItem) : null}
        source="POOL"
        onClose={() => setSizerItem(null)}
      />

      <TradingViewPineScriptDialog
        isOpen={activePineItem !== null}
        onClose={() => setActivePineItem(null)}
        symbol={activePineItem?.ticker || ''}
        entryPrice={activePineItem?.targetBuyPrice}
        target1={activePineItem?.targetSellPrice}
        stopLoss={activePineItem?.stopLoss}
      />

      <UpstoxGTTDialog
        isOpen={activeGttItem !== null}
        onClose={() => setActiveGttItem(null)}
        symbol={activeGttItem?.ticker || ''}
        instrumentKey={activeGttItem?.instrumentKey}
        defaultPrice={activeGttItem?.lastPrice || activeGttItem?.targetBuyPrice || 0}
        stopLoss={activeGttItem?.stopLoss}
        target1={activeGttItem?.targetSellPrice}
      />
    </motion.div>
  );
};

function buildSizerSignal(item: PoolItemExtended): TelegramParsedSignal {
  return {
    rawSignal: '',
    confidence: 0.7,
    action: 'BUY',
    tradingSymbol: item.ticker,
    suggestedEntryPrice: item.lastPrice ?? 0,
    stopLoss: item.stopLoss ?? 0,
    targets: item.targetSellPrice ? [item.targetSellPrice] : [],
    productType: 'INTRADAY',
    exchangeSegment: (item.exchange as TelegramParsedSignal['exchangeSegment']) || 'NSE_EQ',
  };
}

export default PoolWatchGrid;
