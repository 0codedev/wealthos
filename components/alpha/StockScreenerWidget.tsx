import React, { useEffect, useState, useMemo, useRef } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { createPortal } from 'react-dom';
import { alphaEngineService, StockData, computeGFactor } from '../../services/AlphaEngineService';
import { Activity, ArrowUp, ArrowDown, List, ExternalLink, Zap, TrendingUp, BarChart3, LayoutList, MoreVertical, Newspaper, Camera, RefreshCw, ChevronDown, Check, SlidersHorizontal } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { openTradingView, openSectorTradingView } from '../../utils/navigation';
import { toPng } from 'html-to-image';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { SECTOR_CONSTITUENTS } from '../../data/sectorConstituents';
import { useGlobalTickStore } from '../../store/globalTickStore';
import { upstoxInstrumentService } from '../../services/UpstoxInstrumentService';
import { signalFusionService } from '../../services/alpha/SignalFusionService';
import { alphaSelectionService, type StockSelection, type SectorRotationRow } from '../../services/AlphaEngineService';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, TooltipProps } from 'recharts';
import { useSettingsStore } from '../../store/settingsStore';
import { orderBookIntelligenceService } from '../../services/OrderBookIntelligenceService';
import { score as convictionScore, buildInputsFromStock, type ConvictionScore } from '../../services/alpha/ConvictionEngine';
import { evaluateStrategyScore, detectBestStrategy, STRATEGY_CONFIGS, type StrategyId } from '../../services/alpha/StrategyEngine';
import { optionChainService } from '../../services/OptionChainService';
import { quantGreeksService } from '../../services/QuantGreeksService';
import { mceOrchestrator } from '../../services/mce/orchestrator';
import type { McsSnapshot } from '../../services/mce/types';
import { upstoxMarketDataService } from '../../services/UpstoxMarketDataService';
import { Tabs } from '../ui/AnimatedTabs';
import { ActionButton } from '../ui/ActionButton';
import { LiveConnectionBadge } from '../shared/LiveConnectionBadge';
import { usePausedInterval } from '../../hooks/usePausedInterval';


const LOT_SIZES: Record<string, number> = {
    NIFTY: 75,
    BANKNIFTY: 15,
    FINNIFTY: 40,
    MIDCPNIFTY: 75,
    SENSEX: 10
};

interface StockScreenerWidgetProps {
    selectedSector: string | null;
    onStockSelect: (stock: StockData) => void;
    selectedStock: StockData | null;
    autoRefresh?: boolean;
    refreshTrigger?: number;
    isVisible?: boolean;
    /** CC68.47 — symbol → average daily volume, for the RVOL column (vol / ADV). */
    volumeAverages?: Record<string, number>;
    qualityDataCache?: Record<string, any[]>; // Added for real Stockezee quality score
}

type SortMode = 'c2c' | 'openChangePct' | 'alphaScore' | 'gFactor' | 'rFactor' | 'openingGap' | 'dayExtreme' | 'fundamentalScore' | 'compositeAlphaScore' | 'convictionScore' | 'momentumContinuationScore' | 'rsComposite' | 'mtfCoherence' | 'selectionConviction' | 'liquidityGrade' | 'derivativesScore' | 'derivativesVerdict' | 'rvol' | 'symbol' | 'previousClose';

type FactorCategory = 'all' | 'momentum' | 'quant' | 'derivatives' | 'structural';

interface SortCategoryGroup {
    id: FactorCategory;
    label: string;
    icon: string;
    description: string;
    modes: SortMode[];
}

const SORT_CATEGORIES: SortCategoryGroup[] = [
    {
        id: 'momentum',
        label: 'Momentum',
        icon: '🚀',
        description: 'Price return, volume surge & intraday velocity',
        modes: ['c2c', 'openChangePct', 'rvol', 'rFactor', 'momentumContinuationScore']
    },
    {
        id: 'quant',
        label: 'Quant Breakout',
        icon: '🎯',
        description: 'Range breaks, day extremes & technical confluence',
        modes: ['gFactor', 'alphaScore', 'openingGap', 'dayExtreme']
    },
    {
        id: 'derivatives',
        label: 'Derivatives & Flow',
        icon: '⚡',
        description: 'Option confluence, trade gates & AI conviction',
        modes: ['convictionScore', 'derivativesScore', 'derivativesVerdict']
    },
    {
        id: 'structural',
        label: 'Structural Quality',
        icon: '🏛️',
        description: 'Alpha 2.0 selection, MTF coherence & fundamentals',
        modes: ['selectionConviction', 'rsComposite', 'mtfCoherence', 'liquidityGrade', 'fundamentalScore', 'compositeAlphaScore']
    }
];

export const getQualityScoreDetail = (symbol: string, qualityDataCache?: Record<string, any[]>) => {
    if (!qualityDataCache) return { score: 50, isFallback: true };
    const upper = symbol.toUpperCase().trim();
    for (const key of Object.keys(qualityDataCache)) {
        const list = qualityDataCache[key];
        if (Array.isArray(list)) {
            const match = list.find((it) => (it.symbol_name || '').toUpperCase() === upper);
            if (match && match.total_score != null) {
                const score = parseFloat(match.total_score);
                if (!isNaN(score)) return { score, isFallback: false };
            }
        }
    }
    return { score: 50, isFallback: true };
};

export const calculateFundamentalScore = (symbol: string, qualityDataCache?: Record<string, any[]>): number => {
    return getQualityScoreDetail(symbol, qualityDataCache).score;
};

export const calculateCompositeAlphaScore = (gFactor: number, fundamentalScore: number): number => {
    const normGFactor = gFactor * 10;
    return Math.round((normGFactor * 0.6) + (fundamentalScore * 0.4));
};

export const calculateAlphaScore = (stock: StockData, sectorChange: number): number => {
    const isDown = stock.signal === 'Down';
    let sectorScore = 1.0;
    if (isDown) {
        if (sectorChange < -2.5) sectorScore = 0.4;
        else if (sectorChange > 0) sectorScore = 0.1;
    } else {
        if (sectorChange > 2.5) sectorScore = 0.4;
        else if (sectorChange < 0) sectorScore = 0.1;
    }

    const absGap = Math.abs(stock.openingGapPct);
    let gapScore = 1.0;
    if (absGap > 4.5) gapScore = 0.1;
    else if (absGap < 0.5) gapScore = 0.5;

    let extremeScore = stock.dayExtremeScore;
    if (extremeScore < 0.85) {
        extremeScore = extremeScore * 0.4;
    }

    const changeScore = Math.min(Math.abs(stock.percentChange) / 5, 1.0);

    const rawScore = (sectorScore * 0.2) + (gapScore * 0.3) + (extremeScore * 0.4) + (changeScore * 0.1);
    return Math.round(rawScore * 100);
};

export const calculateStockGFactor = (stock: StockData, volumeVelocity: number): number => {
    const ltp = stock.lastPrice;
    const openPrice = stock.openPrice;
    const high = stock.high;
    const low = stock.low;
    const prevClose = stock.previousClose;
    const percentChange = stock.percentChange;
    const openingGapPct = stock.openingGapPct;

    const isORBLowPreservedProxy = low >= openPrice * 0.9985;
    const isORBHighPreservedProxy = high <= openPrice * 1.0015;
    const isHODBreakout = ltp >= high * 0.998;
    const isGapUpBreakout = openingGapPct > 0.5;
    const isVolumeSurge = volumeVelocity > 1.3;

    let gFactorBase = 0;
    if (percentChange > 0) {
        if (isORBLowPreservedProxy) gFactorBase += 3.5;
        if (isHODBreakout) gFactorBase += 3.0;
        if (isVolumeSurge) gFactorBase += 2.0;
        if (isGapUpBreakout) gFactorBase += 1.5;
        gFactorBase += Math.min(percentChange * 0.3, 2.0);
    } else {
        if (isORBHighPreservedProxy) gFactorBase += 3.5;
        if (ltp <= low * 1.002) gFactorBase += 3.0;
        if (isVolumeSurge) gFactorBase += 2.0;
        if (openingGapPct < -0.5) gFactorBase += 1.5;
        gFactorBase += Math.min(Math.abs(percentChange) * 0.3, 2.0);
    }
    return Number(Math.min(gFactorBase, 10.0).toFixed(2));
};

