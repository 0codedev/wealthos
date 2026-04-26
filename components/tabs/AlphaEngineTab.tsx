import React, { Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Zap, Terminal, ShieldAlert, BarChart3, Search, Activity, RefreshCw, Upload, Clipboard, TrendingUp, TrendingDown, Clock, ExternalLink, Database, SlidersHorizontal, Filter, X, ChevronDown, Bot, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs } from '../ui/AnimatedTabs';
import { ActionButton } from '../ui/ActionButton';
import { useAlphaEngineState, StockData, AdvancedFilters } from '../../hooks/alpha/useAlphaEngineState';
import { useSectorDepthStream } from '../../hooks/useSectorDepthStream';
import { useRefreshProgressStore } from '../../store/refreshProgressStore';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useMorningMomentumStore } from '../../store/morningMomentumStore';
import { useShallow } from 'zustand/react/shallow';
import { CapabilityWarningDot } from '../shared/CapabilityWarningDot';
import { openTradingView } from '../../utils/navigation';
import { SECTOR_CONSTITUENTS } from '../../data/sectorConstituents';
import { isAlphaActiveHours } from '../../types/trust';

// Core components (used in initial render)
import StockTable from '../alpha/ShadowTerminal/StockTable';
import SectorBoosterPanel from '../alpha/SectorBoosterPanel';
import { ConvergenceBriefPanel } from '../alpha/ConvergenceBriefPanel';
import { MomentumContinuationWidget } from '../alpha/MomentumContinuationWidget';
import { FnoFocusPanel } from '../alpha/FnoFocusPanel';
import { useAutopilot } from '../../hooks/alpha/useAutopilot';
import { AutopilotControlPanel } from '../alpha/AutopilotControlPanel';
import { AutopilotResultsPanel } from '../alpha/AutopilotResultsPanel';
import { useSettingsStore } from '../../store/settingsStore';
import { syncEngine } from '../../services/SyncEngine';

// Lazy-loaded subcomponents (conditioned on activeSubTab/shadowMode)
const ScreenerGridMenu = React.lazy(() => import('../alpha/ScreenerGridMenu'));
const HeatmapMatrixPanel = React.lazy(() => import('../alpha/HeatmapMatrixPanel'));
const SmartWatchlist = React.lazy(() => import('../dashboard/widgets/SmartWatchlist'));

// Lazy-loaded widgets for F&O Scanner (used in specific modes)
const MarketMoodWidget = React.lazy(() => import('../alpha/MarketMoodWidget'));
const SectorScopeWidget = React.lazy(() => import('../alpha/SectorScopeWidget'));
const StockScreenerWidget = React.lazy(() => import('../alpha/StockScreenerWidget'));
const OptionLauncherWidget = React.lazy(() => import('../alpha/OptionLauncherWidget'));
const MomentumRangeBar = React.lazy(() => import('../alpha/MomentumRangeBar'));
const IntradayBoostPanel = React.lazy(() => import('../alpha/IntradayBoostPanel'));
const TradeSniperPanel = React.lazy(() => import('../alpha/TradeSniperPanel'));
const CashRadarPanel = React.lazy(() => import('../alpha/CashRadarPanel'));
const ZeroHesitationTrigger = React.lazy(() => import('../execution/ZeroHesitationTrigger').then(m => ({ default: m.ZeroHesitationTrigger })));
const TacticalArsenal = React.lazy(() => import('../playbooks/TacticalArsenal').then(m => ({ default: m.TacticalArsenal })));
const SlowAccumulatorRadar = React.lazy(() => import('../cash/SlowAccumulatorRadar').then(m => ({ default: m.SlowAccumulatorRadar })));
const SectorVelocityRadar = React.lazy(() => import('../sectors/SectorVelocityRadar').then(m => ({ default: m.SectorVelocityRadar })));
const InstitutionalMacroRadar = React.lazy(() => import('../macro/InstitutionalMacroRadar').then(m => ({ default: m.InstitutionalMacroRadar })));

// Lazy-loaded widget modules
const MarketRegimeWidget = React.lazy(() => import('../alpha/widgets/MarketRegimeWidget').then(m => ({ default: m.MarketRegimeWidget })));
const SmartMoneyCompass = React.lazy(() => import('../alpha/widgets/SmartMoneyCompass').then(m => ({ default: m.SmartMoneyCompass })));
const MorningBriefModal = React.lazy(() => import('../alpha/widgets/MorningBriefModal').then(m => ({ default: m.MorningBriefModal })));
const MarketCommandCenter = React.lazy(() => import('../alpha/widgets/MarketCommandCenter').then(m => ({ default: m.MarketCommandCenter })));

// Lazy-loaded heavy components (screener terminal modes)
const MomentumHub = React.lazy(() => import('../momentum/MomentumHub'));
const CandlestickPatternTable = React.lazy(() => import('../alpha/ShadowTerminal/CandlestickPatternTable').then(m => ({ default: m.CandlestickPatternTable })));
const ORBTable = React.lazy(() => import('../alpha/ShadowTerminal/ORBTable'));
const ValuationTable = React.lazy(() => import('../alpha/ShadowTerminal/ValuationTable'));
const ConvergenceTable = React.lazy(() => import('../alpha/ShadowTerminal/ConvergenceTable').then(m => ({ default: m.ConvergenceTable })));
const ResultsCalendarTable = React.lazy(() => import('../alpha/ShadowTerminal/ResultsCalendarTable').then(m => ({ default: m.ResultsCalendarTable })));
const ShareholdingActivityTable = React.lazy(() => import('../alpha/ShadowTerminal/ShareholdingActivityTable').then(m => ({ default: m.ShareholdingActivityTable })));
const QualityScorecard = React.lazy(() => import('../alpha/ShadowTerminal/QualityScorecard').then(m => ({ default: m.QualityScorecard })));
const LotSizeTable = React.lazy(() => import('../alpha/ShadowTerminal/LotSizeTable').then(m => ({ default: m.LotSizeTable })));
const DeliveryAccumulationWidget = React.lazy(() => import('../alpha/DeliveryAccumulationWidget').then(m => ({ default: m.DeliveryAccumulationWidget })));
const MfFlowWidget = React.lazy(() => import('../alpha/MfFlowWidget').then(m => ({ default: m.MfFlowWidget })));
const InsiderTradingWidget = React.lazy(() => import('../alpha/InsiderTradingWidget').then(m => ({ default: m.InsiderTradingWidget })));
const OrderFlowDashboardWidget = React.lazy(() => import('../alpha/OrderFlowDashboardWidget').then(m => ({ default: m.OrderFlowDashboardWidget })));

// Already lazy-loaded
const FiiDiiPulseDashboard = React.lazy(() => import('../alpha/ShadowTerminal/FiiDiiPulseDashboard'));
const OIPcrCommandCenter = React.lazy(() => import('../alpha/ShadowTerminal/OIPcrCommandCenter'));
const TechnicalIndicatorPanel = React.lazy(() => import('../alpha/TechnicalIndicatorPanel'));
const SmartlistRadar = React.lazy(() => import('../alpha/ShadowTerminal/SmartlistRadar').then(m => ({ default: m.SmartlistRadar })));
const SnapshotTimelinePanel = React.lazy(() => import('../alpha/SnapshotTimelinePanel').then(m => ({ default: m.SnapshotTimelinePanel })));

// Services (keep synchronous as they're lightweight utilities)
import { ShadowScreenerService } from '../../services/alpha/ShadowScreenerService';
import { ConvergenceEngine } from '../../services/alpha/ConvergenceEngine';
import { marketAnomalyDetector } from '../../services/ml/MarketAnomalyDetector';
import { psychologyPredictor } from '../../services/ml/PsychologyPredictor';
import { FeatureHistoryCapture } from '../../services/ml/FeatureHistoryCapture';

// Loading fallback for lazy components
const LazyLoader = () => (
  <div className="min-h-[200px] flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
  </div>
);

export { getSignal } from '../../services/alpha/StrategyEngine';

const STRATEGY_PRESETS = [
  { id: 'all', label: 'All Assets', desc: 'No presets applied' },
  { id: 'momentum', label: 'Momentum Snipes', desc: 'Change > 3%, Score > 100' },
  { id: 'value', label: 'Value Focus', desc: 'PE 1-20, Dividend > 1%' },
  { id: 'breakout', label: 'Daily Breakouts', desc: 'Price near High >= 98%' },
  { id: 'oversold', label: 'Oversold Dip', desc: 'Change < -5%' },
  { id: 'high_volume', label: 'High Liquidity', desc: 'Volume >= 100K' },
  { id: 'low_pe', label: 'Low PE Ratio', desc: 'PE 1-25' },
  { id: 'mid_large_cap', label: 'Mid & Large Cap', desc: 'Market Cap >= 2000 Cr' },
  { id: 'inst_grade', label: 'Institutional Grade', desc: 'IGS > 0.75' },
  { id: 'footprint_confirmed', label: 'Footprint Confirmed', desc: 'ORE > 0.70 & IGS > 0.70' },
];

interface AlphaEngineTabProps {
  activeSubTab: 'intraday' | 'screener' | 'heatmap' | 'market-command';
  onTabChange?: (tab: 'intraday' | 'screener' | 'heatmap' | 'market-command') => void;
}

