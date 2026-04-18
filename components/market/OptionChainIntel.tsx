import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Zap, Activity, BarChart3, Info, RefreshCw, Layers,
    TrendingUp, TrendingDown, Search, ShieldAlert, Clock, ArrowRight
} from 'lucide-react';
import {
    BarChart, Bar, LineChart, Line,
    XAxis, YAxis, Tooltip, Legend, CartesianGrid, AreaChart,
    Area, ReferenceLine, ComposedChart
} from 'recharts';
import { optionChainService, OptionChainSnapshot, UnusualFlowAlert } from '../../services/OptionChainService';
import { quantGreeksService } from '../../services/QuantGreeksService';
import { OptionFlowHeatmap } from './OptionFlowHeatmap';
import IVSkewChart from './IVSkewChart';
import DeltaHedgePanel from './DeltaHedgePanel';
import DataFreshnessTag from '../shared/DataFreshnessTag';
import { OIStoryGenerator } from '../../services/alpha/OIStoryGenerator';
import { useGlobalTickStore } from '../../store/globalTickStore';
import { useMarketContext } from '../../hooks/useMarketContext';
import { useVirtualList } from '../../hooks/useVirtualList';
import { useOptionChainStream } from '../../hooks/useOptionChainStream';
import { useRefreshProgressStore } from '../../store/refreshProgressStore';
import { useSettingsStore } from '../../store/settingsStore';

const SYMBOL_TO_UNDERLYING_KEY: Record<string, string> = {
    NIFTY: 'NSE_INDEX|Nifty 50',
    BANKNIFTY: 'NSE_INDEX|Nifty Bank',
    FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
    MIDCPNIFTY: 'NSE_INDEX|Nifty Midcap 50',
    SENSEX: 'BSE_INDEX|SENSEX'
};

// Hardcoded default index lot sizes for Gamma Exposure (GEX) calculation
const LOT_SIZES: Record<string, number> = {
    NIFTY: 75,
    BANKNIFTY: 15,
    FINNIFTY: 40,
    MIDCPNIFTY: 75,
    SENSEX: 10
};

// Local Mock Data Generator in case live API is not fully configured (ensures visual preview)
const generateMockOptionChain = (symbol: string, expiry: string, spotPriceInput?: number): OptionChainSnapshot => {
    const spot = spotPriceInput || (
        symbol === 'NIFTY' ? 22450 :
            symbol === 'BANKNIFTY' ? 47800 :
                symbol === 'FINNIFTY' ? 21200 :
                    symbol === 'MIDCPNIFTY' ? 10400 :
                        symbol === 'SENSEX' ? 73800 : 500
    );
    const interval = (
        symbol === 'NIFTY' ? 50 :
            symbol === 'BANKNIFTY' ? 100 :
                symbol === 'FINNIFTY' ? 100 :
                    symbol === 'MIDCPNIFTY' ? 50 :
                        symbol === 'SENSEX' ? 100 : 50
    );

    const atm = Math.round(spot / interval) * interval;
    const strikes = [];

    // Generate 15 strikes around ATM
    for (let i = -7; i <= 7; i++) {
        const strikePrice = atm + (i * interval);
        const distance = Math.abs(strikePrice - spot) / spot;
        const isCallITM = strikePrice < spot;
        const isPutITM = strikePrice > spot;

        // Call pricing / Greeks simulation
        const ceLtp = Math.max(0.5, (spot - strikePrice) * (isCallITM ? 1 : 0) + Math.exp(-Math.pow((strikePrice - spot) / (spot * 0.05), 2)) * (spot * 0.02));
        const ceOi = Math.round((Math.exp(-Math.pow((strikePrice - (atm + interval)) / (spot * 0.03), 2)) * 1500000) / 100) * 100;
        const ceChangeOi = Math.round((ceOi * (Math.sin(strikePrice / 100) * 0.2 + 0.1)) / 100) * 100;
        const ceIv = Math.round((12 + Math.pow(strikePrice - spot, 2) / (spot * spot) * 150) * 10) / 10;
        const ceVolume = ceOi * 3;
        const ceDelta = isCallITM ? 0.5 + 0.5 * (1 - Math.exp(-distance * 20)) : 0.5 * Math.exp(-distance * 20);
        const ceTheta = -ceLtp * 0.1;
        const ceGamma = (1 / (spot * ceIv * 0.01 * Math.sqrt(3 / 365))) * Math.exp(-Math.pow(distance / (ceIv * 0.01), 2));

        // Put pricing / Greeks simulation
        const peLtp = Math.max(0.5, (strikePrice - spot) * (isPutITM ? 1 : 0) + Math.exp(-Math.pow((strikePrice - spot) / (spot * 0.05), 2)) * (spot * 0.02));
        const peOi = Math.round((Math.exp(-Math.pow((strikePrice - (atm - interval)) / (spot * 0.03), 2)) * 1800000) / 100) * 100;
        const peChangeOi = Math.round((peOi * (Math.cos(strikePrice / 100) * 0.2 + 0.08)) / 100) * 100;
        const peIv = Math.round((13 + Math.pow(strikePrice - spot, 2) / (spot * spot) * 160) * 10) / 10;
        const peVolume = peOi * 3.5;
        const peDelta = isPutITM ? -0.5 - 0.5 * (1 - Math.exp(-distance * 20)) : -0.5 * Math.exp(-distance * 20);
        const peTheta = -peLtp * 0.11;
        const peGamma = ceGamma;

        strikes.push({
            strikePrice,
            CE: {
                strike: strikePrice,
                oi: ceOi,
                changeInOi: ceChangeOi,
                volume: ceVolume,
                iv: ceIv,
                ltp: Math.round(ceLtp * 100) / 100,
                netChange: Math.round((ceLtp * 0.05 * Math.sin(strikePrice)) * 100) / 100,
                oiVelocity: Math.round((ceChangeOi / Math.max(1, ceOi - ceChangeOi)) * 1000) / 10,
                delta: Math.round(ceDelta * 100) / 100,
                theta: Math.round(ceTheta * 100) / 100,
                gamma: Math.round(ceGamma * 100000) / 100000,
                vega: 0.15,
                pop: Math.round((1 - Math.abs(ceDelta)) * 100)
            },
            PE: {
                strike: strikePrice,
                oi: peOi,
                changeInOi: peChangeOi,
                volume: peVolume,
                iv: peIv,
                ltp: Math.round(peLtp * 100) / 100,
                netChange: Math.round((peLtp * 0.05 * Math.cos(strikePrice)) * 100) / 100,
                oiVelocity: Math.round((peChangeOi / Math.max(1, peOi - peChangeOi)) * 1000) / 10,
                delta: Math.round(peDelta * 100) / 100,
                theta: Math.round(peTheta * 100) / 100,
                gamma: Math.round(peGamma * 100000) / 100000,
                vega: 0.16,
                pop: Math.round((1 - Math.abs(peDelta)) * 100)
            }
        });
    }

    let totalPutOI = 0;
    let totalCallOI = 0;
    strikes.forEach(s => {
        totalCallOI += s.CE.oi;
        totalPutOI += s.PE.oi;
    });

    return {
        symbol,
        underlyingValue: spot,
        timestamp: new Date().toISOString(),
        totalPutOI,
        totalCallOI,
        pcr: totalCallOI > 0 ? totalPutOI / totalCallOI : 0,
        maxPain: atm,
        strikes
    };
};

