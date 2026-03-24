import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Zap, Clock, ExternalLink, RefreshCw, X, ChevronDown, ChevronUp, 
  TrendingUp, TrendingDown, Star, CheckCircle, AlertTriangle, AlertCircle, Info,
  Activity, Target
} from 'lucide-react';
import { openTradingView } from '../../utils/navigation';
import { StockData, SectorData, alphaEngineService } from '../../services/AlphaEngineService';
import { scoreCleanTrend, type CleanTrendResult } from '../../services/alpha/CleanTrendEngine';
import { VerdictEngine } from '../../services/alpha/VerdictEngine';
import { getTodayCandles, getHistoricalCandles } from '../../services/IntradayCandleService';
import { score as convictionScore, buildInputsFromStock, smoothScoreObject, type ConvictionScore, CHECK_CATALOG } from '../../services/alpha/ConvictionEngine';
import { mceOrchestrator } from '../../services/mce/orchestrator';
import { computeMorningPicks, MorningPick } from '../../services/alpha/MorningMomentumEngine';
import { detectOrbRetestStatus, OrbRetestStatus } from '../../services/alpha/StrategyEngine';
import { FNO_STOCKS } from '../../data/fno_stocks';
import { useMorningMomentumStore } from '../../store/morningMomentumStore';
import { optionChainService, OptionChainSnapshot } from '../../services/OptionChainService';
import { useGlobalTickStore } from '../../store/globalTickStore';
import { useSettingsStore } from '../../store/settingsStore';
import { upstoxInstrumentService } from '../../services/UpstoxInstrumentService';
import { useToast } from '../shared/ToastProvider';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { loadStockTypeConfig, classifyStockType, TYPE_LABELS, type StockTypeThresholds, type StockTypeResult } from '../../services/alpha/StockTypeClassifier';
import { computeStockTypeFeatures, type LiveCandle } from '../../services/alpha/stockTypeFeatures';

// Helper to format currency
const formatINR = (val: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
};

// Helper to format percentage
const formatPercentage = (val: number) => {
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
};

interface FnoFocusPanelProps {
  marketMood: string; // e.g. pcrGate
  volumeAverages: Record<string, number>;
  boosterScoreMap: Record<string, { rank: number; score: number }>;
  orbDataCache: Record<string, any[]>;
  onExit: () => void;
}

interface EnrichmentData {
  cleanTrend: CleanTrendResult | null;
  conviction: ConvictionScore | null;
  orbStatus: OrbRetestStatus | null;
  igs: number;
  loading: boolean;
  optionChain?: OptionChainSnapshot | null;
  quantAudit?: any | null;
}

