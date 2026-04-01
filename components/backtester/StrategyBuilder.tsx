import React, { useState, useEffect, useMemo } from 'react';
import { StrategyDefinition, ExitType, PositionSizingType, IndicatorCondition, ExitRule, OptionLeg } from '../../types/backtester.types';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings2, Plus, Trash2, Shield, Zap, Play, ChevronDown, Check, Target, Clock, Calendar, Database, BarChart3, Brain, AlertCircle, RefreshCw, Layers, Grid, Search } from 'lucide-react';
import { db } from '../../database';
import { formatCurrency } from '../../utils/helpers';
import { UpstoxBacktestDataService } from '../../services/backtester/UpstoxBacktestDataService';

export interface IndicatorItem {
  id: string;
  name: string;
  needsPeriod?: boolean;
  isPrice?: boolean;
  isPattern?: boolean;
  isPriceAction?: boolean;
  isBehavioral?: boolean;
}

export interface IndicatorGroup {
  name: string;
  items: IndicatorItem[];
}

export const INDICATOR_GROUPS: IndicatorGroup[] = [
  {
    name: 'Trend / Moving Averages',
    items: [
      { id: 'ema', name: 'EMA (Exponential MA)', needsPeriod: true },
      { id: 'sma', name: 'SMA (Simple MA)', needsPeriod: true },
      { id: 'wma', name: 'WMA (Weighted MA)', needsPeriod: true },
      { id: 'dema', name: 'DEMA (Double EMA)', needsPeriod: true },
      { id: 'tema', name: 'TEMA (Triple EMA)', needsPeriod: true },
      { id: 'vwma', name: 'VWMA (Volume-Weighted MA)', needsPeriod: true },
      { id: 'hma', name: 'HullMA (Hull MA)', needsPeriod: true },
      { id: 'alma', name: 'ALMA (Arnaud Legoux MA)', needsPeriod: true }
    ]
  },
  {
    name: 'Momentum Oscillators',
    items: [
      { id: 'rsi', name: 'RSI (Relative Strength Index)', needsPeriod: true },
      { id: 'stoch_k', name: 'Stochastic %K', needsPeriod: true },
      { id: 'stoch_d', name: 'Stochastic %D', needsPeriod: true },
      { id: 'willr', name: 'Williams %R', needsPeriod: true },
      { id: 'cci', name: 'CCI (Commodity Channel Index)', needsPeriod: true },
      { id: 'roc', name: 'ROC (Rate of Change)', needsPeriod: true },
      { id: 'mfi', name: 'MFI (Money Flow Index)', needsPeriod: true },
      { id: 'cmo', name: 'CMO (Chande Momentum Osc.)', needsPeriod: true }
    ]
  },
  {
    name: 'Trend Strength',
    items: [
      { id: 'macd', name: 'MACD Line', needsPeriod: false },
      { id: 'macd_signal', name: 'MACD Signal', needsPeriod: false },
      { id: 'macd_hist', name: 'MACD Histogram', needsPeriod: false },
      { id: 'adx', name: 'ADX (Avg Directional Index)', needsPeriod: true },
      { id: 'di_plus', name: '+DI (Directional Indicator Plus)', needsPeriod: true },
      { id: 'di_minus', name: '-DI (Directional Indicator Minus)', needsPeriod: true },
      { id: 'aroon_up', name: 'Aroon Up', needsPeriod: true },
      { id: 'aroon_down', name: 'Aroon Down', needsPeriod: true }
    ]
  },
  {
    name: 'Volatility',
    items: [
      { id: 'atr', name: 'ATR (Average True Range)', needsPeriod: true },
      { id: 'atr_pct', name: 'ATR % (Percentage ATR)', needsPeriod: true },
      { id: 'bb_upper', name: 'Bollinger Upper Band', needsPeriod: false },
      { id: 'bb_mid', name: 'Bollinger Middle (SMA 20)', needsPeriod: false },
      { id: 'bb_lower', name: 'Bollinger Lower Band', needsPeriod: false },
      { id: 'bb_pctb', name: 'BB %B (Position in Bands)', needsPeriod: false },
      { id: 'bb_width', name: 'BB Width', needsPeriod: false },
      { id: 'kc_upper', name: 'Keltner Upper Band', needsPeriod: false },
      { id: 'kc_lower', name: 'Keltner Lower Band', needsPeriod: false },
      { id: 'squeeze', name: 'TTM Squeeze Setup', needsPeriod: false },
      { id: 'hv', name: 'Historical Volatility', needsPeriod: true },
      { id: 'don_high', name: 'Donchian High', needsPeriod: true },
      { id: 'don_low', name: 'Donchian Low', needsPeriod: true }
    ]
  },
  {
    name: 'Volume & Market Internals',
    items: [
      { id: 'rel_vol', name: 'Relative Volume', needsPeriod: false },
      { id: 'vol_sma', name: 'Volume SMA', needsPeriod: true },
      { id: 'obv', name: 'OBV (On-Balance Volume)', needsPeriod: false },
      { id: 'vwap', name: 'VWAP (Intraday)', needsPeriod: false },
      { id: 'vwap_dev_pct', name: 'VWAP Deviation %', needsPeriod: false },
      { id: 'ad', name: 'Accumulation/Distribution', needsPeriod: false },
      { id: 'cmf', name: 'Chaikin Money Flow (CMF)', needsPeriod: true },
      { id: 'fi', name: 'Force Index', needsPeriod: true },
      { id: 'oi_chg_pct', name: 'OI Change %', needsPeriod: false },
      { id: 'oi_ratio', name: 'OI Ratio vs 20d Avg', needsPeriod: false }
    ]
  },
  {
    name: 'Price / Price Action / Patterns',
    items: [
      { id: 'close', name: 'Close Price', needsPeriod: false, isPrice: true },
      { id: 'open', name: 'Open Price', needsPeriod: false, isPrice: true },
      { id: 'high', name: 'High Price', needsPeriod: false, isPrice: true },
      { id: 'low', name: 'Low Price', needsPeriod: false, isPrice: true },
      { id: 'gap_pct', name: 'Gap %', needsPeriod: false, isPrice: true },
      { id: 'bullish_engulfing', name: 'Bullish Engulfing', isPattern: true },
      { id: 'bearish_engulfing', name: 'Bearish Engulfing', isPattern: true },
      { id: 'doji', name: 'Doji', isPattern: true },
      { id: 'hammer', name: 'Hammer', isPattern: true },
      { id: 'inverted_hammer', name: 'Inverted Hammer', isPattern: true },
      { id: 'morning_star', name: 'Morning Star', isPattern: true },
      { id: 'evening_star', name: 'Evening Star', isPattern: true },
      { id: 'pin_bar_bull', name: 'Pin Bar Bull', isPattern: true },
      { id: 'pin_bar_bear', name: 'Pin Bar Bear', isPattern: true },
      { id: 'inside_bar', name: 'Inside Bar', isPattern: true },
      { id: 'outside_bar', name: 'Outside Bar', isPattern: true },
      { id: 'three_green_soldiers', name: '3 Green Soldiers', isPattern: true },
      { id: 'three_red_crows', name: '3 Red Crows', isPattern: true },
      { id: 'nr4', name: 'NR4 (Narrow Range 4)', isPattern: true },
      { id: 'nr7', name: 'NR7 (Narrow Range 7)', isPattern: true },
      { id: 'orb_high', name: 'ORB High Breakout', isPattern: true },
      { id: 'orb_low', name: 'ORB Low Breakout', isPattern: true },
      { id: 'higher_high', name: 'Higher High (vs N bars ago)', needsPeriod: true, isPriceAction: true },
      { id: 'lower_low', name: 'Lower Low (vs N bars ago)', needsPeriod: true, isPriceAction: true }
    ]
  },
  {
    name: 'Behavioral & Journal',
    items: [
      { id: 'timeOfDay', name: 'Time of Day', isBehavioral: true },
      { id: 'dayOfWeek', name: 'Day of Week', isBehavioral: true },
      { id: 'direction', name: 'Direction (Long/Short)', isBehavioral: true },
      { id: 'consecutiveLosses', name: 'Consecutive Losses', isBehavioral: true },
      { id: 'mood', name: 'Journal Mood', isBehavioral: true },
      { id: 'mistake', name: 'Avoid Mistake', isBehavioral: true }
    ]
  }
];

interface StrategyBuilderProps {
  strategy: StrategyDefinition;
  setStrategy: React.Dispatch<React.SetStateAction<StrategyDefinition>>;
  initialCapital: number;
  setInitialCapital: React.Dispatch<React.SetStateAction<number>>;
  onRunSimulation: (
    strategy: StrategyDefinition, 
    initialCapital: number, 
    simulationMode: 'history' | 'market', 
    marketSimConfig?: { fromDate: string; toDate: string; interval: string }
  ) => void;
  isLoading: boolean;
  
  // Screener Mode Props
  isScreenerMode: boolean;
  setIsScreenerMode: (val: boolean) => void;
  onRunScreener: (config: any) => void;
}

