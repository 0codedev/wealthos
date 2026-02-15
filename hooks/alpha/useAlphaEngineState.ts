import { useState, useMemo, useRef, useEffect } from 'react';
import { fetchCoordinator } from '../../lib/fetchCoordinator';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';
import { ShadowScreenerService, ResultsCalendarItem, ShareholdingActivityItem, QualityScoreItem, LotSizeItem, FiiDiiFlowsItem, ParticipantOiItem, DerivativeSummaryItem, calculateOwnershipScore } from '../../services/alpha/ShadowScreenerService';
import { ConvergenceEngine, ScoredStock } from '../../services/alpha/ConvergenceEngine';
import { getSignal } from '../../services/alpha/StrategyEngine';
import { isAlphaActiveHours } from '../../types/trust';
import { alphaEngineService } from '../../services/AlphaEngineService';
import { VerdictEngine } from '../../services/alpha/VerdictEngine';
import { FNO_STOCKS } from '../../data/fno_stocks';
import { bulkPrefetchHistoricalCandles, clearTimeOfDayRvolCache } from '../../services/IntradayCandleService';
import { snapshotService } from '../../services/SnapshotService';

import { db } from '../../database';
import { useToast } from '../../components/shared/ToastProvider';
import { CONDITIONS } from '../../components/alpha/indicator_constants';
import { STRATEGY_CONFIGS } from '../../services/alpha/StrategyEngine';
import { useSettingsStore } from '../../store/settingsStore';

// Redirect all session cache storage to localStorage for maximum persistence across sessions (scalar settings)
const sessionStorage = typeof window !== 'undefined'
  ? window.localStorage
  : { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} } as any;

// Helper to write to Dexie cache table
async function setDbCache(key: string, data: any) {
  try {
    const existing = await db.cache.where('key').equals(key).first();
    const entry = {
      key,
      data,
      timestamp: Date.now(),
      ttl: 30 * 24 * 60 * 60 * 1000 // 30 days TTL
    };
    if (existing?.id) {
      await db.cache.update(existing.id, entry);
    } else {
      await db.cache.add(entry);
    }
  } catch (err) {
    console.error(`Failed to save key ${key} to IndexedDB cache:`, err);
  }
}

// Derive symbol-to-condition list mapping
function deriveIndicatorMatches(caches: Record<string, string[]>): Record<string, string[]> {
  const matches: Record<string, string[]> = {};
  for (const [conditionId, symbols] of Object.entries(caches)) {
    if (Array.isArray(symbols)) {
      symbols.forEach(sym => {
        const uppercaseSym = sym.toUpperCase();
        if (!matches[uppercaseSym]) {
          matches[uppercaseSym] = [];
        }
        if (!matches[uppercaseSym].includes(conditionId)) {
          matches[uppercaseSym].push(conditionId);
        }
      });
    }
  }
  return matches;
}

// Helper to read from Dexie cache table
async function getDbCache(key: string): Promise<any | null> {
  try {
    const entry = await db.cache.where('key').equals(key).first();
    if (entry) {
      return entry.data;
    }
  } catch (err) {
    console.error(`Failed to read key ${key} from IndexedDB cache:`, err);
  }
  return null;
}


export interface StockData {
  Symbol: string;
  LTP: number;
  Change: number;
  "Strength Factor": number;
  CapCategory?: string;
  Volume?: number;
  Open?: number;
  High?: number;
  Low?: number;
  Close?: number;
  CompanyName?: string;
  Sector?: string;
  MarketCap?: number;
  PE?: number;
  Dividend?: number;
  prevClose?: number;
  todayOpen?: number;
  ownership_momentum_score?: number;
  timeOfDayRvol?: number | null;
}

export interface AdvancedFilters {
  applyToRowView: boolean;
  applyToCardView: boolean;
  minRvol: number | null;
  maxRvol: number | null;
  minVolume: number | null;
  maxVolume: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minChange: number | null;
  maxChange: number | null;
  minScore: number | null;
  maxScore: number | null;
  minMcap: number | null;
  maxMcap: number | null;
  minTurnover: number | null;
  maxTurnover: number | null;
  minIntradayRange: number | null;
  maxIntradayRange: number | null;
  minOpenToLtp: number | null;
  maxOpenToLtp: number | null;
  minOpeningGap: number | null;
  maxOpeningGap: number | null;
  maxDistanceToHOD: number | null;
  maxDistanceToLOD: number | null;
  sectors: string[];
  capCategories: string[]; // 'Large', 'Mid', 'Small'
  excludePennyTraps: boolean;
  showOnlyPositiveOwnership: boolean;
  nearUpperCircuit: boolean;
  openEqualsLow: boolean;
  openEqualsHigh: boolean;
  batchScanLimit: number;
}

// --- SESSION CACHE KEYS ---
export const CACHE_MASTER = 'alpha_cache_master';
export const CACHE_PULSE = 'alpha_cache_pulse';
export const CACHE_CATEGORIZED = 'alpha_cache_pulse_categorized';
export const CACHE_CANDLE_DAILY = 'alpha_cache_candle_daily';
export const CACHE_CANDLE_WEEKLY = 'alpha_cache_candle_weekly';
export const CACHE_HISTORICAL = 'alpha_cache_historical';
export const CACHE_ORB = 'alpha_cache_orb';
export const CACHE_VALUATION = 'alpha_cache_valuation';
export const CACHE_SHADOW_MODE = 'alpha_cache_shadow_mode';
export const CACHE_SELECTED_PATTERN = 'alpha_cache_selected_pattern';
export const CACHE_CANDLE_TF = 'alpha_cache_candle_tf';
export const CACHE_HIST_TYPE = 'alpha_cache_hist_type';
export const CACHE_HIST_TF = 'alpha_cache_hist_tf';
export const CACHE_ORB_MINS = 'alpha_cache_orb_mins';
export const CACHE_ORB_PRB = 'alpha_cache_orb_prb';
export const CACHE_VAL_TYPE = 'alpha_cache_val_type';
export const CACHE_INTRA_MODE = 'alpha_cache_intra_mode';
export const CACHE_ENGINE_MODE = 'alpha_cache_engine_mode';
export const CACHE_SHAREHOLDING_TRANS = 'alpha_cache_shareholding_trans';
export const CACHE_QUALITY = 'alpha_cache_quality';
export const CACHE_QUALITY_TYPE = 'alpha_cache_quality_type';
export const CACHE_QUALITY_FILTER = 'alpha_cache_quality_filter';
export const CACHE_CONVERGENCE_RESULTS = 'alpha_cache_convergence_results';
export const CACHE_CONVERGENCE_DIR = 'alpha_cache_convergence_dir';
export const CACHE_CONVERGENCE_MODE = 'alpha_cache_convergence_mode';
export const CACHE_RESULTS_CALENDAR = 'alpha_cache_results_calendar';
export const CACHE_SHAREHOLDING = 'alpha_cache_shareholding';
export const CACHE_SHAREHOLDING_INVESTOR = 'alpha_cache_shareholding_investor';
export const CACHE_BOOSTER = 'alpha_cache_booster';
export const CACHE_BOOSTER_TREND = 'alpha_cache_booster_trend';
export const CACHE_LOT_SIZE = 'alpha_cache_lot_size';
export const CACHE_FII_DII_PULSE = 'alpha_cache_fii_dii_pulse';
export const CACHE_PARTICIPANT_OI = 'alpha_cache_participant_oi';
export const CACHE_DERIVATIVE_SUMMARY = 'alpha_cache_derivative_summary';
export const CACHE_VOLUME_AVERAGES = 'alpha_cache_volume_averages';

