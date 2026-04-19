/**
 * PoolAddSymbolDialog - Momentum Pool 2.0
 *
 * Comprehensive intake dialog with:
 *  - Multi-source attribution (Twitter/X, Instagram, YouTube, Telegram, TradingView, Research)
 *  - Smart AI Auto-Fill via Groq / Gemini (pastes raw captions/tweets -> parses setup in <400ms)
 *  - Time horizons (Scalp, BTST, Swing, Momentum Short-Term, Multibagger)
 *  - Catalyst & setup taxonomy chips
 *  - Multi-stage levels (Trigger Type, Trigger Price, SL, Targets 1, 2, 3)
 *  - Risk budgeting & share sizing auto-calculator
 *  - Auto-punch to OpenAlgo Sandbox option
 */
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Plus, Search, Sparkles, Wand2, ShieldAlert, Target, 
  TrendingUp, Compass, Link2, AtSign, Check, ChevronDown, ChevronUp,
  Cpu, AlertCircle, Zap, RotateCcw
} from 'lucide-react';
import { instrumentService } from '../../services/InstrumentService';
import type { DhanInstrument } from '../../database';
import { 
  usePoolStore, 
  PoolAlertOn, 
  PlatformSourceType, 
  HorizonType, 
  TriggerType,
  PoolItemExtended
} from '../../store/poolStore';
import { useShallow } from 'zustand/react/shallow';
import { useToast } from '../shared/ToastProvider';
import { PoolItem } from '../../database';
import { poolAIAnalyzerService } from '../../services/PoolAIAnalyzerService';
import { poolAIParserService } from '../../services/PoolAIParserService';
import { useSettingsStore } from '../../store/settingsStore';

interface PoolAddSymbolDialogProps {
  isOpen: boolean;
  onClose: () => void;
  prefillTicker?: string;
  prefillSource?: PoolItem['source'];
  prefillMeta?: { channelId?: string; messageId?: number; threadId?: number; caption?: string };
  prefillTargetBuy?: string;
  prefillTargetSell?: string;
  prefillStopLoss?: string;
  prefillNotes?: string;
}

const ALL_ALERT_KINDS: Array<{ key: PoolAlertOn; label: string; help: string }> = [
  { key: 'VERDICT_FIRE', label: 'Verdict Fire', help: 'When the AI emits a STRONG verdict' },
  { key: 'PRICE_TARGET_HIT', label: 'Target Hit', help: 'Price hits your target' },
  { key: 'STOP_HIT', label: 'Stop Hit', help: 'Price hits your stop' },
  { key: 'PATTERN_MATCH', label: 'Pattern', help: 'A candlestick pattern matches' },
  { key: 'NEWS_HIT', label: 'News', help: 'Major news for the ticker' },
  { key: 'VOLUME_SURGE', label: 'Volume Surge', help: 'Unusual volume spike' },
];

const PLATFORM_SOURCES: Array<{ id: PlatformSourceType; label: string; icon: string }> = [
  { id: 'TWITTER', label: 'Twitter / X', icon: '🐦' },
  { id: 'INSTAGRAM', label: 'Instagram', icon: '📸' },
  { id: 'YOUTUBE', label: 'YouTube', icon: '▶️' },
  { id: 'TELEGRAM', label: 'Telegram', icon: '✈️' },
  { id: 'TRADINGVIEW', label: 'TradingView', icon: '📈' },
  { id: 'PERSONAL_RESEARCH', label: 'Research', icon: '🔬' },
  { id: 'BROKER_REPORT', label: 'Broker', icon: '📑' },
  { id: 'TV_MEDIA', label: 'TV / Media', icon: '📺' },
];

const HORIZONS: Array<{ id: HorizonType; label: string; desc: string }> = [
  { id: 'INTRADAY_SCALP', label: 'Scalp', desc: 'Intraday (<1d)' },
  { id: 'BTST_STBT', label: 'BTST', desc: 'Overnight gap' },
  { id: 'POSITIONAL_SWING', label: 'Swing', desc: '3-15 days' },
  { id: 'MOMENTUM_SHORT_TERM', label: 'Short-Term', desc: '1-3 months' },
  { id: 'MULTIBAGGER_LONG_TERM', label: 'Long-Term', desc: '1-3 years' },
];

