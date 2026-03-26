import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Search,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BarChart2,
  PieChart,
  Activity,
  Info,
  Calendar,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Database,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { FiiDiiFlowsItem, ParticipantOiItem, DerivativeSummaryItem } from '../../../services/alpha/ShadowScreenerService';
import { formatCurrency, formatNumberIndian, formatCurrencyPrecise } from '../../../utils/helpers';
import { Tabs } from '../../ui/AnimatedTabs';
import { ActionButton } from '../../ui/ActionButton';

interface FiiDiiPulseDashboardProps {
  pulseData: FiiDiiFlowsItem[];
  oiData: ParticipantOiItem[];
  summaryData: DerivativeSummaryItem[];
  isLoading: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onManualPaste?: (jsonText: string) => { success: boolean; message: string; sectionsUpdated: string[] };
}

export const FiiDiiPulseDashboard: React.FC<FiiDiiPulseDashboardProps> = ({
  pulseData,
  oiData,
  summaryData,
  isLoading,
  onRefresh,
  onBack,
  onManualPaste
}) => {
  const safePulseData = useMemo(() => {
    return Array.isArray(pulseData)
      ? [...pulseData]
        .filter(item => item && typeof item === 'object' && item.date)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      : [];
  }, [pulseData]);

  const safeOiData = useMemo(() => {
    return Array.isArray(oiData)
      ? [...oiData]
        .filter(item => item && typeof item === 'object' && item.client_type)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      : [];
  }, [oiData]);

  const safeSummaryData = useMemo(() => {
    return Array.isArray(summaryData)
      ? summaryData.filter(item => item && typeof item === 'object' && item.symbol_name)
      : [];
  }, [summaryData]);

  const checkHasData = (item: FiiDiiFlowsItem | null) => {
    if (!item) return false;
    const hasCash = Array.isArray(item.fii_cash) && item.fii_cash.length > 0;
    const hasOi = Array.isArray(item.fii_oi) && item.fii_oi.length > 0;
    return hasCash || hasOi;
  };

  const getCardSentiment = (fiiCash: number, fiiIndexFut: number) => {
    let score = 0;
    if (fiiCash > 0) score += 1;
    else if (fiiCash < 0) score -= 1;
    if (fiiIndexFut > 0) score += 1;
    else if (fiiIndexFut < 0) score -= 1;

    if (score >= 1) return { text: 'BULLISH', score };
    if (score <= -1) return { text: 'BEARISH', score };
    return { text: 'SIDEWAYS', score };
  };

  const getCardCommentary = (fiiCash: number, fiiIndexFut: number, hasData: boolean) => {
    if (!hasData) return 'No institutional flows are reported for this session.';
    if (fiiCash > 1000 && fiiIndexFut > 500) {
      return 'Strong institutional buying pressure observed across cash and index futures.';
    }
    if (fiiCash < -1000 && fiiIndexFut < -500) {
      return 'Heavy institutional selling pressure visible in cash and derivative segments.';
    }
    if (fiiCash > 0 && fiiIndexFut > 0) {
      return 'FIIs are net buyers, indicating supportive market sentiment.';
    }
    if (fiiCash < 0 && fiiIndexFut < 0) {
      return 'FIIs selling visible across both cash and futures segments.';
    }
    if (fiiCash > 0 && fiiIndexFut < 0) {
      return 'Mixed activity: FIIs buying in cash but hedging via index futures.';
    }
    if (fiiCash < 0 && fiiIndexFut > 0) {
      return 'Mixed activity: FIIs selling cash but buying index futures.';
    }
    return 'Institutional flows are mixed with no clear direction.';
  };

  const getCalendarParts = (item: any, tf: 'daily' | 'weekly' | 'monthly') => {
    const d = new Date(item.date);
    if (tf === 'daily') {
      const month = d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
      const day = d.toLocaleDateString(undefined, { day: '2-digit' });
      const year = d.getFullYear();
      return { month, day, year, subtitle: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: '2-digit' }) };
    } else if (tf === 'weekly') {
      const month = 'WK';
      const day = d.toLocaleDateString(undefined, { day: '2-digit' });
      const year = d.getFullYear();
      return { month, day, year, subtitle: item.displayDate };
    } else {
      const month = d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
      const day = 'M';
      const year = d.getFullYear();
      return { month, day, year, subtitle: item.displayDate };
    }
  };

  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteFeedback, setPasteFeedback] = useState<{ success?: boolean; message?: string } | null>(null);

  const [activeTab, setActiveTab] = useState<'pulse' | 'cash' | 'fno' | 'summary'>('pulse');
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [activeSessionIndex, setActiveSessionIndex] = useState(0);
  const [cashPage, setCashPage] = useState(1);
  const [cashLookback, setCashLookback] = useState<number | 'all'>(20);
  const [cashLineMode, setCashLineMode] = useState<'price' | 'percent'>('price');
  const [hoveredChartPoint, setHoveredChartPoint] = useState<number | null>(null);

  const handleTimeframeChange = (tf: 'daily' | 'weekly' | 'monthly') => {
    setTimeframe(tf);
    setActiveSessionIndex(0);
    setCashPage(1);
    setHoveredChartPoint(null);
  };

  // Group daily pulse data by week or month client-side
  const aggregatedPulseData = useMemo(() => {
    if (timeframe === 'daily') {
      return safePulseData.map(item => ({
        ...item,
        displayDate: new Date(item.date).toLocaleDateString(undefined, {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          weekday: 'long'
        })
      }));
    }

    const groups: { [key: string]: FiiDiiFlowsItem[] } = {};

    safePulseData.forEach(item => {
      let key = '';
      if (timeframe === 'weekly') {
        const d = new Date(item.date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        key = monday.toISOString().split('T')[0];
      } else {
        const d = new Date(item.date);
        key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    });

    const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    return sortedKeys.map(key => {
      const items = groups[key];
      const latestItem = items[0];

      let displayDate = '';
      if (timeframe === 'weekly') {
        const start = new Date(key);
        const end = new Date(latestItem.date);
        const optStart: Intl.DateTimeFormatOptions = { month: 'short', day: '2-digit' };
        const optEnd: Intl.DateTimeFormatOptions = { month: 'short', day: '2-digit', year: 'numeric' };
        displayDate = `${start.toLocaleDateString(undefined, optStart)} - ${end.toLocaleDateString(undefined, optEnd)}`;
      } else {
        const [year, month] = key.split('-');
        const dateObj = new Date(parseInt(year), parseInt(month) - 1, 1);
        displayDate = dateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      }

      const fiiCashSum: { [category: string]: number } = {};
      items.forEach(item => {
        item.fii_cash?.forEach(c => {
          fiiCashSum[c.category] = (fiiCashSum[c.category] || 0) + c.net_value;
        });
      });
      const fii_cash = Object.keys(fiiCashSum).map(category => ({
        category: category as 'DII' | 'FII/FPI',
        net_value: fiiCashSum[category],
        created_at: latestItem.date
      }));

      const fiiOiSum: { [type: string]: number } = {};
      items.forEach(item => {
        item.fii_oi?.forEach(o => {
          fiiOiSum[o.type] = (fiiOiSum[o.type] || 0) + o.net_amount;
        });
      });
      const fii_oi = Object.keys(fiiOiSum).map(type => ({
        type,
        net_amount: fiiOiSum[type],
        created_at: latestItem.date
      }));

      const indices = latestItem.indices || [];

      return {
        date: latestItem.date,
        fii_cash,
        fii_oi,
        indices,
        displayDate
      };
    });
  }, [safePulseData, timeframe]);

  // Tab 3 state: selected participant
  const [selectedParticipant, setSelectedParticipant] = useState<'Client' | 'DII' | 'FII' | 'Pro' | 'TOTAL'>('FII');

  // Tab 4 search, filters & pagination
  const [searchTerm, setSearchTerm] = useState('');
  const [summaryFilter, setSummaryFilter] = useState<'all' | 'long_build_up' | 'long_unwinding' | 'short_build_up' | 'short_covering'>('all');
  const [summaryPage, setSummaryPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);
  const [sortField, setSortField] = useState<'symbol_name' | 'change_ltp_per' | 'oi' | 'change_oi_per'>('symbol_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Accordion state for Derivatives Summary table rows
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  // Tab 2 pagination
  const cashItemsPerPage = 10;

  // Bidirectional Progress Bar helper centered at 50%
  const renderBidirectionalBar = (value: number, maxLimit: number) => {
    const isPositive = value >= 0;
    const percentage = maxLimit > 0 ? Math.min(50, (Math.abs(value) / maxLimit) * 50) : 0;
    return (
      <div className="w-full bg-slate-950 h-2.5 rounded-full relative overflow-hidden border border-slate-900">
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-800 z-10" />
        {isPositive ? (
          <div
            className="absolute h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-r-full transition-all duration-500"
            style={{ left: '50%', width: `${percentage}%` }}
          />
        ) : (
          <div
            className="absolute h-full bg-gradient-to-l from-rose-500 to-pink-500 rounded-l-full transition-all duration-500"
            style={{ right: '50%', width: `${percentage}%` }}
          />
        )}
      </div>
    );
  };

  // Simple left-aligned Progress Bar helper
  const renderSimpleLeftBar = (value: number, maxLimit: number) => {
    const isPositive = value >= 0;
    const percentage = maxLimit > 0 ? Math.min(100, (Math.abs(value) / maxLimit) * 100) : 0;
    return (
      <div className="w-full bg-slate-950 h-2.5 rounded-full relative overflow-hidden border border-slate-900">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isPositive
            ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
            : 'bg-gradient-to-r from-rose-500 to-pink-500'
            }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    );
  };


  // Daily Pulse Flow Variables
  const latestData = useMemo(() => {
    if (aggregatedPulseData.length === 0) return null;
    if (activeSessionIndex >= aggregatedPulseData.length) return aggregatedPulseData[0];
    return aggregatedPulseData[activeSessionIndex];
  }, [aggregatedPulseData, activeSessionIndex]);

  const latestFiiNet = useMemo(() => {
    return latestData?.fii_cash?.find(f => f.category === 'FII/FPI')?.net_value || 0;
  }, [latestData]);

  const latestDiiNet = useMemo(() => {
    return latestData?.fii_cash?.find(f => f.category === 'DII')?.net_value || 0;
  }, [latestData]);

  const latestCombinedNet = useMemo(() => {
    return latestFiiNet + latestDiiNet;
  }, [latestFiiNet, latestDiiNet]);

  // Compute Sentiment Score and Details (Composite Signal)
  const sentiment = useMemo(() => {
    const defaultSentiment = { score: 0, text: 'No Data', details: ['No institutional flows are reported for this session.'] };
    if (!latestData || !checkHasData(latestData)) {
      return defaultSentiment;
    }
    if (!safeOiData || safeOiData.length === 0 || !safeSummaryData || safeSummaryData.length === 0) {
      return defaultSentiment;
    }
    const latestPulse = latestData;
    const details: string[] = [];
    let score = 0;

    // 1. FII Cash flow
    const fiiCash = latestPulse.fii_cash?.find(f => f.category === 'FII/FPI');
    if (fiiCash) {
      const val = fiiCash.net_value;
      if (val > 0) {
        score += 1;
        details.push(`FII Cash Net Buy: +${formatNumberIndian(val)} Cr (+1)`);
      } else if (val < 0) {
        score -= 1;
        details.push(`FII Cash Net Sell: ${formatNumberIndian(val)} Cr (-1)`);
      }
    }

    // 2. FII Index Futures flow
    const fiiIdxFut = latestPulse.fii_oi?.find(o => o.type === 'INDEX FUTURES');
    if (fiiIdxFut) {
      const val = fiiIdxFut.net_amount;
      if (val > 0) {
        score += 1;
        details.push(`FII Index Futures Net Buy: +${formatNumberIndian(val)} Cr (+1)`);
      } else if (val < 0) {
        score -= 1;
        details.push(`FII Index Futures Net Sell: ${formatNumberIndian(val)} Cr (-1)`);
      }
    }

    // 3. FII Index Futures Long Ratio from Participant OI
    const targetDate = new Date(latestPulse.date);
    const matchedOiData = safeOiData.filter(d => new Date(d.date) <= targetDate);

    const latestOiFii = matchedOiData.find(d => d.client_type === 'FII');
    if (latestOiFii) {
      const long = latestOiFii.future_index_long || 0;
      const short = latestOiFii.future_index_short || 0;
      const total = long + short;
      if (total > 0) {
        const ratio = long / total;
        if (ratio > 0.55) {
          score += 1;
          details.push(`FII Futures Long Ratio Bullish: ${(ratio * 100).toFixed(1)}% (+1)`);
        } else if (ratio < 0.45) {
          score -= 1;
          details.push(`FII Futures Long Ratio Bearish: ${(ratio * 100).toFixed(1)}% (-1)`);
        } else {
          details.push(`FII Futures Long Ratio Neutral: ${(ratio * 100).toFixed(1)}% (0)`);
        }
      }
    }

    // 4. Smart vs Retail options sentiment divergence
    const fnet = matchedOiData.find(d => d.client_type === 'FII');
    const pnet = matchedOiData.find(d => d.client_type === 'Pro');
    const cnet = matchedOiData.find(d => d.client_type === 'Client');
    if (fnet && pnet && cnet) {
      const smartCallNet = ((fnet.option_index_call_long || 0) - (fnet.option_index_call_short || 0)) +
        ((pnet.option_index_call_long || 0) - (pnet.option_index_call_short || 0));
      const smartPutNet = ((fnet.option_index_put_long || 0) - (fnet.option_index_put_short || 0)) +
        ((pnet.option_index_put_long || 0) - (pnet.option_index_put_short || 0));
      const smartSentiment = smartCallNet - smartPutNet;

      const clientCallNet = (cnet.option_index_call_long || 0) - (cnet.option_index_call_short || 0);
      const clientPutNet = (cnet.option_index_put_long || 0) - (cnet.option_index_put_short || 0);
      const clientSentiment = clientCallNet - clientPutNet;

      if (smartSentiment > 0 && clientSentiment < 0) {
        score += 2;
        details.push(`Smart Money Options Bullish vs Retail Bearish (+2)`);
      } else if (smartSentiment < 0 && clientSentiment > 0) {
        score -= 2;
        details.push(`Smart Money Options Bearish vs Retail Bullish (-2)`);
      } else {
        details.push(`Smart vs Retail Option Sentiments Aligned (0)`);
      }
    }

    // 5. Stock Built-up breadth
    const bullishCount = safeSummaryData.filter(s => s && (s.built_up === 'long_build_up' || s.built_up === 'short_covering')).length;
    const totalCount = safeSummaryData.length;
    if (totalCount > 0) {
      const ratio = bullishCount / totalCount;
      if (ratio > 0.60) {
        score += 1;
        details.push(`F&O Stock Breadth Bullish: ${(ratio * 100).toFixed(1)}% (+1)`);
      } else if (ratio < 0.40) {
        score -= 1;
        details.push(`F&O Stock Breadth Bearish: ${(ratio * 100).toFixed(1)}% (-1)`);
      } else {
        details.push(`F&O Stock Breadth Mixed: ${(ratio * 100).toFixed(1)}% (0)`);
      }
    }

    let text = 'Sideways';
    if (score >= 3) text = 'Bullish';
    else if (score <= -3) text = 'Bearish';
    else if (score >= 1) text = 'Mildly Bullish';
    else if (score <= -1) text = 'Mildly Bearish';

    return { score, text, details };
  }, [latestData, safeOiData, safeSummaryData]);

  const indexNifty = latestData?.indices?.find(idx => idx.symbol_name === 'NIFTY 50');
  const indexVix = latestData?.indices?.find(idx => idx.symbol_name === 'INDIA VIX');

  // Overall Flows Calculations
  const overallFlows = useMemo(() => {
    if (!latestData) return [];

    const fiiCash = latestData.fii_cash?.find(f => f.category === 'FII/FPI')?.net_value || 0;
    const diiCash = latestData.fii_cash?.find(f => f.category === 'DII')?.net_value || 0;

    const fiiIndexFut = latestData.fii_oi?.find(o => o.type === 'INDEX FUTURES')?.net_amount || 0;
    const fiiIndexOpt = latestData.fii_oi?.find(o => o.type === 'INDEX OPTIONS')?.net_amount || 0;
    const fiiStockFut = latestData.fii_oi?.find(o => o.type === 'STOCK FUTURES')?.net_amount || 0;
    const fiiStockOpt = latestData.fii_oi?.find(o => o.type === 'STOCK OPTIONS')?.net_amount || 0;

    return [
      { label: 'FII Cash Market', value: fiiCash },
      { label: 'DII Cash Market', value: diiCash },
      { label: 'FII Index Futures', value: fiiIndexFut },
      { label: 'FII Index Options', value: fiiIndexOpt },
      { label: 'FII Stock Futures', value: fiiStockFut },
      { label: 'FII Stock Options', value: fiiStockOpt }
    ];
  }, [latestData]);

  const overallFlowsMax = useMemo(() => {
    if (overallFlows.length === 0) return 1000;
    return Math.max(...overallFlows.map(f => Math.abs(f.value)), 1000);
  }, [overallFlows]);

  // Futures Breakdown
  const futuresBreakdown = useMemo(() => {
    if (!latestData || !latestData.fii_oi) return [];
    return latestData.fii_oi
      .filter(o => o.type && o.type.toUpperCase().endsWith('FUTURES'))
      .map(o => ({
        label: o.type,
        value: o.net_amount
      }));
  }, [latestData]);

  const futuresTotal = useMemo(() => {
    return futuresBreakdown.reduce((sum, item) => sum + item.value, 0);
  }, [futuresBreakdown]);

  // Options Breakdown
  const optionsBreakdown = useMemo(() => {
    if (!latestData || !latestData.fii_oi) return [];
    return latestData.fii_oi
      .filter(o => o.type && o.type.toUpperCase().endsWith('OPTIONS'))
      .map(o => ({
        label: o.type,
        value: o.net_amount
      }));
  }, [latestData]);

  const optionsTotal = useMemo(() => {
    return optionsBreakdown.reduce((sum, item) => sum + item.value, 0);
  }, [optionsBreakdown]);

  // Single global sharing max scale
  const globalMax = useMemo(() => {
    const allValues = [
      ...overallFlows.map(f => Math.abs(f.value)),
      ...futuresBreakdown.map(f => Math.abs(f.value)),
      ...optionsBreakdown.map(f => Math.abs(f.value))
    ];
    if (allValues.length === 0) return 1000;
    return Math.max(...allValues, 1000);
  }, [overallFlows, futuresBreakdown, optionsBreakdown]);

  // Detailed Index-Wise Breakdown for Daily Pulse
  const indexSpecificFlows = useMemo(() => {
    if (!latestData) return [];

    const indicesList = [
      { name: 'Nifty 50', futKey: 'NIFTY FUTURES', optKey: 'NIFTY OPTIONS' },
      { name: 'Bank Nifty', futKey: 'BANKNIFTY FUTURES', optKey: 'BANKNIFTY OPTIONS' },
      { name: 'Fin Nifty', futKey: 'FINNIFTY FUTURES', optKey: 'FINNIFTY OPTIONS' },
      { name: 'Midcap Nifty', futKey: 'MIDCPNIFTY FUTURES', optKey: 'MIDCPNIFTY OPTIONS' },
      { name: 'Nifty Next 50', futKey: 'NIFTYNXT50 FUTURES', optKey: 'NIFTYNXT50 OPTIONS' }
    ];

    return indicesList.map(idx => {
      const futVal = latestData.fii_oi?.find(o => o.type === idx.futKey)?.net_amount || 0;
      const optVal = latestData.fii_oi?.find(o => o.type === idx.optKey)?.net_amount || 0;
      return {
        name: idx.name,
        futures: futVal,
        options: optVal
      };
    });
  }, [latestData]);

  const indexFlowsMax = useMemo(() => {
    if (indexSpecificFlows.length === 0) return 1000;
    const allVals = indexSpecificFlows.flatMap(item => [Math.abs(item.futures), Math.abs(item.options)]);
    return Math.max(...allVals, 1000);
  }, [indexSpecificFlows]);

  // Handler for summary tab filtering & searching
  const filteredSummary = useMemo(() => {
    if (!safeSummaryData) return [];
    let items = [...safeSummaryData];

    if (summaryFilter !== 'all') {
      items = items.filter(item => item && item.built_up === summaryFilter);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      items = items.filter(item =>
        item && item.symbol_name && item.symbol_name.toLowerCase().includes(q)
      );
    }

    // Apply Sorting
    items.sort((a, b) => {
      let aVal = a ? a[sortField] : undefined;
      let bVal = b ? b[sortField] : undefined;

      if (aVal === undefined || aVal === null) aVal = (typeof bVal === 'string' ? '' : 0) as any;
      if (bVal === undefined || bVal === null) bVal = (typeof aVal === 'string' ? '' : 0) as any;

      if (typeof aVal === 'string') {
        return sortOrder === 'asc'
          ? (aVal as string).localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal as string);
      } else {
        return sortOrder === 'asc'
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      }
    });

    return items;
  }, [safeSummaryData, summaryFilter, searchTerm, sortField, sortOrder]);

  // Pagination bounds for Derivatives Summary
  const paginatedSummary = useMemo(() => {
    const startIdx = (summaryPage - 1) * itemsPerPage;
    return filteredSummary.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredSummary, summaryPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredSummary.length / itemsPerPage);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder(field === 'symbol_name' ? 'asc' : 'desc');
    }
    setSummaryPage(1);
  };

  // Participant Contract OI Ratio Helpers
  const activeParticipants = useMemo(() => {
    if (!safeOiData) return [];
    return safeOiData.filter(d => d && d.client_type !== 'TOTAL');
  }, [safeOiData]);

  // Selected Participant OI Data Point Analysis (with previous deltas)
  const currentParticipantOi = useMemo(() => {
    if (!safeOiData) return null;
    return safeOiData.find(d => d && d.client_type === selectedParticipant) || null;
  }, [safeOiData, selectedParticipant]);

  // Helper to format values
  const formatCr = (val: number) => {
    return `${val >= 0 ? '+' : ''}${formatNumberIndian(val)} Cr`;
  };

  const formatContracts = (val: number) => {
    return formatNumberIndian(val);
  };

  const formatDelta = (curr: number, prev: number | undefined) => {
    if (prev === undefined) return null;
    const delta = curr - prev;
    return {
      value: delta,
      text: `${delta >= 0 ? '+' : ''}${formatNumberIndian(delta)}`,
      isBullish: delta >= 0
    };
  };

  // Helper for Built Up Labels
  const getBuiltUpLabel = (builtUp: string) => {
    switch (builtUp) {
      case 'long_build_up': return { text: 'Long Build Up', style: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]' };
      case 'short_covering': return { text: 'Short Covering', style: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]' };
      case 'short_build_up': return { text: 'Short Build Up', style: 'bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.1)]' };
      case 'long_unwinding': return { text: 'Long Unwinding', style: 'bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.15)]' };
      default: return { text: builtUp || 'Neutral', style: 'bg-slate-800 text-slate-400 border border-slate-700' };
    }
  };

  // SVG Gauge Pointer calculation
  const gaugeRotation = useMemo(() => {
    if (!latestData || !checkHasData(latestData)) {
      return 0;
    }
    // sentiment.score ranges from -6 to +6. Map to -90 to +90 degrees.
    const angle = (sentiment.score / 6) * 90;
    return Math.max(-90, Math.min(90, angle));
  }, [sentiment.score, latestData]);

  // SVG Cash market charts details
  const cashChartData = useMemo(() => {
    if (!aggregatedPulseData) return [];
    
    // Slice based on lookback
    let slice = [...aggregatedPulseData];
    if (cashLookback !== 'all') {
      slice = slice.slice(0, cashLookback);
    }
    // Reverse to get chronological order (left-to-right)
    slice.reverse();

    // Find the first Nifty value in this range to use as 0% baseline for percent mode
    let firstNifty = 0;
    if (slice.length > 0) {
      firstNifty = slice[0].indices?.find(i => i.symbol_name === 'NIFTY 50')?.last_trade_price || 0;
    }

    return slice.map((d) => {
      const fii = d.fii_cash?.find(f => f.category === 'FII/FPI')?.net_value || 0;
      const dii = d.fii_cash?.find(f => f.category === 'DII')?.net_value || 0;
      const nifty = d.indices?.find(i => i.symbol_name === 'NIFTY 50')?.last_trade_price || 0;
      
      let niftyPercent = 0;
      if (firstNifty > 0) {
        niftyPercent = ((nifty - firstNifty) / firstNifty) * 100;
      }

      let dateStr = '';
      if (timeframe === 'daily') {
        dateStr = new Date(d.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
      } else if (timeframe === 'weekly') {
        dateStr = d.displayDate ? d.displayDate.split(' - ')[0] : new Date(d.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
      } else {
        dateStr = new Date(d.date).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      }
      return { date: dateStr, fii, dii, nifty, niftyPercent, rawDate: d.date };
    });
  }, [aggregatedPulseData, cashLookback, timeframe]);

  // SVG Chart boundaries and paths
  const cashChartSVG = useMemo(() => {
    if (cashChartData.length === 0) return null;
    const padding = 50;
    const width = 1000;
    const height = 400;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    const maxVal = Math.max(...cashChartData.map(d => Math.max(Math.abs(d.fii), Math.abs(d.dii), 1000)));
    
    // Nifty price range
    const niftyPrices = cashChartData.map(d => d.nifty);
    const minNifty = Math.min(...niftyPrices);
    const maxNifty = Math.max(...niftyPrices);
    const niftyRange = maxNifty - minNifty || 1;

    // Nifty percentage range
    const niftyPercents = cashChartData.map(d => d.niftyPercent);
    const minPercent = Math.min(...niftyPercents);
    const maxPercent = Math.max(...niftyPercents);
    const percentRange = maxPercent - minPercent || 1;

    const points = cashChartData.map((d, index) => {
      const x = padding + (index / (cashChartData.length - 1 || 1)) * chartW;
      const baselineY = padding + chartH / 2;
      const fiiY = baselineY - (d.fii / maxVal) * (chartH / 2);
      const diiY = baselineY - (d.dii / maxVal) * (chartH / 2);

      // Plot y coordinate for nifty line depending on Line Mode
      const niftyY = cashLineMode === 'price'
        ? padding + chartH - ((d.nifty - minNifty) / niftyRange) * chartH
        : padding + chartH - ((d.niftyPercent - minPercent) / percentRange) * chartH;

      return { x, fiiY, diiY, niftyY, baselineY, raw: d };
    });

    const niftyPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.niftyY}`).join(' ');

    const niftyAreaPath = points.length > 0
      ? `${niftyPath} L ${points[points.length - 1].x} ${padding + chartH} L ${points[0].x} ${padding + chartH} Z`
      : '';

    return { 
      points, 
      niftyPath, 
      niftyAreaPath, 
      maxVal, 
      minNifty, 
      maxNifty, 
      minPercent, 
      maxPercent, 
      width, 
      height, 
      padding, 
      chartW, 
      chartH 
    };
  }, [cashChartData, cashLineMode]);

  // Cumulative institutional flows calculated over active dataset
  const cumulativeFlows = useMemo(() => {
    let fiiSum = 0;
    let diiSum = 0;
    cashChartData.forEach(d => {
      fiiSum += d.fii;
      diiSum += d.dii;
    });
    return {
      fii: fiiSum,
      dii: diiSum,
      combined: fiiSum + diiSum
    };
  }, [cashChartData]);

  // Tab 2 paginated historical flows table
  const paginatedCashFlows = useMemo(() => {
    if (!aggregatedPulseData) return [];
    const start = (cashPage - 1) * cashItemsPerPage;
    return aggregatedPulseData.slice(start, start + cashItemsPerPage);
  }, [aggregatedPulseData, cashPage]);

  const cashTotalPages = Math.ceil((aggregatedPulseData?.length || 0) / cashItemsPerPage);

  // Tab 4 Breadth KPIs
  const summaryKPIs = useMemo(() => {
    if (!safeSummaryData || safeSummaryData.length === 0) return null;
    const total = safeSummaryData.length;

    const longBuildUp = safeSummaryData.filter(s => s && s.built_up === 'long_build_up').length;
    const shortCovering = safeSummaryData.filter(s => s && s.built_up === 'short_covering').length;
    const shortBuildUp = safeSummaryData.filter(s => s && s.built_up === 'short_build_up').length;
    const longUnwinding = safeSummaryData.filter(s => s && s.built_up === 'long_unwinding').length;

    const bullishCount = longBuildUp + shortCovering;
    const bearishCount = shortBuildUp + longUnwinding;
    const bullishPer = total > 0 ? (bullishCount / total) * 100 : 0;
    const bearishPer = total > 0 ? (bearishCount / total) * 100 : 0;

    const avgPriceChange = total > 0 ? (safeSummaryData.reduce((acc, curr) => acc + Number(curr?.change_ltp_per || 0), 0) / total) : 0;
    const avgOiChange = total > 0 ? (safeSummaryData.reduce((acc, curr) => acc + Number(curr?.change_oi_per || 0), 0) / total) : 0;

    return {
      total,
      bullishCount,
      bearishCount,
      bullishPer,
      bearishPer,
      longBuildUp,
      shortCovering,
      shortBuildUp,
      longUnwinding,
      avgPriceChange,
      avgOiChange
    };
  }, [safeSummaryData]);

  return (
    <div className="bg-slate-950/80 border border-indigo-500/20 rounded-[2.5rem] p-8 shadow-[0_0_50px_rgba(99,102,241,0.1)] backdrop-blur-2xl text-slate-100 relative overflow-hidden">
      {/* Premium glow effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-8 border-b border-indigo-500/20 pb-6 relative z-10">
        <div className="flex items-center gap-4">
          <ActionButton
            size="lg"
            icon={<ArrowLeft size={18} />}
            onClick={onBack}
            title="Back"
          />
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
              📊 FII/DII Sentiment & Radar
              <span className="px-2.5 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-black uppercase tracking-wider rounded-xl border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                PRO
              </span>
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Cross-Analyzing Daily Institutional Flows & Participant Positions
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 self-stretch md:self-auto justify-end">
          {/* Index summary mini pills */}
          {indexNifty && (
            <div className="bg-slate-900/30 border border-indigo-500/20 rounded-2xl px-4 py-2 flex flex-col text-right hover:border-indigo-500/30 transition-all">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">NIFTY 50</span>
              <span className="text-xs font-bold text-white mt-0.5 flex items-center gap-1.5 justify-end">
                {formatNumberIndian(indexNifty.last_trade_price)}
                <span className={`text-[9px] font-bold ${indexNifty.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {indexNifty.change >= 0 ? '+' : ''}{indexNifty.change_percent.toFixed(2)}%
                </span>
              </span>
            </div>
          )}
          {indexVix && (
            <div className="bg-slate-900/30 border border-indigo-500/20 rounded-2xl px-4 py-2 flex flex-col text-right hover:border-indigo-500/30 transition-all">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">INDIA VIX</span>
              <span className="text-xs font-bold text-white mt-0.5 flex items-center gap-1.5 justify-end">
                {indexVix.last_trade_price.toFixed(2)}
                <span className={`text-[9px] font-bold ${indexVix.change_percent >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {indexVix.change_percent >= 0 ? '+' : ''}{indexVix.change_percent.toFixed(2)}%
                </span>
              </span>
            </div>
          )}
          {onManualPaste && (
            <ActionButton
              size="lg"
              icon={<Database size={16} className="text-emerald-400" />}
              label="Manual Import"
              onClick={() => setIsPasteModalOpen(true)}
              title="Manual Paste JSON"
            />
          )}
          <ActionButton
            size="lg"
            icon={<RefreshCw size={16} />}
            onClick={onRefresh}
            isLoading={isLoading}
            disabled={isLoading}
            title="Refresh FII/DII Data"
          />
        </div>
      </div>

      {/* Tabs Menu Navigation */}
      <div className="flex border-b border-indigo-500/20 mb-6 gap-2 overflow-x-auto pb-2.5 scrollbar-thin relative z-10">
        {[
          { id: 'pulse', label: 'Daily Pulse', icon: Activity },
          { id: 'cash', label: 'Cash Market', icon: BarChart2 },
          { id: 'fno', label: 'FNO', icon: PieChart },
          { id: 'summary', label: 'Derivatives Summary', icon: Sparkles }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-6 py-3.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${activeTab === tab.id
              ? 'bg-gradient-to-r from-indigo-600 to-purple-600 border-indigo-400 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] scale-[1.02]'
              : 'border-indigo-500/20 text-slate-400 hover:text-white hover:bg-slate-900/50'
              }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Render Switcher */}
      {isLoading ? (
        <div className="h-96 flex flex-col items-center justify-center gap-4 bg-slate-950/40 border border-indigo-500/20 rounded-3xl relative z-10">
          <RefreshCw size={28} className="animate-spin text-indigo-400" />
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">
            Compiling institutional positions...
          </p>
        </div>
      ) : (
        <div className="relative z-10">
          {/* TAB 1: DAILY PULSE */}
          {activeTab === 'pulse' && (
            <div className="flex flex-col gap-6 animate-fadeIn">
              {!latestData ? (
                <div className="w-full bg-slate-900/10 border border-slate-800/50 rounded-3xl p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative overflow-hidden shadow-md opacity-60">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-slate-500/5 blur-2xl rounded-full pointer-events-none" />
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-center text-slate-600">
                      <Calendar size={18} />
                    </div>
                    <div>
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Institutional Flow Session</span>
                      <span className="text-sm font-black text-slate-400">
                        No Session Data Available
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-slate-900 border border-slate-800 text-slate-500 rounded-xl text-[9px] font-bold uppercase tracking-wider">
                      ● Sync Inactive
                    </span>
                  </div>
                </div>
              ) : (
                <div className="w-full bg-indigo-950/30 border border-indigo-500/20 rounded-3xl p-5 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 relative overflow-hidden shadow-lg shadow-indigo-500/5">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-2xl rounded-full pointer-events-none" />

                  {/* Left Section: Icon and Period Details */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full xl:w-auto">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400">
                        <Calendar size={18} />
                      </div>
                      <div>
                        <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block">Institutional Flow Session</span>
                        <span className="text-sm font-black text-white">
                          {latestData.displayDate || new Date(latestData.date).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric', weekday: 'long' })}
                        </span>
                      </div>
                    </div>

                    {/* Navigation Buttons flanking date */}
                    <div className="flex items-center gap-2 mt-2 sm:mt-0 bg-slate-950/60 p-1 border border-indigo-500/10 rounded-xl w-fit">
                      <button
                        onClick={() => {
                          if (activeSessionIndex < aggregatedPulseData.length - 1) {
                            setActiveSessionIndex(prev => prev + 1);
                          }
                        }}
                        disabled={activeSessionIndex === aggregatedPulseData.length - 1}
                        className="w-8 h-8 bg-slate-900 border border-indigo-500/15 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:border-indigo-500/30 disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:border-indigo-500/15 transition-all active:scale-95"
                        title="Older Session (Back in time)"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider px-2 min-w-[50px] text-center select-none">
                        {activeSessionIndex + 1} / {aggregatedPulseData.length}
                      </span>
                      <button
                        onClick={() => {
                          if (activeSessionIndex > 0) {
                            setActiveSessionIndex(prev => prev - 1);
                          }
                        }}
                        disabled={activeSessionIndex === 0}
                        className="w-8 h-8 bg-slate-900 border border-indigo-500/15 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:border-indigo-500/30 disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:border-indigo-500/15 transition-all active:scale-95"
                        title="Newer Session (Forward in time)"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Right Section: Timeframe Selection Toggles & Status */}
                  <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto xl:justify-end">
                    {/* Timeframe selector styled like tab menu */}
                    <Tabs.Root
                      value={timeframe}
                      onChange={(val) => handleTimeframeChange(val as any)}
                      variant="solid-indigo"
                      layoutId="fiidii-top-timeframe-nav"
                      motionPreset="spring"
                    >
                      <Tabs.List className="bg-slate-950/60 p-1 border border-indigo-500/15 rounded-xl">
                        {(['daily', 'weekly', 'monthly'] as const).map(tf => (
                          <Tabs.Trigger
                            key={tf}
                            value={tf}
                            className="px-3 py-1.5 text-[9px] font-black uppercase tracking-wider"
                          >
                            {tf}
                          </Tabs.Trigger>
                        ))}
                      </Tabs.List>
                    </Tabs.Root>

                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-[9px] font-bold uppercase tracking-wider">
                        ● Sync Successful
                      </span>
                      <span className="px-3 py-1.5 bg-slate-900 border border-slate-800 text-slate-400 rounded-xl text-[9px] font-bold uppercase tracking-wider">
                        EOD Data
                      </span>
                    </div>
                  </div>

                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                {/* Left Column: Sentiment Dial & Signal Breakdown & Commentary (xl:col-span-5) */}
                <div className="xl:col-span-5 flex flex-col gap-6">
                  {/* Sentiment gauge & Dial Card */}
                  <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-5 flex flex-col items-center relative overflow-hidden shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-2xl rounded-full" />
                    <h3 className="text-[11px] font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2 self-start border-b border-indigo-500/15 pb-2 w-full">
                      ⚡ Market Sentiment Dial
                    </h3>

                    <div className="relative w-72 h-44 flex items-center justify-center mt-2">
                      {/* Arc Gauge Background */}
                      <svg className="w-full h-full" viewBox="0 0 200 110">
                        <defs>
                          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#f43f5e" /> {/* Red Bearish */}
                            <stop offset="50%" stopColor="#f59e0b" /> {/* Orange Sideways */}
                            <stop offset="100%" stopColor="#10b981" /> {/* Emerald Bullish */}
                          </linearGradient>
                        </defs>
                        <path
                          d="M20,100 A80,80 0 0,1 180,100"
                          fill="none"
                          stroke="url(#gaugeGrad)"
                          strokeWidth="12"
                          strokeLinecap="round"
                        />
                        {/* Dial pointer center */}
                        <circle cx="100" cy="100" r="7" fill="#ffffff" className="shadow-lg" />
                        <circle cx="100" cy="100" r="3" fill="#6366f1" />
                        {/* Rotating needle */}
                        <line
                          x1="100"
                          y1="100"
                          x2="100"
                          y2="28"
                          stroke="#ffffff"
                          strokeWidth="3"
                          strokeLinecap="round"
                          transform={`rotate(${gaugeRotation} 100 100)`}
                          className="transition-transform duration-1000 ease-out"
                        />
                      </svg>

                      {/* Rating Badge Box Overlay */}
                      <div className="absolute bottom-2 flex flex-col items-center">
                        <span className={`px-4 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-widest border shadow-xl ${!checkHasData(latestData)
                          ? 'bg-slate-800/45 border-slate-700 text-slate-400 shadow-slate-900/10'
                          : sentiment.text.toLowerCase().includes('bullish')
                            ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400 shadow-emerald-500/10'
                            : sentiment.text.toLowerCase().includes('bearish')
                              ? 'bg-rose-500/15 border-rose-500/35 text-rose-400 shadow-rose-500/10'
                              : 'bg-amber-500/15 border-amber-500/35 text-amber-400 shadow-amber-500/10'
                          }`}>
                          {!checkHasData(latestData) ? 'No Data' : sentiment.text.toUpperCase()}
                        </span>
                        <span className="text-[9px] font-bold text-slate-500 mt-1.5 uppercase tracking-wider">
                          Composite Score: {!checkHasData(latestData) ? '0' : (sentiment.score > 0 ? '+' : '') + sentiment.score} / +6
                        </span>
                      </div>
                    </div>

                    {/* Score indicators list */}
                    <div className="w-full mt-4 space-y-2 border-t border-slate-800/60 pt-4">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                        Signal Breakdown
                      </span>
                      {sentiment.details.map((detail, index) => (
                        <div key={index} className="flex items-center gap-2 bg-slate-950/40 rounded-2xl px-3.5 py-2.5 border border-indigo-500/5 hover:border-indigo-500/15 transition-all">
                          <span className="w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.6)]"></span>
                          <span className="text-xs text-slate-300 font-bold">{detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Commentary Box (Institutional Signal Estimation) underneath the Dial */}
                  <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-5 flex flex-col gap-2 relative overflow-hidden shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-2xl rounded-full" />
                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest border-b border-indigo-500/15 pb-2">
                      🔮 INSTITUTIONAL SIGNAL ESTIMATION
                    </span>
                    <p className="text-xs md:text-sm font-semibold text-slate-200 leading-relaxed mt-2">
                      {getCardCommentary(
                        latestData?.fii_cash?.find(f => f.category === 'FII/FPI')?.net_value || 0,
                        latestData?.fii_oi?.find(o => o.type === 'INDEX FUTURES')?.net_amount || 0,
                        checkHasData(latestData)
                      )}
                    </p>
                  </div>
                </div>

                {/* Right Column: Overall Institutional Flows & Derivatives Index Breakdown (xl:col-span-7) */}
                <div className="xl:col-span-7 flex flex-col gap-6">
                  {/* Overall Cash/Derivative Net Flows with Left-Aligned Progress Bars */}
                  <div className={`bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 ${!checkHasData(latestData) ? 'opacity-55' : ''}`}>
                    <h3 className="text-[11px] font-bold text-white uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-indigo-500/15 pb-2">
                      📊 Overall Institutional Flows (Today)
                    </h3>
                    <div className="space-y-5">
                      {overallFlows.length > 0 ? (
                        overallFlows.map((flow, i) => (
                          <div key={i} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-xs font-bold uppercase">
                              <span className="text-slate-400">{flow.label.toUpperCase()}</span>
                              <span className={!checkHasData(latestData) ? 'text-slate-500' : flow.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {checkHasData(latestData) ? formatCr(flow.value).toUpperCase() : '0 CR'}
                              </span>
                            </div>
                            {/* Simple left-aligned progress bar */}
                            {renderSimpleLeftBar(flow.value, globalMax)}
                          </div>
                        ))
                      ) : (
                        <p className="text-xs font-bold text-slate-500 uppercase py-6 text-center">
                          Flow data unavailable for the selected session
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Futures Breakdown Card */}
                  <div className={`bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 ${!checkHasData(latestData) ? 'opacity-55' : ''}`}>
                    <h3 className="text-[11px] font-bold text-white uppercase tracking-widest mb-6 flex items-center justify-between border-b border-indigo-500/15 pb-2">
                      <span className="flex items-center gap-2">📈 Futures Breakdown</span>
                      <span className={!checkHasData(latestData) ? 'text-slate-500' : futuresTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {checkHasData(latestData) ? formatCr(futuresTotal).toUpperCase() : '0 CR'}
                      </span>
                    </h3>
                    <div className="space-y-5">
                      {futuresBreakdown.length > 0 ? (
                        futuresBreakdown.map((flow, i) => (
                          <div key={i} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-xs font-bold uppercase">
                              <span className="text-slate-400">{flow.label.toUpperCase()}</span>
                              <span className={!checkHasData(latestData) ? 'text-slate-500' : flow.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {checkHasData(latestData) ? formatCr(flow.value).toUpperCase() : '0 CR'}
                              </span>
                            </div>
                            {renderSimpleLeftBar(flow.value, globalMax)}
                          </div>
                        ))
                      ) : (
                        <p className="text-xs font-bold text-slate-500 uppercase py-6 text-center">
                          Futures breakdown data unavailable
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Options Breakdown Card */}
                  <div className={`bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 ${!checkHasData(latestData) ? 'opacity-55' : ''}`}>
                    <h3 className="text-[11px] font-bold text-white uppercase tracking-widest mb-6 flex items-center justify-between border-b border-indigo-500/15 pb-2">
                      <span className="flex items-center gap-2">📉 Options Breakdown</span>
                      <span className={!checkHasData(latestData) ? 'text-slate-500' : optionsTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {checkHasData(latestData) ? formatCr(optionsTotal).toUpperCase() : '0 CR'}
                      </span>
                    </h3>
                    <div className="space-y-5">
                      {optionsBreakdown.length > 0 ? (
                        optionsBreakdown.map((flow, i) => (
                          <div key={i} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-xs font-bold uppercase">
                              <span className="text-slate-400">{flow.label.toUpperCase()}</span>
                              <span className={!checkHasData(latestData) ? 'text-slate-500' : flow.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {checkHasData(latestData) ? formatCr(flow.value).toUpperCase() : '0 CR'}
                              </span>
                            </div>
                            {renderSimpleLeftBar(flow.value, globalMax)}
                          </div>
                        ))
                      ) : (
                        <p className="text-xs font-bold text-slate-500 uppercase py-6 text-center">
                          Options breakdown data unavailable
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Index F&O Breakdown grid (No Progress Bars, Clean Text Alignment) */}
                  <div className={`bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 ${!checkHasData(latestData) ? 'opacity-55' : ''}`}>
                    <h3 className="text-[11px] font-bold text-white uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-indigo-500/15 pb-2">
                      🎯 FII Derivatives Index Breakdown
                    </h3>
                    {indexSpecificFlows.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {indexSpecificFlows.map((item, idx) => (
                          <div key={idx} className="bg-slate-950/60 border border-indigo-500/10 rounded-2xl p-4 flex flex-col justify-between hover:border-indigo-500/30 hover:bg-slate-950/80 transition-all duration-300">
                            <span className="text-[10px] font-bold text-white uppercase border-b border-indigo-500/15 pb-1.5 mb-2">{item.name.toUpperCase()}</span>
                            <div className="flex flex-col gap-2">
                              {/* Futures row */}
                              <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                                <span className="text-slate-400">Futures:</span>
                                <span className={`font-bold ${!checkHasData(latestData) ? 'text-slate-500' : item.futures >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {checkHasData(latestData) ? formatCr(item.futures).toUpperCase() : '0 CR'}
                                </span>
                              </div>
                              {/* Options row */}
                              <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                                <span className="text-slate-400">Options:</span>
                                <span className={`font-bold ${!checkHasData(latestData) ? 'text-slate-500' : item.options >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {checkHasData(latestData) ? formatCr(item.options).toUpperCase() : '0 CR'}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-bold text-slate-500 uppercase py-6 text-center">
                        Index-wise derivative flows unavailable
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CASH MARKET */}
      {activeTab === 'cash' && (
        <div className="flex flex-col gap-6 animate-fadeIn">
          {/* Controls bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/30 border border-indigo-500/15 rounded-3xl p-4 relative z-20">
            {/* Left: Timeframe selection */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Timeframe:</span>
              <Tabs.Root
                value={timeframe}
                onChange={(val) => handleTimeframeChange(val as any)}
                variant="solid-indigo"
                layoutId="fiidii-cash-timeframe-nav"
                motionPreset="spring"
              >
                <Tabs.List className="bg-slate-950/60 p-1 border border-indigo-500/15 rounded-xl">
                  {(['daily', 'weekly', 'monthly'] as const).map(tf => (
                    <Tabs.Trigger
                      key={tf}
                      value={tf}
                      className="px-4 py-1.5 text-[9px] font-black uppercase tracking-wider"
                    >
                      {tf}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </Tabs.Root>
            </div>

            {/* Middle: Lookback selector */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Lookback:</span>
              <select
                value={cashLookback}
                onChange={(e) => {
                  const val = e.target.value;
                  setCashLookback(val === 'all' ? 'all' : parseInt(val));
                  setHoveredChartPoint(null);
                }}
                className="bg-slate-950 border border-indigo-500/20 rounded-xl px-3 py-1.5 text-[10px] font-black text-white uppercase tracking-wider outline-none focus:border-indigo-500 hover:border-indigo-500/40 transition-all cursor-pointer"
              >
                <option value={20}>Last 20 Sessions</option>
                <option value={50}>Last 50 Sessions</option>
                <option value={100}>Last 100 Sessions</option>
                <option value="all">All Sessions</option>
              </select>
            </div>

            {/* Right: Nifty Chart Mode */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Nifty Mode:</span>
              <Tabs.Root
                value={cashLineMode}
                onChange={(val) => setCashLineMode(val as any)}
                variant="solid-indigo"
                layoutId="fiidii-nifty-mode-nav"
                motionPreset="spring"
              >
                <Tabs.List className="bg-slate-950/60 p-1 border border-indigo-500/15 rounded-xl">
                  {(['price', 'percent'] as const).map(mode => (
                    <Tabs.Trigger
                      key={mode}
                      value={mode}
                      className="px-3 py-1 text-[9px] font-black uppercase tracking-wider"
                    >
                      {mode === 'price' ? 'Price' : '% Change'}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </Tabs.Root>
            </div>
          </div>

          {/* Three Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1: Index Performance */}
            <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-5 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 relative overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 blur-xl rounded-full pointer-events-none" />
              <h4 className="text-[11px] font-black text-indigo-400 uppercase tracking-widest border-b border-indigo-500/15 pb-2 mb-4">
                🏛️ Index Performance
              </h4>
              <div className="space-y-4">
                {/* Nifty 50 */}
                <div>
                  <div className="flex justify-between items-center text-xs font-bold uppercase mb-1">
                    <span className="text-slate-400">Nifty 50 Close</span>
                    <span className="text-white">₹{indexNifty ? formatNumberIndian(indexNifty.last_trade_price) : 'N/A'}</span>
                  </div>
                  {indexNifty && (
                    <div className="flex justify-end items-center gap-1.5 text-[10px] font-bold">
                      <span className={indexNifty.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {indexNifty.change >= 0 ? '▲' : '▼'} {formatNumberIndian(Math.abs(indexNifty.change))}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded ${indexNifty.change >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                        {indexNifty.change >= 0 ? '+' : ''}{indexNifty.change_percent.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
                {/* India Vix */}
                <div>
                  <div className="flex justify-between items-center text-xs font-bold uppercase mb-1">
                    <span className="text-slate-400">India VIX</span>
                    <span className="text-white">{indexVix ? indexVix.last_trade_price.toFixed(2) : 'N/A'}</span>
                  </div>
                  {indexVix && (
                    <div className="flex justify-end items-center gap-1.5 text-[10px] font-bold">
                      <span className={indexVix.change_percent >= 0 ? 'text-rose-400' : 'text-emerald-400'}>
                        {indexVix.change_percent >= 0 ? '▲' : '▼'} {Math.abs(indexVix.change_percent).toFixed(2)}%
                      </span>
                      <span className={`px-1.5 py-0.5 rounded ${indexVix.change_percent >= 0 ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                        {indexVix.change_percent >= 0 ? '+' : ''}{indexVix.change_percent.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Card 2: Latest Session Net Cash Flows */}
            <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-5 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 relative overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 blur-xl rounded-full pointer-events-none" />
              <h4 className="text-[11px] font-black text-indigo-400 uppercase tracking-widest border-b border-indigo-500/15 pb-2 mb-4 flex justify-between items-center">
                <span>📅 Flows ({timeframe === 'daily' ? 'Latest Day' : timeframe === 'weekly' ? 'Latest Week' : 'Latest Month'})</span>
                <span className="text-[9px] text-slate-500 normal-case">{latestData ? new Date(latestData.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : ''}</span>
              </h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs font-bold uppercase">
                  <span className="text-slate-400">FII Cash Net</span>
                  <span className={`font-black ${latestFiiNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCr(latestFiiNet)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold uppercase">
                  <span className="text-slate-400">DII Cash Net</span>
                  <span className={`font-black ${latestDiiNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCr(latestDiiNet)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold uppercase border-t border-indigo-500/15 pt-2 mt-2">
                  <span className="text-white">Combined Net</span>
                  <span className={`font-black ${latestCombinedNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCr(latestCombinedNet)}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 3: Cumulative Net Cash Flows */}
            <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-5 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 relative overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 blur-xl rounded-full pointer-events-none" />
              <h4 className="text-[11px] font-black text-indigo-400 uppercase tracking-widest border-b border-indigo-500/15 pb-2 mb-4 flex justify-between items-center">
                <span>📈 Cumulative Flows</span>
                <span className="text-[9px] text-slate-500 lowercase">lookback: {cashLookback}</span>
              </h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs font-bold uppercase">
                  <span className="text-slate-400">FII Cum. Net</span>
                  <span className={`font-black ${cumulativeFlows.fii >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCr(cumulativeFlows.fii)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold uppercase">
                  <span className="text-slate-400">DII Cum. Net</span>
                  <span className={`font-black ${cumulativeFlows.dii >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCr(cumulativeFlows.dii)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold uppercase border-t border-indigo-500/15 pt-2 mt-2">
                  <span className="text-white">Combined Cum. Net</span>
                  <span className={`font-black ${cumulativeFlows.combined >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCr(cumulativeFlows.combined)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Chart Section */}
          <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-[11px] font-bold text-white uppercase tracking-widest">
                  📊 Net Institutional Flows vs Nifty 50
                </h3>
                <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5 tracking-wider">
                  Plotting FII/DII Net Flows (bars) against Nifty 50 close ({cashLineMode === 'price' ? 'Price' : '% Change'}) over last {cashLookback} sessions
                </p>
              </div>
              {/* Legend keys */}
              <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-sky-400 rounded-md animate-pulse" />
                  <span className="text-slate-400">FII Cash Net</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-emerald-500 rounded-md animate-pulse" />
                  <span className="text-slate-400">DII Cash Net</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-purple-500 rounded-md animate-pulse" />
                  <span className="text-slate-400">Nifty 50 {cashLineMode === 'price' ? 'Spot' : '% Change'}</span>
                </div>
              </div>
            </div>

            {/* SVG Chart Wrapper with Relative Position for Tooltip overlay */}
            {cashChartSVG ? (
              <div className="relative w-full overflow-hidden bg-slate-950/40 rounded-3xl p-4 border border-indigo-500/10">
                <svg
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${cashChartSVG.width} ${cashChartSVG.height}`}
                  className="overflow-visible select-none"
                >
                  <defs>
                    <linearGradient id="niftyAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="fiiBarGradUp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="100%" stopColor="#0284c7" />
                    </linearGradient>
                    <linearGradient id="fiiBarGradDown" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" />
                      <stop offset="100%" stopColor="#991b1b" />
                    </linearGradient>
                    <linearGradient id="diiBarGradUp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#047857" />
                    </linearGradient>
                    <linearGradient id="diiBarGradDown" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" />
                      <stop offset="100%" stopColor="#9f1239" />
                    </linearGradient>
                  </defs>

                  <style>{`
                    .nifty-line-path {
                      stroke-dasharray: 2000;
                      stroke-dashoffset: 2000;
                      animation: drawNifty 2.5s cubic-bezier(0.25, 1, 0.5, 1) forwards;
                    }
                    @keyframes drawNifty {
                      to {
                        stroke-dashoffset: 0;
                      }
                    }
                  `}</style>

                  {/* Grid lines */}
                  <line
                    x1={cashChartSVG.padding}
                    y1={cashChartSVG.padding}
                    x2={cashChartSVG.width - cashChartSVG.padding}
                    y2={cashChartSVG.padding}
                    stroke="#1e293b"
                    strokeDasharray="4 4"
                  />
                  <line
                    x1={cashChartSVG.padding}
                    y1={cashChartSVG.padding + cashChartSVG.chartH / 2}
                    x2={cashChartSVG.width - cashChartSVG.padding}
                    y2={cashChartSVG.padding + cashChartSVG.chartH / 2}
                    stroke="#334155"
                  />
                  <line
                    x1={cashChartSVG.padding}
                    y1={cashChartSVG.padding + cashChartSVG.chartH}
                    x2={cashChartSVG.width - cashChartSVG.padding}
                    y2={cashChartSVG.padding + cashChartSVG.chartH}
                    stroke="#1e293b"
                    strokeDasharray="4 4"
                  />

                  {/* Cash flows bars */}
                  {cashChartSVG.points.map((p, idx) => {
                    // Make bars slightly wider for fewer items, narrower for many
                    const barW = Math.max(2, Math.min(10, cashChartSVG.chartW / (cashChartSVG.points.length * 3)));
                    const fiiH = p.baselineY - p.fiiY;
                    const diiH = p.baselineY - p.diiY;

                    return (
                      <g key={idx}>
                        {/* FII Bar */}
                        <rect
                          x={p.x - barW - 1}
                          y={fiiH >= 0 ? p.baselineY : p.baselineY}
                          width={barW}
                          height="0"
                          fill={p.raw.fii >= 0 ? 'url(#fiiBarGradUp)' : 'url(#fiiBarGradDown)'}
                          rx="1.5"
                          opacity="0.85"
                          className="transition-all hover:opacity-100"
                        >
                          <animate
                            attributeName="height"
                            from="0"
                            to={Math.max(2, Math.abs(fiiH))}
                            dur="0.8s"
                            fill="freeze"
                            calcMode="spline"
                            keySplines="0.4 0 0.2 1"
                          />
                          <animate
                            attributeName="y"
                            from={p.baselineY}
                            to={fiiH >= 0 ? p.fiiY : p.baselineY}
                            dur="0.8s"
                            fill="freeze"
                            calcMode="spline"
                            keySplines="0.4 0 0.2 1"
                          />
                        </rect>
                        {/* DII Bar */}
                        <rect
                          x={p.x + 1}
                          y={diiH >= 0 ? p.baselineY : p.baselineY}
                          width={barW}
                          height="0"
                          fill={p.raw.dii >= 0 ? 'url(#diiBarGradUp)' : 'url(#diiBarGradDown)'}
                          rx="1.5"
                          opacity="0.85"
                          className="transition-all hover:opacity-100"
                        >
                          <animate
                            attributeName="height"
                            from="0"
                            to={Math.max(2, Math.abs(diiH))}
                            dur="0.8s"
                            fill="freeze"
                            calcMode="spline"
                            keySplines="0.4 0 0.2 1"
                          />
                          <animate
                            attributeName="y"
                            from={p.baselineY}
                            to={diiH >= 0 ? p.diiY : p.baselineY}
                            dur="0.8s"
                            fill="freeze"
                            calcMode="spline"
                            keySplines="0.4 0 0.2 1"
                          />
                        </rect>
                        {/* Date labels along the bottom */}
                        {(() => {
                          const labelInterval = Math.ceil(cashChartSVG.points.length / 10);
                          if (idx % labelInterval === 0 || idx === cashChartSVG.points.length - 1) {
                            return (
                              <text
                                x={p.x}
                                y={cashChartSVG.height - 12}
                                fill="#64748b"
                                fontSize="9"
                                fontWeight="black"
                                textAnchor="middle"
                              >
                                {p.raw.date}
                              </text>
                            );
                          }
                          return null;
                        })()}
                      </g>
                    );
                  })}

                  {/* Nifty path area overlay */}
                  {cashChartSVG.niftyAreaPath && (
                    <path
                      d={cashChartSVG.niftyAreaPath}
                      fill="url(#niftyAreaGrad)"
                      className="nifty-area-path"
                    />
                  )}

                  {/* Nifty line overlay */}
                  <path
                    d={cashChartSVG.niftyPath}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="nifty-line-path"
                  />

                  {/* Left axis values (Net Cash Flow) */}
                  <text x={12} y={cashChartSVG.padding + 5} fill="#64748b" fontSize="9" fontWeight="bold">
                    +{formatNumberIndian(cashChartSVG.maxVal)} Cr
                  </text>
                  <text x={12} y={cashChartSVG.padding + cashChartSVG.chartH / 2 + 3} fill="#64748b" fontSize="9" fontWeight="bold">
                    0 Cr
                  </text>
                  <text x={12} y={cashChartSVG.padding + cashChartSVG.chartH + 3} fill="#64748b" fontSize="9" fontWeight="bold">
                    -{formatNumberIndian(cashChartSVG.maxVal)} Cr
                  </text>

                  {/* Right axis values (Nifty Spot Price or % Change) */}
                  {cashLineMode === 'price' ? (
                    <>
                      <text x={cashChartSVG.width - 45} y={cashChartSVG.padding + 5} fill="#c084fc" fontSize="9" fontWeight="bold" textAnchor="start">
                        {formatNumberIndian(cashChartSVG.maxNifty)}
                      </text>
                      <text x={cashChartSVG.width - 45} y={cashChartSVG.padding + cashChartSVG.chartH + 3} fill="#c084fc" fontSize="9" fontWeight="bold" textAnchor="start">
                        {formatNumberIndian(cashChartSVG.minNifty)}
                      </text>
                    </>
                  ) : (
                    <>
                      <text x={cashChartSVG.width - 45} y={cashChartSVG.padding + 5} fill="#c084fc" fontSize="9" fontWeight="bold" textAnchor="start">
                        +{cashChartSVG.maxPercent.toFixed(1)}%
                      </text>
                      <text x={cashChartSVG.width - 45} y={cashChartSVG.padding + cashChartSVG.chartH / 2 + 3} fill="#c084fc" fontSize="9" fontWeight="bold" textAnchor="start">
                        0.0%
                      </text>
                      <text x={cashChartSVG.width - 45} y={cashChartSVG.padding + cashChartSVG.chartH + 3} fill="#c084fc" fontSize="9" fontWeight="bold" textAnchor="start">
                        {cashChartSVG.minPercent.toFixed(1)}%
                      </text>
                    </>
                  )}

                  {/* Guideline and circular marker on hover */}
                  {hoveredChartPoint !== null && cashChartSVG.points[hoveredChartPoint] && (
                    <g>
                      <line
                        x1={cashChartSVG.points[hoveredChartPoint].x}
                        y1={cashChartSVG.padding}
                        x2={cashChartSVG.points[hoveredChartPoint].x}
                        y2={cashChartSVG.padding + cashChartSVG.chartH}
                        stroke="#6366f1"
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                        opacity="0.75"
                      />
                      <circle
                        cx={cashChartSVG.points[hoveredChartPoint].x}
                        cy={cashChartSVG.points[hoveredChartPoint].niftyY}
                        r="6"
                        fill="#a855f7"
                        stroke="#ffffff"
                        strokeWidth="2"
                        className="shadow-[0_0_10px_rgba(168,85,247,0.8)]"
                      />
                    </g>
                  )}

                  {/* Hotspots layer for easy mouse hover detection */}
                  {cashChartSVG.points.map((p, idx) => {
                    const sliceW = cashChartSVG.chartW / (cashChartSVG.points.length - 1 || 1);
                    return (
                      <rect
                        key={`hotspot-${idx}`}
                        x={p.x - sliceW / 2}
                        y={cashChartSVG.padding}
                        width={sliceW}
                        height={cashChartSVG.chartH}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoveredChartPoint(idx)}
                        onMouseLeave={() => setHoveredChartPoint(null)}
                      />
                    );
                  })}
                </svg>

                {/* Tooltip Overlay */}
                {hoveredChartPoint !== null && cashChartSVG.points[hoveredChartPoint] && (() => {
                  const p = cashChartSVG.points[hoveredChartPoint];
                  const isLeftHalf = p.x < cashChartSVG.width / 2;
                  return (
                    <div
                      className="absolute z-30 bg-slate-950/95 border border-indigo-500/30 rounded-2xl p-4 shadow-2xl backdrop-blur-md text-xs pointer-events-none transition-all duration-150"
                      style={{
                        left: isLeftHalf ? `calc(${(p.x / cashChartSVG.width) * 100}% + 12px)` : 'auto',
                        right: !isLeftHalf ? `calc(${100 - (p.x / cashChartSVG.width) * 100}% + 12px)` : 'auto',
                        top: '15%',
                        width: '260px'
                      }}
                    >
                      <div className="flex justify-between items-center border-b border-indigo-500/20 pb-2 mb-2">
                        <span className="font-black text-white uppercase tracking-wider">
                          {new Date(p.raw.rawDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded-lg text-[9px] font-bold text-indigo-400 uppercase">
                          {timeframe}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 font-medium flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 bg-sky-400 rounded-sm" /> FII Net Cash:
                          </span>
                          <span className={`font-black ${p.raw.fii >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatCr(p.raw.fii)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 font-medium flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm" /> DII Net Cash:
                          </span>
                          <span className={`font-black ${p.raw.dii >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatCr(p.raw.dii)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center border-t border-slate-900 pt-2">
                          <span className="text-slate-400 font-medium flex items-center gap-1.5">
                            <span className="w-2.5 h-1 bg-white/40 rounded-sm" /> Combined Net:
                          </span>
                          <span className={`font-black ${(p.raw.fii + p.raw.dii) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatCr(p.raw.fii + p.raw.dii)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center border-t border-slate-900 pt-2">
                          <span className="text-slate-400 font-medium flex items-center gap-1.5 text-purple-400">
                            📈 Nifty 50 Close:
                          </span>
                          <span className="font-black text-white">
                            ₹{formatNumberIndian(p.raw.nifty)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 font-medium flex items-center gap-1.5 text-purple-400">
                            📊 Change (Lookback):
                          </span>
                          <span className={`font-black ${p.raw.niftyPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {p.raw.niftyPercent >= 0 ? '+' : ''}{p.raw.niftyPercent.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <p className="text-xs font-bold text-slate-500 uppercase py-12 text-center">
                Not enough data points to plot flows chart
              </p>
            )}
          </div>

          {/* Paginated Historical Cash Flows Table */}
          <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 overflow-hidden">
            <h3 className="text-[11px] font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-indigo-500/15 pb-2">
              🗓️ Historical Cash Flows Log (FII vs DII)
            </h3>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-indigo-500/20 text-[9px] font-bold text-slate-400 uppercase tracking-widest select-none">
                    <th className="py-3 px-4 rounded-l-xl">Period / Date</th>
                    <th className="py-3 px-4 text-right">FII Cash Net</th>
                    <th className="py-3 px-4 text-right">DII Cash Net</th>
                    <th className="py-3 px-4 text-right">Combined Net</th>
                    <th className="py-3 px-4 text-right rounded-r-xl">NIFTY 50 Close</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-500/10">
                  {paginatedCashFlows.map((d, index) => {
                    const fii = d.fii_cash?.find(f => f.category === 'FII/FPI')?.net_value || 0;
                    const dii = d.fii_cash?.find(f => f.category === 'DII')?.net_value || 0;
                    const net = fii + dii;
                    const nifty = d.indices?.find(i => i.symbol_name === 'NIFTY 50')?.last_trade_price || 0;

                    return (
                      <tr key={index} className="hover:bg-slate-900/35 transition-all text-slate-300">
                        <td className="py-3.5 px-4 font-bold">
                          {d.displayDate || new Date(d.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className={`py-3.5 px-4 text-right font-black ${fii >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatCr(fii)}
                        </td>
                        <td className={`py-3.5 px-4 text-right font-black ${dii >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatCr(dii)}
                        </td>
                        <td className={`py-3.5 px-4 text-right font-black ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatCr(net)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-200">
                          ₹{nifty > 0 ? formatNumberIndian(nifty) : 'N/A'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination for Cash Table */}
            {cashTotalPages > 1 && (
              <div className="flex items-center justify-between gap-4 px-4 py-4 bg-slate-950/50 border border-indigo-500/20 mt-4 rounded-2xl">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  Page <span className="text-white">{cashPage}</span> of <span className="text-white">{cashTotalPages}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={cashPage === 1}
                    onClick={() => setCashPage(prev => Math.max(1, prev - 1))}
                    className="p-2 rounded-xl bg-slate-900 border border-indigo-500/20 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-600 hover:text-white transition-all hover:scale-105 active:scale-95"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    disabled={cashPage === cashTotalPages}
                    onClick={() => setCashPage(prev => Math.min(cashTotalPages, prev + 1))}
                    className="p-2 rounded-xl bg-slate-900 border border-indigo-500/20 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-600 hover:text-white transition-all hover:scale-105 active:scale-95"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PARTICIPANT F&O RATIOS */}
      {activeTab === 'fno' && (
        <div className="flex flex-col gap-6 animate-fadeIn">
          {/* Participant Filter Tabs */}
          <div className="flex flex-wrap gap-2 border-b border-indigo-500/20 pb-4">
            {(['Client', 'DII', 'FII', 'Pro', 'TOTAL'] as const).map(p => (
              <button
                key={p}
                onClick={() => setSelectedParticipant(p)}
                className={`px-5 py-2.5 border text-[10px] font-bold uppercase tracking-wider rounded-2xl transition-all ${selectedParticipant === p
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 border-indigo-400 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)] scale-[1.02]'
                  : 'border-indigo-500/20 text-slate-400 hover:text-white hover:bg-slate-900/40'
                  }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Participant Summary Header Card */}
          {currentParticipantOi && (
            <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 blur-3xl rounded-full pointer-events-none" />
              <div className="flex flex-col relative z-10">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Position Session Date</span>
                <span className="text-xl font-black text-white mt-1">
                  {new Date(currentParticipantOi.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric', weekday: 'long' })}
                </span>
                {currentParticipantOi.nifty50 && (
                  <span className="text-xs font-bold text-slate-400 mt-1 flex items-center gap-2">
                    Nifty 50 Close: <span className="text-amber-400 font-extrabold bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-lg shadow-sm">₹{formatNumberIndian(currentParticipantOi.nifty50)}</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-4 items-center flex-1 justify-end relative z-10 w-full md:w-auto">
                {/* Total Longs */}
                <div className="bg-slate-950/60 border border-indigo-500/10 rounded-2xl p-4 flex-1 md:flex-initial min-w-[140px] text-center hover:border-indigo-500/30 transition-all duration-300">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Total Long Contracts</span>
                  <div className="text-base font-black text-emerald-400 mt-1">
                    {formatContracts(currentParticipantOi.total_long_contracts)}
                  </div>
                  {formatDelta(currentParticipantOi.total_long_contracts, currentParticipantOi.prev_total_long_contracts) && (
                    <div className={`text-[10px] font-bold mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg ${formatDelta(currentParticipantOi.total_long_contracts, currentParticipantOi.prev_total_long_contracts)?.isBullish
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                      {formatDelta(currentParticipantOi.total_long_contracts, currentParticipantOi.prev_total_long_contracts)?.isBullish ? '▲' : '▼'}{' '}
                      {formatDelta(currentParticipantOi.total_long_contracts, currentParticipantOi.prev_total_long_contracts)?.text}
                    </div>
                  )}
                </div>

                {/* Total Shorts */}
                <div className="bg-slate-950/60 border border-indigo-500/10 rounded-2xl p-4 flex-1 md:flex-initial min-w-[140px] text-center hover:border-indigo-500/30 transition-all duration-300">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Total Short Contracts</span>
                  <div className="text-base font-black text-rose-400 mt-1">
                    {formatContracts(currentParticipantOi.total_short_contracts)}
                  </div>
                  {formatDelta(currentParticipantOi.total_short_contracts, currentParticipantOi.prev_total_short_contracts) && (
                    <div className={`text-[10px] font-bold mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg ${formatDelta(currentParticipantOi.total_short_contracts, currentParticipantOi.prev_total_short_contracts)?.isBullish
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                      {formatDelta(currentParticipantOi.total_short_contracts, currentParticipantOi.prev_total_short_contracts)?.isBullish ? '▲' : '▼'}{' '}
                      {formatDelta(currentParticipantOi.total_short_contracts, currentParticipantOi.prev_total_short_contracts)?.text}
                    </div>
                  )}
                </div>

                {/* Net Position */}
                {(() => {
                  const net = currentParticipantOi.total_long_contracts - currentParticipantOi.total_short_contracts;
                  const prevNet = (currentParticipantOi.prev_total_long_contracts !== undefined && currentParticipantOi.prev_total_short_contracts !== undefined)
                    ? currentParticipantOi.prev_total_long_contracts - currentParticipantOi.prev_total_short_contracts
                    : undefined;
                  const delta = formatDelta(net, prevNet);
                  return (
                    <div className="bg-slate-950/60 border border-indigo-500/10 rounded-2xl p-4 flex-1 md:flex-initial min-w-[140px] text-center hover:border-indigo-500/30 transition-all duration-300">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Overall Net Position</span>
                      <div className={`text-base font-black mt-1 ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {net >= 0 ? '+' : ''}{formatContracts(net)}
                      </div>
                      {delta && (
                        <div className={`text-[10px] font-bold mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg ${delta.isBullish
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                          {delta.isBullish ? '▲' : '▼'} {delta.text}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {currentParticipantOi ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Generate 6 Instrument Cards */}
              {[
                {
                  title: 'Index Futures',
                  long: currentParticipantOi.future_index_long,
                  short: currentParticipantOi.future_index_short,
                  prevLong: currentParticipantOi.prev_future_index_long,
                  prevShort: currentParticipantOi.prev_future_index_short,
                },
                {
                  title: 'Stock Futures',
                  long: currentParticipantOi.future_stock_long,
                  short: currentParticipantOi.future_stock_short,
                  prevLong: currentParticipantOi.prev_future_stock_long,
                  prevShort: currentParticipantOi.prev_future_stock_short,
                },
                {
                  title: 'Index Call Options',
                  long: currentParticipantOi.option_index_call_long,
                  short: currentParticipantOi.option_index_call_short,
                  prevLong: currentParticipantOi.prev_option_index_call_long,
                  prevShort: currentParticipantOi.prev_option_index_call_short,
                },
                {
                  title: 'Index Put Options',
                  long: currentParticipantOi.option_index_put_long,
                  short: currentParticipantOi.option_index_put_short,
                  prevLong: currentParticipantOi.prev_option_index_put_long,
                  prevShort: currentParticipantOi.prev_option_index_put_short,
                },
                {
                  title: 'Stock Call Options',
                  long: currentParticipantOi.option_stock_call_long,
                  short: currentParticipantOi.option_stock_call_short,
                  prevLong: currentParticipantOi.prev_option_stock_call_long,
                  prevShort: currentParticipantOi.prev_option_stock_call_short,
                },
                {
                  title: 'Stock Put Options',
                  long: currentParticipantOi.option_stock_put_long,
                  short: currentParticipantOi.option_stock_put_short,
                  prevLong: currentParticipantOi.prev_option_stock_put_long,
                  prevShort: currentParticipantOi.prev_option_stock_put_short,
                }
              ].map((card, i) => {
                const total = card.long + card.short;
                const ratio = total > 0 ? (card.long / total) * 100 : 50;

                const longDelta = formatDelta(card.long, card.prevLong);
                const shortDelta = formatDelta(card.short, card.prevShort);

                const net = card.long - card.short;
                const prevNet = (card.prevLong !== undefined && card.prevShort !== undefined) ? card.prevLong - card.prevShort : undefined;
                const netDelta = formatDelta(net, prevNet);

                return (
                  <div key={i} className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 flex flex-col justify-between hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 shadow-xl shadow-indigo-500/5">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider border-b border-indigo-500/15 pb-2 mb-3">
                        {card.title}
                      </h4>

                      {/* Long side */}
                      <div className="flex justify-between items-center text-xs mb-2">
                        <span className="text-slate-400 font-medium">Long Positions:</span>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-200">{formatContracts(card.long)}</span>
                          {longDelta && (
                            <span className={`text-[9px] font-black flex items-center ${longDelta.isBullish ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {longDelta.isBullish ? '▲' : '▼'} {longDelta.text}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Short side */}
                      <div className="flex justify-between items-center text-xs mb-3">
                        <span className="text-slate-400 font-medium">Short Positions:</span>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-200">{formatContracts(card.short)}</span>
                          {shortDelta && (
                            <span className={`text-[9px] font-black flex items-center ${shortDelta.isBullish ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {shortDelta.isBullish ? '▲' : '▼'} {shortDelta.text}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Ratio split bar visualizer */}
                      <div className="space-y-1.5 my-4">
                        <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          <span>Long {ratio.toFixed(1)}%</span>
                          <span>Short {(100 - ratio).toFixed(1)}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-rose-500/20 rounded-full flex overflow-hidden border border-slate-950">
                          <div
                            className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-1000"
                            style={{ width: `${ratio}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Net Position Footer */}
                    <div className="bg-slate-950/80 border border-indigo-500/10 rounded-2xl p-3 flex justify-between items-center mt-2 hover:border-indigo-500/20 transition-all">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Net Position:</span>
                      <div className="flex items-center gap-2 text-right">
                        <span className={`text-xs font-black ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {net >= 0 ? '+' : ''}{formatContracts(net)}
                        </span>
                        {netDelta && (
                          <span className={`text-[9px] font-bold ${netDelta.isBullish ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ({netDelta.text})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs font-bold text-slate-500 uppercase py-12 text-center border border-slate-800/60 rounded-3xl">
              OI Position details not loaded
            </p>
          )}
        </div>
      )}

      {/* TAB 4: DERIVATIVES SUMMARY */}
      {activeTab === 'summary' && (
        <div className="flex flex-col gap-6 animate-fadeIn">
          {/* Breadth KPI Cards & Ratio bar */}
          {summaryKPIs && (
            <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 flex flex-col gap-5 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300">
              <div className="flex justify-between items-center border-b border-indigo-500/15 pb-3">
                <h3 className="text-[11px] font-bold text-white uppercase tracking-widest">
                  ⚖️ F&O Derivatives Breadth Balance
                </h3>
                <span className="text-[9px] font-bold text-slate-400 uppercase bg-slate-950/60 border border-indigo-500/15 px-3 py-1 rounded-xl">
                  Total Analyzed: {summaryKPIs.total} Scrips
                </span>
              </div>

              {/* Horizontal visual ratio bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
                  <span className="text-emerald-400">Bullish Sentiment ({summaryKPIs.bullishPer.toFixed(1)}%)</span>
                  <span className="text-rose-400">Bearish Sentiment ({summaryKPIs.bearishPer.toFixed(1)}%)</span>
                </div>
                <div className="w-full h-3 bg-rose-500/20 rounded-full flex overflow-hidden border border-slate-950">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-700"
                    style={{ width: `${summaryKPIs.bullishPer}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-slate-400 font-bold uppercase tracking-widest pt-1">
                  <span>{summaryKPIs.bullishCount} Bullish (Long BU + Short Covering)</span>
                  <span>{summaryKPIs.bearishCount} Bearish (Short BU + Long Unwinding)</span>
                </div>
              </div>

              {/* Detailed sub-KPI grid cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
                <div className="bg-slate-950/60 border border-indigo-500/10 rounded-2xl p-4 text-center hover:border-indigo-500/30 transition-all duration-300">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Avg Price Change</span>
                  <p className={`text-base font-black mt-1 ${summaryKPIs.avgPriceChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {summaryKPIs.avgPriceChange >= 0 ? '+' : ''}{summaryKPIs.avgPriceChange.toFixed(2)}%
                  </p>
                </div>
                <div className="bg-slate-950/60 border border-indigo-500/10 rounded-2xl p-4 text-center hover:border-indigo-500/30 transition-all duration-300">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Avg OI Change</span>
                  <p className={`text-base font-black mt-1 ${summaryKPIs.avgOiChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {summaryKPIs.avgOiChange >= 0 ? '+' : ''}{summaryKPIs.avgOiChange.toFixed(2)}%
                  </p>
                </div>
                <div className="bg-slate-950/60 border border-emerald-500/10 rounded-2xl p-4 text-center hover:border-emerald-500/30 transition-all duration-300">
                  <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">Long BU / Short Cov</span>
                  <p className="text-base font-black text-emerald-400 mt-1">
                    {summaryKPIs.longBuildUp} / {summaryKPIs.shortCovering}
                  </p>
                </div>
                <div className="bg-slate-950/60 border border-rose-500/10 rounded-2xl p-4 text-center hover:border-rose-500/30 transition-all duration-300">
                  <span className="text-[9px] font-bold text-rose-400 uppercase tracking-widest">Short BU / Long Unw</span>
                  <p className="text-base font-black text-rose-400 mt-1">
                    {summaryKPIs.shortBuildUp} / {summaryKPIs.longUnwinding}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Table search & built-up state filters */}
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-4 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300">
            {/* Search box */}
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3.5 top-3.5 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search scrip symbol..."
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value);
                  setSummaryPage(1);
                }}
                className="w-full pl-10 pr-4 py-3 bg-slate-950/90 border border-indigo-500/25 rounded-2xl text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
              />
            </div>

            {/* Built-up state selector tabs */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: 'All Stocks' },
                { id: 'long_build_up', label: 'Long Build Up' },
                { id: 'short_covering', label: 'Short Covering' },
                { id: 'short_build_up', label: 'Short Build Up' },
                { id: 'long_unwinding', label: 'Long Unwinding' }
              ].map(btn => (
                <button
                  key={btn.id}
                  onClick={() => {
                    setSummaryFilter(btn.id as any);
                    setSummaryPage(1);
                  }}
                  className={`px-4 py-2 text-[9px] font-bold uppercase tracking-wider rounded-xl transition-all border ${summaryFilter === btn.id
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 border-indigo-400 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)] scale-[1.02]'
                    : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-900/40'
                    }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table list */}
          <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 shadow-xl shadow-indigo-500/5 hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition-all duration-300 overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-indigo-500/20 text-[9px] font-bold text-slate-400 uppercase tracking-widest select-none">
                    <th className="py-3 px-3 cursor-pointer hover:text-white transition-colors rounded-l-xl" onClick={() => handleSort('symbol_name')}>
                      Symbol {sortField === 'symbol_name' && (sortOrder === 'asc' ? ' ▲' : ' ▼')}
                    </th>
                    <th className="py-3 px-3 text-center">Built Up State</th>
                    <th className="py-3 px-3 text-right">LTP (Spot)</th>
                    <th className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('change_ltp_per')}>
                      LTP Change % {sortField === 'change_ltp_per' && (sortOrder === 'asc' ? ' ▲' : ' ▼')}
                    </th>
                    <th className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('oi')}>
                      Open Interest {sortField === 'oi' && (sortOrder === 'asc' ? ' ▲' : ' ▼')}
                    </th>
                    <th className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('change_oi_per')}>
                      OI Change % {sortField === 'change_oi_per' && (sortOrder === 'asc' ? ' ▲' : ' ▼')}
                    </th>
                    <th className="py-3 px-3 text-center rounded-r-xl">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {paginatedSummary.length > 0 ? (
                    paginatedSummary.map((item, index) => {
                      const badge = getBuiltUpLabel(item.built_up);
                      const isExpanded = expandedSymbol === item.symbol_name;

                      return (
                        <React.Fragment key={index}>
                          <tr
                            onClick={() => setExpandedSymbol(isExpanded ? null : item.symbol_name)}
                            className={`group hover:bg-slate-900/35 transition-all duration-150 cursor-pointer text-slate-300 ${isExpanded ? 'bg-indigo-500/5' : ''}`}
                          >
                            <td className="py-3.5 px-3 font-bold text-white uppercase tracking-tight">
                              {item.symbol_name}
                            </td>
                            <td className="py-3.5 px-3 text-center">
                              <span className={`px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded-lg ${badge.style}`}>
                                {badge.text}
                              </span>
                            </td>
                            <td className="py-3.5 px-3 text-right font-bold text-slate-200">
                              ₹{formatCurrencyPrecise(item.last_price ?? 0)}
                            </td>
                            <td className={`py-3.5 px-3 text-right font-bold ${(item.change_ltp_per ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {(item.change_ltp_per ?? 0) >= 0 ? '+' : ''}{(item.change_ltp_per ?? 0).toFixed(2)}%
                            </td>
                            <td className="py-3.5 px-3 text-right font-bold text-slate-300">
                              {formatNumberIndian(item.oi ?? 0)}
                            </td>
                            <td className={`py-3.5 px-3 text-right font-bold ${(item.change_oi_per ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {(item.change_oi_per ?? 0) >= 0 ? '+' : ''}{(item.change_oi_per ?? 0).toFixed(2)}%
                            </td>
                            <td className="py-3.5 px-3 text-center">
                              <button className="text-slate-500 hover:text-white transition-colors">
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            </td>
                          </tr>

                          {/* Accordion Expandable Row */}
                          {isExpanded && (
                            <tr className="bg-slate-950/80">
                              <td colSpan={7} className="p-4 border-t border-b border-indigo-500/20">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-400">
                                  <div className="bg-slate-900/80 border border-indigo-500/10 rounded-2xl p-4 hover:border-indigo-500/30 transition-all duration-300">
                                    <h5 className="font-bold text-white uppercase text-[9px] tracking-wider mb-2 border-b border-indigo-500/15 pb-1">
                                      Price Action Range
                                    </h5>
                                    <div className="space-y-1 text-[11px]">
                                      <div className="flex justify-between"><span>Open Price:</span> <span className="font-semibold text-slate-200">₹{formatCurrencyPrecise(item.open ?? 0)}</span></div>
                                      <div className="flex justify-between"><span>High Price:</span> <span className="font-semibold text-slate-200">₹{formatCurrencyPrecise(item.high ?? 0)}</span></div>
                                      <div className="flex justify-between"><span>Low Price:</span> <span className="font-semibold text-slate-200">₹{formatCurrencyPrecise(item.low ?? 0)}</span></div>
                                    </div>
                                  </div>

                                  <div className="bg-slate-900/80 border border-indigo-500/10 rounded-2xl p-4 hover:border-indigo-500/30 transition-all duration-300">
                                    <h5 className="font-bold text-white uppercase text-[9px] tracking-wider mb-2 border-b border-indigo-500/15 pb-1">
                                      Absolute Position Shifts
                                    </h5>
                                    <div className="space-y-1 text-[11px]">
                                      <div className="flex justify-between">
                                        <span>Price Change:</span>
                                        <span className={`font-semibold ${(item.change_ltp ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                          ₹{(item.change_ltp ?? 0) >= 0 ? '+' : ''}{formatNumberIndian(item.change_ltp ?? 0)}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>OI Change:</span>
                                        <span className={`font-semibold ${(item.change_oi ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                          {(item.change_oi ?? 0) >= 0 ? '+' : ''}{formatNumberIndian(item.change_oi ?? 0)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="bg-slate-900/80 border border-indigo-500/10 rounded-2xl p-4 hover:border-indigo-500/30 transition-all duration-300">
                                    <h5 className="font-bold text-white uppercase text-[9px] tracking-wider mb-2 border-b border-indigo-500/15 pb-1">
                                      Derivative Specifications
                                    </h5>
                                    <div className="space-y-1 text-[11px]">
                                      <div className="flex justify-between">
                                        <span>Expiry Date:</span>
                                        <span className="font-semibold text-slate-200">
                                          {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Last Trade Time:</span>
                                        <span className="font-semibold text-slate-200">
                                          {item.last_trade_time ? new Date(item.last_trade_time).toLocaleTimeString() : 'N/A'}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-xs font-bold text-slate-500 uppercase">
                        No stocks matching current filters found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-4 bg-slate-950/50 border border-indigo-500/20 mt-6 rounded-2xl">
              <div className="flex items-center gap-4">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  Showing <span className="text-white">{filteredSummary.length > 0 ? (summaryPage - 1) * itemsPerPage + 1 : 0}</span> to <span className="text-white">{Math.min(summaryPage * itemsPerPage, filteredSummary.length)}</span> of <span className="text-white">{filteredSummary.length}</span> stocks
                </span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setSummaryPage(1);
                  }}
                  className="bg-slate-900 border border-indigo-500/20 text-[10px] font-bold text-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                >
                  {[12, 24, 50, 100].map(val => (
                    <option key={val} value={val}>{val} per page</option>
                  ))}
                </select>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    disabled={summaryPage === 1}
                    onClick={() => setSummaryPage(prev => Math.max(1, prev - 1))}
                    className="p-2 rounded-xl bg-slate-900 border border-indigo-500/20 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-600 hover:text-white transition-all hover:scale-105 active:scale-95 shadow-md"
                  >
                    <ChevronLeft size={16} />
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum = summaryPage;
                      if (totalPages <= 5) pageNum = i + 1;
                      else if (summaryPage <= 3) pageNum = i + 1;
                      else if (summaryPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                      else pageNum = summaryPage - 2 + i;

                      return (
                        <button
                          key={pageNum}
                          onClick={() => setSummaryPage(pageNum)}
                          className={`w-8 h-8 rounded-xl text-[10px] font-bold transition-all ${summaryPage === pageNum
                            ? 'bg-gradient-to-r from-indigo-600 to-purple-600 border-indigo-400 text-white shadow-[0_0_10px_rgba(99,102,241,0.3)] scale-105'
                            : 'bg-slate-900 border border-indigo-500/20 text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                            }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    disabled={summaryPage === totalPages}
                    onClick={() => setSummaryPage(prev => Math.min(totalPages, prev + 1))}
                    className="p-2 rounded-xl bg-slate-900 border border-indigo-500/20 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-600 hover:text-white transition-all hover:scale-105 active:scale-95 shadow-md"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isPasteModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Ambient Background Glow (Slate/Indigo) */}
            <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl -z-10" />
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl -z-10" />

            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
              <div className="flex items-center gap-2.5">
                <Database size={20} className="text-emerald-400" />
                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Manual JSON Import</h3>
              </div>
              <button
                onClick={() => {
                  setIsPasteModalOpen(false);
                  setPasteText('');
                  setPasteFeedback(null);
                }}
                className="text-slate-400 hover:text-white p-1.5 hover:bg-slate-800 rounded-lg transition-all"
              >
                <ArrowLeft size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              If the automated crawler fails, you can paste the JSON response directly from the browser's Network tab.
              Go to <strong className="text-white">stockezee.com</strong>, inspect network, search for <code className="text-indigo-400 bg-slate-950/60 px-1 py-0.5 rounded">fii-dii-data.json</code> or <code className="text-indigo-400 bg-slate-950/60 px-1 py-0.5 rounded">participant-oi-chart-data</code>, copy the full Response, and paste it below.
            </p>

            <div className="space-y-4">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste the raw JSON or JS array here..."
                className="w-full h-64 bg-slate-950/80 border border-slate-850 focus:border-indigo-500 rounded-2xl p-4 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all resize-none scrollbar-thin"
              />

              {pasteFeedback && (
                <div className={`p-4 rounded-2xl border text-xs leading-relaxed flex items-start gap-2.5 ${
                  pasteFeedback.success 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}>
                  <div className="mt-0.5 font-bold uppercase tracking-wider">
                    {pasteFeedback.success ? 'Success:' : 'Error:'}
                  </div>
                  <div>{pasteFeedback.message}</div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsPasteModalOpen(false);
                    setPasteText('');
                    setPasteFeedback(null);
                  }}
                  className="px-5 py-2.5 rounded-xl border border-slate-805 text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onManualPaste) {
                      const res = onManualPaste(pasteText);
                      setPasteFeedback(res);
                      if (res.success) {
                        setTimeout(() => {
                          setIsPasteModalOpen(false);
                          setPasteText('');
                          setPasteFeedback(null);
                        }, 1200);
                      }
                    }
                  }}
                  disabled={!pasteText.trim()}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/20"
                >
                  Import Data
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiiDiiPulseDashboard;