// Optimized sub-component for sort buttons
const SortButton = React.memo(({ 
    mode, 
    activeMode, 
    onClick, 
    labelInfo 
}: { 
    mode: SortMode, 
    activeMode: SortMode, 
    onClick: (mode: SortMode) => void,
    labelInfo: any
}) => {
    const handleClick = React.useCallback(() => onClick(mode), [mode, onClick]);
    
    return (
        <div className="relative group">
            <button
                onClick={handleClick}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all ${
                    activeMode === mode
                        ? labelInfo.color
                        : 'text-slate-500 border-slate-700 bg-slate-800/30 hover:text-slate-300'
                }`}
            >
                {labelInfo.icon}
                {labelInfo.label}
            </button>
            
            {/* Premium Long Horizontal Tooltip */}
            <div className="pointer-events-none absolute left-0 top-full mt-2.5 hidden group-hover:block bg-slate-950/95 border border-slate-800 p-3.5 rounded-xl shadow-2xl z-50 w-[360px] leading-relaxed backdrop-blur-sm">
                <div className="absolute -top-1.5 left-4 w-3 h-3 bg-slate-950/95 border-l border-t border-slate-800 rotate-45"></div>
                
                <div className="flex items-center gap-2 text-white font-black text-[11px] tracking-wider uppercase border-b border-slate-800/60 pb-1.5 mb-2.5">
                    {labelInfo.icon}
                    {labelInfo.title}
                </div>
                
                <div className="mb-2.5">
                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">Formula:</span>
                    <div className="bg-slate-900/80 px-2 py-1.5 rounded-lg border border-slate-800/80 font-mono text-[9px] text-indigo-400 font-bold break-all">
                        {labelInfo.formula}
                    </div>
                </div>
                
                <div>
                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">Interpretation:</span>
                    <p className="text-slate-400 font-medium text-[10px] leading-relaxed normal-case">
                        {labelInfo.explanation}
                    </p>
                </div>
            </div>
        </div>
    );
});

const isP0CheckFailed = (checkId: string, p0Failures: string[]): boolean => {
    const checkIdLower = checkId.toLowerCase();
    return p0Failures.some(failure => {
        const fLower = failure.toLowerCase();
        if (checkIdLower === 'rvol_gate') return fLower.includes('rvol');
        if (checkIdLower === 'consecutive_candles') return fLower.includes('consecutive');
        if (checkIdLower === 'price_extended') return fLower.includes('extended') || fLower.includes('baseline');
        if (checkIdLower === 'rsi_extreme') return fLower.includes('rsi');
        if (checkIdLower === 'momentum_open') return fLower.includes('momentum') || fLower.includes('opening');
        if (checkIdLower === 'vwap_hold') return fLower.includes('vwap');
        if (checkIdLower === 'orb_preserved') return fLower.includes('opening range') || fLower.includes('orb');
        if (checkIdLower === 'ema_alignment') return fLower.includes('ema');
        if (checkIdLower === 'circuit_proximity') return fLower.includes('circuit');
        if (checkIdLower === 'oi_favorable') return fLower.includes('oi');
        if (checkIdLower === 'no_trap') return fLower.includes('trap');
        if (checkIdLower === 'range_contraction') return fLower.includes('contraction');
        return false;
    });
};

const StockScreenerWidget: React.FC<StockScreenerWidgetProps> = ({
    selectedSector,
    onStockSelect,
    selectedStock,
    autoRefresh = true,
    refreshTrigger = 0,
    isVisible = true,
    volumeAverages = {},
    qualityDataCache = {},
}) => {
    const isUpstoxEnabled = useSettingsStore(state => state.isUpstoxEnabled);
    const showOrderBookDepth = useSettingsStore(state => state.showOrderBookDepth);
    const isDepthActive = isUpstoxEnabled && showOrderBookDepth;
    const [stocks, setStocks] = useState<StockData[]>(() => alphaEngineService.getCachedStocks());
    const [isLoading, setIsLoading] = useState(() => alphaEngineService.getCachedStocks().length === 0);
    const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
    const isMobile = useIsMobile();
    const [controlsOpen, setControlsOpen] = useState(false);
    const [sortMode, setSortMode] = useState<SortMode>('convictionScore');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [rankDropdownOpen, setRankDropdownOpen] = useState(false);
    const [factorCategory, setFactorCategory] = useState<FactorCategory>('all');
    const [highConvictionOnly, setHighConvictionOnly] = useState<boolean>(false);
    const [convictionMap, setConvictionMap] = useState<Record<string, any>>({});
    const [dataSource, setDataSource] = useState<'UPSTOX' | 'NSE_SCRAPER' | 'YAHOO' | 'MOCK'>(() => alphaEngineService.getDataSource());
    const [selectedStrategy, setSelectedStrategy] = useState<'all' | StrategyId>('all');

    const strategyCache = useRef<Record<string, { result: any; expiresAt: number }>>({});
    const getCachedBestStrategy = React.useCallback((stock: StockData, inputs: any) => {
        const now = Date.now();
        const cached = strategyCache.current[stock.symbol];
        if (cached && now < cached.expiresAt) {
            return cached.result;
        }
        const result = detectBestStrategy(stock, inputs);
        let fullResult: any = null;
        if (result) {
            fullResult = {
                ...result,
                ...evaluateStrategyScore(stock, result.strategy, inputs)
            };
        }
        strategyCache.current[stock.symbol] = {
            result: fullResult,
            expiresAt: now + 30000 // 30-second TTL
        };
        return fullResult;
    }, []);
    const [visibleCount, setVisibleCount] = useState<number>(30);
    const [newsMap, setNewsMap] = useState<Record<string, any[]>>({});
    const [hoveredNewsSymbol, setHoveredNewsSymbol] = useState<string | null>(null);
    const [newsTooltipPos, setNewsTooltipPos] = useState<{ top: number; left: number } | null>(null);

    const widgetRef = useRef<HTMLDivElement>(null);
    const [isExporting, setIsExporting] = useState(false);

    const handleScreenshot = async () => {
        if (!widgetRef.current) return;
        setIsExporting(true);
        
        const savedCount = visibleCount;
        const totalCount = filteredStocks.length;
        
        // 1. Temporarily show all stocks to capture the entire list
        if (viewMode === 'table' && totalCount > savedCount) {
            setVisibleCount(totalCount);
            // Allow React to re-render the entire table
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        const node = widgetRef.current;
        const scrollContainer = node.querySelector('.overflow-auto') as HTMLDivElement;
        
        const originalHeight = node.style.height;
        const originalMaxHeight = node.style.maxHeight;
        const originalOverflow = node.style.overflow;
        
        let originalScrollHeight = '';
        let originalScrollOverflow = '';
        
        const isTable = viewMode === 'table';
        
        if (isTable) {
            if (scrollContainer) {
                originalScrollHeight = scrollContainer.style.height;
                originalScrollOverflow = scrollContainer.style.overflow;
                
                scrollContainer.style.height = 'auto';
                scrollContainer.style.overflow = 'visible';
            }
            node.style.height = 'auto';
            node.style.maxHeight = 'none';
            node.style.overflow = 'visible';
            
            // Allow browser layout to recalculate
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }

        try {
            const dataUrl = await toPng(node, {
                backgroundColor: '#070d19',
                style: {
                    borderRadius: '2rem'
                }
            });
            const now = new Date();
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const day = String(now.getDate()).padStart(2, '0');
            const month = months[now.getMonth()];
            const year = now.getFullYear();
            const dateStr = `${day}-${month}-${year}`; // e.g., 20-Jul-2026

            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const timeStr = `${hours}꞉${minutes}꞉${seconds}`; // e.g., 12꞉56꞉07

            const link = document.createElement('a');
            link.download = `stock-screener-${(selectedSector || 'all').replace(/\s+/g, '_')}-${dateStr}-${timeStr}.png`;
            link.href = dataUrl;
            link.click();
        } catch (error) {
            console.error('Failed to capture screenshot:', error);
        } finally {
            // Restore original styles and count
            if (isTable) {
                node.style.height = originalHeight;
                node.style.maxHeight = originalMaxHeight;
                node.style.overflow = originalOverflow;
                if (scrollContainer) {
                    scrollContainer.style.height = originalScrollHeight;
                    scrollContainer.style.overflow = originalScrollOverflow;
                }
                setVisibleCount(savedCount);
            }
            setIsExporting(false);
        }
    };

    // Optimized handlers
    const handleStockClick = React.useCallback((stock: StockData) => {
        onStockSelect(stock);
    }, [onStockSelect]);

    const handleTradingViewClick = React.useCallback((e: React.MouseEvent, symbol: string) => {
        e.stopPropagation();
        openTradingView(symbol);
    }, []);

    const handleViewModeTable = React.useCallback(() => setViewMode('table'), []);
    const handleViewModeChart = React.useCallback(() => setViewMode('chart'), []);
    const handleHighConvictionToggle = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setHighConvictionOnly(e.target.checked);
    }, []);

    const handleSortModeChange = React.useCallback((mode: SortMode) => {
        setSortMode(mode);
        setSortDirection(mode === 'symbol' ? 'asc' : 'desc');
    }, []);

    const handleColumnSort = React.useCallback((mode: SortMode) => {
        if (sortMode === mode) {
            setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc');
        } else {
            setSortMode(mode);
            setSortDirection(mode === 'symbol' ? 'asc' : 'desc');
        }
    }, [sortMode]);

    // Reset visible count on filter/sort changes to avoid rendering glitches
    useEffect(() => {
        setVisibleCount(30);
    }, [selectedSector, sortMode, sortDirection, highConvictionOnly]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        if (target.scrollHeight - target.scrollTop <= target.clientHeight + 120) {
            setVisibleCount(prev => Math.min(prev + 30, filteredStocks.length));
        }
    };

    // Instrument key resolution & volume average cache
    const [symbolToKey, setSymbolToKey] = useState<Record<string, string>>({});
    const [volAvgMap, setVolAvgMap] = useState<Record<string, any>>({});
    const [selectionMap, setSelectionMap] = useState<Record<string, StockSelection>>({});
    const [rotationBoard, setRotationBoard] = useState<SectorRotationRow[]>([]);
    // CC68: per-symbol unified ConvictionEngine score for the F&O Constitutions table.
    const [cxBySymbol, setCxBySymbol] = useState<Record<string, ConvictionScore>>({});
    const [mcsSnaps, setMcsSnaps] = useState<Record<string, McsSnapshot>>({});

    // CC68: best-effort async ConvictionEngine pass for the F&O Constitutions table.
    useEffect(() => {
        if (stocks.length === 0 || !selectedSector) return;
        let cancelled = false;
        (async () => {
            const constituents = SECTOR_CONSTITUENTS[selectedSector];
            const symbols = constituents
                ? stocks.filter(s => constituents.includes(s.symbol)).map(s => s.symbol)
                : stocks.map(s => s.symbol);
            if (symbols.length === 0) return;
            const next: Record<string, ConvictionScore> = {};
            const nextMcs: Record<string, McsSnapshot> = {};
            await Promise.all(
                symbols.slice(0, 25).map(async (sym) => {
                    try {
                        const mcsSnap = await mceOrchestrator.score(sym, 'PRE_ENTRY');
                        if (cancelled) return;
                        const stock = stocks.find(s => s.symbol === sym);
                        if (!stock) return;
                        if (mcsSnap) {
                            nextMcs[sym] = mcsSnap;
                        }
                        next[sym] = convictionScore(buildInputsFromStock(stock, {
                            mcs: mcsSnap,
                            direction: stock.signal === 'Up' ? 'CALL' : 'PUT',
                        }));
                    } catch {
                        // skip
                    }
                })
            );
            if (!cancelled) {
                setCxBySymbol(next);
                setMcsSnaps(nextMcs);
            }
        })();
        return () => { cancelled = true; };
    }, [stocks, selectedSector, refreshTrigger]);

    // Calculate conviction scores for the active sector's stocks when they change or G-Factor changes
    useEffect(() => {
        if (stocks.length === 0 || !selectedSector) return;
        
        // Find symbols in the current sector
        const constituents = SECTOR_CONSTITUENTS[selectedSector];
        const activeSectorStocks = constituents
            ? stocks.filter(s => constituents.includes(s.symbol))
            : stocks.filter(s => s.sector === selectedSector);

        if (activeSectorStocks.length === 0) return;

        const calculateScores = async () => {
            const nextMap = { ...convictionMap };
            let updated = false;

            await Promise.all(activeSectorStocks.map(async (s) => {
                const cached = convictionMap[s.symbol];
                // Only recalculate if we don't have it, or if the G-Factor has changed significantly
                const needsCalculation = !cached || Math.abs(cached.gFactor - s.gFactor) > 0.05;
                
                if (needsCalculation) {
                    try {
                        const conviction = await signalFusionService.computeTradeConviction(s);
                        nextMap[s.symbol] = {
                            ...conviction,
                            gFactor: s.gFactor // store the gFactor we calculated it with
                        };
                        updated = true;
                    } catch (e) {
                        nextMap[s.symbol] = {
                            convictionScore: Math.round(s.gFactor * 10),
                            oiQuadrant: 'NEUTRAL',
                            hasActiveNews: false,
                            newsSentimentModifier: 0,
                            gFactor: s.gFactor
                        };
                        updated = true;
                    }
                }
            }));

            if (updated) {
                setConvictionMap(nextMap);
            }
        };
        calculateScores();
    }, [stocks, selectedSector]);

    // Run the Alpha 2.0 selection engine (RS + MTF + liquidity) on
    // every stock refresh.  This is cheap (pure function) and gives
    // the screener the new sort modes (RS composite, MTF coherence,
    // selection conviction, liquidity grade).
    useEffect(() => {
        if (stocks.length === 0) {
            setSelectionMap({});
            setRotationBoard([]);
            return;
        }
        try {
            const { selections, rotation } = alphaSelectionService.run();
            const next: Record<string, StockSelection> = {};
            for (const s of selections) next[s.symbol] = s;
            setSelectionMap(next);
            setRotationBoard(rotation);
        } catch (err) {
            console.error('[StockScreenerWidget] selection engine failed', err);
        }
    }, [stocks, selectedSector]);

    const filteredStocks = useMemo(() => {
        if (!selectedSector) return [];
        const constituents = SECTOR_CONSTITUENTS[selectedSector];
        let sectorStocks = constituents
            ? stocks.filter(s => constituents.includes(s.symbol))
            : stocks.filter(s => s.sector === selectedSector);

        // Apply high conviction filter
        if (highConvictionOnly) {
            sectorStocks = sectorStocks.filter(s => (convictionMap[s.symbol]?.convictionScore ?? 0) > 70);
        }

        // Apply strategy filter
        if (selectedStrategy !== 'all') {
            sectorStocks = sectorStocks.filter(stock => {
                const entry = volAvgMap[stock.symbol];
                const dbAvgVol = entry ? (typeof entry === 'object' ? entry.avg_volume_20d : entry) : 0;
                const adv = volumeAverages[stock.symbol] || dbAvgVol || 0;
                const rvolVal = stock.timeOfDayRvol ?? (adv > 0 ? stock.volume / adv : 1.0);
                const mcsSnap = mcsSnaps[stock.symbol] ?? null;
                const inputs = buildInputsFromStock(stock, {
                    rvol: rvolVal,
                    direction: stock.signal === 'Up' ? 'CALL' : 'PUT',
                    mcs: mcsSnap,
                    orbPreserved: stock.isORBLowPreservedProxy ?? null
                });
                
                const bestStrategy = getCachedBestStrategy(stock, inputs);
                if (!bestStrategy || !bestStrategy.p0Passed) return false;
                if (bestStrategy.strategy !== selectedStrategy) return false;
                
                if (selectedStrategy === 'morning_snapback') {
                    // Check time 09:15 to 10:30
                    const now = new Date();
                    const istTimeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
                    const [hours, minutes] = istTimeStr.split(':').map(Number);
                    const timeVal = hours * 100 + minutes;
                    return timeVal >= 915 && timeVal <= 1030;
                }
                
                return true;
            });
        }

        // De-duplicate sectorStocks by symbol to prevent duplicate listings (e.g. TRENT)
        const seenSymbols = new Set<string>();
        sectorStocks = sectorStocks.filter(s => {
            if (seenSymbols.has(s.symbol)) return false;
            seenSymbols.add(s.symbol);
            return true;
        });

        // Compute alpha scores for sorting
        const sectors = alphaEngineService.getCachedSectors();
        const normalizedSectorName = selectedSector.replace('NIFTY ', '');
        const currentSectorData = sectors.find(s => s.sector === normalizedSectorName || s.sector === selectedSector);
        const sectorChange = currentSectorData ? currentSectorData.percentChange : 0;

        const getAlphaScore = (stock: StockData) => calculateAlphaScore(stock, sectorChange);
        const dir = sortDirection === 'asc' ? -1 : 1;

        if (sortMode === 'symbol') {
            return [...sectorStocks].sort((a, b) => (sortDirection === 'asc' ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol)));
        }
        if (sortMode === 'previousClose') {
            return [...sectorStocks].sort((a, b) => ((b.previousClose || 0) - (a.previousClose || 0)) * dir);
        }
        if (sortMode === 'rvol') {
            const getRvol = (s: StockData) => {
                const volEntry = volAvgMap?.[s.symbol];
                const dbAvgVol = volEntry ? (typeof volEntry === 'object' ? volEntry.avg_volume_20d : volEntry) : 0;
                const adv = volumeAverages[s.symbol] || dbAvgVol || 0;
                return s.timeOfDayRvol ?? (adv > 0 ? s.volume / adv : 1.0);
            };
            return [...sectorStocks].sort((a, b) => (getRvol(b) - getRvol(a)) * dir);
        }
        if (sortMode === 'c2c') {
            return [...sectorStocks].sort((a, b) => (b.percentChange - a.percentChange) * dir);
        }
        if (sortMode === 'openChangePct') {
            const getO2CScore = (s: StockData) => s.signal === 'Down' ? -(s.openChangePct ?? 0) : (s.openChangePct ?? 0);
            return [...sectorStocks].sort((a, b) => (getO2CScore(b) - getO2CScore(a)) * dir);
        }
        if (sortMode === 'alphaScore') {
            return [...sectorStocks].sort((a, b) => (getAlphaScore(b) - getAlphaScore(a)) * dir);
        }
        if (sortMode === 'gFactor') {
            return [...sectorStocks].sort((a, b) => (b.gFactor - a.gFactor) * dir);
        }
        if (sortMode === 'rFactor') {
            return [...sectorStocks].sort((a, b) => ((b.rFactor ?? 0) - (a.rFactor ?? 0)) * dir);
        }
        if (sortMode === 'openingGap') {
            return [...sectorStocks].sort((a, b) => (Math.abs(b.openingGapPct) - Math.abs(a.openingGapPct)) * dir);
        }
        if (sortMode === 'dayExtreme') {
            return [...sectorStocks].sort((a, b) => (b.dayExtremeScore - a.dayExtremeScore) * dir);
        }
        if (sortMode === 'fundamentalScore') {
            return [...sectorStocks].sort((a, b) => (calculateFundamentalScore(b.symbol, qualityDataCache) - calculateFundamentalScore(a.symbol, qualityDataCache)) * dir);
        }
        if (sortMode === 'compositeAlphaScore') {
            return [...sectorStocks].sort((a, b) => {
                const aFScore = calculateFundamentalScore(a.symbol, qualityDataCache);
                const bFScore = calculateFundamentalScore(b.symbol, qualityDataCache);
                const aComposite = calculateCompositeAlphaScore(a.gFactor, aFScore);
                const bComposite = calculateCompositeAlphaScore(b.gFactor, bFScore);
                return (bComposite - aComposite) * dir;
            });
        }
        if (sortMode === 'momentumContinuationScore') {
            return [...sectorStocks].sort((a, b) => {
                const aScore = a.orderBookSignal?.momentumContinuationScore ?? 0;
                const bScore = b.orderBookSignal?.momentumContinuationScore ?? 0;
                return (bScore - aScore) * dir;
            });
        }
        if (sortMode === 'convictionScore') {
            return [...sectorStocks].sort((a, b) => {
                // CC68: prefer unified ConvictionEngine score when available.
                const aCx = cxBySymbol[a.symbol];
                const bCx = cxBySymbol[b.symbol];
                if (aCx && bCx) return (bCx.score - aCx.score) * dir;
                if (aCx) return -1 * dir;
                if (bCx) return 1 * dir;
                const aScore = convictionMap[a.symbol]?.convictionScore ?? 0;
                const bScore = convictionMap[b.symbol]?.convictionScore ?? 0;
                return (bScore - aScore) * dir;
            });
        }
        if (sortMode === 'rsComposite') {
            return [...sectorStocks].sort((a, b) =>
                ((selectionMap[b.symbol]?.rs.composite ?? -1) - (selectionMap[a.symbol]?.rs.composite ?? -1)) * dir
            );
        }
        if (sortMode === 'mtfCoherence') {
            return [...sectorStocks].sort((a, b) =>
                ((selectionMap[b.symbol]?.mtf.coherence ?? 0) - (selectionMap[a.symbol]?.mtf.coherence ?? 0)) * dir
            );
        }
        if (sortMode === 'selectionConviction') {
            return [...sectorStocks].sort((a, b) =>
                ((selectionMap[b.symbol]?.convictionIndex ?? 0) - (selectionMap[a.symbol]?.convictionIndex ?? 0)) * dir
            );
        }
        if (sortMode === 'liquidityGrade') {
            const gradeScore = (g: string | undefined) => g === 'A' ? 3 : g === 'B' ? 2 : g === 'C' ? 1 : 0;
            return [...sectorStocks].sort((a, b) =>
                (gradeScore(selectionMap[b.symbol]?.liquidity.grade) - gradeScore(selectionMap[a.symbol]?.liquidity.grade)) * dir
            );
        }
        if (sortMode === 'derivativesScore') {
            return [...sectorStocks].sort((a, b) =>
                ((selectionMap[b.symbol]?.derivativesScore ?? 0) - (selectionMap[a.symbol]?.derivativesScore ?? 0)) * dir
            );
        }
        if (sortMode === 'derivativesVerdict') {
            const verdictScore = (v: string | undefined) => {
                if (v === 'APEX_BUY' || v === 'APEX_SELL') return 4;
                if (v === 'TRAP_RISK') return 1; // bottom - we want to *hide* traps
                if (v === 'NEUTRAL') return 3;
                return 2; // LOW_CONVICTION
            };
            return [...sectorStocks].sort((a, b) =>
                (verdictScore(selectionMap[b.symbol]?.derivativesVerdict) - verdictScore(selectionMap[a.symbol]?.derivativesVerdict)) * dir
            );
        }
        return [...sectorStocks].sort((a, b) => (b.gFactor - a.gFactor) * dir);
    }, [stocks, selectedSector, sortMode, sortDirection, highConvictionOnly, convictionMap, selectionMap, selectedStrategy, volumeAverages, volAvgMap, cxBySymbol]);

    // Fetch Upstox News details for visible stocks dynamically
    const symbolsJoined = useMemo(() => {
        const visibleStocks = filteredStocks.slice(0, visibleCount);
        return visibleStocks.map(s => {
            return s.symbol.replace(/\s+\[NEWS\]$/i, '').replace(/\s+NEWS$/i, '').toUpperCase().trim();
        }).join(',');
    }, [filteredStocks, visibleCount]);

    useEffect(() => {
        if (!symbolsJoined) return;
        
        let isMounted = true;
        
        const fetchNewsForSymbols = async () => {
            try {
                const response = await fetch(`/api/python-nse/api/upstox/news?symbols=${encodeURIComponent(symbolsJoined)}`);
                if (response.ok) {
                    const res = await response.json();
                    if (res.status === 'success' && res.data && isMounted) {
                        setNewsMap(prev => ({
                            ...prev,
                            ...res.data
                        }));
                    }
                }
            } catch (err) {
                console.error('Failed to fetch screener stock news', err);
            }
        };
        
        fetchNewsForSymbols();
        
        return () => {
            isMounted = false;
        };
    }, [symbolsJoined]);

    // Fetch 20d volume averages on mount (cached for 12h)
    useEffect(() => {
        upstoxMarketDataService.getAllVolumeAverages()
            .then(data => setVolAvgMap(data))
            .catch(err => console.error('Failed to load volume averages:', err));
    }, []);

    // Resolve instrument keys when filtered constituent symbols change
    useEffect(() => {
        if (filteredStocks.length === 0) return;
        const symbols = filteredStocks.map(s => s.symbol);
        
        let active = true;
        upstoxInstrumentService.getInstrumentKeys(symbols, 'NSE_EQ').then((keysMap) => {
            if (active) {
                setSymbolToKey(keysMap);
            }
        });
        return () => { active = false; };
    }, [filteredStocks.map(s => s.symbol).join(',')]);

    const symbolToKeyRef = React.useRef(symbolToKey);
    useEffect(() => {
        symbolToKeyRef.current = symbolToKey;
    }, [symbolToKey]);

    const volAvgMapRef = React.useRef(volAvgMap);
    useEffect(() => {
        volAvgMapRef.current = volAvgMap;
    }, [volAvgMap]);

    // Merge live ticks into stocks state and recalculate G-Factor on volume spikes
    // Throttled to 500ms to prevent Live Tick Re-render Bomb
    useEffect(() => {
        if (stocks.length === 0) return;

        const interval = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            const currentTicks = useGlobalTickStore.getState().ticks;
            if (Object.keys(currentTicks).length === 0) return;

            setStocks((prevStocks) => {
                let changed = false;
                const updated = prevStocks.map(stock => {
                    const key = symbolToKeyRef.current[stock.symbol];
                    if (key && currentTicks[key]) {
                        const tick = currentTicks[key];
                        let stockChanged = false;
                        const newStock = { ...stock };

                        if (tick.ltp !== null && tick.ltp !== newStock.lastPrice) {
                            newStock.lastPrice = tick.ltp;
                            const change = tick.ltp - newStock.previousClose;
                            newStock.percentChange = newStock.previousClose > 0 ? (change / newStock.previousClose) * 100 : 0;
                            newStock.openChangePct = newStock.openPrice > 0 ? ((tick.ltp - newStock.openPrice) / newStock.openPrice) * 100 : 0;
                            stockChanged = true;
                        }

                        if (tick.volume !== null && tick.volume !== newStock.volume) {
                            const prevVolume = newStock.volume;
                            newStock.volume = tick.volume;
                            newStock.value = tick.volume * (tick.ltp || newStock.lastPrice);
                            
                            // Check for significant volume spike (current volume > 2x average) (H.2.4)
                            const volEntry = volAvgMapRef.current[stock.symbol];
                            const avgVol = volEntry ? (typeof volEntry === 'object' ? volEntry.avg_volume_20d : volEntry) : 0;
                            const volumeVelocity = prevVolume > 0 ? (tick.volume / prevVolume) : 1;
                            
                            if (avgVol > 0 && tick.volume > 2.0 * avgVol) {
                                newStock.gFactor = calculateStockGFactor(newStock, volumeVelocity);
                            } else if (volumeVelocity > 1.3) {
                                newStock.gFactor = calculateStockGFactor(newStock, volumeVelocity);
                            }
                            stockChanged = true;
                        }

                        if (tick.oi !== null && tick.oi !== newStock.oi) {
                            newStock.oi = tick.oi;
                            stockChanged = true;
                        }

                        // Compute L2 order book signal
                        const volEntryL2 = volAvgMapRef.current[stock.symbol];
                        const avgVol = volEntryL2 ? (typeof volEntryL2 === 'object' ? volEntryL2.avg_volume_20d : volEntryL2) : 0;
                        const relVol = avgVol > 0 ? (newStock.volume / avgVol) : 1.0;
                        const direction = newStock.signal === 'Up' ? 1 : -1;
                        const priceAccel = newStock.openPrice > 0 
                          ? (direction * (newStock.lastPrice - newStock.openPrice) / newStock.openPrice) * 100 
                          : 0;
                        const normPriceAccel = Math.max(0, Math.min(priceAccel / 0.5, 1.0));

                        if (tick.depth) {
                            newStock.orderBookSignal = orderBookIntelligenceService.processDepthTick(
                                tick,
                                relVol,
                                normPriceAccel
                            );
                            stockChanged = true;
                        }

                        if (stockChanged) {
                            // Upgraded G-Factor (Real-time TPS + Gravity integration)
                            const gInputs = {
                                percentChange: newStock.percentChange,
                                openingGapPct: newStock.openingGapPct,
                                ltp: newStock.lastPrice,
                                high: newStock.high,
                                low: newStock.low,
                                openPrice: newStock.openPrice,
                                rvol: relVol,
                                tps: newStock.orderBookSignal?.tradesPerSecond,
                                gravityScore: newStock.orderBookSignal?.gravityScore
                            };
                            newStock.gFactor = computeGFactor(gInputs);

                            // Upgraded R-Factor (Real-time D30 Gravity Reversion cushion)
                            const avgAbsChg = volEntryL2 ? (typeof volEntryL2 === 'object' ? (volEntryL2 as any).avg_abs_change_20d : 1.0) : 1.0;
                            const chgRatio = avgAbsChg > 0 ? Math.abs(newStock.percentChange) / avgAbsChg : 1.0;
                            let rFactorVal = relVol * chgRatio;
                            const gravity = newStock.orderBookSignal?.gravityScore;
                            if (gravity !== undefined) {
                                const isUp = newStock.percentChange > 0;
                                if (isUp && gravity < -0.1) {
                                    rFactorVal *= (1.0 + Math.abs(gravity) * 0.25);
                                } else if (!isUp && gravity > 0.1) {
                                    rFactorVal *= (1.0 + gravity * 0.25);
                                } else {
                                    rFactorVal *= 0.85;
                                }
                            }
                            newStock.rFactor = Number(rFactorVal.toFixed(2));
                        }

                        if (tick.atp !== undefined && tick.atp !== null && tick.atp !== newStock.atp) {
                            newStock.atp = tick.atp;
                            stockChanged = true;
                        }

                        if (tick.ohlc_intervals) {
                            newStock.ohlc_intervals = tick.ohlc_intervals;
                            stockChanged = true;

                            if (tick.ohlc_intervals["I1"]) {
                                const i1 = tick.ohlc_intervals["I1"];
                                const newCandle = {
                                    open: i1.open,
                                    high: i1.high,
                                    low: i1.low,
                                    close: i1.close,
                                    volume: i1.volume,
                                    ts: i1.timestamp
                                };
                                let buffer = [...(newStock.candleBuffer || [])];
                                if (buffer.length === 0) {
                                    buffer.push(newCandle);
                                    newStock.candleBuffer = buffer;
                                    stockChanged = true;
                                } else {
                                    const last = buffer[buffer.length - 1];
                                    if (last.ts === newCandle.ts) {
                                        buffer[buffer.length - 1] = newCandle;
                                        newStock.candleBuffer = buffer;
                                        stockChanged = true;
                                    } else {
                                        buffer.push(newCandle);
                                        if (buffer.length > 5) {
                                            buffer.shift();
                                        }
                                        newStock.candleBuffer = buffer;
                                        stockChanged = true;
                                    }
                                }
                            }
                        }

                        if (stockChanged) {
                            changed = true;
                            return newStock;
                        }
                    }
                    return stock;
                });

                return changed ? updated : prevStocks;
            });
        }, 500);

        return () => clearInterval(interval);
    }, [stocks.length === 0]);

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
        const now = new Date();
        return now.toLocaleTimeString('en-US', { hour12: false });
    });

    const fetchStocks = async (isManual: boolean = false) => {
        if (stocks.length === 0) setIsLoading(true);
        if (isManual) {
            setIsRefreshing(true);
            signalFusionService.clearCache();
            setConvictionMap({});
        }
        try {
            const data = await alphaEngineService.fetchFnOStocks(isManual);
            if (data) {
                setStocks(data);
                setDataSource(alphaEngineService.getDataSource());
                const now = new Date();
                setLastSyncTime(now.toLocaleTimeString('en-US', { hour12: false }));
            }
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        const isManual = refreshTrigger > 0;
        fetchStocks(isManual);
    }, [refreshTrigger]);

    // Adaptive background pause: freezes polling when tab is hidden, immediate refresh when tab is focused
    usePausedInterval(
        () => fetchStocks(true),
        autoRefresh && isVisible ? 45000 : null,
        { runImmediately: false }
    );

    const { advance, decline } = useMemo(() => {
        let adv = 0; let dec = 0;
        filteredStocks.forEach(s => { if (s.percentChange >= 0) adv++; else dec++; });
        return { advance: adv, decline: dec };
    }, [filteredStocks]);

    const total = advance + decline;
    const advancePercent = total > 0 ? (advance / total) * 100 : 0;
    const declinePercent = total > 0 ? (decline / total) * 100 : 0;

    const advanceStyle = React.useMemo(() => ({ width: `${advancePercent}%` }), [advancePercent]);
    const declineStyle = React.useMemo(() => ({ width: `${declinePercent}%` }), [declinePercent]);

    const chartData = useMemo(() => {
        const sectors = alphaEngineService.getCachedSectors();
        const normalizedSectorName = selectedSector ? selectedSector.replace('NIFTY ', '') : '';
        const currentSectorData = sectors.find(s => s.sector === normalizedSectorName || s.sector === selectedSector);
        const sectorChange = currentSectorData ? currentSectorData.percentChange : 0;

        return filteredStocks.map(stock => {
            let val = 0;
            let fill = '#6366f1'; // Indigo default

            // Determine value and color based on sortMode
            switch (sortMode) {
                case 'c2c':
                    val = stock.percentChange;
                    fill = val >= 0 ? '#10b981' : '#ef4444';
                    break;
                case 'openChangePct':
                    val = stock.openChangePct ?? 0;
                    fill = val >= 0 ? '#10b981' : '#ef4444';
                    break;
                case 'alphaScore':
                    val = calculateAlphaScore(stock, sectorChange);
                    fill = val >= 70 ? '#10b981' : val >= 40 ? '#f59e0b' : '#ef4444';
                    break;
                case 'gFactor':
                    val = stock.gFactor;
                    fill = val >= 3 ? '#eab308' : '#64748b';
                    break;
                case 'rFactor':
                    val = stock.rFactor ?? 0;
                    fill = val > 1.5 ? '#10b981' : val < -1.5 ? '#ef4444' : '#64748b';
                    break;
                case 'openingGap':
                    val = stock.openingGapPct;
                    fill = val >= 0 ? '#10b981' : '#ef4444';
                    break;
                case 'dayExtreme':
                    val = stock.dayExtremeScore * 100;
                    fill = val >= 75 ? '#10b981' : val < 25 ? '#ef4444' : '#64748b';
                    break;
                case 'fundamentalScore':
                    val = calculateFundamentalScore(stock.symbol, qualityDataCache);
                    // Color-code quality scores: Green >= 70, Red < 40, Slate/neutral otherwise (#64748b)
                    fill = val >= 70 ? '#10b981' : val < 40 ? '#ef4444' : '#64748b';
                    break;
                case 'compositeAlphaScore':
                    val = calculateCompositeAlphaScore(stock.gFactor, calculateFundamentalScore(stock.symbol, qualityDataCache));
                    fill = val >= 70 ? '#10b981' : val >= 50 ? '#f59e0b' : '#ef4444';
                    break;
                case 'convictionScore':
                    val = convictionMap[stock.symbol]?.convictionScore ?? 50;
                    fill = val >= 70 ? '#10b981' : val >= 50 ? '#f59e0b' : '#ef4444';
                    break;
                case 'momentumContinuationScore':
                    val = stock.orderBookSignal?.momentumContinuationScore ?? 0;
                    fill = val >= 70 ? '#10b981' : val >= 40 ? '#f59e0b' : '#ef4444';
                    break;
                case 'rsComposite':
                    val = (selectionMap[stock.symbol]?.rs.composite ?? -1) * 100;
                    fill = val >= 30 ? '#10b981' : val <= -20 ? '#ef4444' : '#f59e0b';
                    break;
                case 'mtfCoherence':
                    val = (selectionMap[stock.symbol]?.mtf.coherence ?? 0) * 100;
                    fill = val >= 60 ? '#10b981' : val <= 30 ? '#ef4444' : '#f59e0b';
                    break;
                case 'selectionConviction':
                    val = selectionMap[stock.symbol]?.convictionIndex ?? 0;
                    fill = val >= 70 ? '#10b981' : val >= 40 ? '#f59e0b' : '#ef4444';
                    break;
                case 'liquidityGrade': {
                    const g = selectionMap[stock.symbol]?.liquidity.grade ?? 'REJECTED';
                    val = g === 'A' ? 3 : g === 'B' ? 2 : g === 'C' ? 1 : 0;
                    fill = g === 'A' ? '#10b981' : g === 'B' ? '#22c55e' : g === 'C' ? '#f59e0b' : '#ef4444';
                    break;
                }
                case 'derivativesScore':
                    val = selectionMap[stock.symbol]?.derivativesScore ?? 0;
                    fill = val >= 75 ? '#10b981' : val >= 50 ? '#f59e0b' : '#ef4444';
                    break;
                case 'derivativesVerdict': {
                    const v = selectionMap[stock.symbol]?.derivativesVerdict ?? 'LOW_CONVICTION';
                    if (v === 'APEX_BUY' || v === 'APEX_SELL') { val = 4; fill = '#10b981'; }
                    else if (v === 'NEUTRAL') { val = 3; fill = '#22c55e'; }
                    else if (v === 'LOW_CONVICTION') { val = 2; fill = '#f59e0b'; }
                    else { val = 1; fill = '#ef4444'; } // TRAP_RISK
                    break;
                }
                case 'rvol': {
                    const volEntry = volAvgMap?.[stock.symbol];
                    const dbAvgVol = volEntry ? (typeof volEntry === 'object' ? volEntry.avg_volume_20d : volEntry) : 0;
                    const adv = volumeAverages[stock.symbol] || dbAvgVol || 0;
                    val = stock.timeOfDayRvol ?? (adv > 0 ? stock.volume / adv : 1.0);
                    fill = val >= 2 ? '#10b981' : val >= 1 ? '#f59e0b' : '#ef4444';
                    break;
                }
                case 'previousClose':
                    val = stock.previousClose || 0;
                    fill = '#64748b';
                    break;
                case 'symbol':
                    val = stock.percentChange;
                    fill = val >= 0 ? '#10b981' : '#ef4444';
                    break;
                default:
                    val = stock.gFactor;
            }

            return {
                name: stock.symbol,
                value: Number(val.toFixed(2)),
                fill,
                percentChange: stock.percentChange,
                openChangePct: stock.openChangePct ?? 0,
                gFactor: stock.gFactor,
                rFactor: stock.rFactor ?? 0,
                openingGapPct: stock.openingGapPct,
                dayExtremeScore: stock.dayExtremeScore,
                fundamentalScore: calculateFundamentalScore(stock.symbol, qualityDataCache),
                compositeAlphaScore: calculateCompositeAlphaScore(stock.gFactor, calculateFundamentalScore(stock.symbol, qualityDataCache)),
                // CC68: prefer unified ConvictionEngine score when available.
                convictionScore: cxBySymbol[stock.symbol] && !cxBySymbol[stock.symbol].killed
                    ? cxBySymbol[stock.symbol].score
                    : (convictionMap[stock.symbol]?.convictionScore ?? 50),
                momentumContinuationScore: stock.orderBookSignal?.momentumContinuationScore ?? 0,
                gravityScore: stock.orderBookSignal?.gravityScore ?? 0,
                demandZones: stock.orderBookSignal?.demandZones ?? [],
                supplyZones: stock.orderBookSignal?.supplyZones ?? [],
                bigSharkAlert: stock.orderBookSignal?.bigSharkAlert ?? null,
                rsComposite: selectionMap[stock.symbol]?.rs.composite ?? 0,
                mtfCoherence: selectionMap[stock.symbol]?.mtf.coherence ?? 0,
                selectionConviction: selectionMap[stock.symbol]?.convictionIndex ?? 0,
                liquidityGrade: selectionMap[stock.symbol]?.liquidity.grade ?? 'REJECTED',
                derivativesScore: selectionMap[stock.symbol]?.derivativesScore ?? 0,
                derivativesVerdict: selectionMap[stock.symbol]?.derivativesVerdict ?? 'LOW_CONVICTION',
                isTrapRisk: stock.isTrapRisk,
                isExhausted: stock.isExhausted,
                isRebound: stock.isRebound
            };
        });
    }, [filteredStocks, sortMode, convictionMap, selectedSector, selectionMap]);

    const CustomChartTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-slate-950/95 border border-slate-800 p-4 rounded-2xl shadow-2xl backdrop-blur-md max-w-xs space-y-2 pointer-events-none text-left z-50">
                    <div className="flex justify-between items-center gap-2 border-b border-slate-800/80 pb-2">
                        <p className="text-white font-black text-xs uppercase tracking-wider">{data.name}</p>
                        <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded border border-slate-700/50 bg-slate-800/85 text-slate-400 font-mono">
                            Score: {data.convictionScore}/100
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-1">
                        <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black block">C2C Return</span>
                            <span className={`text-xs font-mono font-black ${data.percentChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.percentChange >= 0 ? '+' : ''}{data.percentChange.toFixed(2)}%
                            </span>
                        </div>
                        <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black block">O2C Change</span>
                            <span className={`text-xs font-mono font-black ${data.openChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.openChangePct >= 0 ? '+' : ''}{data.openChangePct.toFixed(2)}%
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-1 border-t border-slate-800/50">
                        <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black block">G-Factor</span>
                            <span className="text-xs font-mono font-black text-yellow-400">
                                {data.gFactor.toFixed(2)}
                            </span>
                        </div>
                        <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black block">R-Factor</span>
                            <span className={`text-xs font-mono font-black ${data.rFactor > 1.5 ? 'text-emerald-400' : data.rFactor < -1.5 ? 'text-rose-400' : 'text-slate-450'}`}>
                                {data.rFactor.toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-1 border-t border-slate-800/50">
                        <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black block">Opening Gap</span>
                            <span className={`text-xs font-mono font-black ${data.openingGapPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.openingGapPct >= 0 ? '+' : ''}{data.openingGapPct.toFixed(2)}%
                            </span>
                        </div>
                        <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black block">Day Extreme</span>
                            <span className="text-xs font-mono font-black text-indigo-400">
                                {(data.dayExtremeScore * 100).toFixed(0)}%
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-1 border-t border-slate-800/50">
                        <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black block">Fund Score</span>
                            <span className="text-xs font-mono font-black text-emerald-400">
                                {data.fundamentalScore}/100
                            </span>
                        </div>
                        <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black block">Comp Alpha</span>
                            <span className="text-xs font-mono font-black text-indigo-400">
                                {data.compositeAlphaScore}/100
                            </span>
                        </div>
                    </div>

                    {isDepthActive && (
                        <>
                            <div className="grid grid-cols-2 gap-4 pt-1 border-t border-slate-800/50">
                                <div>
                                    <span className="text-[9px] text-slate-500 uppercase font-black block">L2 Depth Score</span>
                                    <span className={`text-xs font-mono font-black ${data.momentumContinuationScore >= 70 ? 'text-emerald-400' : data.momentumContinuationScore >= 40 ? 'text-amber-400' : 'text-rose-400'}`}>
                                        {data.momentumContinuationScore}/100
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[9px] text-slate-500 uppercase font-black block">L2 Signal</span>
                                    <span className={`text-xs font-mono font-black ${data.momentumContinuationScore >= 70 ? 'text-emerald-400' : data.momentumContinuationScore >= 40 ? 'text-amber-400' : 'text-rose-400'}`}>
                                        {data.momentumContinuationScore >= 70 ? 'CONTINUE' : data.momentumContinuationScore >= 40 ? 'CAUTION' : 'REVERSAL_RISK'}
                                    </span>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 pt-1 border-t border-slate-800/50">
                                <div>
                                    <span className="text-[9px] text-slate-500 uppercase font-black block">Gravity Pull</span>
                                    <span className={`text-xs font-mono font-black ${data.gravityScore >= 0.1 ? 'text-emerald-400' : data.gravityScore <= -0.1 ? 'text-rose-400' : 'text-slate-400'}`}>
                                        {data.gravityScore >= 0 ? '+' : ''}{(data.gravityScore * 100).toFixed(0)}%
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[9px] text-slate-500 uppercase font-black block">Dominance</span>
                                    <span className={`text-xs font-mono font-black ${data.gravityScore >= 0.1 ? 'text-emerald-400' : data.gravityScore <= -0.1 ? 'text-rose-400' : 'text-slate-400'}`}>
                                        {data.gravityScore >= 0.1 ? 'BIDS (BUY)' : data.gravityScore <= -0.1 ? 'ASKS (SELL)' : 'BALANCED'}
                                    </span>
                                </div>
                            </div>
                            {((data.demandZones && data.demandZones.length > 0) || (data.supplyZones && data.supplyZones.length > 0)) && (
                                <div className="pt-2 border-t border-slate-800/50 text-[10px] space-y-1 font-mono text-left">
                                    <div className="text-[9px] text-slate-500 uppercase font-black tracking-wider">D30 Supply / Demand Zones</div>
                                    {data.demandZones.map((z: any, idx: number) => (
                                        <div key={`d-${idx}`} className="flex justify-between items-center text-emerald-400">
                                            <span>Demand Zone #{idx + 1}:</span>
                                            <span>₹{z.price.toFixed(2)} ({z.qty.toLocaleString()})</span>
                                        </div>
                                    ))}
                                    {data.supplyZones.map((z: any, idx: number) => (
                                        <div key={`s-${idx}`} className="flex justify-between items-center text-rose-400">
                                            <span>Supply Zone #{idx + 1}:</span>
                                            <span>₹{z.price.toFixed(2)} ({z.qty.toLocaleString()})</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {data.bigSharkAlert && (
                                <div className="mt-2 pt-2 border-t border-slate-800/50 flex flex-col gap-0.5 animate-pulse bg-indigo-500/10 p-1.5 rounded border border-indigo-500/35 text-left">
                                    <div className="text-[8px] font-black uppercase text-indigo-400">🦈 BIG SHARK SWEEP DETECTED</div>
                                    <div className="text-[10px] font-mono font-black flex justify-between items-center text-slate-200">
                                        <span>Action: <span className={data.bigSharkAlert.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>{data.bigSharkAlert.type}</span></span>
                                        <span>Qty: {data.bigSharkAlert.qty.toLocaleString()} @ ₹{data.bigSharkAlert.price.toFixed(2)}</span>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {(data.isTrapRisk || data.isExhausted || data.isRebound) && (
                        <div className="mt-2 pt-2 border-t border-wa-border flex flex-wrap gap-1.5">
                            {data.isTrapRisk && (
                                <span className="text-[8px] font-black px-1.5 py-0.5 rounded-wa-sm bg-rose-500/10 text-rose-400 border border-rose-500/20 uppercase tracking-wider whitespace-nowrap min-w-[85px] text-center inline-flex items-center justify-center">
                                    ⚠️ TRAP RISK
                                </span>
                            )}
                            {data.isExhausted && (
                                <span className="text-[8px] font-black px-1.5 py-0.5 rounded-wa-sm bg-amber-500/10 text-amber-500 border border-amber-500/20 uppercase tracking-wider whitespace-nowrap min-w-[85px] text-center inline-flex items-center justify-center">
                                    ⚠️ EXHAUSTED
                                </span>
                            )}
                            {data.isRebound && (
                                <span className="text-[8px] font-black px-1.5 py-0.5 rounded-wa-sm bg-emerald-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-wider whitespace-nowrap min-w-[85px] text-center inline-flex items-center justify-center">
                                    ✅ REBOUND
                                </span>
                            )}
                        </div>
                    )}
                </div>
            );
        }
        return null;
    };

    if (isLoading && stocks.length === 0) {
        return (
            <div className="bg-wa-card/50 backdrop-blur-md rounded-wa-lg p-6 border border-wa-border animate-pulse h-[500px] flex items-center justify-center">
                <Activity className="w-8 h-8 text-indigo-400 opacity-50" />
            </div>
        );
    }

    if (!selectedSector) {
        return (
            <div className="bg-wa-card/50 backdrop-blur-md rounded-wa-lg p-6 border border-wa-border h-[500px] flex flex-col items-center justify-center text-slate-500">
                <List className="w-8 h-8 mb-3 opacity-50" />
                <p>Select a sector from the heatmap</p>
            </div>
        );
    }

    const sortLabels: Record<SortMode, { 
        label: string; 
        desc: string; 
        title: string;
        formula: string;
        explanation: string;
        icon: React.ReactNode; 
        color: string;
    }> = {
        momentumContinuationScore: {
            label: 'Depth Score',
            desc: 'Momentum Continuation Score based on Level 2 Order Book (0-100)',
            title: 'L2 Depth Momentum Score',
            formula: 'Score = Imbalance(35%) + RelVolume(25%) + PriceAccel(25%) + NoWallAbove(15%)',
            explanation: 'Calculates the real-time probability of momentum continuation by analyzing order book imbalance, relative volume surge, price acceleration, and lack of supply resistance walls.',
            icon: <Zap className="w-3.5 h-3.5 text-emerald-400" />,
            color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
        },
        convictionScore: {
            label: 'Conviction',
            desc: 'AI Fused Trade Conviction Score (0-100)',
            title: 'AI Trade Conviction',
            formula: 'Conviction = G_Factor(30%) + OI_Quadrant(25%) + Fundamentals(20%) + Ownership(15%) + IV_Rank(10%) + News(Modifier)',
            explanation: 'Institutional multi-source synthesis ranking stocks by overall probability. Higher scores denote aligned volume speed, option buildup, ownership accumulation, low IV premiums, and positive news catalysts.',
            icon: <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />,
            color: 'text-indigo-400 border-indigo-500/40 bg-indigo-500/10'
        },
        c2c: {
            label: 'C2C %',
            desc: 'Close-to-Close Percentage Change',
            title: 'Close-to-Close Momentum',
            formula: 'C2C = ((LTP - PrevClose) / PrevClose) * 100',
            explanation: 'Measures total percentage change from yesterday\'s close to current price. Useful for tracking daily performance relative to the market close.',
            icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
            color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
        },
        openChangePct: {
            label: 'O2C %',
            desc: 'Intraday Open-to-Current Momentum',
            title: 'Intraday O2C Momentum',
            formula: 'O2C = ((LTP - Open) / Open) * 100',
            explanation: 'Measures intraday percentage change from today\'s opening price. Highlights pure strength within the session, filtering out pre-market gaps. Extremely useful for identifying stocks undergoing true intraday accumulation.',
            icon: <Zap className="w-3.5 h-3.5 text-cyan-400" />,
            color: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10'
        },
        alphaScore: {
            label: 'Alpha Score',
            desc: 'Multi-Confluence Selection Score',
            title: 'Alpha Convergence Score',
            formula: 'ACS = (SectorStrength * 0.2) + (GapStrength * 0.3) + (ExtremeStrength * 0.4) + (PercentChange * 0.1)',
            explanation: 'Mathematical multi-factor index combining sector stability, opening gap thresholds (penalizing exhaustion), and Day Extreme Score to bubble up high-probability, low-risk continuation setups.',
            icon: <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />,
            color: 'text-indigo-400 border-indigo-500/40 bg-indigo-500/10'
        },
        gFactor:    { 
            label: 'G-Factor', 
            desc: 'Current Confluence Score', 
            title: 'G-Factor Confluence',
            formula: 'G = ORB_Low_Preserved + HOD_Breakout + VolumeSurge + GapUp + MomentumBonus',
            explanation: 'Rules-based confluence score combining opening range preservation, breakout verification, volume validation, and session momentum. High scores indicate high-probability breakout setups.',
            icon: <TrendingUp className="w-3.5 h-3.5 text-yellow-400" />, 
            color: 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10' 
        },
        rFactor: {
            label: 'R-Factor',
            desc: 'Institutional Order Flow Aggression',
            title: 'R-Factor Institutional Flow',
            formula: 'R = CompositeValue / TimeSlotBaseline',
            explanation: 'Institutional Aggression Multiplier combining Options Synergy (Open Interest change * Volume) with Price Spread Aggression (Close-Low-High relation * Underlying Volume). Above 1.5 indicates institutional buying aggression; below -1.5 indicates selling aggression.',
            icon: <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />,
            color: 'text-indigo-400 border-indigo-500/40 bg-indigo-500/10'
        },
        openingGap: { 
            label: 'Opening Gap %', 
            desc: 'Pre-Explosion Signal (9:45 AM)', 
            title: 'Opening Gap Percentage',
            formula: 'Gap % = ((Open - PrevClose) / PrevClose) * 100',
            explanation: 'Percentage difference between today\'s open price and yesterday\'s close price. Best for identifying pre-explosion breakout setups at the market open (9:45 AM) before the main session move.',
            icon: <Zap className="w-3.5 h-3.5 text-emerald-400" />, 
            color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' 
        },
        dayExtreme: { 
            label: 'Day Extreme', 
            desc: 'Position within Day Range', 
            title: 'Day Extreme Score',
            formula: 'Extreme Score = (LTP - Low) / (High - Low)',
            explanation: 'Tracks price relative position inside the current session\'s high-low range. A score near 1.0 indicates trading at the day\'s absolute high (extremely bullish strength); near 0.0 indicates trading at the absolute low (extremely bearish weakness).',
            icon: <Activity className="w-3.5 h-3.5 text-indigo-400" />, 
            color: 'text-indigo-400 border-indigo-500/40 bg-indigo-500/10' 
        },
        fundamentalScore: {
            label: 'Fund Score',
            desc: 'Stockezee quality score (real fundamentals)',
            title: 'Fundamental Score',
            formula: 'FS = Real Stockezee Quality Score (total_score)',
            explanation: 'Ranks company fundamentals out of 100 using real-time quality score card from Stockezee proxy (overall score combining profitability, growth, moat, risk, and management audits).',
            icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
            color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
        },
        compositeAlphaScore: {
            label: 'Comp Alpha',
            desc: 'Momentum + Fundamentals Fusion Score (0-100)',
            title: 'Composite Alpha Score',
            formula: 'CAS = (G_Factor * 10 * 0.6) + (Fundamental_Score * 0.4)',
            explanation: 'Combines technical breakout strength (G-Factor, 60% weight) and structural company quality (Fundamental Score, 40% weight). Ranks stocks by absolute conviction where both speed and safety align.',
            icon: <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />,
            color: 'text-indigo-400 border-indigo-500/40 bg-indigo-500/10'
        },
        rsComposite: {
            label: 'RS Composite',
            desc: 'Stock-vs-Sector × Sector-vs-Benchmark Relative Strength',
            title: 'Relative Strength (Two-Layer)',
            formula: 'RS = 0.6·tanh((stock−sector)/σ_s) + 0.4·tanh(zFactor/5)',
            explanation: 'Two-layer RS: stock must beat its sector (60%) and the sector must lead the index (40%). Bounded to [-1, +1]; positive values are leaders, negative are laggards. Hard floor at -0.20 to drop deep laggards.',
            icon: <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />,
            color: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10'
        },
        mtfCoherence: {
            label: 'MTF Coherence',
            desc: '15m / 1h / Daily Trend Alignment (0-1)',
            title: 'Multi-Timeframe Coherence',
            formula: 'Coherence = |Σ wᵢ·directionᵢ·strengthᵢ| / Σ wᵢ·strengthᵢ',
            explanation: 'Slope-based trend on 15m, 1h, and daily candles, weighted 20/30/50. High coherence = all three timeframes agree on direction; low coherence = fighting timeframes = reversal risk.',
            icon: <Activity className="w-3.5 h-3.5 text-amber-400" />,
            color: 'text-amber-400 border-amber-500/40 bg-amber-500/10'
        },
        selectionConviction: {
            label: 'Sel. Conv.',
            desc: 'Alpha 2.0 Final Conviction Index (0-100)',
            title: 'Selection Conviction Index',
            formula: 'CI = RS(30%) + Rotation(20%) + MTF(20%) + Liq(10%) + G(10%) + R(10%)',
            explanation: 'Fused conviction index. Includes hard-fail ceilings for REJECTED liquidity (35), INSUFFICIENT MTF (40), and counter-trend signals (×0.5). Use the high-conviction filter to surface only the top picks.',
            icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
            color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
        },
        liquidityGrade: {
            label: 'Liquidity',
            desc: 'A / B / C / Rejected',
            title: 'Liquidity & Impact Grade',
            formula: 'Pass = ADV ≥ 25Cr, RVOL ≥ 0.6, Impact ≤ 40bps',
            explanation: 'Almgren-Chriss impact model on a 0.1%-of-ADV order. Grade A (≥100Cr / 5bps) is institutional-only; Grade C is barely tradable; REJECTED fails the impact-cost gate.',
            icon: <Activity className="w-3.5 h-3.5 text-slate-400" />,
            color: 'text-slate-400 border-slate-500/40 bg-slate-500/10'
        },
        derivativesScore: {
            label: 'DCS',
            desc: 'Derivatives Confluence Score (0-100)',
            title: 'Derivatives Confluence (F&O)',
            formula: 'DCS = DWP(20%) + PCR(15%) + Wall(20%) + CVD(20%) + OBP(15%) + Apex(10%)',
            explanation: 'F&O confluence from delta-weighted PCR, PCR velocity agreement, gamma-weighted call/put walls, CVD velocity (z-scored), order book pressure, and the upstream apex signal. APEX verdicts require all five gates to agree.',
            icon: <Zap className="w-3.5 h-3.5 text-violet-400" />,
            color: 'text-violet-400 border-violet-500/40 bg-violet-500/10'
        },
        derivativesVerdict: {
            label: 'F&O Gate',
            desc: 'APEX / Trap / Low-Conviction / Neutral',
            title: 'F&O Trade Gate',
            formula: 'APEX = DCS≥75 + Wall≤0.45 + CVD>+0.5 + OBP>+0.2 + Apex+',
            explanation: 'APEX_BUY / APEX_SELL require score ≥ 75 with five-input agreement. TRAP_RISK fires on call-wall pin, put-wall floor, or CVD divergence. LOW_CONVICTION means score < 50 or missing data.',
            icon: <Zap className="w-3.5 h-3.5 text-rose-400" />,
            color: 'text-rose-400 border-rose-500/40 bg-rose-500/10'
        },
        rvol: {
            label: 'RVOL',
            desc: 'Relative Volume Surge vs 30d Average',
            title: 'Relative Volume (RVOL)',
            formula: 'RVOL = Current Volume / 30-Day Avg Volume',
            explanation: 'Compares current session volume to the stock\'s 30-day time-of-day baseline. High values (> 1.5x) confirm active institutional participation.',
            icon: <Zap className="w-3.5 h-3.5 text-sky-400" />,
            color: 'text-sky-400 border-sky-500/40 bg-sky-500/10'
        },
        symbol: {
            label: 'Symbol',
            desc: 'Stock Ticker Alphabetical Order',
            title: 'Ticker Symbol',
            formula: 'Alphabetical A-Z / Z-A',
            explanation: 'Sorts constituents alphabetically by company ticker symbol.',
            icon: <List className="w-3.5 h-3.5 text-slate-400" />,
            color: 'text-slate-400 border-slate-700 bg-slate-800/40'
        },
        previousClose: {
            label: 'Pre C',
            desc: 'Previous Session Closing Price',
            title: 'Previous Close',
            formula: 'Close Price of Previous Trading Session',
            explanation: 'Base closing price against which today\'s performance and gaps are calculated.',
            icon: <Activity className="w-3.5 h-3.5 text-slate-400" />,
            color: 'text-slate-400 border-slate-700 bg-slate-800/40'
        },
    };

    return (
        <div ref={widgetRef} className="bg-wa-card backdrop-blur-xl rounded-wa-lg border border-wa-border relative shadow-lg flex flex-col h-[700px] overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-wa-border bg-wa-surface/40 space-y-2.5">
                {/* Row 1: Title, Actions, Strategy Tabs, High Conviction, View Mode */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h2 
                            onClick={() => selectedSector && openSectorTradingView(selectedSector)}
                            className="text-lg font-bold text-white flex items-center cursor-pointer hover:text-indigo-400 transition-colors group/title select-none gap-1.5"
                            title={`Open ${selectedSector} Index Chart on TradingView`}
                        >
                            {selectedSector}{' '}
                            <span className="text-slate-400 font-normal text-xs sm:text-sm group-hover/title:underline">
                                F&O Constituents
                            </span>
                            <ExternalLink className="w-3.5 h-3.5 opacity-50 group-hover/title:opacity-100 transition-opacity text-slate-400 group-hover/title:text-indigo-400" />
                        </h2>
                        
                        <ActionButton
                            size="xs"
                            icon={<Camera size={10} className="text-slate-500" />}
                            label="PNG"
                            onClick={(e) => { e.stopPropagation(); handleScreenshot(); }}
                            isLoading={isExporting}
                            disabled={isExporting}
                            title="Download PNG Screenshot"
                        />
                        <ActionButton
                            size="xs"
                            icon={<RefreshCw size={11} />}
                            label="SYNC"
                            responsiveLabel
                            onClick={(e) => { e.stopPropagation(); fetchStocks(true); }}
                            isLoading={isRefreshing}
                            disabled={isRefreshing}
                            title={`Refresh ${selectedSector || 'Sector'} Constituents (Last sync: ${lastSyncTime})`}
                        />
                        {dataSource === 'UPSTOX' ? (
                            <LiveConnectionBadge size="xs" sourceLabel="UPSTOX" />
                        ) : (
                            <div className={`px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider select-none ${
                                dataSource === 'NSE_SCRAPER'
                                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                                    : dataSource === 'YAHOO'
                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                        : 'bg-rose-500/10 text-rose-450 border-rose-500/30'
                            }`}>
                                {dataSource === 'NSE_SCRAPER' && 'NSE Scraper'}
                                {dataSource === 'YAHOO' && 'Yahoo Finance'}
                                {dataSource === 'MOCK' && 'Simulated Mock'}
                            </div>
                        )}
                    </div>
                    
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Strategy Filter Tabs (desktop) */}
                        {!isMobile && (
                            <div className="flex bg-slate-950/80 p-0.5 rounded-lg border border-slate-850 relative">
                                {[
                                    { id: 'all', label: 'All', color: '#64748B' },
                                    { id: 'ema_snapback', label: '🟣 SCALP', color: '#A855F7' },
                                    { id: 'morning_snapback', label: '🟢 CONT', color: '#22C55E' },
                                    { id: 'upper_circuit', label: '🔵 UC', color: '#3B82F6' }
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setSelectedStrategy(tab.id as any)}
                                        className={`relative px-2.5 py-1 rounded text-[8.5px] font-black uppercase tracking-wider transition-all duration-300 z-10 ${
                                            selectedStrategy === tab.id ? 'text-white' : 'text-slate-500 hover:text-slate-350'
                                        }`}
                                    >
                                        {selectedStrategy === tab.id && (
                                            <motion.div
                                                layoutId="activeStrategyTabCapsule"
                                                className="absolute inset-0 rounded -z-10 shadow-md"
                                                style={{ backgroundColor: tab.color }}
                                                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                                            />
                                        )}
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* High Conviction Switch */}
                        <label className="flex items-center gap-1.5 cursor-pointer bg-slate-950/60 hover:bg-slate-950/90 border border-slate-850 px-2.5 py-1 rounded-lg transition-all select-none">
                            <input
                                type="checkbox"
                                checked={highConvictionOnly}
                                onChange={handleHighConvictionToggle}
                                className="w-3 h-3 accent-indigo-500 rounded border-slate-700 bg-slate-800 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                            />
                            <span className="text-[9px] font-black uppercase text-indigo-400 tracking-widest">&gt;70 Only</span>
                        </label>

                        {/* View Mode Toggle */}
                        <Tabs.Root
                            value={viewMode}
                            onValueChange={(v) => v === 'table' ? handleViewModeTable() : handleViewModeChart()}
                            layoutId="stock-screener-view-mode-nav"
                            variant="solid-indigo"
                            motionPreset="spring"
                        >
                            <Tabs.List className="min-h-[26px] p-0.5 bg-slate-950/60 border border-slate-850">
                                <Tabs.Trigger
                                    value="table"
                                    className="px-2 min-h-[20px] text-[8.5px] font-black uppercase tracking-wider"
                                    title="Table View"
                                >
                                    <LayoutList className="w-3 h-3" />
                                    <span>Table</span>
                                </Tabs.Trigger>
                                <Tabs.Trigger
                                    value="chart"
                                    className="px-2 min-h-[20px] text-[8.5px] font-black uppercase tracking-wider"
                                    title="Bar Chart View"
                                >
                                    <BarChart3 className="w-3 h-3" />
                                    <span>Chart</span>
                                </Tabs.Trigger>
                            </Tabs.List>
                        </Tabs.Root>
                    </div>
                </div>

                {/* MOBILE: Single compact control row */}
                {isMobile && (
                    <div className="flex items-center justify-between gap-2 bg-slate-900/40 p-1.5 rounded-xl border border-slate-800/40">
                        <div className="flex items-center gap-1.5 min-w-0 pl-1">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest shrink-0">Rank</span>
                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-wider truncate flex items-center gap-1">
                                {sortLabels[sortMode]?.icon}
                                {sortLabels[sortMode]?.label ?? sortMode}
                            </span>
                            <span className="text-[9px] font-mono text-slate-500">
                                {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                        </div>
                        <div className="relative shrink-0">
                            <ActionButton
                                size="sm"
                                icon={<MoreVertical size={16} />}
                                isActive={controlsOpen}
                                activeVariant="indigo"
                                onClick={() => setControlsOpen(v => !v)}
                                aria-label="More screener controls"
                                aria-expanded={controlsOpen}
                                title="Filter & Screener Controls"
                            />
                            {controlsOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setControlsOpen(false)} />
                                    <div className="absolute right-0 top-full mt-2 w-[min(22rem,calc(100vw-2rem))] z-50 bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl p-3.5 space-y-3.5 max-h-[75vh] overflow-y-auto">
                                        <div>
                                            <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Strategy Mode</div>
                                            <div className="grid grid-cols-2 gap-1.5">
                                                {[
                                                    { id: 'all', label: 'All Assets', color: '#64748B' },
                                                    { id: 'ema_snapback', label: 'SCALP', color: '#A855F7' },
                                                    { id: 'morning_snapback', label: 'CONT', color: '#22C55E' },
                                                    { id: 'upper_circuit', label: 'UC', color: '#3B82F6' }
                                                ].map(tab => (
                                                    <button
                                                        key={tab.id}
                                                        onClick={() => setSelectedStrategy(tab.id as any)}
                                                        className={`px-2 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-all ${
                                                            selectedStrategy === tab.id
                                                                ? 'text-white border-transparent'
                                                                : 'text-slate-400 border-slate-800 bg-slate-900/60'
                                                        }`}
                                                        style={selectedStrategy === tab.id ? { backgroundColor: tab.color } : undefined}
                                                    >
                                                        {tab.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex items-center justify-between text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                                                <span>Rank Parameter</span>
                                                <button
                                                    onClick={() => setSortDirection(d => d === 'desc' ? 'asc' : 'desc')}
                                                    className="text-indigo-400 font-mono"
                                                >
                                                    {sortDirection === 'asc' ? '↑ ASC' : '↓ DESC'}
                                                </button>
                                            </div>
                                            <div className="space-y-2.5">
                                                {SORT_CATEGORIES.map(category => (
                                                    <div key={category.id} className="space-y-1">
                                                        <div className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                                            <span>{category.icon}</span>
                                                            <span>{category.label}</span>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-1">
                                                            {category.modes.map(mode => {
                                                                const info = sortLabels[mode];
                                                                if (!info) return null;
                                                                const isActive = sortMode === mode;
                                                                return (
                                                                    <button
                                                                        key={mode}
                                                                        onClick={() => {
                                                                            handleSortModeChange(mode);
                                                                            setControlsOpen(false);
                                                                        }}
                                                                        className={`p-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider border text-left flex items-center justify-between transition-all ${
                                                                            isActive
                                                                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                                                                : 'bg-slate-900/60 border-slate-800 text-slate-400'
                                                                        }`}
                                                                    >
                                                                        <span className="truncate">{info.label}</span>
                                                                        {isActive && <Check size={10} className="shrink-0" />}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <label className="flex items-center gap-2 cursor-pointer bg-slate-900/60 border border-slate-800 px-3 py-2 rounded-lg select-none">
                                            <input
                                                type="checkbox"
                                                checked={highConvictionOnly}
                                                onChange={handleHighConvictionToggle}
                                                className="w-3 h-3 accent-indigo-500 rounded border-slate-700 bg-slate-800 focus:ring-0 cursor-pointer"
                                            />
                                            <span className="text-[9px] font-black uppercase text-indigo-400 tracking-widest">High Conviction (&gt; 70) Only</span>
                                        </label>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Row 2 (Desktop): Factor View Tabs + Rank By Dropdown + Advance/Decline */}
                {!isMobile && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-800/40">
                        {/* Factor View Category Filter Tabs */}
                        <div className="flex items-center gap-1 bg-slate-950/70 p-0.5 rounded-xl border border-slate-850">
                            <button
                                onClick={() => setFactorCategory('all')}
                                className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                                    factorCategory === 'all'
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                All Factors
                            </button>
                            {SORT_CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => {
                                        setFactorCategory(cat.id);
                                        if (!cat.modes.includes(sortMode)) {
                                            setSortMode(cat.modes[0]);
                                            setSortDirection('desc');
                                        }
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 ${
                                        factorCategory === cat.id
                                            ? 'bg-indigo-600 text-white shadow-sm'
                                            : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    <span>{cat.icon}</span>
                                    <span>{cat.label}</span>
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-3 ml-auto">
                            {/* Categorized "Rank By" Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setRankDropdownOpen(prev => !prev)}
                                    className="flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-indigo-500/40 text-slate-200 transition-all text-[9.5px] font-black uppercase tracking-wider shadow-sm select-none"
                                    title="Choose ranking metric to sort F&O constituents"
                                >
                                    <span className="text-slate-500 font-bold text-[8.5px]">Rank:</span>
                                    <span className="text-indigo-400 font-black flex items-center gap-1">
                                        {sortLabels[sortMode]?.icon}
                                        {sortLabels[sortMode]?.label ?? sortMode}
                                    </span>
                                    <span className="text-slate-500 font-mono text-[8.5px]">
                                        {sortDirection === 'asc' ? '↑ ASC' : '↓ DESC'}
                                    </span>
                                    <ChevronDown size={11} className={`text-slate-400 transition-transform duration-200 ${rankDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {rankDropdownOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setRankDropdownOpen(false)} />
                                        <div className="absolute right-0 top-full mt-2 w-[440px] max-w-[95vw] z-50 bg-slate-950/98 backdrop-blur-2xl border border-slate-750 rounded-2xl shadow-2xl p-3.5 space-y-3 max-h-[75vh] overflow-y-auto">
                                            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                                    <SlidersHorizontal size={12} className="text-indigo-400" />
                                                    Rank Constituents By Parameter
                                                </span>
                                                <button
                                                    onClick={() => setSortDirection(d => d === 'desc' ? 'asc' : 'desc')}
                                                    className="text-[9px] font-mono font-bold text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20"
                                                >
                                                    Order: {sortDirection.toUpperCase()}
                                                </button>
                                            </div>
                                            {SORT_CATEGORIES.map(category => (
                                                <div key={category.id} className="space-y-1.5">
                                                    <div className="flex items-center justify-between text-[9px] font-black text-slate-400 uppercase tracking-wider">
                                                        <span className="flex items-center gap-1">
                                                            <span>{category.icon}</span>
                                                            <span>{category.label}</span>
                                                        </span>
                                                        <span className="text-slate-600 font-normal normal-case text-[8.5px]">{category.description}</span>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-1.5">
                                                        {category.modes.map(mode => {
                                                            const info = sortLabels[mode];
                                                            if (!info) return null;
                                                            const isActive = sortMode === mode;
                                                            return (
                                                                <button
                                                                    key={mode}
                                                                    onClick={() => {
                                                                        if (sortMode === mode) {
                                                                            setSortDirection(d => d === 'desc' ? 'asc' : 'desc');
                                                                        } else {
                                                                            setSortMode(mode);
                                                                            setSortDirection(mode === 'symbol' ? 'asc' : 'desc');
                                                                        }
                                                                        setRankDropdownOpen(false);
                                                                    }}
                                                                    className={`flex items-start gap-2 p-2 rounded-xl border text-left transition-all ${
                                                                        isActive
                                                                            ? 'bg-indigo-600/25 border-indigo-500 text-white shadow-md'
                                                                            : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/60 hover:border-slate-700'
                                                                    }`}
                                                                >
                                                                    <div className="mt-0.5 shrink-0">{info.icon}</div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="text-[10px] font-black tracking-wider uppercase truncate">
                                                                                {info.label}
                                                                            </span>
                                                                            {isActive && <Check size={11} className="text-indigo-400 shrink-0" />}
                                                                        </div>
                                                                        <div className="text-[8.5px] text-slate-400 line-clamp-1 mt-0.5">
                                                                            {info.desc}
                                                                        </div>
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Mini Advance/Decline Indicator */}
                            <div className="flex items-center gap-2 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-slate-850 text-[10px] font-mono select-none">
                                <span className="text-emerald-400 font-bold">{advance}▲ ({advancePercent.toFixed(0)}%)</span>
                                <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
                                    <div className="h-full bg-emerald-500" style={{ width: `${advancePercent}%` }} />
                                    <div className="h-full bg-rose-500" style={{ width: `${declinePercent}%` }} />
                                </div>
                                <span className="text-rose-400 font-bold">{decline}▼ ({declinePercent.toFixed(0)}%)</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Alpha 2.0 Sector Rotation Leaderboard (top 5) */}
                {rotationBoard.length > 0 && (
                    <div className="pt-1">
                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                            {rotationBoard.slice(0, 5).map(row => (
                                <div
                                    key={row.sector}
                                    className={`flex-1 min-w-[110px] rounded-lg border px-2.5 py-1 ${
                                        row.rsScore >= 1
                                            ? 'border-emerald-500/30 bg-emerald-500/5'
                                            : row.rsScore <= -1
                                                ? 'border-rose-500/30 bg-rose-500/5'
                                                : 'border-slate-700 bg-slate-900/40'
                                    }`}
                                >
                                    <div className="text-[8.5px] font-black uppercase text-slate-400 truncate">
                                        #{row.rsRank} · {row.sector}
                                    </div>
                                    <div className="flex items-center justify-between text-[9.5px] font-mono font-black">
                                        <span className={row.rsScore >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                            RS {(row.rsScore >= 0 ? '+' : '') + row.rsScore.toFixed(2)}
                                        </span>
                                        <span className="text-slate-500">
                                            MF {row.moneyFlow.toFixed(1)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            {/* Table or Chart */}
            <div onScroll={handleScroll} className="flex-1 overflow-auto no-scrollbar relative">
                {viewMode === 'chart' ? (
                    <div className="h-full w-full min-h-[450px] p-6 flex flex-col justify-between">
                        {/* Bar chart rendering */}
                        <div className="flex-1 w-full relative min-h-[400px]">
                            <SafeChartContainer>
                                <BarChart
                                    data={chartData}
                                    margin={{ top: 20, right: 10, left: -20, bottom: 40 }}
                                >
                                    <XAxis
                                        dataKey="name"
                                        tickLine={false}
                                        axisLine={{ stroke: '#1e293b' }}
                                        interval={0}
                                        tick={({ x, y, payload }) => {
                                            const isSelected = selectedStock?.symbol === payload.value;
                                            return (
                                                <g transform={`translate(${x},${y})`}>
                                                    <text
                                                        x={0}
                                                        y={0}
                                                        dy={10}
                                                        textAnchor="end"
                                                        fill={isSelected ? '#6366f1' : '#94a3b8'}
                                                        fontSize={9}
                                                        fontWeight={isSelected ? 900 : 700}
                                                        transform="rotate(-45)"
                                                        className="font-sans tracking-tight cursor-pointer hover:underline"
                                                        onClick={() => {
                                                            const stock = filteredStocks.find(s => s.symbol === payload.value);
                                                            if (stock) onStockSelect(stock);
                                                        }}
                                                    >
                                                        {payload.value}
                                                    </text>
                                                </g>
                                            );
                                        }}
                                    />
                                    <YAxis
                                        type="number"
                                        domain={['auto', 'auto']}
                                        tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}
                                        axisLine={{ stroke: '#1e293b' }}
                                        tickLine={{ stroke: '#1e293b' }}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                                        content={<CustomChartTooltip />}
                                    />
                                    {['c2c', 'openChangePct', 'openingGap', 'rFactor'].includes(sortMode) && (
                                        <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3" />
                                    )}
                                    <Bar
                                        dataKey="value"
                                        radius={[4, 4, 0, 0]}
                                        barSize={20}
                                        cursor="pointer"
                                    >
                                        {chartData.map((entry, index) => {
                                            const isSelected = selectedStock?.symbol === entry.name;
                                            const strokeColor = isSelected ? '#6366f1' : 'transparent';
                                            const strokeWidth = isSelected ? 2.5 : 0;
                                            return (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={entry.fill}
                                                    stroke={strokeColor}
                                                    strokeWidth={strokeWidth}
                                                    onClick={() => {
                                                        const stock = filteredStocks.find(s => s.symbol === entry.name);
                                                        if (stock) onStockSelect(stock);
                                                    }}
                                                    className="transition-all duration-300 hover:opacity-80"
                                                />
                                            );
                                        })}
                                    </Bar>
                                </BarChart>
                            </SafeChartContainer>
                        </div>
                    </div>
                ) : (
                    <div className="table-scroll -mx-1 px-1">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-wa-surface/95 backdrop-blur-md z-10 text-xs text-slate-400 uppercase font-semibold border-b border-wa-border">
                            <tr>
                                <th className="py-2 px-2.5 sm:px-3 font-medium whitespace-nowrap w-[160px] min-w-[160px] cursor-pointer hover:text-white select-none" onClick={() => handleColumnSort('symbol')}>
                                    <span className="flex items-center gap-1">
                                        Symbol
                                        {sortMode === 'symbol' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-indigo-400" /> : <ArrowDown size={11} className="text-indigo-400" />)}
                                    </span>
                                </th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-right text-sky-400 cursor-pointer hover:underline select-none whitespace-nowrap" onClick={() => handleColumnSort('rvol')} title="Compares current-time volume to same-time average over 30 days">
                                    <span className="inline-flex items-center justify-end gap-1">
                                        RVOL
                                        {sortMode === 'rvol' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-sky-400" /> : <ArrowDown size={11} className="text-sky-400" />)}
                                    </span>
                                </th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-right cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => handleColumnSort('previousClose')}>
                                    <span className="inline-flex items-center justify-end gap-1">
                                        Pre C
                                        {sortMode === 'previousClose' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-slate-300" /> : <ArrowDown size={11} className="text-slate-300" />)}
                                    </span>
                                </th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-right font-black text-emerald-400 cursor-pointer hover:underline select-none whitespace-nowrap" onClick={() => handleColumnSort('c2c')}>
                                    <span className="inline-flex items-center justify-end gap-1">
                                        C2C %
                                        {sortMode === 'c2c' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-emerald-400" /> : <ArrowDown size={11} className="text-emerald-400" />)}
                                    </span>
                                </th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-right text-cyan-400 cursor-pointer hover:underline select-none whitespace-nowrap" onClick={() => handleColumnSort('openChangePct')}>
                                    <span className="inline-flex items-center justify-end gap-1">
                                        O2C %
                                        {sortMode === 'openChangePct' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-cyan-400" /> : <ArrowDown size={11} className="text-cyan-400" />)}
                                    </span>
                                </th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-center text-purple-400 select-none whitespace-nowrap">Strategy</th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-right text-yellow-400 cursor-pointer hover:underline select-none whitespace-nowrap" onClick={() => handleColumnSort('gFactor')}>
                                    <span className="inline-flex items-center justify-end gap-1">
                                        G Fact
                                        {sortMode === 'gFactor' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-yellow-400" /> : <ArrowDown size={11} className="text-yellow-400" />)}
                                    </span>
                                </th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-right text-indigo-400 cursor-pointer hover:underline select-none whitespace-nowrap" onClick={() => handleColumnSort('rFactor')}>
                                    <span className="inline-flex items-center justify-end gap-1">
                                        R Fact
                                        {sortMode === 'rFactor' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-indigo-400" /> : <ArrowDown size={11} className="text-indigo-400" />)}
                                    </span>
                                </th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-right text-sky-400 cursor-pointer hover:underline select-none whitespace-nowrap" onClick={() => handleColumnSort('selectionConviction')} title="Conviction Index (Options Market Bias)">
                                    <span className="inline-flex items-center justify-end gap-1">
                                        CI
                                        {sortMode === 'selectionConviction' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-sky-400" /> : <ArrowDown size={11} className="text-sky-400" />)}
                                    </span>
                                </th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-right text-purple-400 cursor-pointer hover:underline select-none whitespace-nowrap" onClick={() => handleColumnSort('convictionScore')} title="Quantitative Conviction Score">
                                    <span className="inline-flex items-center justify-end gap-1">
                                        QCS
                                        {sortMode === 'convictionScore' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-purple-400" /> : <ArrowDown size={11} className="text-purple-400" />)}
                                    </span>
                                </th>
                                {isDepthActive && (
                                    <th 
                                        className={`py-2 px-2.5 sm:px-3 font-medium text-center text-emerald-400 cursor-pointer hover:underline select-none whitespace-nowrap ${sortMode === 'momentumContinuationScore' ? 'underline font-black' : ''}`}
                                        onClick={() => handleColumnSort('momentumContinuationScore')}
                                        title="Momentum Continuation Score based on L2 Order Book depth"
                                    >
                                        <span className="inline-flex items-center justify-center gap-1">
                                            Depth
                                            {sortMode === 'momentumContinuationScore' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-emerald-400" /> : <ArrowDown size={11} className="text-emerald-400" />)}
                                        </span>
                                    </th>
                                )}
                                {/* Dynamic column header based on sort */}
                                {['alphaScore', 'openingGap', 'dayExtreme', 'fundamentalScore', 'compositeAlphaScore', 'rsComposite', 'mtfCoherence', 'liquidityGrade', 'derivativesScore', 'derivativesVerdict'].includes(sortMode) && (
                                    <th className="py-2 px-2.5 sm:px-3 font-medium text-right text-indigo-400 cursor-pointer select-none whitespace-nowrap" onClick={() => handleColumnSort(sortMode)}>
                                        <span className="inline-flex items-center justify-end gap-1">
                                            {sortLabels[sortMode]?.label ?? sortMode}
                                            {sortDirection === 'asc' ? <ArrowUp size={11} className="text-indigo-400" /> : <ArrowDown size={11} className="text-indigo-400" />}
                                        </span>
                                    </th>
                                )}
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-center whitespace-nowrap w-[135px] min-w-[135px] max-w-[135px] cursor-pointer hover:text-white select-none" onClick={() => handleColumnSort('dayExtreme')}>
                                    <span className="inline-flex items-center justify-center gap-1">
                                        Safety Status
                                        {sortMode === 'dayExtreme' && (sortDirection === 'asc' ? <ArrowUp size={11} className="text-slate-300" /> : <ArrowDown size={11} className="text-slate-300" />)}
                                    </span>
                                </th>
                                <th className="py-2 px-2.5 sm:px-3 font-medium text-center whitespace-nowrap w-[90px] min-w-[90px]">Signal / Apex</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-wa-border">
                            {filteredStocks.slice(0, visibleCount).map((stock, index) => {
                                const isSelected = selectedStock?.symbol === stock.symbol;

                                // Opening Gap badge color
                                const gapColor = stock.openingGapPct > 3
                                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                      : stock.openingGapPct < -3
                                          ? 'bg-rose-500/20 text-rose-450 border-rose-500/30'
                                          : 'bg-slate-800 text-slate-450 border-slate-700';

                                // Day Extreme bar width and color (0=low, 1=high)
                                const extremeBarWidth = Math.round(stock.dayExtremeScore * 100);
                                const extremeColor = stock.signal === 'Down'
                                     ? (stock.dayExtremeScore > 0.75 ? 'bg-rose-500' : stock.dayExtremeScore < 0.25 ? 'bg-emerald-500' : 'bg-slate-500')
                                     : (stock.dayExtremeScore > 0.75 ? 'bg-emerald-500' : stock.dayExtremeScore < 0.25 ? 'bg-rose-500' : 'bg-slate-500');

                                const convictionData = convictionMap[stock.symbol];

                                const stockKey = symbolToKey[stock.symbol];
                                const isLiveFresh = stockKey ? useGlobalTickStore.getState().isKeyFresh(stockKey, 15000) : false;
                                const hasCachedTick = stockKey ? !!useGlobalTickStore.getState().ticks[stockKey] : false;

                                return (
                                    <motion.tr
                                        layout
                                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                        key={stock.symbol}
                                        onClick={() => onStockSelect(stock)}
                                        className={`cursor-pointer transition-colors group ${isSelected ? 'bg-indigo-500/15' : 'hover:bg-white/[0.03]'}`}
                                    >
                                        <td className="py-2 px-2.5 sm:px-3 whitespace-nowrap min-w-[160px]">
                                            <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
                                                {isSelected && (
                                                    <motion.div layoutId="activeStock" className="w-1 h-5 bg-indigo-500 rounded-full shrink-0" />
                                                )}
                                                <span
                                                    className={`font-bold ${isSelected ? 'text-indigo-400' : 'text-slate-200'} cursor-pointer hover:underline flex items-center gap-1 shrink-0`}
                                                    onClick={(e) => { e.stopPropagation(); openTradingView(stock.symbol); }}
                                                >
                                                    {stock.symbol}
                                                    <ExternalLink className="w-2.5 h-2.5 opacity-50 shrink-0" />
                                                </span>
                                                {isLiveFresh ? (
                                                    <span className="text-[8px] font-black px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-pulse uppercase tracking-wider shrink-0 select-none" title="Streaming live ticks within last 15s">
                                                        ⚡ Live
                                                    </span>
                                                ) : hasCachedTick ? (
                                                    <span className="text-[8px] font-medium px-1 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/60 uppercase tracking-wider shrink-0 select-none" title="Tick cached">
                                                        Cached
                                                    </span>
                                                ) : null}
                                                {convictionData?.hasActiveNews && (() => {
                                                    const cleanSym = stock.symbol.replace(/\s+\[NEWS\]$/i, '').replace(/\s+NEWS$/i, '').toUpperCase().trim();
                                                    const activeNews = newsMap[cleanSym] || [];
                                                    if (activeNews.length === 0) return null;
                                                    const firstArticle = activeNews[0];
                                                    return (
                                                        <div className="relative inline-flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
                                                            <a
                                                                href={firstArticle?.article_link || '#'}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-orange-555 hover:text-orange-400 relative inline-flex items-center justify-center p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                                                                onMouseEnter={(e) => {
                                                                    setHoveredNewsSymbol(cleanSym);
                                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                                    setNewsTooltipPos({
                                                                        top: rect.top + window.scrollY - 10,
                                                                        left: rect.left + window.scrollX + rect.width / 2
                                                                    });
                                                                }}
                                                                onMouseLeave={() => {
                                                                    setHoveredNewsSymbol(null);
                                                                }}
                                                            >
                                                                <Newspaper className="w-3.5 h-3.5 text-orange-500 animate-pulse drop-shadow-[0_0_5px_rgba(249,115,22,0.3)] shrink-0" />
                                                            </a>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </td>
                                        <td className="py-2 px-2.5 sm:px-3 text-right font-mono text-xs whitespace-nowrap">
                                            {(() => {
                                                const volEntry = volAvgMap?.[stock.symbol];
                                                const dbAvgVol = volEntry ? (typeof volEntry === 'object' ? volEntry.avg_volume_20d : volEntry) : 0;
                                                const adv = volumeAverages[stock.symbol] || dbAvgVol || 0;
                                                const timeOfDay = stock.timeOfDayRvol;
                                                if (timeOfDay != null) {
                                                    const color = timeOfDay >= 2 ? 'text-emerald-400' : timeOfDay >= 1 ? 'text-amber-400' : 'text-rose-400';
                                                    return <span className={`font-black ${color}`} title={`Time-of-Day RVOL: ${timeOfDay.toFixed(2)}x\n(compares current-time volume to same-time average over 30 days)`}>{timeOfDay.toFixed(2)}×</span>;
                                                }
                                                if (!adv || adv <= 0) return <span className="text-slate-600">-</span>;
                                                const rvol = stock.volume / adv;
                                                const color = rvol >= 2 ? 'text-emerald-400' : rvol >= 1 ? 'text-amber-400' : 'text-rose-400';
                                                return <span className={`font-black ${color}`} title={`Whole-day RVOL: ${rvol.toFixed(2)}x\n(compares current volume to full-day average. Time-of-day loading...)`}>{rvol.toFixed(2)}×</span>;
                                            })()}
                                        </td>
                                        <td className="py-2 px-2.5 sm:px-3 text-right text-slate-300 font-mono text-xs whitespace-nowrap">
                                            {(stock.previousClose || 0).toFixed(1)}
                                        </td>
                                        <td className={`py-2 px-2.5 sm:px-3 text-right font-mono text-xs font-black whitespace-nowrap ${stock.percentChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {stock.percentChange > 0 ? '+' : ''}{(stock.percentChange || 0).toFixed(2)}%
                                        </td>
                                        <td className={`py-2 px-2.5 sm:px-3 text-right font-mono text-xs font-black whitespace-nowrap ${stock.openChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {stock.openChangePct > 0 ? '+' : ''}{(stock.openChangePct || 0).toFixed(2)}%
                                        </td>

                                        <td className="py-2 px-2.5 sm:px-3 text-center whitespace-nowrap">
                                            {(() => {
                                                 const volEntry = volAvgMap[stock.symbol];
                                                 const dbAvgVol = volEntry ? (typeof volEntry === 'object' ? volEntry.avg_volume_20d : volEntry) : 0;
                                                 const adv = volumeAverages[stock.symbol] || dbAvgVol || 0;
                                                 const rvolVal = stock.timeOfDayRvol ?? (adv > 0 ? stock.volume / adv : 1.0);
                                                const mcsSnap = mcsSnaps[stock.symbol] ?? null;
                                                const inputs = buildInputsFromStock(stock, {
                                                    rvol: rvolVal,
                                                    direction: stock.signal === 'Up' ? 'CALL' : 'PUT',
                                                    mcs: mcsSnap,
                                                    orbPreserved: stock.isORBLowPreservedProxy ?? null
                                                });
                                                const bestStrategy = getCachedBestStrategy(stock, inputs);
                                                
                                                if (!bestStrategy || !bestStrategy.p0Passed) {
                                                    return <span className="text-slate-650 font-mono">-</span>;
                                                }
                                                
                                                const config = STRATEGY_CONFIGS[bestStrategy.strategy as StrategyId];
                                                
                                                return (
                                                    <div className="relative group inline-block" onClick={(e) => e.stopPropagation()}>
                                                        <span
                                                            className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border cursor-help shadow-sm animate-pulse"
                                                            style={{
                                                                backgroundColor: `${config.color}15`,
                                                                borderColor: `${config.color}30`,
                                                                color: config.color
                                                            }}
                                                        >
                                                            {config.badgeLabel}
                                                        </span>
                                                        
                                                        {/* Premium Tooltip */}
                                                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 hidden group-hover:block bg-slate-950/95 border border-slate-800 p-3.5 rounded-xl shadow-2xl z-50 w-72 text-left leading-normal backdrop-blur-sm">
                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1.5 w-3 h-3 bg-slate-950/95 border-r border-b border-slate-800 rotate-45"></div>
                                                            
                                                            <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-2">
                                                                <span className="font-black text-white text-xs uppercase tracking-wider">{config.label}</span>
                                                                <span className="text-[9px] font-mono font-black text-indigo-400">Score: {bestStrategy.score}/100</span>
                                                            </div>
                                                            
                                                            <div className="space-y-1.5 text-[10px] text-slate-400 font-medium normal-case">
                                                                <div><strong className="text-slate-200">Trigger:</strong> {bestStrategy.entryTrigger}</div>
                                                                <div><strong className="text-slate-200">Stop Loss:</strong> {bestStrategy.stopLoss}</div>
                                                                <div><strong className="text-slate-200">Target:</strong> {bestStrategy.target}</div>
                                                                <div><strong className="text-slate-200">RVOL:</strong> {rvolVal.toFixed(2)}x</div>
                                                                <div className="pt-1.5 border-t border-slate-800/50 mt-1.5">
                                                                    <span className="text-[8px] text-slate-500 font-black uppercase tracking-wider block mb-1">P0 Check Verification:</span>
                                                                    <div className="grid grid-cols-1 gap-1">
                                                                        {config.p0Checks.map((c: any) => {
                                                                            const failed = isP0CheckFailed(c.id, bestStrategy.p0Failures || []);
                                                                            return (
                                                                                <div 
                                                                                    key={c.id} 
                                                                                    className={`flex items-center gap-1.5 ${failed ? 'text-rose-450' : 'text-emerald-400'}`}
                                                                                >
                                                                                    <span>{failed ? '✗' : '✓'}</span>
                                                                                    <span className="text-slate-400">{c.label}</span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </td>

                                        <td className="py-2 px-2.5 sm:px-3 text-right whitespace-nowrap">
                                            <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${stock.gFactor >= 3 ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-slate-800 text-slate-450'}`}>
                                                {(stock.gFactor || 0).toFixed(2)}
                                            </span>
                                        </td>
                                        <td className="py-2 px-2.5 sm:px-3 text-right whitespace-nowrap">
                                            <div className="flex items-center justify-end gap-1.5">
                                                <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${(stock.rFactor || 0) > 1.5 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : (stock.rFactor || 0) < -1.5 ? 'bg-rose-500/10 text-rose-450 border border-rose-500/20' : 'bg-slate-800 text-slate-450'}`}>
                                                    {(stock.rFactor || 1.0).toFixed(2)}
                                                </span>
                                                {isDepthActive && stock.orderBookSignal && (
                                                    <span 
                                                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-black border cursor-help ${
                                                            stock.orderBookSignal.momentumContinuationScore >= 70
                                                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                                                : stock.orderBookSignal.momentumContinuationScore >= 40
                                                                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                                                    : 'bg-rose-500/20 text-rose-450 border-rose-500/30'
                                                        }`}
                                                        title={`Momentum Continuation Score: ${stock.orderBookSignal.momentumContinuationScore}/100\nReason: ${stock.orderBookSignal.reason}`}
                                                    >
                                                        M:{stock.orderBookSignal.momentumContinuationScore}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        {/* CI and QCS Cells */}
                                        {(() => {
                                            const snapshot = optionChainService.getCachedSnapshot(stock.symbol);
                                            if (!snapshot) {
                                                return (
                                                    <>
                                                        <td className="py-2 px-2.5 sm:px-3 text-right text-slate-600 font-mono text-xs whitespace-nowrap">-</td>
                                                        <td className="py-2 px-2.5 sm:px-3 text-right text-slate-600 font-mono text-xs whitespace-nowrap">-</td>
                                                    </>
                                                );
                                            }
                                            
                                            const spot = stock.lastPrice || snapshot.underlyingValue || 0;
                                            const avgOI20d = 2000000;
                                            const ci = quantGreeksService.computeConvictionIndex(snapshot, spot, avgOI20d);
                                            const ciColor = ci > 1.5 ? 'text-emerald-400 font-bold' : ci < -1.5 ? 'text-rose-450 font-bold' : 'text-slate-400';
                                            
                                            const lotSize = LOT_SIZES[stock.symbol] || 50;
                                            const qcsResult = quantGreeksService.computeQCSSync(stock.symbol, stock.gFactor, snapshot, lotSize);
                                            const qcs = qcsResult.qcs;
                                            const qcsColorClass = qcs >= 8.0 
                                                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 font-extrabold shadow-[0_0_8px_rgba(234,179,8,0.2)]'
                                                : qcs >= 6.0
                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold'
                                                    : qcs >= 4.0
                                                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                                                        : 'bg-slate-800 text-slate-450';
                                            
                                            return (
                                                <>
                                                    <td className={`py-2 px-2.5 sm:px-3 text-right font-mono text-xs whitespace-nowrap ${ciColor}`} title="Conviction Index (CE-PE Delta/Gamma Bias)">
                                                        {ci > 0 ? '+' : ''}{ci.toFixed(2)}
                                                    </td>
                                                    <td className="py-2 px-2.5 sm:px-3 text-right font-mono text-xs whitespace-nowrap">
                                                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${qcsColorClass}`} title={`QCS Grade: ${qcsResult.grade}\nClick to view full option details`}>
                                                            {qcs.toFixed(1)}
                                                        </span>
                                                    </td>
                                                </>
                                            );
                                        })()}
                                        {isDepthActive && (
                                            <td className="py-2 px-2.5 sm:px-3 text-center whitespace-nowrap">
                                                {stock.orderBookSignal ? (
                                                    <div className="flex flex-col items-center gap-1 group/depth relative cursor-help" title={stock.orderBookSignal.reason}>
                                                        <div className="w-16 h-1.5 bg-slate-800 rounded-full flex overflow-hidden border border-slate-700/50">
                                                            {stock.orderBookSignal.bidAskImbalance >= 0 ? (
                                                                <>
                                                                    <div className="h-full bg-slate-800" style={{ width: '50%' }} />
                                                                    <div className="h-full bg-emerald-500" style={{ width: `${(stock.orderBookSignal.bidAskImbalance) * 50}%` }} />
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div className="h-full bg-slate-800" style={{ width: `${(1 + stock.orderBookSignal.bidAskImbalance) * 50}%` }} />
                                                                    <div className="h-full bg-rose-500" style={{ width: `${Math.abs(stock.orderBookSignal.bidAskImbalance) * 50}%` }} />
                                                                </>
                                                            )}
                                                        </div>
                                                        <span className={`text-[9px] font-mono font-black px-1.5 py-0.2 rounded border ${
                                                            stock.orderBookSignal.momentumContinuationScore >= 70
                                                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                                                : stock.orderBookSignal.momentumContinuationScore >= 40
                                                                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                                                    : 'bg-rose-500/20 text-rose-450 border-rose-500/30'
                                                        }`}>
                                                            {stock.orderBookSignal.momentumContinuationScore}
                                                            <div className="pointer-events-none absolute bottom-full mb-2 hidden group-hover/depth:block bg-slate-950/98 border border-slate-800 p-3 rounded-xl shadow-2xl z-50 w-72 text-left leading-normal backdrop-blur-md">
                                                             <div className="text-[10px] text-slate-500 font-black uppercase tracking-wider mb-1">Depth Intelligence</div>
                                                             <div className="text-white font-medium text-[11px] normal-case mb-1.5">{stock.orderBookSignal.reason}</div>
                                                             
                                                             <div className="my-1.5 border-t border-slate-800/80" />
                                                             
                                                             <div className="flex justify-between items-center text-[10px] font-mono text-slate-350">
                                                                 <div>L2 Depth Score: <span className="text-amber-400 font-bold">{stock.orderBookSignal.momentumContinuationScore}/100</span></div>
                                                                 <div>L2 Signal: <span className={`font-bold ${stock.orderBookSignal.signal === 'CONTINUE' ? 'text-emerald-400' : stock.orderBookSignal.signal === 'CAUTION' ? 'text-amber-400' : 'text-rose-400'}`}>{stock.orderBookSignal.signal}</span></div>
                                                             </div>
                                                             
                                                             <div className="my-1.5 border-t border-slate-800/80" />

                                                             <div className="flex justify-between items-center text-[10px] font-mono text-slate-350">
                                                                 <div>Gravity Pull: <span className={stock.orderBookSignal.gravityScore !== undefined && stock.orderBookSignal.gravityScore >= 0.1 ? 'text-emerald-400 font-bold' : stock.orderBookSignal.gravityScore !== undefined && stock.orderBookSignal.gravityScore <= -0.1 ? 'text-rose-450 font-bold' : 'text-slate-400'}>
                                                                     {stock.orderBookSignal.gravityScore !== undefined ? (stock.orderBookSignal.gravityScore >= 0 ? '+' : '') + (stock.orderBookSignal.gravityScore * 100).toFixed(0) + '%' : '0%'}
                                                                 </span></div>
                                                                 <div>Dominance: <span className={stock.orderBookSignal.bidAskImbalance > 0 ? 'text-emerald-400 font-bold' : 'text-rose-455 font-bold'}>
                                                                     {stock.orderBookSignal.bidAskImbalance > 0 ? 'BIDS (BUY)' : 'ASKS (SELL)'}
                                                                 </span></div>
                                                             </div>

                                                             {((stock.orderBookSignal.demandZones && stock.orderBookSignal.demandZones.length > 0) || (stock.orderBookSignal.supplyZones && stock.orderBookSignal.supplyZones.length > 0)) && (
                                                                 <>
                                                                     <div className="my-1.5 border-t border-slate-800/80" />
                                                                     <div className="text-[9px] text-slate-500 uppercase font-black tracking-wider mb-1">D30 Supply / Demand Zones</div>
                                                                     <div className="space-y-1 font-mono text-[10px]">
                                                                         {stock.orderBookSignal.demandZones?.map((z, idx) => (
                                                                             <div key={`d-${idx}`} className="flex justify-between items-center text-emerald-400">
                                                                                 <span>Demand Zone #{idx + 1}:</span>
                                                                                 <span>₹{z.price.toFixed(2)} ({z.qty.toLocaleString()} qty) {idx === 0 && <span className="text-[8px] bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.2 rounded ml-1 text-emerald-400 font-mono">[🟢 Strong Floor]</span>}</span>
                                                                             </div>
                                                                         ))}
                                                                         {stock.orderBookSignal.supplyZones?.map((z, idx) => (
                                                                             <div key={`s-${idx}`} className="flex justify-between items-center text-rose-400">
                                                                                 <span>Supply Zone #{idx + 1}:</span>
                                                                                 <span>₹{z.price.toFixed(2)} ({z.qty.toLocaleString()} qty) {idx === 0 && <span className="text-[8px] bg-rose-500/10 border border-rose-500/20 px-1 py-0.2 rounded ml-1 text-rose-400 font-mono">[🔴 Hard Ceiling]</span>}</span>
                                                                             </div>
                                                                         ))}
                                                                     </div>
                                                                 </>
                                                             )}

                                                             {stock.orderBookSignal.bigSharkAlert && (
                                                                 <>
                                                                     <div className="my-1.5 border-t border-slate-800/80" />
                                                                     <div className="animate-pulse bg-indigo-500/10 p-1.5 rounded border border-indigo-500/35">
                                                                         <div className="text-[9px] font-black uppercase text-indigo-400 mb-0.5">🦈 BIG SHARK SWEEP DETECTED</div>
                                                                         <div className="text-[10px] font-mono text-slate-200">
                                                                             Action: <span className={stock.orderBookSignal.bigSharkAlert.type === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{stock.orderBookSignal.bigSharkAlert.type}</span> | Qty: {stock.orderBookSignal.bigSharkAlert.qty.toLocaleString()} @ ₹{stock.orderBookSignal.bigSharkAlert.price.toFixed(2)}
                                                                         </div>
                                                                     </div>
                                                                 </>
                                                             )}
                                                         </div>
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="text-center text-[10px] text-slate-650 font-mono">-</div>
                                                )}
                                            </td>
                                        )}
                                         {/* Dynamic value column */}
                                         {['alphaScore', 'openingGap', 'dayExtreme', 'fundamentalScore', 'compositeAlphaScore', 'rsComposite', 'mtfCoherence', 'liquidityGrade', 'derivativesScore', 'derivativesVerdict'].includes(sortMode) && (
                                             <td className="py-2 px-2.5 sm:px-3 text-right whitespace-nowrap font-mono text-xs">
                                                 {sortMode === 'alphaScore' && (
                                                     <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                                                         (() => {
                                                             const sectors = alphaEngineService.getCachedSectors();
                                                             const normalizedSectorName = selectedSector ? selectedSector.replace('NIFTY ', '') : '';
                                                             const currentSectorData = sectors.find(s => s.sector === normalizedSectorName || s.sector === selectedSector);
                                                             const sectorChange = currentSectorData ? currentSectorData.percentChange : 0;
                                                             const score = calculateAlphaScore(stock, sectorChange);
                                                             return score >= 75 
                                                                 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                                                                 : score >= 50 
                                                                     ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                                                     : 'bg-rose-500/20 text-rose-400 border-rose-500/30';
                                                         })()
                                                     }`}>
                                                         {(() => {
                                                             const sectors = alphaEngineService.getCachedSectors();
                                                             const normalizedSectorName = selectedSector ? selectedSector.replace('NIFTY ', '') : '';
                                                             const currentSectorData = sectors.find(s => s.sector === normalizedSectorName || s.sector === selectedSector);
                                                             const sectorChange = currentSectorData ? currentSectorData.percentChange : 0;
                                                             return calculateAlphaScore(stock, sectorChange);
                                                         })()}%
                                                     </span>
                                                 )}
                                                 {sortMode === 'openingGap' && (
                                                     <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${gapColor}`}>
                                                         {stock.openingGapPct > 0 ? '+' : ''}{stock.openingGapPct.toFixed(2)}%
                                                     </span>
                                                 )}
                                                 {sortMode === 'dayExtreme' && (
                                                     <div className="flex items-center gap-2 justify-end">
                                                         <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                             <div className={`h-full ${extremeColor} rounded-full transition-all`} style={{ width: `${extremeBarWidth}%` }} />
                                                         </div>
                                                         <span className="text-[9px] font-mono text-slate-400">{extremeBarWidth}%</span>
                                                     </div>
                                                 )}
                                                 {sortMode === 'fundamentalScore' && (() => {
                                                     const qDetail = getQualityScoreDetail(stock.symbol, qualityDataCache);
                                                     const colorClass = qDetail.score >= 70
                                                         ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                         : qDetail.score < 40
                                                             ? 'bg-rose-500/10 text-rose-450 border-rose-500/20'
                                                             : 'bg-slate-800 text-slate-400 border-slate-700/50';
                                                     return (
                                                         <div className="flex items-center justify-end gap-1.5">
                                                             <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${colorClass}`}>
                                                                 {qDetail.score}/100
                                                             </span>
                                                             {qDetail.isFallback && (
                                                                 <span className="text-rose-400 text-xs cursor-help animate-pulse" title="Cache Not Loaded: Using Neutral Fallback (50/100)">
                                                                     ⚠️
                                                                 </span>
                                                             )}
                                                         </div>
                                                     );
                                                 })()}
                                                 {sortMode === 'compositeAlphaScore' && (
                                                     <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                                                         (() => {
                                                             const fScore = calculateFundamentalScore(stock.symbol, qualityDataCache);
                                                             const cScore = calculateCompositeAlphaScore(stock.gFactor, fScore);
                                                             return cScore >= 70 
                                                                 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                                                                 : cScore >= 50 
                                                                     ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                                                     : 'bg-rose-500/20 text-rose-400 border-rose-500/30';
                                                         })()
                                                     }`}>
                                                         {calculateCompositeAlphaScore(stock.gFactor, calculateFundamentalScore(stock.symbol, qualityDataCache))}/100
                                                     </span>
                                                 )}
                                                 {sortMode === 'rsComposite' && (() => {
                                                     const rs = selectionMap[stock.symbol]?.rs.composite;
                                                     if (rs === undefined) return <span className="text-slate-600 font-mono">-</span>;
                                                     const rsPct = rs * 100;
                                                     const color = rsPct >= 30 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : rsPct <= -20 ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30';
                                                     return (
                                                         <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${color}`}>
                                                             {rsPct > 0 ? '+' : ''}{rsPct.toFixed(1)}%
                                                         </span>
                                                     );
                                                 })()}
                                                 {sortMode === 'mtfCoherence' && (() => {
                                                     const mtf = selectionMap[stock.symbol]?.mtf.coherence;
                                                     if (mtf === undefined) return <span className="text-slate-600 font-mono">-</span>;
                                                     const mtfPct = Math.round(mtf * 100);
                                                     const color = mtfPct >= 60 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : mtfPct <= 30 ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30';
                                                     return (
                                                         <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${color}`}>
                                                             {mtfPct}%
                                                         </span>
                                                     );
                                                 })()}
                                                 {sortMode === 'liquidityGrade' && (() => {
                                                     const grade = selectionMap[stock.symbol]?.liquidity.grade ?? 'REJECTED';
                                                     const color = grade === 'A' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : grade === 'B' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : grade === 'C' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30';
                                                     return (
                                                         <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${color}`}>
                                                             Grade {grade}
                                                         </span>
                                                     );
                                                 })()}
                                                 {sortMode === 'derivativesScore' && (() => {
                                                     const dScore = selectionMap[stock.symbol]?.derivativesScore;
                                                     if (dScore === undefined) return <span className="text-slate-600 font-mono">-</span>;
                                                     const color = dScore >= 75 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : dScore >= 50 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30';
                                                     return (
                                                         <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${color}`}>
                                                             {dScore.toFixed(0)}/100
                                                         </span>
                                                     );
                                                 })()}
                                                 {sortMode === 'derivativesVerdict' && (() => {
                                                     const verdict = selectionMap[stock.symbol]?.derivativesVerdict;
                                                     if (!verdict) return <span className="text-slate-600 font-mono">-</span>;
                                                     const isApex = verdict === 'APEX_BUY' || verdict === 'APEX_SELL';
                                                     const isTrap = verdict === 'TRAP_RISK';
                                                     const color = isApex ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : isTrap ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' : 'bg-slate-800 text-slate-400 border-slate-700/50';
                                                     return (
                                                         <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border whitespace-nowrap ${color}`}>
                                                             {verdict.replace('_', ' ')}
                                                         </span>
                                                     );
                                                 })()}
                                             </td>
                                         )}

                                        <td className="py-2 px-2.5 sm:px-3 text-center whitespace-nowrap w-[135px] min-w-[135px] max-w-[135px]">
                                            {(() => {
                                                if (stock.isTrapRisk) {
                                                    return (
                                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-wa-sm bg-rose-500/10 text-rose-400 border border-rose-500/20 uppercase tracking-wider whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1 min-w-[105px]">
                                                            ⚠️ TRAP RISK
                                                        </span>
                                                    );
                                                }
                                                if (stock.isExhausted) {
                                                    return (
                                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-wa-sm bg-amber-500/10 text-amber-500 border border-amber-500/20 uppercase tracking-wider whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1 min-w-[105px]">
                                                            ⚠️ EXHAUSTED
                                                        </span>
                                                    );
                                                }
                                                if (stock.dayExtremeScore >= 0.85) {
                                                    return (
                                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-wa-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1 min-w-[105px]">
                                                            ✅ ELITE SETUP
                                                        </span>
                                                    );
                                                }
                                                if (stock.isRebound) {
                                                    return (
                                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-wa-sm bg-emerald-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-wider whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1 min-w-[105px]">
                                                            ✅ REBOUND
                                                        </span>
                                                    );
                                                }
                                                return (
                                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-wa-sm bg-slate-800 text-slate-500 border border-slate-700 uppercase tracking-wider whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1 min-w-[105px]">
                                                        ⚠️ WEAK EXTREME
                                                    </span>
                                                );
                                            })()}
                                        </td>

                                        <td className="py-2 px-2.5 sm:px-3 whitespace-nowrap w-[90px] min-w-[90px]">
                                            <div className="flex justify-center items-center gap-1.5 shrink-0">
                                                {stock.signal === 'Up' ? (
                                                    <div className="bg-emerald-500/20 text-emerald-400 p-1 rounded-md shrink-0" title="Bullish Price Trend">
                                                        <ArrowUp className="w-3.5 h-3.5" />
                                                    </div>
                                                ) : (
                                                    <div className="bg-rose-500/20 text-rose-400 p-1 rounded-md shrink-0" title="Bearish Price Trend">
                                                        <ArrowDown className="w-3.5 h-3.5" />
                                                    </div>
                                                )}
                                                {stock.apexSignal && stock.apexSignal !== 'NEUTRAL' && (
                                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black tracking-wider uppercase border animate-pulse shrink-0 ${
                                                        stock.apexSignal === 'EXHAUSTION_APEX'
                                                            ? 'bg-rose-500/15 text-rose-450 border-rose-500/30'
                                                            : 'bg-emerald-500/15 text-emerald-450 border-emerald-500/30'
                                                    }`} title={stock.apexSignal === 'EXHAUSTION_APEX' ? 'Institutional Selling Exhaustion detected' : 'Institutional Accumulation detected'}>
                                                        {stock.apexSignal === 'EXHAUSTION_APEX' ? 'EXH' : 'ACC'}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    </motion.tr>
                                );
                            })}
                        </tbody>
                    </table>
                    </div>
                )}

                {filteredStocks.length === 0 && (
                    <div className="p-8 text-center text-slate-500">
                        No F&O stocks found for this sector.
                    </div>
                )}
            </div>

            {/* Premium News Tooltip Popover */}
            {hoveredNewsSymbol && newsTooltipPos && typeof window !== 'undefined' && createPortal(
                <AnimatePresence>
                    <div
                        className="absolute z-[99999] pointer-events-none select-none"
                        style={{
                            top: newsTooltipPos.top,
                            left: newsTooltipPos.left,
                            transform: 'translate(-50%, -100%)',
                            paddingBottom: '12px'
                        }}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 15 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 15 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="w-[320px] bg-slate-900/95 backdrop-blur-md border border-orange-500/15 rounded-2xl overflow-hidden shadow-[0_10px_25px_-10px_rgba(249,115,22,0.15)] text-left font-sans flex flex-col pointer-events-auto"
                            onMouseEnter={() => setHoveredNewsSymbol(hoveredNewsSymbol)}
                            onMouseLeave={() => setHoveredNewsSymbol(null)}
                        >
                            {(() => {
                                const articles = newsMap[hoveredNewsSymbol.toUpperCase()] || [];
                                if (articles.length === 0) return null;
                                const art = articles[0];
                                const timeStr = art.published_at 
                                    ? formatDistanceToNow(new Date(art.published_at), { addSuffix: true }) 
                                    : (art.published_time ? formatDistanceToNow(new Date(art.published_time), { addSuffix: true }) : '');

                                return (
                                    <div>
                                        {art.thumbnail && (
                                            <div className="w-full h-36 overflow-hidden relative">
                                                <img 
                                                    src={art.thumbnail} 
                                                    alt="" 
                                                    className="w-full h-full object-cover"
                                                />
                                                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                                                <span className="absolute top-3 left-3 bg-orange-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                                                    LATEST NEWS
                                                </span>
                                            </div>
                                        )}
                                        <div className="p-4 space-y-2">
                                            <div className="flex items-center justify-between text-[9px] font-bold text-slate-500">
                                                <span>UPSTOX NEWS</span>
                                                <span>{timeStr}</span>
                                            </div>
                                            <h4 className="text-sm font-bold text-slate-100 leading-snug line-clamp-2 hover:text-orange-400 transition-colors">
                                                {art.heading || art.title}
                                            </h4>
                                            <p className="text-[11px] text-slate-400 leading-normal line-clamp-3">
                                                {art.summary || art.description}
                                            </p>
                                            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                                                <span className="text-[10px] text-indigo-400 font-extrabold">{hoveredNewsSymbol}</span>
                                                <a 
                                                    href={art.article_link || '#'} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer" 
                                                    className="text-[10px] font-black text-orange-500 hover:text-orange-400 uppercase tracking-widest flex items-center gap-1"
                                                >
                                                    READ MORE <ExternalLink size={10} />
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </motion.div>
                    </div>
                </AnimatePresence>,
                document.body
            )}
        </div>
    );
};

export default React.memo(StockScreenerWidget);