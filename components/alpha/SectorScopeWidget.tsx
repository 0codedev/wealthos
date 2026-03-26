import React, { useEffect, useState, useMemo, useRef } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { alphaEngineService, SectorData, XFactorMode, SECTOR_ZFACTOR_INDEX_MAP } from '../../services/AlphaEngineService';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, Treemap, TooltipProps } from 'recharts';
import { Activity, Target, Zap, ShieldAlert, Camera, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import { useLiteModeStore } from '../../store/liteModeStore';
import { SECTOR_CONSTITUENTS } from '../../data/sectorConstituents';
import { CHART_COLORS, CHART_DEFAULTS } from '../../utils/chartTheme';
import { formatCurrencyPrecise } from '../../utils/helpers';
import { usePausedInterval } from '../../hooks/usePausedInterval';
import { useUpstoxWebSocket } from '../../hooks/useUpstoxWebSocket';
import { openSectorTradingView } from '../../utils/navigation';
import { Tabs } from '../ui/AnimatedTabs';
import { ActionButton } from '../ui/ActionButton';

const getConfluenceGradeBadge = (grade?: SectorData['confluenceGrade'], score?: number) => {
    if (!grade) return null;
    const isElite = grade.startsWith('ELITE');
    const isBullish = grade.endsWith('BULLISH');
    const isBearish = grade.endsWith('BEARISH');

    let colorClasses = 'bg-tf-bg-card text-tf-text-secondary border-tf-border';
    if (isBullish) {
        colorClasses = isElite
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-black animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.15)]'
            : `bg-emerald-500/10 text-emerald-400 border-emerald-500/20`;
    } else if (isBearish) {
        colorClasses = isElite
            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-black animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.15)]'
            : `bg-rose-500/10 text-rose-400 border-rose-500/20`;
    }

    return (
        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border tracking-wider font-mono ${colorClasses}`}>
            {grade} ({score ?? 0}%)
        </span>
    );
};

interface CustomTreemapContentProps {
    x: number;
    y: number;
    width: number;
    height: number;
    name: string;
    depth: number;
    index: number;
    payload?: any;
    mode: 'intraday' | 'absolute' | 'l2c' | 'h2c' | 'zfactor';
    selectedSector: string | null;
}

// Custom content renderer for Recharts Treemap to render premium, responsive tiles
const CustomTreemapContent: React.FC<CustomTreemapContentProps> = (props) => {
    const { x, y, width, height, name, depth, index, mode, selectedSector } = props;
    if (depth === 0 || !name) return null;

    const payload = props.payload || props;
    // For Sector Scope, change represents the active value (percent return or Z-score)
    const change = payload?.change ?? 0;

    // Dynamic intensity scaling
    const maxExpected = mode === 'zfactor' ? 8 : 5;
    const intensity = Math.min(100, (Math.abs(change) / maxExpected) * 100);

    // High-end color palette (refined for 0% neutral)
    let bgColor = 'rgba(71, 85, 105, 0.2)';
    const isQuantRelative = payload?.xFactorMode === 'QUANT_RELATIVE';
    if (mode === 'zfactor') {
        if (isQuantRelative) {
            bgColor = change > 0
                ? `rgba(6, 182, 212, ${0.25 + (intensity / 100) * 0.65})` // Cyan for relative alpha lead
                : `rgba(100, 116, 139, ${0.25 + (intensity / 100) * 0.65})`; // Slate for relative lag
        } else if (change >= 0) {
            bgColor = `rgba(16, 185, 129, ${0.2 + (intensity / 100) * 0.7})`; // Strict Green for UP
        } else {
            bgColor = `rgba(239, 68, 68, ${0.2 + (intensity / 100) * 0.7})`; // Strict Red for DOWN
        }
    } else if (Math.abs(change) > 0.01) {
        bgColor = change >= 0
            ? `rgba(16, 185, 129, ${0.2 + (intensity / 100) * 0.7})`
            : `rgba(239, 68, 68, ${0.2 + (intensity / 100) * 0.7})`;
    }

    // Highlight selected sector with #3b82f6 (blue) stroke, or match positive/negative indicators
    const isSelected = selectedSector === name;
    let strokeColor = 'rgba(255,255,255,0.1)';
    if (isSelected) {
        strokeColor = '#3b82f6';
    } else if (Math.abs(change) > 0.01) {
        if (mode === 'zfactor') {
            strokeColor = isQuantRelative
                ? (change > 0 ? 'rgba(6, 182, 212, 0.4)' : 'rgba(148, 163, 184, 0.3)')
                : (change >= 0 ? 'rgba(52, 211, 153, 0.4)' : 'rgba(248, 113, 113, 0.4)');
        } else {
            strokeColor = change >= 0 ? 'rgba(52, 211, 153, 0.3)' : 'rgba(248, 113, 113, 0.3)';
        }
    }
    const strokeWidth = isSelected ? 2.5 : 1;

    // Truncation helper (approximate char width)
    const truncate = (str: string, w: number) => {
        const limit = Math.floor(w / 7); // Estimate 7px per char
        return str.length > limit ? str.substring(0, limit - 1) + '..' : str;
    };

    const clipId = `clip-${index}-${name.replace(/\s+/g, '-')}`;

    return (
        <g>
            <defs>
                <clipPath id={clipId}>
                    <rect x={x + 4} y={y + 4} width={Math.max(0, width - 8)} height={Math.max(0, height - 8)} rx={8} />
                </clipPath>
            </defs>
            <rect
                x={x + 1}
                y={y + 1}
                width={Math.max(0, width - 2)}
                height={Math.max(0, height - 2)}
                style={{
                    fill: bgColor,
                    stroke: strokeColor,
                    strokeWidth: strokeWidth,
                    rx: 12,
                    ry: 12,
                    cursor: 'pointer',
                }}
                className="transition-all duration-500 hover:brightness-110"
            />
            {width > 35 && height > 25 && (
                <text
                    x={x + width / 2}
                    y={y + height / 2 - (height > 60 ? 10 : 7)}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={width > 120 ? 10 : (width > 80 ? 9 : 8)}
                    fontWeight="400"
                    fontFamily="Inter, system-ui, sans-serif"
                    clipPath={`url(#${clipId})`}
                    style={{ pointerEvents: 'none', letterSpacing: '0.06em', opacity: 0.7 }}
                >
                    {truncate(name, width - 10)}
                </text>
            )}
            {width > 35 && height > 45 && (
                <text
                    x={x + width / 2}
                    y={y + height / 2 + (height > 60 ? 14 : 11)}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={width > 120 ? 14 : (width > 80 ? 12 : 10)}
                    fontWeight="400"
                    fontFamily="Inter, system-ui, sans-serif"
                    clipPath={`url(#${clipId})`}
                    style={{ pointerEvents: 'none', letterSpacing: '0.04em' }}
                >
                    {mode === 'zfactor' ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}x` : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                </text>
            )}
        </g>
    );
};

interface SectorScopeWidgetProps {
    onSectorSelect: (sector: string) => void;
    selectedSector: string | null;
    autoRefresh?: boolean;
    refreshTrigger?: number;
    isVisible?: boolean;
}

const SectorScopeWidget: React.FC<SectorScopeWidgetProps> = ({
    onSectorSelect,
    selectedSector,
    autoRefresh = true,
    refreshTrigger = 0,
    isVisible = true
}) => {
    const [sectors, setSectors] = useState<SectorData[]>(() => alphaEngineService.getCachedSectors());
    const [isLoading, setIsLoading] = useState(() => alphaEngineService.getCachedSectors().length === 0);
    const [mode, setMode] = useState<'intraday' | 'absolute' | 'l2c' | 'h2c' | 'zfactor'>('intraday');
    const [lastMode, setLastMode] = useState<'intraday' | 'absolute' | 'l2c' | 'h2c' | 'zfactor'>('intraday');
    const [xFactorMode, setXFactorModeState] = useState<XFactorMode>(() => (alphaEngineService.getXFactorMode ? alphaEngineService.getXFactorMode() : 'TRADER_INTENT'));
    const [view, setView] = useState<'bar' | 'heat'>('bar');
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    const handleXFactorModeChange = (newMode: XFactorMode) => {
        setXFactorModeState(newMode);
        const updated = alphaEngineService.setXFactorMode(newMode);
        if (updated && updated.length > 0) {
            setSectors([...updated]);
        }
    };
    
    const widgetRef = useRef<HTMLDivElement>(null);
    const [isExporting, setIsExporting] = useState(false);

    const handleScreenshot = async () => {
        if (!widgetRef.current) return;
        setIsExporting(true);
        try {
            // Take the screenshot using html-to-image
            const dataUrl = await toPng(widgetRef.current, {
                backgroundColor: '#070d19', // standard Wealth Dashboard dark theme background
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
            const timeStr = `${hours}꞉${minutes}꞉${seconds}`; // e.g., 12:56:07 (uses U+A789 modifier colon to be compatible with Windows filesystem)

            const link = document.createElement('a');
            link.download = `sector-scope-${mode}-${dateStr}-${timeStr}.png`;
            link.href = dataUrl;
            link.click();
        } catch (error) {
            console.error('Failed to capture screenshot:', error);
        } finally {
            setIsExporting(false);
        }
    };

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
        const now = new Date();
        return now.toLocaleTimeString('en-US', { hour12: false });
    });

    const fetchSectors = async (isManual: boolean = false) => {
        if (sectors.length === 0) setIsLoading(true);
        if (isManual) setIsRefreshing(true);
        try {
            const data = await alphaEngineService.fetchSectorScope(isManual);
            if (data && data.length > 0) {
                setSectors(data);
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
        fetchSectors(isManual);
    }, [refreshTrigger]);

    // P0#2: paused-when-hidden interval (was: setInterval unconditional)
    usePausedInterval(
      () => fetchSectors(true),
      autoRefresh && isVisible ? 45_000 : null
    );

    // Static list of all 17 index keys + Sensex for WebSocket subscription
    const sectorIndexKeys = useMemo(() => {
        const keys = Object.values(SECTOR_ZFACTOR_INDEX_MAP);
        if (!keys.includes('BSE_INDEX|SENSEX')) {
            keys.push('BSE_INDEX|SENSEX');
        }
        return keys;
    }, []);

    // Connect to live WebSocket feed (mode: 'full' delivers IndexFullFeed with daily OHLC)
    const { ticks, status: wsStatus } = useUpstoxWebSocket(sectorIndexKeys, 'full');

    // Real-time tick overlay: updates sector prices & recomputes C2C, O2C, L2C, H2C live on every incoming tick
    useEffect(() => {
        if (!ticks || Object.keys(ticks).length === 0) return;

        setSectors(prevSectors => {
            if (!prevSectors || prevSectors.length === 0) return prevSectors;
            let hasChanged = false;

            // Resolve live NIFTY 50 benchmark move for relative momentum calculation
            const niftyKey = SECTOR_ZFACTOR_INDEX_MAP['NIFTY 50'];
            const niftyTick = niftyKey ? ticks[niftyKey] : null;
            const niftySector = prevSectors.find(s => s.sector === 'NIFTY 50');
            const niftyLtp = niftyTick?.ltp && niftyTick.ltp > 0 ? niftyTick.ltp : (niftySector?.lastPrice || 0);
            const niftyOpen = niftyTick?.ohlc?.open && niftyTick.ohlc.open > 0 ? niftyTick.ohlc.open : (niftySector?.openPrice || niftyLtp);
            const niftyOpenChange = (niftyOpen > 0 && niftyLtp > 0)
                ? ((niftyLtp - niftyOpen) / niftyOpen) * 100
                : (niftySector?.openChangePct ?? 0);
            const liveBenchmarkDenom = Math.max(Math.abs(niftyOpenChange), 0.25);

            const updated = prevSectors.map(sector => {
                const key = SECTOR_ZFACTOR_INDEX_MAP[sector.sector] || (sector.sector === 'SENSEX' ? 'BSE_INDEX|SENSEX' : null);
                if (!key) return sector;

                const tick = ticks[key];
                if (!tick || tick.ltp == null || tick.ltp === 0) return sector;

                const ltp = tick.ltp;

                // Scale compatibility helper: in Indian equity markets, intraday index moves > 30% are impossible
                const isScaleCompatible = (price?: number | null): boolean => {
                    if (!price || price <= 0) return false;
                    const diffRatio = Math.abs(ltp - price) / ltp;
                    return diffRatio < 0.35; // Must be within 35% of LTP to prevent cross-scale division (e.g. stock vs index)
                };

                // Baseline resolution with scale compatibility guards
                const prevClose = (tick.close && isScaleCompatible(tick.close))
                    ? tick.close
                    : (isScaleCompatible(sector.previousClose) ? (sector.previousClose || 0) : ltp);

                const open = (tick.ohlc?.open && isScaleCompatible(tick.ohlc.open))
                    ? tick.ohlc.open
                    : (isScaleCompatible(sector.openPrice) ? (sector.openPrice || 0) : prevClose);

                const rawTickHigh = (tick.ohlc?.high && isScaleCompatible(tick.ohlc.high)) ? tick.ohlc.high : ltp;
                const rawSectorHigh = isScaleCompatible(sector.highPrice) ? (sector.highPrice || ltp) : ltp;
                const high = Math.max(rawTickHigh, ltp, rawSectorHigh);

                const rawTickLow = (tick.ohlc?.low && isScaleCompatible(tick.ohlc.low)) ? tick.ohlc.low : ltp;
                const rawSectorLow = isScaleCompatible(sector.lowPrice) ? (sector.lowPrice || ltp) : ltp;
                const low = Math.min(rawTickLow, ltp, rawSectorLow);

                const percentChange = (prevClose > 0 && isScaleCompatible(prevClose)) 
                    ? Number((((ltp - prevClose) / prevClose) * 100).toFixed(2)) 
                    : sector.percentChange;

                const openChangePct = (open > 0 && isScaleCompatible(open)) 
                    ? Number((((ltp - open) / open) * 100).toFixed(2)) 
                    : (Math.abs(sector.openChangePct ?? 0) < 30 ? (sector.openChangePct ?? percentChange) : percentChange);

                const l2cChangePct = (low > 0 && isScaleCompatible(low)) 
                    ? Number((((ltp - low) / low) * 100).toFixed(2)) 
                    : sector.l2cChangePct;

                const h2cChangePct = (high > 0 && isScaleCompatible(high)) 
                    ? Number((((ltp - high) / high) * 100).toFixed(2)) 
                    : sector.h2cChangePct;

                // Dynamic Live X-Factor calculation on every incoming tick
                const primaryMove = Math.abs(openChangePct) > 0.01 ? openChangePct : percentChange;
                const tickSign = primaryMove > 0.01 ? 1 : (primaryMove < -0.01 ? -1 : 0);
                const relStrength = Math.abs(primaryMove) / liveBenchmarkDenom;
                const liveZFactor = Number((tickSign * Math.min(10.0, Math.max(0.1, relStrength))).toFixed(2));

                if (
                    sector.lastPrice !== ltp ||
                    sector.percentChange !== percentChange ||
                    sector.openChangePct !== openChangePct ||
                    sector.l2cChangePct !== l2cChangePct ||
                    sector.h2cChangePct !== h2cChangePct ||
                    sector.zFactor !== liveZFactor
                ) {
                    hasChanged = true;
                    return {
                        ...sector,
                        lastPrice: ltp,
                        previousClose: prevClose,
                        openPrice: open,
                        highPrice: high,
                        lowPrice: low,
                        percentChange,
                        openChangePct,
                        l2cChangePct,
                        h2cChangePct,
                        zFactor: liveZFactor
                    };
                }
                return sector;
            });

            return hasChanged ? updated : prevSectors;
        });
    }, [ticks]);

    // Benchmark calculations: resolve live NIFTY 50 reference move for relative strength scaling
    const nifty50 = sectors.find(s => s.sector === 'NIFTY 50');
    const niftyMove = nifty50
        ? ((nifty50.openChangePct != null && Math.abs(nifty50.openChangePct) > 0.01)
            ? nifty50.openChangePct
            : nifty50.percentChange)
        : 0;
    const rawNiftyVal = nifty50
        ? (mode === 'zfactor'
            ? niftyMove
            : mode === 'intraday'
                ? (nifty50.openChangePct ?? 0)
                : mode === 'absolute'
                    ? nifty50.percentChange
                    : mode === 'l2c'
                        ? (nifty50.l2cChangePct ?? 0)
                        : (nifty50.h2cChangePct ?? 0))
        : 0;
    const nifty50Val = isNaN(rawNiftyVal) ? 0 : rawNiftyVal;
    const denominator = Math.max(Math.abs(nifty50Val), 0.25) || 0.25;

    // Helper to resolve effective sector X-Factor with dynamic fallback on cold start
    const getEffectiveZFactor = (s: SectorData): number => {
        if (s.zFactor != null && s.zFactor !== 0) return s.zFactor;
        return alphaEngineService.computeSingleSectorXFactor
            ? alphaEngineService.computeSingleSectorXFactor(s, niftyMove)
            : 0;
    };

    // Sort sectors according to active mode
    const sortedSectors = useMemo(() => {
        return [...sectors].sort((a, b) => {
            if (mode === 'zfactor') {
                return getEffectiveZFactor(b) - getEffectiveZFactor(a);
            } else if (mode === 'intraday') {
                return (b.openChangePct ?? 0) - (a.openChangePct ?? 0);
            } else if (mode === 'absolute') {
                return b.percentChange - a.percentChange;
            } else if (mode === 'l2c') {
                return (b.l2cChangePct ?? 0) - (a.l2cChangePct ?? 0);
            } else {
                return (b.h2cChangePct ?? 0) - (a.h2cChangePct ?? 0);
            }
        });
    }, [sectors, mode, niftyMove]);

    // Auto-select the top pick when sortedSectors changes on load, or when mode toggle is switched
    useEffect(() => {
        if (sortedSectors.length > 0) {
            const shouldAutoSelect = !selectedSector || mode !== lastMode || !sortedSectors.some(s => s.sector === selectedSector);
            if (shouldAutoSelect) {
                setLastMode(mode);
                const topSector = sortedSectors[0];
                const bottomSector = sortedSectors[sortedSectors.length - 1];
                const getVal = (s: SectorData) => {
                    if (mode === 'zfactor') return getEffectiveZFactor(s);
                    if (mode === 'intraday') return s.openChangePct ?? 0;
                    if (mode === 'absolute') return s.percentChange;
                    if (mode === 'l2c') return s.l2cChangePct ?? 0;
                    return s.h2cChangePct ?? 0;
                };
                const valTop = getVal(topSector);
                const valBottom = getVal(bottomSector);
                const topPick = Math.abs(valTop) > Math.abs(valBottom) ? topSector : bottomSector;
                onSectorSelect(topPick.sector);
            }
        }
    }, [sortedSectors, mode, lastMode, selectedSector, onSectorSelect, niftyMove]);

    const chartData = useMemo(() => {
        return sortedSectors.map(s => {
            const sanitizedOpenChange = (s.openChangePct != null && Math.abs(s.openChangePct) < 30)
                ? s.openChangePct
                : s.percentChange;
            const sanitizedL2C = (s.l2cChangePct != null && Math.abs(s.l2cChangePct) < 30)
                ? s.l2cChangePct
                : 0;
            const sanitizedH2C = (s.h2cChangePct != null && Math.abs(s.h2cChangePct) < 30)
                ? s.h2cChangePct
                : 0;

            const effectiveZ = getEffectiveZFactor(s);

            const rawVal = mode === 'zfactor'
                ? effectiveZ
                : mode === 'intraday'
                    ? sanitizedOpenChange
                    : mode === 'absolute'
                        ? s.percentChange
                        : mode === 'l2c'
                            ? sanitizedL2C
                            : sanitizedH2C;
            const val = isNaN(rawVal) ? 0 : rawVal;
            const rawRatio = val / denominator;
            const dynamicStrengthRatio = mode === 'zfactor'
                ? effectiveZ
                : (isNaN(rawRatio) ? 0 : Math.max(-10, Math.min(10, Number(rawRatio.toFixed(2)))));

            // Gap Up Trap: Close-to-close is positive (> 0.2%), but open-to-close is negative (<-0.15%)
            const isTrap = s.percentChange > 0.2 && (s.openChangePct ?? 0) < -0.15;
            // Springboard Rebound: Close-to-close is negative (<-0.2%), but open-to-close is positive (>0.15%)
            const isSpringboard = s.percentChange < -0.2 && (s.openChangePct ?? 0) > 0.15;

            // Color logic:
            // - Z-Factor:
            //   If QUANT_RELATIVE: Cyan (#06b6d4) for relative alpha lead, Slate (#64748b) for relative lag
            //   If TRADER_INTENT: Green for positive price move, Red for negative price move (strict contract)
            // - L2C (bounce from low): if overall day is positive (pct >= 0), profit green; if overall day is negative (pct < 0), cyan/sky (#38bdf8) indicating oversold rebound
            // - H2C (pullback from high): if overall day is positive, amber warning pullback; if overall day is negative, loss red
            // - Intraday / Absolute: standard green/red based on val >= 0
            const isQuantRelative = s.xFactorMode === 'QUANT_RELATIVE' || xFactorMode === 'QUANT_RELATIVE';
            const fill = mode === 'zfactor'
                ? (isQuantRelative
                    ? (effectiveZ > 0 ? '#06b6d4' : '#64748b')
                    : (effectiveZ >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss))
                : mode === 'l2c'
                    ? (s.percentChange >= 0 ? CHART_COLORS.profit : '#38bdf8')
                    : mode === 'h2c'
                        ? (s.percentChange >= 0 ? CHART_COLORS.warning : CHART_COLORS.loss)
                        : (val >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss);

            return {
                name: s.sector,
                value: dynamicStrengthRatio,
                change: val,
                zFactor: effectiveZ,
                xFactorMode: s.xFactorMode || xFactorMode,
                pct: s.percentChange,
                openChangePct: s.openChangePct ?? 0,
                l2cChangePct: s.l2cChangePct ?? 0,
                h2cChangePct: s.h2cChangePct ?? 0,
                fatigueScore: s.fatigueScore,
                fatigueState: s.fatigueState,
                isTrap,
                isSpringboard,
                fill,
                confluenceScore: s.confluenceScore,
                confluenceGrade: s.confluenceGrade,
                bullsBearsRatio: s.bullsBearsRatio,
                intradayBoosterCount: s.intradayBoosterCount,
                topDriverSymbol: s.topDriverSymbol,
                topDriverStrength: s.topDriverStrength,
                yearHigh: s.yearHigh,
                yearLow: s.yearLow,
                perChange30d: s.perChange30d,
                perChange365d: s.perChange365d,
                pe: s.pe,
                pb: s.pb,
                dy: s.dy,
                volume: s.volume || 0,
                tradedValue: s.value || 0
            };
        });
    }, [sortedSectors, mode, denominator, xFactorMode, niftyMove]);

    // Loading skeleton MUST come after all hooks (sortedSectors + chartData useMemo,
    // useEffects, usePausedInterval) so the hook count is identical on every render.
    // Previously this early return sat above the chartData useMemo, so the first render
    // (isLoading=true, empty cache) skipped it and the post-fetch re-render called it -
    // triggering React's "Rendered more hooks than during the previous render" crash.
    if (isLoading) {
        return (
            <div className="bg-tf-bg-card backdrop-blur-md rounded-[2rem] p-6 border border-tf-border animate-pulse h-[580px] flex flex-col items-center justify-center gap-4">
                <Activity className="w-12 h-12 text-indigo-500/50" />
                <div className="h-4 w-48 bg-tf-bg-elevated rounded"></div>
            </div>
        );
    }

    if (isLiteMode) {
        return (
            <div className="bg-tf-bg-card backdrop-blur-xl rounded-2xl p-6 border border-tf-border relative shadow-lg h-[550px] flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            Sector Scope <Target className="w-5 h-5 text-indigo-400" />
                            <ActionButton
                                size="xs"
                                icon={<RefreshCw size={11} />}
                                label="SYNC"
                                responsiveLabel
                                onClick={() => fetchSectors(true)}
                                isLoading={isRefreshing}
                                title={`Refresh Sector Scope (Last sync: ${lastSyncTime})`}
                            />
                            {wsStatus === 'connected' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[8px] font-mono font-bold tracking-wider uppercase shadow-[0_0_8px_rgba(16,185,129,0.15)]" title="Connected to Upstox WebSocket (0ms tick push)">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                    LIVE WS
                                </span>
                            )}
                        </h2>
                        <p className="text-[10px] text-amber-500 font-black uppercase tracking-widest mt-1">Lite Mode: Visuals Suspended</p>
                    </div>

                    {/* Mode Toggle inside Lite view */}
                    <Tabs.Root
                        value={mode}
                        onValueChange={(v) => setMode(v as any)}
                        layoutId="sector-scope-lite-mode-nav"
                        variant="solid-indigo"
                        motionPreset="spring"
                    >
                        <Tabs.List className="min-h-[28px] p-0.5 bg-tf-bg-surface border border-tf-border">
                            <Tabs.Trigger
                                value="absolute"
                                className="px-2 min-h-[22px] text-[9px] font-black uppercase tracking-wider"
                            >
                                C2C
                            </Tabs.Trigger>
                            <Tabs.Trigger
                                value="intraday"
                                className="px-2 min-h-[22px] text-[9px] font-black uppercase tracking-wider"
                            >
                                O2C
                            </Tabs.Trigger>
                            <Tabs.Trigger
                                value="l2c"
                                className="px-2 min-h-[22px] text-[9px] font-black uppercase tracking-wider"
                            >
                                L2C
                            </Tabs.Trigger>
                            <Tabs.Trigger
                                value="h2c"
                                className="px-2 min-h-[22px] text-[9px] font-black uppercase tracking-wider"
                            >
                                H2C
                            </Tabs.Trigger>
                            <Tabs.Trigger
                                value="zfactor"
                                className="px-2 min-h-[22px] text-[9px] font-black uppercase tracking-wider"
                                title="Institutional Conviction X-Factor"
                            >
                                X-FCT
                            </Tabs.Trigger>
                        </Tabs.List>
                    </Tabs.Root>
                </div>

                <div className="flex-1 overflow-auto space-y-2 no-scrollbar">
                    {sortedSectors.map(s => {
                        const effectiveZ = getEffectiveZFactor(s);
                        const rawVal = mode === 'zfactor'
                            ? effectiveZ
                            : mode === 'intraday'
                                ? (s.openChangePct ?? 0)
                                : mode === 'absolute'
                                    ? s.percentChange
                                    : mode === 'l2c'
                                        ? (s.l2cChangePct ?? 0)
                                        : (s.h2cChangePct ?? 0);
                        const val = isNaN(rawVal) ? 0 : rawVal;
                        const rawRatio = val / denominator;
                        const dynamicStrengthRatio = mode === 'zfactor'
                            ? effectiveZ
                            : (isNaN(rawRatio) ? 0 : Math.max(-10, Math.min(10, Number(rawRatio.toFixed(2)))));
                        const isTrap = s.percentChange > 0.2 && (s.openChangePct ?? 0) < -0.15;
                        const isSpringboard = s.percentChange < -0.2 && (s.openChangePct ?? 0) > 0.15;

                        const isElite = s.confluenceGrade?.startsWith('ELITE');
                        const isBullishGrade = s.confluenceGrade?.endsWith('BULLISH');
                        const isBearishGrade = s.confluenceGrade?.endsWith('BEARISH');

                        let cardBorderClass = 'border-tf-border';
                        let cardBgClass = 'bg-tf-bg-surface hover:bg-tf-bg-elevated';

                        if (selectedSector === s.sector) {
                            cardBorderClass = 'border-indigo-500/40';
                            cardBgClass = 'bg-indigo-500/10';
                        } else if (isElite) {
                            if (isBullishGrade) {
                                cardBorderClass = 'border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.15)]';
                                cardBgClass = 'bg-emerald-950/20 hover:bg-emerald-950/30';
                            } else if (isBearishGrade) {
                                cardBorderClass = 'border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.15)]';
                                cardBgClass = 'bg-rose-950/20 hover:bg-rose-950/30';
                            }
                        }

                        return (
                            <div
                                key={s.sector}
                                onClick={() => onSectorSelect(s.sector)}
                                className={`p-3 rounded-xl border flex flex-col gap-2 cursor-pointer transition-all ${cardBorderClass} ${cardBgClass}`}
                            >
                                <div className="flex justify-between items-center w-full">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="font-bold text-tf-text-primary flex items-center gap-1.5 text-xs">
                                            {s.sector}
                                            {s.fatigueState === 'springboard' && <span title="Springboard Rebound">🔁</span>}
                                            {s.fatigueState === 'exhaustion' && <span title="Exhaustion Zone">⚡</span>}
                                            {s.fatigueState === 'neutral' && <span title="Neutral" className="text-tf-text-muted">-</span>}
                                            {isTrap && <span className="text-rose-400 text-[10px]" title="Fading Gap Trap">⚠️</span>}
                                            {isSpringboard && <span className="text-emerald-400 text-[10px]" title="Springboard Rebound">⚡</span>}
                                        </span>
                                    </div>
                                    <div className="text-right flex flex-col items-end gap-1">
                                        <span className={`font-mono font-bold text-xs ${
                                            mode === 'zfactor'
                                                ? ((s.xFactorMode === 'QUANT_RELATIVE' || xFactorMode === 'QUANT_RELATIVE')
                                                    ? (effectiveZ > 0 ? 'text-cyan-400' : 'text-tf-text-secondary')
                                                    : (effectiveZ >= 0 ? 'text-emerald-400' : 'text-rose-400'))
                                                : mode === 'l2c'
                                                    ? (s.percentChange >= 0 ? 'text-emerald-400' : 'text-sky-400')
                                                    : mode === 'h2c'
                                                        ? (s.percentChange >= 0 ? 'text-amber-400' : 'text-rose-400')
                                                        : (val >= 0 ? 'text-emerald-400' : 'text-rose-400')
                                        }`}>
                                            {mode === 'zfactor' ? `${effectiveZ >= 0 ? '+' : ''}${effectiveZ.toFixed(2)}x` : `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`}
                                        </span>
                                    </div>
                                </div>

                                {/* Z-Factor visual progress bar */}
                                {mode === 'zfactor' && (
                                    <div className="w-full bg-tf-bg-app rounded-full h-1 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${
                                                (s.xFactorMode === 'QUANT_RELATIVE' || xFactorMode === 'QUANT_RELATIVE')
                                                    ? (effectiveZ >= 0 ? 'bg-cyan-500/80' : 'bg-tf-border')
                                                    : (effectiveZ >= 0 ? 'bg-emerald-500/80' : 'bg-rose-500/80')
                                            }`}
                                            style={{ width: `${Math.min(Math.abs(effectiveZ) * 10, 100)}%` }}
                                        />
                                    </div>
                                )}

                                <div className="flex justify-between items-center w-full">
                                    <div className="flex gap-1.5 items-center flex-wrap">
                                        {s.confluenceGrade && getConfluenceGradeBadge(s.confluenceGrade, s.confluenceScore)}
                                    </div>
                                    <span className="text-[10px] text-tf-text-muted font-mono">
                                        {mode === 'zfactor' ? (
                                            (s.xFactorMode === 'QUANT_RELATIVE' || xFactorMode === 'QUANT_RELATIVE')
                                                ? (effectiveZ > 0 ? 'REL. ALPHA LEAD' : 'REL. MARKET LAG')
                                                : (effectiveZ > 1.5 ? 'INST. ACCUM' : effectiveZ >= 0 ? 'MODERATE ACCUM' : 'LIQUIDATION')
                                        ) : `${dynamicStrengthRatio.toFixed(2)}x rel`}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    const renderTooltipContent = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const isTrap = data.pct > 0.2 && data.openChangePct < -0.15;
            const isSpringboard = data.pct < -0.2 && data.openChangePct > 0.15;

            return (
                <div className="bg-tf-bg-card border border-tf-border p-4 rounded-2xl shadow-2xl backdrop-blur-md max-w-xs space-y-2 transform -translate-y-28 pointer-events-none">
                    <div className="flex justify-between items-center gap-2 border-b border-tf-border pb-2">
                        <p className="text-white font-black text-xs uppercase tracking-wider">{data.name}</p>
                        {data.confluenceGrade && getConfluenceGradeBadge(data.confluenceGrade, data.confluenceScore)}
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-1 text-left">
                        <div>
                            <span className="text-[9px] text-tf-text-muted uppercase font-black block">C2C Return</span>
                            <span className={`text-xs font-mono font-black ${data.pct >= 0 ? 'text-emerald-400' : 'text-rose-450'}`}>
                                {data.pct >= 0 ? '+' : ''}{data.pct.toFixed(2)}%
                            </span>
                        </div>
                        <div>
                            <span className="text-[9px] text-tf-text-muted uppercase font-black block">O2C Change</span>
                            <span className={`text-xs font-mono font-black ${data.openChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.openChangePct >= 0 ? '+' : ''}{data.openChangePct.toFixed(2)}%
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-1 text-left border-t border-tf-border-subtle">
                        <div>
                            <span className="text-[9px] text-tf-text-muted uppercase font-black block">L2C Recovery</span>
                            <span className="text-xs font-mono font-black text-emerald-400">
                                +{data.l2cChangePct.toFixed(2)}%
                            </span>
                        </div>
                        <div>
                            <span className="text-[9px] text-tf-text-muted uppercase font-black block">H2C Retrace</span>
                            <span className="text-xs font-mono font-black text-rose-400">
                                {data.h2cChangePct.toFixed(2)}%
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-1 text-left border-t border-tf-border-subtle">
                        <div>
                            <span className="text-[9px] text-tf-text-muted uppercase font-black block">Bulls/Bears Ratio</span>
                            <span className={`text-xs font-mono font-black ${data.bullsBearsRatio >= 0 ? 'text-emerald-400' : 'text-rose-450'}`}>
                                {data.bullsBearsRatio >= 0 ? '+' : ''}{(data.bullsBearsRatio * 100).toFixed(0)}%
                            </span>
                        </div>
                        <div>
                            <span className="text-[9px] text-tf-text-muted uppercase font-black block">Booster Stocks</span>
                            <span className="text-xs font-mono font-black text-indigo-400">
                                {data.intradayBoosterCount}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-1 text-left border-t border-tf-border-subtle">
                        <div>
                            <span className="text-[9px] text-tf-text-muted uppercase font-black block">
                                {mode === 'zfactor' ? 'X-Factor' : 'Strength Ratio'}
                            </span>
                            <span className="text-xs font-mono font-black text-indigo-400">
                                {data.zFactor === undefined && mode === 'zfactor' ? 'N/A' : `${data.value.toFixed(2)}x`}
                            </span>
                        </div>
                        {mode === 'zfactor' && (
                            <div>
                                <span className="text-[9px] text-tf-text-muted uppercase font-black block">CONVICTION ZONE</span>
                                <span className={`text-xs font-black ${
                                    data.zFactor === undefined
                                        ? 'text-tf-text-secondary'
                                        : (data.xFactorMode === 'QUANT_RELATIVE' || xFactorMode === 'QUANT_RELATIVE')
                                            ? (data.value > 0 ? 'text-cyan-400' : 'text-tf-text-secondary')
                                            : (data.value > 1.5 ? 'text-emerald-400' : data.value >= 0 ? 'text-emerald-300' : 'text-rose-450')
                                }`}>
                                    {data.zFactor === undefined
                                        ? 'NEUTRAL / NO DATA'
                                        : (data.xFactorMode === 'QUANT_RELATIVE' || xFactorMode === 'QUANT_RELATIVE')
                                            ? (data.value > 0 ? 'REL. ALPHA LEAD' : 'REL. MARKET LAG')
                                            : (data.value > 1.5 ? 'INST. ACCUMULATION' : data.value >= 0 ? 'MODERATE ACCUM' : 'LIQUIDATION / EXIT')}
                                </span>
                            </div>
                        )}
                    </div>

                    {(data.pe !== undefined || data.pb !== undefined || data.dy !== undefined) && (
                        <div className="grid grid-cols-3 gap-2 pt-1.5 text-left border-t border-tf-border-subtle">
                            <div>
                                <span className="text-[9px] text-tf-text-muted uppercase font-black block">P/E</span>
                                <span className="text-xs font-mono font-black text-tf-text-primary">
                                    {data.pe !== undefined && data.pe !== 0 ? data.pe.toFixed(1) : '--'}
                                </span>
                            </div>
                            <div>
                                <span className="text-[9px] text-tf-text-muted uppercase font-black block">P/B</span>
                                <span className="text-xs font-mono font-black text-tf-text-primary">
                                    {data.pb !== undefined && data.pb !== 0 ? data.pb.toFixed(1) : '--'}
                                </span>
                            </div>
                            <div>
                                <span className="text-[9px] text-tf-text-muted uppercase font-black block">Div Yield</span>
                                <span className="text-xs font-mono font-black text-tf-text-primary">
                                    {data.dy !== undefined && data.dy !== 0 ? `${data.dy.toFixed(2)}%` : '--'}
                                </span>
                            </div>
                        </div>
                    )}

                    {(data.perChange30d !== undefined || data.perChange365d !== undefined) && (
                        <div className="grid grid-cols-2 gap-4 pt-1.5 text-left border-t border-tf-border-subtle">
                            <div>
                                <span className="text-[9px] text-tf-text-muted uppercase font-black block">30D Return</span>
                                <span className={`text-xs font-mono font-black ${data.perChange30d !== undefined && data.perChange30d >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {data.perChange30d !== undefined ? `${data.perChange30d >= 0 ? '+' : ''}${data.perChange30d.toFixed(1)}%` : '--'}
                                </span>
                            </div>
                            <div>
                                <span className="text-[9px] text-tf-text-muted uppercase font-black block">365D Return</span>
                                <span className={`text-xs font-mono font-black ${data.perChange365d !== undefined && data.perChange365d >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {data.perChange365d !== undefined ? `${data.perChange365d >= 0 ? '+' : ''}${data.perChange365d.toFixed(1)}%` : '--'}
                                </span>
                            </div>
                        </div>
                    )}

                    {(data.yearHigh !== undefined || data.yearLow !== undefined) && (
                        <div className="grid grid-cols-2 gap-4 pt-1.5 text-left border-t border-tf-border-subtle">
                            <div>
                                <span className="text-[9px] text-tf-text-muted uppercase font-black block">52W High</span>
                                <span className="text-xs font-mono font-black text-emerald-400">
                                    {data.yearHigh !== undefined && data.yearHigh !== 0 ? `₹${formatCurrencyPrecise(data.yearHigh)}` : '--'}
                                </span>
                            </div>
                            <div>
                                <span className="text-[9px] text-tf-text-muted uppercase font-black block">52W Low</span>
                                <span className="text-xs font-mono font-black text-rose-400">
                                    {data.yearLow !== undefined && data.yearLow !== 0 ? `₹${formatCurrencyPrecise(data.yearLow)}` : '--'}
                                </span>
                            </div>
                        </div>
                    )}

                    {data.tradedValue !== undefined && data.tradedValue > 0 && (
                        <div className="grid grid-cols-2 gap-4 pt-1.5 text-left border-t border-tf-border-subtle">
                            <div>
                                <span className="text-[9px] text-tf-text-muted uppercase font-black block">Traded Value</span>
                                <span className="text-xs font-mono font-black text-tf-text-primary">
                                    ₹{(data.tradedValue / 10000000).toFixed(2)} Cr
                                </span>
                            </div>
                            {data.volume !== undefined && data.volume > 0 && (
                                <div>
                                    <span className="text-[9px] text-tf-text-muted uppercase font-black block">Traded Volume</span>
                                    <span className="text-xs font-mono font-black text-tf-text-primary">
                                        {(data.volume / 100000).toFixed(2)} L
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {data.topDriverSymbol && (
                        <div className="pt-1.5 border-t border-tf-border-subtle flex justify-between items-center text-[10px]">
                            <span className="text-tf-text-muted uppercase font-black">Top Pick</span>
                            <span className={`font-mono font-black ${data.topDriverStrength >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.topDriverSymbol} ({data.topDriverStrength >= 0 ? '+' : ''}{data.topDriverStrength.toFixed(2)}%)
                            </span>
                        </div>
                    )}

                    {isTrap && (
                        <div className="mt-2 p-1.5 rounded-lg text-center text-[10px] font-black uppercase border bg-rose-500/10 text-rose-400 border-rose-500/20">
                            ⚠️ Fading Gap Up (Trap)
                            <span className="block text-[8px] opacity-75 font-mono normal-case mt-0.5">
                                Opened green but losing momentum intraday.
                            </span>
                        </div>
                    )}

                    {isSpringboard && (
                        <div className="mt-2 p-1.5 rounded-lg text-center text-[10px] font-black uppercase border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                            ⚡ Rebound Springboard (Bullish)
                            <span className="block text-[8px] opacity-75 font-mono normal-case mt-0.5">
                                Opened red but rallying strongly from open.
                            </span>
                        </div>
                    )}

                    {data.fatigueScore !== 0 && (
                        <div className="flex justify-between items-center text-[10px] pt-1.5 border-t border-tf-border-subtle">
                            <span className="text-tf-text-muted uppercase font-black">STREAK</span>
                            <span className={`font-mono font-black ${data.fatigueScore > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.fatigueScore > 0 ? `+${data.fatigueScore}d Up` : `${data.fatigueScore}d Down`}
                            </span>
                        </div>
                    )}

                    {data.fatigueState !== 'neutral' && (
                        <div className={`mt-2 p-1.5 rounded-lg text-center text-[9px] font-black uppercase border ${data.fatigueState === 'springboard'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            }`}>
                            {data.fatigueState === 'springboard' ? '⚡ Rebound Setup' : '⚠️ Exhaustion Zone'}
                        </div>
                    )}
                </div>
            );
        }
        return null;
    };

    return (
        <div ref={widgetRef} className="bg-tf-bg-card backdrop-blur-xl rounded-2xl md:rounded-[2rem] p-3 md:p-6 border border-tf-border relative shadow-2xl h-[540px] md:h-[580px] flex flex-col">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4 mb-3 md:mb-4">
                <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                        Sector Scope <Target className="w-5 h-5 text-indigo-400 animate-pulse" />
                        <ActionButton
                            size="xs"
                            icon={<Camera size={11} className="text-tf-text-secondary" />}
                            label="PNG"
                            onClick={handleScreenshot}
                            isLoading={isExporting}
                            title="Download PNG Screenshot"
                        />
                        <ActionButton
                            size="xs"
                            icon={<RefreshCw size={11} />}
                            label="SYNC"
                            responsiveLabel
                            onClick={() => fetchSectors(true)}
                            isLoading={isRefreshing}
                            title={`Refresh Sector Scope (Last sync: ${lastSyncTime})`}
                        />
                        {wsStatus === 'connected' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[8px] font-mono font-bold tracking-wider uppercase shadow-[0_0_8px_rgba(16,185,129,0.15)]" title="Connected to Upstox WebSocket (0ms tick push)">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                LIVE WS
                            </span>
                        )}
                    </h2>
                    <p className="text-tf-text-secondary text-xs mt-0.5">
                        {mode === 'zfactor'
                            ? (xFactorMode === 'TRADER_INTENT'
                                ? 'Trader Intent Engine: Absolute directional momentum locked to price change (Green = UP, Red = DOWN)'
                                : 'Quant Relative Engine: Cross-sectional econometric alpha vs market median (Cyan = Lead, Slate = Lag)')
                            : mode === 'l2c'
                                ? "L2C rebound elasticity relative to NIFTY 50 (Cyan = bounce in red sector)"
                                : mode === 'h2c'
                                    ? "H2C retracement relative to NIFTY 50 (Amber = pullback in green sector)"
                                    : 'Strength ratio relative to NIFTY 50 benchmark'}
                    </p>
                </div>

                {/* Modern Toggle + Alerts wrapper */}
                <div className="flex items-center gap-2 md:gap-4 overflow-x-auto no-scrollbar max-w-full pb-1">
                    {/* View Switcher: Bar vs Heatmap */}
                    <Tabs.Root
                        value={view}
                        onValueChange={(v) => setView(v as any)}
                        layoutId="sector-scope-view-nav"
                        variant="solid-indigo"
                        motionPreset="spring"
                    >
                        <Tabs.List className="min-h-[32px] p-0.5 bg-tf-bg-surface border border-tf-border shrink-0">
                            <Tabs.Trigger
                                value="bar"
                                className="px-3 min-h-[26px] text-[9.5px] font-black uppercase tracking-wider"
                                title="Bar Chart View"
                            >
                                <span>📊</span> Bar
                            </Tabs.Trigger>
                            <Tabs.Trigger
                                value="heat"
                                className="px-3 min-h-[26px] text-[9.5px] font-black uppercase tracking-wider"
                                title="Heat Map View"
                            >
                                <span>🗺️</span> Heat
                            </Tabs.Trigger>
                        </Tabs.List>
                    </Tabs.Root>

                    {/* Modern Metric Mode Segmented Control */}
                    <Tabs.Root
                        value={mode}
                        onValueChange={(v) => setMode(v as any)}
                        layoutId="sector-scope-full-mode-nav"
                        variant="solid-indigo"
                        motionPreset="spring"
                    >
                        <Tabs.List className="min-h-[32px] p-0.5 bg-tf-bg-surface border border-tf-border shrink-0">
                            <Tabs.Trigger
                                value="absolute"
                                className="px-2.5 min-h-[26px] text-[9.5px] font-black uppercase tracking-wider"
                                title="Close-to-Close: Change from Previous Close"
                            >
                                <span>📊</span> C2C
                            </Tabs.Trigger>
                            <Tabs.Trigger
                                value="intraday"
                                className="px-2.5 min-h-[26px] text-[9.5px] font-black uppercase tracking-wider"
                                title="Open-to-Current: Intraday performance from Open"
                            >
                                <span>🏁</span> O2C
                            </Tabs.Trigger>
                            <Tabs.Trigger
                                value="l2c"
                                className="px-2.5 min-h-[26px] text-[9.5px] font-black uppercase tracking-wider"
                                title="Low-to-Current: Recovery from Day's Low"
                            >
                                <span>📈</span> L2C
                            </Tabs.Trigger>
                            <Tabs.Trigger
                                value="h2c"
                                className="px-2.5 min-h-[26px] text-[9.5px] font-black uppercase tracking-wider"
                                title="High-to-Current: Retracement from Day's High"
                            >
                                <span>📉</span> H2C
                            </Tabs.Trigger>
                            <Tabs.Trigger
                                value="zfactor"
                                className="px-2.5 min-h-[26px] text-[9.5px] font-black uppercase tracking-wider"
                                title="X-Factor Analytics Engine"
                            >
                                <span>⚡</span> X-FCT
                            </Tabs.Trigger>
                        </Tabs.List>
                    </Tabs.Root>

                    {/* Dual-Mode Toggle for X-Factor */}
                    {mode === 'zfactor' && (
                        <div className="flex items-center gap-1 bg-tf-bg-surface border border-tf-border rounded-lg p-0.5 shrink-0">
                            <button
                                type="button"
                                onClick={() => handleXFactorModeChange('TRADER_INTENT')}
                                className={`px-2.5 min-h-[26px] rounded text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 ${
                                    xFactorMode === 'TRADER_INTENT'
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                                        : 'text-tf-text-secondary hover:text-tf-text-primary'
                                }`}
                                title="Trader Intent Mode: Absolute directional lock (Green = UP, Red = DOWN). Pure Alpha Pulse Pro first intent."
                            >
                                <span>⚡</span> TRADER INTENT
                            </button>
                            <button
                                type="button"
                                onClick={() => handleXFactorModeChange('QUANT_RELATIVE')}
                                className={`px-2.5 min-h-[26px] rounded text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 ${
                                    xFactorMode === 'QUANT_RELATIVE'
                                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                                        : 'text-tf-text-secondary hover:text-tf-text-primary'
                                }`}
                                title="Quant Relative Mode: Cross-sectional econometric relative strength vs market median. Cyan/Slate palette."
                            >
                                <span>🔬</span> QUANT RELATIVE
                            </button>
                        </div>
                    )}

                    {/* Micro sector alert flags */}
                    <div className="flex items-center gap-2">
                        {sectors.some(s => s.fatigueState === 'springboard') && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-md">
                                <Zap size={10} className="animate-bounce" />Rebound
                            </span>
                        )}
                        {sectors.some(s => s.fatigueState === 'exhaustion') && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-md">
                                <ShieldAlert size={10} className="animate-pulse" /> Exhaustion
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 w-full min-h-[230px] md:min-h-[300px]">
                {view === 'bar' ? (
                    <SafeChartContainer>
                        <BarChart
                            data={chartData}
                            margin={{ top: 20, right: 10, left: -20, bottom: 50 }}
                        >
                            <XAxis
                                dataKey="name"
                                hide={false}
                                {...CHART_DEFAULTS.axis}
                                tick={({ x, y, payload }) => {
                                    const s = sectors.find(sec => sec.sector === payload.value);
                                    const isTrap = s && s.percentChange > 0.2 && (s.openChangePct ?? 0) < -0.15;
                                    const isSpringboard = s && s.percentChange < -0.2 && (s.openChangePct ?? 0) > 0.15;
                                    const isExhausted = s && s.fatigueState === 'exhaustion';
                                    const isRebound = s && s.fatigueState === 'springboard';
                                    const hasWarning = isTrap || isExhausted;
                                    const hasRebound = isSpringboard || isRebound;
                                    return (
                                        <g transform={`translate(${x},${y})`}>
                                            <text
                                                x={0}
                                                y={0}
                                                dy={10}
                                                textAnchor="end"
                                                fill={selectedSector === payload.value
                                                    ? CHART_COLORS.primary
                                                    : hasWarning
                                                        ? CHART_COLORS.loss
                                                        : hasRebound
                                                            ? CHART_COLORS.profit
                                                            : CHART_COLORS.neutral
                                                }
                                                fontSize={9}
                                                fontWeight={selectedSector === payload.value ? 900 : 700}
                                                transform="rotate(-45)"
                                                className="font-sans tracking-tight cursor-pointer hover:underline hover:fill-indigo-400 transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openSectorTradingView(payload.value);
                                                }}
                                            >
                                                {payload.value}{hasWarning ? ' ⚠️' : hasRebound ? ' ⚡' : ''}
                                            </text>
                                        </g>
                                    );
                                }}
                                interval={0}
                            />
                            <YAxis
                                type="number"
                                domain={['auto', 'auto']}
                                {...CHART_DEFAULTS.axis}
                            />
                            <Tooltip
                                {...CHART_DEFAULTS.tooltip}
                                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                                content={renderTooltipContent}
                            />
                            <ReferenceLine y={0} stroke={CHART_DEFAULTS.grid.stroke} strokeDasharray={CHART_DEFAULTS.grid.strokeDasharray} />
                            <Bar
                                dataKey="value"
                                radius={[4, 4, 0, 0]}
                                barSize={20}
                                cursor="pointer"
                            >
                                {chartData.map((entry, index) => {
                                    const isElite = entry.confluenceGrade?.startsWith('ELITE');
                                    const isBullish = entry.confluenceGrade?.endsWith('BULLISH');

                                    let strokeColor = 'transparent';
                                    let strokeWidth = 0;

                                    if (selectedSector === entry.name) {
                                        strokeColor = CHART_COLORS.primary;
                                        strokeWidth = 2.5;
                                    } else if (isElite) {
                                        strokeColor = isBullish ? CHART_COLORS.profit : CHART_COLORS.loss;
                                        strokeWidth = 2.0;
                                    }

                                    return (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.fill}
                                            stroke={strokeColor}
                                            strokeWidth={strokeWidth}
                                            onClick={() => onSectorSelect(entry.name)}
                                            className={`transition-all duration-300 hover:opacity-80 ${isElite
                                                    ? (isBullish
                                                        ? 'drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]'
                                                        : 'drop-shadow-[0_0_6px_rgba(244,63,94,0.4)]')
                                                    : ''
                                                }`}
                                        />
                                    );
                                })}
                            </Bar>
                        </BarChart>
                    </SafeChartContainer>
                ) : (
                    <SafeChartContainer>
                        <Treemap
                            data={chartData.map(d => ({ 
                                ...d, 
                                marketCap: d.tradedValue > 0 ? d.tradedValue : ((SECTOR_CONSTITUENTS[d.name.toUpperCase()]?.length || 5) * 10000000)
                            }))}
                            dataKey="marketCap"
                            stroke="#fff"
                            fill="#8884d8"
                            content={(props: any) => <CustomTreemapContent {...props} mode={mode} selectedSector={selectedSector} />}
                            animationDuration={800}
                            animationEasing="ease-out"
                            isAnimationActive={isVisible}
                            onClick={(node: any) => {
                                if (node && node.name) {
                                    onSectorSelect(node.name);
                                }
                            }}
                        >
                            <Tooltip
                                content={renderTooltipContent}
                            />
                        </Treemap>
                    </SafeChartContainer>
                )}
            </div>
        </div>
    );
};

export default SectorScopeWidget;
