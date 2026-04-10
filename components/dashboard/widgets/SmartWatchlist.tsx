import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { tactileHover } from '../../ui/animations';
import { layoutShift, fadeRise } from '../../ui/motion';
import {
    Eye, Plus, Trash2, TrendingUp, TrendingDown, Target,
    AlertTriangle, ChevronDown, ChevronUp, Crosshair, Activity, Search, Play, Pause
} from 'lucide-react';
import { generateSignals, getSignalColor, type TechnicalSignals } from '../../../utils/technicalAnalysis';
import { instrumentService } from '../../../services/InstrumentService';
import { DhanInstrument } from '../../../database';
import { QuickTradeModal } from '../../modals/QuickTradeModal';
import { EmptyState } from '../../shared/EmptyState';
import { SniperOrderModal } from '../../modals/SniperOrderModal';
import { useGlobalTickStore } from '../../../store/globalTickStore';
import { upstoxInstrumentService } from '../../../services/UpstoxInstrumentService';
import { YahooHistoricalService } from '../../../services/backtester/YahooHistoricalService';
import { logger } from '../../../services/Logger';
import { ValueFlash } from '../../shared/ValueFlash';
import { formatCurrency } from '../../../utils/helpers';
import { mceOrchestrator } from '../../../services/mce/orchestrator';
import { upstoxWebSocketService } from '../../../services/UpstoxWebSocketService';
import { momentumSpikeDetector } from '../../../services/MomentumSpikeDetectorService';
import { useMceStore } from '../../../store/mceStore';
import { useNavigationIntentStore } from '../../../store/navigationIntentStore';
import { usePoolStore } from '../../../store/poolStore';
import { watchlistRankModel } from '../../../services/ml/WatchlistRankModel';
import { useToast } from '../../shared/ToastProvider';

// ============================
// Types
// ============================
interface WatchlistItem {
    id: string;
    ticker: string;
    name: string;
    currentPrice: number;
    targetBuyPrice: number;
    targetSellPrice?: number;
    priceHistory: number[]; // Historical close prices (last 200+ days)
    addedAt: string;
    notes?: string;
    archived?: boolean;
    /** SPRINT 2.B1: when true, ProactiveAlertEngine monitors live ticks against
     *  targetBuyPrice/targetSellPrice and fires a crossing alert (once per side). */
    alertsEnabled?: boolean;
}

interface SmartWatchlistProps {
    isPrivacyMode?: boolean;
    onDeselectStock?: (ticker: string) => void;
}

// ============================
// Mock data for demonstration
// ============================
const DEMO_WATCHLIST: WatchlistItem[] = [
    // Awaiting watchlist synchronization or custom additions
];

// ============================
// Signal Badge Subcomponent
// ============================
const SignalBadge: React.FC<{ signal: TechnicalSignals['signal']; score: number }> = ({ signal, score }) => {
    const color = getSignalColor(signal);
    const label = signal.replace('_', ' ');

    return (
        <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
            style={{
                color,
                backgroundColor: `${color}15`,
                border: `1px solid ${color}30`,
            }}
        >
            {label}
        </span>
    );
};

// ============================
// Entry Zone Gauge Subcomponent
// ============================
const EntryZoneGauge: React.FC<{
    currentPrice: number;
    targetBuy: number;
    targetSell?: number;
}> = ({ currentPrice, targetBuy, targetSell }) => {
    const range = targetSell
        ? targetSell - targetBuy
        : targetBuy * 0.3; // If no sell target, use 30% range

    const low = targetBuy - range * 0.2;
    const high = targetSell || targetBuy + range * 1.2;
    const clampedRange = high - low;
    const position = clampedRange > 0
        ? Math.max(0, Math.min(100, ((currentPrice - low) / clampedRange) * 100))
        : 50;

    const buyZonePosition = clampedRange > 0
        ? Math.max(0, Math.min(100, ((targetBuy - low) / clampedRange) * 100))
        : 30;

    // Determine zone color
    let zoneColor = '#f59e0b'; // Neutral/yellow
    if (currentPrice <= targetBuy) zoneColor = '#10b981'; // Green = in buy zone
    else if (targetSell && currentPrice >= targetSell) zoneColor = '#ef4444'; // Red = sell zone

    return (
        <div className="mt-2 space-y-1">
            <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
                {/* Buy zone indicator */}
                <div
                    className="absolute top-0 left-0 h-full bg-emerald-500/20 rounded-l-full"
                    style={{ width: `${buyZonePosition}%` }}
                />
                {/* Current price indicator */}
                <div
                    className="absolute top-0 w-3 h-3 -mt-0.5 rounded-full border-2 shadow-lg transition-all duration-500"
                    style={{
                        left: `${position}%`,
                        transform: 'translateX(-50%)',
                        backgroundColor: zoneColor,
                        borderColor: `${zoneColor}80`,
                        boxShadow: `0 0 8px ${zoneColor}60`
                    }}
                />
            </div>
            <div className="flex justify-between text-[9px] text-white/30">
                <span>{formatCurrency(targetBuy)}</span>
                <span className="text-white/50 font-medium">{formatCurrency(currentPrice)}</span>
                {targetSell && <span>{formatCurrency(targetSell)}</span>}
            </div>
        </div>
    );
};