export const AlphaEngineTab: React.FC<AlphaEngineTabProps> = ({ activeSubTab, onTabChange }) => {
  const investments = usePortfolioStore(useShallow(s => s.investments));
  const setMorningFocusMode = useMorningMomentumStore(s => s.setFocusMode);
  const portfolioSymbols = React.useMemo(() => {
    return (investments || []).map(inv => inv.ticker?.toUpperCase() || inv.name.toUpperCase()).filter(Boolean);
  }, [investments]);
  const {
    isCacheLoading,
    stocks,
    setStocks,
    masterStocks,
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
    showCorsGuide,
    setShowCorsGuide,
    corsGuideSource,
    stockezeeToken,
    setStockezeeToken,
    intraMode,
    setIntraMode,
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
    boosterTrend,
    setBoosterTrend,
    isFetchingBoosterScanner,
    shadowMode,
    setShadowMode,
    selectedCandlePattern,
    setSelectedCandlePattern,
    dailyCandleData,
    weeklyCandleData,
    isFetchingCandles,
    candleTimeframe,
    setCandleTimeframe,
    historicalDataCache,
    historicalTimeframe,
    setHistoricalTimeframe,
    historicalType,
    setHistoricalType,
    isFetchingHistorical,
    orbDataCache,
    orbMinutes,
    setOrbMinutes,
    orbWithPrb,
    setOrbWithPrb,
    isFetchingORB,
    valuationDataCache,
    valuationType,
    setValuationType,
    isFetchingValuation,
    resultsCalendarData,
    isFetchingResults,
    lotSizesData,
    isFetchingLotSizes,
    shareholdingDataCache,
    shareholdingInvestor,
    setShareholdingInvestor,
    shareholdingTrans,
    setShareholdingTrans,
    isFetchingShareholding,
    qualityDataCache,
    qualityScoreType,
    setQualityScoreType,
    qualityFilter,
    setQualityFilter,
    isFetchingQuality,
    isFetchingLive,
    isFetchingPulse,
    isFetchingSectors,
    isFetchingBooster,
    sectorTimeframe,
    setSectorTimeframe,
    sectors,
    activeDrillSector,
    setActiveDrillSector,
    convergenceResults,
    setConvergenceResults,
    isScanningConvergence,
    setIsScanningConvergence,
    convergenceDirection,
    setConvergenceDirection,
    convergenceMode,
    setConvergenceMode,
    boosterRawData,
    boosterStocks,
    filterType,
    setFilterType,
    perfectConvergenceAlerts,
    fnoMovementsFiltered,
    filteredBoosterStocks,
    boosterStocksList,
    filteredStocks,
    bullishStocks,
    bearishStocks,
    filteredByQuickType,
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
    fetchShareholdingData,
    fetchQualityData,
    fetchLotSizesData,
    fetchFiiDiiAllData,
    fiiDiiPulseData,
    participantOiData,
    derivativeSummaryData,
    isFetchingFiiDiiPulse,
    isFetchingOi,
    isFetchingSummary,
    handleDirectInjection,
    handleClipboardInjection,
    handleManualFiiDiiPaste,
    saveBridgeConfig,
    processDatabase,
    pulseCategorized,
    isVisible,
    advancedFilters,
    setAdvancedFilters,
    volumeAverages,
    setVolumeAverages,
    pcrGate,
    pcrValue,
    macroBias,
    fiiCashNet,
    oreMap,
    cvdMap,
    rsMap,
    patternMap,
    shareholdingMap,
    oiSignalMap,

    // CC68.32 — Warm-all state now lives in the hook. The 19-step
    // `warmAllAlphaCaches` function runs 12 cache fetches + 7 sub-fetches
    // (4 ORB timeframes, both valuation types, both shareholding segments,
    // etc.) and auto-installs the F&O lot-size map into gexExtractor.
    isWarming,
    warmingStep,
    warmingLabel,
    warmAllAlphaCaches,

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
    warmTechnicalIndicators,
    indicatorMatches
  } = useAlphaEngineState(activeSubTab);

  // CC68: Wire sector depth streaming globally from parent to prevent double-subscription
  useSectorDepthStream(selectedSector);

  // ML State Hooks (Domains 5 & 11)
  const [anomalyScore, setAnomalyScore] = React.useState(0.2);
  const [psychPrediction, setPsychPrediction] = React.useState<{ revengeRisk: number; recommendation: string } | null>(null);
  const [isCadenceOpen, setIsCadenceOpen] = React.useState(false);

  React.useEffect(() => {
    marketAnomalyDetector.init().then(() => {
      setAnomalyScore(marketAnomalyDetector.getLatestScore());
    });
    psychologyPredictor.init().then(() => {
      setPsychPrediction(psychologyPredictor.predict({
        recentLossStreak: 0,
        fomoLevel: 4,
        stressLevel: 4,
        tiltScore: 10,
        timeSinceLastTradeMin: 45,
        sessionPnlPct: 0,
        winRate7d: 0.65,
        sleepHours: 7.5,
        forcedTrade: 0
      }));
    });
    FeatureHistoryCapture.getInstance().start();
    return () => {
      FeatureHistoryCapture.getInstance().stop();
    };
  }, []);

  const [showAutopilot, setShowAutopilot] = React.useState(false);
  const telegramBots = useSettingsStore(s => s.telegramBots);
  const rootTelegramBotToken = useSettingsStore(s => s.telegramBotToken);
  const rootTelegramChatId = useSettingsStore(s => s.telegramChatId);

  // Find bot with 'autopilot' role, fall back to root keys
  const autopilotBot = (telegramBots || []).find(b => b.role === 'autopilot' && b.enabled);
  const telegramBotToken = autopilotBot ? autopilotBot.token : rootTelegramBotToken;
  const telegramChatId = autopilotBot ? autopilotBot.chatId : rootTelegramChatId;

  // Alpha Engine Cadence & Rate Limits Control
  const alphaRefreshInterval = useSettingsStore(s => s.alphaRefreshInterval || '60s');
  const updateSetting = useSettingsStore(s => s.updateSetting);

  const targetSeconds = React.useMemo(() => {
    switch (alphaRefreshInterval) {
      case '15s': return 15;
      case '30s': return 30;
      case '60s': return 60;
      case '120s': return 120;
      case '300s': return 300;
      case 'manual': default: return 0;
    }
  }, [alphaRefreshInterval]);

  const [secondsLeft, setSecondsLeft] = React.useState<number>(() => targetSeconds || 60);

  React.useEffect(() => {
    if (targetSeconds === 0) {
      setSecondsLeft(0);
      return;
    }
    setSecondsLeft(targetSeconds);
    const timer = setInterval(() => {
      setSecondsLeft(prev => (prev <= 1 ? targetSeconds : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [targetSeconds]);

  const {
    enabled: autopilotEnabled,
    activeTrade,
    hasTelegram,
    loading: autopilotLoading,
    syncing: autopilotSyncing,
    results: autopilotResults,
    toggleAutopilot,
    forceClose,
    fetchStatus: fetchAutopilotStatus,
    fetchResults: fetchAutopilotResults
  } = useAutopilot(bullishStocks, bearishStocks);

  const handleAlphaRefresh = async () => {
    const hasToken = !!getToken();
    const refreshStore = useRefreshProgressStore.getState();
    
    let activeLabel = 'Alpha Engine Data';
    let steps: string[] = ['Reading cache...'];
    let duration = 2000;
    let refreshAction: () => Promise<any> = async () => {};

    if (activeSubTab === 'heatmap') {
      activeLabel = 'Heatmap & Sectors';
      steps = ['Reading sector cache...', 'Querying backend sectoral flow APIs...', 'Rebuilding correlation matrix...'];
      duration = 1500;
      refreshAction = async () => {
        await fetchSectorAnalysis();
      };
    } else if (activeSubTab === 'screener') {
      if (shadowMode === 'candlestick') {
        activeLabel = 'Candlestick Screener';
        steps = ['Loading OHLC candles...', 'Running pattern scanning algorithms...', 'Rendering matches...'];
        duration = 2500;
        refreshAction = async () => {
          await fetchCandlestickData(candleTimeframe, true);
        };
      } else if (shadowMode === 'gainers') {
        activeLabel = 'Intraday Gainers & Losers';
        steps = ['Fetching historical volumes...', 'Computing relative strength scores...', 'Updating gainers lists...'];
        duration = 2000;
        refreshAction = async () => {
          await fetchHistoricalData(historicalType, historicalTimeframe, true);
        };
      } else if (shadowMode === 'orb') {
        activeLabel = 'Opening Range Breakout (ORB)';
        steps = ['Reading opening ranges...', 'Calculating breakout thresholds...', 'Updating focus list...'];
        duration = 2000;
        refreshAction = async () => {
          await fetchORBData(orbMinutes, orbWithPrb, true);
        };
      } else if (shadowMode === 'valuation') {
        activeLabel = 'Valuation Matrices';
        steps = ['Scanning sector valuation structures...', 'Sorting relative multiples...', 'Refreshing tables...'];
        duration = 1800;
        refreshAction = async () => {
          await fetchValuationData(valuationType, true);
        };
      } else if (shadowMode === 'results') {
        activeLabel = 'Corporate Earnings Results';
        steps = ['Reading upcoming earnings calendar...', 'Fetching surprise indicators...', 'Rebuilding digest...'];
        duration = 1500;
        refreshAction = async () => {
          await fetchResultsCalendarData(true);
        };
      } else if (shadowMode === 'shareholding') {
        activeLabel = 'Institutional Shareholding Flows';
        steps = ['Reading shareholding velocities...', 'Aggregating FII/DII buy/sell records...', 'Updating rankings...'];
        duration = 2000;
        refreshAction = async () => {
          await fetchShareholdingData(undefined, undefined, true);
        };
      } else if (shadowMode === 'quality') {
        activeLabel = 'Stock Quality Scorecard';
        steps = ['Reading ownership structures...', 'Evaluating leverage & earnings quality...', 'Re-calculating scores...'];
        duration = 1800;
        refreshAction = async () => {
          await fetchQualityData(undefined, undefined, true);
        };
      }
    } else { // activeSubTab === 'intraday'
      if (intraMode === 'fno' && engineMode === 'pulse') {
        activeLabel = 'F&O Market Pulse';
        steps = ['Syncing live Option Chain metrics...', 'Recalculating PCR & volume spikes...', 'Updating terminal...'];
        duration = 2200;
        refreshAction = async () => {
          if (hasToken) await fetchPulseProxy();
          else await handleDirectInjection('bridge', 'pulse');
        };
      } else {
        activeLabel = 'Alpha Ingestion Core';
        steps = ['Reading Stockezee cache...', 'Polling backend bridge telemetry...', 'Rebuilding widget views...'];
        duration = 2500;
        refreshAction = async () => {
          if (hasToken) await fetchStockeZeeProxy();
          else await handleDirectInjection('bridge', 'master');
        };
      }
    }

    // Trigger the loading progress overlay
    refreshStore.startRefresh('alpha-engine', activeLabel, steps, duration);
    
    try {
      const stepInterval = duration / steps.length;
      let currentStep = 0;
      const interval = setInterval(() => {
        currentStep++;
        if (currentStep < steps.length) {
          refreshStore.updateStep(currentStep);
        } else {
          clearInterval(interval);
        }
      }, stepInterval);

      await refreshAction();
      clearInterval(interval);
      await refreshStore.completeRefresh();
    } catch (err) {
      console.error('Refresh action failed:', err);
      refreshStore.cancelRefresh();
    }
  };

  const [isFilterOpen, setIsFilterOpen] = React.useState(false);
  const [isPresetOpen, setIsPresetOpen] = React.useState(false);

  const [fnoFocusMode, setFnoFocusMode] = React.useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('fnoFocusMode') === 'true';
    }
    return false;
  });

  const [boosterScoreMap, setBoosterScoreMap] = React.useState<Record<string, { rank: number; score: number }>>({});

  React.useEffect(() => {
    localStorage.setItem('fnoFocusMode', String(fnoFocusMode));
  }, [fnoFocusMode]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }
      if (e.key.toLowerCase() === 'f' && activeSubTab === 'intraday' && intraMode === 'fno') {
        e.preventDefault();
        setFnoFocusMode(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSubTab, intraMode]);

  // CC68.32: legacy `warmAllCaches` removed — `warmAllAlphaCaches` from
  // the hook does the same job with 19 steps instead of 10, plus auto-fires
  // when the Shadow Screener tab opens during active market hours. The
  // button on the header now calls the hook's function directly.

  // Booster Sorting State
  const [boosterSortField, setBoosterSortField] = React.useState<'Symbol' | 'LTP' | 'Change' | 'Strength Factor' | 'time' | null>(null);
  const [boosterSortOrder, setBoosterSortOrder] = React.useState<'asc' | 'desc'>('desc');

  const handleBoosterSort = (field: 'Symbol' | 'LTP' | 'Change' | 'Strength Factor' | 'time') => {
    if (boosterSortField === field) {
      setBoosterSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setBoosterSortField(field);
      setBoosterSortOrder(field === 'Symbol' ? 'asc' : 'desc');
    }
  };

  const sortedBoosterStocks = React.useMemo(() => {
    if (!boosterSortField) return filteredBoosterStocks;
    return [...filteredBoosterStocks].sort((a, b) => {
      let aVal: any = 0;
      let bVal: any = 0;
      if (boosterSortField === 'Symbol') {
        aVal = a.Symbol || '';
        bVal = b.Symbol || '';
      } else if (boosterSortField === 'LTP') {
        aVal = a.LTP || 0;
        bVal = b.LTP || 0;
      } else if (boosterSortField === 'Change') {
        aVal = a.Change || 0;
        bVal = b.Change || 0;
      } else if (boosterSortField === 'Strength Factor') {
        aVal = a["Strength Factor"] || 0;
        bVal = b["Strength Factor"] || 0;
      } else if (boosterSortField === 'time') {
        aVal = a.time || '';
        bVal = b.time || '';
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return boosterSortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return boosterSortOrder === 'asc'
        ? (aVal > bVal ? 1 : aVal < bVal ? -1 : 0)
        : (aVal < bVal ? 1 : aVal > bVal ? -1 : 0);
    });
  }, [filteredBoosterStocks, boosterSortField, boosterSortOrder]);

  const uniqueSectors = React.useMemo(() => {
    const list = new Set<string>();
    masterStocks.forEach(s => {
      if (s.Sector) list.add(s.Sector.toUpperCase());
    });
    return Array.from(list).sort();
  }, [masterStocks]);

  const displayBullish = React.useMemo(() => {
    return filterType === 'all' ? bullishStocks : filteredByQuickType.filter(s => s.Change > 0);
  }, [filterType, bullishStocks, filteredByQuickType]);

  const displayBearish = React.useMemo(() => {
    return filterType === 'all' ? bearishStocks : filteredByQuickType.filter(s => s.Change < 0);
  }, [filterType, bearishStocks, filteredByQuickType]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        if (textAreaRef.current) {
          textAreaRef.current.value = content;
        }
        const parsed = JSON.parse(content);
        processDatabase(parsed, 'master');
      } catch (err) {
        setError('Failed to read or parse file.');
      }
    };
    reader.readAsText(file);
  };

  const handleBoosterFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        processDatabase(parsed, 'booster');
      } catch (err) {
        setError('Failed to read or parse Booster JSON file. Make sure it contains valid StockeZee orb-range structure.');
      }
    };
    reader.readAsText(file);
  };

  const applyStrategyPreset = (presetId: string) => {
    setFilterType(presetId as any);
    setIsPresetOpen(false);

    // Initial default filters
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

    switch (presetId) {
      case 'all':
        setAdvancedFilters(defaults);
        break;
      case 'momentum':
        setAdvancedFilters({
          ...defaults,
          minChange: 3,
          minScore: 100,
        });
        break;
      case 'value':
        setAdvancedFilters({
          ...defaults,
          excludePennyTraps: true,
        });
        break;
      case 'breakout':
        setAdvancedFilters({
          ...defaults,
          excludePennyTraps: true,
        });
        break;
      case 'oversold':
        setAdvancedFilters({
          ...defaults,
          maxChange: -5,
        });
        break;
      case 'high_volume':
        setAdvancedFilters({
          ...defaults,
          minVolume: 100000,
        });
        break;
      case 'low_pe':
        setAdvancedFilters({
          ...defaults,
        });
        break;
      case 'mid_large_cap':
        setAdvancedFilters({
          ...defaults,
          capCategories: ['Large', 'Mid'],
        });
        break;
      case 'inst_grade':
      case 'footprint_confirmed':
        setAdvancedFilters(defaults);
        break;
      default:
        break;
    }
  };

  return (
    <div className="page-shell type-lift space-y-6 pb-24">

      {/* HEADER CONTROLS */}
      {activeSubTab !== 'market-command' && (
        <div className="relative z-30 bg-white/60 dark:bg-slate-900/40 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 p-3.5 sm:p-4 rounded-2xl shadow-sm space-y-3">
          
          {/* TIER 1: Identity & Primary Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
            {/* Left: Terminal Title & Live Connection Status */}
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2 shrink-0">
                <Terminal className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Alpha Shadow Terminal
              </h1>
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${!isAlphaActiveHours()
                  ? 'status-trust-cached'
                  : (getToken() ? 'status-trust-live' : 'status-trust-stale')
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${!isAlphaActiveHours()
                    ? 'bg-indigo-500'
                    : (getToken() ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-amber-500')
                  }`} />
                {!isAlphaActiveHours() ? 'Cached (Dexie)' : (getToken() ? 'Live (StockeZee)' : 'Manual (Upload)')}
                <CapabilityWarningDot capability="quotes" />
              </div>
            </div>

            {/* Right: Actions (Sync with Hover Cadence, Warm Caches, Bridge Config, Morning Momentum) */}
            <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar py-0.5 flex-nowrap sm:flex-wrap">
              {/* Sync Button with Hover/Click Cadence Dropdown */}
              <div
                className="relative shrink-0"
                onMouseEnter={() => setIsCadenceOpen(true)}
                onMouseLeave={() => setIsCadenceOpen(false)}
              >
                <div className="flex items-center bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 rounded-xl shadow-sm h-8 sm:h-9 overflow-hidden">
                  <button
                    onClick={() => {
                      handleAlphaRefresh();
                      setRefreshCount(prev => prev + 1);
                      setSecondsLeft(targetSeconds || 60);
                    }}
                    disabled={isFetchingLive || isFetchingPulse || isFetchingSectors}
                    className="px-2.5 h-full hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all flex items-center justify-center disabled:opacity-50"
                    title="Force refresh current market state now"
                    aria-label="Sync Now"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${(isFetchingLive || isFetchingPulse || isFetchingSectors) ? 'animate-spin text-indigo-500' : ''}`} />
                  </button>

                  <button
                    onClick={() => setIsCadenceOpen(prev => !prev)}
                    className="px-2 h-full border-l border-slate-200 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700 text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 transition-all"
                    title="Hover or click to change sync cadence"
                  >
                    <Clock className="w-2.5 h-2.5 text-indigo-500" />
                    <span>{alphaRefreshInterval === 'manual' ? 'MAN' : `${secondsLeft}s`}</span>
                    <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                  </button>
                </div>

                {/* Vertical Cadence Dropdown on Hover/Click */}
                <AnimatePresence>
                  {isCadenceOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.96 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-50 p-1.5 flex flex-col gap-0.5"
                    >
                      <div className="px-2 py-1 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800/80 mb-1">
                        Sync Cadence
                      </div>
                      {(['manual', '15s', '30s', '60s', '120s', '300s'] as const).map(interval => {
                        const label = interval === 'manual' ? 'Manual Only' : interval === '60s' ? 'Every 1 min' : interval === '120s' ? 'Every 2 min' : interval === '300s' ? 'Every 5 min' : `Every ${interval}`;
                        const isActive = alphaRefreshInterval === interval;
                        return (
                          <button
                            key={interval}
                            onClick={() => {
                              updateSetting('alphaRefreshInterval', interval);
                              setIsAutoRefresh(interval !== 'manual');
                              setIsCadenceOpen(false);
                            }}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center justify-between ${
                              isActive
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span>{label}</span>
                            {isActive && <span className="text-[11px]">✓</span>}
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Warm Caches */}
              <ActionButton
                size="md"
                icon={<Database className={`w-3.5 h-3.5 ${isWarming ? 'animate-spin' : ''}`} />}
                label={isWarming ? `Warming (${warmingStep}/19)` : 'Warm Caches'}
                responsiveLabel
                isActive={isWarming}
                activeVariant="indigo"
                isLoading={isWarming}
                onClick={() => warmAllAlphaCaches()}
                disabled={isWarming || isFetchingLive || isFetchingPulse || isFetchingSectors}
                title={isWarming ? `Warming Caches (${warmingStep}/19)` : 'Warm all 19 cache layers'}
              />

              {/* Bridge Config */}
              <ActionButton
                size="md"
                icon={<Zap size={14} className="text-amber-500 dark:text-amber-400 shrink-0" />}
                label="Bridge Config"
                responsiveLabel
                onClick={() => setIsBridgeConfigOpen(true)}
                title="Open Bridge & Token Config (Paste Master/Sniper)"
              />

              {/* Morning Momentum */}
              <ActionButton
                size="md"
                icon={<Target size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />}
                label="Morning Momentum"
                responsiveLabel
                onClick={() => { setMorningFocusMode(true); if (activeSubTab !== 'intraday' && onTabChange) onTabChange('intraday'); }}
                title="One click: open Trade Sniper in Focus Mode"
              />
            </div>
          </div>

          {/* TIER 2: Telemetry Strip (Macro Status Pills) */}
          <div className="flex items-center gap-2 pt-2.5 border-t border-slate-200/60 dark:border-slate-800/60 overflow-x-auto no-scrollbar flex-nowrap sm:flex-wrap">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest shrink-0 mr-1">
              {activeSubTab.toUpperCase()} MODE // {masterStocks.length} ASSETS
            </span>

            {/* PCR Gate Pill */}
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${pcrGate === 'BULLISH'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : pcrGate === 'BEARISH'
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
                  : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400'
              }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pcrGate === 'BULLISH'
                  ? 'bg-emerald-500'
                  : pcrGate === 'BEARISH'
                    ? 'bg-rose-500'
                    : 'bg-yellow-500'
                }`} />
              PCR: {pcrValue.toFixed(2)} · {pcrGate} {pcrGate === 'BEARISH' ? '⚠️' : ''}
              <CapabilityWarningDot capability="pcr" />
            </div>

            {/* FII Macro Bias Pill */}
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${macroBias === 'STRONG_BULLISH'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 animate-pulse'
                : macroBias === 'DISTRIBUTION'
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
                  : macroBias === 'HEDGED'
                    ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400'
                    : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/50 text-slate-600 dark:text-slate-400'
              }`}>
              <span>{macroBias === 'DISTRIBUTION' ? '📉' : '🏛️'}</span>
              FII: {fiiCashNet >= 0 ? '+₹' : '-₹'}{Math.abs(fiiCashNet).toLocaleString('en-IN')} Cr · {macroBias.replace('_', ' ')}
            </div>

            {/* Domain 5: ML Anomaly Detector Pill */}
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${anomalyScore > 0.65
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/50 text-slate-600 dark:text-slate-400'
              }`}>
              <span>{anomalyScore > 0.65 ? '⚠️' : '🛡️'}</span>
              ML Anomaly: {(anomalyScore * 100).toFixed(0)}% {anomalyScore > 0.65 ? '(ANOMALY DAY)' : '(NORMAL)'}
            </div>

            {/* Domain 11: ML Psychology State Pill */}
            {psychPrediction && (
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${psychPrediction.recommendation === 'STOP_TRADING'
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400 animate-pulse'
                  : psychPrediction.recommendation === 'CAUTION'
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                }`}>
                <span>🧠</span>
                Psych: {psychPrediction.recommendation} ({((1 - psychPrediction.revengeRisk) * 100).toFixed(0)}% Clear)
              </div>
            )}

            {perfectConvergenceAlerts > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] animate-bounce">
                <Zap className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
                <span className="text-[9px] font-semibold uppercase tracking-wide">
                  ⚡ {perfectConvergenceAlerts} PERFECT setups primed!
                </span>
              </div>
            )}

            {isWarming && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full shrink-0 shadow-[0_0_15px_rgba(99,102,241,0.15)] animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>
                <span className="text-[9px] font-semibold uppercase tracking-wide">
                  Warming Caches ({warmingStep}/19)
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab !== 'market-command' && !isAlphaActiveHours() && (
        <>
          {/* Mobile Viewport: Compact sleek single-line pill badge */}
          <div className="flex sm:hidden items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 dark:bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              <Clock size={13} className="animate-pulse shrink-0 text-amber-500" />
              <span className="text-[11px] font-semibold truncate">Market Closed · Terminal Suspended</span>
            </div>
            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 shrink-0">Close Prices</span>
          </div>

          {/* Desktop Viewport: Sleek single-line status bar */}
          <div className="hidden sm:flex luxury-card bg-white/80 dark:bg-slate-900/50 backdrop-blur-xl border border-slate-200/80 dark:border-white/[0.08] rounded-xl px-3.5 py-2 items-center justify-between shadow-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <Clock size={16} className="animate-pulse text-indigo-600 dark:text-indigo-400 shrink-0" />
              <p className="text-slate-900 dark:text-slate-200 font-bold text-xs leading-snug truncate">
                Terminal Operations Suspended <span className="text-slate-400 font-normal">· Displaying session close prices (Mon-Fri, 9:00 AM - 3:45 PM IST)</span>
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 shrink-0 font-bold">
              Close Prices
            </span>
          </div>
        </>
      )}

      {activeSubTab !== 'market-command' && error && stocks.length === 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 p-4 rounded-2xl flex items-start gap-3 shadow-lg dark:shadow-rose-950/20">
          <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider">Terminal Error</h4>
            <p className="text-[11px] font-medium text-rose-700/90 dark:text-rose-300/90 mt-1">{error}</p>
          </div>
        </motion.div>
      )}

      {/* CORE CONTENT LAYOUT SWITCHER */}
      {isCacheLoading ? (
        <div className="min-h-[450px] flex flex-col items-center justify-center space-y-6 bg-slate-50/50 dark:bg-slate-900/10 border border-slate-200 dark:border-slate-800/40 rounded-3xl p-12 shadow-inner">
          <div className="w-12 h-12 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(99,102,241,0.1)]"></div>
          <h3 className="text-sm font-black text-slate-500 dark:text-slate-300 uppercase tracking-[0.2em] animate-pulse">Restoring Terminal Cache</h3>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Loading databases from local IndexedDB vault...</p>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {activeSubTab === 'intraday' && (
            <motion.div key="intraday" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
              {filterType === 'screener_override' && (
                <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 px-5 py-3.5 rounded-2xl text-indigo-600 dark:text-indigo-300 backdrop-blur-md shadow-lg shadow-indigo-500/5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs">🎯</span>
                    <p className="text-[11px] font-black uppercase tracking-wider">
                      Showing Backtester Screener Universe Filter
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setFilterType('all');
                      if (typeof window !== 'undefined') {
                        window.sessionStorage.removeItem('alpha_screener_filter_override');
                      }
                    }}
                    className="px-3 py-1 bg-indigo-600 dark:bg-indigo-500/20 hover:bg-indigo-700 dark:hover:bg-indigo-500/40 text-white dark:text-indigo-300 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all duration-150"
                  >
                    Clear Filter
                  </button>
                </div>
              )}
                {/* Top segment control */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 w-full">
                  {/* Left: Cash / F&O / Autopilot Segment Control (and mobile sub-engines) */}
                  <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2 w-full md:w-auto">
                    <Tabs.Root
                      value={showAutopilot ? 'autopilot' : intraMode}
                      onValueChange={(val) => {
                        if (val === 'autopilot') {
                          setShowAutopilot(true);
                        } else if (val === 'cash') {
                          setShowAutopilot(false);
                          setIntraMode('cash');
                          setEngineMode('raw');
                        } else if (val === 'fno') {
                          setShowAutopilot(false);
                          setIntraMode('fno');
                        }
                      }}
                      layoutId="alpha-main-mode-nav"
                      variant="solid-indigo"
                      motionPreset="spring"
                    >
                      <Tabs.List className="min-h-[34px] sm:min-h-[38px] p-0.5 sm:p-1">
                        <Tabs.Trigger
                          value="cash"
                          className="px-2.5 sm:px-3.5 min-h-[28px] sm:min-h-[30px] text-[10px] sm:text-[11px] font-bold"
                          title="Cash Segment"
                        >
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                          <span>Cash</span>
                        </Tabs.Trigger>

                        <Tabs.Trigger
                          value="fno"
                          className="px-2.5 sm:px-3.5 min-h-[28px] sm:min-h-[30px] text-[10px] sm:text-[11px] font-bold"
                          title="F&O Segment"
                        >
                          <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                          <span>F&O</span>
                        </Tabs.Trigger>

                        <Tabs.Trigger
                          value="autopilot"
                          className="px-2.5 sm:px-3.5 min-h-[28px] sm:min-h-[30px] text-[10px] sm:text-[11px] font-bold"
                          title="Alpha Autopilot"
                        >
                          <Bot size={13} className="shrink-0" />
                          <span className="hidden sm:inline">Autopilot</span>
                          <span className="sm:hidden">Auto</span>
                        </Tabs.Trigger>
                      </Tabs.List>
                    </Tabs.Root>

                    {/* Mobile Only: Sub-Engine Picker positioned cleanly without horizontal crush */}
                    {intraMode === 'fno' && !showAutopilot && (
                      <div className="flex md:hidden items-center gap-1.5 shrink-0 animate-fade-in">
                        <Tabs.Root
                          value={engineMode}
                          onValueChange={(val) => {
                            setEngineMode(val as any);
                            if (val === 'sector_booster' && boosterRawData.length === 0) fetchSectorBooster();
                            if (val === 'pulse' && boosterStocksList.length === 0) fetchBoosterProxy();
                          }}
                          layoutId="alpha-fno-subengine-mobile"
                          variant="solid-indigo"
                          motionPreset="spring"
                        >
                          <Tabs.List className="min-h-[34px] p-0.5">
                            <Tabs.Trigger
                              value="raw"
                              className="px-2 min-h-[28px] text-[9.5px] font-bold uppercase tracking-wider"
                              title="NSE Raw Mode"
                            >
                              Raw
                            </Tabs.Trigger>

                            <Tabs.Trigger
                              value="sector_booster"
                              className="px-2 min-h-[28px] text-[9.5px] font-bold uppercase tracking-wider"
                              title="Sector Booster"
                            >
                              Sector
                            </Tabs.Trigger>

                            <Tabs.Trigger
                              value="pulse"
                              className="px-2 min-h-[28px] text-[9.5px] font-bold uppercase tracking-wider"
                              title="Intraday Booster"
                            >
                              Intraday
                            </Tabs.Trigger>
                          </Tabs.List>
                        </Tabs.Root>

                        {/* Focus Mode Button */}
                        <ActionButton
                          size="sm"
                          icon={<Target size={13} className="shrink-0" />}
                          isActive={fnoFocusMode}
                          activeVariant="indigo"
                          onClick={() => setFnoFocusMode(prev => !prev)}
                          title="Toggle Focus Mode"
                        />
                      </div>
                    )}
                  </div>

                  {/* Desktop / Laptop View: Sub-Engine Picker aligned to the right side */}
                  {intraMode === 'fno' && !showAutopilot && (
                    <div className="hidden md:flex items-center gap-2 shrink-0 animate-fade-in ml-auto">
                      <Tabs.Root
                        value={engineMode}
                        onValueChange={(val) => {
                          setEngineMode(val as any);
                          if (val === 'sector_booster' && boosterRawData.length === 0) fetchSectorBooster();
                          if (val === 'pulse' && boosterStocksList.length === 0) fetchBoosterProxy();
                        }}
                        layoutId="alpha-fno-subengine-desktop"
                        variant="solid-indigo"
                        motionPreset="spring"
                      >
                        <Tabs.List className="min-h-[38px] p-1">
                          <Tabs.Trigger
                            value="raw"
                            className="px-3.5 min-h-[30px] text-[11px] font-bold uppercase tracking-wider"
                            title="NSE Raw Mode"
                          >
                            NSE Raw
                          </Tabs.Trigger>

                          <Tabs.Trigger
                            value="sector_booster"
                            className="px-3.5 min-h-[30px] text-[11px] font-bold uppercase tracking-wider"
                            title="Sector Booster"
                          >
                            Sector Booster
                          </Tabs.Trigger>

                          <Tabs.Trigger
                            value="pulse"
                            className="px-3.5 min-h-[30px] text-[11px] font-bold uppercase tracking-wider"
                            title="Intraday Booster"
                          >
                            Intraday Booster
                          </Tabs.Trigger>
                        </Tabs.List>
                      </Tabs.Root>

                      {/* Focus Mode Button */}
                      <ActionButton
                        size="md"
                        icon={<Target size={14} className="shrink-0" />}
                        label="Focus"
                        isActive={fnoFocusMode}
                        activeVariant="indigo"
                        onClick={() => setFnoFocusMode(prev => !prev)}
                        title="Toggle Focus Mode"
                      />
                    </div>
                  )}

                  {/* Cash Segment Search & Filters (Merged into Row 1) */}
                  {intraMode === 'cash' && (
                    <div className="toolbar-wrap flex-1 justify-between md:justify-end gap-2 sm:gap-3 w-full">
                      <div className="relative flex-1 min-w-[140px] max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                        <input
                          type="text"
                          placeholder="Search engine assets..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800/80 rounded-xl pl-9 pr-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-500 transition-all font-medium font-sans shadow-inner h-9 sm:h-10"
                        />
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setIsFilterOpen(true)}
                          className={`flex items-center gap-1.5 px-3 rounded-xl border text-[11px] sm:text-xs font-bold uppercase tracking-wider transition-all h-9 sm:h-10 ${isFilterOpen || Object.values(advancedFilters).some(v => v !== null && v !== false && (Array.isArray(v) ? v.length > 0 : true) && v !== true)
                              ? 'bg-indigo-600 dark:bg-indigo-500/20 border-indigo-600 dark:border-indigo-500/30 text-white dark:text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                              : 'bg-white dark:bg-slate-900/85 border-slate-200 dark:border-slate-800/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-300 shadow-sm'
                            }`}
                          title="Advanced Filters"
                        >
                          <SlidersHorizontal size={13} />
                          <span>Filters</span>
                        </button>

                        <div className="relative">
                          <button
                            onClick={() => setIsPresetOpen(!isPresetOpen)}
                            className="flex items-center justify-between gap-1.5 sm:gap-2 px-3 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800/80 hover:border-slate-400 dark:hover:border-slate-700 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-tight sm:tracking-wider text-slate-700 dark:text-slate-300 transition-all w-32 sm:w-44 shadow-sm h-9 sm:h-10"
                          >
                            <span className="truncate">
                              {STRATEGY_PRESETS.find(p => p.id === filterType)?.label || 'All Assets'}
                            </span>
                            <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                          </button>
                        {isPresetOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsPresetOpen(false)} />
                            <div className="absolute right-0 mt-2 w-60 sm:w-64 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-50 p-1.5 overflow-hidden">
                              {STRATEGY_PRESETS.map(preset => (
                                <button
                                  key={preset.id}
                                  onClick={() => applyStrategyPreset(preset.id)}
                                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-all hover:bg-slate-100 dark:hover:bg-indigo-500/10 flex flex-col gap-0.5 ${filterType === preset.id
                                      ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/5'
                                      : 'text-slate-600 dark:text-slate-400'
                                    }`}
                                >
                                  <span>{preset.label}</span>
                                  <span className="text-[9px] text-slate-400 dark:text-slate-600 font-medium">{preset.desc}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {!showAutopilot && !fnoFocusMode && (
                <ConvergenceBriefPanel
                  convergenceResults={convergenceResults}
                  perfectConvergenceAlerts={perfectConvergenceAlerts}
                />
              )}

              {/* MCE P1 — Momentum Continuation Score (full-width, first card) */}
              {!showAutopilot && !fnoFocusMode && selectedStock && <MomentumContinuationWidget />}

              {/* Autopilot Control Panel shown at the top of the page if enabled or on F&O segment */}
              {(showAutopilot || (intraMode === 'fno' && !fnoFocusMode)) && (
                <AutopilotControlPanel
                  enabled={autopilotEnabled}
                  activeTrade={activeTrade}
                  hasTelegram={hasTelegram}
                  toggleAutopilot={toggleAutopilot}
                  forceClose={forceClose}
                  fetchStatus={fetchAutopilotStatus}
                  bullishStocks={bullishStocks}
                  bearishStocks={bearishStocks}
                  niftyChange={null}
                  telegramBotToken={telegramBotToken}
                  telegramChatId={telegramChatId}
                  syncing={autopilotSyncing}
                />
              )}

              {/* Sub-panels for Intraday mode */}
              {showAutopilot ? (
                <AutopilotResultsPanel
                  results={autopilotResults}
                  loading={autopilotLoading}
                  fetchResults={fetchAutopilotResults}
                />
              ) : intraMode === 'fno' && fnoFocusMode ? (
                <FnoFocusPanel
                  marketMood={pcrGate}
                  volumeAverages={volumeAverages}
                  boosterScoreMap={boosterScoreMap}
                  orbDataCache={orbDataCache}
                  onExit={() => setFnoFocusMode(false)}
                />
              ) : intraMode === 'fno' && engineMode === 'sector_booster' ? (
                <SectorBoosterPanel
                  boosterRawData={boosterRawData}
                  isFetchingBooster={isFetchingBooster}
                  handleBoosterFileUpload={handleBoosterFileUpload}
                  fetchSectorBooster={fetchSectorBooster}
                  setSelectedStock={setSelectedStock}
                />
              ) : intraMode === 'fno' && engineMode === 'pulse' ? (
                // Todayorb.json Breakout Terminal
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white/40 dark:bg-slate-900/30 p-4 rounded-3xl border border-slate-200 dark:border-slate-800/40 shadow-sm backdrop-blur-md">
                    <Tabs.Root
                      value={boosterTrend}
                      onValueChange={(val) => setBoosterTrend(val as any)}
                      layoutId="alpha-booster-trend-nav"
                      variant="solid-indigo"
                      motionPreset="spring"
                    >
                      <Tabs.List className="min-h-[38px] p-1 bg-slate-100/50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <Tabs.Trigger
                          value="bullish"
                          className="px-5 min-h-[30px] text-[11px] font-black uppercase tracking-wider"
                          indicatorClassName="bg-emerald-600 rounded-xl shadow-md shadow-emerald-500/30"
                        >
                          <TrendingUp className="w-3.5 h-3.5" />
                          <span>BULLISH BREAKOUT</span>
                        </Tabs.Trigger>
                        <Tabs.Trigger
                          value="bearish"
                          className="px-5 min-h-[30px] text-[11px] font-black uppercase tracking-wider"
                          indicatorClassName="bg-rose-600 rounded-xl shadow-md shadow-rose-500/30"
                        >
                          <TrendingDown className="w-3.5 h-3.5" />
                          <span>BEARISH BREAKOUT</span>
                        </Tabs.Trigger>
                      </Tabs.List>
                    </Tabs.Root>

                    <div className="flex items-center gap-3 w-full md:w-auto">
                      <label className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-2xl text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest transition-all duration-200 cursor-pointer shadow-sm">
                        <Upload className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        Load Todayorb.json
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleBoosterFileUpload}
                          className="hidden"
                        />
                      </label>

                      <ActionButton
                        size="md"
                        icon={<RefreshCw className={`w-3.5 h-3.5 ${isFetchingBoosterScanner ? 'animate-spin' : ''}`} />}
                        label={isFetchingBoosterScanner ? 'Scanning...' : 'Sync Live'}
                        isLoading={isFetchingBoosterScanner}
                        disabled={isFetchingBoosterScanner}
                        onClick={() => fetchBoosterProxy()}
                        isActive
                        activeVariant="indigo"
                      />
                    </div>
                  </div>

                  {boosterStocksList.length === 0 ? (
                    <div className="min-h-[400px] flex flex-col items-center justify-center bg-slate-50/50 dark:bg-slate-900/10 border border-slate-200 dark:border-slate-800/40 rounded-3xl p-12 text-center shadow-inner">
                      <Clock className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-6 animate-pulse" />
                      <h3 className="text-xl font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-widest">Waiting for Live Booster...</h3>
                      <p className="text-slate-600 dark:text-slate-400 text-sm max-w-md">Sync Live via the API bridge or drop your Todayorb.json file to activate the institutional breakout terminal.</p>
                    </div>
                  ) : (
                    <div className="bg-white/40 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800/60 rounded-[2rem] shadow-sm overflow-hidden backdrop-blur-md">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-900/40 select-none">
                              <th
                                onClick={() => handleBoosterSort('Symbol')}
                                className="px-6 py-4 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-white transition-colors group"
                              >
                                <div className="flex items-center gap-1.5">
                                  Symbol
                                  <span className={`transition-opacity duration-200 ${boosterSortField === 'Symbol' ? 'text-indigo-600 dark:text-indigo-400 opacity-100' : 'text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100'}`}>
                                    {boosterSortField === 'Symbol' ? (boosterSortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                  </span>
                                </div>
                              </th>
                              <th
                                onClick={() => handleBoosterSort('LTP')}
                                className="px-6 py-4 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-white transition-colors group"
                              >
                                <div className="flex items-center justify-end gap-1.5">
                                  Spot Price
                                  <span className={`transition-opacity duration-200 ${boosterSortField === 'LTP' ? 'text-indigo-600 dark:text-indigo-400 opacity-100' : 'text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100'}`}>
                                    {boosterSortField === 'LTP' ? (boosterSortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                  </span>
                                </div>
                              </th>
                              <th
                                onClick={() => handleBoosterSort('Change')}
                                className="px-6 py-4 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-white transition-colors group"
                              >
                                <div className="flex items-center justify-end gap-1.5">
                                  Change %
                                  <span className={`transition-opacity duration-200 ${boosterSortField === 'Change' ? 'text-indigo-600 dark:text-indigo-400 opacity-100' : 'text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100'}`}>
                                    {boosterSortField === 'Change' ? (boosterSortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                  </span>
                                </div>
                              </th>
                              <th
                                onClick={() => handleBoosterSort('Strength Factor')}
                                className="px-6 py-4 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-white transition-colors group"
                              >
                                <div className="flex items-center gap-1.5">
                                  Strength Force
                                  <span className={`transition-opacity duration-200 ${boosterSortField === 'Strength Factor' ? 'text-indigo-600 dark:text-indigo-400 opacity-100' : 'text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100'}`}>
                                    {boosterSortField === 'Strength Factor' ? (boosterSortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                  </span>
                                </div>
                              </th>
                              <th
                                onClick={() => handleBoosterSort('time')}
                                className="px-6 py-4 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest text-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-white transition-colors group"
                              >
                                <div className="flex items-center justify-center gap-1.5">
                                  Alert Time
                                  <span className={`transition-opacity duration-200 ${boosterSortField === 'time' ? 'text-indigo-600 dark:text-indigo-400 opacity-100' : 'text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100'}`}>
                                    {boosterSortField === 'time' ? (boosterSortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                                  </span>
                                </div>
                              </th>
                              <th className="px-6 py-4 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest text-center">Execution</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800/30">
                            {sortedBoosterStocks.map((s, idx) => {
                              const changeVal = s.Change || 0;
                              const isGreen = changeVal >= 0;
                              const strength = s["Strength Factor"] || 0;
                              const percent = Math.min(Math.max((strength / 2500) * 100, 5), 100);

                              return (
                                <tr key={s.Symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors group">
                                  <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                      <span className="text-slate-400 dark:text-slate-500 font-bold text-[10px] w-5">
                                        {(idx + 1).toString().padStart(2, '0')}
                                      </span>
                                      <button
                                        onClick={() => openTradingView(s.Symbol)}
                                        className="text-sm font-black text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors tracking-tight text-left flex items-center gap-1"
                                      >
                                        {s.Symbol}
                                        <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400" />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-right text-xs font-black text-slate-800 dark:text-slate-200 font-mono">
                                    ₹{(s.LTP || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black font-mono shadow-sm ${isGreen
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                      }`}>
                                      {isGreen ? '+' : ''}{changeVal.toFixed(2)}%
                                    </span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="flex items-center gap-3 max-w-[200px]">
                                      <span className="text-xs font-mono font-black text-slate-600 dark:text-slate-300 w-12">
                                        {strength.toFixed(0)}
                                      </span>
                                      <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700/30 shadow-inner">
                                        <div
                                          className={`h-full rounded-full ${isGreen
                                            ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                                            : 'bg-gradient-to-r from-rose-500 to-orange-400 shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                                            }`}
                                          style={{ width: `${percent}%` }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-center text-xs font-bold text-slate-500 font-mono">
                                    {s.time || 'N/A'}
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                    <button
                                      onClick={() => openTradingView(s.Symbol)}
                                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800/80 rounded-xl text-[9px] font-black text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-white uppercase tracking-widest transition-all duration-200 shadow-sm"
                                    >
                                      Chart
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : intraMode === 'cash' ? (
                // Cash or F&O Raw Mode: Full Width, No Sidebar
                <div className="space-y-6">

                  {/* Stock Tables depending on isSniperActive */}
                  {masterStocks.length === 0 ? (
                    <div className="min-h-[450px] flex flex-col items-center justify-center bg-slate-50/50 dark:bg-slate-900/10 border border-slate-200 dark:border-slate-800/40 rounded-3xl p-12 text-center backdrop-blur-sm shadow-inner">
                      <Zap className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-6 animate-pulse" />
                      <h3 className="text-xl font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-widest">Active Database Empty</h3>
                      <p className="text-slate-500 dark:text-slate-600 text-sm max-w-sm mb-8 leading-relaxed">Prime the scanner via live StockeZee proxy or paste JSON from Network &gt; Response tab.</p>
                      <div className="flex flex-wrap justify-center gap-4">
                        <label className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl cursor-pointer shadow-lg shadow-indigo-600/20 transition-all">
                          <Upload className="w-4 h-4" />
                          Import JSON File
                          <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
                        </label>
                        <button
                          onClick={() => handleClipboardInjection('master')}
                          className="px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl transition-all shadow-sm"
                        >
                          📋 Paste from Clipboard
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <Suspense fallback={<LazyLoader />}>
                        <CashRadarPanel
                          pulseStocks={masterStocks}
                          openLowStocks={pulseCategorized?.open_low || []}
                          stockezeeToken={stockezeeToken}
                          autoRefresh={isAutoRefresh}
                          refreshTrigger={refreshCount}
                          isVisible={isVisible}
                          orbDataCache={orbDataCache}
                          dailyCandleData={dailyCandleData}
                          valuationDataCache={valuationDataCache}
                          shareholdingDataCache={shareholdingDataCache}
                          qualityDataCache={qualityDataCache}
                          boosterStocksList={boosterStocksList}
                          historicalDataCache={historicalDataCache}
                          fiiDiiPulseData={fiiDiiPulseData}
                          derivativeSummaryData={derivativeSummaryData}
                          advancedFilters={advancedFilters}
                          setAdvancedFilters={setAdvancedFilters}
                          volumeAverages={volumeAverages}
                          setVolumeAverages={setVolumeAverages}
                          searchTerm={searchTerm}
                          oreMap={oreMap}
                          cvdMap={cvdMap}
                          rsMap={rsMap}
                          shareholdingMap={shareholdingMap}
                          oiSignalMap={oiSignalMap}
                          indicatorMatches={indicatorMatches}
                          resultsCalendarData={resultsCalendarData}
                        />
                      </Suspense>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 tracking-tight">Intraday Bullish Snipes</h3>
                            </div>
                            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{displayBullish.length} Stocks</span>
                          </div>
                          <div className="bg-white/40 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800/60 rounded-xl shadow-sm overflow-hidden backdrop-blur-sm">
                            <StockTable
                              data={displayBullish}
                              type="bullish"
                              isSniper={isSniperActive}
                              engineMode="raw"
                              orbDataCache={orbDataCache}
                              dailyCandleData={dailyCandleData}
                              valuationDataCache={valuationDataCache}
                              shareholdingDataCache={shareholdingDataCache}
                              qualityDataCache={qualityDataCache}
                              boosterStocksList={boosterStocksList}
                              historicalDataCache={historicalDataCache}
                              fiiDiiPulseData={fiiDiiPulseData}
                              derivativeSummaryData={derivativeSummaryData}
                              portfolioSymbols={portfolioSymbols}
                              volumeAverages={volumeAverages}
                              oreMap={oreMap}
                              cvdMap={cvdMap}
                              rsMap={rsMap}
                              patternMap={patternMap}
                              shareholdingMap={shareholdingMap}
                              oiSignalMap={oiSignalMap}
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-3">
                          <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-2">
                              <TrendingDown className="w-4 h-4 text-rose-600 dark:text-rose-500" />
                              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 tracking-tight">Intraday Bearish Snipes</h3>
                            </div>
                            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{displayBearish.length} Stocks</span>
                          </div>
                          <div className="bg-white/40 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800/60 rounded-xl shadow-sm overflow-hidden backdrop-blur-sm">
                            <StockTable
                              data={displayBearish}
                              type="bearish"
                              isSniper={isSniperActive}
                              engineMode="raw"
                              orbDataCache={orbDataCache}
                              dailyCandleData={dailyCandleData}
                              valuationDataCache={valuationDataCache}
                              shareholdingDataCache={shareholdingDataCache}
                              qualityDataCache={qualityDataCache}
                              boosterStocksList={boosterStocksList}
                              historicalDataCache={historicalDataCache}
                              fiiDiiPulseData={fiiDiiPulseData}
                              derivativeSummaryData={derivativeSummaryData}
                              portfolioSymbols={portfolioSymbols}
                              volumeAverages={volumeAverages}
                              oreMap={oreMap}
                              cvdMap={cvdMap}
                              rsMap={rsMap}
                              patternMap={patternMap}
                              shareholdingMap={shareholdingMap}
                              oiSignalMap={oiSignalMap}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // Raw Master F&O Mode: Centered, Full Width, No Right Sidebar, No Search/Filter bars
                <div className="space-y-6">
                  {/* Stock Tables depending on isSniperActive */}
                  {masterStocks.length === 0 ? (
                    <div className="min-h-[450px] flex flex-col items-center justify-center bg-slate-50/50 dark:bg-slate-900/10 border border-slate-200 dark:border-slate-800/40 rounded-3xl p-12 text-center backdrop-blur-sm shadow-inner">
                      <Zap className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-6 animate-pulse" />
                      <h3 className="text-xl font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-widest">Active Database Empty</h3>
                      <p className="text-slate-500 dark:text-slate-600 text-sm max-w-sm mb-8 leading-relaxed">Prime the scanner via live StockeZee proxy or paste JSON from Network &gt; Response tab.</p>
                      <div className="flex flex-wrap justify-center gap-4">
                        <label className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl cursor-pointer shadow-lg shadow-indigo-600/20 transition-all">
                          <Upload className="w-4 h-4" />
                          Import JSON File
                          <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
                        </label>
                        <button
                          onClick={() => handleClipboardInjection('master')}
                          className="px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl transition-all shadow-sm"
                        >
                          📋 Paste from Clipboard
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Suspense fallback={<LazyLoader />}>
                      {/* Market Regime & Smart Money Compass */}
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                        <div className="lg:col-span-2">
                          <MarketRegimeWidget />
                        </div>
                        <div className="lg:col-span-1">
                          <SmartMoneyCompass />
                        </div>
                      </div>

                      {/* ─── DOMAIN 08: FII / DII INSTITUTIONAL MACRO RADAR & 08:30 AM BIAS ─── */}
                      <Suspense fallback={<div className="h-48 rounded-2xl bg-slate-900/50 animate-pulse border border-slate-800" />}>
                        <InstitutionalMacroRadar />
                      </Suspense>

                      <MarketMoodWidget autoRefresh={isAutoRefresh} refreshTrigger={refreshCount} isVisible={isVisible} />
                      
                      <div className="flex flex-col gap-4 sm:gap-6">
                        {/* ─── DOMAIN 07: ZERO-HESITATION TRIGGER TERMINAL ─── */}
                        <Suspense fallback={<div className="h-48 rounded-2xl bg-slate-900/50 animate-pulse border border-slate-800" />}>
                          <ZeroHesitationTrigger defaultSymbol="NIFTY" />
                        </Suspense>

                        {/* ─── DOMAIN 03 & 06: TACTICAL PLAYBOOK ARSENAL & NOISE GATE ─── */}
                        <Suspense fallback={<div className="h-48 rounded-2xl bg-slate-900/50 animate-pulse border border-slate-800" />}>
                          <TacticalArsenal />
                        </Suspense>

                        {/* ─── DOMAIN 13: 09:30 AM SECTOR ROTATION VELOCITY & RULE OF TWO ─── */}
                        <Suspense fallback={<div className="h-48 rounded-2xl bg-slate-900/50 animate-pulse border border-slate-800" />}>
                          <SectorVelocityRadar />
                        </Suspense>

                        {/* ─── DOMAIN 04: SLOW ACCUMULATOR CASH VCP & CATALYST RADAR ─── */}
                        <Suspense fallback={<div className="h-48 rounded-2xl bg-slate-900/50 animate-pulse border border-slate-800" />}>
                          <SlowAccumulatorRadar />
                        </Suspense>

                        {/* ─── TRADE SNIPER: ONE PANEL TO RULE THEM ALL ─── */}
                        <TradeSniperPanel
                          autoRefresh={isAutoRefresh}
                          refreshTrigger={refreshCount}
                          isVisible={isVisible}
                          onStockSelect={(stock) => setSelectedStock(stock)}
                        />
                        <SectorScopeWidget
                          onSectorSelect={(sector) => {
                            setSelectedSector(sector);
                            setSelectedStock(null);
                            const constituents = SECTOR_CONSTITUENTS[sector];
                            const filtered = constituents
                              ? masterStocks.filter(s => constituents.includes(s.Symbol))
                              : masterStocks.filter(s => s.Sector === sector);
                            setStocks(filtered);
                          }}
                          selectedSector={selectedSector}
                          autoRefresh={isAutoRefresh}
                          refreshTrigger={refreshCount}
                          isVisible={isVisible}
                        />
                        <StockScreenerWidget
                          onStockSelect={(stock) => setSelectedStock(stock)}
                          selectedSector={selectedSector}
                          selectedStock={selectedStock}
                          autoRefresh={isAutoRefresh}
                          refreshTrigger={refreshCount}
                          isVisible={isVisible}
                          volumeAverages={volumeAverages}
                          qualityDataCache={qualityDataCache}
                        />

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                          <div className={selectedStock ? "lg:col-span-2" : "lg:col-span-3"}>
                            <IntradayBoostPanel
                              onStockSelect={(stock) => setSelectedStock(stock)}
                              selectedStock={selectedStock}
                              autoRefresh={isAutoRefresh}
                              refreshTrigger={refreshCount}
                              isVisible={isVisible}
                              onBoosterMapUpdate={setBoosterScoreMap}
                            />
                          </div>
                          {selectedStock && (
                            <div className="lg:col-span-1">
                              <OptionLauncherWidget stock={selectedStock} isVisible={isVisible} lotSizesData={lotSizesData} />
                            </div>
                          )}
                        </div>
                      </div>
                    </Suspense>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {activeSubTab === 'screener' && (
            <motion.div key="screener" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
              {/* Unified Screener Sub-Tabs Grid or Active Mode */}
              {shadowMode === 'all' ? (
                <Suspense fallback={<LazyLoader />}>
                  <ScreenerGridMenu
                    setShadowMode={setShadowMode}
                    fetchCandlestickData={fetchCandlestickData}
                    fetchHistoricalData={fetchHistoricalData}
                    fetchORBData={fetchORBData}
                    fetchValuationData={fetchValuationData}
                    fetchResultsCalendarData={fetchResultsCalendarData}
                    fetchShareholdingData={fetchShareholdingData}
                    fetchQualityData={fetchQualityData}
                    fetchPulseProxy={fetchPulseProxy}
                    fetchLotSizesData={fetchLotSizesData}
                    fetchFiiDiiAllData={() => fetchFiiDiiAllData(getToken())}
                    fetchPrebuildScreensAction={fetchPrebuildScreensAction}
                    convergenceResults={convergenceResults}
                  />
                </Suspense>
              ) : (
                <div className="bg-white/40 dark:bg-slate-900/10 border border-slate-200 dark:border-slate-800/40 rounded-3xl p-6 backdrop-blur-xl relative overflow-hidden shadow-2xl">
                  {shadowMode === 'candlestick' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex bg-slate-100/50 dark:bg-slate-950/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner">
                            <button onClick={() => { setCandleTimeframe('daily'); fetchCandlestickData('daily'); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${candleTimeframe === 'daily' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Daily Timeframe</button>
                            <button onClick={() => { setCandleTimeframe('weekly'); fetchCandlestickData('weekly'); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${candleTimeframe === 'weekly' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Weekly Timeframe</button>
                          </div>
                          <button
                            onClick={() => fetchCandlestickData(candleTimeframe, true)}
                            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-xl text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest transition-colors shadow-sm"
                          >
                            <RefreshCw className={`w-3 h-3 ${isFetchingCandles ? 'animate-spin' : ''}`} />
                            Sync Scans
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 bg-slate-50/50 dark:bg-slate-900/40 p-2 rounded-2xl border border-slate-200 dark:border-slate-800/50 overflow-x-auto no-scrollbar shadow-inner">
                        {(candleTimeframe === 'daily' ? dailyCandleData : weeklyCandleData)?.available_pattens?.map((p: string) => (
                          <button
                            key={p}
                            onClick={() => setSelectedCandlePattern(p)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold transition-all whitespace-nowrap shadow-sm ${selectedCandlePattern === p ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-white dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'}`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>

                      {isFetchingCandles ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
                          <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(99,102,241,0.15)]"></div>
                          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Running Candlestick Scanner</h3>
                        </div>
                      ) : (
                        <CandlestickPatternTable
                          data={ShadowScreenerService.transformToStockData(
                            (candleTimeframe === 'daily' ? dailyCandleData : weeklyCandleData)?.[selectedCandlePattern.toLowerCase()] || []
                          )}
                          selectedPattern={selectedCandlePattern}
                        />
                      )}
                    </div>
                  )}

                  {shadowMode === 'gainers' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex bg-slate-100/50 dark:bg-slate-950/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner">
                            <button onClick={() => { setHistoricalType('gainers'); fetchHistoricalData('gainers', historicalTimeframe); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${historicalType === 'gainers' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Top Gainers</button>
                            <button onClick={() => { setHistoricalType('loosers'); fetchHistoricalData('loosers', historicalTimeframe); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${historicalType === 'loosers' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Top Losers</button>
                          </div>
                          <div className="flex bg-slate-100/50 dark:bg-slate-950/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner">
                            {['day', 'week', 'month', 'year'].map((tf) => (
                              <button
                                key={tf}
                                onClick={() => { setHistoricalTimeframe(tf as any); fetchHistoricalData(historicalType, tf as any); }}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${historicalTimeframe === tf ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                              >
                                {tf === 'day' ? '1D' : tf === 'week' ? '1W' : tf === 'month' ? '1M' : '1Y'}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => fetchHistoricalData(historicalType, historicalTimeframe, true)}
                            className="p-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-xl transition-colors shadow-sm"
                          >
                            <RefreshCw className={`w-3 h-3 text-slate-500 dark:text-slate-400 ${isFetchingHistorical ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {isFetchingHistorical ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
                          <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(99,102,241,0.15)]"></div>
                          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Analyzing Performance Data</h3>
                        </div>
                      ) : (
                        <div className="bg-slate-50/50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800/60 rounded-2xl shadow-inner overflow-hidden">
                          <StockTable
                            data={ShadowScreenerService.transformHistoricalToStockData(historicalDataCache[`${historicalType}_${historicalTimeframe}`] || [])}
                            type={historicalType === 'gainers' ? 'bullish' : 'bearish'}
                            isSniper={false}
                            engineMode="raw"
                            portfolioSymbols={portfolioSymbols}
                            volumeAverages={volumeAverages}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {shadowMode === 'orb' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex bg-slate-100/50 dark:bg-slate-950/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner">
                            {[15, 30, 45, 60].map(mins => (
                              <button
                                key={mins}
                                onClick={() => { setOrbMinutes(mins as any); fetchORBData(mins as any, orbWithPrb); }}
                                className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${orbMinutes === mins ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                              >
                                {mins}M
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => { setOrbWithPrb(!orbWithPrb); fetchORBData(orbMinutes, !orbWithPrb); }}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border shadow-sm ${orbWithPrb ? 'bg-indigo-600 dark:bg-indigo-600/20 border-indigo-600 dark:border-indigo-500 text-white dark:text-indigo-400 shadow-lg' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-200'}`}
                          >
                            PRB Breakout: {orbWithPrb ? 'ON' : 'OFF'}
                          </button>
                          <button
                            onClick={() => fetchORBData(orbMinutes, orbWithPrb, true)}
                            className="p-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-xl transition-colors shadow-sm"
                          >
                            <RefreshCw className={`w-3 h-3 text-slate-500 dark:text-slate-400 ${isFetchingORB ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {isFetchingORB ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
                          <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(99,102,241,0.15)]"></div>
                          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Running Open Range Breakout Scanner</h3>
                        </div>
                      ) : (
                        <Suspense fallback={<LazyLoader />}>
                          <ORBTable
                            data={ShadowScreenerService.transformORBToStockData(orbDataCache[`${orbMinutes}_${orbWithPrb}`] || [])}
                            selectedMinutes={orbMinutes}
                          />
                        </Suspense>
                      )}
                    </div>
                  )}

                  {shadowMode === 'valuation' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <div className="flex items-gap-3">
                          <div className="flex bg-slate-100/50 dark:bg-slate-950/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner">
                            <button onClick={() => { setValuationType('under_valued'); fetchValuationData('under_valued'); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${valuationType === 'under_valued' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Undervalued</button>
                            <button onClick={() => { setValuationType('over_valued'); fetchValuationData('over_valued'); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${valuationType === 'over_valued' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Overvalued</button>
                          </div>
                        </div>
                      </div>

                      {isFetchingValuation ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
                          <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto"></div>
                          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Calculating Intrinsic Value</h3>
                        </div>
                      ) : (
                        <Suspense fallback={<LazyLoader />}>
                          <ValuationTable
                            data={ShadowScreenerService.transformValuationToStockData(valuationDataCache[valuationType] || [])}
                            type={valuationType}
                          />
                        </Suspense>
                      )}
                    </div>
                  )}

                  {shadowMode === 'results' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <button
                          onClick={() => fetchResultsCalendarData(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-xl text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest transition-colors shadow-sm"
                        >
                          <RefreshCw className={`w-3 h-3 ${isFetchingResults ? 'animate-spin' : ''}`} />
                          Sync Calendar
                        </button>
                      </div>

                      {isFetchingResults ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
                          <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto"></div>
                          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Fetching Earnings Schedule</h3>
                        </div>
                      ) : (
                        <Suspense fallback={<LazyLoader />}>
                          <ResultsCalendarTable data={resultsCalendarData} />
                        </Suspense>
                      )}
                    </div>
                  )}

                  {shadowMode === 'convergence' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => {
                              setIsScanningConvergence(true);
                              try {
                                const worker = new Worker(
                                  new URL('../../workers/convergenceWorker.ts', import.meta.url),
                                  { type: 'module' }
                                );
                                worker.onmessage = (e: MessageEvent) => {
                                  const { type, payload } = e.data;
                                  if (type === 'CONVERGENCE_COMPLETE') {
                                    setConvergenceResults(payload.results);
                                    setIsScanningConvergence(false);
                                    worker.terminate();
                                  } else {
                                    console.error('Worker returned error:', payload);
                                    const results = ConvergenceEngine.runConvergenceScan(convergenceDirection, convergenceMode);
                                    setConvergenceResults(results);
                                    setIsScanningConvergence(false);
                                    worker.terminate();
                                  }
                                };
                                worker.onerror = (err) => {
                                  console.error('Worker error:', err);
                                  const results = ConvergenceEngine.runConvergenceScan(convergenceDirection, convergenceMode);
                                  setConvergenceResults(results);
                                  setIsScanningConvergence(false);
                                  worker.terminate();
                                };
                                const caches = ConvergenceEngine.loadAllCaches();
                                worker.postMessage({
                                  type: 'RUN_CONVERGENCE',
                                  payload: { direction: convergenceDirection, mode: convergenceMode, caches }
                                });
                              } catch (err) {
                                console.error('Failed to create worker, falling back to sync scan:', err);
                                const results = ConvergenceEngine.runConvergenceScan(convergenceDirection, convergenceMode);
                                setConvergenceResults(results);
                                setIsScanningConvergence(false);
                              }
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-xl text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest transition-colors shadow-sm"
                          >
                            <RefreshCw className={`w-3 h-3 text-indigo-600 dark:text-indigo-400 ${isScanningConvergence ? 'animate-spin' : ''}`} />
                            Refresh Scan
                          </button>
                        </div>
                      </div>

                      {isScanningConvergence ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
                          <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(99,102,241,0.15)]"></div>
                          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Running Convergence Scan</h3>
                        </div>
                      ) : (
                        <Suspense fallback={<LazyLoader />}>
                          <ConvergenceTable
                            data={convergenceResults}
                            direction={convergenceDirection}
                            setDirection={setConvergenceDirection}
                            mode={convergenceMode}
                            setMode={setConvergenceMode}
                            portfolioSymbols={portfolioSymbols}
                          />
                        </Suspense>
                      )}
                    </div>
                  )}

                  {shadowMode === 'shareholding' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex bg-slate-100/50 dark:bg-slate-950/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner">
                            <button
                              onClick={() => { setShareholdingInvestor('fii'); fetchShareholdingData('fii', shareholdingTrans); }}
                              className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${shareholdingInvestor === 'fii' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >FII Activity</button>
                            <button
                              onClick={() => { setShareholdingInvestor('promoter'); fetchShareholdingData('promoter', shareholdingTrans); }}
                              className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${shareholdingInvestor === 'promoter' ? 'bg-orange-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >Promoter Activity</button>
                          </div>
                          <div className="flex bg-slate-100/50 dark:bg-slate-950/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner">
                            <button
                              onClick={() => { setShareholdingTrans('buy'); fetchShareholdingData(shareholdingInvestor, 'buy'); }}
                              className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${shareholdingTrans === 'buy' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >Buying</button>
                            <button
                              onClick={() => { setShareholdingTrans('sell'); fetchShareholdingData(shareholdingInvestor, 'sell'); }}
                              className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${shareholdingTrans === 'sell' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >Selling</button>
                          </div>
                          <button
                            onClick={() => fetchShareholdingData(shareholdingInvestor, shareholdingTrans, true)}
                            className="p-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-xl transition-colors shadow-sm"
                          >
                            <RefreshCw className={`w-3 h-3 text-slate-500 dark:text-slate-400 ${isFetchingShareholding ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {isFetchingShareholding ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
                          <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(99,102,241,0.15)]"></div>
                          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Scanning Institutional Radar</h3>
                        </div>
                      ) : (
                        <Suspense fallback={<LazyLoader />}>
                          <ShareholdingActivityTable
                            data={shareholdingDataCache[`${shareholdingInvestor}_${shareholdingTrans}`] || []}
                            investorType={shareholdingInvestor}
                            transactionType={shareholdingTrans}
                          />
                        </Suspense>
                      )}
                    </div>
                  )}

                  {shadowMode === 'quality' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <button
                          onClick={() => fetchQualityData(qualityScoreType, qualityFilter, true)}
                          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-xl text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest transition-colors shadow-sm"
                        >
                          <RefreshCw className={`w-3 h-3 ${isFetchingQuality ? 'animate-spin' : ''}`} />
                          Sync Diagnostics
                        </button>
                      </div>

                      {isFetchingQuality ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
                          <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(99,102,241,0.15)]"></div>
                          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Running AI Quality Audit</h3>
                        </div>
                      ) : (
                        <Suspense fallback={<LazyLoader />}>
                          <QualityScorecard
                            data={qualityDataCache[`${qualityScoreType}_${qualityFilter}`] || []}
                            selectedType={qualityScoreType}
                            onTypeChange={(t: string) => { setQualityScoreType(t); fetchQualityData(t, qualityFilter); }}
                            selectedFilter={qualityFilter}
                            onFilterChange={(f: 'high' | 'low') => { setQualityFilter(f); fetchQualityData(qualityScoreType, f); }}
                            onSync={() => fetchQualityData(qualityScoreType, qualityFilter, true)}
                          />
                        </Suspense>
                      )}
                    </div>
                  )}

                  {shadowMode === 'momentum' && (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                      </div>
                      <Suspense fallback={<LazyLoader />}>
                        <MomentumHub />
                      </Suspense>
                    </div>
                  )}

                  {shadowMode === 'fno_movements' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <button
                          onClick={() => fetchPulseProxy()}
                          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-xl text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest transition-colors shadow-sm"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isFetchingPulse ? 'animate-spin' : ''}`} />
                          Sync F&O Movements
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2 items-center bg-slate-50/50 dark:bg-slate-900/30 p-2 rounded-2xl border border-slate-200 dark:border-slate-800/40 shadow-inner">
                        {[
                          { id: 'top_gainers', label: 'Top Gainers' },
                          { id: 'top_losers', label: 'Top Losers' },
                          { id: 'open_low', label: 'Same Open & Low' },
                          { id: 'open_high', label: 'Same Open & High' },
                          { id: 'gap_up', label: 'Gap Up' },
                          { id: 'gap_down', label: 'Gap Down' },
                        ].map(sig => (
                          <button
                            key={sig.id}
                            onClick={() => setPulseFilter(sig.id as any)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm ${pulseFilter === sig.id
                              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                              : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-300 border border-slate-200 dark:border-transparent hover:bg-slate-50'
                              }`}
                          >
                            {sig.label}
                          </button>
                        ))}
                        <div className="ml-auto px-4 text-[9px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-tighter">
                          {pulseStocks.length} Momentum Assets Synced
                        </div>
                      </div>

                      {pulseStocks.length === 0 ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center bg-slate-50/30 dark:bg-slate-900/10 border border-slate-200 dark:border-slate-800/40 rounded-3xl p-12 text-center shadow-inner">
                          <RefreshCw className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-6 animate-pulse" />
                          <h3 className="text-xl font-bold text-slate-400 mb-2 uppercase tracking-widest">Waiting for Pulse Data...</h3>
                          <p className="text-slate-500 text-sm max-w-md">Sync Live via the API bridge or import Top Gainers JSON to activate the F&O Movements radar.</p>
                        </div>
                      ) : (
                        <div className="bg-slate-50/50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800/60 rounded-2xl shadow-inner overflow-hidden">
                          <StockTable
                            data={fnoMovementsFiltered}
                            type="bullish"
                            isSniper={isSniperActive}
                            engineMode="pulse"
                            orbDataCache={orbDataCache}
                            dailyCandleData={dailyCandleData}
                            valuationDataCache={valuationDataCache}
                            shareholdingDataCache={shareholdingDataCache}
                            qualityDataCache={qualityDataCache}
                            boosterStocksList={boosterStocksList}
                            historicalDataCache={historicalDataCache}
                            fiiDiiPulseData={fiiDiiPulseData}
                            derivativeSummaryData={derivativeSummaryData}
                            portfolioSymbols={portfolioSymbols}
                            volumeAverages={volumeAverages}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {shadowMode === 'lot_size' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                        <button
                          onClick={() => fetchLotSizesData(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/50 rounded-xl text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest transition-colors shadow-sm"
                        >
                          <RefreshCw className={`w-3 h-3 ${isFetchingLotSizes ? 'animate-spin' : ''}`} />
                          Sync Lot Sizes
                        </button>
                      </div>

                      {isFetchingLotSizes ? (
                        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
                          <div className="w-16 h-16 border-4 border-cyan-500/10 dark:border-cyan-500/20 border-t-cyan-600 dark:border-t-cyan-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(6,182,212,0.15)]"></div>
                          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.3em] animate-pulse">Fetching F&O Lot Sizes</h3>
                        </div>
                      ) : (
                        <Suspense fallback={<LazyLoader />}>
                          <LotSizeTable data={lotSizesData} />
                        </Suspense>
                      )}
                    </div>
                  )}

                  {shadowMode === 'fii_dii_pulse' && (
                    <React.Suspense fallback={<div className="p-10 text-center animate-pulse text-xs font-bold text-slate-500 uppercase tracking-widest">Loading FII/DII Pulse...</div>}>
                      <FiiDiiPulseDashboard
                        pulseData={fiiDiiPulseData}
                        oiData={participantOiData}
                        summaryData={derivativeSummaryData}
                        isLoading={isFetchingFiiDiiPulse || isFetchingOi || isFetchingSummary}
                        onRefresh={() => fetchFiiDiiAllData(getToken(), true)}
                        onBack={() => setShadowMode('all')}
                        onManualPaste={handleManualFiiDiiPaste}
                      />
                    </React.Suspense>
                  )}

                  {shadowMode === 'smartlist_radar' && (
                    <React.Suspense fallback={<div className="p-10 text-center animate-pulse text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Smartlist Radar...</div>}>
                      <SmartlistRadar onBack={() => setShadowMode('all')} />
                    </React.Suspense>
                  )}

                  {shadowMode === 'snapshot_timeline' && (
                    <React.Suspense fallback={<div className="p-10 text-center animate-pulse text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Snapshot Replay...</div>}>
                      <SnapshotTimelinePanel onBack={() => setShadowMode('all')} />
                    </React.Suspense>
                  )}

                  {shadowMode === 'delivery_radar' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                      </div>
                      <Suspense fallback={<LazyLoader />}>
                        <DeliveryAccumulationWidget />
                      </Suspense>
                    </div>
                  )}

                  {shadowMode === 'insider_intelligence' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                      </div>
                      <Suspense fallback={<LazyLoader />}>
                        <InsiderTradingWidget />
                      </Suspense>
                    </div>
                  )}

                  {shadowMode === 'mf_flows' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                      </div>
                      <Suspense fallback={<LazyLoader />}>
                        <MfFlowWidget />
                      </Suspense>
                    </div>
                  )}

                  {shadowMode === 'order_flow' && (
                    <div className="space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                      </div>
                      <Suspense fallback={<LazyLoader />}>
                        <OrderFlowDashboardWidget />
                      </Suspense>
                    </div>
                  )}

                  {shadowMode === 'oi_command_center' && (
                    <React.Suspense fallback={<div className="p-10 text-center animate-pulse text-xs font-bold text-slate-500 uppercase tracking-widest">Loading OI PCR Command Center...</div>}>
                      <OIPcrCommandCenter
                        derivativeSummaryData={derivativeSummaryData}
                        isFetchingSummary={isFetchingSummary}
                        onRefreshSummary={() => fetchFiiDiiAllData(getToken(), true)}
                        onBack={() => setShadowMode('all')}
                      />
                    </React.Suspense>
                  )}

                  {shadowMode === 'smart_watchlist' && (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <button onClick={() => setShadowMode('all')} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors">
                          ← Back to Terminal
                        </button>
                      </div>
                      <Suspense fallback={<LazyLoader />}>
                        <SmartWatchlist
                          onDeselectStock={(ticker) => {
                            if (selectedStock && selectedStock.Symbol === ticker) {
                              setSelectedStock(null);
                            }
                          }}
                        />
                      </Suspense>
                    </div>
                  )}

                  {shadowMode === 'tech_indicators_screener' && (
                    <Suspense fallback={<LazyLoader />}>
                      <TechnicalIndicatorPanel
                        prebuildScreens={prebuildScreens}
                        selectedIndicator={selectedIndicator}
                        setSelectedIndicator={setSelectedIndicator}
                        selectedCondition={selectedCondition}
                        setSelectedCondition={setSelectedCondition}
                        indicatorScreenerData={indicatorScreenerData}
                        screenerLoading={screenerLoading}
                        fetchIndicatorScreenerAction={fetchIndicatorScreenerAction}
                        onBack={() => setShadowMode('all')}
                        isWarmingIndicators={isWarmingIndicators}
                        warmingIndicatorStep={warmingIndicatorStep}
                        warmingIndicatorLabel={warmingIndicatorLabel}
                        warmTechnicalIndicators={warmTechnicalIndicators}
                      />
                    </Suspense>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {activeSubTab === 'heatmap' && (
            <Suspense fallback={<LazyLoader />}>
              <HeatmapMatrixPanel
                sectors={sectors}
                isFetchingSectors={isFetchingSectors}
                fetchSectorAnalysis={fetchSectorAnalysis}
                activeDrillSector={activeDrillSector}
                setActiveDrillSector={setActiveDrillSector}
                sectorTimeframe={sectorTimeframe}
                setSectorTimeframe={setSectorTimeframe}
                boosterStocks={boosterStocks}
                isFetchingBooster={isFetchingBooster}
                isVisible={isVisible}
              />
            </Suspense>
          )}

          {activeSubTab === 'market-command' && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              <Suspense fallback={<LazyLoader />}>
                <MarketCommandCenter
                  onSectorDrillDown={(sector) => {
                    setActiveDrillSector(sector);
                    if (onTabChange) onTabChange('heatmap');
                  }}
                />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>
      )}


{/* FRIENDLY CORS MODAL GUIDE */ }
<AnimatePresence>
  {showCorsGuide && (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850/80 p-6 rounded-3xl max-w-xl w-full shadow-2xl relative">
        <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight uppercase flex items-center gap-2 mb-4">
          <span className="w-2.5 h-2.5 bg-yellow-500 rounded-full animate-pulse shrink-0"></span>
          Automatic Proxy Synced
        </h3>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed mb-6">
          Direct browser requests are bypassable using our Vite internal reverse-proxy. To enable seamless authentication:
        </p>
        <div className="space-y-4 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 mb-6 shadow-inner">
          <div className="flex gap-3">
            <div className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-black rounded-lg w-6 h-6 flex items-center justify-center text-xs shrink-0 border border-indigo-100 dark:border-indigo-500/20">1</div>
            <p className="text-[11px] text-slate-700 dark:text-slate-300">Open <strong className="text-slate-900 dark:text-white">Bridge Config</strong> on the top-right</p>
          </div>
          <div className="flex gap-3">
            <div className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-black rounded-lg w-6 h-6 flex items-center justify-center text-xs shrink-0 border border-indigo-100 dark:border-indigo-500/20">2</div>
            <p className="text-[11px] text-slate-700 dark:text-slate-300">Select the <strong className="text-slate-900 dark:text-white">⚡ Token</strong> tab</p>
          </div>
          <div className="flex gap-3">
            <div className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-black rounded-lg w-6 h-6 flex items-center justify-center text-xs shrink-0 border border-indigo-100 dark:border-indigo-500/20">3</div>
            <p className="text-[11px] text-slate-700 dark:text-slate-300">Paste your StockeZee <code className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1 py-0.5 rounded text-indigo-600 dark:text-indigo-300 font-mono">x-stockezee-token</code> from network requests and save.</p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowCorsGuide(false)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20"
          >
            Got It, Open Config
          </button>
        </div>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>

{/* BRIDGE CONFIGURATION MODAL */ }
<AnimatePresence>
  {isBridgeConfigOpen && (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-pulse" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight uppercase">Terminal Bridge Config</h3>
          </div>
          <button onClick={() => setIsBridgeConfigOpen(false)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white text-sm font-bold p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">✕</button>
        </div>

        {/* Internal bridge subtabs & Quick Paste Actions */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/20 p-2 gap-2">
          <Tabs.Root
            value={activeBridgeTab}
            onValueChange={(v) => setActiveBridgeTab(v as any)}
            layoutId="bridge-subtabs-slider"
            variant="solid-indigo"
            motionPreset="spring"
          >
            <Tabs.List className="min-h-[34px] sm:min-h-[36px] p-0.5 sm:p-1 bg-slate-100/80 dark:bg-slate-950/80 border border-slate-200/80 dark:border-slate-800/80">
              <Tabs.Trigger
                value="token"
                className="px-2.5 sm:px-3 min-h-[26px] sm:min-h-[28px] text-[10px] sm:text-[10.5px] font-bold uppercase tracking-wider"
              >
                <Zap size={12} className={`shrink-0 ${activeBridgeTab === 'token' ? 'text-white' : 'text-amber-500'}`} />
                <span>Token Config</span>
              </Tabs.Trigger>
              <Tabs.Trigger
                value="master"
                className="px-2.5 sm:px-3 min-h-[26px] sm:min-h-[28px] text-[10px] sm:text-[10.5px] font-bold uppercase tracking-wider"
              >
                <Database size={12} className={`shrink-0 ${activeBridgeTab === 'master' ? 'text-white' : 'text-indigo-400'}`} />
                <span>Master / Sector</span>
              </Tabs.Trigger>
              <Tabs.Trigger
                value="pulse"
                className="px-2.5 sm:px-3 min-h-[26px] sm:min-h-[28px] text-[10px] sm:text-[10.5px] font-bold uppercase tracking-wider"
              >
                <Activity size={12} className={`shrink-0 ${activeBridgeTab === 'pulse' ? 'text-white' : 'text-emerald-400'}`} />
                <span>Pulse Code</span>
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>

          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => handleClipboardInjection('master')}
              title="Paste Master Live JSON from clipboard"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold uppercase tracking-wider rounded-xl border border-slate-200 dark:border-slate-700/60 shadow-sm transition-all cursor-pointer"
            >
              <Clipboard className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Paste Master</span>
            </button>
            <button
              onClick={() => handleClipboardInjection('sniper')}
              title="Paste Sniper List from clipboard"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold uppercase tracking-wider rounded-xl border border-slate-200 dark:border-slate-700/60 shadow-sm transition-all cursor-pointer"
            >
              <Clipboard className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Paste Sniper</span>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {activeBridgeTab === 'token' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">StockeZee Authorization Token</label>
                <input
                  type="password"
                  placeholder="Paste your stockezee x-stockezee-token value here..."
                  value={stockezeeToken}
                  onChange={(e) => setStockezeeToken(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none focus:border-indigo-500 transition-all font-mono shadow-inner"
                />
                <p className="text-[10px] text-slate-500 mt-2 leading-relaxed italic">
                  To fetch this token, login to StockeZee on your browser, open DevTools → Network tab, select any request, and copy the value of the header <code className="bg-white dark:bg-slate-950 px-1 py-0.5 rounded text-indigo-600 dark:text-indigo-300 font-mono border border-slate-200 dark:border-slate-800">x-stockezee-token</code>.
                </p>
              </div>
              <button
                onClick={() => {
                  const trimmed = stockezeeToken.trim();
                  localStorage.setItem('stockezee_token', trimmed);
                  setIsBridgeConfigOpen(false);
                  fetchStockeZeeProxy(trimmed);
                  // Multi-device sync: Immediately propagate token to Cloud VPS for secondary devices
                  try {
                    syncEngine.notifyDataChanged('app_credentials');
                    syncEngine.performPush().catch(() => {});
                  } catch {
                    // Ignore sync errors
                  }
                }}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
              >
                Save Token & Authenticate
              </button>
            </div>
          )}

          {activeBridgeTab === 'master' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Master Code injection</label>
                <textarea
                  rows={4}
                  placeholder="Paste master database JSON response or bridge code..."
                  value={bridgeCode}
                  onChange={(e) => setBridgeCode(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-900 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none focus:border-indigo-500 transition-all font-mono shadow-inner"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Sector Booster Code Injection</label>
                <textarea
                  rows={3}
                  placeholder="Paste sector analysis booster JSON response here..."
                  value={sectorBridgeCode}
                  onChange={(e) => setSectorBridgeCode(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-900 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none focus:border-indigo-500 transition-all font-mono shadow-inner"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => saveBridgeConfig(bridgeCode, sectorBridgeCode, pulseBridgeCode)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all"
                >
                  Apply Code Injection
                </button>
              </div>
            </div>
          )}

          {activeBridgeTab === 'pulse' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Pulse Code Injection</label>
                <textarea
                  rows={8}
                  placeholder="Paste pulse database JSON or code..."
                  value={pulseBridgeCode}
                  onChange={(e) => setPulseBridgeCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => saveBridgeConfig(bridgeCode, sectorBridgeCode, pulseBridgeCode)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all"
                >
                  Apply Code Injection
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
<Suspense fallback={null}>
  { intraMode === 'fno' && <MorningBriefModal /> }
</Suspense>

{/* ADVANCED FILTER DRAWER OVERLAY */}
{typeof document !== 'undefined' ? createPortal(
  <AnimatePresence>
    {isFilterOpen && (
      <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsFilterOpen(false)}
            className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm z-[9999]"
          />
          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 180 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-slate-950/95 border-l border-slate-800/80 shadow-2xl z-[9999] flex flex-col backdrop-blur-xl"
          >
            {/* Header */}
            <div className="p-5 border-b border-slate-850 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-white uppercase tracking-wider">Advanced Filters</span>
              </div>
              <button
                onClick={() => setIsFilterOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Form Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
              {/* Section 1: Dynamic Targeting */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Apply Target</h4>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer select-none transition-all ${advancedFilters.applyToRowView
                      ? 'bg-indigo-600/10 border-indigo-500/35 text-white'
                      : 'bg-slate-900/40 border-slate-900 text-slate-400'
                    }`}>
                    <span className="text-xs font-semibold">Row View (Table)</span>
                    <input
                      type="checkbox"
                      checked={advancedFilters.applyToRowView}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, applyToRowView: e.target.checked })}
                      className="rounded border-slate-850 text-indigo-650 focus:ring-indigo-650 bg-slate-950 w-4 h-4"
                    />
                  </label>
                  <label className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer select-none transition-all ${advancedFilters.applyToCardView
                      ? 'bg-indigo-600/10 border-indigo-500/35 text-white'
                      : 'bg-slate-900/40 border-slate-900 text-slate-400'
                    }`}>
                    <span className="text-xs font-semibold">Card View (Radar)</span>
                    <input
                      type="checkbox"
                      checked={advancedFilters.applyToCardView}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, applyToCardView: e.target.checked })}
                      className="rounded border-slate-855 text-indigo-650 focus:ring-indigo-650 bg-slate-950 w-4 h-4"
                    />
                  </label>
                </div>
              </div>

              {/* Section 2: Custom Toggles */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Market Filters</h4>
                <div className="space-y-2 bg-slate-900/30 border border-slate-900/60 p-4 rounded-2xl">
                  {/* Exclude Penny Traps */}
                  <label className="flex items-center justify-between cursor-pointer select-none group py-1 border-b border-slate-900/40 pb-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-200">Exclude Penny Traps</span>
                      <span className="text-[9px] text-slate-500 font-medium">Ignore Volume &lt; 50k &amp; low turnover</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={advancedFilters.excludePennyTraps}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, excludePennyTraps: e.target.checked })}
                      className="rounded border-slate-800 text-indigo-600 bg-slate-955 w-4.5 h-4.5"
                    />
                  </label>
                  {/* Near Upper Circuit */}
                  <label className="flex items-center justify-between cursor-pointer select-none group py-1 border-b border-slate-900/40 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-200">Near Upper Circuit</span>
                      <span className="text-[9px] text-slate-500 font-medium">Within 2.0% of the upper circuit price</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={advancedFilters.nearUpperCircuit}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, nearUpperCircuit: e.target.checked })}
                      className="rounded border-slate-800 text-indigo-600 bg-slate-955 w-4.5 h-4.5"
                    />
                  </label>
                  {/* Open = Low */}
                  <label className="flex items-center justify-between cursor-pointer select-none group py-1 border-b border-slate-900/40 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-200">Open = Low</span>
                      <span className="text-[9px] text-slate-500 font-medium">Strong bullish morning momentum signal</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={advancedFilters.openEqualsLow}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, openEqualsLow: e.target.checked })}
                      className="rounded border-slate-800 text-indigo-600 bg-slate-955 w-4.5 h-4.5"
                    />
                  </label>
                  {/* Open = High */}
                  <label className="flex items-center justify-between cursor-pointer select-none group py-1 border-b border-slate-900/40 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-200">Open = High</span>
                      <span className="text-[9px] text-slate-500 font-medium">Strong bearish morning momentum signal</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={advancedFilters.openEqualsHigh}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, openEqualsHigh: e.target.checked })}
                      className="rounded border-slate-800 text-indigo-600 bg-slate-955 w-4.5 h-4.5"
                    />
                  </label>
                  {/* Positive Ownership */}
                  <label className="flex items-center justify-between cursor-pointer select-none group py-1 pt-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-200">Positive Institutional Ownership</span>
                      <span className="text-[9px] text-slate-500 font-medium">Stocks with positive promoter/FII activity score</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={advancedFilters.showOnlyPositiveOwnership}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, showOnlyPositiveOwnership: e.target.checked })}
                      className="rounded border-slate-800 text-indigo-600 bg-slate-955 w-4.5 h-4.5"
                    />
                  </label>
                </div>
              </div>

              {/* Section 2.5: Batch Scan Limit */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Batch Scan Limit</h4>
                <div className="bg-slate-900/30 border border-slate-900/60 p-4 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Scanned Stocks Limit</span>
                    <span className="text-xs font-mono font-black text-indigo-400">{advancedFilters.batchScanLimit ?? 500} Stocks</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="1500"
                    step="50"
                    value={advancedFilters.batchScanLimit ?? 500}
                    onChange={(e) => setAdvancedFilters({ ...advancedFilters, batchScanLimit: Number(e.target.value) })}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                    <span>Min: 50</span>
                    <span>Max: 1500</span>
                  </div>
                </div>
              </div>

              {/* Section 3: Range Inputs */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Numeric Filters</h4>

                {/* LTP Range */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">LTP Price (₹)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min Price"
                      value={advancedFilters.minPrice ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minPrice: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Price"
                      value={advancedFilters.maxPrice ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxPrice: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Change % Range */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Price Change (%)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min Change %"
                      value={advancedFilters.minChange ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minChange: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Change %"
                      value={advancedFilters.maxChange ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxChange: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Volume Range */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Absolute Volume</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min Volume"
                      value={advancedFilters.minVolume ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minVolume: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Volume"
                      value={advancedFilters.maxVolume ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxVolume: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* RVOL Range */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Relative Volume (RVOL)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min RVOL x"
                      value={advancedFilters.minRvol ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minRvol: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max RVOL x"
                      value={advancedFilters.maxRvol ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxRvol: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Score Range */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Strength Score</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min Score"
                      value={advancedFilters.minScore ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minScore: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Score"
                      value={advancedFilters.maxScore ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxScore: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Market Cap Range */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Market Cap (₹ Cr)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min Cap"
                      value={advancedFilters.minMcap ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minMcap: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Cap"
                      value={advancedFilters.maxMcap ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxMcap: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Turnover Range */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Traded Turnover (₹ Lakhs)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min Turnover"
                      value={advancedFilters.minTurnover ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minTurnover: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Turnover"
                      value={advancedFilters.maxTurnover ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxTurnover: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Intraday Spread / Range */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Intraday Range / Spread (%)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min Spread %"
                      value={advancedFilters.minIntradayRange ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minIntradayRange: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Spread %"
                      value={advancedFilters.maxIntradayRange ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxIntradayRange: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Open-to-LTP Change */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Open-to-LTP Momentum (%)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min Open-to-LTP"
                      value={advancedFilters.minOpenToLtp ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minOpenToLtp: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Open-to-LTP"
                      value={advancedFilters.maxOpenToLtp ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxOpenToLtp: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Opening Gap */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Opening Gap (%)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Min Gap %"
                      value={advancedFilters.minOpeningGap ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, minOpeningGap: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Gap %"
                      value={advancedFilters.maxOpeningGap ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxOpeningGap: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Day Extreme Proximity */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">Proximity to Day Extreme (%)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      placeholder="Max Dist to High %"
                      value={advancedFilters.maxDistanceToHOD ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxDistanceToHOD: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                    <input
                      type="number"
                      placeholder="Max Dist to Low %"
                      value={advancedFilters.maxDistanceToLOD ?? ''}
                      onChange={(e) => setAdvancedFilters({ ...advancedFilters, maxDistanceToLOD: e.target.value ? Number(e.target.value) : null })}
                      className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Cap Categories */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Cap Categories</h4>
                <div className="flex flex-wrap gap-2">
                  {['Large', 'Mid', 'Small'].map((category) => {
                    const isActive = advancedFilters.capCategories.includes(category);
                    return (
                      <button
                        key={category}
                        onClick={() => {
                          const current = [...advancedFilters.capCategories];
                          if (current.includes(category)) {
                            setAdvancedFilters({
                              ...advancedFilters,
                              capCategories: current.filter(c => c !== category)
                            });
                          } else {
                            setAdvancedFilters({
                              ...advancedFilters,
                              capCategories: [...current, category]
                            });
                          }
                        }}
                        className={`px-4 py-2 border rounded-xl text-xs font-bold transition-all ${isActive
                            ? 'bg-indigo-650 text-white border-indigo-500 shadow-md shadow-indigo-500/10'
                            : 'bg-slate-905 border-slate-850 text-slate-400 hover:text-slate-200'
                          }`}
                      >
                        {category}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 5: Sectors */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Sectors</h4>
                <div className="max-h-48 overflow-y-auto bg-slate-900/30 border border-slate-900/60 p-3.5 rounded-2xl space-y-2 no-scrollbar">
                  {uniqueSectors.map((sector) => {
                    const isChecked = advancedFilters.sectors.includes(sector);
                    return (
                      <label key={sector} className="flex items-center gap-3 cursor-pointer select-none py-1 group">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const current = [...advancedFilters.sectors];
                            if (current.includes(sector)) {
                              setAdvancedFilters({
                                ...advancedFilters,
                                sectors: current.filter(s => s !== sector)
                              });
                            } else {
                              setAdvancedFilters({
                                ...advancedFilters,
                                sectors: [...current, sector]
                              });
                            }
                          }}
                          className="rounded border-slate-800 text-indigo-600 bg-slate-950 w-4 h-4"
                        />
                        <span className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors">{sector}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Reset / Apply Actions footer */}
            <div className="p-5 border-t border-slate-850 bg-slate-950 flex gap-4">
              <button
                onClick={() => setAdvancedFilters({
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
                })}
                className="flex-1 py-3 bg-slate-900 hover:bg-slate-850 border border-slate-850 text-slate-400 hover:text-white text-xs font-bold rounded-xl transition-all"
              >
                Reset Defaults
              </button>
              <button
                onClick={() => setIsFilterOpen(false)}
                className="flex-1 py-3 bg-indigo-650 hover:bg-indigo-550 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/15"
              >
                Apply Filters
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  ) : null}
    </div>
  );
};

export default AlphaEngineTab;