export const useAlphaEngineState = (activeSubTab: 'intraday' | 'screener' | 'heatmap' | 'market-command') => {
  const [isCacheLoading, setIsCacheLoading] = useState(true);
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);
  const { toast } = useToast();

  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(() => {
    const defaults = {
      applyToRowView: true,
      applyToCardView: true,
      minRvol: null,
      maxRvol: null,
      minVolume: null,
      maxVolume: null,
      minPrice: null,
      maxPrice: null,
      minChange: null,
      maxChange: null,
      minScore: null,
      maxScore: null,
      minMcap: null,
      maxMcap: null,
      minTurnover: null,
      maxTurnover: null,
      minIntradayRange: null,
      maxIntradayRange: null,
      minOpenToLtp: null,
      maxOpenToLtp: null,
      minOpeningGap: null,
      maxOpeningGap: null,
      maxDistanceToHOD: null,
      maxDistanceToLOD: null,
      sectors: [],
      capCategories: [],
      excludePennyTraps: true,
      showOnlyPositiveOwnership: false,
      nearUpperCircuit: false,
      openEqualsLow: false,
      openEqualsHigh: false,
      batchScanLimit: 500,
    };
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('alpha_advanced_filters');
      if (saved) {
        try {
          return { ...defaults, ...JSON.parse(saved) };
        } catch (e) {
          console.error('Failed to parse saved advanced filters:', e);
        }
      }
    }
    return defaults;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('alpha_advanced_filters', JSON.stringify(advancedFilters));
    }
  }, [advancedFilters]);

  const [volumeAverages, setVolumeAverages] = useState<Record<string, number>>({});

  // PCR Gate & FII Macro Bias state variables
  const [pcrGate, setPcrGate] = useState<'BULLISH' | 'NEUTRAL' | 'BEARISH'>('NEUTRAL');
  const [pcrValue, setPcrValue] = useState<number>(1.0);
  const [macroBias, setMacroBias] = useState<'STRONG_BULLISH' | 'HEDGED' | 'NEUTRAL' | 'DISTRIBUTION'>('NEUTRAL');
  const [fiiCashNet, setFiiCashNet] = useState<number>(0);
  const [isFetchingMacroAndPcr, setIsFetchingMacroAndPcr] = useState(false);

  // New Alpha Signal Maps
  const [oreMap, setOreMap] = useState<Record<string, any>>({});
  const [cvdMap, setCvdMap] = useState<Record<string, number>>({});
  const [rsMap, setRsMap] = useState<Record<string, any>>({});
  const [patternMap, setPatternMap] = useState<Record<string, any>>({});
  const [shareholdingMap, setShareholdingMap] = useState<Record<string, any>>({});
  const [isFetchingAlphaSignals, setIsFetchingAlphaSignals] = useState(false);

  const fetchMacroAndPcr = async () => {
    try {
      setIsFetchingMacroAndPcr(true);
      const gate = await alphaEngineService.fetchPCRGate();
      const val = alphaEngineService.getPCRValue();
      const bias = await alphaEngineService.fetchMacroBias();
      const net = alphaEngineService.getFiiCashNet();
      setPcrGate(gate);
      setPcrValue(val);
      setMacroBias(bias);
      setFiiCashNet(net);
    } catch (e) {
      console.error('Failed to fetch PCR/Macro bias:', e);
    } finally {
      setIsFetchingMacroAndPcr(false);
    }
  };

  // Alpha Cadence setting
  const alphaRefreshInterval = useSettingsStore(s => s.alphaRefreshInterval);

  const fetchAlphaSignals = async () => {
    try {
      setIsFetchingAlphaSignals(true);
      
      // Parallelize all 5 signal endpoint queries
      const [ores, cvds, rsRanks, response, velocities] = await Promise.all([
        alphaEngineService.fetchOREAll().catch(() => []),
        alphaEngineService.fetchCVDBulk().catch(() => ({})),
        alphaEngineService.fetchRSRankAll().catch(() => []),
        alphaEngineService.fetchPatternScanAll().catch(() => null),
        alphaEngineService.fetchShareholdingVelocityAll().catch(() => [])
      ]);

      const newOreMap: Record<string, any> = {};
      if (Array.isArray(ores)) {
        ores.forEach(o => {
          if (o.symbol) newOreMap[o.symbol.toUpperCase()] = o;
        });
      }

      const newCvdMap: Record<string, number> = {};
      if (cvds && typeof cvds === 'object') {
        Object.entries(cvds).forEach(([k, v]) => {
          newCvdMap[k.toUpperCase()] = Number(v) || 0;
        });
      }

      const newRsMap: Record<string, any> = {};
      if (Array.isArray(rsRanks)) {
        rsRanks.forEach(r => {
          if (r.symbol) newRsMap[r.symbol.toUpperCase()] = r;
        });
      }

      const newPatternMap: Record<string, any> = {};
      if (response && Array.isArray(response.data)) {
        response.data.forEach(p => {
          if (p.symbol) newPatternMap[p.symbol.toUpperCase()] = p;
        });
      }



      const newShareholdingMap: Record<string, any> = {};
      if (Array.isArray(velocities)) {
        velocities.forEach(v => {
          if (v.symbol) newShareholdingMap[v.symbol.toUpperCase()] = v;
        });
      }

      // Batch set all signal maps together
      setOreMap(newOreMap);
      setCvdMap(newCvdMap);
      setRsMap(newRsMap);
      setPatternMap(newPatternMap);
      setShareholdingMap(newShareholdingMap);
    } catch (e) {
      console.error('Failed to fetch Alpha signals:', e);
    } finally {
      setIsFetchingAlphaSignals(false);
    }
  };

  const triggerAllAlphaScans = async () => {
    try {
      const limit = advancedFilters.batchScanLimit ?? 500;
      
      const fnoSymbols = new Set(FNO_STOCKS.map(x => x.symbol.toUpperCase()));
      let listToScan = masterStocks;
      if (intraMode === 'fno') {
        listToScan = listToScan.filter(s => fnoSymbols.has(s.Symbol.toUpperCase()));
      } else if (intraMode === 'cash') {
        listToScan = listToScan.filter(s => !fnoSymbols.has(s.Symbol.toUpperCase()));
      }

      // Sort master stocks to get the best/most active ones for the batch scans
      const sortedForScans = [...listToScan].sort((a, b) => {
        // Compute daily turnover as Volume * LTP
        const aTurnover = (a.Volume || 0) * (a.LTP || 0);
        const bTurnover = (b.Volume || 0) * (b.LTP || 0);
        
        // Let's also factor in MarketCap (₹ Cr)
        const aMcap = a.MarketCap || 0;
        const bMcap = b.MarketCap || 0;

        // A hybrid ranking score: 70% turnover weight + 30% MarketCap weight
        // Normalized roughly: turnover in Lakhs + MarketCap in Cr
        const aScore = (aTurnover / 100000) * 0.7 + aMcap * 0.3;
        const bScore = (bTurnover / 100000) * 0.7 + bMcap * 0.3;

        return bScore - aScore;
      });

      const symbols = sortedForScans.map(s => s.Symbol).slice(0, limit);
      if (symbols.length === 0) return;
      
      console.log('Triggering background batch scans for top', symbols.length, 'symbols sorted by liquidity/cap...');
      await alphaEngineService.triggerOREBatch(symbols);
      await alphaEngineService.triggerRSRankSync(symbols);
      await alphaEngineService.triggerPatternScan(symbols);
      await alphaEngineService.triggerShareholdingSync(symbols);
      
      setTimeout(() => {
        fetchAlphaSignals();
      }, 5000);
      setTimeout(() => {
        fetchAlphaSignals();
      }, 15000);
    } catch (e) {
      console.error('Failed to trigger background scans:', e);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadVolumeAverages = async () => {
      try {
        const data = await fetchCoordinator.dedupedFetch('upstox-volume-avg', async () => {
          const res = await fetch('/api/python-nse/api/upstox/historical/volume-avg/all');
          if (!res.ok) throw new Error(`Status ${res.status}`);
          return res.json();
        }, 12 * 60 * 60 * 1000); // 12 hours TTL
        
        const transformed: Record<string, number> = {};
        if (data) {
          for (const [sym, entry] of Object.entries(data)) {
            if (entry && typeof entry === 'object') {
              transformed[sym] = (entry as any).avg_volume_20d || 0;
            } else {
              transformed[sym] = Number(entry) || 0;
            }
          }
        }
        setVolumeAverages(prev => ({ ...transformed, ...prev }));
      } catch (err) {
        console.error('Failed to load volume averages in hook:', err);
      }
    };
    loadVolumeAverages();
    fetchMacroAndPcr();
    fetchAlphaSignals();
  }, []);

  // Restore from sessionStorage so tab-switching doesn't wipe data
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [masterStocks, setMasterStocks] = useState<StockData[]>([]);
  const [isPasting, setIsPasting] = useState(false);
  const [error, setError] = useState('');
  const [isSniperActive, setIsSniperActive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [engineMode, setEngineMode] = useState<'raw' | 'sector_booster' | 'pulse'>(() => (sessionStorage.getItem(CACHE_ENGINE_MODE) as any) || 'raw');
  const [pulseStocks, setPulseStocks] = useState<StockData[]>([]);
  const [pulseCategorized, setPulseCategorized] = useState<Record<string, StockData[]>>({});
  const [showCorsGuide, setShowCorsGuide] = useState(false);
  const [corsGuideSource, setCorsGuideSource] = useState<'cash' | 'stockezee'>('cash');
  // StockeZee JWT token — paste once, valid ~30 days
  const [stockezeeToken, setStockezeeToken] = useState(() => localStorage.getItem('stockezee_token') || '');

  const [intraMode, setIntraMode] = useState<'cash' | 'fno'>(() => (sessionStorage.getItem(CACHE_INTRA_MODE) as any) || 'cash');
  const isVisible = usePageVisibility();

  // --- FNO SCANNER STATE (ORIGINAL) ---
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState<any | null>(null);
  const [isAutoRefresh, setIsAutoRefresh] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const isManualRefreshPending = useRef(false);
  const [isBridgeConfigOpen, setIsBridgeConfigOpen] = useState(false);
  const [bridgeCode, setBridgeCode] = useState(() => localStorage.getItem('alpha_bridge_code') || '');
  const [sectorBridgeCode, setSectorBridgeCode] = useState(() => localStorage.getItem('alpha_bridge_sector_code') || '');
  const [pulseBridgeCode, setPulseBridgeCode] = useState(() => localStorage.getItem('alpha_bridge_pulse_code') || '');

  const [pulseFilter, setPulseFilter] = useState<'top_gainers' | 'top_losers' | 'open_low' | 'open_high' | 'gap_up' | 'gap_down'>('top_gainers');
  const [activeBridgeTab, setActiveBridgeTab] = useState<'master' | 'pulse' | 'token'>('token');

  // --- STOCKEZEE INTRADAY BOOSTER STATE ---
  const [boosterStocksList, setBoosterStocksList] = useState<any[]>([]);
  const [boosterTrend, setBoosterTrend] = useState<'bullish' | 'bearish'>(() => (sessionStorage.getItem(CACHE_BOOSTER_TREND) as any) || 'bullish');
  const [isFetchingBoosterScanner, setIsFetchingBoosterScanner] = useState(false);

  // Shadow Screener Sub-Tabs
  const [shadowMode, setShadowMode] = useState<'all' | 'candlestick' | 'orb' | 'gainers' | 'valuation' | 'convergence' | 'results' | 'shareholding' | 'quality' | 'momentum' | 'fno_movements' | 'lot_size' | 'fii_dii_pulse' | 'delivery_radar' | 'insider_intelligence' | 'mf_flows' | 'order_flow' | 'oi_command_center' | 'smart_watchlist' | 'tech_indicators_screener' | 'smartlist_radar' | 'snapshot_timeline'>(() => (sessionStorage.getItem(CACHE_SHADOW_MODE) as any) || 'all');

  // --- FII/DII Sentiment & Radar State ---
  const [fiiDiiPulseData, setFiiDiiPulseData] = useState<FiiDiiFlowsItem[]>([]);
  const [participantOiData, setParticipantOiData] = useState<ParticipantOiItem[]>([]);
  const [derivativeSummaryData, setDerivativeSummaryData] = useState<DerivativeSummaryItem[]>([]);
  const [isFetchingFiiDiiPulse, setIsFetchingFiiDiiPulse] = useState(false);
  const [isFetchingOi, setIsFetchingOi] = useState(false);
  const [isFetchingSummary, setIsFetchingSummary] = useState(false);

  const [selectedCandlePattern, setSelectedCandlePattern] = useState<string>(() => sessionStorage.getItem(CACHE_SELECTED_PATTERN) || '');
  const [dailyCandleData, setDailyCandleData] = useState<any>(null);
  const [weeklyCandleData, setWeeklyCandleData] = useState<any>(null);
  const [isFetchingCandles, setIsFetchingCandles] = useState(false);
  const [candleTimeframe, setCandleTimeframe] = useState<'daily' | 'weekly'>(() => (sessionStorage.getItem(CACHE_CANDLE_TF) as any) || 'daily');

  // Historical Performance State
  const [historicalDataCache, setHistoricalDataCache] = useState<Record<string, any>>({});
  const [historicalTimeframe, setHistoricalTimeframe] = useState<'day' | 'week' | 'month' | 'year'>(() => (sessionStorage.getItem(CACHE_HIST_TF) as any) || 'day');
  const [historicalType, setHistoricalType] = useState<'gainers' | 'loosers'>(() => (sessionStorage.getItem(CACHE_HIST_TYPE) as any) || 'gainers');
  const [isFetchingHistorical, setIsFetchingHistorical] = useState(false);

  // ORB State
  const [orbDataCache, setOrbDataCache] = useState<Record<string, any>>({});
  const [orbMinutes, setOrbMinutes] = useState<15 | 30 | 45 | 60>(() => parseInt(sessionStorage.getItem(CACHE_ORB_MINS) || '15') as any);
  const [orbWithPrb, setOrbWithPrb] = useState(() => sessionStorage.getItem(CACHE_ORB_PRB) !== 'false');
  const [isFetchingORB, setIsFetchingORB] = useState(false);

  // Valuation State
  const [valuationDataCache, setValuationDataCache] = useState<Record<string, any>>({});
  const [valuationType, setValuationType] = useState<'over_valued' | 'under_valued'>(() => (sessionStorage.getItem(CACHE_VAL_TYPE) as any) || 'under_valued');
  const [isFetchingValuation, setIsFetchingValuation] = useState(false);

  // Results Calendar State
  const [resultsCalendarData, setResultsCalendarData] = useState<ResultsCalendarItem[]>([]);
  const [isFetchingResults, setIsFetchingResults] = useState(false);

  // F&O Lot Sizes State
  const [lotSizesData, setLotSizesData] = useState<LotSizeItem[]>([]);
  const [isFetchingLotSizes, setIsFetchingLotSizes] = useState(false);

  // Shareholding Radar State
  const [shareholdingDataCache, setShareholdingDataCache] = useState<Record<string, ShareholdingActivityItem[]>>({});
  const [shareholdingInvestor, setShareholdingInvestor] = useState<'fii' | 'promoter'>(() => (sessionStorage.getItem(CACHE_SHAREHOLDING_INVESTOR) as any) || 'fii');
  const [shareholdingTrans, setShareholdingTrans] = useState<'buy' | 'sell'>(() => (sessionStorage.getItem(CACHE_SHAREHOLDING_TRANS) as any) || 'buy');
  const [isFetchingShareholding, setIsFetchingShareholding] = useState(false);

  // Quality Scorecard State
  const [qualityDataCache, setQualityDataCache] = useState<Record<string, QualityScoreItem[]>>({});
  const [qualityScoreType, setQualityScoreType] = useState<string>(() => sessionStorage.getItem(CACHE_QUALITY_TYPE) || 'total_score');
  const [qualityFilter, setQualityFilter] = useState<'high' | 'low'>(() => (sessionStorage.getItem(CACHE_QUALITY_FILTER) as any) || 'high');
  const [isFetchingQuality, setIsFetchingQuality] = useState(false);

  // Fetch States (Consolidated)
  const [isFetchingLive, setIsFetchingLive] = useState(false);
  const [isFetchingPulse, setIsFetchingPulse] = useState(false);
  const [isFetchingSectors, setIsFetchingSectors] = useState(false);
  const [isFetchingBooster, setIsFetchingBooster] = useState(false);

  // Sector Matrix Live State
  const [sectorTimeframe, setSectorTimeframe] = useState<'day' | '1m' | '3m' | '6m' | '1y' | '3y' | '5y' | '7y' | '10y'>('day');
  const [sectorRawData, setSectorRawData] = useState<any[]>([]);
  const [sectors, setSectors] = useState<{ name: string, change: number, price: number, symbol: string, marketCap: number, timeframe?: string }[]>([]);

  // Sector Booster Drill-Down State
  const [activeDrillSector, setActiveDrillSector] = useState<string | null>(null);

  // Convergence Engine State
  const [convergenceResults, setConvergenceResults] = useState<ScoredStock[]>([]);
  const [isScanningConvergence, setIsScanningConvergence] = useState(false);
  const [isConvergenceWorkerBusy, setIsConvergenceWorkerBusy] = useState(false);
  const [convergenceDirection, setConvergenceDirection] = useState<'bullish' | 'bearish' | 'both'>(() => (sessionStorage.getItem(CACHE_CONVERGENCE_DIR) as any) || 'both');
  const [convergenceMode, setConvergenceMode] = useState<'intraday' | 'swing'>(() => (sessionStorage.getItem(CACHE_CONVERGENCE_MODE) as any) || 'intraday');

  const [boosterRawData, setBoosterRawData] = useState<any[]>([]);
  const [boosterStocks, setBoosterStocks] = useState<{ name: string, change: number, price: number, symbol: string, marketCap: number, timeframe?: string, score?: number }[]>([]);

  // --- TECHNICAL INDICATORS SCREENER STATE ---
  const [prebuildScreens, setPrebuildScreens] = useState<Record<string, any> | null>(null);
  const [selectedIndicator, setSelectedIndicator] = useState<string>('ema');
  const [selectedCondition, setSelectedCondition] = useState<string>('close_cross_above_5_ema');
  const [indicatorScreenerData, setIndicatorScreenerData] = useState<any[]>([]);
  const [screenerLoading, setScreenerLoading] = useState<boolean>(false);
  const [isWarmingIndicators, setIsWarmingIndicators] = useState(false);
  const [warmingIndicatorStep, setWarmingIndicatorStep] = useState(0);
  const [warmingIndicatorLabel, setWarmingIndicatorLabel] = useState('');
  const [indicatorMatches, setIndicatorMatches] = useState<Record<string, string[]>>({});

  // Filter & Search States
  const [filterType, setFilterType] = useState<'all' | 'momentum' | 'value' | 'breakout' | 'oversold' | 'high_volume' | 'low_pe' | 'mid_large_cap' | 'screener_override' | 'inst_grade' | 'footprint_confirmed'>('all');

  // Check for screener filter override on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const override = window.sessionStorage.getItem('alpha_screener_filter_override');
      if (override) {
        setFilterType('screener_override');
      }
    }
  }, []);

  // Check for search prefill on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const prefill = window.sessionStorage.getItem('alpha_search_prefill');
      if (prefill) {
        setSearchTerm(prefill);
        window.sessionStorage.removeItem('alpha_search_prefill');
      }
    }
  }, []);

  // Listen for multi-device token restore events
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleTokenRestored = (e: any) => {
      const newToken = e.detail || localStorage.getItem('stockezee_token');
      if (newToken) {
        setStockezeeToken(newToken);
      }
    };
    window.addEventListener('wealthos-stockezee-token-restored', handleTokenRestored);
    return () => {
      window.removeEventListener('wealthos-stockezee-token-restored', handleTokenRestored);
    };
  }, []);

  // Background Morning Sync States
  const [perfectConvergenceAlerts, setPerfectConvergenceAlerts] = useState<number>(() => {
    return parseInt(sessionStorage.getItem('alpha_convergence_alert') || '0', 10);
  });

  // --- MEMOIZED DATA (HOOKS) ---
  const applyAdvancedFiltersToList = (list: StockData[], filters: AdvancedFilters, forRowView: boolean) => {
    const isTargetActive = forRowView ? filters.applyToRowView : filters.applyToCardView;
    if (!isTargetActive) return list;

    return list.filter(stock => {
      const ltp = stock.LTP || 0;
      const vol = stock.Volume || 0;
      const change = stock.Change || 0;
      const score = stock["Strength Factor"] || 0;
      const mcap = stock.MarketCap || 0;
      const sector = stock.Sector || '';
      const cap = stock.CapCategory || '';
      const adv = volumeAverages[stock.Symbol] || 0;
      const rvol = stock.timeOfDayRvol ?? (adv > 0 ? vol / adv : null);

      // 1. Exclude Penny Traps
      if (filters.excludePennyTraps) {
        const turnover = ltp * vol;
        const isSmall = cap === 'Small' || (!['Large', 'Mid'].includes(cap));
        if (vol > 0 && vol < 50000) return false;
        if (turnover > 0 && turnover < 2500000) return false;
        if (isSmall && vol > 0 && vol < 100000) return false;
        if (stock.Symbol.includes('-BE') || stock.Symbol.includes('-BZ') || stock.Symbol.includes('-Z')) return false;
      }

      // 2. Numeric Ranges
      if (filters.minPrice !== null && ltp < filters.minPrice) return false;
      if (filters.maxPrice !== null && ltp > filters.maxPrice) return false;
      
      if (filters.minVolume !== null && vol < filters.minVolume) return false;
      if (filters.maxVolume !== null && vol > filters.maxVolume) return false;

      if (filters.minChange !== null && change < filters.minChange) return false;
      if (filters.maxChange !== null && change > filters.maxChange) return false;

      if (filters.minScore !== null && score < filters.minScore) return false;
      if (filters.maxScore !== null && score > filters.maxScore) return false;

      if (filters.minMcap !== null && mcap < filters.minMcap) return false;
      if (filters.maxMcap !== null && mcap > filters.maxMcap) return false;

      if (filters.minRvol !== null) {
        if (rvol === null || rvol < filters.minRvol) return false;
      }
      if (filters.maxRvol !== null) {
        if (rvol === null || rvol > filters.maxRvol) return false;
      }

      // Turnover (LTP * Volume) / 100,000 to get in Lakhs
      const turnoverLakhs = (ltp * vol) / 100000;
      if (filters.minTurnover !== null && turnoverLakhs < filters.minTurnover) return false;
      if (filters.maxTurnover !== null && turnoverLakhs > filters.maxTurnover) return false;

      // Intraday Spread / Range ((High - Low) / Low * 100)
      const high = stock.High || 0;
      const low = stock.Low || 0;
      const intradayRange = low > 0 ? ((high - low) / low) * 100 : 0;
      if (filters.minIntradayRange !== null && (low <= 0 || intradayRange < filters.minIntradayRange)) return false;
      if (filters.maxIntradayRange !== null && (low <= 0 || intradayRange > filters.maxIntradayRange)) return false;

      // Open-to-LTP change ((LTP - Open) / Open * 100)
      const open = stock.Open || stock.todayOpen || 0;
      const openToLtp = open > 0 ? ((ltp - open) / open) * 100 : 0;
      if (filters.minOpenToLtp !== null && (open <= 0 || openToLtp < filters.minOpenToLtp)) return false;
      if (filters.maxOpenToLtp !== null && (open <= 0 || openToLtp > filters.maxOpenToLtp)) return false;

      // Opening Gap ((Open - prevClose) / prevClose * 100)
      const prevClose = stock.prevClose || 0;
      const openingGap = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
      if (filters.minOpeningGap !== null && (prevClose <= 0 || openingGap < filters.minOpeningGap)) return false;
      if (filters.maxOpeningGap !== null && (prevClose <= 0 || openingGap > filters.maxOpeningGap)) return false;

      // Day Extreme Proximity (%)
      // Distance to Day High: (High - LTP) / LTP * 100
      const distToHOD = ltp > 0 ? ((high - ltp) / ltp) * 100 : 0;
      if (filters.maxDistanceToHOD !== null && (ltp <= 0 || high <= 0 || distToHOD > filters.maxDistanceToHOD)) return false;

      // Distance to Day Low: (LTP - Low) / Low * 100
      const distToLOD = low > 0 ? ((ltp - low) / low) * 100 : 0;
      if (filters.maxDistanceToLOD !== null && (ltp <= 0 || low <= 0 || distToLOD > filters.maxDistanceToLOD)) return false;

      // 3. Category selectors
      if (filters.sectors.length > 0) {
        if (!sector || !filters.sectors.includes(sector.toUpperCase())) return false;
      }
      if (filters.capCategories.length > 0) {
        if (!cap || !filters.capCategories.includes(cap)) return false;
      }

      // 4. Custom Toggles
      if (filters.showOnlyPositiveOwnership) {
        if ((stock.ownership_momentum_score || 0) <= 0) return false;
      }

      if (filters.nearUpperCircuit) {
        const prevCloseVal = stock.prevClose || stock.Open || ltp;
        const ucPrice = prevCloseVal * 1.20;
        const ucDistance = ((ucPrice - ltp) / ltp) * 100;
        if (ucDistance > 2.0) return false;
      }

      if (filters.openEqualsLow) {
        const openVal = stock.Open || stock.todayOpen || 0;
        const lowVal = stock.Low || 0;
        if (openVal <= 0 || openVal !== lowVal) return false;
      }

      if (filters.openEqualsHigh) {
        const openVal = stock.Open || stock.todayOpen || 0;
        const highVal = stock.High || 0;
        if (openVal <= 0 || openVal !== highVal) return false;
      }

      return true;
    });
  };

  const oiSignalMap = useMemo(() => {
    const map: Record<string, 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWIND' | 'NEUTRAL'> = {};
    if (Array.isArray(derivativeSummaryData)) {
      derivativeSummaryData.forEach(item => {
        if (!item.symbol_name) return;
        const sym = item.symbol_name.toUpperCase();
        let sig: 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWIND' | 'NEUTRAL' = 'NEUTRAL';
        if (item.built_up === 'long_build_up') sig = 'LONG_BUILDUP';
        else if (item.built_up === 'short_covering') sig = 'SHORT_COVERING';
        else if (item.built_up === 'short_build_up') sig = 'SHORT_BUILDUP';
        else if (item.built_up === 'long_unwinding') sig = 'LONG_UNWIND';
        map[sym] = sig;
      });
    }
    return map;
  }, [derivativeSummaryData]);

  const activeDataSource = useMemo(() => {
    let base = (intraMode === 'fno' && engineMode === 'pulse') ? pulseStocks : stocks;
    const fnoSymbols = new Set(FNO_STOCKS.map(x => x.symbol.toUpperCase()));
    if (intraMode === 'fno') {
      base = base.filter(s => fnoSymbols.has(s.Symbol.toUpperCase()));
    } else if (intraMode === 'cash') {
      base = base.filter(s => !fnoSymbols.has(s.Symbol.toUpperCase()));
    }
    return base;
  }, [intraMode, engineMode, pulseStocks, stocks]);

  const pulseFilteredData = useMemo(() => {
    if (intraMode !== 'fno' || engineMode !== 'pulse') return stocks;
    if (pulseCategorized[pulseFilter]) {
      let list = pulseCategorized[pulseFilter];
      if (pulseFilter === 'top_gainers' || pulseFilter === 'gap_up' || pulseFilter === 'open_low') {
        return [...list].sort((a, b) => b.Change - a.Change);
      }
      return [...list].sort((a, b) => a.Change - b.Change);
    }
    let base = [...pulseStocks];
    if (base.length === 0) return [];
    switch (pulseFilter) {
      case 'top_gainers': return base.filter(s => s.Change > 0).sort((a, b) => b.Change - a.Change);
      case 'top_losers': return base.filter(s => s.Change < 0).sort((a, b) => a.Change - b.Change);
      case 'open_low': return base.filter(s => { const sig = getSignal(s); return sig.isOpenLow; }).sort((a, b) => b.Change - a.Change);
      case 'open_high': return base.filter(s => { const sig = getSignal(s); return sig.isOpenHigh; }).sort((a, b) => a.Change - b.Change);
      case 'gap_up': return base.filter(s => { const sig = getSignal(s); return sig.isGapUp; }).sort((a, b) => b.Change - a.Change);
      case 'gap_down': return base.filter(s => { const sig = getSignal(s); return sig.isGapDown; }).sort((a, b) => a.Change - b.Change);
      default: return base;
    }
  }, [intraMode, pulseStocks, stocks, engineMode, pulseFilter, pulseCategorized]);

  const fnoMovementsFilteredData = useMemo(() => {
    if (pulseCategorized[pulseFilter]) {
      let list = pulseCategorized[pulseFilter];
      if (pulseFilter === 'top_gainers' || pulseFilter === 'gap_up' || pulseFilter === 'open_low') {
        return [...list].sort((a, b) => b.Change - a.Change);
      }
      return [...list].sort((a, b) => a.Change - b.Change);
    }
    let base = [...pulseStocks];
    if (base.length === 0) return [];
    switch (pulseFilter) {
      case 'top_gainers': return base.filter(s => s.Change > 0).sort((a, b) => b.Change - a.Change);
      case 'top_losers': return base.filter(s => s.Change < 0).sort((a, b) => a.Change - b.Change);
      case 'open_low': return base.filter(s => { const sig = getSignal(s); return sig.isOpenLow; }).sort((a, b) => b.Change - a.Change);
      case 'open_high': return base.filter(s => { const sig = getSignal(s); return sig.isOpenHigh; }).sort((a, b) => a.Change - b.Change);
      case 'gap_up': return base.filter(s => { const sig = getSignal(s); return sig.isGapUp; }).sort((a, b) => b.Change - a.Change);
      case 'gap_down': return base.filter(s => { const sig = getSignal(s); return sig.isGapDown; }).sort((a, b) => a.Change - b.Change);
      default: return base;
    }
  }, [pulseStocks, pulseFilter, pulseCategorized]);

  const fnoMovementsFiltered = useMemo(() => {
    return fnoMovementsFilteredData.filter(s => s.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [fnoMovementsFilteredData, searchTerm]);

  const filteredBoosterStocks = useMemo(() => {
    const fnoSymbols = new Set(FNO_STOCKS.map(x => x.symbol.toUpperCase()));
    let base = boosterStocksList;
    if (intraMode === 'fno') {
      base = base.filter(s => fnoSymbols.has(s.Symbol.toUpperCase()));
    } else if (intraMode === 'cash') {
      base = base.filter(s => !fnoSymbols.has(s.Symbol.toUpperCase()));
    }

    return base.filter(s => {
      const matchSearch = s.Symbol.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchSearch) return false;
      const targetTrend = boosterTrend === 'bullish' ? 'Bullish' : 'Bearish';
      return s.trend === targetTrend || s.sentiment === targetTrend;
    }).sort((a, b) => (b["Strength Factor"] || 0) - (a["Strength Factor"] || 0));
  }, [boosterStocksList, boosterTrend, searchTerm, intraMode]);

  const filteredStocks = useMemo(() => {
    let base = engineMode === 'pulse' ? pulseFilteredData : stocks;
    const fnoSymbols = new Set(FNO_STOCKS.map(x => x.symbol.toUpperCase()));
    if (intraMode === 'fno') {
      base = base.filter(s => fnoSymbols.has(s.Symbol.toUpperCase()));
    } else if (intraMode === 'cash') {
      base = base.filter(s => !fnoSymbols.has(s.Symbol.toUpperCase()));
    }

    const searchFiltered = base.filter(s => s.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
    return applyAdvancedFiltersToList(searchFiltered, advancedFilters, true);
  }, [pulseFilteredData, stocks, engineMode, searchTerm, advancedFilters, volumeAverages, intraMode]);

  const bullishStocks = useMemo(() => {
    return filteredStocks.filter(s => s.Change > 0).sort((a, b) => b["Strength Factor"] - a["Strength Factor"]);
  }, [filteredStocks]);

  const bearishStocks = useMemo(() => {
    return filteredStocks.filter(s => s.Change < 0).sort((a, b) => a["Strength Factor"] - b["Strength Factor"]);
  }, [filteredStocks]);

  const filteredByQuickType = useMemo(() => {
    let base = filteredStocks;
    switch (filterType) {
      case 'screener_override': {
        if (typeof window !== 'undefined') {
          const override = window.sessionStorage.getItem('alpha_screener_filter_override');
          if (override) {
            try {
              const symbols: string[] = JSON.parse(override);
              return base.filter(s => symbols.includes(s.Symbol.toUpperCase()));
            } catch (err) {
              console.error('Failed to parse alpha_screener_filter_override:', err);
            }
          }
        }
        return base;
      }
      case 'momentum': return base.filter(s => s.Change > 3 && s["Strength Factor"] > 100).sort((a, b) => b.Change - a.Change);
      case 'value': return base.filter(s => (s.PE ?? 0) > 0 && (s.PE ?? 0) < 20 && (s.Dividend ?? 0) > 1).sort((a, b) => (b.Dividend ?? 0) - (a.Dividend ?? 0));
      case 'breakout': return base.filter(s => (s.High ?? 0) > 0 && s.LTP >= (s.High ?? 0) * 0.98).sort((a, b) => b.Change - a.Change);
      case 'oversold': return base.filter(s => s.Change < -5).sort((a, b) => a.Change - b.Change);
      case 'high_volume': return base.filter(s => (s.Volume || 0) >= 100000).sort((a, b) => (b.Volume || 0) - (a.Volume || 0));
      case 'low_pe': return base.filter(s => (s.PE || 0) > 0 && (s.PE || 0) <= 25).sort((a, b) => (a.PE || 999) - (b.PE || 999));
      case 'mid_large_cap': return base.filter(s => {
        const cap = (s.CapCategory || '').toLowerCase();
        const mcap = s.MarketCap || 0;
        return mcap >= 2000 || cap.includes('large') || cap.includes('mid');
      }).sort((a, b) => (b.MarketCap || 0) - (a.MarketCap || 0));
      case 'inst_grade': {
        const liveQuotesMap: Record<string, any> = {};
        base.forEach(s => {
          liveQuotesMap[s.Symbol.toUpperCase()] = {
            last_price: s.LTP,
            volume: s.Volume,
            ohlc: {
              open: s.Open || s.todayOpen || 0,
              high: s.High || 0,
              low: s.Low || 0,
              close: s.Close || s.prevClose || 0
            },
            dai: (s as any).dai,
            depth_pressure: (s as any).depth_pressure
          };
        });
        return base.filter(s => {
          const res = VerdictEngine.compute(
            s.Symbol,
            {
              orbDataCache,
              dailyCandleData,
              valuationDataCache,
              shareholdingDataCache,
              qualityDataCache,
              boosterStocksList,
              historicalDataCache,
              fiiDiiPulseData,
              derivativeSummaryData
            },
            liveQuotesMap,
            volumeAverages,
            false,
            {
              oreScore: oreMap?.[s.Symbol.toUpperCase()]?.ore_score,
              oreDirection: oreMap?.[s.Symbol.toUpperCase()]?.direction,
              cvd: cvdMap?.[s.Symbol.toUpperCase()],
              oiSignal: oiSignalMap?.[s.Symbol.toUpperCase()],
              rsRank: rsMap?.[s.Symbol.toUpperCase()]?.rs_rank,
              rsCategory: rsMap?.[s.Symbol.toUpperCase()]?.category,
              fiiVelocity: shareholdingMap?.[s.Symbol.toUpperCase()]?.fii_velocity,
              valueZoneFlag: shareholdingMap?.[s.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
            }
          );
          return (res.igs ?? 0) > 0.75;
        }).sort((a, b) => {
          const aIgs = VerdictEngine.compute(a.Symbol, { orbDataCache, dailyCandleData, valuationDataCache, shareholdingDataCache, qualityDataCache, boosterStocksList, historicalDataCache, fiiDiiPulseData, derivativeSummaryData }, liveQuotesMap, volumeAverages, false, {
            oreScore: oreMap?.[a.Symbol.toUpperCase()]?.ore_score,
            oreDirection: oreMap?.[a.Symbol.toUpperCase()]?.direction,
            cvd: cvdMap?.[a.Symbol.toUpperCase()],
            oiSignal: oiSignalMap?.[a.Symbol.toUpperCase()],
            rsRank: rsMap?.[a.Symbol.toUpperCase()]?.rs_rank,
            rsCategory: rsMap?.[a.Symbol.toUpperCase()]?.category,
            fiiVelocity: shareholdingMap?.[a.Symbol.toUpperCase()]?.fii_velocity,
            valueZoneFlag: shareholdingMap?.[a.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
          }).igs ?? 0;
          const bIgs = VerdictEngine.compute(b.Symbol, { orbDataCache, dailyCandleData, valuationDataCache, shareholdingDataCache, qualityDataCache, boosterStocksList, historicalDataCache, fiiDiiPulseData, derivativeSummaryData }, liveQuotesMap, volumeAverages, false, {
            oreScore: oreMap?.[b.Symbol.toUpperCase()]?.ore_score,
            oreDirection: oreMap?.[b.Symbol.toUpperCase()]?.direction,
            cvd: cvdMap?.[b.Symbol.toUpperCase()],
            oiSignal: oiSignalMap?.[b.Symbol.toUpperCase()],
            rsRank: rsMap?.[b.Symbol.toUpperCase()]?.rs_rank,
            rsCategory: rsMap?.[b.Symbol.toUpperCase()]?.category,
            fiiVelocity: shareholdingMap?.[b.Symbol.toUpperCase()]?.fii_velocity,
            valueZoneFlag: shareholdingMap?.[b.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
          }).igs ?? 0;
          return bIgs - aIgs;
        });
      }
      case 'footprint_confirmed': {
        const liveQuotesMap: Record<string, any> = {};
        base.forEach(s => {
          liveQuotesMap[s.Symbol.toUpperCase()] = {
            last_price: s.LTP,
            volume: s.Volume,
            ohlc: {
              open: s.Open || s.todayOpen || 0,
              high: s.High || 0,
              low: s.Low || 0,
              close: s.Close || s.prevClose || 0
            },
            dai: (s as any).dai,
            depth_pressure: (s as any).depth_pressure
          };
        });
        return base.filter(s => {
          const ore = oreMap?.[s.Symbol.toUpperCase()];
          const oreScore = ore?.ore_score ?? 0;
          const res = VerdictEngine.compute(
            s.Symbol,
            {
              orbDataCache,
              dailyCandleData,
              valuationDataCache,
              shareholdingDataCache,
              qualityDataCache,
              boosterStocksList,
              historicalDataCache,
              fiiDiiPulseData,
              derivativeSummaryData
            },
            liveQuotesMap,
            volumeAverages,
            false,
            {
              oreScore: ore?.ore_score,
              oreDirection: ore?.direction,
              cvd: cvdMap?.[s.Symbol.toUpperCase()],
              oiSignal: oiSignalMap?.[s.Symbol.toUpperCase()],
              rsRank: rsMap?.[s.Symbol.toUpperCase()]?.rs_rank,
              rsCategory: rsMap?.[s.Symbol.toUpperCase()]?.category,
              fiiVelocity: shareholdingMap?.[s.Symbol.toUpperCase()]?.fii_velocity,
              valueZoneFlag: shareholdingMap?.[s.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
            }
          );
          return oreScore > 0.70 && (res.igs ?? 0) > 0.70;
        }).sort((a, b) => {
          const aIgs = VerdictEngine.compute(a.Symbol, { orbDataCache, dailyCandleData, valuationDataCache, shareholdingDataCache, qualityDataCache, boosterStocksList, historicalDataCache, fiiDiiPulseData, derivativeSummaryData }, liveQuotesMap, volumeAverages, false, {
            oreScore: oreMap?.[a.Symbol.toUpperCase()]?.ore_score,
            oreDirection: oreMap?.[a.Symbol.toUpperCase()]?.direction,
            cvd: cvdMap?.[a.Symbol.toUpperCase()],
            oiSignal: oiSignalMap?.[a.Symbol.toUpperCase()],
            rsRank: rsMap?.[a.Symbol.toUpperCase()]?.rs_rank,
            rsCategory: rsMap?.[a.Symbol.toUpperCase()]?.category,
            fiiVelocity: shareholdingMap?.[a.Symbol.toUpperCase()]?.fii_velocity,
            valueZoneFlag: shareholdingMap?.[a.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
          }).igs ?? 0;
          const bIgs = VerdictEngine.compute(b.Symbol, { orbDataCache, dailyCandleData, valuationDataCache, shareholdingDataCache, qualityDataCache, boosterStocksList, historicalDataCache, fiiDiiPulseData, derivativeSummaryData }, liveQuotesMap, volumeAverages, false, {
            oreScore: oreMap?.[b.Symbol.toUpperCase()]?.ore_score,
            oreDirection: oreMap?.[b.Symbol.toUpperCase()]?.direction,
            cvd: cvdMap?.[b.Symbol.toUpperCase()],
            oiSignal: oiSignalMap?.[b.Symbol.toUpperCase()],
            rsRank: rsMap?.[b.Symbol.toUpperCase()]?.rs_rank,
            rsCategory: rsMap?.[b.Symbol.toUpperCase()]?.category,
            fiiVelocity: shareholdingMap?.[b.Symbol.toUpperCase()]?.fii_velocity,
            valueZoneFlag: shareholdingMap?.[b.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
          }).igs ?? 0;
          return bIgs - aIgs;
        });
      }
      default: return base;
    }
  }, [filteredStocks, filterType, orbDataCache, dailyCandleData, valuationDataCache, shareholdingDataCache, qualityDataCache, boosterStocksList, historicalDataCache, fiiDiiPulseData, derivativeSummaryData, volumeAverages, oreMap, cvdMap, rsMap, shareholdingMap, oiSignalMap]);

  // --- ASYNCHRONOUS CACHE INITIALIZATION (INDEXEDDB) ---
  useEffect(() => {
    const loadIndexedDBCache = async () => {
      setIsCacheLoading(true);
      try {
        const [
          master,
          pulse,
          categorized,
          boosterList,
          boosterRaw,
          fiiDiiPulse,
          partOi,
          derivSummary,
          dailyCandle,
          weeklyCandle,
          histCache,
          orbCache,
          valCache,
          resCalendar,
          lotSizes,
          shareholding,
          quality,
          convergence,
          volAvgs
        ] = await Promise.all([
          getDbCache(CACHE_MASTER),
          getDbCache(CACHE_PULSE),
          getDbCache(CACHE_CATEGORIZED),
          getDbCache(CACHE_BOOSTER),
          getDbCache('sz_sector_booster'),
          getDbCache(CACHE_FII_DII_PULSE),
          getDbCache(CACHE_PARTICIPANT_OI),
          getDbCache(CACHE_DERIVATIVE_SUMMARY),
          getDbCache(CACHE_CANDLE_DAILY),
          getDbCache(CACHE_CANDLE_WEEKLY),
          getDbCache(CACHE_HISTORICAL),
          getDbCache(CACHE_ORB),
          getDbCache(CACHE_VALUATION),
          getDbCache(CACHE_RESULTS_CALENDAR),
          getDbCache(CACHE_LOT_SIZE),
          getDbCache(CACHE_SHAREHOLDING),
          getDbCache(CACHE_QUALITY),
          getDbCache(CACHE_CONVERGENCE_RESULTS),
          getDbCache(CACHE_VOLUME_AVERAGES)
        ]);

        if (master) {
          setMasterStocks(master);
          setStocks(master);
        }
        if (pulse) setPulseStocks(pulse);
        if (categorized) setPulseCategorized(categorized);
        if (boosterList) setBoosterStocksList(boosterList);
        if (boosterRaw) setBoosterRawData(boosterRaw);
        if (fiiDiiPulse) setFiiDiiPulseData(fiiDiiPulse);
        if (partOi) setParticipantOiData(partOi);
        if (derivSummary) setDerivativeSummaryData(derivSummary);
        if (dailyCandle) setDailyCandleData(dailyCandle);
        if (weeklyCandle) setWeeklyCandleData(weeklyCandle);
        if (histCache) setHistoricalDataCache(histCache);
        if (orbCache) setOrbDataCache(orbCache);
        if (valCache) setValuationDataCache(valCache);
        if (resCalendar) setResultsCalendarData(resCalendar);
        if (lotSizes) setLotSizesData(lotSizes);
        if (shareholding) setShareholdingDataCache(shareholding);
        if (quality) setQualityDataCache(quality);
        if (convergence) setConvergenceResults(convergence);
        if (volAvgs) setVolumeAverages(volAvgs);

        // Load technical indicator caches and purge old ones
        const indicatorCaches = await db.cache.where('key').startsWith('tech_indicator_matches_').toArray();
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const validCaches: Record<string, string[]> = {};
        for (const entry of indicatorCaches) {
          const entryDate = new Date(entry.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
          if (entryDate === todayStr) {
            const conditionId = entry.key.replace('tech_indicator_matches_', '');
            if (Array.isArray(entry.data)) {
              // Convert full API records or symbol list to simple symbols array for indicatorMatches
              validCaches[conditionId] = entry.data.map((item: any) => {
                if (typeof item === 'string') return item.toUpperCase();
                return (item.symbol_name || item.Symbol || item.symbol || '').toUpperCase();
              }).filter(Boolean);
            }
          } else {
            if (entry.id) {
              await db.cache.delete(entry.id);
            }
          }
        }
        setIndicatorMatches(deriveIndicatorMatches(validCaches));

        // Fetch cache timestamp of the master stock list to calculate data age
        const entry = await db.cache.where('key').equals(CACHE_MASTER).first();
        if (entry) {
          setCacheTimestamp(entry.timestamp);
        }
      } catch (err) {
        console.error('Failed to restore stock-screener cache from IndexedDB:', err);
      } finally {
        setIsCacheLoading(false);
      }
    };
    loadIndexedDBCache();
  }, []);

  // --- INSTANT HYDRATION FROM VPS PRE-COMPUTED SNAPSHOT (0-FREEZE ON MOUNT) ---
  useEffect(() => {
    let alive = true;
    const hydrateFromVpsSnapshot = async () => {
      try {
        const [respFno, respCash] = await Promise.allSettled([
          fetch('/api/python-nse/api/alpha/snapshot'),
          fetch('/api/python-nse/api/alpha/cash-snapshot')
        ]);

        if (respFno.status === 'fulfilled' && respFno.value.ok) {
          const resJson = await respFno.value.json();
          if (alive && resJson && resJson.status === 'success' && resJson.data) {
            const snap = resJson.data;
            if (snap.sectors && Array.isArray(snap.sectors) && snap.sectors.length > 0) {
              setSectorRawData(snap.sectors);
              setSectors(snap.sectors.map((s: any) => ({
                name: s.sector,
                change: s.percentChange || 0,
                price: s.lastPrice || 0,
                symbol: s.sector,
                marketCap: s.volume || 0
              })));
            }
            if (snap.stocks && Array.isArray(snap.stocks) && snap.stocks.length > 0 && intraMode === 'fno') {
              const mappedStocks: StockData[] = snap.stocks.map((s: any) => ({
                Symbol: s.symbol,
                LTP: s.lastPrice,
                Change: s.percentChange,
                "Strength Factor": s.mms || 50,
                Volume: s.volume,
                Open: s.openPrice,
                High: s.high,
                Low: s.low,
                Sector: s.sector,
                prevClose: s.openPrice ? s.openPrice / (1 + (s.openingGapPct || 0)/100) : s.lastPrice,
                todayOpen: s.openPrice,
                timeOfDayRvol: s.rFactor,
                rvol: s.rvol,
                adv: s.adv
              }));
              setMasterStocks(mappedStocks);
              setStocks(mappedStocks);
              setPulseStocks(mappedStocks);
            }
            if (snap.volume_averages && typeof snap.volume_averages === 'object' && Object.keys(snap.volume_averages).length > 0) {
              setVolumeAverages((prev) => ({ ...prev, ...snap.volume_averages }));
            }
            if (snap.mood) {
              setPcrGate(snap.mood.isBullish ? 'BULLISH' : 'BEARISH');
            }
          }
        }

        if (respCash.status === 'fulfilled' && respCash.value.ok) {
          const resJsonCash = await respCash.value.json();
          if (alive && resJsonCash && resJsonCash.status === 'success' && resJsonCash.data) {
            const cashSnap = resJsonCash.data;
            if (cashSnap.volume_averages && typeof cashSnap.volume_averages === 'object') {
              setVolumeAverages((prev) => ({ ...prev, ...cashSnap.volume_averages }));
            }
            if (cashSnap.stocks && Array.isArray(cashSnap.stocks) && cashSnap.stocks.length > 0) {
              const mappedCashStocks: StockData[] = cashSnap.stocks.map((s: any) => ({
                Symbol: s.symbol,
                LTP: s.lastPrice,
                Change: s.percentChange,
                "Strength Factor": 50,
                Volume: s.volume,
                Open: s.openPrice,
                High: s.high,
                Low: s.low,
                Close: s.close,
                Sector: s.sector,
                prevClose: s.close > 0 ? s.close : s.openPrice,
                todayOpen: s.openPrice,
                rvol: s.rvol,
                adv: s.adv
              }));

              if (intraMode === 'cash') {
                setMasterStocks(mappedCashStocks);
                setStocks(mappedCashStocks);
                setPulseStocks(mappedCashStocks);
              }
            }
          }
        }
      } catch (err) {
        // Fallback silently if snapshot not yet generated
      }
    };
    hydrateFromVpsSnapshot();
    return () => { alive = false; };
  }, [intraMode]);



  // --- PERSISTENCE EFFECTS (INDEXEDDB) ---
  useEffect(() => {
    if (isCacheLoading) return;
    if (masterStocks.length > 0) setDbCache(CACHE_MASTER, masterStocks);
  }, [masterStocks, isCacheLoading]);

  useEffect(() => {
    if (isCacheLoading) return;
    if (pulseStocks.length > 0) setDbCache(CACHE_PULSE, pulseStocks);
  }, [pulseStocks, isCacheLoading]);

  useEffect(() => {
    if (isCacheLoading) return;
    if (Object.keys(pulseCategorized).length > 0) setDbCache(CACHE_CATEGORIZED, pulseCategorized);
  }, [pulseCategorized, isCacheLoading]);

  useEffect(() => {
    if (isCacheLoading) return;
    if (Object.keys(volumeAverages).length > 0) {
      setDbCache(CACHE_VOLUME_AVERAGES, volumeAverages);
    }
  }, [volumeAverages, isCacheLoading]);

  useEffect(() => {
    if (isCacheLoading) return;
    if (dailyCandleData) setDbCache(CACHE_CANDLE_DAILY, dailyCandleData);
  }, [dailyCandleData, isCacheLoading]);

  useEffect(() => {
    if (isCacheLoading) return;
    if (weeklyCandleData) setDbCache(CACHE_CANDLE_WEEKLY, weeklyCandleData);
  }, [weeklyCandleData, isCacheLoading]);

  useEffect(() => {
    if (isCacheLoading) return;
    if (Object.keys(historicalDataCache).length > 0) setDbCache(CACHE_HISTORICAL, historicalDataCache);
  }, [historicalDataCache, isCacheLoading]);

  useEffect(() => {
    if (isCacheLoading) return;
    if (Object.keys(orbDataCache).length > 0) setDbCache(CACHE_ORB, orbDataCache);
  }, [orbDataCache, isCacheLoading]);

  useEffect(() => {
    if (isCacheLoading) return;
    if (Object.keys(valuationDataCache).length > 0) setDbCache(CACHE_VALUATION, valuationDataCache);
  }, [valuationDataCache, isCacheLoading]);

  // Persist UI State (LocalStorage)
  useEffect(() => { sessionStorage.setItem(CACHE_SHADOW_MODE, shadowMode); }, [shadowMode]);
  useEffect(() => { sessionStorage.setItem(CACHE_SELECTED_PATTERN, selectedCandlePattern); }, [selectedCandlePattern]);
  useEffect(() => { sessionStorage.setItem(CACHE_CANDLE_TF, candleTimeframe); }, [candleTimeframe]);
  useEffect(() => { sessionStorage.setItem(CACHE_HIST_TYPE, historicalType); }, [historicalType]);
  useEffect(() => { sessionStorage.setItem(CACHE_HIST_TF, historicalTimeframe); }, [historicalTimeframe]);
  useEffect(() => { sessionStorage.setItem(CACHE_ORB_MINS, orbMinutes.toString()); }, [orbMinutes]);
  useEffect(() => { sessionStorage.setItem(CACHE_ORB_PRB, orbWithPrb.toString()); }, [orbWithPrb]);
  useEffect(() => { sessionStorage.setItem(CACHE_VAL_TYPE, valuationType); }, [valuationType]);
  useEffect(() => { sessionStorage.setItem(CACHE_INTRA_MODE, intraMode); }, [intraMode]);
  useEffect(() => { sessionStorage.setItem(CACHE_ENGINE_MODE, engineMode); }, [engineMode]);
  useEffect(() => { sessionStorage.setItem(CACHE_CONVERGENCE_DIR, convergenceDirection); }, [convergenceDirection]);
  useEffect(() => { sessionStorage.setItem(CACHE_CONVERGENCE_MODE, convergenceMode); }, [convergenceMode]);
  useEffect(() => {
    if (isCacheLoading) return;
    if (boosterStocksList.length > 0) setDbCache(CACHE_BOOSTER, boosterStocksList);
  }, [boosterStocksList, isCacheLoading]);
  useEffect(() => { sessionStorage.setItem(CACHE_BOOSTER_TREND, boosterTrend); }, [boosterTrend]);

  // Convergence Scan Runner
  useEffect(() => {
    if (shadowMode === 'convergence' && isVisible) {
      const runScan = async () => {
        setIsScanningConvergence(true);
        try {
          setIsConvergenceWorkerBusy(true);
          const results = await new Promise<ScoredStock[]>((resolve, reject) => {
            const worker = new Worker(
              new URL('../../workers/convergenceWorker.ts', import.meta.url),
              { type: 'module' }
            );
            worker.onmessage = (e: MessageEvent) => {
              const { type, payload } = e.data;
              if (type === 'CONVERGENCE_COMPLETE') {
                worker.terminate();
                resolve(payload.results);
              } else {
                worker.terminate();
                reject(new Error(payload || 'Worker morning sync calculation failed'));
              }
            };
            worker.onerror = (err) => {
              worker.terminate();
              reject(err);
            };
            const caches = ConvergenceEngine.loadAllCaches();
            worker.postMessage({
              type: 'RUN_CONVERGENCE',
              payload: { direction: convergenceDirection, mode: convergenceMode, caches }
            });
          });

          setConvergenceResults(results);
          sessionStorage.setItem(CACHE_CONVERGENCE_RESULTS, JSON.stringify(results));

          const perfectCount = results.filter((r: ScoredStock) => r.tier === 'PERFECT').length;
          sessionStorage.setItem('alpha_convergence_alert', perfectCount.toString());
          window.dispatchEvent(new CustomEvent('alpha_convergence_update', { detail: perfectCount }));
        } catch (err) {
          console.error('Convergence scan worker failed, falling back to main thread:', err);
          try {
            const results = ConvergenceEngine.runConvergenceScan(convergenceDirection, convergenceMode);
            setConvergenceResults(results);
            sessionStorage.setItem(CACHE_CONVERGENCE_RESULTS, JSON.stringify(results));
            const perfectCount = results.filter((r: ScoredStock) => r.tier === 'PERFECT').length;
            sessionStorage.setItem('alpha_convergence_alert', perfectCount.toString());
            window.dispatchEvent(new CustomEvent('alpha_convergence_update', { detail: perfectCount }));
          } catch (fallbackErr) {
            console.error('Convergence main thread fallback scan failed:', fallbackErr);
          }
        } finally {
          setIsScanningConvergence(false);
          setIsConvergenceWorkerBusy(false);
        }
      };
      runScan();
    }
  }, [shadowMode, convergenceDirection, convergenceMode, isVisible, dailyCandleData, weeklyCandleData, historicalDataCache, orbDataCache, valuationDataCache]);

  // Initial Heatmap & Sector Booster fetch
  useEffect(() => {
    if (activeSubTab === 'heatmap') {
      if (sectors.length === 0) fetchSectorAnalysis();
      if (boosterRawData.length === 0) fetchSectorBooster();
    } else if (activeSubTab === 'intraday' && engineMode === 'sector_booster') {
      if (boosterRawData.length === 0) fetchSectorBooster();
    }
  }, [activeSubTab, engineMode]);

  // Morning Sync Effect removed in favor of manual "Warm Caches" refreshing

  // Update sectors when timeframe changes
  useEffect(() => {
    if (sectorRawData.length > 0) {
      updateSectorsFromRaw(sectorRawData, sectorTimeframe);
    }
  }, [sectorTimeframe]);

  // Drilldown Mapping
  useEffect(() => {
    if (activeDrillSector && boosterRawData.length > 0) {
      const normalizedDrillSector = activeDrillSector.replace(/Nifty\s+/gi, '').replace(/NIFTY\s+/gi, '').trim().toUpperCase();
      const sectorObj = boosterRawData.find(s =>
        s.sector.replace(/Nifty\s+/gi, '').replace(/NIFTY\s+/gi, '').trim().toUpperCase() === normalizedDrillSector
      );
      if (sectorObj && sectorObj.stock_list) {
        const mappedStocks = sectorObj.stock_list.map((item: any) => ({
          name: item.symbol_name,
          change: parseFloat(item.change_per) || 0,
          price: item.last_trade_price,
          symbol: item.symbol_name,
          marketCap: item.volume || 100,
          timeframe: 'day',
          score: item.current_score
        })).sort((a: any, b: any) => b.change - a.change);
        setBoosterStocks(mappedStocks);
      } else {
        setBoosterStocks([]);
      }
    }
  }, [activeDrillSector, boosterRawData]);

  // Initial auto-fetch if empty and token exists
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    if (activeSubTab === 'intraday') {
      if (intraMode === 'cash' && stocks.length === 0) {
        fetchStockeZeeProxy();
      } else if (intraMode === 'fno') {
        if (engineMode === 'pulse' && pulseStocks.length === 0) {
          fetchPulseProxy();
        } else if (engineMode === 'raw' && stocks.length === 0) {
          fetchStockeZeeProxy();
        }
      }
    } else if (activeSubTab === 'heatmap') {
      if (sectors.length === 0) fetchSectorAnalysis();
      if (boosterRawData.length === 0) fetchSectorBooster();
    }
  }, [activeSubTab, intraMode, engineMode]);

  // Auto-Sync Loop with dynamic user-configurable cadence
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    let intervalMs: number | null = null;
    if (alphaRefreshInterval === '15s') intervalMs = 15000;
    else if (alphaRefreshInterval === '30s') intervalMs = 30000;
    else if (alphaRefreshInterval === '60s') intervalMs = 60000;
    else if (alphaRefreshInterval === '120s') intervalMs = 120000;
    else if (alphaRefreshInterval === '300s') intervalMs = 300000;
    // 'manual' => intervalMs remains null

    const shouldRun = isAutoRefresh && intervalMs !== null && activeSubTab === 'intraday' && isVisible;

    if (shouldRun && intervalMs) {
      interval = setInterval(() => {
        // Skip refreshing if outside active market hours (Mon-Fri 9:00 AM - 3:45 PM IST)
        if (!isAlphaActiveHours()) {
          console.log('[AlphaEngine] Skipping auto-refresh: outside active market hours.');
          return;
        }

        fetchMacroAndPcr();
        if (intraMode === 'cash') {
          if (localStorage.getItem('stockezee_token')) {
            fetchStockeZeeProxy();
          } else if (bridgeCode) {
            handleDirectInjection('bridge', 'master');
          }
        } else {
          // F&O Mode
          if (engineMode === 'pulse') {
            if (pulseBridgeCode) handleDirectInjection('bridge', 'pulse');
            else if (localStorage.getItem('stockezee_token')) fetchPulseProxy();
          } else {
            if (bridgeCode) handleDirectInjection('bridge', 'master');
            if (sectorBridgeCode) handleDirectInjection('bridge-sector');
          }
        }
      }, intervalMs);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAutoRefresh, alphaRefreshInterval, activeSubTab, bridgeCode, sectorBridgeCode, pulseBridgeCode, intraMode, engineMode, isVisible]);

  // Sync PCR & Macro bias on manual refresh
  useEffect(() => {
    if (refreshCount > 0) {
      isManualRefreshPending.current = true;
      clearTimeOfDayRvolCache();
      fetchMacroAndPcr();
      fetchAlphaSignals();
    }
  }, [refreshCount]);

  const snapshotContextRef = useRef<any>({});
  useEffect(() => {
    snapshotContextRef.current = {
      volumeAverages,
      orbDataCache,
      dailyCandleData,
      valuationDataCache,
      shareholdingDataCache,
      qualityDataCache,
      boosterStocksList,
      historicalDataCache,
      fiiDiiPulseData,
      derivativeSummaryData,
      oreMap,
      cvdMap,
      rsMap,
      shareholdingMap,
      oiSignalMap
    };
  }, [
    volumeAverages,
    orbDataCache,
    dailyCandleData,
    valuationDataCache,
    shareholdingDataCache,
    qualityDataCache,
    boosterStocksList,
    historicalDataCache,
    fiiDiiPulseData,
    derivativeSummaryData,
    oreMap,
    cvdMap,
    rsMap,
    shareholdingMap,
    oiSignalMap
  ]);

  // Background interval check for scheduled snapshots (9:25 AM and 3:15 PM EOD)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isAlphaActiveHours()) return;
      
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const kolkataTime = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
      const [hours, minutes] = kolkataTime.split(':').map(Number);
      const timeVal = hours * 100 + minutes;

      // Auto 9:25 AM snapshot
      if (timeVal >= 925 && timeVal < 1515) {
        const alreadySaved = sessionStorage.getItem(`saved_925_${todayStr}`);
        if (!alreadySaved && masterStocks && masterStocks.length > 0) {
          sessionStorage.setItem(`saved_925_${todayStr}`, 'true');
          snapshotService.saveSnapshot('auto_925', masterStocks, snapshotContextRef.current).catch(err => {
            console.error('Failed to save 9:25 AM auto snapshot:', err);
          });
        }
      }

      // Auto EOD 3:15 PM snapshot
      if (timeVal >= 1515) {
        const alreadySavedEOD = sessionStorage.getItem(`saved_eod_${todayStr}`);
        if (!alreadySavedEOD && masterStocks && masterStocks.length > 0) {
          sessionStorage.setItem(`saved_eod_${todayStr}`, 'true');
          snapshotService.saveSnapshot('eod', masterStocks, snapshotContextRef.current).catch(err => {
            console.error('Failed to save EOD auto snapshot:', err);
          });
        }
      }
    }, 60000); // check every minute

    return () => clearInterval(interval);
  }, [masterStocks]);

  const processDatabase = (parsed: any, targetSource?: 'master' | 'pulse' | 'booster') => {
    const isSectorBoosterJSON = parsed && parsed.resultData && Array.isArray(parsed.resultData) && parsed.resultData.length > 0 && parsed.resultData[0].sector !== undefined;

    if (isSectorBoosterJSON) {
      setBoosterRawData(parsed.resultData);
      setDbCache('sz_sector_booster', parsed.resultData);
      setError('');
      setEngineMode('sector_booster');
      setIsSniperActive(false);
      return;
    }

    let list = [];
    let categorized: Record<string, StockData[]> = {};

    const isBoosterJSON = parsed && (
      (parsed.resultData && Array.isArray(parsed.resultData) && parsed.resultData.length > 0 && parsed.resultData[0].current_score !== undefined) ||
      (Array.isArray(parsed) && parsed.length > 0 && parsed[0].current_score !== undefined)
    );

    if (isBoosterJSON) {
      list = Array.isArray(parsed.resultData) ? parsed.resultData : parsed;
    } else if (parsed.resultData) {
      const rd = parsed.resultData;
      list = [
        ...(rd.topGainers || []),
        ...(rd.topLosers || []),
        ...(rd.gapUp || []),
        ...(rd.gapDown || []),
        ...(rd.sameOpenAndLow || rd.openLow || []),
        ...(rd.sameOpenAndHigh || rd.openHigh || []),
        ...(Array.isArray(rd) ? rd : (rd.stocks ? rd.stocks : []))
      ];
      if (list.length === 0 && Array.isArray(rd)) list = rd;
      if (list.length === 0 && rd.stockList) list = rd.stockList;
    } else {
      list = parsed.data || parsed.stockList || (parsed.json && parsed.json.stockList) || (Array.isArray(parsed) ? parsed : []);
    }

    if (!list || list.length === 0) throw new Error("Invalid DB structure or empty list.");

    const parseNum = (val: any): number => {
      if (val === null || val === undefined) return 0;
      if (typeof val === 'number') return val;
      const cleaned = val.toString().replace(/,/g, '').trim();
      const parsedVal = parseFloat(cleaned);
      return isNaN(parsedVal) ? 0 : parsedVal;
    };

    const standardizedList: StockData[] = list.map((item: any) => {
      const changePer = parseNum(item.change_percent || item.change_pct || item.Change || 0);
      return {
        Symbol: item.symbol_name || item.symbol || item.Symbol || 'UNKNOWN',
        LTP: parseNum(item.today_close || item.last_trade_price || item.close_price || item.LTP || item.close || 0),
        Change: changePer,
        "Strength Factor": item.current_score !== undefined ? parseNum(item.current_score) : (item.momentum_score !== undefined ? parseNum(item.momentum_score) : changePer * 100),
        CapCategory: item.cap_category || item.market_cap_type || 'EQ',
        Volume: parseNum(item.today_volume || item.volume || 0),
        Open: parseNum(item.today_open || item.open || item.open_price || 0),
        High: parseNum(item.today_high || item.high || item.high_price || 0),
        Low: parseNum(item.today_low || item.low || item.low_price || 0),
        Close: parseNum(item.today_close || item.close || item.close_price || 0),
        prevClose: parseNum(item.prev_close || item.prev_close_price || item.previousClose || item.close || 0),
        todayOpen: parseNum(item.today_open || item.open || 0),
        CompanyName: item.company_name || item.index_name || '',
        Sector: item.sector_name || item.index_name || '',
        MarketCap: parseNum(item.market_cap || 0),
        PE: parseNum(item.pe || item.stock_p_e || 0),
        Dividend: parseNum(item.div_yield || item.dividend_yield_per || 0),
        trend: item.trend || (changePer >= 0 ? 'Bullish' : 'Bearish'),
        time: item.time || 'N/A',
        change: item.change !== undefined ? parseNum(item.change) : 0,
        ownership_momentum_score: calculateOwnershipScore(item.symbol_name || item.symbol || item.Symbol || '', shareholdingDataCache)
      };
    });

    const uniqueMap = new Map();
    standardizedList.forEach(s => uniqueMap.set(s.Symbol, s));
    const finalUniqueList = Array.from(uniqueMap.values());

    if (isBoosterJSON || targetSource === 'booster') {
      setBoosterStocksList(finalUniqueList);
    } else {
      if (parsed.resultData) {
        const rd = parsed.resultData;
        const getUniqueSymbols = (arr: any[]) => (arr || []).map((item: any) => item.symbol_name || item.symbol);

        categorized = {
          top_gainers: finalUniqueList.filter(s => getUniqueSymbols(rd.topGainers).includes(s.Symbol)),
          top_losers: finalUniqueList.filter(s => getUniqueSymbols(rd.topLosers).includes(s.Symbol)),
          gap_up: finalUniqueList.filter(s => getUniqueSymbols(rd.gapUp).includes(s.Symbol)),
          gap_down: finalUniqueList.filter(s => getUniqueSymbols(rd.gapDown).includes(s.Symbol)),
          open_low: finalUniqueList.filter(s => getUniqueSymbols(rd.sameOpenAndLow || rd.openLow).includes(s.Symbol)),
          open_high: finalUniqueList.filter(s => getUniqueSymbols(rd.sameOpenAndHigh || rd.openHigh).includes(s.Symbol))
        };
      }

      const isPulseJSON = !!parsed.resultData;
      const isMasterJSON = !!parsed.data || !!parsed.stockList;

      if (targetSource === 'pulse' || (isPulseJSON && !isMasterJSON)) {
        setPulseStocks(finalUniqueList);
        setPulseCategorized(categorized);
        if (targetSource === 'pulse') setEngineMode('pulse');
      } else {
        // Exclude extremely illiquid traps at the very start to avoid running Upstox API scans on them.
        // A stock is kept if it has decent MarketCap (>= 100 Cr), or decent volume (>= 10000),
        // or decent traded value/turnover (>= ₹5 Lakhs).
        // We also keep it if we don't have the data (MarketCap === 0 and Volume === 0) to avoid false exclusions.
        const filteredList = finalUniqueList.filter(s => {
          if (s.MarketCap === 0 && s.Volume === 0) return true;
          const isDecentMcap = s.MarketCap >= 100;
          const isDecentVol = s.Volume >= 10000;
          const isDecentTurnover = (s.LTP * s.Volume) >= 500000;
          return isDecentMcap || isDecentVol || isDecentTurnover;
        });
        console.log(`[AlphaEngineState] Filtered master stock list from ${finalUniqueList.length} down to ${filteredList.length} active/liquid stocks.`);
        setMasterStocks(filteredList);
        setStocks(filteredList);
      }
    }
    if (finalUniqueList && finalUniqueList.length > 0) {
      const symbols = finalUniqueList.map(s => s.Symbol);
      const isPrefetchEnabled = localStorage.getItem('enable_rvol_prefetch') === 'true';
      if (isPrefetchEnabled) {
        bulkPrefetchHistoricalCandles(symbols).catch(err => {
          console.warn('Failed to bulk prefetch candles:', err);
        });
      }

      if (isManualRefreshPending.current) {
        isManualRefreshPending.current = false;
        snapshotService.saveSnapshot('manual_refresh', finalUniqueList, snapshotContextRef.current).catch(err => {
          console.error('Failed to save manual refresh snapshot:', err);
        });
      }
    }
    setIsSniperActive(false);
  };

  const getToken = () => (localStorage.getItem('stockezee_token') || stockezeeToken || '').trim();

  const fetchStockeZeeProxy = async (overrideToken?: string): Promise<boolean> => {
    const token = overrideToken?.trim() || getToken();
    if (!token) {
      setError('No StockeZee token found. Open Bridge Config → ⚡ Token tab and save your token.');
      return false;
    }
    try {
      setIsFetchingLive(true);
      setError('');
      const response = await fetch('/api/stockezee/api/symbol/stock-list', {
        headers: { 'Accept': 'application/json', 'x-stockezee-token': token }
      });
      if (response.ok) {
        const data = await response.json();
        processDatabase(data, 'master');
        return true;
      }
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('stockezee_token');
        setError('StockeZee token expired. Open Bridge Config → ⚡ Token and paste a new one.');
      } else {
        setError(`StockeZee fetch failed (${response.status}). Try manual refresh.`);
      }
      return false;
    } catch (_err) {
      setError('Network error. Check your connection and try again.');
      return false;
    } finally {
      setIsFetchingLive(false);
    }
  };

  const fetchPulseProxy = async (overrideToken?: string): Promise<boolean> => {
    const token = overrideToken?.trim() || getToken();
    if (!token) {
      setError('No StockeZee token found. Save it in Bridge Config → ⚡ Token tab first.');
      return false;
    }
    try {
      setIsFetchingPulse(true);
      setError('');
      const res = await fetch('/api/sz-pulse/webapi/symbol/top-gainers-data?fno_stock=true', {
        headers: { 'Accept': 'application/json', 'x-stockezee-token': token }
      });
      if (res.ok) {
        const data = await res.json();
        processDatabase(data, 'pulse');
        return true;
      }
      if (res.status === 401 || res.status === 403) {
        setError(`Pulse Token Expired (${res.status}). Please update token in Bridge Config.`);
      } else {
        setError(`Pulse fetch failed (Status: ${res.status}). Check token or paste JSON manually.`);
      }
      return false;
    } catch (_err) {
      setError('Pulse network error.');
      return false;
    } finally {
      setIsFetchingPulse(false);
    }
  };

  const fetchBoosterProxy = async (overrideToken?: string): Promise<boolean> => {
    const token = overrideToken?.trim() || getToken();
    if (!token) {
      setError('No StockeZee token found. Open Bridge Config → ⚡ Token tab and save your token.');
      return false;
    }
    try {
      setIsFetchingBoosterScanner(true);
      setError('');
      const res = await fetch('/api/sz-sector/api/Symbol/orb-range?type=marking', {
        headers: {
          'Accept': 'application/json',
          'x-stockezee-token': token,
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        processDatabase(data, 'booster');
        return true;
      }
      if (res.status === 401 || res.status === 403) {
        setError(`StockeZee Token Expired (${res.status}). Please update token in Bridge Config.`);
      } else {
        setError(`Intraday Booster fetch failed (Status: ${res.status}). Check token or paste JSON manually.`);
      }
      return false;
    } catch (_err) {
      setError('Intraday Booster network error.');
      return false;
    } finally {
      setIsFetchingBoosterScanner(false);
    }
  };

  const fetchSectorAnalysis = async (): Promise<boolean> => {
    const token = getToken();
    if (!token) return false;
    try {
      setIsFetchingSectors(true);
      const response = await fetch('/api/sz-sector/api/Analysis/sector-analysis', {
        headers: { 'Accept': 'application/json', 'x-stockezee-token': token }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.resultData) {
          setSectorRawData(data.resultData);
          updateSectorsFromRaw(data.resultData, sectorTimeframe);
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Sector fetch failed:', err);
      return false;
    } finally {
      setIsFetchingSectors(false);
    }
  };

  const fetchSectorBooster = async (): Promise<boolean> => {
    const token = getToken();
    if (!token) return false;
    try {
      setIsFetchingBooster(true);
      const response = await fetch('/api/sz-sector/api/Symbol/fno-sectors', {
        headers: { 'Accept': 'application/json', 'x-stockezee-token': token }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.resultData) {
          setBoosterRawData(data.resultData);
          setDbCache('sz_sector_booster', data.resultData);
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Booster fetch failed:', err);
      return false;
    } finally {
      setIsFetchingBooster(false);
    }
  };

  const fetchCandlestickData = async (tf?: 'daily' | 'weekly', forceRefresh: boolean = false) => {
    const token = getToken();
    const activeTf = tf || candleTimeframe;

    const existingData = activeTf === 'daily' ? dailyCandleData : weeklyCandleData;
    if (existingData && !forceRefresh) return;

    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }
    try {
      setIsFetchingCandles(true);
      setError('');
      const response = await ShadowScreenerService.fetchPatterns(token, activeTf);
      if (response && response.data) {
        if (activeTf === 'daily') setDailyCandleData(response.data);
        else setWeeklyCandleData(response.data);

        if (response.data.available_pattens?.length > 0) {
          setSelectedCandlePattern(response.data.available_pattens[0]);
        }

        // Validate if fetched data date matches today's date in Indian Standard Time (IST)
        let dataDate = '';
        const patternKeys = Object.keys(response.data).filter(k => k !== 'available_pattens');
        for (const key of patternKeys) {
          const list = response.data[key];
          if (Array.isArray(list) && list.length > 0) {
            dataDate = list[0].candle_date || '';
            if (dataDate) break;
          }
        }
        if (!dataDate && response.message) {
          const dateMatch = response.message.match(/^(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            dataDate = dateMatch[1];
          }
        }
        if (dataDate) {
          const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
          if (dataDate !== todayStr) {
            toast.warning(`Candlestick data is outdated (Data date: ${dataDate}, Today: ${todayStr}). Please update!`, {
              duration: 8000
            });
          }
        }
      }
    } catch (err) {
      setError(`Failed to fetch ${activeTf} candlestick patterns.`);
    } finally {
      setIsFetchingCandles(false);
    }
  };

  const fetchHistoricalData = async (type?: 'gainers' | 'loosers', tf?: 'day' | 'week' | 'month' | 'year', force: boolean = false) => {
    const token = getToken();
    const activeType = type || historicalType;
    const activeTf = tf || historicalTimeframe;
    const cacheKey = `${activeType}_${activeTf}`;

    if (historicalDataCache[cacheKey] && !force) return;

    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }

    try {
      setIsFetchingHistorical(true);
      setError('');
      const response = await ShadowScreenerService.fetchHistoricalPerformance(token, activeType, activeTf);
      if (response && response.resultData) {
        setHistoricalDataCache(prev => ({ ...prev, [cacheKey]: response.resultData }));
      }
    } catch (err) {
      setError(`Failed to fetch ${activeType} ${activeTf} performance.`);
    } finally {
      setIsFetchingHistorical(false);
    }
  };

  const fetchORBData = async (mins?: 15 | 30 | 45 | 60, withPrb?: boolean, force: boolean = false) => {
    const token = getToken();
    const activeMins = mins || orbMinutes;
    const activeWithPrb = withPrb !== undefined ? withPrb : orbWithPrb;
    const cacheKey = `${activeMins}_${activeWithPrb}`;

    if (orbDataCache[cacheKey] && !force) return;

    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }

    try {
      setIsFetchingORB(true);
      setError('');
      const response = await ShadowScreenerService.fetchORB(token, activeMins, activeWithPrb);
      if (response && response.resultData) {
        setOrbDataCache(prev => ({ ...prev, [cacheKey]: response.resultData }));
      }
    } catch (err) {
      setError(`Failed to fetch ${activeMins}m ORB performance.`);
    } finally {
      setIsFetchingORB(false);
    }
  };

  const fetchValuationData = async (type?: 'over_valued' | 'under_valued', force: boolean = false) => {
    const token = getToken();
    const activeType = type || valuationType;

    if (valuationDataCache[activeType] && !force) return;

    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }

    try {
      setIsFetchingValuation(true);
      setError('');
      const response = await ShadowScreenerService.fetchValuation(token, activeType);
      if (response && response.data) {
        setValuationDataCache(prev => ({ ...prev, [activeType]: response.data }));
      }
    } catch (err) {
      setError(`Failed to fetch ${activeType.replace('_', ' ')} stocks.`);
    } finally {
      setIsFetchingValuation(false);
    }
  };

  const fetchResultsCalendarData = async (force: boolean = false) => {
    const token = getToken();
    if (!force && resultsCalendarData.length > 0) return;

    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }

    try {
      setIsFetchingResults(true);
      setError('');
      const data = await ShadowScreenerService.fetchResultsCalendar(token);
      setResultsCalendarData(data);
      setDbCache(CACHE_RESULTS_CALENDAR, data);
    } catch (err) {
      setError('Failed to fetch results calendar.');
    } finally {
      setIsFetchingResults(false);
    }
  };

  const fetchLotSizesData = async (force: boolean = false) => {
    const token = getToken();
    if (!force && lotSizesData.length > 0) return;

    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }

    try {
      setIsFetchingLotSizes(true);
      setError('');
      const data = await ShadowScreenerService.fetchLotSizes(token);
      setLotSizesData(data);
      setDbCache(CACHE_LOT_SIZE, data);
    } catch (err) {
      setError('Failed to fetch F&O lot sizes.');
    } finally {
      setIsFetchingLotSizes(false);
    }
  };

  const fetchShareholdingData = async (investor?: 'fii' | 'promoter', trans?: 'buy' | 'sell', force: boolean = false) => {
    const token = getToken();
    const activeInv = investor || shareholdingInvestor;
    const activeTrans = trans || shareholdingTrans;
    const cacheKey = `${activeInv}_${activeTrans}`;

    if (shareholdingDataCache[cacheKey] && !force) return;

    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }

    try {
      setIsFetchingShareholding(true);
      setError('');
      const data = await ShadowScreenerService.fetchShareholdingActivity(token, activeInv, activeTrans);
      
      // Calculate ownership momentum score on the fly
      const updatedData = data.map(item => {
        const score = calculateOwnershipScore(item.symbol_name, {
          ...shareholdingDataCache,
          [cacheKey]: data
        });
        return {
          ...item,
          ownership_momentum_score: score
        };
      });

      const newCache = { ...shareholdingDataCache, [cacheKey]: updatedData };
      setShareholdingDataCache(newCache);
      setDbCache(CACHE_SHAREHOLDING, newCache);
    } catch (err) {
      setError(`Failed to fetch ${activeInv} ${activeTrans} data.`);
    } finally {
      setIsFetchingShareholding(false);
    }
  };

  const fetchQualityData = async (scoreType?: string, filter?: 'high' | 'low', force: boolean = false) => {
    const token = getToken();
    const activeType = scoreType || qualityScoreType;
    const activeFilter = filter || qualityFilter;
    const cacheKey = `${activeType}_${activeFilter}`;

    if (qualityDataCache[cacheKey] && !force) return;

    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }

    try {
      setIsFetchingQuality(true);
      setError('');
      const data = await ShadowScreenerService.fetchQualityScorecard(token, activeType, activeFilter);
      const newCache = { ...qualityDataCache, [cacheKey]: data };
      setQualityDataCache(newCache);
      setDbCache(CACHE_QUALITY, newCache);

      if (activeType === 'total_score' && activeFilter === 'high') {
        setDbCache('alpha_cache_quality_total_score_high', data);
      }
    } catch (err) {
      setError(`Failed to fetch ${activeType.replace('_', ' ')} data.`);
    } finally {
      setIsFetchingQuality(false);
    }
  };

  const fetchPrebuildScreensAction = async (force: boolean = false) => {
    const token = getToken();
    if (!force && prebuildScreens) return;
    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }
    try {
      setScreenerLoading(true);
      setError('');
      const res = await ShadowScreenerService.fetchPrebuildScreens(token);
      if (res && res.status === 1 && res.data) {
        setPrebuildScreens(res.data);
      }
    } catch (err) {
      setError('Failed to fetch prebuilt screens.');
    } finally {
      setScreenerLoading(false);
    }
  };

  const fetchIndicatorScreenerAction = async (indicator: string, condition: string, force: boolean = false) => {
    const token = getToken();
    if (!token) {
      setError('StockeZee token missing. Save it in Bridge Config first.');
      return;
    }
    try {
      setScreenerLoading(true);
      setError('');

      const cacheKey = `tech_indicator_matches_${condition}`;
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

      if (!force) {
        const cachedEntry = await db.cache.where('key').equals(cacheKey).first();
        if (cachedEntry) {
          const cachedDate = new Date(cachedEntry.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
          if (cachedDate === todayStr && Array.isArray(cachedEntry.data)) {
            console.log(`[AlphaEngineState] Resolving indicator screener ${condition} instantly from cache.`);
            const transformed = ShadowScreenerService.transformCrossFilterToStockData(cachedEntry.data, condition);
            const finalData = transformed.map(s => ({
              ...s,
              ownership_momentum_score: calculateOwnershipScore(s.Symbol, shareholdingDataCache)
            }));
            setIndicatorScreenerData(finalData);
            return;
          }
        }
      }

      const data = await ShadowScreenerService.fetchTechnicalIndicatorCrossFilter(
        token,
        indicator,
        condition,
        '1D',
        2000
      );

      // Save full API data response array to Dexie cache
      await setDbCache(cacheKey, data);

      // Refresh in-memory indicatorMatches state with today's matches
      const indicatorCaches = await db.cache.where('key').startsWith('tech_indicator_matches_').toArray();
      const validCaches: Record<string, string[]> = {};
      for (const entry of indicatorCaches) {
        const entryDate = new Date(entry.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        if (entryDate === todayStr && Array.isArray(entry.data)) {
          const condId = entry.key.replace('tech_indicator_matches_', '');
          validCaches[condId] = entry.data.map((item: any) => {
            if (typeof item === 'string') return item.toUpperCase();
            return (item.symbol_name || item.Symbol || item.symbol || '').toUpperCase();
          }).filter(Boolean);
        }
      }
      setIndicatorMatches(deriveIndicatorMatches(validCaches));

      const transformed = ShadowScreenerService.transformCrossFilterToStockData(data, condition);
      const finalData = transformed.map(s => ({
        ...s,
        ownership_momentum_score: calculateOwnershipScore(s.Symbol, shareholdingDataCache)
      }));
      setIndicatorScreenerData(finalData);
    } catch (err) {
      setError(`Failed to fetch indicators screener data for ${indicator} - ${condition}.`);
    } finally {
      setScreenerLoading(false);
    }
  };

  const warmTechnicalIndicators = async (forceAll: boolean = false) => {
    if (isWarmingIndicators) return;
    setIsWarmingIndicators(true);
    setWarmingIndicatorStep(0);
    setWarmingIndicatorLabel('Preparing queue...');

    const token = getToken();
    if (!token) {
      setError('StockeZee token missing. Warm-up requires token.');
      setIsWarmingIndicators(false);
      return;
    }

    try {
      // 1. Gather all conditions to scan
      let conditionsToScan: string[] = [];
      if (forceAll) {
        for (const groups of Object.values(CONDITIONS)) {
          for (const conds of Object.values(groups)) {
            conds.forEach(c => conditionsToScan.push(c.id));
          }
        }
      } else {
        conditionsToScan = Array.from(new Set(
          Object.values(STRATEGY_CONFIGS).flatMap(config => config.power20 || [])
        ));
      }

      conditionsToScan = Array.from(new Set(conditionsToScan));
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

      // Load existing matches from cache to see what's already warmed today
      const currentCaches: Record<string, string[]> = {};
      const existingCaches = await db.cache.where('key').startsWith('tech_indicator_matches_').toArray();
      existingCaches.forEach(entry => {
        const entryDate = new Date(entry.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        if (entryDate === todayStr) {
          const conditionId = entry.key.replace('tech_indicator_matches_', '');
          if (Array.isArray(entry.data)) {
            currentCaches[conditionId] = entry.data.map((item: any) => {
              if (typeof item === 'string') return item.toUpperCase();
              return (item.symbol_name || item.Symbol || item.symbol || '').toUpperCase();
            }).filter(Boolean);
          }
        }
      });

      // 2. Queue loop
      for (let i = 0; i < conditionsToScan.length; i++) {
        const conditionId = conditionsToScan[i];
        setWarmingIndicatorStep(i + 1);

        let label = conditionId;
        let indicatorId = '';

        for (const [indId, groups] of Object.entries(CONDITIONS)) {
          for (const conds of Object.values(groups)) {
            const found = conds.find(c => c.id === conditionId);
            if (found) {
              label = found.label;
              indicatorId = indId;
              break;
            }
          }
          if (indicatorId) break;
        }

        if (!indicatorId) {
          console.warn(`[AlphaEngineState] Unknown indicator ID for condition ${conditionId}`);
          continue;
        }

        setWarmingIndicatorLabel(label);

        // Check if today's cache is valid for this condition
        if (currentCaches[conditionId]) {
          console.log(`[AlphaEngineState] Skipping network request. Cache for ${conditionId} is valid for today.`);
          const newMatches = deriveIndicatorMatches(currentCaches);
          setIndicatorMatches(newMatches);
          continue;
        }

        // Fetch from network with 429 backoff
        try {
          const fetchWithRetry = async (
            indId: string,
            condId: string,
            tk: string,
            retriesLeft = 3,
            delayMs = 10000
          ): Promise<any[]> => {
            try {
              return await ShadowScreenerService.fetchTechnicalIndicatorCrossFilter(
                tk,
                indId,
                condId,
                '1D',
                2000
              );
            } catch (err: any) {
              const errStr = String(err);
              if (retriesLeft > 0 && (errStr.includes('429') || (err.message && err.message.includes('429')))) {
                console.warn(`[AlphaEngineState] Rate limited (429) on ${condId}. Retrying in ${delayMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                return fetchWithRetry(indId, condId, tk, retriesLeft - 1, delayMs * 2);
              }
              throw err;
            }
          };

          const data = await fetchWithRetry(indicatorId, conditionId, token);
          
          // Save full API records response in Dexie
          await setDbCache(`tech_indicator_matches_${conditionId}`, data);

          const symbols = data.map((item: any) => (item.symbol_name || '').toUpperCase());
          currentCaches[conditionId] = symbols;
          
          const newMatches = deriveIndicatorMatches(currentCaches);
          setIndicatorMatches(newMatches);

        } catch (err) {
          console.error(`[AlphaEngineState] Failed to crawl ${conditionId}:`, err);
        }

        // 600ms sleep delay between requests to protect endpoint
        await new Promise(resolve => setTimeout(resolve, 600));
      }

      toast.success(`Indicator Engine Warmed successfully!`);
    } catch (err: any) {
      setError(`Indicator Harvester failed: ${err.message || err}`);
    } finally {
      setIsWarmingIndicators(false);
      setWarmingIndicatorStep(0);
      setWarmingIndicatorLabel('');
    }
  };

  const fetchFiiDiiAllData = async (token: string, force: boolean = false) => {
    const activeToken = token || getToken();
    
    if (!force && fiiDiiPulseData.length > 0 && participantOiData.length > 0 && derivativeSummaryData.length > 0) {
      return;
    }

    setError('');
    
    // Fetch Pulse
    setIsFetchingFiiDiiPulse(true);
    const p1 = ShadowScreenerService.fetchFiiDiiPulse(activeToken)
      .then(data => {
        setFiiDiiPulseData(data);
        setDbCache(CACHE_FII_DII_PULSE, data);
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('alpha_fii_dii_pulse', JSON.stringify({ data, timestamp: Date.now() }));
        }
      })
      .catch(err => {
        console.error('Error fetching FII DII Daily flows:', err);
        setError('Failed to fetch FII/DII Daily Flows.');
      })
      .finally(() => setIsFetchingFiiDiiPulse(false));

    // Fetch Participant OI
    setIsFetchingOi(true);
    const p2 = ShadowScreenerService.fetchParticipantOiData(activeToken)
      .then(data => {
        setParticipantOiData(data);
        setDbCache(CACHE_PARTICIPANT_OI, data);
      })
      .catch(err => {
        console.error('Error fetching Participant OI chart data:', err);
        setError(prev => prev ? prev + ' Failed to fetch Participant OI.' : 'Failed to fetch Participant OI.');
      })
      .finally(() => setIsFetchingOi(false));

    // Fetch Derivative Summary
    setIsFetchingSummary(true);
    const p3 = ShadowScreenerService.fetchDerivativeSummary(activeToken)
      .then(data => {
        setDerivativeSummaryData(data);
        setDbCache(CACHE_DERIVATIVE_SUMMARY, data);
      })
      .catch(err => {
        console.error('Error fetching Derivative summary data:', err);
        setError(prev => prev ? prev + ' Failed to fetch Derivatives Summary.' : 'Failed to fetch Derivatives Summary.');
      })
      .finally(() => setIsFetchingSummary(false));

    await Promise.all([p1, p2, p3]);
  };

  const updateSectorsFromRaw = (rawData: any[], timeframe: string) => {
    const tfKey = timeframe === 'day' ? 'change_pct' : `return_${timeframe}`;
    const excluded = ['NIFTY 50', 'NIFTY 500', 'NIFTY NEXT 50', 'NIFTY MIDCAP', 'NIFTY SMALLCAP', 'NIFTY TOTAL MARKET'];

    const mapped = rawData
      .filter(item => {
        const name = item.index_name.toUpperCase();
        return !excluded.some(ex => name === ex) && item.market_cap > 0;
      })
      .map(item => ({
        name: item.index_name.replace(/Nifty\s+/gi, '').replace(/NIFTY\s+/gi, '').trim().toUpperCase(),
        change: parseFloat(item[tfKey]) || 0,
        price: item.close_price || 0,
        symbol: item.symbol || '',
        marketCap: item.market_cap || 100,
        timeframe: timeframe
      })).sort((a, b) => b.change - a.change);
    setSectors(mapped);
  };

  const handleDirectInjection = (type: 'bridge' | 'bridge-sector', source?: 'master' | 'pulse') => {
    try {
      setError('');
      const code = type === 'bridge-sector' ? sectorBridgeCode : (source === 'pulse' ? pulseBridgeCode : bridgeCode);
      if (!code) return;

      const trimmed = code.trim();

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          processDatabase(parsed, source);
          return;
        } catch (e) {
          setError('Invalid JSON format. Make sure you copied the entire Response body.');
          return;
        }
      }

      if (trimmed.includes('fetch(') || trimmed.startsWith('fetch')) {
        setCorsGuideSource(source === 'pulse' ? 'stockezee' : 'cash');
        setShowCorsGuide(true);
        return;
      }

      // SECURITY FIX: Dynamic code execution via new Function() removed to prevent XSS.
      // We strictly require valid JSON.
      throw new Error('Only valid JSON is supported for injection. JavaScript execution is blocked for security.');
    } catch (err: unknown) {
      setError('Paste valid JSON from the Network > Response tab, not the Fetch code.');
    }
  };

  const handleClipboardInjection = async (source: 'master' | 'pulse' | 'sniper') => {
    try {
      setError('');

      if (source === 'master' && intraMode === 'cash') {
        const proxyWorked = await fetchStockeZeeProxy();
        if (proxyWorked) return;
      }

      const text = await navigator.clipboard.readText();
      if (!text) throw new Error('Clipboard is empty. Copy the JSON first.');
      const trimmed = text.trim();

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (source === 'sniper') handleSniperList(parsed);
          else processDatabase(parsed, source as 'master' | 'pulse');
          return;
        } catch (e) {
          setError('Invalid JSON. Make sure you copied the entire Response body from the Network tab.');
          return;
        }
      }

      if (trimmed.includes('fetch(') || trimmed.startsWith('fetch')) {
        setCorsGuideSource(source === 'pulse' ? 'stockezee' : 'cash');
        setShowCorsGuide(true);
        return;
      }

      setError('Unrecognised data. Please paste the JSON from Network → Response tab (not "Copy as fetch").');
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setError('Clipboard access denied. Grant permission or use Bridge Config.');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Clipboard Error: ${message}`);
      }
    }
  };

  const handleManualFiiDiiPaste = (jsonText: string): { success: boolean; message: string; sectionsUpdated: string[]; importedDate?: string } => {
    try {
      if (!jsonText || !jsonText.trim()) {
        return { success: false, message: 'JSON content is empty.', sectionsUpdated: [] };
      }
      
      const trimmed = jsonText.trim();
      let parsed: any = null;
      
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        parsed = JSON.parse(trimmed);
      } else {
        // SECURITY FIX: Dynamic code execution via new Function() removed to prevent XSS.
        return { success: false, message: 'Invalid format. Only valid JSON is supported for injection.', sectionsUpdated: [] };
      }

      if (!parsed) {
        return { success: false, message: 'Failed to parse JSON content.', sectionsUpdated: [] };
      }

      const sectionsUpdated: string[] = [];
      let fiiDiiPulse: FiiDiiFlowsItem[] | null = null;
      let participantOi: ParticipantOiItem[] | null = null;
      let derivativeSummary: DerivativeSummaryItem[] | null = null;

      const normalizeDate = (dStr: any): string => {
        if (!dStr) return '';
        try {
          const d = new Date(dStr);
          if (isNaN(d.getTime())) return String(dStr).split('T')[0];
          return d.toISOString().split('T')[0];
        } catch {
          return String(dStr).split('T')[0];
        }
      };

      const searchForData = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        
        // 1. FII DII Pulse
        if (obj.initialData && Array.isArray(obj.initialData)) {
          fiiDiiPulse = obj.initialData;
        } else if (obj.fiiDiiPulse && Array.isArray(obj.fiiDiiPulse)) {
          fiiDiiPulse = obj.fiiDiiPulse;
        } else if (Array.isArray(obj) && obj.length > 0 && (obj[0].fii_cash || obj[0].fii_oi || obj[0].date)) {
          fiiDiiPulse = obj;
        } else if (!Array.isArray(obj) && obj.date && (obj.fii_cash || obj.fii_oi)) {
          fiiDiiPulse = [obj];
        }

        // 2. Participant OI
        if (obj.resultData && obj.resultData.data && Array.isArray(obj.resultData.data)) {
          participantOi = obj.resultData.data;
        } else if (obj.participantOi && Array.isArray(obj.participantOi)) {
          participantOi = obj.participantOi;
        } else if (Array.isArray(obj) && obj.length > 0 && (obj[0].client_long || obj[0].client_short)) {
          participantOi = obj;
        } else if (!Array.isArray(obj) && obj.date && (obj.client_type || obj.future_index_long !== undefined)) {
          participantOi = [obj];
        }

        // 3. Derivative Summary
        if (obj.resultData && Array.isArray(obj.resultData) && obj.resultData.length > 0 && (obj.resultData[0].total_calls_buy || obj.resultData[0].derivative_type)) {
          derivativeSummary = obj.resultData;
        } else if (obj.derivativeSummary && Array.isArray(obj.derivativeSummary)) {
          derivativeSummary = obj.derivativeSummary;
        } else if (Array.isArray(obj) && obj.length > 0 && (obj[0].total_calls_buy || obj[0].derivative_type)) {
          derivativeSummary = obj;
        } else if (!Array.isArray(obj) && obj.symbol_name && obj.expiry_date && (obj.oi !== undefined || obj.built_up)) {
          derivativeSummary = [obj];
        }

        if (!fiiDiiPulse || !participantOi || !derivativeSummary) {
          for (const key of Object.keys(obj)) {
            if (obj[key] && typeof obj[key] === 'object') {
              if (!Array.isArray(obj[key])) {
                searchForData(obj[key]);
              }
            }
          }
        }
      };

      searchForData(parsed);

      if (parsed.pageProps) {
        if (parsed.pageProps.initialData) fiiDiiPulse = parsed.pageProps.initialData;
        if (parsed.pageProps.fiiDiiPulse) fiiDiiPulse = parsed.pageProps.fiiDiiPulse;
      }

      // Check root level fallback for single flow object
      if (!fiiDiiPulse && parsed && !Array.isArray(parsed) && parsed.date && (parsed.fii_cash || parsed.fii_oi)) {
        fiiDiiPulse = [parsed];
      }

      if (fiiDiiPulse && Array.isArray(fiiDiiPulse)) {
        setFiiDiiPulseData(prev => {
          const prevList = Array.isArray(prev) ? prev : [];
          const mergedMap = new Map<string, any>();
          prevList.forEach(item => {
            if (item && item.date) {
              mergedMap.set(normalizeDate(item.date), item);
            }
          });
          fiiDiiPulse!.forEach((item: FiiDiiFlowsItem) => {
            if (item && item.date) {
              mergedMap.set(normalizeDate(item.date), item);
            }
          });
           const mergedList = Array.from(mergedMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          setDbCache(CACHE_FII_DII_PULSE, mergedList);
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem('alpha_fii_dii_pulse', JSON.stringify({ data: mergedList, timestamp: Date.now() }));
          }
          return mergedList;
        });
        sectionsUpdated.push('FII/DII Pulse');
      }

      if (participantOi && Array.isArray(participantOi)) {
        setParticipantOiData(prev => {
          const prevList = Array.isArray(prev) ? prev : [];
          const mergedMap = new Map<string, any>();
          prevList.forEach(item => {
            if (item && item.date && item.client_type) {
              mergedMap.set(`${normalizeDate(item.date)}_${item.client_type}`, item);
            }
          });
          participantOi!.forEach((item: ParticipantOiItem) => {
            if (item && item.date && item.client_type) {
              mergedMap.set(`${normalizeDate(item.date)}_${item.client_type}`, item);
            }
          });
          const mergedList = Array.from(mergedMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          setDbCache(CACHE_PARTICIPANT_OI, mergedList);
          return mergedList;
        });
        sectionsUpdated.push('Participant OI');
      }

      if (derivativeSummary && Array.isArray(derivativeSummary)) {
        setDerivativeSummaryData(derivativeSummary);
        setDbCache(CACHE_DERIVATIVE_SUMMARY, derivativeSummary);
        sectionsUpdated.push('Derivative Summary');
      }

      let importedDate: string | undefined = undefined;
      const pulseList = fiiDiiPulse as FiiDiiFlowsItem[] | null;
      const oiList = participantOi as ParticipantOiItem[] | null;
      if (pulseList && pulseList.length > 0 && pulseList[0].date) {
        importedDate = normalizeDate(pulseList[0].date);
      } else if (oiList && oiList.length > 0 && oiList[0].date) {
        importedDate = normalizeDate(oiList[0].date);
      }

      if (sectionsUpdated.length > 0) {
        return {
          success: true,
          message: `Successfully imported: ${sectionsUpdated.join(', ')}`,
          sectionsUpdated,
          importedDate
        };
      }

      return {
        success: false,
        message: 'Could not identify any valid FII/DII data sections in the pasted JSON. Ensure you are copying the response from Stockezee fii-dii-data.json or participant-oi-chart-data.',
        sectionsUpdated: []
      };
    } catch (e: any) {
      return { success: false, message: `Parsing failed: ${e.message}`, sectionsUpdated: [] };
    }
  };

  const handleSniperList = (list: any) => {
    if (masterStocks.length === 0) {
      setError("Load Master DB first before using Sniper.");
      return;
    }
    const symbolList = Array.isArray(list) ? list : (list.symbols || []);
    if (symbolList.length === 0) return;

    const sniperSet = new Set(symbolList.map((s: any) => (typeof s === 'string' ? s : s.symbol || s.Symbol || '').toUpperCase()));
    const filtered = masterStocks.filter(s => sniperSet.has(s.Symbol.toUpperCase()));
    setStocks(filtered);
    setIsSniperActive(true);
  };

  const saveBridgeConfig = (code1: string, code2: string, codePulse: string) => {
    setBridgeCode(code1);
    setSectorBridgeCode(code2);
    setPulseBridgeCode(codePulse);
    localStorage.setItem('alpha_bridge_code', code1);
    localStorage.setItem('alpha_bridge_sector_code', code2);
    localStorage.setItem('alpha_bridge_pulse_code', codePulse);
    setIsBridgeConfigOpen(false);
    if (activeBridgeTab === 'master') {
      if (code1) handleDirectInjection('bridge', 'master');
      if (code2) handleDirectInjection('bridge-sector');
    } else if (activeBridgeTab === 'pulse') {
      if (codePulse) handleDirectInjection('bridge', 'pulse');
    }
  };

  const filteredConvergenceResults = useMemo(() => {
    const fnoSymbols = new Set(FNO_STOCKS.map(x => x.symbol.toUpperCase()));
    if (intraMode === 'fno') {
      return convergenceResults.filter(s => s.symbol && fnoSymbols.has(s.symbol.toUpperCase()));
    } else if (intraMode === 'cash') {
      return convergenceResults.filter(s => s.symbol && !fnoSymbols.has(s.symbol.toUpperCase()));
    }
    return convergenceResults;
  }, [convergenceResults, intraMode]);

  const filteredResultsCalendar = useMemo(() => {
    const fnoSymbols = new Set(FNO_STOCKS.map(x => x.symbol.toUpperCase()));
    if (intraMode === 'fno') {
      return resultsCalendarData.filter(s => s.symbol && fnoSymbols.has(s.symbol.toUpperCase()));
    } else if (intraMode === 'cash') {
      return resultsCalendarData.filter(s => s.symbol && !fnoSymbols.has(s.symbol.toUpperCase()));
    }
    return resultsCalendarData;
  }, [resultsCalendarData, intraMode]);

  // ──────────────────────────────────────────────────────────────────────
  // CC68.32 — warmAllAlphaCaches (Phase 6)
  //
  // 19 steps, 1.5s breathing gap, fail-soft (one failure doesn't abort
  // the rest). Replaces the old 8-step `warmAllCaches` that lived in
  // `AlphaEngineTab.tsx`. Now also installs the F&O lot-size map into
  // `gexExtractor` (closes the Phase-1 lot-size gap) on Step 14.
  //
  // Idempotent: if called while a warm is in progress, the second call
  // is a no-op (controlled by the `isWarming` ref). Auto-fires once
  // when the Shadow Screener tab opens during active market hours.
  // ──────────────────────────────────────────────────────────────────────

  const isWarmingRef = useRef(false);
  const [isWarming, setIsWarming] = useState(false);
  const [warmingStep, setWarmingStep] = useState(0);
  const [warmingLabel, setWarmingLabel] = useState('');
  const hasAutoWarmedRef = useRef(false);

  const warmAllAlphaCaches = async (token?: string) => {
    if (isWarmingRef.current) return;
    isWarmingRef.current = true;
    setIsWarming(true);
    setError('');

    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
    const tk = token ?? getToken();
    if (!tk && !stockezeeToken) {
      setError('StockeZee token missing. Warm-up requires token. Live cards will still render via Dexie cache.');
      isWarmingRef.current = false;
      setIsWarming(false);
      // continue anyway — many fetches have local fallbacks
    }

    const activeToken = tk || stockezeeToken || '';

    // 19 steps total. Each step is its own try/catch so one failure
    // does not abort the rest.
    type Step = { label: string; action: () => Promise<void> | void };
    const steps: Step[] = [
      { label: 'ORB 15m PRB',           action: () => fetchORBData(15, true, true) },
      { label: 'ORB 30m PRB',           action: () => fetchORBData(30, true, true) },
      { label: 'ORB 45m PRB',           action: () => fetchORBData(45, true, true) },
      { label: 'ORB 60m PRB',           action: () => fetchORBData(60, true, true) },
      { label: 'Daily Candles',         action: () => fetchCandlestickData('daily', true) },
      { label: 'Weekly Candles',        action: () => fetchCandlestickData('weekly', true) },
      { label: 'Valuation (under)',     action: () => fetchValuationData('under_valued', true) },
      { label: 'Valuation (over)',      action: () => fetchValuationData('over_valued', true) },
      { label: 'Shareholding FII buy',  action: () => fetchShareholdingData('fii', 'buy', true) },
      { label: 'Shareholding FII sell', action: () => fetchShareholdingData('fii', 'sell', true) },
      { label: 'Shareholding Promoter buy',  action: () => fetchShareholdingData('promoter', 'buy', true) },
      { label: 'Shareholding Promoter sell', action: () => fetchShareholdingData('promoter', 'sell', true) },
      { label: 'Quality (total high + low)', action: () => fetchQualityData('total_score', 'high', true) },
      { label: 'F&O Lot Sizes',         action: () => fetchLotSizesData(true) },
      { label: 'Earnings Calendar',     action: () => fetchResultsCalendarData(true) },
      { label: 'Historical gainers (week + month)', action: () => fetchHistoricalData('gainers', 'week', true) },
      { label: 'Historical losers (week + month)',  action: () => fetchHistoricalData('loosers', 'week', true) },
      { label: 'FII/DII Pulse (3 endpoints)', action: () => fetchFiiDiiAllData(activeToken, true) },
      { label: 'Cash Segment Universe', action: async () => { await fetchStockeZeeProxy(activeToken); } },
    ];

    for (let i = 0; i < steps.length; i++) {
      setWarmingStep(i + 1);
      setWarmingLabel(steps[i].label);
      try {
        await steps[i].action();
      } catch (err) {
        // Fail-soft: log and continue. One failed fetch shouldn't block the rest.
        console.warn(`[CC68.32] Warm step ${i + 1} (${steps[i].label}) failed:`, err);
      }
      // 1.5s breathing period to avoid API rate limits
      await delay(1500);
    }

    // After all caches are warm, install the lot-size map into gexExtractor.
    // This is the Phase-1 lot-size fix: F&O stocks now get their real lot
    // size for GEX instead of the hard-coded 50.
    try {
      const { setLotSizeMap } = await import('../../services/mce/gexExtractor');
      const map = new Map<string, number>();
      for (const row of lotSizesData ?? []) {
        const symbol = (row.symbol || row.underlying || '').toUpperCase();
        if (!symbol) continue;
        const monthData = row.month_data;
        if (!monthData) continue;
        let parsed: any;
        if (typeof monthData === 'string') {
          try { parsed = JSON.parse(monthData); } catch { continue; }
        } else {
          parsed = monthData;
        }
        const firstKey = Object.keys(parsed || {})[0];
        if (firstKey) {
          const lot = parseInt(parsed[firstKey], 10);
          if (Number.isFinite(lot) && lot > 0) {
            map.set(symbol, lot);
          }
        }
      }
      setLotSizeMap(map);
    } catch (err) {
      console.warn('[CC68.32] Failed to install lot-size map into gexExtractor:', err);
    }

    setIsWarming(false);
    setWarmingStep(0);
    setWarmingLabel('');
    isWarmingRef.current = false;
  };

  const isFetchingIntelligenceRef = useRef(false);
  const [isFetchingIntelligence, setIsFetchingIntelligence] = useState(false);

  const fetchAllStockezeeIntelligence = async (overrideToken?: string, force: boolean = false) => {
    const token = overrideToken?.trim() || getToken();
    if (!token || isFetchingIntelligenceRef.current) return;

    isFetchingIntelligenceRef.current = true;
    setIsFetchingIntelligence(true);

    try {
      console.log('[StockeZee Intelligence] Initiating parallel multi-data ingestion...');
      await Promise.allSettled([
        // 1. Intraday Booster Momentum Velocity
        fetchBoosterProxy(token),
        // 2. Multi-Timeframe ORB Breakouts (15m and 30m)
        fetchORBData(15, false, force),
        fetchORBData(30, false, force),
        // 3. 15m ORB + Previous Range Breakout (PRB)
        fetchORBData(15, true, force),
        // 4. Fundamental Quality Scorecard (Total High Scores)
        fetchQualityData('total_score', 'high', force),
        // 5. Institutional Shareholding (FII & Promoter Accumulation)
        fetchShareholdingData('fii', 'buy', force),
        fetchShareholdingData('promoter', 'buy', force),
        // 6. Valuation Screener (Undervalued Margin of Safety)
        fetchValuationData('under_valued', force),
        // 7. Daily Candlestick Patterns
        fetchCandlestickData('daily', force),
        // 8. FII-DII Macro Flows
        fetchFiiDiiAllData(token, force),
        // 9. Forthcoming Earnings & Board Meeting Results Calendar
        fetchResultsCalendarData(force),
        // 10. Multi-Day Resistance Range High Breakout Signal
        fetchIndicatorScreenerAction('price-action', 'range_high_breakout', force),
        // 11. 5-Minute VWAP Institutional Support Crossover
        fetchIndicatorScreenerAction('vwap', 'vwap_5min_cross_above', force)
      ]);
      console.log('[StockeZee Intelligence] Multi-data ingestion complete across all 11 endpoints.');
    } catch (err) {
      console.warn('[StockeZee Intelligence] Ingestion encountered minor errors:', err);
    } finally {
      isFetchingIntelligenceRef.current = false;
      setIsFetchingIntelligence(false);
    }
  };

  // Auto-fire fast parallel intelligence ingestion when token exists
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetchAllStockezeeIntelligence(token, false);
  }, []);

  // Sync on manual refresh trigger
  useEffect(() => {
    if (refreshCount > 0) {
      const token = getToken();
      if (token) fetchAllStockezeeIntelligence(token, true);
    }
  }, [refreshCount]);

  return {
    isCacheLoading,
    stocks,
    setStocks,
    masterStocks,
    setMasterStocks,
    isPasting,
    setIsPasting,
    error,
    setError,
    isSniperActive,
    setIsSniperActive,
    searchTerm,
    setSearchTerm,
    textAreaRef,
    engineMode,
    setEngineMode,
    pulseStocks,
    setPulseStocks,
    pulseCategorized,
    setPulseCategorized,
    showCorsGuide,
    setShowCorsGuide,
    corsGuideSource,
    setCorsGuideSource,
    stockezeeToken,
    setStockezeeToken,
    intraMode,
    setIntraMode,
    isVisible,
    selectedSector,
    setSelectedSector,
    selectedStock,
    setSelectedStock,
    isAutoRefresh,
    setIsAutoRefresh,
    refreshCount,
    setRefreshCount,
    isBridgeConfigOpen,
    setIsBridgeConfigOpen,
    bridgeCode,
    setBridgeCode,
    sectorBridgeCode,
    setSectorBridgeCode,
    pulseBridgeCode,
    setPulseBridgeCode,
    pulseFilter,
    setPulseFilter,
    activeBridgeTab,
    setActiveBridgeTab,
    boosterStocksList,
    setBoosterStocksList,
    boosterTrend,
    setBoosterTrend,
    isFetchingBoosterScanner,
    setIsFetchingBoosterScanner,
    shadowMode,
    setShadowMode,
    selectedCandlePattern,
    setSelectedCandlePattern,
    dailyCandleData,
    setDailyCandleData,
    weeklyCandleData,
    setWeeklyCandleData,
    isFetchingCandles,
    setIsFetchingCandles,
    candleTimeframe,
    setCandleTimeframe,
    historicalDataCache,
    setHistoricalDataCache,
    historicalTimeframe,
    setHistoricalTimeframe,
    historicalType,
    setHistoricalType,
    isFetchingHistorical,
    setIsFetchingHistorical,
    orbDataCache,
    setOrbDataCache,
    orbMinutes,
    setOrbMinutes,
    orbWithPrb,
    setOrbWithPrb,
    isFetchingORB,
    setIsFetchingORB,
    valuationDataCache,
    setValuationDataCache,
    valuationType,
    setValuationType,
    isFetchingValuation,
    setIsFetchingValuation,
    resultsCalendarData: filteredResultsCalendar,
    setResultsCalendarData,
    isFetchingResults,
    setIsFetchingResults,
    lotSizesData,
    setLotSizesData,
    isFetchingLotSizes,
    setIsFetchingLotSizes,
    fiiDiiPulseData,
    setFiiDiiPulseData,
    participantOiData,
    setParticipantOiData,
    derivativeSummaryData,
    setDerivativeSummaryData,
    isFetchingFiiDiiPulse,
    isFetchingOi,
    isFetchingSummary,
    shareholdingDataCache,
    setShareholdingDataCache,
    shareholdingInvestor,
    setShareholdingInvestor,
    shareholdingTrans,
    setShareholdingTrans,
    isFetchingShareholding,
    setIsFetchingShareholding,
    qualityDataCache,
    setQualityDataCache,
    qualityScoreType,
    setQualityScoreType,
    qualityFilter,
    setQualityFilter,
    isFetchingQuality,
    setIsFetchingQuality,
    isFetchingLive,
    setIsFetchingLive,
    isFetchingPulse,
    setIsFetchingPulse,
    isFetchingSectors,
    setIsFetchingSectors,
    isFetchingBooster,
    setIsFetchingBooster,
    sectorTimeframe,
    setSectorTimeframe,
    sectorRawData,
    setSectorRawData,
    sectors,
    setSectors,
    activeDrillSector,
    setActiveDrillSector,
    convergenceResults: filteredConvergenceResults,
    setConvergenceResults,
    isScanningConvergence,
    setIsScanningConvergence,
    isConvergenceWorkerBusy,
    convergenceDirection,
    setConvergenceDirection,
    convergenceMode,
    setConvergenceMode,
    boosterRawData,
    setBoosterRawData,
    boosterStocks,
    setBoosterStocks,
    filterType,
    setFilterType,

    perfectConvergenceAlerts,
    setPerfectConvergenceAlerts,
    activeDataSource,
    pulseFilteredData,
    fnoMovementsFilteredData,
    fnoMovementsFiltered,
    filteredBoosterStocks,
    filteredStocks,
    bullishStocks,
    bearishStocks,
    filteredByQuickType,

    // CC68.32 — Warm-all state
    isWarming,
    warmingStep,
    warmingLabel,
    warmAllAlphaCaches,
    fetchAllStockezeeIntelligence,
    isFetchingIntelligence,
    getToken,
    fetchStockeZeeProxy,
    fetchPulseProxy,
    fetchBoosterProxy,
    fetchSectorAnalysis,
    fetchSectorBooster,
    fetchCandlestickData,
    fetchHistoricalData,
    fetchORBData,
    fetchValuationData,
    fetchResultsCalendarData,
    fetchLotSizesData,
    fetchFiiDiiAllData,
    fetchShareholdingData,
    fetchQualityData,
    handleDirectInjection,
    handleClipboardInjection,
    handleManualFiiDiiPaste,
    handleSniperList,
    saveBridgeConfig,
    processDatabase,
    advancedFilters,
    setAdvancedFilters,
    volumeAverages,
    setVolumeAverages,
    pcrGate,
    pcrValue,
    macroBias,
    fiiCashNet,
    isFetchingMacroAndPcr,
    fetchMacroAndPcr,
    oreMap,
    cvdMap,
    rsMap,
    patternMap,
    shareholdingMap,
    oiSignalMap,
    fetchAlphaSignals,
    triggerAllAlphaScans,

    // --- TECHNICAL INDICATORS SCREENER ---
    prebuildScreens,
    selectedIndicator,
    setSelectedIndicator,
    selectedCondition,
    setSelectedCondition,
    indicatorScreenerData,
    screenerLoading,
    fetchPrebuildScreensAction,
    fetchIndicatorScreenerAction,
    isWarmingIndicators,
    warmingIndicatorStep,
    warmingIndicatorLabel,
    indicatorMatches,
    warmTechnicalIndicators
  };
};

export default useAlphaEngineState;