const OptionChainIntel: React.FC = () => {
    const designPreset = useSettingsStore((s) => s.designPreset);
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const [symbol, setSymbol] = useState<string>('NIFTY');
    const { context: underlyingContext } = useMarketContext('NSE:' + symbol);
    // Basic settings & navigation tabs
    const [customSymbol, setCustomSymbol] = useState<string>('');
    const [expiries, setExpiries] = useState<string[]>([]);
    const [selectedExpiry, setSelectedExpiry] = useState<string>('');
    const [activeTab, setActiveTab] = useState<'table' | 'oi_wall_map' | 'iv_skew' | 'oi_story' | 'oi_charts' | 'greeks' | 'flow_scanner'>('table');
    const [showFullChain, setShowFullChain] = useState<boolean>(false);
    const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
    const [refreshCounter, setRefreshCounter] = useState<number>(30);

    // Core data streams
    const [data, setData] = useState<OptionChainSnapshot | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [isFallback, setIsFallback] = useState<boolean>(false);
    
    // Flash status tracking for Open Interest changes
    const [flashingStrikes, setFlashingStrikes] = useState<Record<number, { ce?: boolean; pe?: boolean }>>({});

    // Flow Scanner States
    const [alerts, setAlerts] = useState<UnusualFlowAlert[]>([]);
    const [isScanning, setIsScanning] = useState<boolean>(false);

    // Sync flow scanner state and register callback
    useEffect(() => {
        setIsScanning(optionChainService.isFlowScanningActive);
        setAlerts(optionChainService.unusualFlowAlerts);

        if (optionChainService.isFlowScanningActive) {
            optionChainService.startFlowScanning(symbol, (updatedAlerts) => {
                setAlerts([...updatedAlerts]);
            });
        }
    }, []);

    // Reactively update scanner if symbol changes when active
    useEffect(() => {
        if (isScanning) {
            optionChainService.startFlowScanning(symbol, (updatedAlerts) => {
                setAlerts([...updatedAlerts]);
            });
        }
    }, [symbol, isScanning]);

    const handleToggleScanning = () => {
        if (isScanning) {
            optionChainService.stopFlowScanning();
            setIsScanning(false);
        } else {
            setIsScanning(true);
            optionChainService.startFlowScanning(symbol, (updatedAlerts) => {
                setAlerts([...updatedAlerts]);
            });
        }
    };

    const handleClearAlerts = () => {
        optionChainService.clearFlowAlerts();
        setAlerts([]);
    };

    // Active displayed strikes keys for websocket subscriptions
    const activeOptionKeys = useMemo(() => {
        if (!data || !data.strikes.length) return [];
        const keys: string[] = [];
        
        // Find index of ATM strike
        const atm = data.strikes.reduce((prev, curr) => {
            return Math.abs(curr.strikePrice - data.underlyingValue) < Math.abs(prev.strikePrice - data.underlyingValue) ? curr : prev;
        }).strikePrice;
        const atmIndex = data.strikes.findIndex(s => s.strikePrice === atm);
        
        // We only subscribe to strikes around ATM (max 11 strikes) to optimize ws throughput
        const start = Math.max(0, atmIndex - 5);
        const end = Math.min(data.strikes.length, atmIndex + 6);
        const activeStrikes = data.strikes.slice(start, end);

        activeStrikes.forEach(s => {
            if (s.CE?.instrumentKey) keys.push(s.CE.instrumentKey);
            if (s.PE?.instrumentKey) keys.push(s.PE.instrumentKey);
        });
        return keys;
    }, [data?.strikes, data?.underlyingValue]);

    const activeKeys = useMemo(() => {
        const keys = [...activeOptionKeys];
        const underlyingKey = SYMBOL_TO_UNDERLYING_KEY[symbol];
        if (underlyingKey) {
            keys.push(underlyingKey);
        }
        return keys;
    }, [activeOptionKeys, symbol]);

    const ticks = useGlobalTickStore((s) => s.ticks);
    useOptionChainStream(activeKeys);
    const isConnected = useGlobalTickStore((s) => s.isConnected);

    // Merge live ticks into option chain data structure
    useEffect(() => {
        if (Object.keys(ticks).length === 0 || !data) return;

        // 1. Determine which strikes should flash (OI difference >= 10,000)
        const strikesToFlash: Record<number, { ce?: boolean; pe?: boolean }> = {};
        let flashChanged = false;

        data.strikes.forEach(s => {
            if (s.CE && s.CE.instrumentKey && ticks[s.CE.instrumentKey]) {
                const tick = ticks[s.CE.instrumentKey];
                if (tick.oi !== null && tick.oi !== undefined && s.CE.oi !== undefined) {
                    const diff = Math.abs(tick.oi - s.CE.oi);
                    if (diff >= 10000) {
                        if (!strikesToFlash[s.strikePrice]) {
                            strikesToFlash[s.strikePrice] = {};
                        }
                        strikesToFlash[s.strikePrice].ce = true;
                        flashChanged = true;
                    }
                }
            }
            if (s.PE && s.PE.instrumentKey && ticks[s.PE.instrumentKey]) {
                const tick = ticks[s.PE.instrumentKey];
                if (tick.oi !== null && tick.oi !== undefined && s.PE.oi !== undefined) {
                    const diff = Math.abs(tick.oi - s.PE.oi);
                    if (diff >= 10000) {
                        if (!strikesToFlash[s.strikePrice]) {
                            strikesToFlash[s.strikePrice] = {};
                        }
                        strikesToFlash[s.strikePrice].pe = true;
                        flashChanged = true;
                    }
                }
            }
        });

        if (flashChanged) {
            setFlashingStrikes(prev => ({
                ...prev,
                ...strikesToFlash
            }));
            setTimeout(() => {
                setFlashingStrikes(prev => {
                    const next = { ...prev };
                    Object.keys(strikesToFlash).forEach(strikeStr => {
                        const strike = Number(strikeStr);
                        if (next[strike]) {
                            if (strikesToFlash[strike].ce) next[strike].ce = false;
                            if (strikesToFlash[strike].pe) next[strike].pe = false;
                        }
                    });
                    return next;
                });
            }, 1000);
        }

        // 2. Perform the option chain state update
        setData((prev) => {
            if (!prev) return null;
            const updated = { ...prev };
            let changed = false;

            const underlyingKey = SYMBOL_TO_UNDERLYING_KEY[symbol];
            if (underlyingKey && ticks[underlyingKey]) {
                const tick = ticks[underlyingKey];
                if (tick.ltp !== null && tick.ltp !== updated.underlyingValue) {
                    updated.underlyingValue = tick.ltp;
                    changed = true;
                }
            }

            const updatedStrikes = updated.strikes.map(s => {
                let strikeChanged = false;
                const newCE = s.CE ? { ...s.CE } : null;
                const newPE = s.PE ? { ...s.PE } : null;

                if (newCE?.instrumentKey && ticks[newCE.instrumentKey]) {
                    const tick = ticks[newCE.instrumentKey];
                    if (tick.ltp !== null && tick.ltp !== newCE.ltp) {
                        newCE.ltp = tick.ltp;
                        strikeChanged = true;
                    }
                    if (tick.volume !== null && tick.volume !== newCE.volume) {
                        newCE.volume = tick.volume;
                        strikeChanged = true;
                    }
                    if (tick.oi !== null && tick.oi !== newCE.oi) {
                        newCE.oi = tick.oi;
                        strikeChanged = true;
                    }
                    if (tick.iv !== null && tick.iv !== newCE.iv) {
                        newCE.iv = tick.iv;
                        strikeChanged = true;
                    }
                    if (tick.greeks) {
                        if (tick.greeks.delta !== undefined) newCE.delta = tick.greeks.delta;
                        if (tick.greeks.theta !== undefined) newCE.theta = tick.greeks.theta;
                        if (tick.greeks.gamma !== undefined) newCE.gamma = tick.greeks.gamma;
                        if (tick.greeks.vega !== undefined) newCE.vega = tick.greeks.vega;
                        strikeChanged = true;
                    }
                }

                if (newPE?.instrumentKey && ticks[newPE.instrumentKey]) {
                    const tick = ticks[newPE.instrumentKey];
                    if (tick.ltp !== null && tick.ltp !== newPE.ltp) {
                        newPE.ltp = tick.ltp;
                        strikeChanged = true;
                    }
                    if (tick.volume !== null && tick.volume !== newPE.volume) {
                        newPE.volume = tick.volume;
                        strikeChanged = true;
                    }
                    if (tick.oi !== null && tick.oi !== newPE.oi) {
                        newPE.oi = tick.oi;
                        strikeChanged = true;
                    }
                    if (tick.iv !== null && tick.iv !== newPE.iv) {
                        newPE.iv = tick.iv;
                        strikeChanged = true;
                    }
                    if (tick.greeks) {
                        if (tick.greeks.delta !== undefined) newPE.delta = tick.greeks.delta;
                        if (tick.greeks.theta !== undefined) newPE.theta = tick.greeks.theta;
                        if (tick.greeks.gamma !== undefined) newPE.gamma = tick.greeks.gamma;
                        if (tick.greeks.vega !== undefined) newPE.vega = tick.greeks.vega;
                        strikeChanged = true;
                    }
                }

                if (strikeChanged) {
                    changed = true;
                    return { ...s, CE: newCE, PE: newPE };
                }
                return s;
            });

            if (changed) {
                updated.strikes = updatedStrikes;
                let totalPutOI = 0;
                let totalCallOI = 0;
                updatedStrikes.forEach(s => {
                    if (s.CE) totalCallOI += s.CE.oi;
                    if (s.PE) totalPutOI += s.PE.oi;
                });
                updated.totalCallOI = totalCallOI;
                updated.totalPutOI = totalPutOI;
                updated.pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
                updated.timestamp = new Date().toISOString();
                return updated;
            }
            return prev;
        });
    }, [ticks, data, symbol]);

    // Refresh triggers
    const triggerFetch = useCallback(async (currentSymbol: string, expiryDate?: string) => {
        setLoading(true);
        const result = await optionChainService.fetchOptionChain(currentSymbol, expiryDate, true);
        if (result) {
            setData(result);
            setIsFallback(optionChainService.getFallbackStatus());
            setLastRefresh(new Date());
        } else {
            // Serve mock data if both API and fallback fail (essential for non-connected/off-market previews)
            const mock = generateMockOptionChain(currentSymbol, expiryDate || '');
            setData(mock);
            setIsFallback(true);
            setLastRefresh(new Date());
        }
        setLoading(false);
    }, []);

    // Initial load and symbol change handler
    useEffect(() => {
        const loadExpiries = async () => {
            const list = await optionChainService.fetchOptionExpiries(symbol);
            setExpiries(list);
            if (list.length > 0) {
                setSelectedExpiry(list[0]);
                triggerFetch(symbol, list[0]);
            } else {
                setSelectedExpiry('');
                triggerFetch(symbol);
            }
        };
        loadExpiries();
    }, [symbol, triggerFetch]);

    // Timer effect for auto-refresh
    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            setRefreshCounter(prev => {
                if (prev <= 1) {
                    triggerFetch(symbol, selectedExpiry);
                    return 30;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [autoRefresh, symbol, selectedExpiry, triggerFetch]);

    const handleCustomSymbolSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (customSymbol.trim()) {
            setSymbol(customSymbol.toUpperCase().trim());
            setCustomSymbol('');
        }
    };

    // --- DERIVED QUANT METRICS & ANALYTICS ---

    // ATM detection
    const atmStrike = useMemo(() => {
        if (!data || !data.strikes.length) return 0;
        const spot = data.underlyingValue;
        return data.strikes.reduce((prev, curr) => {
            return Math.abs(curr.strikePrice - spot) < Math.abs(prev.strikePrice - spot) ? curr : prev;
        }).strikePrice;
    }, [data]);

    // Expose filtered strikes around ATM
    const displayedStrikes = useMemo(() => {
        if (!data || !data.strikes.length) return [];
        if (showFullChain) return data.strikes;

        // Find index of ATM strike
        const atmIndex = data.strikes.findIndex(s => s.strikePrice === atmStrike);
        if (atmIndex === -1) return data.strikes.slice(0, 12);

        const start = Math.max(0, atmIndex - 5);
        const end = Math.min(data.strikes.length, atmIndex + 6);
        return data.strikes.slice(start, end);
    }, [data, atmStrike, showFullChain]);

    const { visibleItems, totalHeight, offsetY, containerRef, startIndex, endIndex } = useVirtualList(
        displayedStrikes,
        38,
        500
    );

    // Support and Resistance Levels
    const levels = useMemo(() => {
        if (!data || !data.strikes.length) return { support: 0, resistance: 0, breakoutScore: 0 };

        let maxCallOI = 0;
        let maxCallStrike = 0;
        let maxPutOI = 0;
        let maxPutStrike = 0;

        data.strikes.forEach(s => {
            if (s.CE && s.CE.oi > maxCallOI) {
                maxCallOI = s.CE.oi;
                maxCallStrike = s.strikePrice;
            }
            if (s.PE && s.PE.oi > maxPutOI) {
                maxPutOI = s.PE.oi;
                maxPutStrike = s.strikePrice;
            }
        });

        // Breakout probability score: represents strength of resistance
        // Less Call OI concentration at main resistance = higher probability of break
        const totalCallOI = data.totalCallOI || 1;
        const breakoutScore = Math.max(10, Math.min(95, Math.round((1 - (maxCallOI / totalCallOI)) * 100)));

        return {
            support: maxPutStrike,
            resistance: maxCallStrike,
            breakoutScore
        };
    }, [data]);

    const oiStories = useMemo(() => {
        if (!data || !data.strikes.length) return [];
        const mappedStrikes = data.strikes.map(s => ({
            strikePrice: s.strikePrice,
            CE: s.CE ? { oi: s.CE.oi, oiChange: s.CE.changeInOi, iv: s.CE.iv } : undefined,
            PE: s.PE ? { oi: s.PE.oi, oiChange: s.PE.changeInOi, iv: s.PE.iv } : undefined
        }));
        return OIStoryGenerator.generateOIStory(mappedStrikes, data.underlyingValue, data.maxPain);
    }, [data]);

    // Dynamic GEX & Greeks aggregations
    const greeksSummary = useMemo(() => {
        if (!data || !data.strikes.length) return { totalGex: 0, atmTheta: 0 };

        const lotSize = LOT_SIZES[symbol] || 50;
        const spot = data.underlyingValue;

        let totalGex = 0;
        let atmTheta = 0;

        data.strikes.forEach(s => {
            // GEX calculation: Gamma * OI * LotSize * Spot^2
            // Calls add positive GEX, Puts add negative GEX (standard dealer positioning assumption)
            const ceGamma = s.CE?.gamma || 0;
            const ceOi = s.CE?.oi || 0;
            const peGamma = s.PE?.gamma || 0;
            const peOi = s.PE?.oi || 0;

            const ceGex = ceGamma * ceOi * lotSize * spot * spot;
            const peGex = peGamma * peOi * lotSize * spot * spot;

            totalGex += (ceGex - peGex);

            // Accumulate Theta decay for ATM strikes (+/- 1 strike around ATM)
            if (Math.abs(s.strikePrice - atmStrike) <= (symbol === 'NIFTY' ? 50 : 100)) {
                atmTheta += (s.CE?.theta || 0) + (s.PE?.theta || 0);
            }
        });

        return {
            totalGex: Math.round(totalGex / 1000000), // In Millions
            atmTheta: Math.round(atmTheta * lotSize)
        };
    }, [data, symbol, atmStrike]);

    // Real-time Quant Option Greeks (GEX & DWOI)
    const quantMetrics = useMemo(() => {
        if (!data || !data.strikes.length) {
            return {
                netGex: 0,
                zeroGammaLevel: 0,
                maxPain: 0,
                regime: 'PINNING' as const,
                ceDwoiSum: 0,
                peDwoiSum: 0,
                deltaAdjustedPcr: 1.0
            };
        }
        const lotSize = LOT_SIZES[symbol] || 50;
        const spot = data.underlyingValue;
        
        const gexRes = quantGreeksService.computeGEX(data, lotSize, spot);
        const dwoiRes = quantGreeksService.computeDWOI(data);
        
        return {
            ...gexRes,
            ...dwoiRes
        };
    }, [data, symbol]);

    // Color indicators based on PCR values
    const pcrMeta = useMemo(() => {
        if (!data) return { zone: 'Neutral', color: 'text-slate-400', signal: 'No Signal' };
        const p = data.pcr;
        if (p < 0.7) {
            return {
                zone: 'Euphoric',
                color: 'text-rose-500',
                signal: 'Contrarian Sell / CAUTION'
            };
        }
        if (p >= 0.7 && p < 1.0) {
            return {
                zone: 'Mild Bullish',
                color: 'text-emerald-400',
                signal: 'Neutral-Bullish Bias'
            };
        }
        if (p >= 1.0 && p <= 1.3) {
            return {
                zone: 'Neutral-Bearish',
                color: 'text-amber-500',
                signal: 'Rangebound Consolidation'
            };
        }
        return {
            zone: 'Fearful',
            color: 'text-emerald-500',
            signal: 'Contrarian Buy Setup / DIP BUYING'
        };
    }, [data]);

    // Preparing charting structures
    const chartData = useMemo(() => {
        if (!data) return [];
        return data.strikes.map(s => {
            const spot = data.underlyingValue;
            const lotSize = LOT_SIZES[symbol] || 50;
            const ceGamma = s.CE?.gamma || 0;
            const ceOi = s.CE?.oi || 0;
            const peGamma = s.PE?.gamma || 0;
            const peOi = s.PE?.oi || 0;

            // Individual GEX calculations for comparison chart
            const callGex = Math.round((ceGamma * ceOi * lotSize * spot * spot) / 100000);
            const putGex = Math.round((peGamma * peOi * lotSize * spot * spot) / 100000);

            // Pain Calculation for Max Pain Curve
            let pain = 0;
            data.strikes.forEach(inner => {
                if (inner.CE && inner.strikePrice < s.strikePrice) {
                    pain += inner.CE.oi * (s.strikePrice - inner.strikePrice);
                }
                if (inner.PE && inner.strikePrice > s.strikePrice) {
                    pain += inner.PE.oi * (inner.strikePrice - s.strikePrice);
                }
            });

            return {
                strike: s.strikePrice,
                'Call OI': s.CE?.oi || 0,
                'Put OI': s.PE?.oi || 0,
                'Call OI Chg': s.CE?.changeInOi || 0,
                'Put OI Chg': s.PE?.changeInOi || 0,
                'Call IV': s.CE?.iv || 0,
                'Put IV': s.PE?.iv || 0,
                'Call GEX': callGex,
                'Put GEX': -putGex,
                'Pain Value': Math.round(pain / 100000)
            };
        });
    }, [data, symbol]);

    return (
        <div className="space-y-6 text-slate-100 font-sans">
            {/* God-Tier Control Bar */}
            <div className={`flex flex-col xl:flex-row items-center justify-between gap-6 border p-6 backdrop-blur-md ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl font-sans" : "border-slate-800 bg-slate-900/90 rounded-[32px] font-sans"}`}>

                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center border border-indigo-500/20 bg-indigo-500/10 text-indigo-400 rounded-2xl">
                        <Zap size={24} fill="currentColor" />
                    </div>
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-black uppercase tracking-wider">Option Chain Intelligence</h2>
                            <DataFreshnessTag fetchedAt={data?.timestamp} source={isFallback ? 'cache' : 'live'} />
                        </div>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                            Institutional derivative analytics on Nifty & equities
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    {/* Index Tabs */}
                    <div className={`flex border p-1.5 ${isAstryx ? 'border-white/[0.102] bg-[#141414] rounded-[9999px]' : isReui ? 'border-zinc-800 bg-zinc-950 rounded-lg' : 'border-slate-850 bg-slate-950 rounded-2xl'}`}>
                        {['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'].map((idx) => {
                            const isActive = symbol === idx;
                            const btnClass = isAstryx
                                ? (isActive ? 'bg-[#262626] text-white border border-white/[0.102] shadow-sm' : 'text-zinc-400 hover:text-white')
                                : isReui
                                    ? (isActive ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm' : 'text-zinc-400 hover:text-zinc-200')
                                    : (isActive ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300');
                            return (
                                <button
                                    key={idx}
                                    onClick={() => setSymbol(idx)}
                                    className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${isAstryx ? 'rounded-[9999px]' : isReui ? 'rounded-md' : 'rounded-xl'} ${btnClass}`}
                                >
                                    {idx}
                                </button>
                            );
                        })}
                    </div>

                    {/* Custom Search Form */}
                    <form onSubmit={handleCustomSymbolSearch} className="relative flex items-center">
                        <input
                            type="text"
                            value={customSymbol}
                            onChange={(e) => setCustomSymbol(e.target.value)}
                            placeholder="Equity Symbol..."
                            className="w-36 bg-slate-950 border border-slate-800 px-3 py-2 text-[11px] uppercase tracking-wider text-slate-200 focus:outline-none focus:border-indigo-500 font-mono placeholder:text-slate-600 rounded-full"
                        />
                        <button type="submit" className="absolute right-2 text-slate-500 hover:text-indigo-400">
                            <Search size={14} />
                        </button>
                    </form>

                    {/* Expiry Selector */}
                    {expiries.length > 0 && (
                        <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-full">
                            <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Expiry</span>
                            <select
                                value={selectedExpiry}
                                onChange={(e) => {
                                    setSelectedExpiry(e.target.value);
                                    triggerFetch(symbol, e.target.value);
                                }}
                                className="bg-transparent text-[11px] font-mono font-bold text-slate-200 outline-none cursor-pointer"
                            >
                                {expiries.map(exp => (
                                    <option key={exp} value={exp} className="bg-slate-950 text-slate-200 font-mono">
                                        {new Date(exp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toUpperCase()}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Refresh Engine */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={async () => {
                                const refreshStore = useRefreshProgressStore.getState();
                                refreshStore.startRefresh(
                                    'option-chain',
                                    `Option Chain - ${symbol}`,
                                    ['Fetching options chain snapshot...', 'Parsing live implied volatilities...', 'Summing portfolio Greeks...'],
                                    1500
                                );
                                try {
                                    const interval = setInterval(() => {
                                        const steps = refreshStore.steps;
                                        const activeIdx = steps.findIndex(s => s.status === 'active');
                                        if (activeIdx !== -1 && activeIdx < steps.length - 1) {
                                            refreshStore.updateStep(activeIdx + 1);
                                        }
                                    }, 500);

                                    await triggerFetch(symbol, selectedExpiry);
                                    clearInterval(interval);
                                    await refreshStore.completeRefresh();
                                } catch (e) {
                                    console.error(e);
                                    refreshStore.cancelRefresh();
                                }
                            }}
                            disabled={loading}
                            className={`flex h-9 w-9 items-center justify-center border border-slate-800 bg-slate-950 hover:bg-slate-900 transition-colors rounded-xl ${loading ? 'opacity-50' : ''}`}
                            title="Force Refresh Data"
                        >
                            <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-400' : 'text-slate-400'} />
                        </button>

                        <div className="flex items-center gap-2 border border-slate-800 bg-slate-950 px-3 py-2 rounded-xl">
                            <input
                                type="checkbox"
                                id="auto-refresh-toggle"
                                checked={autoRefresh}
                                onChange={() => setAutoRefresh(!autoRefresh)}
                                className="accent-indigo-500 h-3.5 w-3.5 rounded-sm"
                            />
                            <label htmlFor="auto-refresh-toggle" className="text-[10px] font-black uppercase tracking-wider text-slate-400 cursor-pointer select-none">
                                {autoRefresh ? `Live (${refreshCounter}s)` : 'Paused'}
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {/* Split Screen Dashboard (25% Sidebar | 75% Main Content) */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">

                {/* 25% Sidebar Metrics Panel */}
                <div className="space-y-6 lg:col-span-1">

                    {/* Underlying Spot Price */}
                    <div className={`border p-5 text-center ${isAstryx ? "border-white/[0.102] bg-[#161616] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/60 rounded-xl" : "border-slate-800 bg-slate-900/60 rounded-[32px]"}`}>
                        <div className="flex items-center justify-center gap-2 text-slate-500 text-[10px] font-black uppercase tracking-widest">
                            <Activity size={12} className="text-indigo-400" />
                            {symbol} Spot Price
                        </div>
                        <div className="mt-2 text-3xl font-black font-mono tracking-tighter text-white">
                            {data ? data.underlyingValue.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                        </div>
                        {underlyingContext?.discrepancies && underlyingContext.discrepancies.length > 0 && underlyingContext.discrepancies[0] && (
                            <div className="mt-3 flex items-center gap-1.5 justify-center text-[9px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-xl animate-pulse">
                                <ShieldAlert size={10} />
                                Discrepancy ({((underlyingContext.discrepancies[0].delta || 0) * 100).toFixed(2)}%)
                            </div>
                        )}
                        {underlyingContext && (
                            <div className="mt-2 text-[8px] font-mono text-slate-550 flex items-center justify-center gap-1.5">
                                <span>Trust: {underlyingContext.trustScore}%</span>
                                <span>•</span>
                                <span>As Of: {new Date(underlyingContext.asOf).toLocaleTimeString()}</span>
                            </div>
                        )}
                        {isFallback && !underlyingContext && (
                            <div className="mt-3 flex items-center gap-1.5 justify-center text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-xl">
                                <ShieldAlert size={10} />
                                fallback Scraper Active
                            </div>
                        )}
                    </div>

                    {/* Semi-circular Put-Call Ratio Gauge (C.4) */}
                    <div className={`border p-5 ${isAstryx ? "border-white/[0.102] bg-[#161616] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/60 rounded-xl" : "border-slate-800 bg-slate-900/60 rounded-[32px]"}`}>
                        <div className="flex items-center justify-between text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-3 mb-4">
                            <span>Put-Call Ratio (PCR)</span>
                            <BarChart3 size={12} />
                        </div>

                        {/* Custom SVG Semi-Circle Gauge */}
                        <div className="relative flex flex-col items-center py-2">
                            <svg className="w-36 h-20" viewBox="0 0 100 50">
                                {/* Base track */}
                                <path
                                    d="M 10 50 A 40 40 0 0 1 90 50"
                                    fill="none"
                                    stroke="#1e293b"
                                    strokeWidth="10"
                                    strokeLinecap="square"
                                />
                                {/* Zones indicators: Red to Green (Contrarian interpretation) */}
                                {/* Zone 1: Euphoric (Low PCR < 0.7) - caution/bearish */}
                                <path
                                    d="M 10 50 A 40 40 0 0 1 35 15"
                                    fill="none"
                                    stroke="#ef4444"
                                    strokeWidth="10"
                                />
                                {/* Zone 2: Neutral (0.7 to 1.3) */}
                                <path
                                    d="M 35 15 A 40 40 0 0 1 75 15"
                                    fill="none"
                                    stroke="#f59e0b"
                                    strokeWidth="10"
                                />
                                {/* Zone 3: Fearful/Oversold (High PCR > 1.3) - contrarian buy */}
                                <path
                                    d="M 75 15 A 40 40 0 0 1 90 50"
                                    fill="none"
                                    stroke="#10b981"
                                    strokeWidth="10"
                                />
                                {/* Gauge needle pointer */}
                                {data && (
                                    <g transform={`translate(50, 50) rotate(${Math.max(-90, Math.min(90, (((!isNaN(data.pcr) ? data.pcr : 1) - 0.5) / 1.5) * 180 - 90))})`}>
                                        <line x1="0" y1="0" x2="0" y2="-38" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
                                        <circle cx="0" cy="0" r="4.5" fill="#ffffff" />
                                    </g>
                                )}
                            </svg>

                            <div className="text-center mt-3 space-y-1">
                                <div className="flex items-baseline justify-center gap-1.5">
                                    <span className="text-2xl font-black font-mono tracking-tight text-white" title="Raw PCR">
                                        {data?.pcr != null && !isNaN(data.pcr) ? data.pcr.toFixed(2) : '0.00'}
                                    </span>
                                    <span className="text-slate-500 text-[10px] font-mono">RAW</span>
                                </div>
                                <div className="flex items-baseline justify-center gap-1.5">
                                    <span className="text-lg font-black font-mono tracking-tight text-indigo-400" title="Delta-Weighted PCR">
                                        {(quantMetrics?.deltaAdjustedPcr ?? 1).toFixed(2)}
                                    </span>
                                    <span className="text-indigo-500 text-[9px] font-mono font-bold">Δ-ADJ</span>
                                </div>
                                <span className={`block text-[10px] font-black uppercase tracking-widest ${pcrMeta.color}`}>
                                    {pcrMeta.zone}
                                </span>
                            </div>
                        </div>

                        {/* PCR Contrarian Signal Text */}
                        <div className="mt-4 border-t border-slate-800 pt-3 text-[10px] leading-relaxed">
                            <span className="font-black text-slate-500 uppercase block mb-1">Signal Strategy</span>
                            <span className="text-slate-200 font-bold block bg-slate-950 p-2 border border-slate-850 rounded-xl font-mono">
                                {pcrMeta.signal}
                            </span>
                            <span className="text-slate-400 mt-1.5 block leading-normal">
                                *Contrarian PCR theory holds that heavy Call OI accumulation (low PCR) signs euphoria, while high PCR indicates deep fear and market bottoms.
                            </span>
                        </div>
                    </div>

                    {/* Quant Greeks Intelligence Card */}
                    <div className={`border p-5 space-y-4 ${isAstryx ? "border-white/[0.102] bg-[#161616] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/60 rounded-xl" : "border-slate-800 bg-slate-900/60 rounded-[32px]"}`}>

                        <div className="flex items-center justify-between text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-3">
                            <span>Quant Greeks Intel</span>
                            <Layers size={12} className="text-indigo-400" />
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-center border border-slate-800 bg-slate-950 p-3 rounded-xl">
                                <div className="text-left">
                                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Net GEX</span>
                                    <span className={`text-md font-black font-mono mt-0.5 block ${quantMetrics.regime === 'TRENDING' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {(quantMetrics.netGex / 10000000).toFixed(2)} Cr
                                    </span>
                                </div>
                                <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full ${quantMetrics.regime === 'TRENDING' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                    {quantMetrics.regime}
                                </span>
                            </div>

                            <div className="flex justify-between items-center border border-slate-800 bg-slate-950 p-3 rounded-xl">
                                <div className="text-left">
                                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Zero-Gamma Level (ZGL)</span>
                                    <span className="text-md font-black text-white font-mono mt-0.5 block">
                                        ₹{quantMetrics.zeroGammaLevel.toLocaleString('en-IN')}
                                    </span>
                                </div>
                                <span className="text-[9px] font-black text-slate-550 font-mono">
                                    {data ? `${Math.abs(data.underlyingValue - quantMetrics.zeroGammaLevel).toFixed(0)} pts` : ''}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Support & Resistance OI Overlay Card (C.5) */}
                    <div className={`border p-5 space-y-4 ${isAstryx ? "border-white/[0.102] bg-[#161616] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/60 rounded-xl" : "border-slate-800 bg-slate-900/60 rounded-[32px]"}`}>

                        <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-3">
                            OI Synthetic Levels
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-center">
                            <div className="border border-slate-800 bg-slate-950 p-3 rounded-xl">
                                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">OI Support (Floor)</span>
                                <span className="text-md font-black text-emerald-400 font-mono mt-1 block">
                                    {levels.support > 0 ? levels.support : '-'}
                                </span>
                            </div>
                            <div className="border border-slate-800 bg-slate-950 p-3 rounded-xl">
                                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">OI Resistance (Ceiling)</span>
                                <span className="text-md font-black text-rose-400 font-mono mt-1 block">
                                    {levels.resistance > 0 ? levels.resistance : '-'}
                                </span>
                            </div>
                        </div>

                        {/* Breakout Probability Gauge */}
                        <div className="space-y-1.5 border border-slate-850 bg-slate-950 p-3 rounded-xl">
                            <div className="flex justify-between text-[9px] font-bold text-slate-400">
                                <span className="uppercase">Breakout Probability</span>
                                <span className="text-indigo-400 font-mono font-black">{levels.breakoutScore}%</span>
                            </div>
                            <div className="h-2 w-full bg-slate-900 border border-slate-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-500"
                                    style={{ width: `${levels.breakoutScore}%` }}
                                />
                            </div>
                            <span className="text-[8px] text-slate-500 block leading-tight">
                                Probability calculated by assessing depth and thickness of Call OI defense lines at ceiling.
                            </span>
                        </div>
                    </div>

                    {/* Greeks & Theta decay Aggregates (C.3) */}
                    <div className={`border p-5 space-y-4 ${isAstryx ? "border-white/[0.102] bg-[#161616] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/60 rounded-xl" : "border-slate-800 bg-slate-900/60 rounded-[32px]"}`}>

                        <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-3">
                            Greeks Aggregation
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                                <span className="text-[10px] font-bold text-slate-400">Total Net GEX (Dealer Gamma)</span>
                                <span className={`text-xs font-black font-mono ${greeksSummary.totalGex >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {greeksSummary.totalGex > 0 ? '+' : ''}{greeksSummary.totalGex}M
                                </span>
                            </div>

                            {/* Theta Decay clock representation */}
                            <div className="flex items-start gap-3 bg-slate-950 border border-slate-850 p-3 rounded-xl">
                                <Clock size={16} className="text-amber-500 mt-0.5 shrink-0" />
                                <div className="space-y-1">
                                    <span className="text-[9px] font-black uppercase text-slate-500 tracking-wide block">ATM Daily Decay Rate</span>
                                    <span className="text-xs font-black text-slate-200 font-mono block">
                                        ₹{Math.abs(greeksSummary.atmTheta).toLocaleString()} / Day
                                    </span>
                                    <span className="text-[8px] text-slate-500 block leading-tight">
                                        Theoretical time decay loss incurred per contract slot around the active spot index strike daily.
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 75% Main Content Workspace */}
                <div className="lg:col-span-3 space-y-6">
                    {/* Real-Time IV Smile & Skew (CC29) */}
                    {data && data.underlyingValue > 0 && (
                        <IVSkewChart chain={data} spot={data.underlyingValue} />
                    )}

                    {/* Delta Hedging Engine (CC29) */}
                    {data && data.underlyingValue > 0 && (
                        <DeltaHedgePanel spot={data.underlyingValue} indexName={symbol} />
                    )}

                    {/* Navigation Tab bar */}
                    <div className={`flex gap-2 p-1.5 border w-full max-w-full overflow-x-auto scrollbar-none mb-2 ${isAstryx ? 'border-white/[0.102] bg-[#141414] rounded-[9999px]' : isReui ? 'border-zinc-800 bg-zinc-950 rounded-lg' : 'border-slate-850 bg-slate-950/60 rounded-2xl flex-wrap'}`}>
                        {[
                            { id: 'table', label: 'Option Chain Table' },
                            { id: 'oi_wall_map', label: 'OI Wall Map' },
                            { id: 'iv_skew', label: 'IV Skew' },
                            { id: 'oi_story', label: 'OI Story' },
                            { id: 'oi_charts', label: 'OI & Max Pain Curve' },
                            { id: 'greeks', label: 'Greeks & GEX' },
                            { id: 'flow_scanner', label: 'Live Option Flow' },
                        ].map((tab) => {
                            const isActive = activeTab === tab.id;
                            const pillClass = isAstryx
                                ? (isActive ? 'bg-[#262626] text-white border border-white/[0.102] shadow-sm font-medium' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]')
                                : isReui
                                    ? (isActive ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40')
                                    : (isActive ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300');
                            const radiusClass = isAstryx ? 'rounded-[9999px]' : isReui ? 'rounded-md' : 'rounded-xl';
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`px-5 py-2 text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${radiusClass} ${pillClass}`}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="min-h-[400px]">
                        {activeTab === 'oi_wall_map' && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`border p-5 ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}
                            >
                                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                                    <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                                    OI Concentration per Strike (Call vs Put Wall Map)
                                </h3>
                                <div className="h-96">
                                    <SafeChartContainer>
                                        <BarChart
                                            data={chartData}
                                            layout="vertical"
                                            margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                            <XAxis type="number" stroke="#64748b" fontSize={10} tickFormatter={(val) => `${(val / 1000000).toFixed(1)}M`} />
                                            <YAxis dataKey="strike" type="category" stroke="#64748b" fontSize={10} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff', fontSize: '11px', fontFamily: 'monospace', borderRadius: '12px' }}
                                                formatter={(value: any) => [value.toLocaleString(), 'Contracts']}
                                            />
                                            <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase' }} />
                                            <Bar dataKey="Call OI" fill="#4f46e5" radius={[4, 4, 4, 4]} />
                                            <Bar dataKey="Put OI" fill="#f43f5e" radius={[4, 4, 4, 4]} />
                                        </BarChart>
                                    </SafeChartContainer>
                                </div>
                            </motion.div>
                        )}

                        {activeTab === 'iv_skew' && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`border p-5 ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}
                            >
                                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                                    <div className="w-1 h-3 bg-amber-500 rounded-full" />
                                    IV Skew Curve (Implied Volatility Smile / Skew)
                                </h3>
                                <div className="h-96">
                                    <SafeChartContainer>
                                        <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                            <XAxis dataKey="strike" stroke="#64748b" fontSize={9} />
                                            <YAxis stroke="#64748b" fontSize={9} tickFormatter={(val) => `${val}%`} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff', fontSize: '10px', borderRadius: '12px' }}
                                                formatter={(value: any) => [`${value}%`, 'IV']}
                                            />
                                            <Legend wrapperStyle={{ fontSize: '9px', textTransform: 'uppercase' }} />
                                            <Line type="monotone" dataKey="Call IV" stroke="#10b981" strokeWidth={2} dot={{ r: 1 }} activeDot={{ r: 4 }} />
                                            <Line type="monotone" dataKey="Put IV" stroke="#f43f5e" strokeWidth={2} dot={{ r: 1 }} activeDot={{ r: 4 }} />
                                            {data && (
                                                <ReferenceLine x={data.underlyingValue} stroke="#ffffff" strokeDasharray="3 3" label={{ value: 'SPOT', fill: '#fff', fontSize: 9 }} />
                                            )}
                                        </LineChart>
                                    </SafeChartContainer>
                                </div>
                            </motion.div>
                        )}

                        {activeTab === 'oi_story' && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`border p-5 space-y-4 ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}
                            >
                                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2 border-b border-slate-800 pb-3">
                                    <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                                    OI Narrative &amp; Market Forces Story
                                </h3>
                                <div className="space-y-3">
                                    {oiStories.map((story, i) => {
                                        let bg = 'bg-slate-950/40 border-slate-850';
                                        let text = 'text-slate-300';
                                        let dot = 'bg-slate-500';
                                        
                                        if (story.sentiment === 'bullish') {
                                            bg = 'bg-emerald-500/5 border-emerald-500/20';
                                            text = 'text-emerald-400';
                                            dot = 'bg-emerald-400';
                                        } else if (story.sentiment === 'bearish') {
                                            bg = 'bg-rose-500/5 border-rose-500/20';
                                            text = 'text-rose-400';
                                            dot = 'bg-rose-400';
                                        } else if (story.sentiment === 'caution') {
                                            bg = 'bg-amber-500/5 border-amber-500/20';
                                            text = 'text-amber-400';
                                            dot = 'bg-amber-400';
                                        }

                                        return (
                                            <div key={i} className={`flex items-start gap-3 p-4 border rounded-2xl ${bg}`}>
                                                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dot}`} />
                                                <div className="space-y-1">
                                                    <p className={`text-xs font-medium leading-relaxed ${text}`}>
                                                        {story.sentence}
                                                    </p>
                                                    <span className="text-[9px] font-mono text-slate-500 uppercase">
                                                        Strike: ₹{story.strike.toLocaleString('en-IN')} | Bias: {story.sentiment}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        )}

                        {activeTab === 'table' && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`border overflow-hidden ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl font-sans" : "border-slate-800 bg-slate-900/90 rounded-[32px] font-sans"}`}
                            >
                                <div className={`p-4 border-b flex items-center justify-between ${isAstryx ? 'border-white/[0.102] bg-[#262626]' : isReui ? 'border-zinc-800 bg-zinc-950/70' : 'border-slate-800 bg-slate-950/40'}`}>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                        <Layers size={12} className={isAstryx ? "text-zinc-300" : isReui ? "text-zinc-400" : "text-indigo-400"} />
                                        Strike matrix table
                                    </span>
                                    <div className="flex gap-4 text-[9px] font-black uppercase tracking-widest">
                                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> CALLS (Left)</span>
                                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-rose-500 rounded-full" /> PUTS (Right)</span>
                                    </div>
                                </div>

                                 <div ref={containerRef} className="overflow-auto max-h-[500px] table-scroll">
                                    <table className={`w-full min-w-[780px] text-[11px] border-collapse font-mono select-none ${isAstryx ? "font-['Figtree',sans-serif]" : ''}`}>
                                        <thead>
                                            <tr className={`${isAstryx ? 'bg-[#262626] border-b border-white/[0.102] text-zinc-400' : isReui ? 'bg-zinc-950 border-b border-zinc-800 text-zinc-400' : 'bg-slate-950/60 border-b border-slate-800 text-slate-500'} text-[9px] uppercase tracking-wider sticky top-0 z-10`}>
                                                {/* Calls headers */}
                                                <th className="px-3 py-2.5 font-black text-left">OI</th>
                                                <th className="px-3 py-2.5 font-black text-left">Chg OI</th>
                                                <th className="px-3 py-2.5 font-black text-left">Vol</th>
                                                <th className="px-3 py-2.5 font-black text-left">IV</th>
                                                <th className="px-3 py-2.5 font-black text-left">LTP</th>
                                                <th className="px-3 py-2.5 font-black text-left">Δ</th>
                                                <th className="px-3 py-2.5 font-black text-left">θ</th>

                                                {/* Center Strike */}
                                                <th className="px-4 py-2.5 font-black text-center bg-slate-950">Strike</th>

                                                {/* Puts headers */}
                                                <th className="px-3 py-2.5 font-black text-right">θ</th>
                                                <th className="px-3 py-2.5 font-black text-right">Δ</th>
                                                <th className="px-3 py-2.5 font-black text-right">LTP</th>
                                                <th className="px-3 py-2.5 font-black text-right">IV</th>
                                                <th className="px-3 py-2.5 font-black text-right">Vol</th>
                                                <th className="px-3 py-2.5 font-black text-right">Chg OI</th>
                                                <th className="px-3 py-2.5 font-black text-right">OI</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-850">
                                            {offsetY > 0 && (
                                                <tr style={{ height: `${offsetY}px` }}>
                                                    <td colSpan={15} style={{ padding: 0, border: 0 }} />
                                                </tr>
                                            )}
                                            {visibleItems.map((s) => {
                                                const isATM = s.strikePrice === atmStrike;
                                                const isZGL = s.strikePrice === quantMetrics.zeroGammaLevel;
                                                const spot = data?.underlyingValue || 0;
                                                const isCallITM = s.strikePrice < spot;
                                                const isPutITM = s.strikePrice > spot;

                                                return (
                                                    <tr
                                                        key={s.strikePrice}
                                                        className={`group hover:bg-slate-800/40 transition-colors ${isATM ? 'border-y border-amber-500/30' : ''} ${isZGL ? 'border-y border-indigo-500/30 bg-indigo-500/5' : ''}`}
                                                    >
                                                        {/* --- CALLS SECTION --- */}
                                                        {/* OI */}
                                                        <td className={`px-3 py-2 text-slate-300 font-bold transition-all duration-300 ${isCallITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'} ${flashingStrikes[s.strikePrice]?.ce ? 'bg-sky-500/30 text-sky-200 scale-105 font-extrabold animate-pulse' : ''}`}>
                                                            {s.CE?.oi != null ? s.CE.oi.toLocaleString() : '0'}
                                                        </td>
                                                        {/* Chg OI */}
                                                        <td className={`px-3 py-2 font-bold ${isCallITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'} ${(s.CE?.changeInOi || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                            {(s.CE?.changeInOi || 0) > 0 ? '+' : ''}{s.CE?.changeInOi != null ? s.CE.changeInOi.toLocaleString() : '0'}
                                                        </td>
                                                        {/* Volume */}
                                                        <td className={`px-3 py-2 text-slate-400 ${isCallITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'}`}>
                                                            {s.CE?.volume != null ? s.CE.volume.toLocaleString() : '0'}
                                                        </td>
                                                        {/* IV */}
                                                        <td className={`px-3 py-2 text-amber-500/70 ${isCallITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'}`}>
                                                            {s.CE?.iv != null ? `${s.CE.iv.toFixed(1)}%` : '0.0%'}
                                                        </td>
                                                        {/* LTP */}
                                                        <td className={`px-3 py-2 font-black ${isCallITM ? 'bg-indigo-500/5' : ''} ${isCallITM ? 'text-emerald-400' : 'text-slate-200'}`}>
                                                            {s.CE?.ltp != null ? `₹${s.CE.ltp.toFixed(2)}` : '₹0.00'}
                                                        </td>
                                                        {/* Delta */}
                                                        <td className={`px-3 py-2 text-slate-400 ${isCallITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'}`}>
                                                            {s.CE?.delta != null ? s.CE.delta.toFixed(2) : '-'}
                                                        </td>
                                                        {/* Theta */}
                                                        <td className={`px-3 py-2 text-rose-500/60 ${isCallITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'}`}>
                                                            {s.CE?.theta != null ? s.CE.theta.toFixed(1) : '-'}
                                                        </td>

                                                        {/* --- CENTER STRIKE --- */}
                                                        <td className={`px-4 py-2 text-center font-black bg-slate-950 border-x border-slate-800 ${isATM ? 'text-amber-400 bg-amber-500/10' : ''} ${isZGL ? 'text-indigo-400 bg-indigo-500/15 font-black' : ''} ${!isATM && !isZGL ? 'text-white' : ''}`}>
                                                            <div className="flex flex-col items-center justify-center">
                                                                <span>{s.strikePrice}</span>
                                                                {isATM && <span className="text-[7px] font-black uppercase text-amber-500 tracking-tighter -mt-0.5">ATM</span>}
                                                                {isZGL && <span className="text-[7px] font-black uppercase text-indigo-400 tracking-tighter -mt-0.5">ZGL</span>}
                                                            </div>
                                                        </td>

                                                        {/* --- PUTS SECTION --- */}
                                                        {/* Theta */}
                                                        <td className={`px-3 py-2 text-right text-rose-500/60 ${isPutITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'}`}>
                                                            {s.PE?.theta != null ? s.PE.theta.toFixed(1) : '-'}
                                                        </td>
                                                        {/* Delta */}
                                                        <td className={`px-3 py-2 text-right text-slate-400 ${isPutITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'}`}>
                                                            {s.PE?.delta != null ? s.PE.delta.toFixed(2) : '-'}
                                                        </td>
                                                        {/* LTP */}
                                                        <td className={`px-3 py-2 text-right font-black ${isPutITM ? 'bg-indigo-500/5' : ''} ${isPutITM ? 'text-rose-400' : 'text-slate-200'}`}>
                                                            {s.PE?.ltp != null ? `₹${s.PE.ltp.toFixed(2)}` : '₹0.00'}
                                                        </td>
                                                        {/* IV */}
                                                        <td className={`px-3 py-2 text-right text-amber-500/70 ${isPutITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'}`}>
                                                            {s.PE?.iv != null ? `${s.PE.iv.toFixed(1)}%` : '0.0%'}
                                                        </td>
                                                        {/* Volume */}
                                                        <td className={`px-3 py-2 text-right text-slate-400 ${isPutITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'}`}>
                                                            {s.PE?.volume != null ? s.PE.volume.toLocaleString() : '0'}
                                                        </td>
                                                        {/* Chg OI */}
                                                        <td className={`px-3 py-2 text-right font-bold ${isPutITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'} ${(s.PE?.changeInOi || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                            {(s.PE?.changeInOi || 0) > 0 ? '+' : ''}{s.PE?.changeInOi != null ? s.PE.changeInOi.toLocaleString() : '0'}
                                                        </td>
                                                        {/* OI */}
                                                        <td className={`px-3 py-2 text-right text-slate-300 font-bold transition-all duration-300 ${isPutITM ? 'bg-indigo-500/5' : 'bg-rose-500/5'} ${flashingStrikes[s.strikePrice]?.pe ? 'bg-sky-500/30 text-sky-200 scale-105 font-extrabold animate-pulse' : ''}`}>
                                                            {s.PE?.oi != null ? s.PE.oi.toLocaleString() : '0'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {Math.max(0, totalHeight - offsetY - (visibleItems.length * 38)) > 0 && (
                                                <tr style={{ height: `${Math.max(0, totalHeight - offsetY - (visibleItems.length * 38))}px` }}>
                                                    <td colSpan={15} style={{ padding: 0, border: 0 }} />
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                <div className={`p-4 border-t text-center ${isAstryx ? 'border-white/[0.102] bg-[#161616]' : isReui ? 'border-zinc-800 bg-zinc-950/40' : 'border-slate-800 bg-slate-950/30'}`}>
                                    <button
                                        onClick={() => setShowFullChain(!showFullChain)}
                                        className={`inline-flex items-center gap-1.5 px-4 py-1.5 border transition-colors text-[10px] font-black uppercase tracking-wider ${isAstryx ? 'border-white/[0.102] bg-[#262626] hover:bg-[#333] text-zinc-300 hover:text-white rounded-[9999px]' : isReui ? 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-md' : 'border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white rounded-xl'}`}
                                    >
                                        {showFullChain ? 'Compress to ATM Strikes' : 'Show Full Option Chain'}
                                        <ArrowRight size={10} className="mt-0.5" />
                                    </button>
                                </div>
                            </motion.div>
                        )}

                        {activeTab === 'oi_charts' && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="space-y-6"
                            >
                                {/* Horizontal OI Bar Chart (C.2.1) */}
                                <div className={`border p-5 ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}>
                                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                                        <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                                        OI Concentration per Strike (Call vs Put)
                                    </h3>
                                    <div className="h-80">
                                        <SafeChartContainer>
                                            <BarChart
                                                data={chartData}
                                                layout="vertical"
                                                margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                <XAxis type="number" stroke="#64748b" fontSize={10} tickFormatter={(val) => `${(val / 1000000).toFixed(1)}M`} />
                                                <YAxis dataKey="strike" type="category" stroke="#64748b" fontSize={10} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff', fontSize: '11px', fontFamily: 'monospace', borderRadius: '12px' }}
                                                    formatter={(value: any) => [value.toLocaleString(), 'Contracts']}
                                                />
                                                <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase' }} />
                                                <Bar dataKey="Call OI" fill="#4f46e5" radius={[4, 4, 4, 4]} />
                                                <Bar dataKey="Put OI" fill="#f43f5e" radius={[4, 4, 4, 4]} />
                                            </BarChart>
                                        </SafeChartContainer>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                    {/* Change in OI Chart (C.2.2) */}
                                    <div className={`border p-5 ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}>
                                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                                            <div className="w-1 h-3 bg-emerald-500 rounded-full" />
                                            Change in Open Interest (Intraday buildup)
                                        </h3>
                                        <div className="h-64">
                                            <SafeChartContainer>
                                                <BarChart data={chartData}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                    <XAxis dataKey="strike" stroke="#64748b" fontSize={9} />
                                                    <YAxis stroke="#64748b" fontSize={9} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff', fontSize: '10px', borderRadius: '12px' }}
                                                        formatter={(value: any) => [value.toLocaleString(), 'Net Contracts']}
                                                    />
                                                    <Legend wrapperStyle={{ fontSize: '9px', textTransform: 'uppercase' }} />
                                                    <Bar dataKey="Call OI Chg" fill="#818cf8" radius={[4, 4, 4, 4]} />
                                                    <Bar dataKey="Put OI Chg" fill="#fda4af" radius={[4, 4, 4, 4]} />
                                                </BarChart>
                                            </SafeChartContainer>
                                        </div>
                                    </div>

                                    {/* Max Pain loss curve (C.2.3) */}
                                    <div className={`border p-5 ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}>
                                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                                            <div className="w-1 h-3 bg-amber-500 rounded-full" />
                                            Max Pain Loss Curve (Option Sellers Loss)
                                        </h3>
                                        <div className="h-64">
                                            <SafeChartContainer>
                                                <AreaChart data={chartData}>
                                                    <defs>
                                                        <linearGradient id="painGrad" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                    <XAxis dataKey="strike" stroke="#64748b" fontSize={9} />
                                                    <YAxis stroke="#64748b" fontSize={9} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff', fontSize: '10px', borderRadius: '12px' }}
                                                        formatter={(value: any) => [`${value} Loss Units`, 'Seller Pain']}
                                                    />
                                                    <Area type="monotone" dataKey="Pain Value" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#painGrad)" />
                                                    {data && (
                                                        <ReferenceLine x={data.underlyingValue} stroke="#ffffff" strokeDasharray="3 3" label={{ value: 'SPOT', fill: '#fff', fontSize: 9, position: 'top' }} />
                                                    )}
                                                    {data && (
                                                        <ReferenceLine x={data.maxPain} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'PAIN', fill: '#f59e0b', fontSize: 9, position: 'bottom' }} />
                                                    )}
                                                </AreaChart>
                                            </SafeChartContainer>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {activeTab === 'greeks' && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="space-y-6"
                            >
                                {/* IV Skew Smile Curve (C.3.1) */}
                                <div className={`border p-5 ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}>
                                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                                        <div className="w-1 h-3 bg-amber-500 rounded-full" />
                                        IV Skew Curve (Implied Volatility Smile / Smirk)
                                    </h3>
                                    <div className="h-72">
                                        <SafeChartContainer>
                                            <LineChart data={chartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                <XAxis dataKey="strike" stroke="#64748b" fontSize={9} />
                                                <YAxis stroke="#64748b" fontSize={9} tickFormatter={(val) => `${val}%`} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff', fontSize: '10px', borderRadius: '12px' }}
                                                    formatter={(value: any) => [`${value}%`, 'IV']}
                                                />
                                                <Legend wrapperStyle={{ fontSize: '9px', textTransform: 'uppercase' }} />
                                                <Line type="monotone" dataKey="Call IV" stroke="#10b981" strokeWidth={2} dot={{ r: 1 }} activeDot={{ r: 4 }} />
                                                <Line type="monotone" dataKey="Put IV" stroke="#f43f5e" strokeWidth={2} dot={{ r: 1 }} activeDot={{ r: 4 }} />
                                                {data && (
                                                    <ReferenceLine x={data.underlyingValue} stroke="#ffffff" strokeDasharray="3 3" label={{ value: 'SPOT', fill: '#fff', fontSize: 9 }} />
                                                )}
                                            </LineChart>
                                        </SafeChartContainer>
                                    </div>
                                </div>

                                {/* Gamma Exposure (GEX) Profile per Strike (C.3.2) */}
                                <div className={`border p-5 ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}>
                                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                                        <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                                        Gamma Exposure (GEX) Profile (Dealer Hedging Pressure)
                                    </h3>
                                    <div className="h-72">
                                        <SafeChartContainer>
                                            <ComposedChart data={chartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                <XAxis dataKey="strike" stroke="#64748b" fontSize={9} />
                                                <YAxis stroke="#64748b" fontSize={9} tickFormatter={(val) => `${val}k`} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff', fontSize: '10px', borderRadius: '12px' }}
                                                    formatter={(value: any) => [`${Math.abs(value).toLocaleString()} Units`, value >= 0 ? 'Call GEX' : 'Put GEX']}
                                                />
                                                <Legend wrapperStyle={{ fontSize: '9px', textTransform: 'uppercase' }} />
                                                <ReferenceLine y={0} stroke="#475569" />
                                                <Bar dataKey="Call GEX" fill="#818cf8" name="Call GEX (+)" radius={[4, 4, 4, 4]} />
                                                <Bar dataKey="Put GEX" fill="#fda4af" name="Put GEX (-)" radius={[4, 4, 4, 4]} />
                                                {data && (
                                                    <ReferenceLine x={data.underlyingValue} stroke="#ffffff" strokeDasharray="3 3" label={{ value: 'SPOT', fill: '#fff', fontSize: 9 }} />
                                                )}
                                            </ComposedChart>
                                        </SafeChartContainer>
                                    </div>
                                    <div className="mt-3 text-[9px] text-slate-500 leading-normal">
                                        *Positive Call GEX (+) acts as volatility dampener (magnet). Negative Put GEX (-) acts as volatility accelerator (sellers sell more underlying stock when price falls to hedge puts).
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {activeTab === 'flow_scanner' && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="space-y-6"
                            >
                                {/* Control Header Card */}
                                <div className={`border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}>
                                    <div className="flex items-center gap-4">
                                        {/* Toggle Switch */}
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                checked={isScanning} 
                                                onChange={handleToggleScanning} 
                                                className="sr-only peer" 
                                            />
                                            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                            <span className="ml-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
                                                Active Unusual Flow Scanning
                                            </span>
                                        </label>

                                        {isScanning && (
                                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-black uppercase tracking-wider animate-pulse">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                Scanning every 60s
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleClearAlerts}
                                            className="px-4 py-1.5 border border-slate-800 hover:border-slate-700 bg-slate-950 hover:bg-slate-900 transition-colors text-[9px] font-black uppercase tracking-wider text-slate-400 hover:text-white rounded-xl"
                                        >
                                            Clear Alert Logs
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (isScanning) {
                                                    // Trigger manual refresh
                                                    optionChainService.fetchOptionChain(symbol, undefined, true).then(() => {
                                                        setAlerts([...optionChainService.unusualFlowAlerts]);
                                                    });
                                                }
                                            }}
                                            disabled={!isScanning}
                                            className={`px-4 py-1.5 border rounded-xl text-[9px] font-black uppercase tracking-wider transition-colors ${
                                                isScanning 
                                                    ? 'border-indigo-600 hover:border-indigo-500 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 hover:text-indigo-300' 
                                                    : 'border-slate-800 bg-slate-900 text-slate-600 cursor-not-allowed'
                                            }`}
                                        >
                                            Force Scan Now
                                        </button>
                                    </div>
                                </div>

                                {/* Heatmap Grid */}
                                <OptionFlowHeatmap
                                    symbol={symbol}
                                    underlyingValue={data?.underlyingValue || 0}
                                    expiries={expiries}
                                    alerts={alerts}
                                />

                                {/* Scrolling Alerts Feed Card */}
                                <div className={`border overflow-hidden ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl" : "border-slate-800 bg-slate-900/90 rounded-[32px]"}`}>

                                    <div className="p-5 border-b border-slate-850 flex justify-between items-center">
                                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                            <div className="w-1 h-3 bg-rose-500 rounded-full" />
                                            Live Alert Feed
                                        </h3>
                                        <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">
                                            {alerts.length} unusual activities logged
                                        </span>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse font-mono text-[10px]">
                                            <thead>
                                                <tr className="border-b border-slate-850 bg-slate-950/40 text-slate-500 text-[8px] uppercase tracking-wider font-sans">
                                                    <th className="py-3 px-5">Timestamp</th>
                                                    <th className="py-3 px-4">Contract</th>
                                                    <th className="py-3 px-4">Type</th>
                                                    <th className="py-3 px-4">Trigger Metric</th>
                                                    <th className="py-3 px-5">Details</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-850 bg-slate-950/20">
                                                {alerts.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="py-10 text-center text-slate-500 font-sans text-xs">
                                                            No alerts logged yet. Toggle scanning and let it run to capture anomalies.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    alerts.map(alert => {
                                                        const isCE = alert.optionType === 'CE';
                                                        let typeStyle = '';
                                                        switch (alert.alertType) {
                                                            case 'OI_SPIKE':
                                                                typeStyle = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
                                                                break;
                                                            case 'IV_JUMP':
                                                                typeStyle = 'bg-amber-500/10 border-amber-500/30 text-amber-400';
                                                                break;
                                                            case 'BLOCK_VOLUME':
                                                                typeStyle = 'bg-rose-500/10 border-rose-500/30 text-rose-400';
                                                                break;
                                                        }
                                                        return (
                                                            <tr key={alert.id} className="hover:bg-slate-900/40 transition-colors">
                                                                <td className="py-3.5 px-5 text-slate-500 font-sans">{alert.timestamp}</td>
                                                                <td className="py-3.5 px-4 font-bold text-white">
                                                                    {alert.symbol} {alert.strike} <span className={isCE ? 'text-emerald-400' : 'text-rose-400'}>{alert.optionType}</span>
                                                                </td>
                                                                <td className="py-3.5 px-4">
                                                                    <span className={`px-2 py-0.5 border rounded-lg text-[8px] font-black uppercase tracking-wider ${typeStyle}`}>
                                                                        {alert.alertType.replace('_', ' ')}
                                                                    </span>
                                                                </td>
                                                                <td className="py-3.5 px-4 text-slate-300 font-black">{alert.description}</td>
                                                                <td className="py-3.5 px-5 text-slate-400 leading-relaxed font-sans">{alert.details}</td>
                                                            </tr>
                                                        );
                                                    })
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OptionChainIntel;
