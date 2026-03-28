import React, { useEffect, useState, useMemo } from 'react';
import { 
  Activity, ArrowUp, ArrowDown, Shield, Compass, Zap, Sliders, 
  Download, Share2, AlertCircle, Info, ExternalLink, RefreshCw, Bell, BellOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { signalFusionService, MarketRegime, SmartMoneySignal, StockConviction } from '../../../services/alpha/SignalFusionService';
import { optionChainService, OptionChainSnapshot } from '../../../services/OptionChainService';
import { alphaEngineService } from '../../../services/AlphaEngineService';
import { smartAlertEngine, SmartAlert, AlertConfig } from '../../../services/alpha/SmartAlertEngine';
import { formatCurrency, formatCurrencyPrecise } from '../../../utils/helpers';
import { sanitizeStyleFragment } from '../../../utils/security';
import { reportExporter } from '../../../services/alpha/ReportExporter';
import { useGlobalTickStore, useInstrumentTick } from '../../../store/globalTickStore';
import { upstoxInstrumentService } from '../../../services/UpstoxInstrumentService';
import { useNavigationIntentStore } from '../../../store/navigationIntentStore';
import { usePausedInterval } from '../../../hooks/usePausedInterval';

interface MarketCommandCenterProps {
  onSendToBacktester?: (symbol: string) => void;
  onSectorDrillDown?: (sector: string) => void;
}

export const MarketCommandCenter: React.FC<MarketCommandCenterProps> = ({ onSendToBacktester, onSectorDrillDown }) => {
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [compass, setCompass] = useState<SmartMoneySignal | null>(null);
  const [convictions, setConvictions] = useState<StockConviction[]>([]);
  const [niftyChain, setNiftyChain] = useState<OptionChainSnapshot | null>(null);
  const [cachedSectors, setCachedSectors] = useState<any[]>(() => alphaEngineService.getCachedSectors());
  const [greekRegime, setGreekRegime] = useState<{
    vrp: number;
    vrpRegime: string;
    ivSkewRank: number | null;
    gexRegime: string;
  } | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [alertFeed, setAlertFeed] = useState<SmartAlert[]>(() => smartAlertEngine.getAlerts());
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState<AlertConfig>(() => smartAlertEngine.getConfig());

  const handleSendToBacktester = (symbol: string) => {
    sessionStorage.setItem('backtest_prefill_symbol', symbol);
    useNavigationIntentStore.getState().setIntent({
      target: 'backtester',
      action: 'configure_backtest',
      payload: { symbol },
      createdAt: Date.now()
    });
    if (onSendToBacktester) {
      onSendToBacktester(symbol);
    }
  };

  // WebSocket Live feeds for index prices
  const [indexKeys, setIndexKeys] = useState<Record<string, string>>({});
  useEffect(() => {
    upstoxInstrumentService.getInstrumentKeys(['NIFTY 50', 'INDIA VIX'], 'NSE_INDEX').then(keys => {
      setIndexKeys(keys);
    });
  }, []);

  const niftyKey = indexKeys['NIFTY 50'];
  const niftyTick = useInstrumentTick(niftyKey);
  const liveNiftyLtp = niftyTick?.ltp || niftyChain?.underlyingValue || 0;

  const loadData = async (manual: boolean = false) => {
    if (manual) setIsRefreshing(true);
    else setIsLoading(true);
    
    try {
      const regimeData = await signalFusionService.getMarketRegime();
      setRegime(regimeData);
      
      const compassData = await signalFusionService.getSmartMoneyCompass();
      setCompass(compassData);
      
      // Calculate conviction scores for top 30 F&O stocks
      const cachedStocks = alphaEngineService.getCachedStocks();
      if (cachedStocks.length > 0) {
        const computed = await Promise.all(
          cachedStocks.slice(0, 30).map(s => signalFusionService.computeTradeConviction(s))
        );
        const sorted = computed.sort((a, b) => b.convictionScore - a.convictionScore);
        setConvictions(sorted);
        
        // Trigger conviction surge alerts
        computed.forEach(c => {
          smartAlertEngine.checkConvictionSurge(c.symbol, 60, c.convictionScore);
        });
      }

      const chainData = await optionChainService.fetchOptionChain('NIFTY', undefined, manual);
      setNiftyChain(chainData);
      setCachedSectors(alphaEngineService.getCachedSectors());

      // Run Alert Engine Checks
      if (regimeData) {
        smartAlertEngine.checkVix(regimeData.vix);
        smartAlertEngine.checkPcr(regimeData.pcr);
      }
      if (chainData) {
        smartAlertEngine.checkMaxPainGravity(chainData.underlyingValue, chainData.maxPain);
      }

      // Fetch VRP and IV Skew
      try {
        const vrpRes = await fetch(`/api/python-nse/api/greeks/vrp?symbol=NIFTY`);
        const skewRes = await fetch(`/api/python-nse/api/greeks/skew?symbol=NIFTY`);
        const gexRes = await fetch(`/api/python-nse/api/greeks/gex?symbol=NIFTY`);
        if (vrpRes.ok && skewRes.ok && gexRes.ok) {
          const vrpData = await vrpRes.json();
          const skewData = await skewRes.json();
          const gexData = await gexRes.json();
          setGreekRegime({
            vrp: vrpData.vrp,
            vrpRegime: vrpData.regime,
            ivSkewRank: skewData.iv_skew_rank,
            gexRegime: gexData.regime
          });
        }
      } catch (err) {
        console.error("Failed to load Greek Regime stats:", err);
      }

    } catch (e) {
      console.error('MarketCommandCenter: Error loading datasets:', e);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    
    // Listen for alert updates
    const handleAlertsUpdate = (e: Event) => {
      setAlertFeed((e as CustomEvent).detail);
    };
    window.addEventListener('alpha_alerts_updated', handleAlertsUpdate);
    
    return () => {
      window.removeEventListener('alpha_alerts_updated', handleAlertsUpdate);
    };
  }, []);

  usePausedInterval(() => loadData(false), 45000, { runImmediately: false });

  // Compute Support / Resistance strikes from NIFTY Option Chain
  const { supportStrike, resistanceStrike, breakoutProb } = useMemo(() => {
    if (!niftyChain || !niftyChain.strikes || niftyChain.strikes.length === 0) {
      return { supportStrike: 0, resistanceStrike: 0, breakoutProb: 50 };
    }
    
    let maxPutOi = -1;
    let maxPutStrike = 0;
    let maxCallOi = -1;
    let maxCallStrike = 0;
    
    niftyChain.strikes.forEach(s => {
      if (s.PE && s.PE.oi > maxPutOi) {
        maxPutOi = s.PE.oi;
        maxPutStrike = s.strikePrice;
      }
      if (s.CE && s.CE.oi > maxCallOi) {
        maxCallOi = s.CE.oi;
        maxCallStrike = s.strikePrice;
      }
    });

    const totalCallOi = niftyChain.totalCallOI || 1;
    const callOiAtResistance = niftyChain.strikes.find(s => s.strikePrice === maxCallStrike)?.CE?.oi || 0;
    // Breakout probability score: inverse of resistance density
    const prob = Math.round(100 - (callOiAtResistance / totalCallOi) * 100);

    return {
      supportStrike: maxPutStrike,
      resistanceStrike: maxCallStrike,
      breakoutProb: Math.min(95, Math.max(5, prob))
    };
  }, [niftyChain]);

  // Report Exporters
  const handleExportPDF = () => {
    if (!regime) return;
    reportExporter.exportDailyReport(
      regime,
      niftyChain?.pcr || regime.pcr,
      [],
      convictions
    );
  };

  const handleShareSetup = () => {
    if (!regime) return;
    reportExporter.shareSetup(
      regime,
      niftyChain?.maxPain || 0,
      supportStrike,
      resistanceStrike,
      compass?.score || 0
    );
  };

  const handleSaveAlertConfig = () => {
    smartAlertEngine.saveConfig(alertConfig);
    setIsAlertModalOpen(false);
  };

  const niftyChange = useMemo(() => {
    if (!niftyChain || !niftyChain.underlyingValue) return 0.45;
    return (((liveNiftyLtp ?? 0) - niftyChain.underlyingValue) / niftyChain.underlyingValue) * 100;
  }, [liveNiftyLtp, niftyChain]);

  const vixValue = useMemo(() => {
    return regime?.vix || 13.85;
  }, [regime]);

  const pulseSectors = useMemo(() => {
    const list = ['IT', 'AUTO', 'METAL', 'PHARMA', 'FMCG', 'REALTY'];
    return cachedSectors
      .filter(s => list.includes(s.sector.toUpperCase()))
      .slice(0, 4);
  }, [cachedSectors]);

  if (isLoading && !regime) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] gap-4">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-black text-indigo-400 uppercase tracking-widest animate-pulse">Syncing Command Center Cockpit...</p>
      </div>
    );
  }

  const bankSector = cachedSectors.find(s => s.sector.toUpperCase() === 'BANK');
  const bankNiftyChange = bankSector?.percentChange ?? 0.62;

  const marqueeContent = (
    <div className="inline-flex items-center gap-6">
      <span className="flex items-center gap-2">
        <span className="text-white">NIFTY 50</span>
        <span className="font-mono text-white">{formatCurrencyPrecise(liveNiftyLtp || 22800)}</span>
        <span className={niftyChange >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
          {niftyChange >= 0 ? '▲' : '▼'} {Math.abs(niftyChange).toFixed(2)}%
        </span>
      </span>
      <span className="text-slate-800">|</span>
      <span className="flex items-center gap-2">
        <span className="text-white">BANK NIFTY</span>
        <span className="font-mono text-white">₹51,235.40</span>
        <span className={bankNiftyChange >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
          {bankNiftyChange >= 0 ? '▲' : '▼'} {Math.abs(bankNiftyChange).toFixed(2)}%
        </span>
      </span>
      {pulseSectors.map(s => (
        <React.Fragment key={s.sector}>
          <span className="text-slate-800">|</span>
          <span 
            onClick={() => onSectorDrillDown && onSectorDrillDown(s.sector.toUpperCase())}
            className="flex items-center gap-1.5 cursor-pointer hover:text-indigo-400 transition-colors group/marquee-item"
            title="Drill into Sector in Alpha Engine"
          >
            <span className="text-white group-hover/marquee-item:text-indigo-400 transition-colors">NIFTY {s.sector}</span>
            <span className={s.percentChange >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
              {s.percentChange >= 0 ? '▲' : '▼'} {Math.abs(s.percentChange).toFixed(2)}%
            </span>
            <span className="text-[8px] font-black text-indigo-500 opacity-0 group-hover/marquee-item:opacity-100 transition-all ml-0.5">⚡ DRILL</span>
          </span>
        </React.Fragment>
      ))}
      <span className="text-slate-800">|</span>
      <span className="flex items-center gap-2">
        <span className="text-white">INDIA VIX</span>
        <span className="font-mono text-white">{vixValue.toFixed(2)}</span>
        <span className={vixValue > 15 ? 'text-rose-500 font-bold animate-pulse' : 'text-emerald-400'}>
          {vixValue > 15 ? '▲ VOLATILE' : '▼ CALM'}
        </span>
      </span>
      <span className="text-slate-800">|</span>
      <span className="flex items-center gap-2">
        <span className="text-white">FII NET FLOW</span>
        <span className={`font-mono ${regime && regime.fiiNetFlow >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
          {regime?.fiiNetFlow ? `${regime.fiiNetFlow >= 0 ? '+' : ''}${regime.fiiNetFlow.toFixed(0)} Cr` : '+1,240 Cr'}
        </span>
      </span>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Market Pulse Strip */}
      <div className="w-full bg-slate-950/60 border border-slate-800/80 rounded-2xl p-2.5 overflow-hidden relative shadow-inner">
        <div className="flex items-center gap-8 animate-marquee whitespace-nowrap text-[10px] font-black uppercase tracking-widest text-slate-400">
          {marqueeContent}
          {/* Replicate for continuous scroll */}
          {marqueeContent}
        </div>
        {/* CC12 — wrap static CSS in the sanitizer. <style>{...}</style>
            is a React-rendered style block (not dangerouslySetInnerHTML),
            so the content is not user-controlled — but running the
            content through sanitizeStyleFragment enforces a single
            allow-list for future edits. */}
        <style>{sanitizeStyleFragment(`
          <style>
          @keyframes marquee {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-50%); }
          }
          .animate-marquee {
            display: flex;
            width: max-content;
            animation: marquee 25s linear infinite;
          }
          .animate-marquee:hover {
            animation-play-state: paused;
          }
          </style>
        `)}</style>
      </div>
      {/* Cockpit Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-slate-900/50 backdrop-blur-xl p-6 rounded-3xl border border-slate-800/80 gap-4 shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400 animate-pulse" />
            <h1 className="text-lg font-black text-white uppercase tracking-wider">Alpha Command Cockpit</h1>
          </div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
            Institutional Multi-Source Fused Diagnostics
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <button
            onClick={() => loadData(true)}
            className="flex items-center gap-1.5 p-2 md:px-3.5 md:py-2 bg-slate-950/60 hover:bg-slate-950/90 border border-slate-800 rounded-xl text-[9px] font-black text-slate-300 hover:text-white uppercase tracking-widest transition-all"
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            <span className="hidden min-[480px]:inline">Refresh Signals</span>
          </button>
          
          <button
            onClick={() => setIsAlertModalOpen(true)}
            className="flex items-center gap-1.5 p-2 md:px-3.5 md:py-2 bg-slate-950/60 hover:bg-slate-950/90 border border-slate-800 rounded-xl text-[9px] font-black text-slate-300 hover:text-white uppercase tracking-widest transition-all"
          >
            <Sliders className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden min-[480px]:inline">Alert Filters</span>
          </button>

          <button
            onClick={handleShareSetup}
            className="flex items-center gap-1.5 p-2 md:px-3.5 md:py-2 bg-slate-950/60 hover:bg-slate-950/90 border border-slate-800 rounded-xl text-[9px] font-black text-slate-300 hover:text-white uppercase tracking-widest transition-all"
          >
            <Share2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden min-[480px]:inline">Share Setup</span>
          </button>

          <button
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 p-2 md:px-4 md:py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-600/25"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden min-[480px]:inline">Export Brief</span>
          </button>
        </div>
      </div>

      {/* Grid Matrix (6 Panels) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* PANEL 1: Market Regime Detector */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden shadow-md flex flex-col justify-between min-h-[280px]">
          {/* Regime Pulsing 3D Glassmorphic Orb */}
          <div className="absolute top-6 right-6 flex items-center justify-center z-10 pointer-events-none select-none">
            <div className="relative flex items-center justify-center">
              {/* Outer pulsing shadow ring */}
              <motion.div 
                animate={{ scale: [1, 1.25, 1], opacity: [0.15, 0.4, 0.15] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                className={`absolute w-16 h-16 rounded-full blur-[6px] ${
                  regime?.label === 'TRENDING UP' ? 'bg-emerald-500/35' :
                  regime?.label === 'TRENDING DOWN' ? 'bg-rose-500/35' :
                  regime?.label === 'RANGE-BOUND' ? 'bg-sky-500/35' :
                  'bg-slate-500/35'
                }`}
              />
              {/* Main Orb Sphere */}
              <motion.div 
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className={`w-12 h-12 rounded-full relative shadow-[inset_0_4px_12px_rgba(255,255,255,0.25),0_8px_16px_rgba(0,0,0,0.4)] border border-white/10 ${
                  regime?.label === 'TRENDING UP' ? 'bg-gradient-to-tr from-emerald-600 via-emerald-500 to-green-300' :
                  regime?.label === 'TRENDING DOWN' ? 'bg-gradient-to-tr from-rose-600 via-rose-500 to-pink-300' :
                  regime?.label === 'RANGE-BOUND' ? 'bg-gradient-to-tr from-sky-600 via-sky-500 to-indigo-300' :
                  'bg-gradient-to-tr from-slate-600 via-slate-500 to-slate-300'
                }`}
              >
                {/* 3D highlights */}
                <div className="absolute inset-0.5 rounded-full bg-gradient-to-b from-white/20 to-transparent blur-[0.5px]" />
                <div className="absolute top-1 left-2.5 w-2 h-1 bg-white/45 rounded-full blur-[0.5px] rotate-[-15deg]" />
              </motion.div>
            </div>
          </div>

          {regime?.isMarketClosed && (
            <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px] flex items-center justify-center z-10 rotate-[-12deg] pointer-events-none select-none">
              <span className="text-[28px] font-black tracking-widest text-rose-500/25 border-4 border-rose-500/20 px-6 py-2 uppercase rounded-2xl">
                Market Closed
              </span>
            </div>
          )}
          
          <div>
            <div className="flex justify-between items-center mb-4">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Panel 01 // Regime Detector</span>
              <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                regime?.label === 'TRENDING UP' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                regime?.label === 'TRENDING DOWN' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                regime?.label === 'RANGE-BOUND' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' :
                'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>
                {regime?.label}
              </span>
            </div>
            
            <p className="text-xs text-slate-300 font-semibold leading-relaxed mb-4">
              {regime?.description}
            </p>
          </div>

          <div className="space-y-2 mt-auto">
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">Tactical Playbook</span>
            {regime?.recommendations.slice(0, 3).map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-[10px] text-slate-400 leading-normal">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1 shrink-0"></span>
                <p>{r}</p>
              </div>
            ))}
          </div>
        </div>

        {/* PANEL 2: Smart Money Compass */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden shadow-md flex flex-col items-center justify-between min-h-[280px]">
          <div className="flex justify-between w-full items-center">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Panel 02 // Compass</span>
            <span className={`text-[9px] font-black uppercase tracking-widest ${compass?.color}`}>
              {compass?.trend}
            </span>
          </div>

          {/* Gauge Widget */}
          <div className="relative w-40 h-24 flex items-end justify-center overflow-hidden mt-2">
            {/* SVG Arc background */}
            <svg className="absolute w-full h-full" viewBox="0 0 100 50">
              <path 
                d="M 10 50 A 40 40 0 0 1 90 50" 
                fill="none" 
                stroke="#1e293b" 
                strokeWidth="10" 
                strokeLinecap="round" 
              />
              <path 
                d="M 10 50 A 40 40 0 0 1 90 50" 
                fill="none" 
                stroke="url(#compass-grad)" 
                strokeWidth="10" 
                strokeLinecap="round"
                strokeDasharray="125.6"
                strokeDashoffset={125.6 - (125.6 * ((compass?.score || 0) + 100)) / 200}
              />
              <defs>
                <linearGradient id="compass-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f43f5e" />
                  <stop offset="50%" stopColor="#eab308" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>
            </svg>
            
            {/* Compass Needle */}
            <div 
              className="absolute w-1 h-16 bg-slate-100 origin-bottom rounded-full transition-transform duration-1000 ease-out"
              style={{ 
                transform: `rotate(${((compass?.score || 0) * 90) / 100}deg)`,
                bottom: '0px'
              }}
            >
              <div className="w-3 h-3 bg-indigo-500 rounded-full absolute -bottom-1 -left-1 ring-4 ring-slate-900"></div>
            </div>
          </div>

          <div className="text-center">
            <span className="text-[28px] font-black text-white font-mono leading-none">
              {compass?.score && compass.score > 0 ? '+' : ''}{compass?.score}
            </span>
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mt-1">
              Institutional Net Bias
            </span>
          </div>
        </div>

        {/* PANEL 3: NIFTY OI Support/Resistance */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden shadow-md flex flex-col justify-between min-h-[280px]">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Panel 03 // OI Strike Zones</span>

          <div className="space-y-4">
            <div className="bg-slate-950/40 p-3 rounded-2xl border border-slate-800/50 flex justify-between items-center">
              <div>
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">OI Ceiling (Resistance)</span>
                <span className="text-sm font-black text-rose-400 font-mono">{formatCurrency(resistanceStrike)}</span>
              </div>
              <div className="text-right">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">OI Floor (Support)</span>
                <span className="text-sm font-black text-emerald-400 font-mono">{formatCurrency(supportStrike)}</span>
              </div>
            </div>

            <div className="relative pt-1">
              <div className="flex mb-2 items-center justify-between">
                <div>
                  <span className="text-[9px] font-black uppercase text-indigo-400 tracking-wider">Breakout Probability</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-black text-indigo-400 font-mono">{breakoutProb}%</span>
                </div>
              </div>
              <div className="overflow-hidden h-1.5 text-xs flex rounded-full bg-slate-800 border border-slate-700/30">
                <div 
                  style={{ width: `${breakoutProb}%` }} 
                  className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-indigo-500 rounded-full transition-all duration-1000"
                ></div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-800/60 pt-3">
            <div className="flex justify-between items-center text-[10px] text-slate-400">
              <span>NIFTY Live Spot</span>
              <span className="font-mono font-bold text-white">{formatCurrencyPrecise(liveNiftyLtp || 0)}</span>
            </div>
            <button
              type="button"
              onClick={() => handleSendToBacktester('NIFTY')}
              className="w-full py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-xl text-[9px] font-black text-indigo-400 uppercase tracking-widest transition-all flex items-center justify-center gap-1"
            >
              <Zap size={10} className="fill-indigo-500/10" /> Send Nifty to Backtester
            </button>
          </div>
        </div>

        {/* PANEL 4: PCR & VIX Diagnostics */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden shadow-md flex flex-col justify-between min-h-[280px]">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Panel 04 // Volatility & Sentiment</span>

          <div className="grid grid-cols-2 gap-4 my-2">
            <div className="text-center p-3 bg-slate-950/20 rounded-2xl border border-slate-800/40">
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">Put-Call Ratio</span>
              <span className="text-xl font-black text-sky-400 font-mono">{(niftyChain?.pcr || regime?.pcr || 1.0).toFixed(2)}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest block mt-1">
                {(niftyChain?.pcr || regime?.pcr || 1.0) > 1.3 ? 'Fear (Oversold)' : (niftyChain?.pcr || regime?.pcr || 1.0) < 0.7 ? 'Greed (Overbought)' : 'Neutral'}
              </span>
            </div>

            <div className="text-center p-3 bg-slate-950/20 rounded-2xl border border-slate-800/40">
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">INDIA VIX</span>
              <span className="text-xl font-black text-amber-400 font-mono">{(regime?.vix || 15.0).toFixed(2)}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest block mt-1">
                {(regime?.vix || 15.0) > 18 ? 'High Risk' : (regime?.vix || 15.0) < 13 ? 'Calm Regime' : 'Moderate Risk'}
              </span>
            </div>
          </div>

          <div className="text-[9px] text-slate-500 leading-normal border-t border-slate-800/60 pt-3">
            PCR gauges option positioning support/resistance strength. VIX tracks 30-day forward volatility pricing.
          </div>
        </div>

        {/* PANEL 5: Greek Regime Tracker */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden shadow-md flex flex-col justify-between min-h-[280px]">
          <div>
            <div className="flex justify-between items-center mb-4">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Panel 05 // Greek Regime</span>
              <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                greekRegime?.vrpRegime === 'PREMIUM_SELLER_FAVORABLE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                greekRegime?.vrpRegime === 'LONG_GAMMA_FAVORABLE' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                'bg-slate-500/10 text-slate-400 border border-slate-500/20'
              }`}>
                {greekRegime?.vrpRegime?.replace(/_/g, ' ') || 'NEUTRAL'}
              </span>
            </div>

            <div className="space-y-4 my-auto">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400 font-semibold">Volatility Risk Premium (VRP)</span>
                <span className="text-sm font-black text-white font-mono">{greekRegime?.vrp !== undefined ? `${greekRegime.vrp > 0 ? '+' : ''}${greekRegime.vrp.toFixed(2)}%` : '--'}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400 font-semibold">IV Skew Rank</span>
                <span className="text-sm font-black text-indigo-400 font-mono">
                  {greekRegime?.ivSkewRank !== null && greekRegime?.ivSkewRank !== undefined ? `${greekRegime.ivSkewRank.toFixed(1)}/100` : '--'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400 font-semibold">Dealer GEX Regime</span>
                <span className={`text-xs font-black uppercase font-mono ${greekRegime?.gexRegime === 'TRENDING' ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {greekRegime?.gexRegime || '--'}
                </span>
              </div>
            </div>
          </div>

          <div className="text-[8px] text-slate-500 leading-normal border-t border-slate-800/60 pt-3">
            {"VRP > 8.0 favors premium selling. VRP < -2.0 favors long options/gamma. Skew Rank tracks protection pricing."}
          </div>
        </div>

        {/* PANEL 6: Institutional Flows */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden shadow-md flex flex-col justify-between min-h-[280px]">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Panel 06 // Institutional CM flows</span>

          <div className="space-y-4 my-auto">
            <div>
              <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                <span>FII Net Flow</span>
                <span className={`font-mono ${(regime?.fiiNetFlow ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {regime?.fiiNetFlow != null ? `${regime.fiiNetFlow >= 0 ? '+' : ''}${regime.fiiNetFlow.toFixed(1)} Cr` : '--'}
                </span>
              </div>
              
              {/* Bidirectional flow display */}
              <div className="h-2 bg-slate-950/50 rounded-full border border-slate-800/60 overflow-hidden relative">
                <div 
                  className={`h-full absolute rounded-full ${regime && regime.fiiNetFlow >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  style={{
                    width: `${Math.min(50, (Math.abs(regime?.fiiNetFlow || 0) / 3000) * 50)}%`,
                    left: regime && regime.fiiNetFlow >= 0 ? '50%' : 'auto',
                    right: regime && regime.fiiNetFlow < 0 ? '50%' : 'auto',
                  }}
                />
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-700"></div>
              </div>
            </div>

            <div className="text-[10px] text-slate-400 bg-slate-950/30 p-2.5 rounded-xl border border-slate-800/40">
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">FII Directional Bias</span>
              {regime && regime.fiiNetFlow > 1000 ? 'Aggressive accumulation detected.' : regime && regime.fiiNetFlow < -1000 ? 'Heavy institutional distribution stream active.' : 'Rotational flow matching standard session bounds.'}
            </div>
          </div>

          <div className="text-[8px] text-slate-500 leading-normal border-t border-slate-800/60 pt-3">
            Institutional net flows track cash market accumulation (CM) indices updated end-of-day.
          </div>
        </div>

        {/* PANEL 7: Top Conviction Stocks */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden shadow-md flex flex-col justify-between min-h-[280px] lg:col-span-1 md:col-span-2">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">Panel 07 // High Conviction Plays</span>

          <div className="space-y-2.5 my-auto overflow-y-auto max-h-[160px]">
            {convictions.slice(0, 5).map((c, i) => (
              <div key={c.symbol} className="flex justify-between items-center bg-slate-950/20 border border-slate-850 px-3 py-2 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold text-[9px]">#{i + 1}</span>
                  <span className="text-xs font-black text-white">{c.symbol}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-black text-slate-400 uppercase bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                    {c.oiQuadrant.split(' ')[0]}
                  </span>
                  <span className="text-xs font-black text-indigo-400 font-mono bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-lg">
                    {c.convictionScore}
                  </span>
                  <button
                    type="button"
                    title="Send to Backtester"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSendToBacktester(c.symbol);
                    }}
                    className="p-1 hover:bg-indigo-500/20 text-indigo-400 hover:text-white rounded transition-colors"
                  >
                    <Zap size={11} className="fill-indigo-500/20" />
                  </button>
                </div>
              </div>
            ))}
            {convictions.length === 0 && (
              <div className="text-center py-6 text-xs text-slate-500">
                No G-Factor data loaded to evaluate.
              </div>
            )}
          </div>

          <div className="text-[8px] text-slate-500 leading-normal border-t border-slate-800/60 pt-3 flex justify-between">
            <span>Primary Sort: Trade Conviction</span>
            <span>Weight: 30/25/20/15/10</span>
          </div>
        </div>

      </div>

      {/* Alert Feed Display Section (J.2.2) */}
      <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-indigo-400 animate-bounce" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Live Diagnostic Alert Feed</h3>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => {
                smartAlertEngine.markAllAsRead();
                setAlertFeed(smartAlertEngine.getAlerts());
              }}
              className="text-[9px] font-black uppercase text-indigo-400 tracking-wider hover:text-white transition-colors"
            >
              Mark Read
            </button>
            <span className="text-slate-700">|</span>
            <button
              onClick={() => {
                smartAlertEngine.clearAlerts();
                setAlertFeed([]);
              }}
              className="text-[9px] font-black uppercase text-rose-400 tracking-wider hover:text-white transition-colors"
            >
              Clear Log
            </button>
          </div>
        </div>

        <div className="space-y-2 max-h-[180px] overflow-y-auto">
          {alertFeed.slice(0, 10).map(alert => (
            <div 
              key={alert.id} 
              className={`flex justify-between items-center p-3 rounded-xl border ${
                alert.read ? 'bg-slate-950/10 border-slate-900 text-slate-500' :
                alert.severity === 'critical' ? 'bg-rose-500/10 border-rose-500/20 text-slate-300' :
                alert.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-slate-300' :
                'bg-indigo-500/10 border-indigo-500/20 text-slate-300'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className={`w-4 h-4 mt-0.5 shrink-0 ${
                  alert.severity === 'critical' ? 'text-rose-400' :
                  alert.severity === 'warning' ? 'text-amber-400' :
                  'text-indigo-400'
                }`} />
                <div>
                  <h4 className="text-xs font-black text-white leading-tight">{alert.title}</h4>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">{alert.message}</p>
                </div>
              </div>
              <span className="text-[9px] font-semibold text-slate-500 font-mono whitespace-nowrap ml-4">
                {new Date(alert.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {alertFeed.length === 0 && (
            <div className="text-center py-8 text-xs text-slate-500 border border-dashed border-slate-850 rounded-2xl">
              Diagnostics fully operational. 0 active alerts triggered.
            </div>
          )}
        </div>
      </div>

      {/* Alert Config Modal */}
      <AnimatePresence>
        {isAlertModalOpen && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-5"
            >
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Alert Config Filters</h3>
                <button onClick={() => setIsAlertModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block">VIX Volatility Alerts</label>
                    <span className="text-[9px] text-slate-500 block">Trigger alert if VIX crosses threshold</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={alertConfig.enableVix} 
                    onChange={e => setAlertConfig({ ...alertConfig, enableVix: e.target.checked })}
                    className="w-4 h-4 accent-indigo-500 rounded border-slate-700 bg-slate-800"
                  />
                </div>

                {alertConfig.enableVix && (
                  <div className="pl-4">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">VIX Threshold Limit</label>
                    <input 
                      type="number" 
                      step="0.5"
                      value={alertConfig.vixThreshold}
                      onChange={e => setAlertConfig({ ...alertConfig, vixThreshold: parseFloat(e.target.value) || 20 })}
                      className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white outline-none w-24 font-mono focus:border-indigo-500"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block">Put-Call Ratio (PCR) Alerts</label>
                    <span className="text-[9px] text-slate-500 block">Trigger alert if PCR exits standard bounds</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={alertConfig.enablePcr} 
                    onChange={e => setAlertConfig({ ...alertConfig, enablePcr: e.target.checked })}
                    className="w-4 h-4 accent-indigo-500 rounded border-slate-700 bg-slate-800"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block">FII Capital Flow Streaks</label>
                    <span className="text-[9px] text-slate-500 block">Alert when institutions sell for 3+ consecutive days</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={alertConfig.enableFii} 
                    onChange={e => setAlertConfig({ ...alertConfig, enableFii: e.target.checked })}
                    className="w-4 h-4 accent-indigo-500 rounded border-slate-700 bg-slate-800"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block">NIFTY Max Pain Gravity Alerts</label>
                    <span className="text-[9px] text-slate-500 block">Alert when spot enters max pain pinning zone</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={alertConfig.enablePain} 
                    onChange={e => setAlertConfig({ ...alertConfig, enablePain: e.target.checked })}
                    className="w-4 h-4 accent-indigo-500 rounded border-slate-700 bg-slate-800"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block">Conviction Surge Alerts</label>
                    <span className="text-[9px] text-slate-500 block">Alert on stock G-Factor or composite score surges</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={alertConfig.enableConviction} 
                    onChange={e => setAlertConfig({ ...alertConfig, enableConviction: e.target.checked })}
                    className="w-4 h-4 accent-indigo-500 rounded border-slate-700 bg-slate-800"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-800 pt-3 mt-4">
                <button 
                  onClick={() => setIsAlertModalOpen(false)}
                  className="px-4 py-2 border border-slate-800 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveAlertConfig}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/10"
                >
                  Save Config
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MarketCommandCenter;