export const StrategyBuilder: React.FC<StrategyBuilderProps> = ({ 
  strategy, 
  setStrategy, 
  initialCapital, 
  setInitialCapital, 
  onRunSimulation, 
  isLoading,
  isScreenerMode,
  setIsScreenerMode,
  onRunScreener
}) => {
  const [simulationMode, setSimulationMode] = useState<'history' | 'market'>('history');
  const [marketSimInterval, setMarketSimInterval] = useState<string>('day');
  const [marketSimDateRange, setMarketSimDateRange] = useState({
    from: '2024-01-01',
    to: '2025-01-01'
  });
  const [screenerUniverse, setScreenerUniverse] = useState<'indices' | 'all' | 'custom'>('indices');
  const [customSymbols, setCustomSymbols] = useState<string>('');
  const [screenerPortfolioMode, setScreenerPortfolioMode] = useState<'independent' | 'consolidated'>('consolidated');
  const [screenerMaxConcurrentTrades, setScreenerMaxConcurrentTrades] = useState<number>(5);
  const [screenerDateRange, setScreenerDateRange] = useState({
    from: '2024-01-01',
    to: '2024-06-01'
  });
  const [hasData, setHasData] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const sanityCheck = useMemo(() => {
    // 1. Est. Trades per Year
    let estTrades = 250;
    strategy.entryRules.forEach(rule => {
      if (rule.leftIndicator === 'dayOfWeek') {
        estTrades *= rule.operator === 'EQUALS' ? 0.2 : 0.8;
      } else if (rule.leftIndicator === 'direction') {
        estTrades *= 0.5;
      } else if (rule.leftIndicator === 'timeOfDay') {
        estTrades *= 0.6;
      } else if (rule.leftIndicator === 'consecutiveLosses') {
        estTrades *= 0.7;
      } else {
        estTrades *= 0.8;
      }
    });
    if (strategy.assetClass === 'Options') estTrades *= 1.25;
    estTrades = Math.max(5, Math.round(estTrades));

    // 2. Capital at Risk
    let capAtRisk = 0;
    const sizing = strategy.positionSizing;
    if (sizing.type === 'PERCENT_OF_CAPITAL') {
      capAtRisk = initialCapital * (sizing.value / 100);
    } else if (sizing.type === 'FIXED_RISK_AMOUNT') {
      capAtRisk = sizing.value;
    } else if (sizing.type === 'FIXED_QUANTITY') {
      capAtRisk = sizing.value * (strategy.assetClass === 'Options' ? 8500 : 1500);
    } else if (sizing.type === 'KELLY') {
      capAtRisk = initialCapital * 0.15;
    }
    if (sizing.maxExposure) {
      capAtRisk = Math.min(capAtRisk, sizing.maxExposure);
    }

    // 3. Avg Holding Days
    const hasEodExit = strategy.exitRules.some(r => r.type === 'END_OF_DAY' || r.type === 'TIME_BASED');
    const avgHoldingDays = hasEodExit ? 0.1 : (strategy.assetClass === 'Options' ? 3.5 : 8.5);

    return {
      estTrades,
      capAtRisk: Math.round(capAtRisk),
      avgHoldingDays
    };
  }, [strategy, initialCapital]);

  useEffect(() => {
    const checkVaultData = async () => {
      try {
        const symbol = UpstoxBacktestDataService.getStrategySymbol(strategy);
        
        // Find if any points matching this assetClass and symbol starting prefix exist
        const count = await db.historical_data
          .where('date')
          .aboveOrEqual('1970-01-01')
          .and(p => p.assetClass === strategy.assetClass && p.symbol.toUpperCase().startsWith(symbol))
          .limit(1)
          .count();

        setHasData(count > 0);

        // Retrieve last cached point to show last updated date
        const matchedPoints = await db.historical_data
          .where('date')
          .aboveOrEqual('1970-01-01')
          .and(p => p.assetClass === strategy.assetClass && p.symbol.toUpperCase().startsWith(symbol))
          .toArray();

        if (matchedPoints.length > 0) {
          // Sort by date descending
          const sorted = matchedPoints.sort((a, b) => b.date.localeCompare(a.date));
          setLastFetched(sorted[0].date);
        } else {
          setLastFetched(null);
        }
      } catch (err) {
        console.error('[StrategyBuilder] Error checking vault status:', err);
      }
    };

    checkVaultData();
  }, [strategy]);

  const defaultTickers = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'RELIANCE', 'TCS', 'HDFCBANK'];
  const [tickerOption, setTickerOption] = useState('NIFTY');
  const [customTicker, setCustomTicker] = useState('');

  useEffect(() => {
    const prefill = sessionStorage.getItem('backtest_prefill_symbol');
    if (prefill) {
      sessionStorage.removeItem('backtest_prefill_symbol');
      const cleanPrefill = prefill.toUpperCase().trim();
      if (defaultTickers.includes(cleanPrefill)) {
        setTickerOption(cleanPrefill);
        setStrategy(s => ({ ...s, ticker: cleanPrefill }));
      } else {
        setTickerOption('CUSTOM');
        setCustomTicker(cleanPrefill);
        setStrategy(s => ({ ...s, ticker: cleanPrefill }));
      }
    }
  }, [setStrategy]);

  useEffect(() => {
    if (strategy.ticker) {
      if (defaultTickers.includes(strategy.ticker)) {
        setTickerOption(strategy.ticker);
      } else {
        setTickerOption('CUSTOM');
        setCustomTicker(strategy.ticker);
      }
    } else {
      const defaultVal = strategy.assetClass === 'Options' ? 'NIFTY' : 'RELIANCE';
      setTickerOption(defaultVal);
      setStrategy(s => ({ ...s, ticker: defaultVal }));
    }
  }, [strategy.id, strategy.assetClass]);

  const handleTickerOptionChange = (val: string) => {
    setTickerOption(val);
    if (val !== 'CUSTOM') {
      setStrategy((s: StrategyDefinition) => ({ ...s, ticker: val }));
    } else {
      setStrategy((s: StrategyDefinition) => ({ ...s, ticker: customTicker || 'RELIANCE' }));
    }
  };

  const handleCustomTickerChange = (val: string) => {
    const cleanVal = val.toUpperCase().trim();
    setCustomTicker(cleanVal);
    setStrategy((s: StrategyDefinition) => ({ ...s, ticker: cleanVal }));
  };


  const saveStrategy = () => {
    try {
      const existing = JSON.parse(localStorage.getItem('apex_strategies') || '[]');
      const updated = [...existing.filter((s: any) => s.id !== strategy.id), strategy];
      localStorage.setItem('apex_strategies', JSON.stringify(updated));
      alert('Strategy Saved Successfully!');
    } catch (e) {
      console.error(e);
    }
  };

  const loadStrategy = () => {
    try {
      const existing = JSON.parse(localStorage.getItem('apex_strategies') || '[]');
      if (existing.length > 0) {
        setStrategy(existing[existing.length - 1]); // Load latest for now
        alert('Latest Strategy Loaded!');
      } else {
        alert('No saved strategies found.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const addEntryRule = () => {
    setStrategy((s: StrategyDefinition) => ({
      ...s,
      entryRules: [...s.entryRules, { 
        id: Math.random().toString(), 
        logic: 'AND', 
        leftType: 'INDICATOR',
        leftIndicator: 'ema', 
        leftPeriod: 9, 
        operator: 'GREATER_THAN', 
        rightType: 'VALUE', 
        rightValue: 0 
      }]
    }));
  };

  const removeEntryRule = (id: string) => {
    setStrategy((s: StrategyDefinition) => ({
      ...s,
      entryRules: s.entryRules.filter((r: IndicatorCondition) => r.id !== id)
    }));
  };

  const updateEntryRule = (id: string, updates: Partial<IndicatorCondition>) => {
    setStrategy((s: StrategyDefinition) => ({
      ...s,
      entryRules: s.entryRules.map((r: IndicatorCondition) => r.id === id ? { ...r, ...updates } : r)
    }));
  };

  const addExitRule = () => {
    setStrategy((s: StrategyDefinition) => ({
      ...s,
      exitRules: [...s.exitRules, { id: Math.random().toString(), type: 'FIXED_STOP_LOSS', value: 0, unit: 'PERCENT' }]
    }));
  };

  const removeExitRule = (id: string) => {
    setStrategy((s: StrategyDefinition) => ({
      ...s,
      exitRules: s.exitRules.filter((r: ExitRule) => r.id !== id)
    }));
  };

  const updateExitRule = (id: string, updates: Partial<ExitRule>) => {
    setStrategy((s: StrategyDefinition) => ({
      ...s,
      exitRules: s.exitRules.map((r: ExitRule) => r.id === id ? { ...r, ...updates } : r)
    }));
  };

  const STRATEGY_TEMPLATES: Record<string, Partial<StrategyDefinition>> = {
    DUEL_BREAKOUT_950: {
      name: '9:50 AM Breakout Duel',
      assetClass: 'Equity',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '09:45' as any, rightValueHigh: '09:55' as any }
      ],
      exitRules: [
        { id: '2', type: 'FIXED_STOP_LOSS', value: 0.8, unit: 'PERCENT' },
        { id: '3', type: 'FIXED_TARGET', value: 1.5, unit: 'PERCENT' },
        { id: '4', type: 'END_OF_DAY', value: '15:15', unit: 'TIME' }
      ],
      positionSizing: { type: 'PERCENT_OF_CAPITAL', value: 10, maxExposure: 100000 }
    },
    CAPITAL_PRESERVATION: {
      name: 'Capital Preservation Mode',
      assetClass: 'Equity',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '10:30' as any, rightValueHigh: '12:30' as any },
        { id: '2', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'consecutiveLosses', operator: 'LESS_THAN', rightType: 'VALUE', rightValue: 1 },
        { id: '3', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'dayOfWeek', operator: 'NOT_EQUALS', rightType: 'VALUE', rightValue: 'Thursday' }
      ],
      exitRules: [
        { id: '4', type: 'FIXED_STOP_LOSS', value: 0.4, unit: 'PERCENT' },
        { id: '5', type: 'FIXED_TARGET', value: 0.8, unit: 'PERCENT' },
        { id: '6', type: 'END_OF_DAY', value: '15:15', unit: 'TIME' }
      ],
      positionSizing: { type: 'FIXED_RISK_AMOUNT', value: 500, maxExposure: 5000 }
    },
    MONDAY_EXPLOITER: {
      name: 'Monday Effect Exploiter',
      assetClass: 'Equity',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'dayOfWeek', operator: 'EQUALS', rightType: 'VALUE', rightValue: 'Monday' },
        { id: '2', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '09:25' as any, rightValueHigh: '10:15' as any },
        { id: '3', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'direction', operator: 'EQUALS', rightType: 'VALUE', rightValue: 'Short' },
        { id: '4', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'consecutiveLosses', operator: 'LESS_THAN', rightType: 'VALUE', rightValue: 2 }
      ],
      exitRules: [
        { id: '5', type: 'FIXED_STOP_LOSS', value: 0.6, unit: 'PERCENT' },
        { id: '6', type: 'FIXED_TARGET', value: 1.8, unit: 'PERCENT' },
        { id: '7', type: 'TIME_BASED', value: '12:00', unit: 'TIME' }
      ],
      positionSizing: { type: 'FIXED_RISK_AMOUNT', value: 1500, maxExposure: 15000 }
    },
    MOMENTUM: {
      name: 'Momentum Sniper',
      assetClass: 'Equity',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '09:30' as any, rightValueHigh: '11:00' as any },
        { id: '2', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'direction', operator: 'EQUALS', rightType: 'VALUE', rightValue: 'Long' }
      ],
      exitRules: [
        { id: '3', type: 'TRAILING_STOP', value: 1.5, unit: 'PERCENT' },
        { id: '4', type: 'END_OF_DAY', value: '15:15', unit: 'TIME' }
      ],
      positionSizing: { type: 'PERCENT_OF_CAPITAL', value: 5, maxExposure: 250000 }
    },
    ORB_BREAKOUT: {
      name: 'ORB Breakout',
      assetClass: 'Equity',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '09:30' as any, rightValueHigh: '13:00' as any },
        { id: '2', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'consecutiveLosses', operator: 'LESS_THAN', rightType: 'VALUE', rightValue: 3 }
      ],
      exitRules: [
        { id: '3', type: 'FIXED_STOP_LOSS', value: 0.8, unit: 'PERCENT' },
        { id: '4', type: 'FIXED_TARGET', value: 2.4, unit: 'PERCENT' },
        { id: '5', type: 'TIME_BASED', value: '14:30', unit: 'TIME' }
      ],
      positionSizing: { type: 'FIXED_RISK_AMOUNT', value: 2000, maxExposure: 20000 }
    },
    PSYCH_GUARD: {
      name: 'Psychological Guard',
      assetClass: 'Equity',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '11:30' as any, rightValueHigh: '14:00' as any },
        { id: '2', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'mistake', operator: 'EQUALS', rightType: 'VALUE', rightValue: 'Revenge Trade' },
        { id: '3', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'consecutiveLosses', operator: 'LESS_THAN', rightType: 'VALUE', rightValue: 3 },
        { id: '4', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'dayOfWeek', operator: 'NOT_EQUALS', rightType: 'VALUE', rightValue: 'Monday' }
      ],
      exitRules: [
        { id: '5', type: 'FIXED_STOP_LOSS', value: 1.0, unit: 'PERCENT' },
        { id: '6', type: 'FIXED_TARGET', value: 1.5, unit: 'PERCENT' },
        { id: '7', type: 'END_OF_DAY', value: '15:15', unit: 'TIME' }
      ],
      positionSizing: { type: 'PERCENT_OF_CAPITAL', value: 3, maxExposure: 100000 }
    },
    STREAK_RECOVERY: {
      name: 'Streak Recovery',
      assetClass: 'Equity',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '10:00' as any, rightValueHigh: '13:30' as any },
        { id: '2', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'consecutiveLosses', operator: 'LESS_THAN', rightType: 'VALUE', rightValue: 2 },
        { id: '3', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'direction', operator: 'EQUALS', rightType: 'VALUE', rightValue: 'Long' }
      ],
      exitRules: [
        { id: '4', type: 'TRAILING_STOP', value: 2.0, unit: 'PERCENT' },
        { id: '5', type: 'FIXED_STOP_LOSS', value: 1.0, unit: 'PERCENT' },
        { id: '6', type: 'END_OF_DAY', value: '15:15', unit: 'TIME' }
      ],
      positionSizing: { type: 'KELLY', value: 1, maxExposure: 300000 }
    },
    OPTIONS_HARVESTER: {
      name: 'Options Harvester',
      assetClass: 'Options',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '09:25' as any, rightValueHigh: '10:00' as any },
        { id: '2', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'dayOfWeek', operator: 'EQUALS', rightType: 'VALUE', rightValue: 'Monday' }
      ],
      exitRules: [
        { id: '3', type: 'FIXED_STOP_LOSS', value: 30, unit: 'PERCENT' },
        { id: '4', type: 'TIME_BASED', value: '14:45', unit: 'TIME' },
        { id: '5', type: 'END_OF_DAY', value: '15:15', unit: 'TIME' }
      ],
      legs: [
        { id: 'l1', action: 'SELL', type: 'CE', strikeSelection: 'ATM', strikeOffset: 0, quantityMultiplier: 1 },
        { id: 'l2', action: 'SELL', type: 'PE', strikeSelection: 'ATM', strikeOffset: 0, quantityMultiplier: 1 },
        { id: 'l3', action: 'BUY', type: 'CE', strikeSelection: 'OTM', strikeOffset: 200, quantityMultiplier: 1 },
        { id: 'l4', action: 'BUY', type: 'PE', strikeSelection: 'OTM', strikeOffset: -200, quantityMultiplier: 1 }
      ],
      positionSizing: { type: 'FIXED_QUANTITY', value: 1, maxExposure: 500000 }
    },
    ORB_FLAGSHIP_CERTIFIED: {
      name: 'ORB Flagship 3-Slot',
      description: 'Certified 3.5-Year Intraday Momentum Breakout. Dynamic 45 Universe, Sharpe 3.87, Calmar 10.27, Net P&L +₹127,751.54, Gate 6.5 Volume exhaustion veto.',
      assetClass: 'Equity',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '09:20' as any, rightValueHigh: '11:30' as any },
        { id: '2', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'consecutiveLosses', operator: 'LESS_THAN', rightType: 'VALUE', rightValue: 3 }
      ],
      exitRules: [
        { id: '3', type: 'FIXED_STOP_LOSS', value: 1.0, unit: 'PERCENT' },
        { id: '4', type: 'FIXED_TARGET', value: 2.0, unit: 'PERCENT' },
        { id: '5', type: 'END_OF_DAY', value: '15:15', unit: 'TIME' }
      ],
      positionSizing: { type: 'PERCENT_OF_CAPITAL', value: 33.3, maxExposure: 100000 }
    },
    SNAP_CALIBRATED: {
      name: 'SNAP 34/2.5 Pullback',
      description: 'Calibrated Mean-Reversion Pullback. EMA 34 dynamic regression channel with 2.5 ATR envelope bounce.',
      assetClass: 'Equity',
      entryRules: [
        { id: '1', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'timeOfDay', operator: 'BETWEEN', rightType: 'VALUE', rightValue: '09:45' as any, rightValueHigh: '14:00' as any },
        { id: '2', logic: 'AND', leftType: 'BEHAVIORAL', leftIndicator: 'direction', operator: 'EQUALS', rightType: 'VALUE', rightValue: 'Long' }
      ],
      exitRules: [
        { id: '3', type: 'FIXED_STOP_LOSS', value: 0.8, unit: 'PERCENT' },
        { id: '4', type: 'FIXED_TARGET', value: 1.6, unit: 'PERCENT' },
        { id: '5', type: 'END_OF_DAY', value: '15:15', unit: 'TIME' }
      ],
      positionSizing: { type: 'PERCENT_OF_CAPITAL', value: 33.3, maxExposure: 100000 }
    }
  };

  const applyTemplate = (key: string) => {
    const template = STRATEGY_TEMPLATES[key];
    if (template) {
      setStrategy((s: StrategyDefinition) => ({ ...s, ...template, id: `strat_${Date.now()}` } as StrategyDefinition));
    }
  };

  const validateStrategy = () => {
    const warnings: string[] = [];
    const sl = strategy.exitRules.find(r => r.type === 'FIXED_STOP_LOSS');
    const tp = strategy.exitRules.find(r => r.type === 'FIXED_TARGET');

    if (sl && tp && sl.unit === tp.unit && Number(tp.value) <= Number(sl.value)) {
      warnings.push('Risk/Reward Ratio is negative (Target <= Stop Loss).');
    }

    if (strategy.positionSizing.type === 'PERCENT_OF_CAPITAL' && strategy.positionSizing.value > 20) {
      warnings.push('Aggressive Position Sizing (>20% Capital per trade).');
    }

    const hasTimeRule = strategy.entryRules.some((r: IndicatorCondition) => r.leftIndicator === 'timeOfDay');
    const hasEodExit = strategy.exitRules.some((r: ExitRule) => r.type === 'END_OF_DAY' || r.type === 'TIME_BASED');
    
    if (hasTimeRule && !hasEodExit) {
      warnings.push('Intraday time rules active without an End-of-Day exit rule.');
    }

    return warnings;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const warnings = validateStrategy();
    if (warnings.length > 0) {
      if (!confirm(`Strategy Guard found potential issues:\n\n${warnings.join('\n')}\n\nProceed anyway?`)) {
        return;
      }
    }
    if (isScreenerMode) {
      onRunScreener({
        strategy,
        universe: screenerUniverse,
        customSymbols: screenerUniverse === 'custom' ? customSymbols : undefined,
        portfolioMode: screenerPortfolioMode,
        maxConcurrentTrades: screenerPortfolioMode === 'consolidated' ? screenerMaxConcurrentTrades : undefined,
        dateRange: screenerDateRange,
        initialCapital,
        costs: {
          brokeragePerOrder: 20,
          sttRate: 0.000625,
          exchangeFeeRate: 0.0005,
          stampDutyRate: 0.0001,
          estimatedSlippagePercent: 0.05
        }
      });
    } else {
      onRunSimulation(strategy, initialCapital, simulationMode, {
        fromDate: marketSimDateRange.from,
        toDate: marketSimDateRange.to,
        interval: marketSimInterval
      });
    }
  };

  const CustomDropdown: React.FC<{
    value: string;
    onChange: (val: string) => void;
    options: { id: string; name: string; icon?: any }[];
    label?: string;
    placeholder?: string;
    position?: 'top' | 'bottom';
  }> = ({ value, onChange, options, label, placeholder, position = 'bottom' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selected = options.find(o => o.id === value);

    return (
      <div className="w-full">
        {label && <label className="block text-xs font-semibold text-slate-400 tracking-wider mb-1 px-1">{label}</label>}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`w-full flex items-center justify-between gap-2 bg-slate-950/50 border ${isOpen ? 'border-indigo-500 ring-1 ring-indigo-500/20' : 'border-slate-800/80'} rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-900/50 hover:border-slate-700/50 focus:outline-none`}
          >
            <div className="flex items-center gap-2 truncate">
              {selected?.icon && <selected.icon size={13} className="text-indigo-400 shrink-0" />}
              <span className="truncate">{selected ? selected.name : placeholder}</span>
            </div>
            <ChevronDown size={13} className={`text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {isOpen && (
              <>
                <div className="fixed inset-0 z-[110]" onClick={() => setIsOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: position === 'bottom' ? 4 : -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: position === 'bottom' ? 4 : -4 }}
                  className={`absolute z-[120] ${position === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'} w-full bg-slate-950 border border-slate-800 rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden`}
                >
                  <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                    {options.map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => { onChange(opt.id); setIsOpen(false); }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${value === opt.id ? 'bg-indigo-650 text-white font-semibold' : 'text-slate-300 hover:bg-slate-850 hover:text-white'}`}
                      >
                        <div className="flex items-center gap-2">
                          {opt.icon && <opt.icon size={12} className={value === opt.id ? 'text-white' : 'text-indigo-400'} />}
                          <span>{opt.name}</span>
                        </div>
                        {value === opt.id && <Check size={12} className="text-white" />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  };

  const IndicatorDropdown: React.FC<{
    value: string;
    onChange: (type: string, id: string) => void;
    position?: 'top' | 'bottom';
    excludeBehavioralAndPatterns?: boolean;
  }> = ({ value, onChange, position = 'bottom', excludeBehavioralAndPatterns = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');

    const baseGroups = useMemo(() => {
      if (!excludeBehavioralAndPatterns) return INDICATOR_GROUPS;

      const filtered = INDICATOR_GROUPS.filter(
        (g: IndicatorGroup) => g.name !== 'Behavioral & Journal' && g.name !== 'Price / Price Action / Patterns'
      );
      
      const priceGroup: IndicatorGroup = {
        name: 'Price',
        items: [
          { id: 'close', name: 'Close Price', needsPeriod: false, isPrice: true },
          { id: 'open', name: 'Open Price', needsPeriod: false, isPrice: true },
          { id: 'high', name: 'High Price', needsPeriod: false, isPrice: true },
          { id: 'low', name: 'Low Price', needsPeriod: false, isPrice: true }
        ]
      };

      return [...filtered, priceGroup];
    }, [excludeBehavioralAndPatterns]);

    const selectedItem = useMemo(() => {
      const id = value.includes(':') ? value.split(':')[1] : value;
      return baseGroups.flatMap((g: IndicatorGroup) => g.items).find((item: IndicatorItem) => item.id === id);
    }, [value, baseGroups]);

    const filteredGroups = useMemo(() => {
      const query = search.toLowerCase().trim();
      if (!query) return baseGroups;
      return baseGroups.map((group: IndicatorGroup) => ({
        ...group,
        items: group.items.filter((item: IndicatorItem) => 
          item.name.toLowerCase().includes(query) || 
          item.id.toLowerCase().includes(query)
        )
      })).filter((group: IndicatorGroup) => group.items.length > 0);
    }, [search, baseGroups]);

    return (
      <div className="relative flex-1 min-w-[160px]">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full flex items-center justify-between gap-2 bg-slate-950/50 border ${
            isOpen ? 'border-indigo-500 ring-1 ring-indigo-500/20' : 'border-slate-800/80'
          } rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-900/50 hover:border-slate-700/50 focus:outline-none`}
        >
          <span className="truncate">{selectedItem ? selectedItem.name : 'Select Indicator...'}</span>
          <ChevronDown size={14} className={`text-slate-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {isOpen && (
            <>
              <div className="fixed inset-0 z-[110]" onClick={() => { setIsOpen(false); setSearch(''); }} />
              <motion.div
                initial={{ opacity: 0, y: position === 'bottom' ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: position === 'bottom' ? 4 : -4 }}
                className={`absolute z-[120] ${
                  position === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
                } w-[300px] bg-slate-950 border border-slate-800 rounded-xl shadow-2xl backdrop-blur-xl flex flex-col`}
              >
                <div className="p-2 border-b border-slate-800/80 flex items-center gap-2">
                  <Search size={14} className="text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search indicators..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-transparent border-0 outline-none text-xs text-white placeholder-slate-600 py-1 focus:ring-0 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div className="max-h-60 overflow-y-auto custom-scrollbar p-1.5 space-y-3">
                  {filteredGroups.length === 0 ? (
                    <div className="text-center py-4 text-slate-600 text-xs font-medium">No matches found</div>
                  ) : (
                    filteredGroups.map((group: IndicatorGroup) => (
                      <div key={group.name} className="space-y-1">
                        <div className="text-[9px] font-bold text-indigo-400/80 uppercase tracking-wider px-2 py-0.5 border-b border-slate-850">
                          {group.name}
                        </div>
                        <div className="space-y-0.5">
                          {group.items.map((item: IndicatorItem) => {
                            let type = 'INDICATOR';
                            if (item.isPrice) type = 'PRICE';
                            else if ((item as any).isPattern) type = 'PATTERN';
                            else if ((item as any).isBehavioral) type = 'BEHAVIORAL';
                            
                            const itemValue = excludeBehavioralAndPatterns ? item.id : `${type}:${item.id}`;
                            const isSelected = excludeBehavioralAndPatterns 
                              ? value === item.id 
                              : (value === itemValue || value.split(':')[1] === item.id);

                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  onChange(type, item.id);
                                  setIsOpen(false);
                                  setSearch('');
                                }}
                                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-colors text-left ${
                                  isSelected 
                                    ? 'bg-indigo-600 text-white font-semibold' 
                                    : 'text-slate-300 hover:bg-slate-850 hover:text-white'
                                }`}
                              >
                                <span className="truncate">{item.name}</span>
                                {isSelected && <Check size={12} className="text-white" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const OperatorDropdown: React.FC<{
    value: string;
    onChange: (val: string) => void;
    options: { id: string; name: string }[];
    position?: 'top' | 'bottom';
  }> = ({ value, onChange, options, position = 'bottom' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selected = options.find(o => o.id === value) || options[0];

    return (
      <div className="relative w-28 shrink-0">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full flex items-center justify-between gap-1 bg-slate-950/50 border ${
            isOpen ? 'border-indigo-500 ring-1 ring-indigo-500/20' : 'border-slate-800/80'
          } rounded-xl px-3 py-2.5 text-xs font-semibold text-indigo-400 transition-all hover:bg-slate-900/50 hover:border-slate-700/50 focus:outline-none`}
        >
          <span className="truncate">{selected ? selected.name : 'Operator'}</span>
          <ChevronDown size={14} className="text-slate-500 shrink-0" />
        </button>

        <AnimatePresence>
          {isOpen && (
            <>
              <div className="fixed inset-0 z-[110]" onClick={() => setIsOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: position === 'bottom' ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: position === 'bottom' ? 4 : -4 }}
                className={`absolute z-[120] ${
                  position === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
                } w-full bg-slate-950 border border-slate-800 rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden`}
              >
                <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                  {options.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        onChange(opt.id);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors text-left ${
                        value === opt.id 
                          ? 'bg-indigo-650 text-white font-semibold' 
                          : 'text-slate-300 hover:bg-slate-850 hover:text-white'
                      }`}
                    >
                      <span className="truncate">{opt.name}</span>
                      {value === opt.id && <Check size={12} className="text-white" />}
                    </button>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="glass-panel rounded-2xl p-5 flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-500/10 rounded-lg">
            <Settings2 className="text-indigo-400" size={16} />
          </div>
          <div>
            <h2 className="text-sm font-black text-white uppercase tracking-tight">Configuration</h2>
          </div>
        </div>
        <div className="flex gap-1.5 items-center">
          <div className="w-32">
            <CustomDropdown
              placeholder="Templates"
              value=""
              onChange={(val) => applyTemplate(val)}
              options={[
                { id: 'ORB_FLAGSHIP_CERTIFIED', name: 'ORB Flagship 3-Slot (Certified 🏆)' },
                { id: 'SNAP_CALIBRATED', name: 'SNAP 34/2.5 Pullback (Calibrated 🎯)' },
                { id: 'DUEL_BREAKOUT_950', name: '9:50 Breakout Duel (🏆)' },
                { id: 'CAPITAL_PRESERVATION', name: 'Capital Guard (⭐)' },
                { id: 'MONDAY_EXPLOITER', name: 'Mon Exploiter (⭐⭐)' },
                { id: 'MOMENTUM', name: 'Momentum Sniper (⭐⭐)' },
                { id: 'ORB_BREAKOUT', name: 'ORB Breakout (⭐⭐⭐)' },
                { id: 'PSYCH_GUARD', name: 'Psych Guard (⭐⭐⭐)' },
                { id: 'STREAK_RECOVERY', name: 'Streak Recovery (⭐⭐⭐)' },
                { id: 'OPTIONS_HARVESTER', name: 'Options Harvest (⭐⭐⭐⭐)' }
              ]}
            />
          </div>
          <button type="button" onClick={loadStrategy} className="text-[9px] font-black text-slate-400 hover:text-white uppercase tracking-widest px-2 py-2 h-[34px] rounded-xl bg-slate-800/50 transition-colors">Load</button>
          <button type="button" onClick={saveStrategy} className="text-[9px] font-black text-indigo-400 hover:text-white uppercase tracking-widest px-2 py-2 h-[34px] rounded-xl bg-indigo-500/10 border border-indigo-500/20 transition-colors">Save</button>
        </div>
      </div>

      <div className="space-y-5 flex-1 pr-1">

        {/* Screener Mode Toggle */}
        <div className="flex items-center justify-between bg-slate-950/20 px-4 py-3 rounded-2xl border border-slate-800/40 mb-2">
          <span className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Layers size={14} className="text-indigo-400" /> Screener Mode (Multi-Symbol)
          </span>
          <button
            type="button"
            onClick={() => setIsScreenerMode(!isScreenerMode)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              isScreenerMode ? 'bg-indigo-600' : 'bg-slate-800'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                isScreenerMode ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Simulation Engine Mode Toggle */}
        {!isScreenerMode && (
          <div className="bg-slate-950/20 px-4 py-3 rounded-2xl border border-slate-800/40 mb-2">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                <Database size={14} className="text-indigo-400" /> Simulation Engine Mode
              </span>
              <div className="flex bg-slate-900 border border-slate-800/60 p-0.5 rounded-xl">
                <button
                  type="button"
                  onClick={() => setSimulationMode('history')}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                    simulationMode === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-white'
                  }`}
                >
                  Trade History
                </button>
                <button
                  type="button"
                  onClick={() => setSimulationMode('market')}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                    simulationMode === 'market' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-white'
                  }`}
                >
                  Market Sim 2.0
                </button>
              </div>
            </div>
            <p className="text-[9px] text-slate-500 font-bold leading-normal uppercase">
              {simulationMode === 'history'
                ? 'Analyzes trade logs imported from your broker (Dhan API).'
                : 'Replays historical Parquet candles bar-by-bar and executes your strategy conditions.'}
            </p>
          </div>
        )}

        {/* Market Simulation Settings */}
        {simulationMode === 'market' && !isScreenerMode && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-950/20 p-4 rounded-2xl border border-slate-800/40">
            <div>
              <label className="block text-[8px] font-black text-slate-500 uppercase tracking-[0.3em] mb-1.5 px-1">From Date</label>
              <input
                type="date"
                value={marketSimDateRange.from}
                onChange={(e) => setMarketSimDateRange(prev => ({ ...prev, from: e.target.value }))}
                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-[10px] font-black text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[8px] font-black text-slate-500 uppercase tracking-[0.3em] mb-1.5 px-1">To Date</label>
              <input
                type="date"
                value={marketSimDateRange.to}
                onChange={(e) => setMarketSimDateRange(prev => ({ ...prev, to: e.target.value }))}
                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-[10px] font-black text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <CustomDropdown
              label="Interval"
              value={marketSimInterval}
              onChange={(val) => setMarketSimInterval(val)}
              options={[
                { id: 'day', name: '1 Day (Daily)', icon: BarChart3 },
                { id: '5minute', name: '5 Minute', icon: Clock },
                { id: '1minute', name: '1 Minute', icon: Clock }
              ]}
            />
          </div>
        )}

        {/* Basic Settings */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CustomDropdown
            label="Asset Class"
            value={strategy.assetClass}
            onChange={(val) => setStrategy((s: StrategyDefinition) => ({ ...s, assetClass: val as any, legs: val === 'Options' ? s.legs || [] : undefined }))}
            options={[
              { id: 'Equity', name: 'Equity', icon: BarChart3 },
              { id: 'Options', name: 'Options', icon: Zap }
            ]}
          />

          {isScreenerMode ? (
            <div>
              <CustomDropdown
                label="Screener Universe"
                value={screenerUniverse}
                onChange={(val) => setScreenerUniverse(val as any)}
                options={[
                  { id: 'indices', name: 'Indices', icon: Target },
                  { id: 'all', name: 'All F&O Stocks', icon: Grid },
                  { id: 'custom', name: 'Custom List', icon: Settings2 }
                ]}
              />
              {screenerUniverse === 'custom' && (
                <input
                  type="text"
                  placeholder="e.g. INFY,RELIANCE"
                  value={customSymbols}
                  onChange={(e) => setCustomSymbols(e.target.value)}
                  className="w-full mt-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-[10px] font-black text-white uppercase placeholder-slate-755 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              )}
            </div>
          ) : (
            <div>
              <CustomDropdown
                label="Target Symbol"
                value={tickerOption}
                onChange={handleTickerOptionChange}
                options={[
                  { id: 'NIFTY', name: 'NIFTY 50', icon: Target },
                  { id: 'BANKNIFTY', name: 'BANKNIFTY', icon: Target },
                  { id: 'FINNIFTY', name: 'FINNIFTY', icon: Target },
                  { id: 'MIDCPNIFTY', name: 'MIDCPNIFTY', icon: Target },
                  { id: 'RELIANCE', name: 'RELIANCE', icon: BarChart3 },
                  { id: 'TCS', name: 'TCS', icon: BarChart3 },
                  { id: 'HDFCBANK', name: 'HDFCBANK', icon: BarChart3 },
                  { id: 'CUSTOM', name: 'Custom Input...', icon: Settings2 }
                ]}
              />
              {tickerOption === 'CUSTOM' && (
                <input
                  type="text"
                  placeholder="Enter symbol (e.g. SBIN)"
                  value={customTicker}
                  onChange={(e) => handleCustomTickerChange(e.target.value)}
                  className="w-full mt-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-[10px] font-black text-white uppercase placeholder-slate-700 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              )}
            </div>
          )}

          <div className="bg-slate-950/40 p-3 rounded-2xl border border-slate-800/40 space-y-1.5 flex flex-col justify-center">
            <label className="block text-[8px] font-black text-slate-500 uppercase tracking-[0.3em] mb-1.5 px-1">Initial Capital</label>
            <div className="relative">
              <input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(Number(e.target.value))}
                className="w-full bg-transparent border-none px-1 py-0.5 text-xl font-black text-white focus:outline-none transition-all placeholder:text-slate-800"
              />
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-600 uppercase">INR</span>
            </div>
          </div>
        </div>

        {/* Data Source Status Badge */}
        {isScreenerMode ? (
          <div className="p-4 rounded-[1.5rem] border bg-indigo-500/5 border-indigo-500/10 text-indigo-400 flex items-start gap-3 backdrop-blur-sm shadow-md">
            <div className="p-2 rounded-xl bg-indigo-500/10">
              <Database size={14} className="text-indigo-400" />
            </div>
            <div className="flex-1">
              <span className="text-[9px] font-black uppercase tracking-widest block">
                📡 MULTI-SYMBOL SCREENER MODE ENABLED
              </span>
              <span className="text-[10px] font-bold text-slate-400 leading-normal block mt-1">
                Running strategy against all symbols in target universe using Python bridge Parquet vault. Manage sync state in Vault tab.
              </span>
            </div>
          </div>
        ) : (
          <div className={`p-4 rounded-[1.5rem] border ${hasData ? 'bg-indigo-500/5 border-indigo-500/10 text-indigo-400' : 'bg-amber-500/5 border-amber-500/10 text-amber-400'} flex items-start gap-3 backdrop-blur-sm shadow-md`}>
            <div className={`p-2 rounded-xl ${hasData ? 'bg-indigo-500/10' : 'bg-amber-500/10'}`}>
              <Database size={14} className={hasData ? 'text-indigo-400' : 'text-amber-400'} />
            </div>
            <div className="flex-1">
              <span className="text-[9px] font-black uppercase tracking-widest block">
                {hasData ? '📡 DATA SOURCE: Upstox Live (Local Cache)' : '⚠️ NO MARKET DATA FOUND'}
              </span>
              <span className="text-[10px] font-bold text-slate-400 leading-normal block mt-1">
                {hasData 
                  ? `Cached ${strategy.assetClass} data for ${UpstoxBacktestDataService.getStrategySymbol(strategy)} (Last Date: ${lastFetched || 'unknown'})` 
                  : `No local F&O or Equity data found for ${UpstoxBacktestDataService.getStrategySymbol(strategy)}. Go to the Data Vault tab to pull live data from Upstox.`
                }
              </span>
            </div>
          </div>
        )}

        {/* Position Sizing */}
        <div className="glass-panel p-5 rounded-2xl space-y-4">
          <div className="flex justify-between items-center px-1">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">Sizing & Exposure</label>
            <Shield size={14} className="text-indigo-400" />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <CustomDropdown
                value={strategy.positionSizing.type}
                onChange={(val) => setStrategy((s: StrategyDefinition) => ({ ...s, positionSizing: { ...s.positionSizing, type: val as PositionSizingType } }))}
                options={[
                  { id: 'PERCENT_OF_CAPITAL', name: '% of Capital', icon: BarChart3 },
                  { id: 'FIXED_RISK_AMOUNT', name: 'Fixed Risk (₹)', icon: Shield },
                  { id: 'FIXED_QUANTITY', name: 'Fixed Qty', icon: Target },
                  { id: 'KELLY', name: 'Kelly Criterion', icon: Brain }
                ]}
              />
            </div>
            <input
              type="number"
              placeholder="Value"
              value={strategy.positionSizing.value}
              onChange={(e) => setStrategy((s: StrategyDefinition) => ({ ...s, positionSizing: { ...s.positionSizing, value: Number(e.target.value) } }))}
              className="w-24 bg-slate-950/50 border border-slate-800/80 rounded-xl px-4 py-2.5 text-xs font-bold text-white text-center focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>
          <div className="flex items-center gap-3 pt-3 border-t border-slate-800/50">
             <div className="flex-1">
                <p className="text-xs font-semibold text-slate-400 tracking-wider mb-1 px-1">Max Capital Guard</p>
                <input
                  type="number"
                  placeholder="Unlimited Exposure"
                  value={strategy.positionSizing.maxExposure || ''}
                  onChange={(e) => setStrategy((s: StrategyDefinition) => ({ ...s, positionSizing: { ...s.positionSizing, maxExposure: Number(e.target.value) || undefined } }))}
                  className="w-full bg-slate-950/40 border border-slate-800/80 rounded-xl px-4 py-2 text-xs font-semibold text-indigo-400 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
             </div>
             <div className="h-8 w-[1px] bg-slate-800 mt-5" />
             <div className="text-right px-2 mt-5">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Limit</p>
                <p className="text-xs font-black text-slate-400 uppercase">₹</p>
             </div>
          </div>
        </div>

        {/* Options Legs Builder */}
        {strategy.assetClass === 'Options' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center px-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                Legs
              </label>
              <button
                type="button"
                onClick={() => setStrategy((s: StrategyDefinition) => ({ ...s, legs: [...(s.legs || []), { id: Math.random().toString(), type: 'CE', action: 'SELL', strikeSelection: 'ATM', strikeOffset: 0, quantityMultiplier: 1 }] }))}
                className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors"
              >
                <Plus size={12} /> Add Leg
              </button>
            </div>

            <div className="space-y-3">
              {strategy.legs?.map((leg: OptionLeg) => (
                <div key={leg.id} className="glass-panel p-4 rounded-xl space-y-3 relative">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Buy/Sell Segmented Control */}
                    <div className="flex bg-slate-950/60 p-0.5 rounded-xl border border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => setStrategy((s: StrategyDefinition) => ({ ...s, legs: s.legs?.map((l: OptionLeg) => l.id === leg.id ? { ...l, action: 'BUY' } : l) }))}
                        className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                          leg.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-450'
                        }`}
                      >
                        Buy
                      </button>
                      <button
                        type="button"
                        onClick={() => setStrategy((s: StrategyDefinition) => ({ ...s, legs: s.legs?.map((l: OptionLeg) => l.id === leg.id ? { ...l, action: 'SELL' } : l) }))}
                        className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                          leg.action === 'SELL' ? 'bg-rose-500/20 text-rose-450 border border-rose-500/30' : 'text-slate-450'
                        }`}
                      >
                        Sell
                      </button>
                    </div>

                    {/* CE/PE Segmented Control */}
                    <div className="flex bg-slate-950/60 p-0.5 rounded-xl border border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => setStrategy((s: StrategyDefinition) => ({ ...s, legs: s.legs?.map((l: OptionLeg) => l.id === leg.id ? { ...l, type: 'CE' } : l) }))}
                        className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                          leg.type === 'CE' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-450'
                        }`}
                      >
                        CE
                      </button>
                      <button
                        type="button"
                        onClick={() => setStrategy((s: StrategyDefinition) => ({ ...s, legs: s.legs?.map((l: OptionLeg) => l.id === leg.id ? { ...l, type: 'PE' } : l) }))}
                        className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                          leg.type === 'PE' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-slate-450'
                        }`}
                      >
                        PE
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Strike Selection Segmented Control */}
                    <div className="flex bg-slate-950/60 p-0.5 rounded-xl border border-slate-800/80 flex-1">
                      {['ATM', 'OTM', 'ITM'].map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setStrategy((s: StrategyDefinition) => ({ ...s, legs: s.legs?.map((l: OptionLeg) => l.id === leg.id ? { ...l, strikeSelection: st as any } : l) }))}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            leg.strikeSelection === st ? 'bg-slate-800 text-white font-bold' : 'text-slate-400'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>

                    <input
                      type="number"
                      placeholder="Offset"
                      value={leg.strikeOffset}
                      onChange={(e) => setStrategy((s: StrategyDefinition) => ({ ...s, legs: s.legs?.map((l: OptionLeg) => l.id === leg.id ? { ...l, strikeOffset: Number(e.target.value) } : l) }))}
                      className="w-16 bg-slate-950/50 border border-slate-800/80 rounded-xl px-2 py-1.5 text-xs font-bold text-white text-center focus:outline-none focus:border-indigo-500"
                    />

                    <button
                      type="button"
                      onClick={() => setStrategy((s: StrategyDefinition) => ({ ...s, legs: s.legs?.filter((l: OptionLeg) => l.id !== leg.id) }))}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 border border-slate-805 text-slate-500 hover:text-rose-500 hover:border-rose-500/30 transition-all duration-200"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Entry Rules */}
        <div className="space-y-4">
          <div className="flex justify-between items-center px-1">
            <div className="flex flex-col">
              <label className="text-[10px] font-black text-white uppercase tracking-[0.3em] flex items-center gap-2">
                <Zap size={10} className="text-amber-400 fill-amber-400" /> Entry Pipeline
              </label>
              <p className="text-[7px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Filters & Technical Logic</p>
            </div>
            <button
              type="button"
              onClick={addEntryRule}
              className="px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5"
            >
              <Plus size={10} /> Add Condition
            </button>
          </div>

          {(() => {
            const getRuleSummary = (r: IndicatorCondition) => {
              let leftLabel = '';
              const leftMatch = (INDICATOR_GROUPS.flatMap(g => g.items) as IndicatorItem[]).find(item => item.id === r.leftIndicator);
              if (leftMatch) {
                leftLabel = leftMatch.id.toUpperCase();
                if (r.leftPeriod) leftLabel += `(${r.leftPeriod})`;
              } else {
                leftLabel = (r.leftIndicator || '').toUpperCase();
              }

              let opLabel: string = r.operator;
              if (r.operator === 'GREATER_THAN') opLabel = '>';
              else if (r.operator === 'LESS_THAN') opLabel = '<';
              else if (r.operator === 'GREATER_EQUAL') opLabel = '>=';
              else if (r.operator === 'LESS_EQUAL') opLabel = '<=';
              else if (r.operator === 'EQUALS') opLabel = '=';
              else if (r.operator === 'NOT_EQUALS') opLabel = '!=';
              else if (r.operator === 'CROSSES_ABOVE') opLabel = '⊗';
              else if (r.operator === 'CROSSES_BELOW') opLabel = '⊖';
              else if (r.operator === 'IS_TRUE') opLabel = 'is True';
              else if (r.operator === 'BETWEEN') opLabel = 'Between';

              let rightLabel = '';
              if (r.operator !== 'IS_TRUE') {
                if (r.rightType === 'VALUE') {
                  if (r.operator === 'BETWEEN') {
                    rightLabel = `${r.rightValue} AND ${r.rightValueHigh}`;
                  } else {
                    rightLabel = String(r.rightValue !== undefined ? r.rightValue : '');
                  }
                } else {
                  const rightMatch = (INDICATOR_GROUPS.flatMap(g => g.items) as IndicatorItem[]).find(item => item.id === r.rightIndicator);
                  if (rightMatch) {
                    rightLabel = rightMatch.id.toUpperCase();
                    if (r.rightPeriod) rightLabel += `(${r.rightPeriod})`;
                  } else {
                    rightLabel = String(r.rightIndicator || '').toUpperCase();
                  }
                }
              }

              return `${leftLabel} ${opLabel} ${rightLabel}`.trim();
            };

            const getOperatorOptions = (r: IndicatorCondition) => {
              if (r.leftType === 'PATTERN') {
                return [{ id: 'IS_TRUE', name: 'Is Active / True' }];
              }
              if (r.leftIndicator === 'direction' || r.leftIndicator === 'mood' || r.leftIndicator === 'dayOfWeek') {
                return [
                  { id: 'EQUALS', name: 'Is' },
                  { id: 'NOT_EQUALS', name: 'Is Not' }
                ];
              }
              return [
                { id: 'GREATER_THAN', name: '>' },
                { id: 'LESS_THAN', name: '<' },
                { id: 'GREATER_EQUAL', name: '>=' },
                { id: 'LESS_EQUAL', name: '<=' },
                { id: 'EQUALS', name: '=' },
                { id: 'NOT_EQUALS', name: '!=' },
                { id: 'CROSSES_ABOVE', name: 'Crosses Above' },
                { id: 'CROSSES_BELOW', name: 'Crosses Below' },
                { id: 'BETWEEN', name: 'Between' }
              ];
            };

            return (
              <>
                {/* Entry rule visual chips */}
                {strategy.entryRules.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-1 mb-2">
                    {strategy.entryRules.map(r => {
                      let icon = '🔧';
                      if (r.leftType === 'BEHAVIORAL') {
                        if (r.leftIndicator === 'timeOfDay') icon = '⏰';
                        else if (r.leftIndicator === 'dayOfWeek') icon = '📅';
                        else if (r.leftIndicator === 'direction') icon = '🎯';
                        else if (r.leftIndicator === 'consecutiveLosses') icon = '📊';
                        else if (r.leftIndicator === 'mood') icon = '🧠';
                        else if (r.leftIndicator === 'mistake') icon = '⚠️';
                      } else if (r.leftType === 'PATTERN') {
                        icon = '🕯️';
                      } else {
                        icon = '📈';
                      }
                      const label = getRuleSummary(r);
                      return (
                        <span key={r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full text-[9px] font-black uppercase tracking-wider shadow-sm">
                          <span>{icon}</span> {label}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-4">
                  {strategy.entryRules.map((rule, idx) => {
                    let leftNeedsPeriod = false;
                    for (const group of INDICATOR_GROUPS) {
                      const match = group.items.find(item => item.id === rule.leftIndicator);
                      if (match) {
                        leftNeedsPeriod = !!(match as any).needsPeriod;
                        break;
                      }
                    }

                    let rightNeedsPeriod = false;
                    if (rule.rightIndicator) {
                      for (const group of INDICATOR_GROUPS) {
                        const match = group.items.find(item => item.id === rule.rightIndicator);
                        if (match) {
                          rightNeedsPeriod = !!(match as any).needsPeriod;
                          break;
                        }
                      }
                    }

                    const showRightSide = rule.operator !== 'IS_TRUE';
                    const showRightTypeToggle = showRightSide && rule.leftType !== 'BEHAVIORAL' && rule.operator !== 'BETWEEN';

                    return (
                      <div key={rule.id} className="relative glass-panel rounded-2xl p-4 transition-all hover:border-indigo-500/30 group space-y-4">
                        {/* Condition Header Logic / Trash */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {idx > 0 ? (
                              <button
                                type="button"
                                onClick={() => updateEntryRule(rule.id, { logic: rule.logic === 'AND' ? 'OR' : 'AND' })}
                                className="bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 text-indigo-400 rounded-lg px-2.5 py-1 text-xs font-bold transition-all uppercase tracking-wider"
                              >
                                {rule.logic}
                              </button>
                            ) : (
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">Start Condition</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeEntryRule(rule.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-900 border border-slate-800/80 text-slate-500 hover:text-rose-500 hover:border-rose-500/30 transition-all duration-200"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        {/* Interactive Condition Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-3">
                          {/* Left Indicator & Period Input */}
                          <div className="flex items-center gap-2 min-w-0">
                            <IndicatorDropdown
                              value={`${rule.leftType}:${rule.leftIndicator}`}
                              position="top"
                              onChange={(type, id) => {
                                let needsPeriod = false;
                                let isPattern = false;
                                for (const group of INDICATOR_GROUPS) {
                                  const match = group.items.find(item => item.id === id);
                                  if (match) {
                                    needsPeriod = !!(match as any).needsPeriod;
                                    isPattern = !!(match as any).isPattern;
                                    break;
                                  }
                                }
                                updateEntryRule(rule.id, {
                                  leftType: type as any,
                                  leftIndicator: id,
                                  leftPeriod: needsPeriod ? 14 : undefined,
                                  operator: isPattern ? 'IS_TRUE' : 'GREATER_THAN',
                                  rightType: 'VALUE',
                                  rightValue: undefined,
                                  rightValueHigh: undefined,
                                  rightIndicator: undefined,
                                  rightPeriod: undefined
                                });
                              }}
                            />
                            {leftNeedsPeriod && (
                              <input
                                type="number"
                                placeholder="Period"
                                value={rule.leftPeriod || ''}
                                onChange={(e) => updateEntryRule(rule.id, { leftPeriod: Number(e.target.value) || undefined })}
                                className="w-16 bg-slate-950/50 border border-slate-800/80 rounded-xl px-3 py-2.5 text-xs font-semibold text-center text-white focus:outline-none focus:border-indigo-500"
                              />
                            )}
                          </div>

                          {/* Operator Selector */}
                          <OperatorDropdown
                            value={rule.operator}
                            position="top"
                            onChange={(val) => updateEntryRule(rule.id, { operator: val as any })}
                            options={getOperatorOptions(rule)}
                          />

                          {/* Right Side Options */}
                          {showRightSide && (
                            <div className="flex items-center gap-2 w-full min-w-0">
                              {showRightTypeToggle && (
                                <button
                                  type="button"
                                  onClick={() => updateEntryRule(rule.id, { 
                                    rightType: rule.rightType === 'VALUE' ? 'INDICATOR' : 'VALUE',
                                    rightValue: undefined,
                                    rightIndicator: rule.rightType === 'VALUE' ? 'sma' : undefined,
                                    rightPeriod: rule.rightType === 'VALUE' ? 20 : undefined
                                  })}
                                  className={`border rounded-xl px-3 py-2.5 text-xs font-semibold transition-all shrink-0 ${
                                    rule.rightType === 'VALUE' 
                                      ? 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:text-slate-300' 
                                      : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                                  }`}
                                >
                                  {rule.rightType === 'VALUE' ? 'Value' : 'Indicator'}
                                </button>
                              )}

                              <div className="flex-1 flex items-center gap-2 min-w-0">
                                {rule.rightType === 'VALUE' ? (
                                  rule.operator === 'BETWEEN' ? (
                                    <div className="flex items-center gap-1.5 w-full">
                                      <input
                                        type="number"
                                        placeholder="Min"
                                        value={rule.rightValue !== undefined ? rule.rightValue : ''}
                                        onChange={(e) => updateEntryRule(rule.id, { rightValue: Number(e.target.value) })}
                                        className="w-1/2 bg-slate-950/50 border border-slate-800/80 rounded-xl px-3 py-2 text-xs font-bold text-center text-white focus:outline-none focus:border-indigo-500"
                                      />
                                      <span className="text-[10px] font-bold text-slate-500 uppercase">And</span>
                                      <input
                                        type="number"
                                        placeholder="Max"
                                        value={rule.rightValueHigh !== undefined ? rule.rightValueHigh : ''}
                                        onChange={(e) => updateEntryRule(rule.id, { rightValueHigh: Number(e.target.value) })}
                                        className="w-1/2 bg-slate-950/50 border border-slate-800/80 rounded-xl px-3 py-2 text-xs font-bold text-center text-white focus:outline-none focus:border-indigo-500"
                                      />
                                    </div>
                                  ) : rule.leftIndicator === 'dayOfWeek' ? (
                                    <CustomDropdown
                                      value={String(rule.rightValue || '')}
                                      position="top"
                                      onChange={(val) => updateEntryRule(rule.id, { rightValue: val })}
                                      placeholder="Select Day"
                                      options={[
                                        { id: 'Monday', name: 'Monday' },
                                        { id: 'Tuesday', name: 'Tuesday' },
                                        { id: 'Wednesday', name: 'Wednesday' },
                                        { id: 'Thursday', name: 'Thursday' },
                                        { id: 'Friday', name: 'Friday' }
                                      ]}
                                    />
                                  ) : rule.leftIndicator === 'direction' ? (
                                    <CustomDropdown
                                      value={String(rule.rightValue || '')}
                                      position="top"
                                      onChange={(val) => updateEntryRule(rule.id, { rightValue: val })}
                                      placeholder="Select Direction"
                                      options={[
                                        { id: 'Long', name: 'Long' },
                                        { id: 'Short', name: 'Short' }
                                      ]}
                                    />
                                  ) : rule.leftIndicator === 'mood' ? (
                                    <CustomDropdown
                                      value={String(rule.rightValue || '')}
                                      position="top"
                                      onChange={(val) => updateEntryRule(rule.id, { rightValue: val })}
                                      placeholder="Select Mood"
                                      options={[
                                        { id: 'Excellent', name: 'Excellent' },
                                        { id: 'Good', name: 'Good' },
                                        { id: 'Neutral', name: 'Neutral' },
                                        { id: 'Poor', name: 'Poor' }
                                      ]}
                                    />
                                  ) : rule.leftIndicator === 'mistake' ? (
                                    <CustomDropdown
                                      value={String(rule.rightValue || '')}
                                      position="top"
                                      onChange={(val) => updateEntryRule(rule.id, { rightValue: val })}
                                      placeholder="Select Mistake"
                                      options={[
                                        { id: 'FOMO', name: 'FOMO' },
                                        { id: 'Revenge Trade', name: 'Revenge Trade' },
                                        { id: 'Early Exit', name: 'Early Exit' },
                                        { id: 'Overtrading', name: 'Overtrading' }
                                      ]}
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      placeholder={rule.leftIndicator === 'timeOfDay' ? 'e.g. 09:15' : 'Value'}
                                      value={rule.rightValue !== undefined ? rule.rightValue : ''}
                                      onChange={(e) => updateEntryRule(rule.id, { rightValue: e.target.value as any })}
                                      className="w-full bg-slate-950/50 border border-slate-800/80 rounded-xl px-4 py-2.5 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500 placeholder:text-slate-700"
                                    />
                                  )
                                ) : (
                                  <div className="flex items-center gap-2 w-full min-w-0">
                                    <IndicatorDropdown
                                      value={rule.rightIndicator || 'sma'}
                                      position="top"
                                      onChange={(type, id) => {
                                        let needsPeriod = false;
                                        for (const group of INDICATOR_GROUPS) {
                                          const match = group.items.find(item => item.id === id);
                                          if (match) {
                                            needsPeriod = !!(match as any).needsPeriod;
                                            break;
                                          }
                                        }
                                        updateEntryRule(rule.id, { rightIndicator: id, rightPeriod: needsPeriod ? 20 : undefined });
                                      }}
                                      excludeBehavioralAndPatterns={true}
                                    />
                                    {rightNeedsPeriod && (
                                      <input
                                        type="number"
                                        placeholder="Period"
                                        value={rule.rightPeriod || ''}
                                        onChange={(e) => updateEntryRule(rule.id, { rightPeriod: Number(e.target.value) || undefined })}
                                        className="w-16 bg-slate-950/50 border border-slate-800/80 rounded-xl px-3 py-2.5 text-xs font-semibold text-center text-white focus:outline-none focus:border-indigo-500"
                                      />
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>

        {/* Exit Rules */}
        <div className="space-y-4">
          <div className="flex justify-between items-center px-1">
            <div className="flex flex-col">
              <label className="text-[10px] font-black text-white uppercase tracking-[0.3em] flex items-center gap-2">
                <Shield size={10} className="text-emerald-400" /> Risk Protocols
              </label>
              <p className="text-[7px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Execution & Exit Logic</p>
            </div>
            <button
              type="button"
              onClick={addExitRule}
              className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <Plus size={12} /> Add Protocol
            </button>
          </div>

          <div className="space-y-3">
            {strategy.exitRules.map(rule => (
              <div key={rule.id} className="relative glass-panel rounded-2xl p-4 transition-all hover:border-emerald-500/30 group">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <CustomDropdown
                      value={rule.type}
                      position="top"
                      onChange={(val) => updateExitRule(rule.id, { 
                        type: val as any,
                        unit: (val === 'TIME_BASED' || val === 'END_OF_DAY') ? 'TIME' : (rule.unit === 'TIME' ? 'PERCENT' : rule.unit)
                      })}
                      options={[
                        { id: 'FIXED_STOP_LOSS', name: 'Stop Loss', icon: Shield },
                        { id: 'FIXED_TARGET', name: 'Take Profit', icon: Target },
                        { id: 'TRAILING_STOP', name: 'Trailing SL', icon: RefreshCw },
                        { id: 'TIME_BASED', name: 'Time Exit', icon: Clock },
                        { id: 'END_OF_DAY', name: 'Market Close', icon: AlertCircle }
                      ]}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeExitRule(rule.id)}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-900 border border-slate-800/80 text-slate-500 hover:text-rose-500 hover:border-rose-500/30 transition-all duration-200"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {(rule.type !== 'END_OF_DAY') && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type={rule.unit === 'TIME' ? 'text' : 'number'}
                      placeholder={rule.unit === 'TIME' ? 'HH:MM' : 'Exit Value'}
                      value={rule.value as any}
                      onChange={(e) => updateExitRule(rule.id, { value: e.target.value })}
                      className="flex-1 bg-slate-950/50 border border-slate-800/80 rounded-xl px-4 py-2.5 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
                    />

                    {rule.unit !== 'TIME' && (
                      <div className="flex bg-slate-950/60 p-0.5 rounded-xl border border-slate-800/80 w-20 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateExitRule(rule.id, { unit: 'PERCENT' })}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            rule.unit === 'PERCENT' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-400'
                          }`}
                        >
                          %
                        </button>
                        <button
                          type="button"
                          onClick={() => updateExitRule(rule.id, { unit: 'ABSOLUTE' })}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            rule.unit === 'ABSOLUTE' ? 'bg-emerald-500/20 text-emerald-450 border border-emerald-500/30' : 'text-slate-400'
                          }`}
                        >
                          ₹
                        </button>
                      </div>
                    )}
                    {rule.unit === 'TIME' && (
                      <div className="px-3 text-xs font-bold text-slate-500 uppercase tracking-wider shrink-0">IST</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>

      <div className="mt-5 pt-5 border-t border-slate-800/60 space-y-4">
        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-indigo-650 hover:bg-indigo-550 text-white font-bold uppercase tracking-wider text-xs py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-500/20"
        >
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <Play size={13} fill="currentColor" /> {isScreenerMode ? 'Run Screener Engine' : 'Run Simulation'}
            </>
          )}
        </button>

        {/* Sanity Check Row */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-slate-950/40 rounded-xl border border-slate-850 text-xs">
          <div className="text-center">
            <span className="text-slate-500 uppercase font-bold block text-[9px] tracking-wider mb-0.5">Est. Trades/Yr</span>
            <span className="text-indigo-400 font-bold text-sm">{sanityCheck.estTrades}</span>
          </div>
          <div className="text-center border-x border-slate-850">
            <span className="text-slate-500 uppercase font-bold block text-[9px] tracking-wider mb-0.5">Capital at Risk</span>
            <span className="text-rose-450 font-bold text-sm">{formatCurrency(sanityCheck.capAtRisk)}</span>
          </div>
          <div className="text-center">
            <span className="text-slate-500 uppercase font-bold block text-[9px] tracking-wider mb-0.5">Avg Hold Days</span>
            <span className="text-emerald-450 font-bold text-sm">
              {sanityCheck.avgHoldingDays === 0.1 ? 'Intraday (0.1d)' : `${sanityCheck.avgHoldingDays}d`}
            </span>
          </div>
        </div>
      </div>
    </form>
  );
};