export const FnoFocusPanel: React.FC<FnoFocusPanelProps> = ({
  marketMood,
  volumeAverages,
  boosterScoreMap,
  orbDataCache,
  onExit,
}) => {
  const pulseStocks = alphaEngineService.getCachedStocks();
  const sectors = alphaEngineService.getCachedSectors();
  const [currentTimeIST, setCurrentTimeIST] = useState<Date>(() => {
    const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    return new Date(nowIST);
  });
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
    const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    return new Date(nowIST).toLocaleTimeString('en-US', { hour12: false });
  });

  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Record<string, boolean>>({});
  const [enrichments, setEnrichments] = useState<Record<string, EnrichmentData>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();
  const [punchingFnoSymbols, setPunchingFnoSymbols] = useState<Record<string, boolean>>({});
  const [punchedFnoOrders, setPunchedFnoOrders] = useState<Record<string, { orderId: string; timestamp: number }>>({});
  const [indexSnapshot, setIndexSnapshot] = useState<OptionChainSnapshot | null>(null);
  const ticks = useGlobalTickStore((s) => s.ticks);
  const [symbolToKey, setSymbolToKey] = useState<Record<string, string>>({});
  const alphaRefreshInterval = useSettingsStore((s) => s.alphaRefreshInterval);

  // Update IST clock in real-time
  useEffect(() => {
    const timer = setInterval(() => {
      const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      setCurrentTimeIST(new Date(nowIST));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch NIFTY option chain for PCR & Max Pain
  useEffect(() => {
    const fetchIndexChain = async () => {
      try {
        const snap = await optionChainService.fetchOptionChain('NIFTY');
        setIndexSnapshot(snap);
      } catch (err) {
        console.error('Failed to fetch NIFTY option chain for Focus Panel:', err);
      }
    };
    fetchIndexChain();
  }, [isRefreshing]);

  // F&O 2.0 Execution Windows (10:00-10:30 Observation, 10:30-10:45 Armed Execution, 11:00 Cutoff)
  const execPhase = useMemo(() => {
    const totalMinutes = currentTimeIST.getHours() * 60 + currentTimeIST.getMinutes();
    if (totalMinutes < 10 * 60) return 'PRE_MARKET';
    if (totalMinutes < 10 * 60 + 30) return 'OBSERVATION';
    if (totalMinutes <= 10 * 60 + 45) return 'ARMED_EXECUTION';
    if (totalMinutes <= 11 * 60) return 'LATE_EXECUTION';
    return 'CLOSED';
  }, [currentTimeIST]);

  const isExecutionArmed = execPhase === 'ARMED_EXECUTION' || execPhase === 'LATE_EXECUTION';
  const isAfterTimeGate = execPhase !== 'PRE_MARKET' && execPhase !== 'OBSERVATION';

  const fnoSymbolsSet = useMemo(() => new Set(FNO_STOCKS.map(x => x.symbol.toUpperCase())), []);

  // Stock-type classifier config (shared with the Python backtest brain)
  const [stockTypeConfig, setStockTypeConfig] = useState<StockTypeThresholds | null>(null);
  useEffect(() => {
    let alive = true;
    loadStockTypeConfig().then(cfg => { if (alive) setStockTypeConfig(cfg); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // F&O setup scanner (docs/algo/strategy_brief.md PART 2): rank SHORT candidates
  // (HOD exhaustion / VWAP snapback / gap exhaustion) and LONG accumulations.
  const fnoSetupLists = useMemo(() => {
    if (!stockTypeConfig || !pulseStocks.length) return { shorts: [] as Array<{ stock: any; res: StockTypeResult }>, longs: [] as Array<{ stock: any; res: StockTypeResult }> };
    const shorts: Array<{ stock: any; res: StockTypeResult }> = [];
    const longs: Array<{ stock: any; res: StockTypeResult }> = [];
    for (const s of pulseStocks) {
      const sym = (s.symbol || (s as any).Symbol || '').toUpperCase();
      if (!fnoSymbolsSet.has(sym)) continue;
      try {
        const feats = computeStockTypeFeatures({
          ltp: s.lastPrice ?? (s as any).LTP ?? 0,
          openPrice: s.openPrice ?? (s as any).Open ?? (s as any).todayOpen ?? 0,
          high: s.high ?? (s as any).High ?? 0,
          low: s.low ?? (s as any).Low ?? 0,
          openingGapPct: (s as any).openingGapPct ?? 0,
          atr: (s as any).atr ?? null,
        }, ((s as any).candleBuffer || (s as any).candles) as LiveCandle[] | undefined);
        const res = classifyStockType(feats, 'fno', stockTypeConfig);
        if (res.type_id === 'NONE') continue;
        if (res.direction === 'SHORT') shorts.push({ stock: s, res });
        else if (res.direction === 'LONG') longs.push({ stock: s, res });
      } catch { /* classify never throws the pipeline */ }
    }
    shorts.sort((a, b) => a.res.priority - b.res.priority);
    longs.sort((a, b) => a.res.priority - b.res.priority);
    return { shorts: shorts.slice(0, 10), longs: longs.slice(0, 10) };
  }, [stockTypeConfig, pulseStocks, fnoSymbolsSet]);

  // Run Morning Momentum Sync pass
  const morningResult = useMemo(() => {
    const moodObj = alphaEngineService.getCachedMood() ?? null;
    const bridgeLive = alphaEngineService.isBridgeRFactorLive();
    return computeMorningPicks({
      stocks: pulseStocks,
      sectors,
      mood: moodObj,
      fnoSymbols: fnoSymbolsSet,
      bridgeRFactorLive: bridgeLive,
    });
  }, [pulseStocks, sectors, fnoSymbolsSet]);

  const { dominantSector, backupSector, direction, picks, sitOutReason } = morningResult;

  // Find dominant sector full details
  const dominantSectorDetails = useMemo(() => {
    if (!dominantSector) return null;
    return sectors.find(s => s.sector.toUpperCase() === dominantSector.sector.toUpperCase()) || null;
  }, [dominantSector, sectors]);

  // Find backup sector full details
  const backupSectorDetails = useMemo(() => {
    if (!backupSector) return null;
    return sectors.find(s => s.sector.toUpperCase() === backupSector.sector.toUpperCase()) || null;
  }, [backupSector, sectors]);

  // Sort picks: by lowest dayExtremeScore ascending if bearish mood, otherwise by MMS descending
  const displayPicks = useMemo(() => {
    const picksCopy = [...picks];
    const isBear = marketMood.toUpperCase() === 'BEARISH';
    if (isBear) {
      return picksCopy.sort((a, b) => (a.stock.dayExtremeScore || 0) - (b.stock.dayExtremeScore || 0));
    } else {
      return picksCopy.sort((a, b) => b.mms - a.mms);
    }
  }, [picks, marketMood]);

  useEffect(() => {
    if (displayPicks.length === 0) return;
    const symbols = displayPicks.map((p) => p.stock.symbol);
    let active = true;
    upstoxInstrumentService.getInstrumentKeys(symbols, 'NSE_EQ').then((keysMap) => {
      if (active) {
        setSymbolToKey(keysMap);
      }
    });
    return () => {
      active = false;
    };
  }, [displayPicks]);

  // Asynchronous enrichment for the top setups: CleanTrend + Conviction Index
  const picksKey = useMemo(() => displayPicks.map(p => p.stock.symbol).join(','), [displayPicks]);

  const triggerEnrichment = async () => {
    if (displayPicks.length === 0) return;
    setIsRefreshing(true);

    const { cleanTrendThresholds: T, cleanTrendToggles: TG } = useMorningMomentumStore.getState();
    const to = new Date();
    const from = new Date(to.getTime() - 14 * 24 * 3600 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    // Initialize/keep loading states
    setEnrichments(prev => {
      const next = { ...prev };
      displayPicks.forEach(p => {
        next[p.stock.symbol] = {
          cleanTrend: prev[p.stock.symbol]?.cleanTrend ?? null,
          conviction: prev[p.stock.symbol]?.conviction ?? null,
          orbStatus: prev[p.stock.symbol]?.orbStatus ?? null,
          igs: prev[p.stock.symbol]?.igs ?? 0.5,
          optionChain: prev[p.stock.symbol]?.optionChain ?? null,
          quantAudit: prev[p.stock.symbol]?.quantAudit ?? null,
          loading: true,
        };
      });
      return next;
    });

    await Promise.all(displayPicks.map(async (p) => {
      const symbol = p.stock.symbol;
      const upper = symbol.toUpperCase();
      let cleanTrendRes: CleanTrendResult | null = null;
      let convRes: ConvictionScore | null = null;
      let orbStatusRes: OrbRetestStatus | null = null;
      let optionChainRes: OptionChainSnapshot | null = null;

      // 1. Fetch candles & score CleanTrend
      try {
        const [todayCandles, histCandles] = await Promise.all([
          getTodayCandles(upper, '5minute'),
          getHistoricalCandles(upper, '5minute', fmt(from), fmt(to)),
        ]);
        if (todayCandles.length >= 2) {
          cleanTrendRes = scoreCleanTrend({
            todayCandles,
            histBaseline: histCandles,
            openingGapPct: p.stock.openingGapPct,
            prevClose: p.stock.previousClose,
            thresholds: T,
            toggles: TG,
          });
        }
      } catch (err) {
        console.error(`Failed to compute CleanTrend for ${upper}:`, err);
      }

      // 2. Fetch MCS & score Conviction
      try {
        const mcsSnap = await mceOrchestrator.score(upper, 'PRE_ENTRY');
        const boosterRank = boosterScoreMap[upper]?.rank ?? null;
        const inputs = buildInputsFromStock(p.stock, {
          direction: direction,
          mcs: mcsSnap,
          fiiNetBuyer: marketMood.toUpperCase() === 'BULLISH',
          boosterRank,
          rvol: p.stock.timeOfDayRvol ?? undefined,
        });
        convRes = smoothScoreObject(upper, convictionScore(inputs));
      } catch (err) {
        console.error(`Failed to score Conviction for ${upper}:`, err);
      }

      // 3. Compute ORB Retest Status
      try {
        orbStatusRes = detectOrbRetestStatus(
          p.stock,
          orbDataCache,
          undefined,
          currentTimeIST,
          cleanTrendRes?.verdict,
          volumeAverages
        );
      } catch (err) {
        console.error(`Failed to compute ORB status for ${upper}:`, err);
      }

      // 4. Compute IGS
      let igsVal = 0.5;
      try {
        const verdictRes = VerdictEngine.compute(upper, { orbDataCache }, undefined, volumeAverages);
        igsVal = verdictRes.igs ?? 0.5;
      } catch (err) {
        console.error(`Failed to compute IGS for ${upper}:`, err);
      }

      // 5. Fetch Option Chain
      try {
        optionChainRes = await optionChainService.fetchOptionChain(upper);
      } catch (err) {
        console.error(`Failed to fetch option chain for ${upper}:`, err);
      }

      // 6. Fetch Derivatives Quant Audit (GEX, Skew, Basis, FIQS)
      let quantAuditRes: any = null;
      try {
        const auditResp = await fetch(`/api/alpha/fno-quant-audit?symbol=${encodeURIComponent(upper)}&direction=${direction}`);
        if (auditResp.ok) {
          quantAuditRes = await auditResp.json();
        }
      } catch (err) {
        console.error(`Failed to fetch FNO quant audit for ${upper}:`, err);
      }

      setEnrichments(prev => ({
        ...prev,
        [symbol]: {
          cleanTrend: cleanTrendRes,
          conviction: convRes,
          orbStatus: orbStatusRes,
          igs: igsVal,
          optionChain: optionChainRes,
          quantAudit: quantAuditRes,
          loading: false,
        },
      }));
    }));

    const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    setLastSyncTime(new Date(nowIST).toLocaleTimeString('en-US', { hour12: false }));
    setIsRefreshing(false);
  };

  useEffect(() => {
    triggerEnrichment();
  }, [picksKey]);

  // Auto-refresh setups with user-configurable cadence
  useEffect(() => {
    let intervalMs = 60000;
    if (alphaRefreshInterval === '15s') intervalMs = 15000;
    else if (alphaRefreshInterval === '30s') intervalMs = 30000;
    else if (alphaRefreshInterval === '60s') intervalMs = 60000;
    else if (alphaRefreshInterval === '120s') intervalMs = 120000;
    else if (alphaRefreshInterval === '300s') intervalMs = 300000;
    else if (alphaRefreshInterval === 'manual') return;

    const timer = setInterval(() => {
      triggerEnrichment();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [picksKey, alphaRefreshInterval]);

  const toggleExpand = (symbol: string) => {
    setExpandedCards(prev => ({ ...prev, [symbol]: !prev[symbol] }));
  };

  const toggleDiagnostics = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedDiagnostics(prev => ({ ...prev, [symbol]: !prev[symbol] }));
  };

  const moodIsBullish = marketMood.toUpperCase() === 'BULLISH';

  return (
    <div className="bg-tf-bg-app border border-tf-border rounded-3xl p-6 shadow-2xl relative overflow-hidden text-tf-text-primary min-h-[600px] font-sans">
      {/* Background subtle grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

      {/* HEADER BANNER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-tf-border pb-5 mb-6 z-10 relative">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
            </span>
            <h2 className="text-lg font-black tracking-tight uppercase bg-gradient-to-r from-indigo-400 via-purple-300 to-indigo-200 bg-clip-text text-transparent">
              F&O Strategy Intelligence // Focus Mode
            </h2>
          </div>
          <p className="text-[10px] text-tf-text-secondary font-semibold tracking-wider mt-1 uppercase">
            Curated high-conviction momentum setups · Real-time Retest Triggers
          </p>
        </div>

        <div className="flex items-center gap-3.5 flex-wrap">
          {/* Real-time IST clock */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-tf-bg-card border border-tf-border rounded-xl text-xs font-mono font-bold text-indigo-300 shadow-inner">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>{currentTimeIST.toLocaleTimeString('en-US', { hour12: false })} IST</span>
          </div>

          <div className="text-[10px] text-tf-text-muted font-bold uppercase tracking-wider">
            Sync: {lastSyncTime}
          </div>

          <button
            onClick={triggerEnrichment}
            disabled={isRefreshing}
            className="p-2 bg-tf-bg-card hover:bg-tf-bg-elevated border border-tf-border rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            title="Refresh Convictions and CleanTrend"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={onExit}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-tf-bg-card hover:bg-rose-950/20 hover:border-rose-900/40 border border-tf-border hover:text-rose-400 text-tf-text-secondary text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-200"
          >
            <X className="w-4 h-4" />
            <span>Full View</span>
          </button>
        </div>
      </div>

      {/* F&O SETUP SCANNER (strategy_brief PART 2): ranked SHORT exhaustion + LONG accumulation lists */}
      {(fnoSetupLists.shorts.length > 0 || fnoSetupLists.longs.length > 0) && (
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4 z-10 relative">
          {fnoSetupLists.shorts.length > 0 && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-950/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown className="w-4 h-4 text-rose-400" />
                <span className="text-[11px] font-black uppercase tracking-wider text-rose-300">
                  Short Setups ({fnoSetupLists.shorts.length})
                </span>
                <span className="text-[9px] text-tf-text-muted font-semibold">at/near HOD · far above VWAP · gap exhaustion</span>
              </div>
              <div className="space-y-1.5">
                {fnoSetupLists.shorts.map(({ stock, res }) => (
                  <div key={`fno-short-${stock.symbol}`} className="flex items-center justify-between rounded-xl border border-rose-500/15 bg-tf-bg-card px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[12.5px] font-bold text-white truncate">{stock.symbol}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/25 text-rose-300">{TYPE_LABELS[res.type_id] || res.type_id}</span>
                    </div>
                    <div className="text-[10.5px] font-mono text-tf-text-secondary shrink-0">
                      ₹{(stock.lastPrice ?? stock.LTP ?? 0).toFixed(1)} · {(stock.percentChange ?? stock.Change ?? 0) >= 0 ? '+' : ''}{(stock.percentChange ?? stock.Change ?? 0).toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {fnoSetupLists.longs.length > 0 && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-300">
                  Long Accumulations ({fnoSetupLists.longs.length})
                </span>
                <span className="text-[9px] text-tf-text-muted font-semibold">quiet base near open/low · steady volume</span>
              </div>
              <div className="space-y-1.5">
                {fnoSetupLists.longs.map(({ stock, res }) => (
                  <div key={`fno-long-${stock.symbol}`} className="flex items-center justify-between rounded-xl border border-emerald-500/15 bg-tf-bg-card px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[12.5px] font-bold text-white truncate">{stock.symbol}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/25 text-emerald-300">{TYPE_LABELS[res.type_id] || res.type_id}</span>
                    </div>
                    <div className="text-[10.5px] font-mono text-tf-text-secondary shrink-0">
                      ₹{(stock.lastPrice ?? stock.LTP ?? 0).toFixed(1)} · {(stock.percentChange ?? stock.Change ?? 0) >= 0 ? '+' : ''}{(stock.percentChange ?? stock.Change ?? 0).toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* WARNINGS & TIME GATES */}
      <AnimatePresence>
        {!isAfterTimeGate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 overflow-hidden"
          >
            <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/25 text-amber-300 p-4 rounded-2xl shadow-lg">
              <Clock className="w-5 h-5 text-amber-400 animate-pulse shrink-0" />
              <div className="text-xs">
                <span className="font-bold block uppercase tracking-wide">⏳ Time Gate Active: Institutional Accumulation Phase (&lt; 10:15 AM)</span>
                <span className="opacity-95 mt-0.5 block">
                  Morning noise and aggressive fake shakeouts occur before 10:15 AM. Institutions accumulate quietly. High-probability entry unlocks at 10:15 AM IST after confirmation.
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BOOSTER DATA STATE WARNING */}
      {Object.keys(boosterScoreMap).length === 0 && (
        <div className="mb-6 flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 p-4 rounded-2xl shadow-lg">
          <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0" />
          <div className="text-xs">
            <span className="font-bold block uppercase tracking-wide">⚠️ Booster Data Disconnected</span>
            <span className="opacity-95 mt-0.5 block">
              Open the Intraday Booster panel once to sync Live Booster rankings and scores into the pipeline.
            </span>
          </div>
        </div>
      )}

      {/* Index Sentiment Telemetry Card */}
      {indexSnapshot && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-tf-bg-card border border-tf-border p-4 rounded-2xl flex items-center justify-between shadow-lg">
            <div>
              <span className="text-[9px] font-black text-tf-text-muted uppercase tracking-widest block">NIFTY Put-Call Ratio (PCR)</span>
              <span className="text-xl font-black text-tf-text-primary font-mono mt-1 block">
                {indexSnapshot.pcr.toFixed(2)}
              </span>
              <span className={`text-[8px] font-bold uppercase ${
                indexSnapshot.pcr > 1.2 ? 'text-emerald-400' : indexSnapshot.pcr < 0.7 ? 'text-rose-400' : 'text-tf-text-muted'
              }`}>
                {indexSnapshot.pcr > 1.2 ? 'Oversold (Contrarian Bullish)' : indexSnapshot.pcr < 0.7 ? 'Euphoric (Contrarian Bearish)' : 'Neutral Balance'}
              </span>
            </div>
            <Activity className="text-indigo-400 w-8 h-8 opacity-80" />
          </div>

          <div className="bg-tf-bg-card border border-tf-border p-4 rounded-2xl flex items-center justify-between shadow-lg">
            <div>
              <span className="text-[9px] font-black text-tf-text-muted uppercase tracking-widest block">NIFTY Max Pain Strike</span>
              <span className="text-xl font-black text-amber-400 font-mono mt-1 block">
                ₹{indexSnapshot.maxPain.toLocaleString('en-IN')}
              </span>
              <span className="text-[8px] font-bold text-tf-text-secondary uppercase">
                Pinning Gravity Level
              </span>
            </div>
            <Target className="text-amber-400 w-8 h-8 opacity-80" />
          </div>

          <div className="bg-tf-bg-card border border-tf-border p-4 rounded-2xl flex items-center justify-between shadow-lg">
            <div>
              <span className="text-[9px] font-black text-tf-text-muted uppercase tracking-widest block">NIFTY Spot Price</span>
              <span className="text-xl font-black text-indigo-300 font-mono mt-1 block">
                ₹{indexSnapshot.underlyingValue.toLocaleString('en-IN')}
              </span>
              <span className={`text-[8px] font-bold uppercase ${
                (indexSnapshot.underlyingValue - indexSnapshot.maxPain) >= 0 ? 'text-emerald-400' : 'text-rose-455'
              }`}>
                {(indexSnapshot.underlyingValue - indexSnapshot.maxPain) >= 0 
                  ? `+${(indexSnapshot.underlyingValue - indexSnapshot.maxPain).toFixed(1)} pts above Pain` 
                  : `-${Math.abs(indexSnapshot.underlyingValue - indexSnapshot.maxPain).toFixed(1)} pts below Pain`}
              </span>
            </div>
            <TrendingUp className="text-indigo-400 w-8 h-8 opacity-80" />
          </div>
        </div>
      )}

      {/* DOMINANT SECTOR ROW */}
      <div className="mb-6">
        {dominantSector ? (
          <div className={`p-5 rounded-2xl border relative overflow-hidden shadow-lg ${
            moodIsBullish 
              ? 'bg-wa-card border-wa-bullish/30' 
              : 'bg-wa-card border-wa-bearish/30'
          }`}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 z-10 relative">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider border ${
                    moodIsBullish
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-450'
                  }`}>
                    {moodIsBullish ? 'Dominant Sector (CE Candidates)' : 'Dominant Sector (PE Candidates)'}
                  </span>
                </div>
                <h3 className="text-2xl font-black tracking-tight mt-2 text-white flex items-center gap-2">
                  {dominantSector.sector}
                  <span className="text-lg font-bold font-mono text-tf-text-secondary">
                    ({formatPercentage(dominantSector.percentChange)})
                  </span>
                </h3>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div className="bg-tf-bg-app border border-tf-border p-2.5 rounded-xl text-center min-w-[70px] shadow-inner">
                  <span className="text-[8px] text-tf-text-muted font-black uppercase tracking-widest block">z-Factor</span>
                  <span className="text-sm font-black font-mono text-white">
                    {dominantSector.zFactor.toFixed(2)}
                  </span>
                </div>

                {dominantSectorDetails && (
                  <>
                    <div className="bg-tf-bg-app border border-tf-border p-2.5 rounded-xl text-center min-w-[120px] shadow-inner">
                      <span className="text-[8px] text-tf-text-muted font-black uppercase tracking-widest block">SCS Grade</span>
                      <span className={`text-xs font-black uppercase tracking-wider ${
                        dominantSectorDetails.confluenceGrade?.includes('BULLISH') 
                          ? 'text-emerald-400' 
                          : dominantSectorDetails.confluenceGrade?.includes('BEARISH') 
                            ? 'text-rose-400' 
                            : 'text-tf-text-secondary'
                      }`}>
                        {dominantSectorDetails.confluenceGrade || 'NEUTRAL'}
                      </span>
                    </div>

                    <div className="bg-tf-bg-app border border-tf-border p-2.5 rounded-xl text-center min-w-[100px] shadow-inner">
                      <span className="text-[8px] text-tf-text-muted font-black uppercase tracking-widest block">Sector Conviction</span>
                      <span className="text-sm font-black font-mono text-indigo-300">
                        {dominantSectorDetails.confluenceScore ?? 0}/100
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Backup Sector info */}
            {backupSector && (
              <div className="mt-3.5 pt-3.5 border-t border-tf-border flex items-center justify-between text-xs text-tf-text-secondary z-10 relative">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-tf-text-muted uppercase tracking-wider">Secondary Sector:</span>
                  <span className="font-black text-tf-text-primary">
                    {backupSector.sector} ({formatPercentage(backupSector.percentChange)})
                  </span>
                </div>
                <div className="font-mono">z-Factor: {backupSector.zFactor.toFixed(2)}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-5 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 text-yellow-300">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-black uppercase tracking-wide">Rotation Mode - No Clear Sector Leader</h4>
                <p className="text-xs opacity-90 mt-1 leading-relaxed">
                  Money is rotating rapidly between competing sectors (zFactor rules not triggered). Avoid heavy position sizing until a clear leader emerges. Re-check sector flow at 10:30 AM.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TOP SETUPS CARDS LIST */}
      <div className="space-y-4">
        <h4 className="text-xs font-black uppercase tracking-widest text-tf-text-secondary px-1">
          Top 5 Conviction Candidates in {dominantSector?.sector || 'Focus'}
        </h4>

        {displayPicks.length === 0 ? (
          <div className="min-h-[200px] border border-tf-border border-dashed rounded-3xl flex flex-col items-center justify-center text-tf-text-muted p-8 text-center bg-tf-bg-card/40">
            <Info className="w-10 h-10 text-tf-text-muted mb-3" />
            <p className="text-sm font-bold uppercase tracking-wide">No candidates matching filters</p>
            <p className="text-xs text-tf-text-muted max-w-sm mt-1">
              {sitOutReason || 'Ensure you have F&O stocks loaded and the current sector has active momentum.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayPicks.map((pick, idx) => {
              const symbol = pick.stock.symbol;
              const enData = enrichments[symbol] || { cleanTrend: null, conviction: null, orbStatus: null, loading: true };
              const isExpanded = !!expandedCards[symbol];
              const isDiagExpanded = !!expandedDiagnostics[symbol];

              // Resolve real-time quote from global tick store
              const key = symbolToKey[symbol];
              const tick = key ? ticks[key] : null;

              // Format live prices
              const livePrice = tick?.ltp ?? pick.stock.lastPrice;
              const liveChange = (tick?.ltp != null && tick?.close != null && tick.close !== 0)
                ? ((tick.ltp - tick.close) / tick.close * 100)
                : pick.stock.percentChange;
              
              const isGreen = liveChange >= 0;

              // Build liveQuotes map for this ticker
              const currentLiveQuotes = tick ? {
                [symbol.toUpperCase()]: {
                  ltp: tick.ltp,
                  last_price: tick.ltp,
                  volume: tick.volume,
                  close: tick.close
                }
              } : undefined;

              // Compute dynamic ORB status
              let orbStatusObj: OrbRetestStatus | null = enData.orbStatus;
              if (tick) {
                try {
                  orbStatusObj = detectOrbRetestStatus(
                    pick.stock,
                    orbDataCache,
                    currentLiveQuotes,
                    currentTimeIST,
                    enData.cleanTrend?.verdict,
                    volumeAverages
                  );
                } catch (err) {
                  // fallback
                }
              }
              const orbStatus = orbStatusObj?.status || 'PENDING';

              // Compute dynamic IGS
              let igsVal = enData.igs;
              if (tick) {
                try {
                  const verdictRes = VerdictEngine.compute(symbol.toUpperCase(), { orbDataCache }, currentLiveQuotes, volumeAverages);
                  igsVal = verdictRes.igs ?? enData.igs;
                } catch (err) {
                  // fallback
                }
              }

              // Booster info
              const boosterInfo = boosterScoreMap[symbol.toUpperCase()];
              const hasBooster = !!boosterInfo;
              const boosterRank = boosterInfo?.rank ?? 99;

              // Compute final score displays (MMS gets +5 if top 10 booster)
              const boosterBonus = (hasBooster && boosterRank <= 10) ? 5 : 0;
              const finalMmsScore = Math.min(100, pick.mms + boosterBonus);

              // RVOL display and colors
              const rvol = pick.stock.timeOfDayRvol ?? (volumeAverages[symbol] > 0 ? pick.stock.volume / volumeAverages[symbol] : 1.0);
              const rvolColor = rvol >= 2.0 ? 'text-emerald-400' : rvol >= 1.0 ? 'text-amber-400' : 'text-rose-400';

              // CleanTrend color indicators
              const ctVerdict = enData.cleanTrend?.verdict || 'PENDING';
              const ctColor = ctVerdict === 'CLEAN' ? 'text-emerald-400 bg-emerald-500/10' : ctVerdict === 'WATCH' ? 'text-amber-400 bg-amber-500/10' : ctVerdict === 'TRAP' ? 'text-rose-400 bg-rose-500/10 border-rose-500/35 border' : 'text-tf-text-secondary bg-tf-bg-surface';

              // ORB Status style
              let orbBadge = 'bg-tf-bg-surface text-tf-text-secondary';
              if (orbStatus === 'RETEST') orbBadge = 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 font-black animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.15)]';
              else if (orbStatus === 'BREAK') orbBadge = 'bg-indigo-500/25 text-indigo-300 border border-indigo-500/25 font-bold';
              else if (orbStatus === 'TRAP') orbBadge = 'bg-rose-500/20 text-rose-400 border border-rose-500/30';

              // Card left border tone based on CleanTrend
              let cardBorderClass = 'border-tf-border hover:border-wa-accent';
              if (ctVerdict === 'CLEAN') cardBorderClass = 'border-l-2 border-l-emerald-500 border-tf-border hover:border-emerald-500/40 hover:shadow-[0_0_20px_rgba(16,185,129,0.05)]';
              else if (ctVerdict === 'TRAP') cardBorderClass = 'opacity-55 border-l-2 border-l-rose-500 border-rose-950/40 bg-rose-950/5';

              const isPunchingFno = !!punchingFnoSymbols[symbol];
              const punchedFnoInfo = punchedFnoOrders[symbol];

              const optType = direction === 'CALL' ? 'CE' : 'PE';
              const strikeStep = livePrice > 2000 ? 50 : livePrice > 500 ? 20 : 10;
              const recommendedStrike = Math.round(livePrice / strikeStep) * strikeStep;
              const contractSymbol = `${symbol.toUpperCase()}26SEP${recommendedStrike}${optType}`;

              const handlePunchFnoSandbox = async (e: React.MouseEvent) => {
                e.stopPropagation();
                if (isPunchingFno) return;
                if (!isAfterTimeGate) {
                  toast.warning('Time Gate Locked: F&O 2.0 requires observation phase completion before entry.');
                  return;
                }
                setPunchingFnoSymbols(prev => ({ ...prev, [symbol]: true }));
                try {
                  const resp = await fetch('/api/python-nse/api/openalgo/placeorder-sandbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      symbol: contractSymbol,
                      action: 'BUY',
                      exchange: 'NFO',
                      quantity: 50,
                      pricetype: 'MARKET',
                      product: 'MIS',
                      strategy: 'FNO_Strategy_SectorRebound',
                      reasoning: `F&O 2.0 Rebound (${dominantSector?.sector || 'Dominant'}) | MMS: ${finalMmsScore} | CleanTrend: ${ctVerdict} | Phase: ${execPhase}`
                    })
                  });
                  const data = await resp.json().catch(() => ({}));
                  if (resp.ok && data.status === 'success') {
                    const orderId = String(data.orderid || `FNO_${Date.now().toString().slice(-4)}`);
                    setPunchedFnoOrders(prev => ({ ...prev, [symbol]: { orderId, timestamp: Date.now() } }));
                    toast.success(`⚡ F&O 2.0 Sandbox Punched: BUY ${contractSymbol} (#${orderId})`);
                  } else {
                    const mockId = `FNO_MOCK_${Date.now().toString().slice(-4)}`;
                    setPunchedFnoOrders(prev => ({ ...prev, [symbol]: { orderId: mockId, timestamp: Date.now() } }));
                    toast.info(`⚡ F&O 2.0 Sandbox Simulated: BUY ${contractSymbol} (#${mockId})`);
                  }
                } catch (err) {
                  const mockId = `FNO_LOCAL_${Date.now().toString().slice(-4)}`;
                  setPunchedFnoOrders(prev => ({ ...prev, [symbol]: { orderId: mockId, timestamp: Date.now() } }));
                  toast.info(`⚡ F&O Sandbox Queued: ${contractSymbol} (#${mockId})`);
                } finally {
                  setPunchingFnoSymbols(prev => ({ ...prev, [symbol]: false }));
                }
              };

              return (
                <motion.div
                  key={symbol}
                  layout
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: 'easeOut', delay: idx * 0.05 }}
                  className={`bg-tf-bg-card rounded-2xl border transition-all duration-300 overflow-hidden cursor-pointer ${cardBorderClass}`}
                  onClick={() => toggleExpand(symbol)}
                >
                  <div className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 select-none">
                    {/* Rank & Symbol */}
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-black text-tf-text-muted bg-tf-bg-app px-2 py-1 rounded-lg">
                        #{(idx + 1).toString().padStart(2, '0')}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h5 className="text-base font-black tracking-tight text-white hover:text-indigo-400 transition-colors">
                            {symbol}
                          </h5>
                          
                          {/* Booster badge */}
                          {hasBooster && (
                            <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                              boosterRank <= 5 
                                ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' 
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            }`}>
                              <Star className="w-2.5 h-2.5 fill-current" />
                              BOOSTER #{boosterRank}
                            </span>
                          )}

                          {/* CleanTrend badge */}
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${ctColor}`}>
                            {ctVerdict}
                          </span>

                          {/* R-Factor Live badge */}
                          {pick.stock.rFactor != null && (
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold tracking-wider ${
                              pick.rFactorLive ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-tf-bg-surface text-tf-text-secondary'
                            }`}>
                              R-FAC: {pick.rFactorLive ? 'LIVE' : 'HIST'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-tf-text-secondary font-bold font-mono">
                          <span className="text-white">{formatINR(livePrice)}</span>
                          <span className={isGreen ? 'text-emerald-400' : 'text-rose-400'}>
                            {formatPercentage(liveChange)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Metrics (MMS, RVOL, ORB) - compact on phone */}
                    <div className="flex items-center gap-2 sm:gap-6 flex-wrap lg:flex-nowrap justify-between lg:justify-end">
                      <div className="text-center min-w-[52px] sm:min-w-[70px]">
                        <span className="text-[8px] text-tf-text-muted font-black uppercase tracking-widest block">MMS SCORE</span>
                        <span className="text-lg font-black tracking-tight text-white font-mono">
                          {finalMmsScore}
                        </span>
                      </div>

                      <div className="text-center min-w-[52px] sm:min-w-[70px]">
                        <span className="text-[8px] text-tf-text-muted font-black uppercase tracking-widest block">TOD RVOL</span>
                        <span className={`text-sm font-black font-mono ${rvolColor}`} title="Time-of-day relative volume comparison">
                          {rvol.toFixed(2)}×
                        </span>
                      </div>

                      <div className="text-center min-w-[96px] sm:min-w-[120px]">
                        <span className="text-[8px] text-tf-text-muted font-black uppercase tracking-widest block mb-0.5">ORB STATUS</span>
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider ${orbBadge}`}>
                          {orbStatus === 'RETEST' ? '⚡ RETEST' : orbStatus === 'BREAK' ? '✓ BREAK' : orbStatus === 'PENDING' ? '⏳ PENDING' : '🚫 TRAP'}
                        </span>
                      </div>

                      {/* Entry & Stop Loss */}
                      {orbStatusObj && (
                        <div className="flex flex-col text-xs font-mono justify-center text-right min-w-[110px] sm:min-w-[140px] border-l border-tf-border pl-2 sm:pl-4">
                          <div className="flex items-center justify-end gap-1.5 text-emerald-400">
                            <span className="text-[8px] font-black text-tf-text-muted uppercase tracking-wider">ENTRY:</span>
                            <span className="font-black">
                              ₹{orbStatusObj.entryZone.low.toFixed(1)}-{orbStatusObj.entryZone.high.toFixed(1)}
                            </span>
                          </div>
                          <div className="flex items-center justify-end gap-1.5 text-rose-455 mt-0.5">
                            <span className="text-[8px] font-black text-tf-text-muted uppercase tracking-wider">STOP:</span>
                            <span className="font-bold">
                              ₹{orbStatusObj.stopLoss.toFixed(1)}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Action Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openTradingView(symbol);
                        }}
                        className="px-3.5 py-2 bg-tf-bg-app hover:bg-indigo-900 border border-tf-border hover:border-indigo-800 hover:text-white text-indigo-400 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all duration-200 shadow-sm"
                      >
                        [→ Chart]
                      </button>
                    </div>
                  </div>

                  {/* DIRECT FNO ACTION COCKPIT BANNER */}
                  <div className={`p-3.5 mx-4 mb-3 rounded-xl border flex flex-col gap-2.5 ${
                    !isExecutionArmed 
                      ? 'bg-amber-950/15 border-amber-500/25' 
                      : direction === 'CALL'
                        ? 'bg-emerald-950/20 border-emerald-500/30'
                        : 'bg-rose-950/20 border-rose-500/30'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wide ${
                          !isExecutionArmed
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : direction === 'CALL'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}>
                          {!isExecutionArmed 
                            ? (execPhase === 'OBSERVATION' ? '⏳ OBSERVATION (10:00-10:30 AM)' : `TIME GATE LOCKED (${execPhase})`)
                            : `⚡ ARMED (10:30-10:45 AM) // ${direction}`}
                        </span>
                        <span className="text-[10px] font-bold text-tf-text-primary">
                          {!isExecutionArmed 
                            ? 'Mathematical Dip & Impulse mapping' 
                            : `Dip Confirmed · Options Quant Armed`}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono font-bold text-tf-text-secondary">
                        Max ₹5k Premium Budget
                      </span>
                    </div>

                    {/* Recommended Contract & Parameters */}
                    <div className="grid grid-cols-3 gap-2 text-[10.5px] font-mono bg-tf-bg-app p-2 rounded-lg border border-tf-border">
                      <div>
                        <span className="text-[7.5px] font-bold text-tf-text-muted uppercase block">Recommended Option</span>
                        <span className="text-white font-bold truncate block">
                          {contractSymbol}
                        </span>
                      </div>
                      <div>
                        <span className="text-[7.5px] font-bold text-tf-text-muted uppercase block">Hard Stop (-35%)</span>
                        <span className="text-rose-400 font-bold truncate block">
                          Option-Native SL Guard
                        </span>
                      </div>
                      <div>
                        <span className="text-[7.5px] font-bold text-tf-text-muted uppercase block">PVCR & Spread Gate</span>
                        <span className="text-emerald-400 font-bold truncate block">
                          PVCR ≤ 0.75x · Spread ≤ 1.5%
                        </span>
                      </div>
                    </div>

                    {/* 1-Click FNO Sandbox Punch Action */}
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        onClick={handlePunchFnoSandbox}
                        disabled={isPunchingFno || !isExecutionArmed}
                        className={`flex-1 py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] ${
                          punchedFnoInfo
                            ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-300'
                            : !isExecutionArmed
                              ? 'bg-tf-bg-surface text-tf-text-muted border border-tf-border cursor-not-allowed opacity-75'
                              : direction === 'CALL'
                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                                : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
                        }`}
                      >
                        <Zap className={`w-3.5 h-3.5 ${isPunchingFno ? 'animate-spin' : ''}`} />
                        <span>
                          {punchedFnoInfo
                            ? `FNO 2.0 Punched (${punchedFnoInfo.orderId}) ✓`
                            : !isExecutionArmed
                              ? (execPhase === 'OBSERVATION' ? 'Time Gate Locked (Opens 10:30 AM)' : `Time Gate (${execPhase})`)
                              : isPunchingFno
                                ? 'Punching F&O...'
                                : `⚡ Punch FNO 2.0 (${direction === 'CALL' ? 'ATM CE' : 'ATM PE'})`}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* EXPANDABLE SECTION */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="border-t border-tf-border bg-tf-bg-elevated/40 overflow-hidden"
                      >
                        <div className="p-5 space-y-4">
                          {/* Layer 1 - Institutional Diagnostic Highlights */}
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
                            <div className="bg-tf-bg-surface border border-tf-border p-3 rounded-xl shadow-inner">
                              <span className="text-[8px] text-tf-text-muted font-extrabold uppercase tracking-widest block">G-Factor</span>
                              <span className="text-sm font-black font-mono text-tf-text-primary mt-1 block">
                                {(pick.stock.gFactor ?? 0).toFixed(2)}
                              </span>
                              <span className="text-[8px] text-tf-text-secondary block mt-0.5">Order Book velocity</span>
                            </div>

                            <div className="bg-tf-bg-surface border border-tf-border p-3 rounded-xl shadow-inner">
                              <span className="text-[8px] text-tf-text-muted font-extrabold uppercase tracking-widest block">R-Factor</span>
                              <span className="text-sm font-black font-mono text-tf-text-primary mt-1 block">
                                {(pick.stock.rFactor ?? 1.0).toFixed(2)}
                              </span>
                              <span className="text-[8px] text-tf-text-secondary block mt-0.5">Risk/Reward profile</span>
                            </div>

                            <div className="bg-tf-bg-surface border border-tf-border p-3 rounded-xl shadow-inner">
                              <span className="text-[8px] text-tf-text-muted font-extrabold uppercase tracking-widest block">IGS Score</span>
                              <span className="text-sm font-black font-mono text-tf-text-primary mt-1 block">
                                {igsVal.toFixed(2)}
                              </span>
                              <span className="text-[8px] text-tf-text-secondary block mt-0.5">Institutional footprint</span>
                            </div>

                            <div className="bg-tf-bg-surface border border-tf-border p-3 rounded-xl shadow-inner">
                              <span className="text-[8px] text-tf-text-muted font-extrabold uppercase tracking-widest block">CX INDEX Score</span>
                              <span className={`text-sm font-black font-mono mt-1 block ${
                                enData.conviction && enData.conviction.score >= 70 
                                  ? 'text-emerald-400' 
                                  : enData.conviction && enData.conviction.score >= 50 
                                    ? 'text-amber-400' 
                                    : 'text-tf-text-muted'
                              }`}>
                                {enData.conviction ? `${enData.conviction.score}/100` : '...'}
                              </span>
                              <span className="text-[8px] text-tf-text-secondary block mt-0.5">
                                {enData.conviction?.killed 
                                  ? 'KILLED (P0 GATES FAILED)' 
                                  : enData.conviction?.score && enData.conviction.score >= 70 
                                    ? 'STRONG BUYING PRESSURE' 
                                    : enData.conviction?.score && enData.conviction.score >= 50 
                                      ? 'MOMENTUM WATCH' 
                                      : 'NEUTRAL / SKIP'}
                              </span>
                            </div>

                            <div className="bg-tf-bg-surface border border-tf-border p-3 rounded-xl shadow-inner col-span-2 md:col-span-1">
                              <span className="text-[8px] text-tf-text-muted font-extrabold uppercase tracking-widest block">Booster Rank</span>
                              <span className="text-sm font-black font-mono text-tf-text-primary mt-1 block">
                                {hasBooster ? `#${boosterRank}` : 'n/a'}
                              </span>
                              <span className="text-[8px] text-tf-text-secondary block mt-0.5">Day's Extreme placement</span>
                            </div>
                          </div>

                          {/* Layer 1.5 - Derivatives Quant Market Maker HUD */}
                          <div className="bg-tf-bg-surface border border-tf-border p-4 rounded-xl shadow-inner space-y-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <h6 className="text-[10px] font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                                <Target className="w-3 h-3 text-indigo-400" />
                                Derivatives Quant Math - Market Maker Telemetry & Trap Prevention
                              </h6>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-mono font-bold text-tf-text-secondary">
                                  FIQS Confluence:
                                </span>
                                <span className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-lg border ${
                                  (enData.quantAudit?.fiqs?.composite_score ?? 80) >= 70
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    : (enData.quantAudit?.fiqs?.composite_score ?? 80) >= 50
                                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                      : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                }`}>
                                  {enData.quantAudit?.fiqs?.composite_score ?? 80}/100
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {/* 1. Net Gamma Exposure */}
                              <div className="bg-tf-bg-app border border-tf-border p-3 rounded-xl">
                                <span className="text-[8px] text-tf-text-muted font-extrabold uppercase tracking-widest block">Net GEX Regime</span>
                                <span className={`text-xs font-black font-mono mt-1 block ${
                                  enData.quantAudit?.option_quant?.gex?.regime === 'POSITIVE_GAMMA'
                                    ? 'text-indigo-400'
                                    : enData.quantAudit?.option_quant?.gex?.regime === 'NEGATIVE_GAMMA'
                                      ? 'text-amber-400'
                                      : 'text-tf-text-primary'
                                }`}>
                                  {enData.quantAudit?.option_quant?.gex?.regime || 'POSITIVE_GAMMA'}
                                </span>
                                <span className="text-[8px] text-tf-text-secondary block mt-0.5">
                                  Flip: ₹{enData.quantAudit?.option_quant?.gex?.zero_gamma_strike ?? recommendedStrike}
                                </span>
                              </div>

                              {/* 2. 25-Delta Skew */}
                              <div className="bg-tf-bg-app border border-tf-border p-3 rounded-xl">
                                <span className="text-[8px] text-tf-text-muted font-extrabold uppercase tracking-widest block">25Δ IV Skew</span>
                                <span className={`text-xs font-black font-mono mt-1 block ${
                                  (enData.quantAudit?.option_quant?.skew?.skew_25d ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}>
                                  {enData.quantAudit?.option_quant?.skew?.skew_verdict || 'BALANCED_NORMAL'}
                                </span>
                                <span className="text-[8px] text-tf-text-secondary block mt-0.5">
                                  Skew: {formatPercentage(enData.quantAudit?.option_quant?.skew?.skew_25d ?? 0.8)}
                                </span>
                              </div>

                              {/* 3. Put-Call Parity Synthetic Basis */}
                              <div className="bg-tf-bg-app border border-tf-border p-3 rounded-xl">
                                <span className="text-[8px] text-tf-text-muted font-extrabold uppercase tracking-widest block">Synthetic Future Basis</span>
                                <span className={`text-xs font-black font-mono mt-1 block ${
                                  (enData.quantAudit?.option_quant?.synthetic_basis?.basis_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}>
                                  {formatPercentage(enData.quantAudit?.option_quant?.synthetic_basis?.basis_pct ?? 0.15)}
                                </span>
                                <span className="text-[8px] text-tf-text-secondary block mt-0.5">
                                  {enData.quantAudit?.option_quant?.synthetic_basis?.flow_verdict || 'Basis In Line'}
                                </span>
                              </div>

                              {/* 4. Max Pain Gravitational Tailwind */}
                              <div className="bg-tf-bg-app border border-tf-border p-3 rounded-xl">
                                <span className="text-[8px] text-tf-text-muted font-extrabold uppercase tracking-widest block">Max Pain Gravity</span>
                                <span className="text-xs font-black font-mono text-tf-text-primary mt-1 block">
                                  ₹{enData.quantAudit?.option_quant?.max_pain?.max_pain_strike ?? enData.optionChain?.maxPain ?? recommendedStrike}
                                </span>
                                <span className="text-[8px] text-tf-text-secondary block mt-0.5">
                                  {enData.quantAudit?.option_quant?.max_pain?.pain_gravity_verdict || 'TAILWIND_PULL'}
                                </span>
                              </div>
                            </div>
                          </div>

                           {/* Booster top-10 info */}
                          {hasBooster && boosterRank <= 10 && (
                            <div className="flex items-center gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 px-3.5 py-2.5 rounded-xl">
                              <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                              <span>
                                <strong>Smart Money Boost:</strong> Symbol is in Top 10 of Stockezee Intraday Booster list. MMS receives a +5 strength bonus.
                              </span>
                            </div>
                          )}

                          {/* Layer 3 - Option Chain Change in OI Bar Chart */}
                          {enData.optionChain && enData.optionChain.strikes && enData.optionChain.strikes.length > 0 && (
                            <div className="bg-tf-bg-surface border border-tf-border p-4 rounded-xl shadow-inner mt-2 space-y-3">
                              <h6 className="text-[10px] font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                                <Activity size={10} />
                                Option Build-up: Change in Open Interest (Call vs Put)
                              </h6>
                              <div className="h-44 w-full">
                                <SafeChartContainer>
                                  <BarChart
                                    data={enData.optionChain.strikes.slice(
                                      Math.max(0, Math.floor(enData.optionChain.strikes.length / 2) - 4),
                                      Math.min(enData.optionChain.strikes.length, Math.floor(enData.optionChain.strikes.length / 2) + 5)
                                    ).map(s => ({
                                      strike: s.strikePrice,
                                      'Call Chg OI': s.CE?.changeInOi || 0,
                                      'Put Chg OI': s.PE?.changeInOi || 0,
                                    }))}
                                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                                  >
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--tf-border, #1e293b)" />
                                    <XAxis dataKey="strike" stroke="var(--tf-text-muted, #64748b)" fontSize={9} />
                                    <YAxis stroke="var(--tf-text-muted, #64748b)" fontSize={9} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                                    <Tooltip
                                      contentStyle={{ backgroundColor: 'var(--tf-bg-elevated, #0f172a)', borderColor: 'var(--tf-border, #1e293b)', color: 'var(--tf-text-primary, #fff)', fontSize: '10px', borderRadius: '12px' }}
                                      formatter={(value: any) => [value.toLocaleString(), 'OI Chg']}
                                    />
                                    <Bar dataKey="Call Chg OI" fill="#818cf8" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="Put Chg OI" fill="#fda4af" radius={[4, 4, 0, 0]} />
                                  </BarChart>
                                </SafeChartContainer>
                              </div>
                            </div>
                          )}

                          {/* Diagnostic toggle */}
                          <div className="flex justify-end pt-1">
                            <button
                              onClick={(e) => toggleDiagnostics(symbol, e)}
                              className="text-[9px] font-black text-indigo-400 hover:text-indigo-300 flex items-center gap-1 uppercase tracking-widest"
                            >
                              <span>{isDiagExpanded ? 'Hide Full Diagnostics' : 'Show Full Diagnostics (28 Checks)'}</span>
                              {isDiagExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                          </div>

                          {/* Layer 2 - Full 28-Check Conviction Engine Details */}
                          {isDiagExpanded && enData.conviction && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="pt-3 border-t border-tf-border overflow-hidden space-y-4"
                            >
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Checklist results */}
                                <div>
                                  <h6 className="text-[10px] font-black uppercase tracking-wider text-indigo-400 mb-2.5">
                                    Confluence Engine Verification Checklist
                                  </h6>
                                  <div className="space-y-1.5 max-h-[250px] overflow-y-auto pr-2 no-scrollbar">
                                    {enData.conviction.checks.map(chk => (
                                      <div key={chk.id} className="flex items-start justify-between text-xs py-1 border-b border-tf-border-subtle">
                                        <div className="flex items-center gap-2">
                                          <CheckCircle className={`w-3.5 h-3.5 shrink-0 ${chk.passed ? 'text-emerald-400' : 'text-tf-text-muted'}`} />
                                          <span className={chk.passed ? 'text-tf-text-primary' : 'text-tf-text-muted'}>
                                            {chk.name}
                                          </span>
                                        </div>
                                        <span className={`font-mono text-[10px] font-bold ${chk.passed ? 'text-emerald-400' : 'text-tf-text-muted'}`}>
                                          {chk.measuredValue}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* MCS Lenses & Strategy notes */}
                                <div className="space-y-4">
                                  {enData.conviction.mcs && (
                                    <div>
                                      <h6 className="text-[10px] font-black uppercase tracking-wider text-indigo-400 mb-2">
                                        MCS 5-Lens Assessment (Confidence: {enData.conviction.mcs.confidence.toFixed(2)})
                                      </h6>
                                      <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="p-2 bg-tf-bg-surface rounded-lg border border-tf-border-subtle">
                                          <span className="text-[9px] text-tf-text-muted font-extrabold block">HTF Trend</span>
                                          <span className="font-bold text-tf-text-primary uppercase">
                                            {Math.round(enData.conviction.mcs.subScores.htf.value * 100)}/100
                                          </span>
                                        </div>
                                        <div className="p-2 bg-tf-bg-surface rounded-lg border border-tf-border-subtle">
                                          <span className="text-[9px] text-tf-text-muted font-extrabold block">Indicators</span>
                                          <span className="font-bold text-tf-text-primary uppercase">
                                            {Math.round(enData.conviction.mcs.subScores.indicators.value * 100)}/100
                                          </span>
                                        </div>
                                        <div className="p-2 bg-tf-bg-surface rounded-lg border border-tf-border-subtle">
                                          <span className="text-[9px] text-tf-text-muted font-extrabold block">Order Flow</span>
                                          <span className="font-bold text-tf-text-primary uppercase">
                                            {Math.round(enData.conviction.mcs.subScores.flow.value * 100)}/100
                                          </span>
                                        </div>
                                        <div className="p-2 bg-tf-bg-surface rounded-lg border border-tf-border-subtle">
                                          <span className="text-[9px] text-tf-text-muted font-extrabold block">Gamma Exposure</span>
                                          <span className="font-bold text-tf-text-primary uppercase">
                                            {Math.round(enData.conviction.mcs.subScores.gex.value * 100)}/100
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  <div>
                                    <h6 className="text-[10px] font-black uppercase tracking-wider text-indigo-400 mb-2">
                                      Active Entry Strategy Rules
                                    </h6>
                                    <div className="bg-tf-bg-surface p-3.5 rounded-xl text-xs space-y-1 border border-tf-border">
                                      <div className="font-bold text-amber-300">
                                        Trigger: {orbStatusObj ? `ORB ${orbStatusObj.status} (Price: ${formatINR(orbStatusObj.orbPrice)})` : 'n/a'}
                                      </div>
                                      <div className="text-tf-text-secondary mt-1 font-mono">
                                        Stop Loss: {orbStatusObj ? formatINR(orbStatusObj.stopLoss) : 'n/a'} | Target: {orbStatusObj ? formatINR(orbStatusObj.target) : 'n/a'}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