// ============================
// Mini Sparkline
// ============================
const MiniSparkline: React.FC<{ prices: number[]; width?: number; height?: number }> = ({
    prices,
    width = 60,
    height = 24,
}) => {
    if (!prices || prices.length < 2) return null;

    const recent = prices.slice(-30); // Last 30 data points
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min || 1;

    const points = recent.map((p, i) => {
        const x = (i / (recent.length - 1)) * width;
        const y = height - ((p - min) / range) * height;
        return `${x},${y}`;
    }).join(' ');

    const isUp = recent[recent.length - 1] >= recent[0];

    return (
        <svg width={width} height={height} className="overflow-visible">
            <polyline
                points={points}
                fill="none"
                stroke={isUp ? '#10b981' : '#ef4444'}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};

// ============================
// Add Item Form
// ============================
const AddWatchlistForm: React.FC<{
    onAdd: (item: Omit<WatchlistItem, 'id' | 'priceHistory' | 'addedAt'>) => void;
    onCancel: () => void;
}> = ({ onAdd, onCancel }) => {
    const [ticker, setTicker] = useState('');
    const [name, setName] = useState('');
    const [currentPrice, setCurrentPrice] = useState('');
    const [targetBuyPrice, setTargetBuyPrice] = useState('');
    const [targetSellPrice, setTargetSellPrice] = useState('');
    const [setTargets, setSetTargets] = useState(true); // buy/sell pre-filled by default

    // Autocomplete state
    const [searchResults, setSearchResults] = useState<DhanInstrument[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [isAutoFetchingPrice, setIsAutoFetchingPrice] = useState(false);

    // Debounced search
    useEffect(() => {
        if (!ticker || ticker.length < 2) {
            setSearchResults([]);
            setShowDropdown(false);
            return;
        }

        if (name !== '') {
            return;
        }

        const runSearch = async () => {
            setIsSearching(true);
            setShowDropdown(true);
            const results = await instrumentService.searchInstruments(ticker, 10);
            setSearchResults(results);
            setIsSearching(false);
        };

        const timer = setTimeout(runSearch, 500); // 500ms debounce for 100k+ IndexedDB items
        return () => clearTimeout(timer);
    }, [ticker, name]);

    const handleSelectInstrument = async (inst: DhanInstrument) => {
        setTicker(inst.symbol);
        setName(inst.name);
        setShowDropdown(false);
        setIsAutoFetchingPrice(true);
        try {
            const trades = await YahooHistoricalService.getSyntheticTrades(inst.symbol, '1d', '1y');
            const history = trades.map((t: any) => t.exitPrice || t.metadata?.close || 0).filter(p => p > 0);
            const ltp = history.length > 0 ? history[history.length - 1] : 0;
            if (ltp > 0) {
                setCurrentPrice(String(Math.round(ltp * 100) / 100));
                if (setTargets) {
                    setTargetBuyPrice(String(Math.round(ltp * 0.97 * 100) / 100));
                    setTargetSellPrice(String(Math.round(ltp * 1.06 * 100) / 100));
                }
            }
        } catch (err) {
            logger.warn(`Auto-fill LTP failed for ${inst.symbol}`, err);
        } finally {
            setIsAutoFetchingPrice(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!ticker || !currentPrice) return;

        const ltp = parseFloat(currentPrice);
        onAdd({
            ticker: ticker.toUpperCase(),
            name: name || ticker.toUpperCase(),
            currentPrice: ltp,
            targetBuyPrice: setTargets && targetBuyPrice ? parseFloat(targetBuyPrice) : ltp,
            targetSellPrice: setTargets && targetSellPrice ? parseFloat(targetSellPrice) : undefined,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="bg-white/5 rounded-xl p-3 space-y-2 relative">
            <div className="grid grid-cols-2 gap-2 relative">
                <div className="relative">
                    <input
                        type="text"
                        placeholder="Search Symbol (e.g. HDFC)"
                        value={ticker}
                        onChange={e => { setTicker(e.target.value); setName(''); }}
                        className="w-full bg-white/10 text-white text-xs rounded-lg px-3 py-2 border border-white/10 focus:border-cyan-500/50 focus:outline-none"
                        required
                    />

                    {/* Autocomplete Dropdown */}
                    {showDropdown && (
                        <div className="absolute top-10 left-0 w-full md:w-[200%] bg-slate-900 border border-slate-800 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
                            {isSearching ? (
                                <div className="p-3 text-xs text-slate-500 text-center font-medium animate-pulse">Searching instrument master...</div>
                            ) : searchResults.length === 0 ? (
                                <EmptyState
                                    variant="minimal"
                                    type="no-results"
                                    message="No exact match found. Check spelling."
                                />
                            ) : searchResults.map(res => (
                                <button
                                    key={res.securityId}
                                    type="button"
                                    onClick={() => handleSelectInstrument(res)}
                                    className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center justify-between border-b border-slate-800/50 last:border-0"
                                >
                                    <div>
                                        <div className="text-xs font-bold text-slate-200">{res.symbol}</div>
                                        <div className="text-[10px] text-slate-500 line-clamp-1">{res.name}</div>
                                    </div>
                                    <div className="text-[9px] font-mono text-cyan-500/50 px-1.5 py-0.5 bg-cyan-500/10 rounded">{res.exchangeSegment}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <input
                    type="text"
                    placeholder="Company Name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="bg-white/10 text-white text-xs rounded-lg px-3 py-2 border border-white/10 focus:border-cyan-500/50 focus:outline-none"
                />
            </div>
            <div className="grid grid-cols-3 gap-2">
                <input
                    type="number"
                    placeholder={isAutoFetchingPrice ? "Fetching LTP…" : "Current ₹"}
                    value={currentPrice}
                    onChange={e => setCurrentPrice(e.target.value)}
                    className="bg-white/10 text-white text-xs rounded-lg px-3 py-2 border border-white/10 focus:border-cyan-500/50 focus:outline-none disabled:opacity-50"
                    disabled={isAutoFetchingPrice}
                    required
                />
                <input
                    type="number"
                    placeholder="Buy Zone ₹"
                    value={targetBuyPrice}
                    onChange={e => setTargetBuyPrice(e.target.value)}
                    className="bg-white/10 text-white text-xs rounded-lg px-3 py-2 border border-emerald-500/30 focus:border-emerald-500/50 focus:outline-none disabled:opacity-50"
                    disabled={!setTargets || isAutoFetchingPrice}
                />
                <input
                    type="number"
                    placeholder="Sell Zone ₹"
                    value={targetSellPrice}
                    onChange={e => setTargetSellPrice(e.target.value)}
                    className="bg-white/10 text-white text-xs rounded-lg px-3 py-2 border border-red-500/30 focus:border-red-500/50 focus:outline-none disabled:opacity-50"
                    disabled={!setTargets || isAutoFetchingPrice}
                />
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-white/50 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={setTargets}
                    onChange={e => setSetTargets(e.target.checked)}
                    className="accent-cyan-500"
                />
                Set target zones (auto-filled 3% range — edit to override)
            </label>
            <div className="flex gap-2">
                <button
                    type="submit"
                    className="flex-1 text-xs py-2 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 transition-colors font-medium"
                >
                    Add to Watchlist
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="text-xs px-3 py-2 rounded-lg bg-white/5 text-white/40 hover:text-white/60 transition-colors"
                >
                    Cancel
                </button>
            </div>
        </form>
    );
};

// ============================
// Watchlist Item Row Subcomponent (with Live Flashing Transition)
// ============================
interface WatchlistItemRowProps {
    item: WatchlistItem & { signals: TechnicalSignals; distanceToBuy: number };
    isExpanded: boolean;
    onToggleExpand: () => void;
    onRemove: () => void;
    onToggleArchive: () => void;
    onQuickTrade: () => void;
    onSniperOrder: () => void;
    onScoreInAlpha: () => void;
    isPrivacyMode: boolean;
    isScoring: boolean;
    isFeedOffline: boolean;
    onToggleAlert: () => void;
}

const WatchlistItemRow: React.FC<WatchlistItemRowProps> = ({
    item,
    isExpanded,
    onToggleExpand,
    onRemove,
    onToggleArchive,
    onQuickTrade,
    onSniperOrder,
    onScoreInAlpha,
    isPrivacyMode,
    isScoring,
    isFeedOffline,
    onToggleAlert,
}) => {
    const [prevPrice, setPrevPrice] = useState<number | null>(item.currentPrice);
    const [flashType, setFlashType] = useState<'up' | 'down' | null>(null);
    const flashTimer = useRef<number | null>(null);

    useEffect(() => {
        if (item.currentPrice !== null && prevPrice !== null && item.currentPrice !== prevPrice) {
            if (item.currentPrice > prevPrice) {
                setFlashType('up');
            } else if (item.currentPrice < prevPrice) {
                setFlashType('down');
            }
            setPrevPrice(item.currentPrice);

            if (flashTimer.current) {
                window.clearTimeout(flashTimer.current);
            }
            flashTimer.current = window.setTimeout(() => {
                setFlashType(null);
            }, 1000) as unknown as number;
        }
        return () => {
            if (flashTimer.current) window.clearTimeout(flashTimer.current);
        };
    }, [item.currentPrice, prevPrice]);

    const inBuyZone = item.currentPrice <= item.targetBuyPrice;
    const inSellZone = item.targetSellPrice && item.currentPrice >= item.targetSellPrice;

    let priceBgClass = 'transition-all duration-1000 px-2 py-0.5 rounded font-mono text-xs font-bold';
    if (flashType === 'up') {
        priceBgClass += ' bg-emerald-500/20 text-emerald-400 font-bold scale-105';
    } else if (flashType === 'down') {
        priceBgClass += ' bg-rose-500/20 text-rose-400 font-bold scale-105';
    } else {
        priceBgClass += ' text-white';
    }

    const mlProb = useMemo(() => {
        return watchlistRankModel.predictProb({
            symbol: item.ticker,
            distToSupportPct: (item.distanceToBuy || 0) / 100,
            distToVwapPct: 0.005,
            rsi14: item.signals.rsi14 ?? 50,
            adx14: 25,
            volumeRatio: 1.2,
            near200SmaPct: item.signals.percentFromHigh ?? 0,
            relativeStrength: 1.0,
        });
    }, [item]);

    return (
        <motion.div
            layout
            variants={tactileHover}
            whileHover="hover"
            whileTap="tap"
            className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 transition-all duration-300 cursor-pointer ${
                inBuyZone && !item.archived ? 'ring-2 ring-emerald-500/40 bg-emerald-500/[0.03] shadow-[0_0_20px_rgba(16,185,129,0.1)]' : ''
            } ${inSellZone && !item.archived ? 'ring-1 ring-red-500/20 bg-rose-500/[0.01]' : ''} ${
                item.archived ? 'opacity-40 grayscale select-none' : ''
            }`}
            onClick={onToggleExpand}
        >
            {/* Main Row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{item.ticker}</span>
                            {!item.archived && (
                                <>
                                    <SignalBadge signal={item.signals.signal} score={item.signals.score} />
                                    <span
                                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                            mlProb > 0.5
                                                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 animate-pulse'
                                                : 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-300'
                                        }`}
                                        title="ML Buy-Zone Entry Probability (Domain 3)"
                                    >
                                        🔥 {(mlProb * 100).toFixed(0)}%
                                    </span>
                                </>
                            )}
                            {item.archived && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/40 border border-white/10 uppercase tracking-wider">Paused</span>}
                        </div>
                        <span className="text-[10px] text-white/40">{item.name}</span>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <MiniSparkline prices={item.priceHistory} />
                    <div className="text-right">
                        <ValueFlash value={item.currentPrice} className="inline-block" epsilon={0.01}>
                            <div className={priceBgClass}>
                                {isPrivacyMode ? '•••' : formatCurrency(item.currentPrice)}
                            </div>
                        </ValueFlash>
                        <div className={`text-[10px] font-medium mt-0.5 ${item.archived ? 'text-white/20' : item.distanceToBuy <= 0 ? 'text-emerald-400' : 'text-white/40'}`}>
                            {item.archived
                                ? '⏸ Paused'
                                : item.distanceToBuy <= 0
                                    ? '✅ In Buy Zone'
                                    : `${item.distanceToBuy.toFixed(1)}% above target`
                            }
                        </div>
                    </div>
                    {isExpanded ? <ChevronUp className="w-3 h-3 text-white/30" /> : <ChevronDown className="w-3 h-3 text-white/30" />}
                </div>
            </div>

            {/* Entry Zone Gauge */}
            <EntryZoneGauge
                currentPrice={item.currentPrice}
                targetBuy={item.targetBuyPrice}
                targetSell={item.targetSellPrice}
            />

            {/* Expanded Details */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        variants={fadeRise}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="mt-3 pt-3 border-t border-white/5 space-y-2"
                        onClick={e => e.stopPropagation()}
                    >
                    {/* Technical Indicators */}
                    <div className="grid grid-cols-4 gap-2 text-center">
                        <div className="bg-white/5 rounded-lg p-2">
                            <div className="text-[9px] text-white/40">RSI (14)</div>
                            <div className={`text-xs font-bold ${item.signals.rsi14 !== null
                                ? item.signals.rsi14 < 30 ? 'text-emerald-400'
                                    : item.signals.rsi14 > 70 ? 'text-red-400'
                                        : 'text-white'
                                : 'text-white/30'
                                }`}>
                                {item.signals.rsi14?.toFixed(1) ?? '—'}
                            </div>
                        </div>
                        <div className="bg-white/5 rounded-lg p-2">
                            <div className="text-[9px] text-white/40">SMA 200</div>
                            <div className="text-xs font-bold text-white">
                                {item.signals.sma200
                                    ? formatCurrency(Math.round(item.signals.sma200))
                                    : '—'
                                }
                            </div>
                        </div>
                        <div className="bg-white/5 rounded-lg p-2">
                            <div className="text-[9px] text-white/40">52W High</div>
                            <div className={`text-xs font-bold ${item.signals.percentFromHigh > -5 ? 'text-amber-400' : 'text-white'
                                }`}>
                                {item.signals.percentFromHigh.toFixed(1)}%
                            </div>
                        </div>
                        <div className="bg-white/5 rounded-lg p-2">
                            <div className="text-[9px] text-white/40">Score</div>
                            <div className={`text-xs font-bold`} style={{ color: getSignalColor(item.signals.signal) }}>
                                {item.signals.score}
                            </div>
                        </div>
                    </div>

                    {/* Bollinger Band Position */}
                    {item.signals.bollingerLower && item.signals.bollingerUpper && (
                        <div className="bg-white/5 rounded-lg p-2 flex items-center justify-between">
                            <span className="text-[10px] text-white/40">Bollinger Bands</span>
                            <span className="text-[10px] text-white/60">
                                {formatCurrency(Math.round(item.signals.bollingerLower))} — {formatCurrency(Math.round(item.signals.bollingerUpper))}
                            </span>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={onScoreInAlpha}
                            disabled={isScoring || isFeedOffline || item.archived}
                            className="flex-1 text-[10px] px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 text-emerald-300 hover:from-emerald-500/30 hover:to-cyan-500/30 transition-colors flex items-center justify-center gap-1 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                            title={item.archived ? 'Item archived — unarchive to score' : isFeedOffline ? 'Price feed offline — cannot score' : 'Open Momentum Continuation Score in Alpha Engine'}
                        >
                            <Crosshair className="w-3 h-3" />
                            {isScoring ? 'Scoring…' : 'Score in Alpha Engine →'}
                        </button>
                        <button
                            onClick={onSniperOrder}
                            disabled={item.archived}
                            className="text-[10px] px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={item.archived ? 'Item archived' : undefined}
                        >
                            <Crosshair className="w-3 h-3" /> Sniper Order
                        </button>
                        <button
                            onClick={onQuickTrade}
                            disabled={item.archived}
                            className="text-[10px] px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={item.archived ? 'Item archived' : undefined}
                        >
                            <Activity className="w-3 h-3" /> Quick Trade
                        </button>
                        <button
                            onClick={onToggleArchive}
                            className={`text-[10px] px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors ${
                                item.archived 
                                    ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' 
                                    : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                            }`}
                        >
                            {item.archived ? (
                                <>
                                    <Play className="w-3 h-3" /> Unpause
                                </>
                            ) : (
                                <>
                                    <Pause className="w-3 h-3" /> Pause
                                </>
                            )}
                        </button>
                        <button
                            onClick={onRemove}
                            className="text-[10px] px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-1"
                        >
                            <Trash2 className="w-3 h-3" /> Remove
                        </button>
                        {!item.archived && (
                            <button
                                onClick={onToggleAlert}
                                title={item.alertsEnabled
                                    ? 'Level alert ON - watching live ticks vs your target prices. Click to disable.'
                                    : 'Alert me when price crosses my target buy/sell levels'}
                                className={`text-[10px] px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${item.alertsEnabled
                                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20 font-bold'
                                    : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                    }`}
                            >
                                <Target className="w-3 h-3" />
                                {item.alertsEnabled ? 'Alert ON' : 'Set Alert'}
                            </button>
                        )}
                    </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

// ============================
// Main Smart Watchlist Widget
// ============================
const SmartWatchlist: React.FC<SmartWatchlistProps> = ({ isPrivacyMode = false, onDeselectStock }) => {
    const { toast } = useToast();
    // Load persisted watchlist from local storage
    const [items, setItems] = useState<WatchlistItem[]>(() => {
        try {
            const saved = localStorage.getItem('smart_watchlist_v2');
            return saved ? JSON.parse(saved) : DEMO_WATCHLIST;
        } catch (err) {
            logger.error('Failed to load watchlist from localStorage:', err);
            return DEMO_WATCHLIST;
        }
    });

    const [showAddForm, setShowAddForm] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<'score' | 'name' | 'distance'>('score');

    // Quick Trade / Sniper Order Modals
    const [quickTradeItem, setQuickTradeItem] = useState<WatchlistItem | null>(null);
    const [sniperOrderItem, setSniperOrderItem] = useState<WatchlistItem | null>(null);

    // Per-row scoring in-flight marker (so the button can show "Scoring…").
    const [scoringTicker, setScoringTicker] = useState<string | null>(null);

    // Active ticker chip — driven by mceStore.preEntrySnapshots (MCS source of truth).
    const activeSnapshots = useMceStore(s => s.preEntrySnapshots);
    const activeTicker = useMemo(() => {
        let latestSymbol: string | null = null;
        let latestAsOf = -1;
        activeSnapshots.forEach((snap, sym) => {
            if (snap.asOf > latestAsOf) {
                latestAsOf = snap.asOf;
                latestSymbol = sym;
            }
        });
        return latestSymbol;
    }, [activeSnapshots]);

    // Resolved instrument keys mapping
    const [resolvedKeys, setResolvedKeys] = useState<Record<string, string>>({});

    // Save watchlist to local storage
    useEffect(() => {
        try {
            localStorage.setItem('smart_watchlist_v2', JSON.stringify(items));
        } catch (err) {
            logger.error('Failed to save watchlist to localStorage:', err);
        }
    }, [items]);

    // Storage event listener to keep watchlist in sync when modified externally
    useEffect(() => {
        const handleStorageChange = () => {
            try {
                const saved = localStorage.getItem('smart_watchlist_v2');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    setItems(parsed);
                }
            } catch (err) {
                logger.error('Failed to reload watchlist on storage event:', err);
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // Check for items with missing historical data on mount and fetch them
    useEffect(() => {
        const fetchMissingHistories = async () => {
            let updated = false;
            const newItems = await Promise.all(items.map(async (item) => {
                if (!item.priceHistory || item.priceHistory.length === 0) {
                    try {
                        const trades = await YahooHistoricalService.getSyntheticTrades(item.ticker, '1d', '1y');
                        const history = trades.map((t: any) => t.exitPrice || t.metadata?.close || 0).filter(p => p > 0);
                        if (history.length > 0) {
                            updated = true;
                            return { ...item, priceHistory: history };
                        }
                    } catch (err) {
                        logger.error(`Failed to fetch history for ${item.ticker}:`, err);
                    }
                }
                return item;
            }));
            if (updated) {
                setItems(newItems);
            }
        };
        fetchMissingHistories();
    }, [items.length]);

    // Resolve symbols to Upstox keys
    useEffect(() => {
        const resolveKeys = async () => {
            const tickers = items.filter(i => !i.archived).map(i => i.ticker);
            if (tickers.length === 0) {
                setResolvedKeys({});
                return;
            }
            try {
                const keyMap = await upstoxInstrumentService.getInstrumentKeys(tickers, 'NSE_EQ');
                setResolvedKeys(keyMap);
            } catch (err) {
                logger.error('Failed to resolve Upstox keys for watchlist:', err);
            }
        };
        resolveKeys();
    }, [items]);

    const activeKeys = useMemo(() => Object.values(resolvedKeys), [resolvedKeys]);

    // LIVE-FEED FIX (P0): this widget read globalTickStore but NEVER subscribed
    // its own symbols to the WebSocket - custom non-F&O names stayed frozen on
    // their add-time Yahoo close forever. Subscribe active keys directly; ticks
    // land in the shared store every consumer already reads.
    useEffect(() => {
        if (activeKeys.length === 0) return;
        const forwardTick = (tick: any) => {
            if (!tick || !tick.instrument_key) return;
            useGlobalTickStore.getState().setTick(tick);
        };
        upstoxWebSocketService.subscribe(activeKeys, forwardTick);
        return () => {
            upstoxWebSocketService.unsubscribe(activeKeys, forwardTick);
        };
    }, [activeKeys]);

    // Hook up real-time Upstox WebSocket feed
    const ticks = useGlobalTickStore((s) => s.ticks);
    const isConnected = useGlobalTickStore((s) => s.isConnected);

    // COVERAGE-AWARE BADGE INPUT: fraction of watchlist keys actually ticking.
    const liveCoverage = useMemo(() => {
        if (activeKeys.length === 0) return { covered: 0, total: 0, ratio: 1 };
        const covered = activeKeys.filter(k => ticks[k] && ticks[k].ltp !== null && ticks[k].ltp !== undefined).length;
        return { covered, total: activeKeys.length, ratio: covered / activeKeys.length };
    }, [activeKeys, ticks]);

    // Merge live tick calculations into active state
    const itemsWithSignals = useMemo(() => {
        return items.map(item => {
            const key = resolvedKeys[item.ticker];
            const tick = key ? ticks[key] : null;

            // Merge live prices & volumes
            const livePrice = tick && tick.ltp !== null ? tick.ltp : item.currentPrice;
            const liveVolume = tick && tick.volume !== null ? tick.volume : undefined;

            // Insert live price into priceHistory array to calculate real-time technical indicators
            let updatedHistory = [...(item.priceHistory || [])];
            if (updatedHistory.length > 0 && livePrice !== null) {
                updatedHistory[updatedHistory.length - 1] = livePrice;
            } else if (livePrice !== null) {
                updatedHistory = [livePrice];
            }

            const signals = generateSignals(updatedHistory);

            return {
                ...item,
                currentPrice: livePrice,
                volume: liveVolume,
                priceHistory: updatedHistory,
                signals,
                distanceToBuy: ((livePrice - item.targetBuyPrice) / item.targetBuyPrice) * 100,
            };
        });
    }, [items, resolvedKeys, ticks]);

    // Sort items based on user choice
    const sortedItems = useMemo(() => {
        const sorted = [...itemsWithSignals];
        switch (sortBy) {
            case 'score': return sorted.sort((a, b) => b.signals.score - a.signals.score);
            case 'name': return sorted.sort((a, b) => a.ticker.localeCompare(b.ticker));
            case 'distance': return sorted.sort((a, b) => a.distanceToBuy - b.distanceToBuy);
        }
    }, [itemsWithSignals, sortBy]);

    // Stats
    const buyZoneCount = itemsWithSignals.filter(i => i.currentPrice <= i.targetBuyPrice).length;
    const bullishCount = itemsWithSignals.filter(i =>
        i.signals.signal === 'STRONG_BUY' || i.signals.signal === 'BUY'
    ).length;

    // Add item handler with async history fetcher
    const handleAddItem = useCallback(async (newItem: Omit<WatchlistItem, 'id' | 'priceHistory' | 'addedAt'>) => {
        let history: number[] = [];
        try {
            const trades = await YahooHistoricalService.getSyntheticTrades(newItem.ticker, '1d', '1y');
            history = trades.map((t: any) => t.exitPrice || t.metadata?.close || 0).filter(p => p > 0);
        } catch (err) {
            logger.error(`Failed to fetch history for new watchlist item ${newItem.ticker}:`, err);
        }

        const item: WatchlistItem = {
            ...newItem,
            id: `w_${Date.now()}`,
            priceHistory: history,
            addedAt: new Date().toISOString().split('T')[0],
        };
        setItems(prev => [...prev, item]);
        setShowAddForm(false);

        // INSTANT COVERAGE: resubscribe spike-detector + WS now instead of
        // waiting for the 5-minute backstop resync.
        momentumSpikeDetector.resyncNow();

        // Two-way sync: Add to Momentum Pool if not already tracked
        const existsInPool = usePoolStore.getState().items.some(
            i => i.ticker.toUpperCase() === item.ticker.toUpperCase()
        );
        if (!existsInPool) {
            try {
                await usePoolStore.getState().addItem({
                    ticker: item.ticker,
                    displayName: item.name,
                    source: 'ALPHA_ENGINE',
                    targetBuyPrice: item.targetBuyPrice,
                    targetSellPrice: item.targetSellPrice,
                    watchlistStatus: 'none', // Prevent loop sync back
                });
            } catch (err) {
                logger.error(`Failed to sync added watchlist item ${item.ticker} to Momentum Pool:`, err);
            }
        }
    }, []);

    const handleRemove = useCallback((id: string) => {
        const itemToRemove = items.find(i => i.id === id);
        if (itemToRemove) {
            if (onDeselectStock) {
                onDeselectStock(itemToRemove.ticker);
            }
            if (activeTicker === itemToRemove.ticker) {
                useMceStore.getState().setPreEntrySnapshot(activeTicker, {
                    symbol: activeTicker,
                    intent: 'PRE_ENTRY',
                    asOf: 0,
                    features: null as any,
                    score: { total: 0, confidence: 0, verdict: 'WAIT', subScores: { htf: { score: 0, reason: '' }, indicators: { score: 0, reason: '' }, flow: { score: 0, reason: '' }, regime: { score: 0, reason: '' }, gex: { score: 0, reason: '' } } },
                } as any);
            }
        }
        setItems(prev => prev.filter(i => i.id !== id));
    }, [items, onDeselectStock, activeTicker]);

    const handleToggleArchive = useCallback((id: string) => {
        setItems(prev => prev.map(item => {
            if (item.id === id) {
                const newArchived = !item.archived;
                if (newArchived) {
                    if (onDeselectStock) {
                        onDeselectStock(item.ticker);
                    }
                    if (activeTicker === item.ticker) {
                        useMceStore.getState().setPreEntrySnapshot(activeTicker, {
                            symbol: activeTicker,
                            intent: 'PRE_ENTRY',
                            asOf: 0,
                            features: null as any,
                            score: { total: 0, confidence: 0, verdict: 'WAIT', subScores: { htf: { score: 0, reason: '' }, indicators: { score: 0, reason: '' }, flow: { score: 0, reason: '' }, regime: { score: 0, reason: '' }, gex: { score: 0, reason: '' } } },
                        } as any);
                    }
                }
                return { ...item, archived: newArchived };
            }
            return item;
        }));
    }, [activeTicker, onDeselectStock]);

    const handleScoreInAlpha = useCallback(async (ticker: string) => {
        if (scoringTicker) return;
        setScoringTicker(ticker);
        try {
            const snapshot = await mceOrchestrator.score(ticker, 'PRE_ENTRY');
            if (snapshot) {
                useMceStore.getState().setPreEntrySnapshot(ticker, snapshot);
            }
            // Dispatch navigation intent; App.tsx routes 'alpha' target to Intraday sub-tab.
            useNavigationIntentStore.getState().setIntent({
                target: 'alpha',
                action: 'open-mcs',
                payload: { symbol: ticker },
                createdAt: Date.now(),
            });
        } catch (err) {
            logger.error(`[SmartWatchlist] score failed for ${ticker}`, err);
        } finally {
            setScoringTicker(null);
        }
    }, [scoringTicker]);

    return (
        <div className="glass-card p-5 rounded-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/20">
                        <Crosshair className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-white">Smart Watchlist</h3>
                            {isConnected ? (
                                liveCoverage.ratio >= 0.8 ? (
                                    <span className="flex items-center gap-1 text-[8px] font-black px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest animate-pulse">
                                        ● Live {liveCoverage.covered}/{liveCoverage.total}
                                    </span>
                                ) : liveCoverage.ratio > 0 ? (
                                    <span className="flex items-center gap-1 text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-widest">
                                        ◐ Partial {liveCoverage.covered}/{liveCoverage.total}
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1 text-[8px] font-black px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/20 uppercase tracking-widest">
                                        Connecting…
                                    </span>
                                )
                            ) : (
                                <span className="flex items-center gap-1 text-[8px] font-black px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/20 uppercase tracking-widest">
                                    Offline
                                </span>
                            )}
                            {activeTicker && (
                                <span
                                    className="flex items-center gap-1 text-[8px] font-black px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase tracking-widest cursor-pointer hover:bg-emerald-500/25"
                                    title={`${activeTicker} is currently scored in the MCS card. Click to clear.`}
                                    onClick={() => {
                                        // Clearing the active snapshot makes useActiveTickerSymbol return null again.
                                        useMceStore.getState().setPreEntrySnapshot(activeTicker, {
                                            symbol: activeTicker,
                                            intent: 'PRE_ENTRY',
                                            asOf: 0,
                                            features: null as any,
                                            score: { total: 0, confidence: 0, verdict: 'WAIT', subScores: { htf: { score: 0, reason: '' }, indicators: { score: 0, reason: '' }, flow: { score: 0, reason: '' }, regime: { score: 0, reason: '' }, gex: { score: 0, reason: '' } } },
                                        } as any);
                                    }}
                                >
                                    Active: {activeTicker} ✕
                                </span>
                            )}
                        </div>
                        <p className="text-[10px] text-white/40">
                            {items.length} assets · {buyZoneCount} in buy zone
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-wa-2">
                <div className="bg-white/5 rounded-xl p-wa-2 text-center">
                    <div className="text-[10px] text-white/40">Tracking</div>
                    <div className="text-lg font-bold text-white">{items.length}</div>
                </div>
                <div className="bg-emerald-500/5 rounded-xl p-wa-2 text-center border border-emerald-500/10">
                    <div className="text-[10px] text-emerald-400/60">Buy Zone</div>
                    <div className="text-lg font-bold text-emerald-400">{buyZoneCount}</div>
                </div>
                <div className="bg-cyan-500/5 rounded-xl p-wa-2 text-center">
                    <div className="text-[10px] text-cyan-400/60">Bullish</div>
                    <div className="text-lg font-bold text-cyan-400">{bullishCount}</div>
                </div>
            </div>

            {/* Sort Controls */}
            <div className="flex gap-1 bg-white/5 rounded-xl p-1">
                {([
                    { key: 'score', label: 'By Signal' },
                    { key: 'distance', label: 'By Entry' },
                    { key: 'name', label: 'A-Z' },
                ] as const).map(opt => (
                    <button
                        key={opt.key}
                        onClick={() => setSortBy(opt.key)}
                        className={`flex-1 text-xs py-1.5 rounded-lg transition-all font-medium ${sortBy === opt.key
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'text-white/40 hover:text-white/60'
                            }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {/* Add Form */}
            {showAddForm && (
                <AddWatchlistForm
                    onAdd={handleAddItem}
                    onCancel={() => setShowAddForm(false)}
                />
            )}

            {/* Watchlist Items */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                {sortedItems.map(item => (
                    <WatchlistItemRow
                        key={item.id}
                        item={item}
                        isExpanded={expandedId === item.id}
                        onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        onRemove={() => handleRemove(item.id)}
                        onToggleArchive={() => handleToggleArchive(item.id)}
                        onQuickTrade={() => setQuickTradeItem(item)}
                        onSniperOrder={() => setSniperOrderItem(item)}
                        onScoreInAlpha={() => handleScoreInAlpha(item.ticker)}
                        isScoring={scoringTicker === item.ticker}
                        isFeedOffline={!isConnected}
                        isPrivacyMode={isPrivacyMode}
                        onToggleAlert={() => {
                            const next = !item.alertsEnabled;
                            const updated = items.map(i => i.id === item.id ? { ...i, alertsEnabled: next } : i);
                            setItems(updated as any);
                            localStorage.setItem('smart_watchlist_v2', JSON.stringify(updated));
                            // Keep the spike detector + WS in sync with the same bucket
                            momentumSpikeDetector.resyncNow();
                            toast.success(next
                                ? `Level alert armed for ${item.ticker} (buy ≤ ₹${item.targetBuyPrice}${item.targetSellPrice ? ` / sell ≥ ₹${item.targetSellPrice}` : ''})`
                                : `Level alert disabled for ${item.ticker}`);
                        }}
                    />
                ))}
            </div>

            {/* Empty State */}
            {items.length === 0 && !showAddForm && (
                <EmptyState
                    type="no-investments"
                    variant="minimal"
                    title="No assets in watchlist"
                    description="Track tickers you want to keep an eye on — they'll show up here with live prices."
                    actionLabel="Add your first asset"
                    onAction={() => setShowAddForm(true)}
                />
            )}

            {/* Quick Trade Modal */}
            <QuickTradeModal
                isOpen={!!quickTradeItem}
                onClose={() => setQuickTradeItem(null)}
                ticker={quickTradeItem?.ticker || ''}
                currentPrice={quickTradeItem?.currentPrice || 0}
            />

            {/* Sniper Order Modal */}
            <SniperOrderModal
                isOpen={!!sniperOrderItem}
                onClose={() => setSniperOrderItem(null)}
                ticker={sniperOrderItem?.ticker || ''}
                currentPrice={sniperOrderItem?.currentPrice || 0}
            />
        </div>
    );
};

export default React.memo(SmartWatchlist);
