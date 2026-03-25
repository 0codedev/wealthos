import React, { useState, useEffect, useRef } from 'react';
import { StockData, alphaEngineService } from '../../services/AlphaEngineService';
import { Activity, Zap, AlertTriangle, CheckCircle2, ExternalLink, Brain, Send, Sparkles, MessageSquare, Target, ShieldCheck } from 'lucide-react';
import { openTradingView } from '../../utils/navigation';
import { formatCurrency, formatNumberIndian } from '../../utils/helpers';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '../../store/settingsStore';
import { streamChatWithGemini } from '../../services/aiService';
import ReactMarkdown from 'react-markdown';

import { LotSizeItem, ShadowScreenerService } from '../../services/alpha/ShadowScreenerService';
import FundamentalsPanel from './ShadowTerminal/FundamentalsPanel';
import { upstoxWebSocketService, UpstoxTick } from '../../services/UpstoxWebSocketService';
import { upstoxInstrumentService } from '../../services/UpstoxInstrumentService';
import { useGlobalTickStore } from '../../store/globalTickStore';
import { orderBookIntelligenceService } from '../../services/OrderBookIntelligenceService';
import {
    DynamicRisk, OrbValidation, ExhaustionAssessment, RiskVerdict,
    computeRiskProfile, riskEngine, updateTrailingStop, type TrailingStopState,
} from '../../services/alpha/RiskEngine';

interface OptionLauncherWidgetProps {
    stock: StockData | null;
    isVisible?: boolean;
    lotSizesData?: LotSizeItem[];
}