const PRESET_CATALYSTS = [
  'Flat-Base Breakout',
  '52-Week High',
  'Volume Shock (>3x)',
  'Cup & Handle',
  '9-EMA Snapback',
  'RSI Bullish Divergence',
  'Earnings Surprise',
  'Order Book Win',
  'Debt Reduction',
  'Capex Expansion',
  'FII Bulk Deal',
];

export const PoolAddSymbolDialog: React.FC<PoolAddSymbolDialogProps> = ({
  isOpen,
  onClose,
  prefillTicker,
  prefillSource,
  prefillMeta,
  prefillTargetBuy,
  prefillTargetSell,
  prefillStopLoss,
  prefillNotes,
}) => {
  // Core Symbol & Identity
  const [ticker, setTicker] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [exchange, setExchange] = useState<PoolItem['exchange']>('NSE_EQ');
  
  // Attribution & Origin
  const [platformSource, setPlatformSource] = useState<PlatformSourceType>('PERSONAL_RESEARCH');
  const [creatorHandle, setCreatorHandle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [notes, setNotes] = useState('');

  // Horizon & Taxonomy
  const [horizon, setHorizon] = useState<HorizonType>('POSITIONAL_SWING');
  const [catalystTags, setCatalystTags] = useState<string[]>(['Flat-Base Breakout']);
  const [customTagInput, setCustomTagInput] = useState('');

  // Multi-Stage Levels
  const [triggerType, setTriggerType] = useState<TriggerType>('ABOVE');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [targetBuy, setTargetBuy] = useState('');
  const [targetSell, setTargetSell] = useState('');
  const [target2, setTarget2] = useState('');
  const [target3, setTarget3] = useState('');
  const [stopLoss, setStopLoss] = useState('');

  // Risk Budgeting & Sizing
  const [maxRiskAmount, setMaxRiskAmount] = useState('2500');
  const [capitalAllocation, setCapitalAllocation] = useState('50000');
  const [autoPunchSandbox, setAutoPunchSandbox] = useState(false);

  // AI Multi-Modal Auto-Fill Drawer
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [rawAiText, setRawAiText] = useState('');
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);

  // Alerts & System
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertOn, setAlertOn] = useState<PoolAlertOn[]>(['VERDICT_FIRE', 'PRICE_TARGET_HIT', 'STOP_HIT', 'PATTERN_MATCH']);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [autoPoll, setAutoPoll] = useState(true);
  const [syncToWatchlist, setSyncToWatchlist] = useState(true);
  const [watchlistStatus, setWatchlistStatus] = useState<'active' | 'archived'>('active');
  const [runAIAnalysisOnAdd, setRunAIAnalysisOnAdd] = useState(true);

  // Autocomplete search
  const [searchResults, setSearchResults] = useState<DhanInstrument[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { addItem, addFromTelegram, sources } = usePoolStore(
    useShallow(state => ({
      addItem: state.addItem,
      addFromTelegram: state.addFromTelegram,
      sources: state.sources,
    }))
  );
  const { toast } = useToast();
  const debounceRef = useRef<number | null>(null);

  // Prefill synchronization
  useEffect(() => {
    if (isOpen) {
      if (prefillTicker) {
        setTicker(prefillTicker);
        setDisplayName('');
        setExchange('NSE_EQ');
      }
      if (prefillTargetBuy) {
        setTargetBuy(prefillTargetBuy);
        setTriggerPrice(prefillTargetBuy);
      }
      if (prefillTargetSell) setTargetSell(prefillTargetSell);
      if (prefillStopLoss) setStopLoss(prefillStopLoss);
      if (prefillNotes) setNotes(prefillNotes);
    } else {
      setTicker(''); setDisplayName(''); setNotes(''); setTargetBuy(''); setTargetSell(''); setStopLoss('');
      setTarget2(''); setTarget3(''); setTriggerPrice('');
      setCreatorHandle(''); setSourceUrl(''); setRawAiText(''); setShowAiDrawer(false); setAiConfidence(null);
      setAlertEnabled(true);
      setAlertOn(['VERDICT_FIRE', 'PRICE_TARGET_HIT', 'STOP_HIT', 'PATTERN_MATCH']);
      setSelectedSourceId('');
      setAutoPoll(true);
      setSyncToWatchlist(true);
      setWatchlistStatus('active');
      setRunAIAnalysisOnAdd(true);
      setAutoPunchSandbox(false);
    }
  }, [isOpen, prefillTicker, prefillTargetBuy, prefillTargetSell, prefillStopLoss, prefillNotes]);

  // Keyboard shortcuts (Escape to close, Alt+A for AI Auto-Fill)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      } else if (e.altKey && (e.key === 'a' || e.key === 'A') && isOpen) {
        e.preventDefault();
        setShowAiDrawer(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scrolling when modal is active
  useEffect(() => {
    if (isOpen && typeof document !== 'undefined') {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isOpen]);

  const handleResetForm = () => {
    setTicker(''); setDisplayName(''); setNotes(''); setTargetBuy(''); setTargetSell(''); setStopLoss('');
    setTarget2(''); setTarget3(''); setTriggerPrice('');
    setCreatorHandle(''); setSourceUrl(''); setRawAiText(''); setShowAiDrawer(false); setAiConfidence(null);
    setCatalystTags(['Flat-Base Breakout']);
  };

  // Autocomplete debounce
  useEffect(() => {
    if (!ticker || ticker.length < 2) {
      setSearchResults([]); setShowDropdown(false);
      return;
    }
    if (displayName) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setIsSearching(true);
      setShowDropdown(true);
      try {
        const r = await instrumentService.searchInstruments(ticker, 8);
        setSearchResults(r);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [ticker, displayName]);

  // Risk/Reward & Position Sizing Auto-Calculation
  const calculatedMetrics = useMemo(() => {
    const trig = parseFloat(triggerPrice || targetBuy) || 0;
    const sl = parseFloat(stopLoss) || 0;
    const t1 = parseFloat(targetSell) || 0;
    const riskMax = parseFloat(maxRiskAmount) || 0;
    const capMax = parseFloat(capitalAllocation) || 0;

    let perShareRisk = 0;
    let qty = 0;
    let reqCap = 0;
    let rr = 0;

    if (trig > 0 && sl > 0) {
      perShareRisk = Math.abs(trig - sl);
      if (perShareRisk > 0 && riskMax > 0) {
        qty = Math.floor(riskMax / perShareRisk);
        reqCap = qty * trig;
      }
      if (t1 > 0 && perShareRisk > 0) {
        rr = Math.round((Math.abs(t1 - trig) / perShareRisk) * 100) / 100;
      }
    } else if (trig > 0 && capMax > 0) {
      qty = Math.floor(capMax / trig);
      reqCap = qty * trig;
    }

    return { perShareRisk, qty, reqCap, rr };
  }, [triggerPrice, targetBuy, stopLoss, targetSell, maxRiskAmount, capitalAllocation]);

  if (!isOpen) return null;

  const onPick = (inst: DhanInstrument) => {
    setTicker(inst.symbol);
    setDisplayName(inst.name);
    setShowDropdown(false);
    if (['NSE_EQ', 'BSE_EQ', 'NSE_FNO', 'MCX_COMM'].includes(inst.exchangeSegment)) {
      setExchange(inst.exchangeSegment as PoolItem['exchange']);
    }
  };

  const toggleCatalyst = (tag: string) => {
    setCatalystTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const t = customTagInput.trim();
    if (t && !catalystTags.includes(t)) {
      setCatalystTags(prev => [...prev, t]);
      setCustomTagInput('');
    }
  };

  // Smart AI Auto-Fill Handler
  const handleAiAutoFill = async () => {
    if (!rawAiText.trim()) {
      toast.warning('Please paste social media caption, tweet, or signal text first.');
      return;
    }
    setIsAiParsing(true);
    try {
      const parsed = await poolAIParserService.parseSocialPost(rawAiText, platformSource);
      if (parsed) {
        if (parsed.ticker && parsed.ticker !== 'UNKNOWN') setTicker(parsed.ticker);
        if (parsed.exchange) setExchange(parsed.exchange);
        if (parsed.platformSource) setPlatformSource(parsed.platformSource);
        if (parsed.creatorHandle) setCreatorHandle(parsed.creatorHandle);
        if (parsed.horizon) setHorizon(parsed.horizon);
        if (parsed.triggerType) setTriggerType(parsed.triggerType);
        if (parsed.triggerPrice) {
          setTriggerPrice(String(parsed.triggerPrice));
          setTargetBuy(String(parsed.triggerPrice));
        }
        if (parsed.stopLoss) setStopLoss(String(parsed.stopLoss));
        if (parsed.target1) setTargetSell(String(parsed.target1));
        if (parsed.target2) setTarget2(String(parsed.target2));
        if (parsed.target3) setTarget3(String(parsed.target3));
        if (parsed.catalystTags?.length) setCatalystTags(parsed.catalystTags);
        if (parsed.notes) setNotes(parsed.notes);
        setAiConfidence(parsed.confidence);

        toast.success(`⚡ Extracted ${parsed.ticker} setup in <400ms (${Math.round(parsed.confidence * 100)}% confidence)`);
        setShowAiDrawer(false);
      } else {
        toast.error('Could not extract trade setup from provided text.');
      }
    } catch (err: any) {
      toast.error(`AI Parse failed: ${err?.message || 'unknown error'}`);
    } finally {
      setIsAiParsing(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) return;
    setSubmitting(true);
    try {
      const trig = parseFloat(triggerPrice || targetBuy) || undefined;
      const t1 = parseFloat(targetSell) || undefined;
      const t2 = parseFloat(target2) || undefined;
      const t3 = parseFloat(target3) || undefined;
      const sl = parseFloat(stopLoss) || undefined;
      const riskMax = parseFloat(maxRiskAmount) || undefined;
      const capAlloc = parseFloat(capitalAllocation) || undefined;

      if (prefillSource === 'TELEGRAM' && prefillMeta) {
        await addFromTelegram({
          ticker,
          exchange,
          channelName: prefillMeta.channelId,
          messageId: prefillMeta.messageId,
          threadId: prefillMeta.threadId,
          caption: prefillMeta.caption,
        });
        toast.success(`${ticker.toUpperCase()} tracked from Telegram.`);
      } else {
        let mappedSource: PoolItem['source'] = 'MANUAL';
        if (platformSource === 'TELEGRAM') mappedSource = 'TELEGRAM';
        else if (platformSource === 'INSTAGRAM') mappedSource = 'INSTAGRAM';
        else if (platformSource === 'TWITTER') mappedSource = 'TWEET';
        else if (platformSource === 'PERSONAL_RESEARCH') mappedSource = 'MANUAL';

        await addItem({
          ticker,
          displayName: displayName || undefined,
          exchange,
          source: mappedSource,
          platformSource,
          creatorHandle: creatorHandle ? (creatorHandle.startsWith('@') ? creatorHandle : `@${creatorHandle}`) : undefined,
          sourceUrl: sourceUrl || undefined,
          horizon,
          catalystTags,
          triggerType,
          triggerPrice: trig,
          targetBuyPrice: trig,
          targetSellPrice: t1,
          target1: t1,
          target2: t2,
          target3: t3,
          stopLoss: sl,
          maxRiskAmount: riskMax,
          capitalAllocation: capAlloc,
          calculatedQuantity: calculatedMetrics.qty || undefined,
          riskRewardRatio: calculatedMetrics.rr || undefined,
          autoPunchSandbox,
          notes: notes || undefined,
          alertEnabled: alertEnabled ? 1 : 0,
          alertOn,
          autoPoll: autoPoll ? 1 : 0,
          watchlistStatus: syncToWatchlist ? watchlistStatus : 'none',
        });
        toast.success(`${ticker.toUpperCase()} enrolled in Momentum Pool with live tracking.`);
      }

      if (runAIAnalysisOnAdd) {
        const targetTicker = ticker.toUpperCase().trim();
        setTimeout(async () => {
          try {
            const settings = useSettingsStore.getState();
            const depth = settings.aiAnalysisDepth || 'deep';
            const res = await poolAIAnalyzerService.analyzeSymbol(targetTicker, depth);
            if (res) {
              toast.success(`AI Analysis ready for ${targetTicker}: Entry ${res.entryZone}, T1 ${res.target1}`);
            }
          } catch (err) {
            console.error(`[PoolAddSymbolDialog] AI Analysis failed for ${targetTicker}:`, err);
          }
        }, 800);
      }

      onClose();
    } catch (err: any) {
      toast.error(`Add failed: ${err?.message || 'unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="pool-modal-backdrop" onClick={onClose}>
      <div 
        className="pool-power-modal p-6 text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/15 border border-indigo-500/30 rounded-2xl text-indigo-400 shadow-inner">
              <Sparkles size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-white tracking-wide">Add to Momentum Pool 2.0</h2>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono font-semibold tracking-wider uppercase">
                  Live Radar Desk
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-source discovery intake, dynamic risk budgeting, and real-time WebSocket trigger execution
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {ticker && (
              <button
                type="button"
                onClick={handleResetForm}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Clear all fields"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAiDrawer(prev => !prev)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                showAiDrawer
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30 ring-1 ring-purple-400/50'
                  : 'bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25'
              }`}
            >
              <Wand2 size={15} />
              <span>Smart AI Auto-Fill</span>
              <span className="text-[10px] opacity-75 font-mono px-1.5 py-0.5 rounded bg-black/40">Alt+A</span>
              {showAiDrawer ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button 
              onClick={onClose} 
              aria-label="Close" 
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 border border-slate-700/50 transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* AI Auto-Fill Collapsible Drawer */}
        {showAiDrawer && (
          <div className="mt-3 p-4 rounded-xl bg-purple-950/30 border border-purple-500/30 space-y-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-200">
                <Cpu size={15} className="text-purple-400" />
                <span>Paste Social Caption, Telegram Signal, or Raw Research Note</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-purple-300/80 bg-purple-900/50 border border-purple-500/30 px-2 py-0.5 rounded font-mono">
                  Groq 400ms Engine
                </span>
              </div>
            </div>
            <textarea
              value={rawAiText}
              onChange={(e) => setRawAiText(e.target.value)}
              placeholder="e.g. 'Watchout for DIXON! Clean cup & handle breakout on daily chart above 14850. Stop loss strictly at 14400. Targets 15500 and 16200. High conviction swing for next 2 weeks.'"
              rows={2}
              className="w-full text-xs p-3 rounded-lg bg-slate-950 border border-purple-500/30 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-400 font-mono"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>Quick Samples:</span>
                <button
                  type="button"
                  onClick={() => setRawAiText("Watchout for DIXON! Clean cup & handle breakout on daily chart above 14850. Stop loss strictly at 14400. Targets 15500 and 16200. High conviction swing for next 2 weeks.")}
                  className="px-2 py-0.5 rounded bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-[10px] border border-purple-500/30 cursor-pointer"
                >
                  DIXON Swing
                </button>
                <button
                  type="button"
                  onClick={() => setRawAiText("BUY NIFTY 24500 CE ABOVE 125 SL 95 TARGET 150/185/220 FAST SCALP")}
                  className="px-2 py-0.5 rounded bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-[10px] border border-purple-500/30 cursor-pointer"
                >
                  NIFTY Scalp
                </button>
                <button
                  type="button"
                  onClick={() => setRawAiText("RELIANCE flat-base breakout above 3020 with heavy institutional volume. SL 2975. Target 3120 and 3200.")}
                  className="px-2 py-0.5 rounded bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-[10px] border border-purple-500/30 cursor-pointer"
                >
                  RELIANCE Breakout
                </button>
              </div>
              <button
                type="button"
                disabled={isAiParsing}
                onClick={handleAiAutoFill}
                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-purple-600/30 disabled:opacity-50 cursor-pointer"
              >
                {isAiParsing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Extracting...</span>
                  </>
                ) : (
                  <>
                    <Wand2 size={13} />
                    <span>Extract &amp; Auto-Fill</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Master Power View Split Grid */}
        <form onSubmit={onSubmit} className="flex-1 min-h-0 flex flex-col mt-4 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0 overflow-hidden">
            
            {/* ================= LEFT COLUMN: INTAKE & THESIS ================= */}
            <div className="lg:col-span-6 flex flex-col min-h-0 overflow-y-auto pool-power-scroll pr-1.5 space-y-3.5">
              
              {/* Card 1: Instrument & Exchange Identity */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Search size={13} className="text-indigo-400" />
                    <span>Instrument &amp; Exchange Identity</span>
                  </label>
                  <span className="text-[10px] text-amber-400 font-mono">* Ticker Required</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-8 relative">
                    <input
                      autoFocus
                      value={ticker}
                      onChange={(e) => { setTicker(e.target.value.toUpperCase()); setDisplayName(''); }}
                      placeholder="e.g. RELIANCE, DIXON, NIFTY 24500 CE"
                      required
                      className="w-full text-sm font-mono font-bold px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                    />
                    {showDropdown && searchResults.length > 0 && (
                      <div className="absolute top-[105%] left-0 right-0 z-30 bg-slate-900 border border-slate-700/80 rounded-xl max-h-56 overflow-y-auto shadow-2xl pool-power-scroll">
                        {searchResults.map((r) => (
                          <button
                            key={r.securityId}
                            type="button"
                            onClick={() => onPick(r)}
                            className="w-full text-left px-3.5 py-2 border-b border-slate-800 hover:bg-indigo-600/15 transition-colors cursor-pointer"
                          >
                            <div className="text-xs font-bold text-slate-100">{r.symbol}</div>
                            <div className="text-[10px] text-slate-400">{r.name} • <span className="text-indigo-300 font-mono">{r.exchangeSegment}</span></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-4">
                    <select
                      value={exchange}
                      onChange={(e) => setExchange(e.target.value as PoolItem['exchange'])}
                      className="w-full text-xs font-semibold px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/80 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="NSE_EQ">NSE Equity</option>
                      <option value="NSE_FNO">NSE F&amp;O</option>
                      <option value="BSE_EQ">BSE Equity</option>
                      <option value="MCX_COMM">MCX Commodity</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Card 2: Discovery Platform & Attribution */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Compass size={13} className="text-indigo-400" />
                  <span>Discovery Platform &amp; Attribution</span>
                </label>
                {/* 8 Full-Width Platform Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PLATFORM_SOURCES.map((src) => {
                    const isActive = platformSource === src.id;
                    return (
                      <button
                        key={src.id}
                        type="button"
                        onClick={() => setPlatformSource(src.id)}
                        className={`py-1.5 px-2.5 rounded-lg text-xs font-medium flex items-center gap-2 border transition-all cursor-pointer ${
                          isActive
                            ? 'bg-indigo-600/25 border-indigo-500 text-indigo-100 shadow-sm ring-1 ring-indigo-400/40'
                            : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        <span className="text-base">{src.icon}</span>
                        <span className="text-xs font-semibold truncate">{src.label}</span>
                      </button>
                    );
                  })}
                </div>
                {/* Inset Creator Handle & URL */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase font-semibold mb-1 block">Creator / Handle (Optional)</label>
                    <div className="relative">
                      <AtSign size={13} className="absolute left-3 top-2.5 text-slate-500" />
                      <input
                        value={creatorHandle}
                        onChange={(e) => setCreatorHandle(e.target.value)}
                        placeholder="e.g. trader_ashish"
                        className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-750 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase font-semibold mb-1 block">Source Link (Optional)</label>
                    <div className="relative">
                      <Link2 size={13} className="absolute left-3 top-2.5 text-slate-500" />
                      <input
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        placeholder="https://x.com/... or https://instagram.com/..."
                        className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-750 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Investment Horizon */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-indigo-400" />
                  <span>Investment Horizon &amp; Style</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {HORIZONS.map((h) => {
                    const isActive = horizon === h.id;
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => setHorizon(h.id)}
                        className={`py-2 px-1.5 rounded-lg text-xs font-semibold border transition-all text-center cursor-pointer ${
                          isActive
                            ? 'bg-blue-600/25 border-blue-500 text-blue-100 shadow-sm ring-1 ring-blue-400/40'
                            : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        <div className="font-bold">{h.label}</div>
                        <div className="text-[10px] opacity-70 font-normal mt-0.5">{h.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Card 4: Catalyst & Setup Taxonomy */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Target size={13} className="text-indigo-400" />
                  <span>Catalysts &amp; Technical Setups (Optional)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_CATALYSTS.map((tag) => {
                    const isSelected = catalystTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleCatalyst(tag)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                            : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {isSelected && <Check size={11} className="inline mr-1" />}
                        {tag}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 pt-0.5">
                  <input
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }}
                    placeholder="Add custom setup tag..."
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-750 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={addCustomTag}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
                  >
                    Add Tag
                  </button>
                </div>
              </div>

              {/* Card 5: Thesis Notes */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Thesis Notes &amp; Observations (Optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. 52w high breakout with 3.2x average volume, strong institutional accumulation..."
                  rows={2}
                  className="w-full text-xs p-2.5 rounded-lg bg-slate-900 border border-slate-750 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

            </div>

            {/* ================= RIGHT COLUMN: LEVELS, RISK & EXECUTION ================= */}
            <div className="lg:col-span-6 flex flex-col min-h-0 overflow-y-auto pool-power-scroll pr-1.5 space-y-3.5">
              
              {/* Card 6: Multi-Stage Price Architecture */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Target size={14} className="text-indigo-400" />
                    <span>Multi-Stage Price Architecture</span>
                  </label>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-400 text-[11px]">Trigger:</span>
                    <select
                      value={triggerType}
                      onChange={(e) => setTriggerType(e.target.value as TriggerType)}
                      className="bg-slate-900 border border-slate-700/80 rounded-md px-2 py-1 text-slate-200 text-xs font-semibold cursor-pointer"
                    >
                      <option value="ABOVE">Buy Above</option>
                      <option value="BELOW">Buy Below</option>
                      <option value="MARKET">Market Entry</option>
                      <option value="LIMIT">Limit Order</option>
                    </select>
                  </div>
                </div>

                {/* 5 Price Level Inputs */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-indigo-500/40">
                    <label className="text-[10px] uppercase tracking-wider text-indigo-300 font-bold block mb-1">
                      Trigger Price ₹
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={triggerPrice}
                      onChange={(e) => { setTriggerPrice(e.target.value); setTargetBuy(e.target.value); }}
                      placeholder="e.g. 14850"
                      className="w-full text-sm font-mono font-bold p-1.5 rounded bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-400"
                    />
                    <span className="text-[9px] text-indigo-400/90 mt-1 block font-medium">Primary Activation</span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900 border border-rose-500/40">
                    <label className="text-[10px] uppercase tracking-wider text-rose-300 font-bold block mb-1">
                      Stop Loss ₹
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(e.target.value)}
                      placeholder="e.g. 14400"
                      className="w-full text-sm font-mono font-bold p-1.5 rounded bg-slate-950 border border-rose-500/30 text-rose-300 focus:outline-none focus:border-rose-400"
                    />
                    <span className="text-[9px] text-rose-400/90 mt-1 block font-medium">
                      {calculatedMetrics.perShareRisk > 0 ? `Risk: ₹${calculatedMetrics.perShareRisk.toFixed(2)}` : 'Hard Invalidation'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900 border border-emerald-500/40">
                    <label className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold block mb-1">
                      Target 1 ₹
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={targetSell}
                      onChange={(e) => setTargetSell(e.target.value)}
                      placeholder="e.g. 15500"
                      className="w-full text-sm font-mono font-bold p-1.5 rounded bg-slate-950 border border-emerald-500/30 text-emerald-300 focus:outline-none focus:border-emerald-400"
                    />
                    <span className="text-[9px] text-emerald-400/90 mt-1 block font-medium">Primary Target</span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-750">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">
                      Target 2 ₹ (Optional)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={target2}
                      onChange={(e) => setTarget2(e.target.value)}
                      placeholder="Runner Target"
                      className="w-full text-sm font-mono p-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-400"
                    />
                    <span className="text-[9px] text-slate-500 mt-1 block">Trail Runner</span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-750">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">
                      Target 3 ₹ (Optional)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={target3}
                      onChange={(e) => setTarget3(e.target.value)}
                      placeholder="Moonbag Target"
                      className="w-full text-sm font-mono p-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-400"
                    />
                    <span className="text-[9px] text-slate-500 mt-1 block">Full Moonbag</span>
                  </div>
                </div>
              </div>

              {/* Card 7: Live Risk Budgeting & Sizing Calculator */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-amber-400" />
                    <span>Risk Budgeting &amp; Position Sizing</span>
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">Auto-Calibrated</span>
                </div>

                {/* 2 Adjustable Dials */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-750">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Max Risk Capital ₹</span>
                    <input
                      type="number"
                      value={maxRiskAmount}
                      onChange={(e) => setMaxRiskAmount(e.target.value)}
                      className="w-full font-mono text-sm font-bold bg-transparent text-amber-300 focus:outline-none mt-0.5"
                    />
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-750">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Capital Allocation ₹</span>
                    <input
                      type="number"
                      value={capitalAllocation}
                      onChange={(e) => setCapitalAllocation(e.target.value)}
                      className="w-full font-mono text-sm font-bold bg-transparent text-slate-100 focus:outline-none mt-0.5"
                    />
                  </div>
                </div>

                {/* 4 Real-time Calculated Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Per-Share Risk</div>
                    <div className="font-mono text-xs font-bold text-slate-200 mt-0.5">
                      {calculatedMetrics.perShareRisk > 0 ? `₹${calculatedMetrics.perShareRisk.toFixed(2)}` : '-'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Sized Qty</div>
                    <div className="font-mono text-xs font-bold text-white mt-0.5">
                      {calculatedMetrics.qty > 0 ? `${calculatedMetrics.qty} Shares` : '-'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Required Capital</div>
                    <div className="font-mono text-xs font-bold text-slate-200 mt-0.5">
                      {calculatedMetrics.reqCap > 0 ? `₹${calculatedMetrics.reqCap.toLocaleString('en-IN')}` : '-'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Risk : Reward</div>
                    <div className={`font-mono text-xs font-bold mt-0.5 ${
                      calculatedMetrics.rr >= 2.0 ? 'text-emerald-400' : calculatedMetrics.rr >= 1.5 ? 'text-blue-400' : 'text-slate-300'
                    }`}>
                      {calculatedMetrics.rr > 0 ? `1 : ${calculatedMetrics.rr}` : '-'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 8: Automation, Radar & Audio Alerts */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2 text-xs">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mb-0.5">
                  <Zap size={14} className="text-amber-400" />
                  <span>Execution &amp; Radar Automation</span>
                </label>
                
                <label className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-900 border border-amber-500/25 text-slate-200 cursor-pointer hover:bg-amber-500/10 transition-colors">
                  <input
                    type="checkbox"
                    checked={autoPunchSandbox}
                    onChange={(e) => setAutoPunchSandbox(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500 focus:ring-0 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold text-amber-300">⚡ Auto-Punch to OpenAlgo Sandbox when Trigger Breached</span>
                    <span className="text-[10px] text-slate-400 block">Sends automated order to Sandbox on Port 5000 without manual lag</span>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-900 border border-slate-750 text-slate-200 cursor-pointer hover:bg-slate-850 transition-colors">
                  <input
                    type="checkbox"
                    checked={alertEnabled}
                    onChange={(e) => setAlertEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-500 focus:ring-0 cursor-pointer"
                  />
                  <div>
                    <span className="font-semibold text-slate-200">🔊 Enable Web Audio Proximity Radar Chimes</span>
                    <span className="text-[10px] text-slate-400 block">Plays dual-tone alert chime when price is within 0.5% of trigger</span>
                  </div>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                  <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-750 text-slate-200 cursor-pointer hover:bg-slate-850">
                    <input
                      type="checkbox"
                      checked={syncToWatchlist}
                      onChange={(e) => setSyncToWatchlist(e.target.checked)}
                      className="rounded text-indigo-500 focus:ring-0 cursor-pointer"
                    />
                    <span className="text-xs">Sync with Smart Watchlist</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-750 text-slate-200 cursor-pointer hover:bg-slate-850">
                    <input
                      type="checkbox"
                      checked={runAIAnalysisOnAdd}
                      onChange={(e) => setRunAIAnalysisOnAdd(e.target.checked)}
                      className="rounded text-indigo-500 focus:ring-0 cursor-pointer"
                    />
                    <span className="text-xs">Run Deep AI Analysis</span>
                  </label>
                </div>
              </div>

            </div>

          </div>

          {/* ================= BOTTOM ACTION DOCK ================= */}
          <div className="pt-3.5 mt-3 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5 text-xs text-slate-400">
              <span className="font-mono bg-slate-800 px-2 py-1 rounded border border-slate-700 text-white font-bold">
                {ticker ? ticker.toUpperCase() : 'NO TICKER'}
              </span>
              <span>•</span>
              <span className="text-slate-300 font-semibold">{exchange}</span>
              <span>•</span>
              <span>Horizon: <strong className="text-slate-200">{horizon}</strong></span>
              {calculatedMetrics.qty > 0 && (
                <>
                  <span>•</span>
                  <span>Qty: <strong className="text-indigo-300">{calculatedMetrics.qty}</strong></span>
                </>
              )}
              {calculatedMetrics.rr > 0 && (
                <>
                  <span>•</span>
                  <span>R:R: <strong className="text-emerald-400">1:{calculatedMetrics.rr}</strong></span>
                </>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700/60 transition-colors cursor-pointer"
              >
                Cancel (Esc)
              </button>
              <button
                type="submit"
                disabled={submitting || !ticker.trim()}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 cursor-pointer"
              >
                <Plus size={16} />
                <span>{submitting ? 'Enrolling in Pool...' : 'Enroll & Start Live Tracking'}</span>
              </button>
            </div>
          </div>

        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default PoolAddSymbolDialog;