const OptionLauncherWidget: React.FC<OptionLauncherWidgetProps> = ({ stock, isVisible = true, lotSizesData = [] }) => {
    const [isExecuting, setIsExecuting] = useState(false);
    const [orderStatus, setOrderStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [orbResult, setOrbResult] = useState<{ isLowPreserved: boolean; isHighPreserved: boolean; detail?: string } | null>(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [bypassSafety, setBypassSafety] = useState(false);
    const [preciseAtrMetrics, setPreciseAtrMetrics] = useState<{
        atr: number;
        grr: number;
        ovr: number;
        isExhausted: boolean;
        isTrapRisk: boolean;
    } | null>(null);

    // Alpha 3.0 — Dynamic Risk Engine state.  Re-computed on every
    // stock change, every ATR refresh, and every L2 tick (via the
    // `useMemo` keyed on `latestTick?.ltp`).
    const [dynamicRisk, setDynamicRisk] = useState<DynamicRisk | null>(null);
    const [orbValidation, setOrbValidation] = useState<OrbValidation | null>(null);
    const [exhaustion, setExhaustion] = useState<ExhaustionAssessment | null>(null);
    const [trailState, setTrailState] = useState<TrailingStopState | null>(null);
    const [riskVerdict, setRiskVerdict] = useState<RiskVerdict>('CAUTION');

    const isEarlyZone = () => {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const day = now.getDay();
        const isWeekday = day >= 1 && day <= 5;
        if (!isWeekday) return false; // Allow weekends for testing/mocking
        const totalMinutes = hours * 60 + minutes;
        const startOfMarket = 9 * 60 + 15; // 9:15 AM
        const tenAM = 10 * 60; // 10:00 AM
        return totalMinutes >= startOfMarket && totalMinutes < tenAM;
    };

    // AI States
    const isUpstoxEnabled = useSettingsStore(state => state.isUpstoxEnabled);
    const showOrderBookDepth = useSettingsStore(state => state.showOrderBookDepth);
    const isDepthActive = isUpstoxEnabled && showOrderBookDepth;
    const [activeTab, setActiveTab] = useState<'launcher' | 'ai' | 'fundamentals' | 'orderbook'>('launcher');

    useEffect(() => {
        if (!isDepthActive && activeTab === 'orderbook') {
            setActiveTab('launcher');
        }
    }, [isDepthActive, activeTab]);
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [analyzedStockSymbol, setAnalyzedStockSymbol] = useState<string | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Resolve instrument key and subscribe to L2 depth when order book is visible
    const [instrumentKey, setInstrumentKey] = useState<string | null>(null);
    const ticks = useGlobalTickStore((s) => s.ticks);
    const latestTick = instrumentKey ? ticks[instrumentKey] : null;

    useEffect(() => {
        if (!stock || !isDepthActive || activeTab !== 'orderbook') {
            setInstrumentKey(null);
            return;
        }

        let isMounted = true;
        upstoxInstrumentService.getInstrumentKeys([stock.symbol], 'NSE_EQ').then((keysMap) => {
            if (isMounted) {
                const key = keysMap[stock.symbol];
                if (key) {
                    setInstrumentKey(key);
                }
            }
        });

        return () => {
            isMounted = false;
        };
    }, [stock?.symbol, activeTab, isUpstoxEnabled]);

    useEffect(() => {
        if (!instrumentKey || activeTab !== 'orderbook') return;

        const noop = () => {};
        upstoxWebSocketService.subscribe([instrumentKey], noop, 'full_d30');

        return () => {
            upstoxWebSocketService.unsubscribe([instrumentKey], noop);
        };
    }, [instrumentKey, activeTab]);

    // Per-tick risk recompute — uses the last LTP to update the
    // trailing stop.  Skipped when no dynamic risk exists yet (i.e.
    // before the ATR fetch has resolved).  Designed to be cheap: a
    // single TanH + a few multiplications.
    useEffect(() => {
        if (!dynamicRisk || !trailState || !latestTick || !stock) return;
        const ltp = latestTick.ltp;
        if (!ltp || ltp <= 0) return;
        const direction = stock.signal === 'Up' ? 'LONG' : 'SHORT';
        const updated = updateTrailingStop(trailState, ltp, direction, dynamicRisk.trailInitialPct);
        if (Math.abs(updated.trail - trailState.trail) > 0.01 || updated.tightened) {
            setTrailState(updated);
        }
    }, [latestTick?.ltp]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    useEffect(() => {
        if (stock) {
            setOrbResult(null);
            setPreciseAtrMetrics(null);
            setDynamicRisk(null);
            setOrbValidation(null);
            setExhaustion(null);
            setTrailState(null);
            setIsVerifying(true);

            Promise.all([
                alphaEngineService.verifyORBWithCandles(stock.symbol),
                alphaEngineService.fetchPreciseStockATR(stock.symbol)
            ]).then(([orbRes, atrVal]) => {
                setOrbResult(orbRes);
                if (atrVal) {
                    const gapAmt = Math.abs(stock.openPrice - stock.previousClose);
                    const dayRange = stock.high - stock.low;
                    const grr = gapAmt / atrVal;
                    const ovr = dayRange / atrVal;
                    const isBullish = stock.signal === 'Up';
                    setPreciseAtrMetrics({
                        atr: Number(atrVal.toFixed(2)),
                        grr: Number(grr.toFixed(2)),
                        ovr: Number(ovr.toFixed(2)),
                        isExhausted: grr > 0.70,
                        isTrapRisk: isBullish
                            ? (stock.openingGapPct > 0.15 && stock.openChangePct < -0.15)
                            : (stock.openingGapPct < -0.15 && stock.openChangePct > 0.15)
                    });

                    // Alpha 3.0 — Run the dynamic risk engine with
                    // the freshly-fetched 5-day ATR.
                    const profile = computeRiskProfile({
                        stock,
                        direction: isBullish ? 'LONG' : 'SHORT',
                        atrDaily: atrVal,
                        atrIntraday: Math.max(dayRange, atrVal * 0.6),
                        volumeVelocity: stock.value && stock.previousClose
                            ? Math.min(3, stock.value / (stock.previousClose * 100000))
                            : 1,
                    });
                    setDynamicRisk(profile.risk);
                    setOrbValidation(profile.orb);
                    setExhaustion(profile.exhaustion);
                    setRiskVerdict(profile.risk.verdict);
                    setTrailState({
                        trail: isBullish ? stock.lastPrice * (1 - profile.risk.trailInitialPct) : stock.lastPrice * (1 + profile.risk.trailInitialPct),
                        peak: stock.lastPrice,
                        trailPct: profile.risk.trailInitialPct,
                        tightened: false,
                    });
                }
                setIsVerifying(false);
            }).catch(() => {
                setIsVerifying(false);
            });

            // Reset AI chat history if a new stock is selected
            if (stock.symbol !== analyzedStockSymbol) {
                setAnalyzedStockSymbol(null);
                setChatMessages([]);
            }
        }
    }, [stock]);

    const compileMarketContext = (currentStock: StockData) => {
        const sectors = alphaEngineService.getCachedSectors();
        const sectorData = sectors.find(s => s.sector === currentStock.sector);
        const mood = alphaEngineService.getCachedMood();
        const isDown = currentStock.signal === 'Down';
        
        // Trap details (gapped in trade direction but faded)
        const isStockTrap = isDown 
            ? (currentStock.openingGapPct < -0.15 && currentStock.openChangePct > 0.15)
            : (currentStock.openingGapPct > 0.15 && currentStock.openChangePct < -0.15);
            
        // Springboard details (gapped opposite to trade direction but rebounded/reversed)
        const isStockSpringboard = isDown 
            ? (currentStock.openingGapPct > 0.15 && currentStock.openChangePct < -0.15)
            : (currentStock.openingGapPct < -0.15 && currentStock.openChangePct > 0.15);

        const getSectorGap = () => {
            if (!sectorData || !sectorData.openPrice || !sectorData.previousClose) return 0;
            return ((sectorData.openPrice - sectorData.previousClose) / sectorData.previousClose) * 100;
        };
        const sectorGap = getSectorGap();

        const isSectorTrap = sectorData && (isDown
            ? (sectorGap < -0.15 && (sectorData.openChangePct ?? 0) > 0.15)
            : (sectorGap > 0.15 && (sectorData.openChangePct ?? 0) < -0.15));
            
        const isSectorSpringboard = sectorData && (isDown
            ? (sectorGap > 0.15 && (sectorData.openChangePct ?? 0) < -0.15)
            : (sectorGap < -0.15 && (sectorData.openChangePct ?? 0) > 0.15));

        return `
=== TARGET STOCK ANALYSIS CONTEXT ===
Stock Symbol: ${currentStock.symbol}
Sector: ${currentStock.sector}
Last Traded Price: ₹${currentStock.lastPrice}
Intraday Close-to-Close (C2C) Change: ${currentStock.percentChange}%
Intraday Open-to-Current (O2C) Change: ${currentStock.openChangePct}%
Signal Direction: ${currentStock.signal === 'Up' ? 'BULLISH CONTINUATION (CE)' : 'BEARISH BREAKDOWN (PE)'}
G-Factor Score: ${currentStock.gFactor}
R-Factor Score: ${currentStock.rFactor || 1.0}
Option Apex Signal: ${currentStock.apexSignal || 'NEUTRAL'}
Opening Gap: ${currentStock.openingGapPct}%
Day Extreme Score (DES): ${currentStock.dayExtremeScore} (${isDown ? '1.0 = Low, 0.0 = High' : '1.0 = High, 0.0 = Low'})
5m ORB Status: ${currentStock.signal === 'Up' 
  ? (currentStock.isORBLowPreservedProxy ? 'Preserved (Safe)' : 'Breached (Trap Risk)')
  : (currentStock.isORBHighPreservedProxy ? 'Preserved (Safe)' : 'Breached (Trap Risk)')}
Setup Safety Category: ${isStockTrap ? (isDown ? 'FADING GAP DOWN (TRAP RISK / SHORT SQUEEZE)' : 'FADING GAP UP (TRAP RISK)') : isStockSpringboard ? (isDown ? 'REBOUND SPRINGBOARD (BEARISH CONTINUATION)' : 'REBOUND SPRINGBOARD (BULLISH CONTINUATION)') : 'NORMAL MOMENTUM'}

=== SECTOR SCOPE ===
Sector Name: ${currentStock.sector}
Sector C2C Change: ${sectorData ? sectorData.percentChange + '%' : 'N/A'}
Sector O2C Change: ${sectorData && sectorData.openChangePct !== undefined ? sectorData.openChangePct + '%' : 'N/A'}
Sector X-Factor Strength Ratio (vs Nifty 50): ${sectorData ? sectorData.strengthRatio : '1.0'}
Sector Fatigue Score: ${sectorData ? sectorData.fatigueScore : '0'}
Sector Fatigue State: ${sectorData ? sectorData.fatigueState.toUpperCase() : 'NEUTRAL'}
Sector Setup Safety Category: ${isSectorTrap ? (isDown ? 'FADING GAP DOWN (TRAP RISK)' : 'FADING GAP UP (TRAP RISK)') : isSectorSpringboard ? (isDown ? 'REBOUND SPRINGBOARD (BEARISH)' : 'REBOUND SPRINGBOARD (BULLISH)') : 'NORMAL'}

=== BROADER MARKET MOOD ===
Nifty 50 Mood: ${mood ? (mood.isBullish ? 'BULLISH' : 'BEARISH') : 'N/A'}
CE OI Velocity: ${mood ? mood.ceVelocity : 'N/A'}
PE OI Velocity: ${mood ? mood.peVelocity : 'N/A'}
`;
    };

    const SYSTEM_INSTRUCTION = `
You are the Wealth Terminal AI Copilot. You analyze intraday F&O option trades.
Your core persona is professional, objective, highly analytical, and strictly SEBI-compliant.

When performing stock analysis:
1. Address the target stock using the provided TARGET STOCK, SECTOR, and MARKET MOOD context.
2. Evaluate if the stock is a "Trap Risk" or a "High-Probability Trend Continuation":
   - **O2C vs C2C (Intraday Momentum):** Evaluate Open-to-Current (O2C) momentum as the true indicator of intraday institutional flow. If a stock or sector has a positive C2C but negative O2C, it is a Gap Trap. If it has a negative C2C but positive O2C, it is a Springboard Setup.
   - **Traps/Exhaustion:** If the Setup Safety Category indicates "FADING GAP UP (TRAP RISK)", if the Sector Fatigue State is EXHAUSTION, or if the 5m ORB status is "Breached", explicitly flag it as HIGH TRAP RISK and warn the user.
   - **Springboard Setup:** If the Setup Safety Category is "REBOUND SPRINGBOARD (BULLISH CONTINUATION)" or Sector Fatigue State is SPRINGBOARD, highlight that this is a beaten-down reversal opportunity, and specify the trigger point.
   - **DES (Day Extreme Score):** A high DES (>0.85) means the stock is trading near its intraday high/low extreme. A low DES (<0.85) suggests intraday exhaustion or lack of continuation strength.
3. Keep your advice focused on entry timing rules:
   - Advise waiting for a retest of the breakout level (e.g. the first 5m candle high/low).
   - Advise checking volume velocity before deploying capital.
4. Always structure your analysis with:
   - **🚨 RISK RATING:** Low / Moderate / High Trap Risk (based on metrics).
   - **📈 INTRADAY CONFLUENCE:** Analyze Sector & Market Mood alignment.
   - **⏱️ TIMING & CONFIRMATION TARGETS:** Specify exact level triggers (e.g. "Wait for HOD breakout at ₹X", "Ensure DES rises above 0.85").
   - **⚖️ SEBI DISCLAIMER:** Always end with: "Suggestions are based on momentum models. This is not financial advice."
`;

    const handleSend = async (messageText: string) => {
        if (!stock || !messageText.trim() || isStreaming) return;
        
        const userMsg = messageText.trim();
        setInputMessage('');
        
        // Add user message to history
        const newHistory = [...chatMessages, { role: 'user' as const, text: userMsg }];
        setChatMessages(newHistory);
        setIsStreaming(true);
        
        const marketContext = compileMarketContext(stock);
        const systemPrompt = `${SYSTEM_INSTRUCTION}\n\nCURRENT MARKET DATA CONTEXT:\n${marketContext}`;
        
        const apiHistory = chatMessages.map(m => ({
            role: m.role,
            parts: [{ text: m.text }]
        }));
        
        const modelId = useSettingsStore.getState().modelAlphaEngineId || 'gemini-3.1-flash-lite-preview';
        
        setChatMessages(prev => [...prev, { role: 'model', text: '' }]);
        
        let accumulatedText = '';
        
        try {
            await streamChatWithGemini(
                modelId,
                apiHistory,
                userMsg,
                systemPrompt,
                (token) => {
                    accumulatedText += token;
                    setChatMessages(prev => {
                        const updated = [...prev];
                        if (updated.length > 0) {
                            updated[updated.length - 1] = { role: 'model', text: accumulatedText };
                        }
                        return updated;
                    });
                },
                () => {
                    setIsStreaming(false);
                },
                (err) => {
                    console.error("AI Copilot Stream Error:", err);
                    setChatMessages(prev => {
                        const updated = [...prev];
                        if (updated.length > 0) {
                            updated[updated.length - 1] = { 
                                role: 'model', 
                                text: `⚠️ Error communicating with Gemini: ${err.message}. Please verify your API key in Settings.` 
                            };
                        }
                        return updated;
                    });
                    setIsStreaming(false);
                }
            );
        } catch (e: any) {
            console.error("AI Copilot Execution Error:", e);
            setIsStreaming(false);
        }
    };

    const handlePresetClick = (presetType: string) => {
        if (!stock || isStreaming) return;
        let promptText = '';
        if (presetType === 'Validate Setup Probability') {
            promptText = `Please perform a confluence analysis on ${stock.symbol}'s breakout/breakdown probability using its g-factor, opening gap, Day Extreme Score, and Nifty mood.`;
        } else if (presetType === 'Analyze Overbought/Trap Risk') {
            promptText = `Is there any trap risk here? Check if its sector is overbought/exhausted or if the 5m ORB level was breached.`;
        } else if (presetType === 'Suggest Strike Strategy') {
            promptText = `Based on the spot price of ₹${stock.lastPrice} and signal direction, what call or put option strike should I trade, and what is the target entry confirmation?`;
        }
        
        if (promptText) {
            handleSend(promptText);
        }
    };

    useEffect(() => {
        if (activeTab === 'ai' && stock) {
            if (stock.symbol !== analyzedStockSymbol) {
                setAnalyzedStockSymbol(stock.symbol);
                const systemMessage = `Hi! I am your AI Trading Copilot. I have analyzed the current market data for **${stock.symbol}**. Let me validate the setup confluence.`;
                setChatMessages([
                    { role: 'model', text: systemMessage },
                    { role: 'user', text: "Run setup confluence analysis" }
                ]);
                setIsStreaming(true);
                
                const marketContext = compileMarketContext(stock);
                const systemPrompt = `${SYSTEM_INSTRUCTION}\n\nCURRENT MARKET DATA CONTEXT:\n${marketContext}`;
                
                const apiHistory = [
                    { role: 'model', parts: [{ text: systemMessage }] }
                ];
                
                const modelId = useSettingsStore.getState().modelAlphaEngineId || 'gemini-3.1-flash-lite-preview';
                
                setChatMessages(prev => [...prev, { role: 'model', text: '' }]);
                
                let accumulatedText = '';
                
                streamChatWithGemini(
                    modelId,
                    apiHistory,
                    "Run setup confluence analysis",
                    systemPrompt,
                    (token) => {
                        accumulatedText += token;
                        setChatMessages(prev => {
                            const updated = [...prev];
                            if (updated.length > 0) {
                                updated[updated.length - 1] = { role: 'model', text: accumulatedText };
                            }
                            return updated;
                        });
                    },
                    () => {
                        setIsStreaming(false);
                    },
                    (err) => {
                        console.error("AI Copilot Stream Error:", err);
                        setChatMessages(prev => {
                            const updated = [...prev];
                            if (updated.length > 0) {
                                updated[updated.length - 1] = { 
                                    role: 'model', 
                                    text: `⚠️ Error communicating with Gemini: ${err.message}. Please verify your API key in Settings.` 
                                };
                            }
                            return updated;
                        });
                        setIsStreaming(false);
                    }
                ).catch(e => {
                    console.error("Auto analysis trigger error:", e);
                    setIsStreaming(false);
                });
            }
        }
    }, [activeTab, stock, analyzedStockSymbol]);

    if (!stock) {
        return null;
    }

    const isBullish = stock.signal === 'Up';
    const optionType = isBullish ? 'CE (Call)' : 'PE (Put)';
    const estimatedStrike = Math.round(stock.lastPrice / 10) * 10;
    let estCapital = "N/A";
    let currentLotSize = 0;
    
    if (stock) {
        const matchingLotSizeItem = lotSizesData.find(
            item => item.symbol.toUpperCase() === stock.symbol.toUpperCase()
        );
        if (matchingLotSizeItem) {
            currentLotSize = ShadowScreenerService.getActiveLotSize(matchingLotSizeItem.month_data);
            if (currentLotSize > 0) {
                const premium = stock.lastPrice * 0.02;
                const capital = Math.round(currentLotSize * premium);
                estCapital = `₹${formatCurrency(capital)}`;
            }
        }
    }

    const sectors = alphaEngineService.getCachedSectors() || [];
    const sectorData = sectors.find(s => s.sector === stock.sector);

    const isTimeValid = !isEarlyZone();
    const isOrbPreserved = isBullish 
        ? (orbResult ? orbResult.isLowPreserved : stock.isORBLowPreservedProxy) 
        : (orbResult ? orbResult.isHighPreserved : stock.isORBHighPreservedProxy);

    const isSpringboard = sectorData 
        ? (isBullish 
            ? (sectorData.fatigueState === 'springboard' || sectorData.fatigueScore <= -2)
            : (sectorData.fatigueState === 'exhaustion' || sectorData.fatigueScore >= 2))
        : false;

    // Resolve metrics from precise state if loaded, otherwise fallback to stock prop
    const currentAtr = preciseAtrMetrics ? preciseAtrMetrics.atr : (stock.atr || stock.previousClose * 0.030);
    const currentGrr = preciseAtrMetrics ? preciseAtrMetrics.grr : (stock.grr || 0);
    const currentOvr = preciseAtrMetrics ? preciseAtrMetrics.ovr : (stock.ovr || 0);

    const isExhausted = (preciseAtrMetrics ? preciseAtrMetrics.isExhausted : (stock.isExhausted || false)) || (sectorData 
        ? (isBullish
            ? (sectorData.fatigueState === 'exhaustion' || sectorData.fatigueScore >= 3)
            : (sectorData.fatigueState === 'springboard' || sectorData.fatigueScore <= -3))
        : false);

    const isTrapRisk = preciseAtrMetrics ? preciseAtrMetrics.isTrapRisk : (stock.isTrapRisk || false);

    const isO2CAligns = isBullish 
        ? stock.openChangePct >= 0 
        : stock.openChangePct <= 0;

    const isSafetyLocked = (!isOrbPreserved || !isTimeValid || isExhausted || isTrapRisk) && !bypassSafety;

    const handleExecute = () => {
        setIsExecuting(true);
        setOrderStatus('idle');
        
        setTimeout(() => {
            setIsExecuting(false);
            setOrderStatus('success');
            setTimeout(() => setOrderStatus('idle'), 3000);
        }, 1500);
    };

    const renderOrderBookTab = () => {
        if (!stock) return null;
        if (!isUpstoxEnabled) {
            return (
                <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-xs">
                    Upstox integration is not enabled in settings.
                </div>
            );
        }
        if (!latestTick || !latestTick.depth) {
            return (
                <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-xs space-y-2">
                    <Activity className="w-6 h-6 animate-pulse text-indigo-400" />
                    <span>Waiting for live order book data...</span>
                </div>
            );
        }

        const depth = latestTick.depth;
        const buyLevels = depth.buy || [];
        const sellLevels = depth.sell || [];

        const avgBidQty = buyLevels.reduce((s, l) => s + l.quantity, 0) / (buyLevels.length || 1);
        const avgAskQty = sellLevels.reduce((s, l) => s + l.quantity, 0) / (sellLevels.length || 1);

        const isBidWall = (qty: number) => qty > 2 * avgBidQty;
        const isAskWall = (qty: number) => qty > 2 * avgAskQty;

        const totalBid = buyLevels.reduce((s, l) => s + l.quantity, 0);
        const totalAsk = sellLevels.reduce((s, l) => s + l.quantity, 0);
        const imbalance = totalBid + totalAsk > 0 ? (totalBid - totalAsk) / (totalBid + totalAsk) : 0;
        const imbalancePct = Math.round(imbalance * 100);

        const avgVol = stock.volume;
        const relVol = 1.0; 
        const direction = isBullish ? 1 : -1;
        const priceAccel = stock.openPrice > 0 
          ? (direction * (stock.lastPrice - stock.openPrice) / stock.openPrice) * 100 
          : 0;
        const normPriceAccel = Math.max(0, Math.min(priceAccel / 0.5, 1.0));

        const signalInfo = orderBookIntelligenceService.processDepthTick(latestTick, relVol, normPriceAccel);

        return (
            <div className="flex flex-col h-full overflow-hidden text-xs text-slate-300 p-1 space-y-3">
                <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-2 rounded-xl border border-slate-850">
                    <div className="text-center">
                        <span className="text-[9px] text-slate-500 uppercase font-black block">L2 Imbalance</span>
                        <span className={`text-xs font-black font-mono ${imbalance >= 0 ? 'text-emerald-400' : 'text-rose-455'}`}>
                            {imbalancePct >= 0 ? `+${imbalancePct}%` : `${imbalancePct}%`}
                        </span>
                    </div>
                    <div className="text-center">
                        <span className="text-[9px] text-slate-500 uppercase font-black block">Cont. Score</span>
                        <span className={`text-xs font-black font-mono ${signalInfo.momentumContinuationScore >= 70 ? 'text-emerald-400' : signalInfo.momentumContinuationScore >= 40 ? 'text-amber-405' : 'text-rose-455'}`}>
                            {signalInfo.momentumContinuationScore}/100
                        </span>
                    </div>
                    <div className="text-center">
                        <span className="text-[9px] text-slate-500 uppercase font-black block">Absorption</span>
                        <span className="text-xs font-black font-mono text-indigo-400">
                            {signalInfo.absorptionRate}%/m
                        </span>
                    </div>
                </div>

                <div className="text-[9px] bg-slate-950/45 p-2 rounded-lg border border-slate-850 italic text-slate-400">
                    {signalInfo.reason}
                </div>

                <div className="grid grid-cols-2 gap-3 flex-1 overflow-y-auto min-h-0">
                    <div className="flex flex-col min-h-0">
                        <h4 className="text-[9px] text-emerald-400 font-black uppercase tracking-wider mb-1 border-b border-emerald-950/45 pb-0.5 flex justify-between">
                            <span>Bids</span>
                            <span className="text-[8px] text-slate-500 font-medium lowercase">qty: {formatNumberIndian(totalBid)}</span>
                        </h4>
                        <div className="overflow-y-auto flex-1 pr-0.5">
                            <table className="w-full text-left font-mono text-[10px]">
                                <tbody>
                                    {buyLevels.map((lvl, idx) => {
                                        const wall = isBidWall(lvl.quantity);
                                        return (
                                            <tr key={`bid-${idx}`} className={`border-b border-slate-850/40 ${wall ? 'bg-emerald-500/10 text-emerald-300 font-black' : ''}`}>
                                                <td className="py-1">₹{lvl.price.toFixed(2)}</td>
                                                <td className="py-1 text-right">
                                                    <span>{formatNumberIndian(lvl.quantity)}</span>
                                                    {wall && <span className="ml-1" title="Buy Wall">🧱</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="flex flex-col min-h-0">
                        <h4 className="text-[9px] text-rose-455 font-black uppercase tracking-wider mb-1 border-b border-rose-950/45 pb-0.5 flex justify-between">
                            <span>Asks</span>
                            <span className="text-[8px] text-slate-500 font-medium lowercase">qty: {formatNumberIndian(totalAsk)}</span>
                        </h4>
                        <div className="overflow-y-auto flex-1 pr-0.5">
                            <table className="w-full text-left font-mono text-[10px]">
                                <tbody>
                                    {sellLevels.map((lvl, idx) => {
                                        const wall = isAskWall(lvl.quantity);
                                        return (
                                            <tr key={`ask-${idx}`} className={`border-b border-slate-850/40 ${wall ? 'bg-rose-500/10 text-rose-350 font-black' : ''}`}>
                                                <td className="py-1">₹{lvl.price.toFixed(2)}</td>
                                                <td className="py-1 text-right">
                                                    <span>{formatNumberIndian(lvl.quantity)}</span>
                                                    {wall && <span className="ml-1" title="Sell Wall">🧱</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-[2rem] p-6 border border-slate-800/50 relative shadow-2xl h-[480px] flex flex-col overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <Activity className="w-32 h-32" />
            </div>

            <div className="shrink-0">
                <h2 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                    Alpha Launcher <Zap className="w-5 h-5 text-yellow-400 animate-pulse" />
                </h2>
                <p className="text-slate-400 text-xs">Momentum Option Trade Execution</p>
            </div>

            {/* Tab Selector */}
            <div className="flex border-b border-slate-800/60 mt-4 text-[10px] font-black uppercase tracking-wider shrink-0">
                <button 
                    className={`flex-1 pb-2 border-b-2 transition-all text-center ${activeTab === 'launcher' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                    onClick={() => setActiveTab('launcher')}
                >
                    Dhan Launcher
                </button>
                <button 
                    className={`flex-1 pb-2 border-b-2 transition-all text-center flex items-center justify-center gap-1 ${activeTab === 'fundamentals' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                    onClick={() => setActiveTab('fundamentals')}
                >
                    Fundamentals
                </button>
                <button 
                    className={`flex-1 pb-2 border-b-2 transition-all text-center flex items-center justify-center gap-1 ${activeTab === 'ai' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                    onClick={() => setActiveTab('ai')}
                >
                    AI Copilot <Brain className="w-3.5 h-3.5 text-indigo-400" />
                </button>
                {isDepthActive && (
                    <button 
                        className={`flex-1 pb-2 border-b-2 transition-all text-center flex items-center justify-center gap-1 ${activeTab === 'orderbook' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                        onClick={() => setActiveTab('orderbook')}
                    >
                        Order Book
                    </button>
                )}
            </div>

            <div className="mt-4 flex-1 flex flex-col overflow-hidden">
                <AnimatePresence mode="wait">
                    {activeTab === 'launcher' ? (
                        <motion.div
                            key="launcher"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="flex-grow flex flex-col justify-between overflow-hidden"
                        >
                            <div>
                                <div className="flex items-end justify-between mb-4">
                                    <div>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Target Asset</p>
                                        <h3 
                                            className={`text-2xl font-black ${isBullish ? 'text-emerald-400' : 'text-rose-400'} cursor-pointer hover:underline flex items-center gap-1.5`}
                                            onClick={() => openTradingView(stock.symbol)}
                                        >
                                            {stock.symbol}
                                            <ExternalLink className="w-4 h-4 opacity-40 hover:opacity-100 transition-opacity" />
                                        </h3>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Signal</p>
                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider border ${
                                            isBullish ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-sm' : 
                                            'bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-sm'
                                        }`}>
                                            {isBullish ? 'BULLISH CONTINUATION' : 'BEARISH BREAKDOWN'}
                                        </span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
                                        <p className="text-slate-500 text-[10px] uppercase font-black tracking-wider mb-0.5">Recommended Strike</p>
                                        <p className="text-sm font-black text-white">{estimatedStrike} {optionType}</p>
                                    </div>
                                    <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30 flex justify-between items-center">
                                        <div>
                                            <p className="text-slate-500 text-[10px] uppercase font-black tracking-wider mb-0.5">Est. Capital Required</p>
                                            <p className="text-sm font-black text-white font-mono">{estCapital}</p>
                                        </div>
                                        {currentLotSize > 0 && (
                                            <div className="text-right">
                                                <p className="text-slate-500 text-[9px] uppercase font-black tracking-wider mb-0.5">Lot Size</p>
                                                <p className="text-xs font-black text-cyan-400 font-mono">{currentLotSize}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Pre-Explosion Trade Validator Panel */}
                                <div className={`p-3.5 rounded-xl border flex flex-col gap-2 transition-all ${
                                    isVerifying ? 'bg-slate-800/40 border-slate-700/50 animate-pulse' :
                                    isSafetyLocked
                                        ? 'bg-rose-500/5 border-rose-500/20'
                                        : bypassSafety
                                            ? 'bg-amber-500/5 border-amber-500/25'
                                            : 'bg-emerald-500/5 border-emerald-500/20'
                                }`}>
                                    <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5 shrink-0">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                            <Zap className="w-3.5 h-3.5 text-yellow-400" /> Pre-Explosion Validator
                                        </span>
                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                            isSafetyLocked 
                                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' 
                                                : bypassSafety 
                                                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                        }`}>
                                            {isSafetyLocked ? 'LOCKED' : bypassSafety ? 'BYPASSED' : 'CLEAR'}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] font-bold">
                                        {/* Rule 1: ORB Low/High Preserved */}
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-500 uppercase tracking-wide">5m ORB Limit</span>
                                            <span className={`flex items-center gap-1 ${isOrbPreserved ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {isOrbPreserved ? 'Preserved' : 'Breached'}
                                            </span>
                                        </div>

                                        {/* Rule 3: Time window check */}
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-500 uppercase tracking-wide">Time Zone</span>
                                            <span className={`flex items-center gap-1 ${isTimeValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {isTimeValid ? 'Post-10:00' : 'Pre-10:00'}
                                            </span>
                                        </div>

                                        {/* Rule 4: Opposite Pressure reversal */}
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-500 uppercase tracking-wide">Sector Trend</span>
                                            <span className={`flex items-center gap-1 ${
                                                isSpringboard ? 'text-emerald-400' : isExhausted ? 'text-amber-400' : 'text-slate-400'
                                            }`}>
                                                {isSpringboard ? 'Springboard' : isExhausted ? 'Exhaustion' : 'Neutral'}
                                            </span>
                                        </div>

                                        {/* Rule 2/General: Intraday O2C Momentum */}
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-500 uppercase tracking-wide">O2C Trend</span>
                                            <span className={`flex items-center gap-1 ${isO2CAligns ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {isO2CAligns ? 'Aligned' : 'Opposing'}
                                            </span>
                                        </div>

                                        {/* Exhaustion (GRR) check */}
                                        <div className="flex items-center justify-between col-span-2 border-t border-slate-800/40 pt-1.5 mt-0.5">
                                            <span className="text-slate-500 uppercase tracking-wide">Gap Range (GRR)</span>
                                            <span className={`flex items-center gap-1 ${isExhausted ? 'text-amber-400 font-black' : 'text-emerald-400'}`}>
                                                {isExhausted ? `Exhausted (${currentGrr})` : `Clear (${currentGrr})`}
                                            </span>
                                        </div>

                                        {/* Trap Risk (OVR) check */}
                                        <div className="flex items-center justify-between col-span-2">
                                            <span className="text-slate-500 uppercase tracking-wide">Trap Risk (OVR)</span>
                                            <span className={`flex items-center gap-1 ${isTrapRisk ? 'text-rose-400 font-black' : 'text-emerald-400'}`}>
                                                {isTrapRisk ? `Trap Risk (${currentOvr})` : `Clear (${currentOvr})`}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Alpha 3.0 — Dynamic Risk Engine panel */}
                                    {dynamicRisk && (
                                        <div className="mt-2 border-t border-slate-800/40 pt-2">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                                    <Target className="w-3.5 h-3.5 text-cyan-400" /> Risk Engine v3
                                                </span>
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                                    dynamicRisk.verdict === 'GO'
                                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                        : dynamicRisk.verdict === 'CAUTION'
                                                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                                }`}>
                                                    {dynamicRisk.verdict}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
                                                <div className="bg-slate-950/50 rounded-md p-1.5 border border-slate-800/40">
                                                    <span className="text-[8px] text-slate-500 uppercase block">Entry</span>
                                                    <span className="text-slate-100 font-black">₹{dynamicRisk.entry.toFixed(2)}</span>
                                                </div>
                                                <div className="bg-rose-500/10 rounded-md p-1.5 border border-rose-500/20">
                                                    <span className="text-[8px] text-rose-300 uppercase block">Stop-Loss</span>
                                                    <span className="text-rose-300 font-black">₹{dynamicRisk.stopLoss.toFixed(2)}</span>
                                                </div>
                                                <div className="bg-emerald-500/10 rounded-md p-1.5 border border-emerald-500/20">
                                                    <span className="text-[8px] text-emerald-300 uppercase block">Target-1</span>
                                                    <span className="text-emerald-300 font-black">₹{dynamicRisk.target1.toFixed(2)}</span>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-3 gap-1.5 mt-1 text-[10px] font-mono">
                                                <div className="bg-slate-950/50 rounded-md p-1.5 border border-slate-800/40">
                                                    <span className="text-[8px] text-slate-500 uppercase block">R:R</span>
                                                    <span className={`font-black ${dynamicRisk.rrTooPoor ? 'text-rose-400' : 'text-cyan-400'}`}>
                                                        {dynamicRisk.riskRewardRatio.toFixed(2)}
                                                    </span>
                                                </div>
                                                <div className="bg-slate-950/50 rounded-md p-1.5 border border-slate-800/40">
                                                    <span className="text-[8px] text-slate-500 uppercase block">Trail</span>
                                                    <span className="text-indigo-300 font-black">{(dynamicRisk.trailInitialPct * 100).toFixed(2)}%</span>
                                                </div>
                                                <div className="bg-slate-950/50 rounded-md p-1.5 border border-slate-800/40">
                                                    <span className="text-[8px] text-slate-500 uppercase block">ATR</span>
                                                    <span className="text-slate-200 font-black">₹{dynamicRisk.atrIntraday.toFixed(2)}</span>
                                                </div>
                                            </div>
                                            {orbValidation && (
                                                <p className="text-[8.5px] text-slate-400 mt-1.5 italic leading-tight">
                                                    <ShieldCheck className="w-2.5 h-2.5 inline mr-1 text-cyan-400" />
                                                    ORB band {(orbValidation.preservationPct).toFixed(2)}% — {orbValidation.reason}
                                                </p>
                                            )}
                                            {exhaustion && (
                                                <p className={`text-[8.5px] mt-1 italic leading-tight ${
                                                    exhaustion.block ? 'text-rose-400' : 'text-slate-500'
                                                }`}>
                                                    <AlertTriangle className="w-2.5 h-2.5 inline mr-1" />
                                                    Exhaustion: {exhaustion.severity} (GRR={exhaustion.grr.toFixed(2)}, OVR={exhaustion.ovr.toFixed(2)})
                                                </p>
                                            )}
                                            {trailState && (
                                                <p className="text-[8.5px] text-slate-500 mt-1 italic leading-tight">
                                                    <Activity className="w-2.5 h-2.5 inline mr-1 text-indigo-400" />
                                                    Trail ₹{trailState.trail.toFixed(2)} ({(trailState.trailPct * 100).toFixed(2)}%) • Peak ₹{trailState.peak.toFixed(2)}
                                                    {trailState.tightened && <span className="text-amber-400 ml-1">↑ tightened</span>}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-3 border-t border-slate-800/50 mt-auto">
                                {/* Safety Bypass Toggle */}
                                <div className="flex items-center justify-between mb-3 px-1">
                                    <span className="text-[9px] text-slate-500 font-black uppercase tracking-wider">Safety Lock System</span>
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                        <input 
                                            type="checkbox" 
                                            checked={bypassSafety} 
                                            onChange={(e) => setBypassSafety(e.target.checked)}
                                            className="rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-0 focus:ring-offset-0 w-3 h-3 cursor-pointer"
                                        />
                                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider hover:text-white transition-colors">Bypass Safety Gate</span>
                                    </label>
                                </div>

                                <AnimatePresence mode="wait">
                                    {orderStatus === 'success' ? (
                                        <motion.div 
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            className="w-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 text-xs"
                                        >
                                            <CheckCircle2 className="w-4 h-4" /> Order Placed via Dhan
                                        </motion.div>
                                    ) : (
                                        <motion.button
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            onClick={handleExecute}
                                            disabled={isExecuting || isSafetyLocked}
                                            className={`w-full font-bold py-3.5 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider ${
                                                isSafetyLocked
                                                    ? 'bg-slate-800 text-slate-500 border border-slate-800/80 cursor-not-allowed shadow-none'
                                                    : isBullish 
                                                        ? 'bg-gradient-to-r from-emerald-600 to-emerald-400 hover:from-emerald-500 hover:to-emerald-300 text-white shadow-emerald-500/20' 
                                                        : 'bg-gradient-to-r from-rose-600 to-rose-400 hover:from-rose-500 hover:to-rose-300 text-white shadow-rose-500/20'
                                            } ${isExecuting ? 'opacity-70 cursor-not-allowed' : (!isSafetyLocked ? 'hover:-translate-y-0.5 hover:shadow-xl' : '')}`}
                                        >
                                            {isExecuting ? (
                                                <span className="flex items-center gap-2">
                                                    <Activity className="w-4 h-4 animate-spin" /> Routing to Dhan...
                                                </span>
                                            ) : isSafetyLocked ? (
                                                <span className="flex items-center gap-2 text-slate-500">
                                                    <AlertTriangle className="w-4 h-4 text-slate-500 animate-pulse" /> Safety Gate Locked
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-2">
                                                    <Zap className="w-4 h-4" /> Execute Momentum {isBullish ? 'Buy' : 'Short'}
                                                </span>
                                            )}
                                        </motion.button>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    ) : activeTab === 'fundamentals' ? (
                        <motion.div
                            key="fundamentals"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="flex-grow flex flex-col overflow-hidden h-full"
                        >
                            <FundamentalsPanel symbol={stock.symbol} gFactor={stock.gFactor} />
                        </motion.div>
                    ) : activeTab === 'orderbook' ? (
                        <motion.div
                            key="orderbook"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="flex-grow flex flex-col overflow-hidden h-full"
                        >
                            {renderOrderBookTab()}
                        </motion.div>
                    ) : (
                        <motion.div
                            key="ai"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="flex-1 flex flex-col overflow-hidden h-full"
                        >
                            {/* Chat history area */}
                            <div className="flex-1 overflow-y-auto mb-2.5 space-y-3 pr-1 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                                {chatMessages.map((msg, idx) => (
                                    <div 
                                        key={idx} 
                                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div className={`max-w-[90%] rounded-2xl px-3.5 py-2 text-xs shadow-md border ${
                                            msg.role === 'user' 
                                                ? 'bg-indigo-600/20 border-indigo-500/20 text-slate-100 rounded-tr-none' 
                                                : 'bg-slate-800/35 border-slate-700/30 text-slate-200 rounded-tl-none'
                                        }`}>
                                            {msg.role === 'user' ? (
                                                <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                                            ) : msg.text === '' && isStreaming && idx === chatMessages.length - 1 ? (
                                                <div className="flex items-center gap-1.5 py-1">
                                                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                                </div>
                                            ) : (
                                                <ReactMarkdown
                                                    components={{
                                                        p: ({ node, ...props }) => <p className="mb-1.5 last:mb-0 leading-relaxed" {...props} />,
                                                        strong: ({ node, ...props }) => <strong className="text-indigo-400 font-bold" {...props} />,
                                                        ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5" {...props} />,
                                                        ol: ({ node, ...props }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5" {...props} />,
                                                        li: ({ node, ...props }) => <li className="text-[11px] text-slate-300" {...props} />,
                                                        h1: ({ node, ...props }) => <h1 className="text-xs font-black uppercase text-indigo-300 mt-2.5 mb-1" {...props} />,
                                                        h2: ({ node, ...props }) => <h2 className="text-[11px] font-black uppercase text-indigo-300 mt-2 mb-0.5" {...props} />,
                                                        h3: ({ node, ...props }) => <h3 className="text-[10px] font-black uppercase text-indigo-300 mt-1.5 mb-0.5" {...props} />,
                                                    }}
                                                >
                                                    {msg.text}
                                                </ReactMarkdown>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                <div ref={chatEndRef} />
                            </div>

                            {/* Preset prompt buttons */}
                            <div className="flex flex-wrap gap-1 mb-2 shrink-0">
                                <button 
                                    onClick={() => handlePresetClick('Validate Setup Probability')}
                                    disabled={isStreaming}
                                    className="px-2 py-1 bg-slate-800/40 hover:bg-slate-800 text-[9px] font-black uppercase text-slate-400 hover:text-white border border-slate-700/30 rounded-lg transition-colors disabled:opacity-40"
                                >
                                    🎯 Confluence
                                </button>
                                <button 
                                    onClick={() => handlePresetClick('Analyze Overbought/Trap Risk')}
                                    disabled={isStreaming}
                                    className="px-2 py-1 bg-slate-800/40 hover:bg-slate-800 text-[9px] font-black uppercase text-slate-400 hover:text-white border border-slate-700/30 rounded-lg transition-colors disabled:opacity-40"
                                >
                                    ⚠️ Trap Risk
                                </button>
                                <button 
                                    onClick={() => handlePresetClick('Suggest Strike Strategy')}
                                    disabled={isStreaming}
                                    className="px-2 py-1 bg-slate-800/40 hover:bg-slate-800 text-[9px] font-black uppercase text-slate-400 hover:text-white border border-slate-700/30 rounded-lg transition-colors disabled:opacity-40"
                                >
                                    💡 Strike Choice
                                </button>
                            </div>

                            {/* TextInput chat form */}
                            <form 
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleSend(inputMessage);
                                }}
                                className="flex gap-2 bg-slate-950/80 rounded-xl p-1 border border-slate-800/80 shrink-0"
                            >
                                <input 
                                    type="text"
                                    placeholder={isStreaming ? "AI Copilot is thinking..." : "Ask follow-up question..."}
                                    value={inputMessage}
                                    onChange={(e) => setInputMessage(e.target.value)}
                                    disabled={isStreaming}
                                    className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 outline-none pl-3 py-2 disabled:opacity-50"
                                />
                                <button 
                                    type="submit"
                                    disabled={!inputMessage.trim() || isStreaming}
                                    className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-40"
                                >
                                    <Send className="w-3.5 h-3.5" />
                                </button>
                            </form>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default OptionLauncherWidget;
