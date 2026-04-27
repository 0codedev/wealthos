import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { CustomTooltip } from '../shared/CustomTooltip';
import { DashboardSkeleton } from '../shared/Skeleton';
import { StateSurface } from '../shared/SurfacePrimitives';
import { isMarketHours } from '../../types/trust';
import {
    Globe, TrendingUp, TrendingDown, Activity,
    DollarSign, Droplets, Zap, AlertTriangle, Info,
    Coins, Scale, Calendar, BarChart3, Clock, RefreshCw, Loader2, Brain, Sparkles
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell, ComposedChart, Line, Legend
} from 'recharts';
import { marketDataService, ConsolidatedFiiDii, SectorHeatmapData, EconomicEvent, EarningsEvent } from '../../services/MarketDataService';
import { dhanBrokerService } from '../../services/DhanBrokerService';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';
import TabHero from '../shared/TabHero';
import { Investment } from '../../types';
import { db } from '../../database';
import CatalystVelocityDeck from '../market/CatalystVelocityDeck';

// --- INITIAL STATE (Skeleton) ---
const INITIAL_MACRO_INDICATORS = [
    {
        id: 'vix',
        name: 'India VIX',
        label: 'Fear Index',
        value: 0,
        change: 0,
        unit: '',
        icon: Activity,
        color: '#f59e0b', // Amber
        data: [] as any[],
        desc: 'Market volatility expectation. < 15 is calm, > 20 is fearful.',
        source: 'mock'
    },
    {
        id: 'usdinr',
        name: 'USD/INR',
        label: 'Currency',
        value: 0,
        change: 0,
        unit: '₹',
        icon: DollarSign,
        color: '#10b981', // Emerald
        data: [] as any[],
        desc: 'Rupee strength. Rising USD hurts importers, helps IT/Pharma.',
        source: 'mock'
    },
    {
        id: 'crude',
        name: 'Brent Crude',
        label: 'Inflation Proxy',
        value: 0,
        change: 0,
        unit: '$',
        icon: Droplets,
        color: '#ef4444', // Red
        data: [] as any[],
        desc: 'Oil prices. High oil = High inflation for India.',
        source: 'mock'
    },
    {
        id: 'us10y',
        name: 'US 10Y Yield',
        label: 'Global Liquidity',
        value: 0,
        change: 0,
        unit: '%',
        icon: Zap,
        color: '#6366f1', // Indigo
        data: [] as any[],
        desc: 'Risk-free rate. High yields suck capital from emerging markets.',
        source: 'mock'
    },
    {
        id: 'gold',
        name: 'Gold (USD)',
        label: 'Safe Haven',
        value: 0,
        change: 0,
        unit: '$',
        icon: Coins,
        color: '#eab308', // Yellow
        data: [] as any[],
        desc: 'Gold prices. Rises during uncertainty and inflation.',
        source: 'mock'
    },
    {
        id: 'dxy',
        name: 'Dollar Index',
        label: 'USD Strength',
        value: 0,
        change: 0,
        unit: '',
        icon: Scale,
        color: '#64748b', // Slate
        data: [] as any[],
        desc: 'Strength of USD vs major currencies. Inverse to emerging markets.',
        source: 'mock'
    }
];

const INITIAL_GLOBAL_INDICES = [
    { name: 'NIFTY 50', symbol: '^NSEI', value: 0, change: 0 },
    { name: 'SENSEX', symbol: '^BSESN', value: 0, change: 0 },
    { name: 'NIFTY BANK', symbol: '^NSEBANK', value: 0, change: 0 },
    { name: 'INDIA VIX', symbol: '^INDIAVIX', value: 0, change: 0 },
    { name: 'S&P 500', symbol: '^GSPC', value: 0, change: 0 },
    { name: 'NASDAQ', symbol: '^IXIC', value: 0, change: 0 },
    { name: 'DOW JONES', symbol: '^DJI', value: 0, change: 0 },
    { name: 'NIKKEI 225', symbol: '^N225', value: 0, change: 0 },
    { name: 'DAX 40', symbol: '^GDAXI', value: 0, change: 0 },
    { name: 'FTSE 100', symbol: '^FTSE', value: 0, change: 0 },
    { name: 'HANG SENG', symbol: '^HSI', value: 0, change: 0 },
    { name: 'BITCOIN', symbol: 'BTC-USD', value: 0, change: 0 },
];

const IMPACT_RULES = [
    {
        condition: (indicators: any) => {
            const i = indicators.find((x: any) => x.id === 'crude');
            return i ? i.change > 1 : false;
        },
        impact: 'NEGATIVE',
        sectors: ['Paints', 'Tyres', 'Aviation'],
        reason: 'Rising Crude Oil prices increase input costs for these sectors.'
    },
    {
        condition: (indicators: any) => {
            const i = indicators.find((x: any) => x.id === 'usdinr');
            return i ? i.change > 0.2 : false;
        },
        impact: 'POSITIVE',
        sectors: ['IT Services', 'Pharma'],
        reason: 'Weaker Rupee increases export earnings for IT and Pharma companies.'
    },
    {
        condition: (indicators: any) => {
            const i = indicators.find((x: any) => x.id === 'us10y');
            return i ? i.value > 4.5 : false;
        },
        impact: 'NEGATIVE',
        sectors: ['Banking', 'NBFCs'],
        reason: 'High US Yields trigger FII selling in financial stocks.'
    },
    {
        condition: (indicators: any) => {
            const i = indicators.find((x: any) => x.id === 'vix');
            return i ? i.value < 12 : false;
        },
        impact: 'POSITIVE',
        sectors: ['High Beta', 'Midcaps'],
        reason: 'Low volatility environment encourages risk-taking in mid/small caps.'
    },
    {
        condition: (indicators: any) => {
            const i = indicators.find((x: any) => x.id === 'gold');
            return i ? i.change > 1 : false;
        },
        impact: 'POSITIVE',
        sectors: ['Gold Loan NBFCs', 'Jewellery'],
        reason: 'Rising Gold prices increase collateral value and inventory value.'
    }
];

const ECONOMIC_CALENDAR: EconomicEvent[] = [
    { event: 'RBI Interest Rate Decision', date: 'Jul 24 10:00', impact: 'HIGH', forecast: '6.50%', previous: '6.50%' },
    { event: 'India CPI Inflation YoY', date: 'Jul 26 17:30', impact: 'HIGH', forecast: '4.80%', previous: '5.10%' },
    { event: 'US Fed Interest Rate Decision', date: 'Jul 31 23:30', impact: 'HIGH', forecast: '5.25%', previous: '5.50%' },
    { event: 'India Manufacturing PMI', date: 'Aug 01 10:30', impact: 'MEDIUM', forecast: '58.3', previous: '57.5' },
    { event: 'India Industrial Production (IIP)', date: 'Aug 04 17:30', impact: 'MEDIUM', forecast: '5.2%', previous: '5.0%' },
    { event: 'US Non-Farm Payrolls', date: 'Aug 06 18:00', impact: 'HIGH', forecast: '190K', previous: '206K' },
    { event: 'India GDP Growth Rate YoY', date: 'Aug 12 17:30', impact: 'HIGH', forecast: '6.9%', previous: '7.8%' },
    { event: 'India Trade Balance', date: 'Aug 15 17:30', impact: 'MEDIUM', forecast: '-$21.5B', previous: '-$23.8B' }
];

const SECTOR_HEATMAP_DATA: SectorHeatmapData[] = [
    { name: 'Banks', value: 0.85 },
    { name: 'IT', value: -1.20 },
    { name: 'Auto', value: 0.45 },
    { name: 'FMCG', value: 0.12 },
    { name: 'Pharma', value: -0.65 },
    { name: 'Energy', value: 1.15 },
    { name: 'Metal', value: 1.80 },
    { name: 'Realty', value: -0.90 },
    { name: 'PSU Bank', value: 2.10 },
    { name: 'Fin Service', value: 0.60 },
    { name: 'Media', value: -1.45 },
    { name: 'Infra', value: 0.30 },
    { name: 'Commodities', value: 1.05 },
    { name: 'Healthcare', value: -0.40 },
    { name: 'Oil & Gas', value: 0.95 },
    { name: 'Cons Durables', value: -0.25 },
    { name: 'Pvt Bank', value: 0.70 }
];

// Fear & Greed Index Component
const FearGreedGauge: React.FC<{ value: number }> = ({ value }) => {
    const getLabel = (v: number) => {
        if (v <= 25) return { text: 'Extreme Fear', color: '#ef4444' };
        if (v <= 45) return { text: 'Fear', color: '#f97316' };
        if (v <= 55) return { text: 'Neutral', color: '#eab308' };
        if (v <= 75) return { text: 'Greed', color: '#84cc16' };
        return { text: 'Extreme Greed', color: '#22c55e' };
    };

    const { text, color } = getLabel(value);
    const rotation = (value / 100) * 180 - 90; // -90 to 90 degrees

    return (
        <div className="relative flex flex-col items-center">
            <div className="relative w-48 h-24 overflow-hidden">
                {/* Background arc */}
                <div className="absolute inset-0 rounded-t-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 opacity-20" />
                <svg viewBox="0 0 200 100" className="w-full h-full">
                    <defs>
                        <linearGradient id="fearGreedGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#ef4444" />
                            <stop offset="25%" stopColor="#f97316" />
                            <stop offset="50%" stopColor="#eab308" />
                            <stop offset="75%" stopColor="#84cc16" />
                            <stop offset="100%" stopColor="#22c55e" />
                        </linearGradient>
                    </defs>
                    <path
                        d="M 10 100 A 90 90 0 0 1 190 100"
                        fill="none"
                        stroke="url(#fearGreedGradient)"
                        strokeWidth="12"
                        strokeLinecap="round"
                    />
                    {/* Needle */}
                    <g transform={`rotate(${rotation}, 100, 100)`}>
                        <line x1="100" y1="100" x2="100" y2="25" stroke={color} strokeWidth="3" strokeLinecap="round" />
                        <circle cx="100" cy="100" r="8" fill={color} />
                    </g>
                </svg>
            </div>
            <div className="text-center mt-2">
                <span className="text-3xl font-black" style={{ color }}>{value}</span>
                <p className="text-sm font-bold" style={{ color }}>{text}</p>
            </div>
        </div>
    );
};

const formatDate = (dateStr: string, isMonthly?: boolean) => {
    if (!dateStr || dateStr.includes('Syncing') || dateStr.includes('Awaiting')) return dateStr;
    const parts = dateStr.split('-');
    if (parts.length < 2) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[parseInt(parts[1], 10) - 1] || '';
    if (isMonthly || parts.length === 2) {
        return `${month} ${parts[0].slice(-2)}`;
    }
    const day = parts[2];
    return `${day} ${month}`;
};

const FIIDIIActivityPanel: React.FC<{ data: ConsolidatedFiiDii[] }> = ({ data }) => {
    const today = data[0];
    const yesterday = data[1] || today;
    
    if (!today || today.date.includes('Syncing') || today.date.includes('Awaiting')) {
        return (
            <div className="flex h-48 items-center justify-center text-slate-500">
                <Loader2 className="animate-spin text-indigo-500 mr-2" size={16} />
                Awaiting FII/DII synchronization...
            </div>
        );
    }

    const formatCr = (val: number) => {
        const sign = val >= 0 ? '+' : '';
        return `${sign}${val.toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`;
    };

    const getTrendIcon = (curr: number, prev: number) => {
        if (curr > prev) return <TrendingUp size={12} className="text-emerald-500" />;
        return <TrendingDown size={12} className="text-rose-500" />;
    };

    const getSignalColor = (sig: string) => {
        if (sig === 'Accumulation') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20';
        if (sig.includes('Distribution')) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
        if (sig.includes('Weakening')) return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20';
        return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20';
    };

    // Calculate Tug of War shares
    const fiiAbs = Math.abs(today.fii_cash);
    const diiAbs = Math.abs(today.dii_cash);
    const totalAbs = fiiAbs + diiAbs;
    const fiiPct = totalAbs > 0 ? (fiiAbs / totalAbs) * 100 : 50;
    const diiPct = totalAbs > 0 ? (diiAbs / totalAbs) * 100 : 50;

    const netCash = today.fii_cash + today.dii_cash;
    const isNetPositive = netCash >= 0;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">FII Cash Net</p>
                    <p className={`text-sm font-black tracking-tight mt-1 ${today.fii_cash >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {formatCr(today.fii_cash)}
                    </p>
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400">
                        {getTrendIcon(today.fii_cash, yesterday.fii_cash)}
                        <span>vs yesterday</span>
                    </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">DII Cash Net</p>
                    <p className={`text-sm font-black tracking-tight mt-1 ${today.dii_cash >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {formatCr(today.dii_cash)}
                    </p>
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400">
                        {getTrendIcon(today.dii_cash, yesterday.dii_cash)}
                        <span>vs yesterday</span>
                    </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200/50 dark:border-slate-800/50 col-span-2">
                    <div className="flex justify-between items-center">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">FII Derivatives (FO)</p>
                        <span className="text-[9px] font-mono text-slate-400">{today.date}</span>
                    </div>
                    <p className={`text-sm font-black tracking-tight mt-1 ${today.fii_fo >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {formatCr(today.fii_fo)}
                    </p>
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400">
                        {getTrendIcon(today.fii_fo, yesterday.fii_fo)}
                        <span>vs yesterday</span>
                    </div>
                </div>
            </div>

            {/* FII Flow Signal Badge */}
            <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">FII Flow Signal:</span>
                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${getSignalColor(today.fii_flow_signal || 'Neutral')}`}>
                    {today.fii_flow_signal || 'Neutral'}
                </span>
            </div>

            {/* Tug of War */}
            <div className="space-y-2 pt-2">
                <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                    <span>FII Net (Rose)</span>
                    <span>DII Net (Emerald)</span>
                </div>
                <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
                    <div 
                        className="bg-rose-500 h-full transition-all duration-500" 
                        style={{ width: `${today.fii_cash < 0 ? fiiPct : 0}%` }}
                    />
                    <div 
                        className="bg-emerald-500 h-full flex-1 transition-all duration-500" 
                    />
                    <div 
                        className="bg-emerald-500 h-full transition-all duration-500" 
                        style={{ width: `${today.dii_cash > 0 ? diiPct : 0}%` }}
                    />
                </div>
                <p className="text-[10px] text-slate-500 leading-normal font-medium">
                    FIIs net {today.fii_cash >= 0 ? 'bought' : 'sold'} ₹{Math.abs(today.fii_cash).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr | DIIs net {today.dii_cash >= 0 ? 'bought' : 'sold'} ₹{Math.abs(today.dii_cash).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr &rarr; Net Inst: <span className={`font-black ${isNetPositive ? 'text-emerald-500' : 'text-rose-500'}`}>{formatCr(netCash)}</span>
                </p>
            </div>
        </div>
    );
};

const FiiDiiChartTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;

    const data: ConsolidatedFiiDii = payload[0]?.payload;
    if (!data) return null;

    const fiiVal = data.fii_cash || 0;
    const diiVal = data.dii_cash || 0;
    const netInstitutional = fiiVal + diiVal;
    const niftyPct = data.nifty_pct || 0;

    const signal = fiiVal > 0 && diiVal > 0 
        ? 'Dual Buying (Bullish)'
        : fiiVal < 0 && diiVal < 0
        ? 'Dual Selling (Bearish)'
        : fiiVal > 0
        ? 'FII Accumulation'
        : 'DII Support (FII Outflow)';

    return (
        <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl p-4 shadow-2xl space-y-3 min-w-[230px] text-xs text-white">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">Session</span>
                    <h4 className="text-xs font-black text-white">{data.date || label}</h4>
                </div>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                    fiiVal > 0 
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}>
                    {signal}
                </span>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fiiVal >= 0 ? '#10b981' : '#ef4444' }} />
                        <span className="font-semibold text-slate-300">FII Cash</span>
                    </div>
                    <span className={`font-mono font-bold ${fiiVal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {fiiVal >= 0 ? '+' : ''}₹{fiiVal.toLocaleString('en-IN')} Cr
                    </span>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shrink-0" />
                        <span className="font-semibold text-slate-300">DII Cash</span>
                    </div>
                    <span className={`font-mono font-bold ${diiVal >= 0 ? 'text-indigo-400' : 'text-rose-400'}`}>
                        {diiVal >= 0 ? '+' : ''}₹{diiVal.toLocaleString('en-IN')} Cr
                    </span>
                </div>

                <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/80">
                    <span className="text-slate-400 font-medium">Net Inst. Flow</span>
                    <span className={`font-mono font-black ${netInstitutional >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {netInstitutional >= 0 ? '+' : ''}₹{netInstitutional.toLocaleString('en-IN')} Cr
                    </span>
                </div>
            </div>

            <div className="bg-slate-950/80 rounded-xl p-2 border border-slate-800 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                    <Activity size={12} className="text-amber-500" /> Nifty 50
                </span>
                <div className="flex items-center gap-1 font-mono font-bold">
                    <span className={niftyPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {niftyPct >= 0 ? '+' : ''}{niftyPct.toFixed(2)}%
                    </span>
                    {niftyPct >= 0 ? (
                        <TrendingUp size={12} className="text-emerald-400" />
                    ) : (
                        <TrendingDown size={12} className="text-rose-400" />
                    )}
                </div>
            </div>
        </div>
    );
};

const FIIDIIHistoryChart: React.FC<{ data: ConsolidatedFiiDii[]; mode: '1D' | '1M'; onModeChange: (m: '1D' | '1M') => void }> = ({ data, mode, onModeChange }) => {
    const chartData = useMemo(() => {
        return data.slice(0, 20).reverse().map(d => ({
            ...d,
            formattedDate: formatDate(d.date, mode === '1M')
        }));
    }, [data, mode]);

    if (chartData.length === 0 || chartData[0].date.includes('Syncing')) {
        return null;
    }

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <BarChart3 size={18} className="text-indigo-500" />
                        Institutional Net Flows vs Nifty 50
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-1">
                        {mode === '1D' ? '20-day trend of FII and DII Cash Market flows' : 'Consolidated monthly trend of FII and DII Cash Market flows'} plotted against NIFTY 50 % daily change.
                    </p>
                </div>
                <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 w-fit">
                    <button
                        onClick={() => onModeChange('1D')}
                        className={`px-3 py-1 text-[10px] font-black uppercase rounded-md tracking-wider transition-colors ${mode === '1D' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        Daily
                    </button>
                    <button
                        onClick={() => onModeChange('1M')}
                        className={`px-3 py-1 text-[10px] font-black uppercase rounded-md tracking-wider transition-colors ${mode === '1M' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        Monthly
                    </button>
                </div>
            </div>

            <div className="h-64 w-full">
                <SafeChartContainer>
                    <ComposedChart data={chartData} margin={{ top: 10, right: -5, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
                        <XAxis dataKey="formattedDate" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#94a3b8' }} width={45} label={{ value: '₹ Cr', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 9 } }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#f59e0b' }} width={30} domain={['auto', 'auto']} label={{ value: 'Nifty %', angle: 90, position: 'insideRight', style: { fill: '#f59e0b', fontSize: 9 } }} />
                        <Tooltip content={<FiiDiiChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 9, paddingTop: 10 }} />
                        <Bar name="FII Cash" dataKey="fii_cash" yAxisId="left" radius={[4, 4, 0, 0]}>
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fii_cash >= 0 ? '#10b981' : '#ef4444'} />
                            ))}
                        </Bar>
                        <Bar name="DII Cash" dataKey="dii_cash" yAxisId="left" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        <Line name="Nifty %" type="monotone" dataKey="nifty_pct" yAxisId="right" stroke="#f59e0b" strokeWidth={3} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                </SafeChartContainer>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed space-y-2">
                <p className="font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider text-[9px]">Derived Insight Summary</p>
                <p>
                    When FII flows show continuous accumulation (green bars) while Nifty % change line moves upwards, the rally is considered institutionally supported. 
                    Conversely, periods of strong FII selling combined with positive DII buying creates a &quot;Tug of War&quot; where the index may remain rangebound or experience distribution divergence.
                </p>
            </div>
        </div>
    );
};

// FII/DII Fallback Data (only shown when AI fails)
const FII_DII_DATA: ConsolidatedFiiDii[] = [
    {
        date: 'Syncing...',
        fii_cash: 0,
        dii_cash: 0,
        fii_fo: 0,
        fii_index_fut: 0,
        fii_index_opt: 0,
        fii_stock_fut: 0,
        fii_stock_opt: 0,
        nifty_price: 0,
        nifty_change: 0,
        nifty_pct: 0,
        vix_price: 0,
        vix_pct: 0,
        fii_cash_5d_avg: 0,
        fii_flow_signal: 'Neutral'
    }
];

// Earnings Calendar Fallback
const EARNINGS_CALENDAR = [
    { company: 'Awaiting Live Feed...', ticker: '-', date: '-', estimate: '-', sector: '-' }
];

const OptionExpiryCalendar = React.lazy(() => import('./market/OptionExpiryCalendar').then(m => ({ default: m.OptionExpiryCalendar })));
const StrategyLab = React.lazy(() => import('./StrategyLab'));
const AgenticLab = React.lazy(() => import('./market/AgenticLab').then(m => ({ default: m.AgenticLab })));
const EMPTY_INVESTMENTS: Investment[] = [];

interface LiveFiiActivityMiniWidgetProps {
    currentData: ConsolidatedFiiDii[];
    onApplyData: (data: ConsolidatedFiiDii[]) => void;
}

const LiveFiiActivityMiniWidget: React.FC<LiveFiiActivityMiniWidgetProps> = ({ currentData, onApplyData }) => {
    const [cachedData, setCachedData] = useState<any[] | null>(null);
    const [timestamp, setTimestamp] = useState<number | null>(null);
    const [status, setStatus] = useState<'loading' | 'active' | 'stale' | 'empty'>('loading');

    useEffect(() => {
        const loadCache = async () => {
            try {
                // 1. Try sessionStorage first
                let sessionRaw = null;
                if (typeof window !== 'undefined') {
                    sessionRaw = window.sessionStorage.getItem('alpha_fii_dii_pulse');
                }
                
                if (sessionRaw) {
                    const parsed = JSON.parse(sessionRaw);
                    if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
                        setCachedData(parsed.data);
                        setTimestamp(parsed.timestamp || Date.now());
                        determineStatus(parsed.timestamp || Date.now());
                        return;
                    }
                }

                // 2. Fallback to Dexie db.cache
                const entry = await db.cache.where('key').equals('alpha_cache_fii_dii_pulse').first();
                if (entry && Array.isArray(entry.data) && entry.data.length > 0) {
                    setCachedData(entry.data);
                    setTimestamp(entry.timestamp);
                    determineStatus(entry.timestamp);
                    return;
                }

                setStatus('empty');
            } catch (err) {
                console.error('[LiveFiiActivityMiniWidget] Cache read failed:', err);
                setStatus('empty');
            }
        };

        const determineStatus = (ts: number) => {
            const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
            if (ageHours > 24) {
                setStatus('stale');
            } else {
                setStatus('active');
            }
        };

        loadCache();
    }, []);

    const formatAge = () => {
        if (!timestamp) return '';
        const diffMs = Date.now() - timestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${Math.floor(diffHours / 24)}d ago`;
    };

    const handleSync = () => {
        if (!cachedData || cachedData.length === 0) return;
        
        // Map FiiDiiFlowsItem[] to ConsolidatedFiiDii[]
        const mappedList: ConsolidatedFiiDii[] = cachedData.map((item: any) => {
            const fiiCashVal = item.fii_cash?.find((c: any) => c.category === 'FII/FPI' || c.category === 'FII')?.net_value || 0;
            const diiCashVal = item.fii_cash?.find((c: any) => c.category === 'DII')?.net_value || 0;
            const fiiIndexFut = item.fii_oi?.find((o: any) => o.type === 'INDEX FUTURES')?.net_amount || 0;
            const fiiIndexOpt = item.fii_oi?.find((o: any) => o.type === 'INDEX OPTIONS')?.net_amount || 0;
            const fiiStockFut = item.fii_oi?.find((o: any) => o.type === 'STOCK FUTURES')?.net_amount || 0;
            const fiiStockOpt = item.fii_oi?.find((o: any) => o.type === 'STOCK OPTIONS')?.net_amount || 0;
            
            const indexNifty = item.indices?.find((idx: any) => idx.symbol_name === 'NIFTY 50');
            const indexVix = item.indices?.find((idx: any) => idx.symbol_name === 'INDIA VIX');
            
            return {
                date: item.date,
                fii_cash: fiiCashVal,
                dii_cash: diiCashVal,
                fii_fo: fiiIndexFut + fiiIndexOpt + fiiStockFut + fiiStockOpt,
                fii_index_fut: fiiIndexFut,
                fii_index_opt: fiiIndexOpt,
                fii_stock_fut: fiiStockFut,
                fii_stock_opt: fiiStockOpt,
                nifty_price: indexNifty?.last_trade_price || 0,
                nifty_change: indexNifty?.change || 0,
                nifty_pct: indexNifty?.change_percent || 0,
                vix_price: indexVix?.last_trade_price || 0,
                vix_pct: indexVix?.change_percent || 0,
                fii_cash_5d_avg: fiiCashVal,
                fii_flow_signal: fiiCashVal > 0 ? 'Accumulation' : 'Distribution'
            };
        });

        const mergedMap = new Map<string, ConsolidatedFiiDii>();
        currentData.forEach(item => {
            if (item && item.date && !item.date.includes('Syncing')) {
                mergedMap.set(item.date, item);
            }
        });
        mappedList.forEach(item => {
            if (item && item.date) {
                mergedMap.set(item.date, item);
            }
        });

        const mergedList = Array.from(mergedMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        onApplyData(mergedList);
    };

    if (status === 'loading' || status === 'empty') return null;

    return (
        <div className="mb-4 p-3.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 flex items-center justify-between gap-3 animate-in fade-in duration-300">
            <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-lg ${status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                    <Sparkles size={14} className={status === 'active' ? 'animate-pulse' : ''} />
                </div>
                <div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">Alpha Engine Live Cache</span>
                        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                            {status}
                        </span>
                    </div>
                    <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">Synced {formatAge()} | {cachedData?.length || 0} sessions available</p>
                </div>
            </div>
            <button
                onClick={handleSync}
                className="flex items-center gap-1 rounded-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-[10px] px-3 py-1.5 transition-all shadow-md border border-indigo-400/20"
            >
                <RefreshCw size={10} className="animate-spin-slow" />
                Sync
            </button>
        </div>
    );
};

const MacroPulse: React.FC = () => {
    const [macroIndicators, setMacroIndicators] = useState(INITIAL_MACRO_INDICATORS);
    const [globalIndices, setGlobalIndices] = useState(INITIAL_GLOBAL_INDICES);
    const [selectedIndicatorId, setSelectedIndicatorId] = useState(INITIAL_MACRO_INDICATORS[0].id);
    const [activeTab, setActiveTab] = useState<'macro' | 'velocity' | 'expiry' | 'strategy' | 'agentic'>('macro');



    // Dynamic state replacing hardcoded constants
    const [fiiDiiData, setFiiDiiData] = useState<ConsolidatedFiiDii[]>(FII_DII_DATA);
    const [fiiDiiMode, setFiiDiiMode] = useState<'1D' | '1M'>('1D');
    const [economicCalendar, setEconomicCalendar] = useState<EconomicEvent[]>(ECONOMIC_CALENDAR as EconomicEvent[]);
    const [earningsCalendar, setEarningsCalendar] = useState<EarningsEvent[]>(EARNINGS_CALENDAR);
    const [sectorHeatmap, setSectorHeatmap] = useState<SectorHeatmapData[]>(SECTOR_HEATMAP_DATA);
    const [sectorViewMode, setSectorViewMode] = useState<'bar' | 'grid'>('bar');

    const sortedSectorHeatmap = useMemo(() => {
        return [...sectorHeatmap].sort((a, b) => b.value - a.value);
    }, [sectorHeatmap]);

    const advancesCount = useMemo(() => {
        return sectorHeatmap.filter(s => s.value >= 0).length;
    }, [sectorHeatmap]);

    const declinesCount = useMemo(() => {
        return sectorHeatmap.filter(s => s.value < 0).length;
    }, [sectorHeatmap]);

    // Loading and Error states
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const isVisible = usePageVisibility();

    // Session storage key to prevent re-fetching on every tab switch
    const SESSION_KEY = 'macro_pulse_session_loaded';

    // Load data function (extracted for manual refresh)
    const loadData = useCallback(async (showLoading = true, force = false) => {
        if (showLoading) setIsLoading(true);
        setError(null);

        try {
            const [macroGlobal, fiiDii, econCal, earnCal, sectors] = await Promise.all([
                marketDataService.fetchMacroAndGlobal(force),
                marketDataService.fetchConsolidatedFiiDii(20, force, fiiDiiMode),
                marketDataService.fetchEconomicCalendar(force),
                marketDataService.fetchEarningsCalendar(force),
                marketDataService.fetchSectorHeatmap(force)
            ]);

            const { macro, global } = macroGlobal;

            setFiiDiiData(fiiDii);
            setEconomicCalendar(econCal);
            setEarningsCalendar(earnCal);
            setSectorHeatmap(sectors);

            setMacroIndicators(prev => {
                return prev.map(p => {
                    const fetched = macro.find(m => m.id === p.id);
                    if (fetched) {
                        const newVal = fetched.value;
                        const newData = [...p.data];
                        newData.shift();
                        newData.push({ day: 30, value: newVal });
                        return { ...p, value: newVal, change: fetched.change, data: newData, source: fetched.source };
                    }
                    return p;
                });
            });

            // Fetch live Indian indices from DhanHQ
            if (dhanBrokerService.isConfigured()) {
                try {
                    const dhanIndices = await dhanBrokerService.getIndexQuotes();
                    if (dhanIndices.length > 0) {
                        setGlobalIndices(prev => {
                            return prev.map(p => {
                                const dhanMatch = dhanIndices.find(d => d.symbol === p.name);
                                if (dhanMatch && dhanMatch.price > 0) {
                                    return { ...p, value: dhanMatch.price, change: dhanMatch.changePercent };
                                }
                                return p;
                            });
                        });
                    }
                } catch (e) { console.warn('DhanHQ ticker fetch failed', e); }
            }

            // Also update from global indices (S&P, NASDAQ etc from Yahoo)
            setGlobalIndices(prev => {
                return prev.map(p => {
                    // Try to match by name or symbol
                    const found = global.find(g => g.name === p.name || g.id === p.symbol);
                    if (found && found.value > 0) {
                        return { ...p, value: found.value, change: found.change };
                    }
                    return p;
                });
            });

            setLastRefresh(new Date());
        } catch (err: unknown) {
            console.error("MacroPulse: Data Load Failed", err);
            const message = err instanceof Error ? err.message : String(err);
            setError(message || 'Failed to load market data');
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Initial load and tab switches - always check cache on mount (force = false)
    useEffect(() => {
        loadData(true, false);
    }, [loadData]);

    // Reload FII/DII data independently when the mode toggles
    useEffect(() => {
        let active = true;
        const fetchFiiDii = async () => {
            try {
                const data = await marketDataService.fetchConsolidatedFiiDii(20, false, fiiDiiMode);
                if (active) {
                    setFiiDiiData(data);
                }
            } catch (err) {
                console.error("Failed to fetch FII/DII data for mode", fiiDiiMode, err);
            }
        };
        fetchFiiDii();
        return () => { active = false; };
    }, [fiiDiiMode]);




    const selectedIndicator = useMemo(() =>
        macroIndicators.find(i => i.id === selectedIndicatorId) || macroIndicators[0],
        [macroIndicators, selectedIndicatorId]
    );

    // Dynamic Fear & Greed based on actual VIX
    const fearGreedValue = useMemo(() => {
        const vixEntry = macroIndicators.find(i => i.id === 'vix');
        const vix = vixEntry ? vixEntry.value : 15;
        // VIX 10 = Ext Greed (100), VIX 30 = Ext Fear (0)
        let val = Math.round(100 - ((vix - 10) / 20) * 100);
        return Math.max(0, Math.min(100, val));
    }, [macroIndicators]);

    return (
        <div className="page-shell space-y-6 animate-in fade-in duration-500 pb-20">

            {/* Global Ticker */}
            <div className="bg-slate-50 dark:bg-slate-900 border-y border-slate-200 dark:border-slate-800 overflow-hidden py-2 rounded-xl">
                <div className="flex animate-marquee whitespace-nowrap gap-8 px-4">
                    {[...globalIndices, ...globalIndices].map((idx, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm font-mono">
                            <span className="text-slate-500 dark:text-slate-400 font-bold">{idx.name}</span>
                            <span className="text-slate-900 dark:text-white">
                                {idx.name === 'BITCOIN' ? '$' : ''}
                                {idx.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className={idx.change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                {idx.change >= 0 ? '+' : ''}{idx.change.toFixed(2)}%
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {!isMarketHours() && (
                <div className="hidden sm:flex items-center gap-3 px-4 py-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400 text-xs font-semibold leading-normal">
                    <Clock size={16} className="shrink-0 text-amber-500" />
                    <span>Indian Markets Closed. Displaying final session close prices (Cached / Fallbacks).</span>
                </div>
            )}

            {/* Internal subnavigation switcher - sleek scrollable pill strip */}
            <div className="flex items-center gap-1 p-1 bg-slate-100/80 dark:bg-slate-900/70 backdrop-blur-sm rounded-xl border border-slate-200/80 dark:border-slate-800/80 max-w-full overflow-x-auto no-scrollbar">
                <button
                    onClick={() => setActiveTab('macro')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap shrink-0 transition-all ${
                        activeTab === 'macro'
                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <Globe size={13} className="shrink-0" />
                    Macro Pulse
                </button>
                <button
                    onClick={() => setActiveTab('velocity')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap shrink-0 transition-all ${
                        activeTab === 'velocity'
                            ? 'bg-white dark:bg-slate-800 text-amber-500 dark:text-amber-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <Zap size={13} className="text-amber-500 shrink-0" />
                    Macro Velocity HFT
                </button>
                <button
                    onClick={() => setActiveTab('expiry')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap shrink-0 transition-all ${
                        activeTab === 'expiry'
                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <Calendar size={13} className="shrink-0" />
                    Expiry Calendar
                </button>
                <button
                    onClick={() => setActiveTab('strategy')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap shrink-0 transition-all ${
                        activeTab === 'strategy'
                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <Activity size={13} className="shrink-0" />
                    Strategy Lab
                </button>
                <button
                    onClick={() => setActiveTab('agentic')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap shrink-0 transition-all ${
                        activeTab === 'agentic'
                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <Brain size={13} className="shrink-0" />
                    Agentic Lab
                </button>
            </div>

            {activeTab === 'macro' && (
                <>
                    <TabHero
                eyebrow="Market Intel"
                title="Macro Pulse"
                description="Global economic indicators, liquidity conditions, and sector-level signals translated into portfolio context."
                icon={Globe}
                iconTone="text-sky-500"
                gradientClassName="from-sky-50 via-white to-indigo-50 dark:from-sky-950/20 dark:via-slate-950 dark:to-indigo-950/20"
                chips={['Macro dashboard', 'Sector impact', !isMarketHours() ? 'Cached data' : (dhanBrokerService.isConfigured() ? 'Live source' : 'Delayed source')]}
                actions={
                    <div className="flex items-center gap-2 whitespace-nowrap">
                        {!isMarketHours() ? (
                            <div className="flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">
                                <span className="flex h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                                Cached (Dexie)
                            </div>
                        ) : (
                            <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${dhanBrokerService.isConfigured() ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'}`}>
                                <span className={`flex h-1.5 w-1.5 rounded-full ${dhanBrokerService.isConfigured() ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                                {dhanBrokerService.isConfigured() ? 'Live (DhanHQ)' : 'Delayed'}
                            </div>
                        )}
                        <button
                            onClick={() => loadData(true, true)}
                            disabled={isLoading}
                            className="flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-1 text-[10px] font-bold text-white transition-colors hover:bg-sky-500 disabled:bg-sky-900"
                        >
                            {isLoading ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : (
                                <RefreshCw size={12} />
                            )}
                            {isLoading ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>
                }
            >
                {lastRefresh && (
                    <div className="flex justify-end items-center gap-2.5 whitespace-nowrap">
                        {!isMarketHours() && (
                            <span className="text-[8px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
                                Cache Source: {dhanBrokerService.isConfigured() ? 'DhanHQ Dexie' : 'Yahoo Dexie'}
                            </span>
                        )}
                        <span className="text-[10px] text-slate-500">
                            Updated: {lastRefresh.toLocaleTimeString()}
                        </span>
                    </div>
                )}
            </TabHero>

            {/* Markets Closed Banner */}
            {!isMarketHours() && (
                <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
                    <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                        <Clock size={20} className="animate-pulse text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div className="flex-1">
                        <p className="text-slate-900 dark:text-slate-200 font-bold text-sm leading-snug">Markets Closed. Displaying final session close prices.</p>
                        <p className="text-slate-500 dark:text-slate-450 text-xs mt-0.5 leading-relaxed font-medium">Auto-refresh and live feeds are paused outside Indian stock market hours (Monday - Friday, 9:15 AM - 3:30 PM IST).</p>
                    </div>
                </div>
            )}



            {/* Error Banner */}
            {error && (
                <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl p-4 flex items-center gap-3 shadow-sm">
                    <AlertTriangle size={20} className="text-rose-600 dark:text-rose-500" />
                    <div className="flex-1">
                        <p className="text-rose-700 dark:text-rose-400 font-medium text-sm">{error}</p>
                        <p className="text-rose-500/70 text-xs">Showing cached data. Click Refresh to retry.</p>
                    </div>
                </div>
            )}

            {/* Indicators Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {macroIndicators.map((indicator) => (
                    <div
                        key={indicator.id}
                        onClick={() => setSelectedIndicatorId(indicator.id)}
                        className={`bg-white dark:bg-slate-900 border ${selectedIndicatorId === indicator.id ? 'border-indigo-500 ring-1 ring-indigo-500 shadow-lg shadow-indigo-500/10' : 'border-slate-200 dark:border-slate-800'} rounded-2xl p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all shadow-sm`}
                    >
                        <div className="flex justify-between items-start mb-2">
                            <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-100 dark:border-slate-700">
                                <indicator.icon size={20} />
                            </div>
                            <div className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${indicator.change >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-500/20'}`}>
                                {indicator.change >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                {Math.abs(indicator.change).toFixed(2)}%
                            </div>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase truncate tracking-wider">{indicator.label}</p>
                            <h3 className="text-xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight mt-1">
                                {indicator.id === 'usdinr' || indicator.id === 'crude' || indicator.id === 'gold' ? indicator.unit : ''}
                                {indicator.value.toFixed(2)}
                                {indicator.id === 'us10y' ? indicator.unit : ''}
                            </h3>
                            <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 font-medium">
                                <span className="truncate">{indicator.name}</span>
                                <span className="text-[8px] font-mono uppercase bg-slate-100 dark:bg-slate-800/80 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-400 tracking-wider border border-slate-200 dark:border-slate-700">
                                    {!isMarketHours() ? 'cached' : (indicator.source || 'yahoo')}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Main Chart */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                <selectedIndicator.icon size={20} style={{ color: selectedIndicator.color }} />
                                {selectedIndicator.name} Trend
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">{selectedIndicator.desc}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-slate-400 font-bold uppercase">Current Level</p>
                            <p className="text-2xl font-mono font-bold text-slate-900 dark:text-white">
                                {selectedIndicator.value.toFixed(2)}
                            </p>
                        </div>
                    </div>

                    <div className="h-64 w-full">
                        <SafeChartContainer>
                            <AreaChart data={selectedIndicator.data}>
                                <defs>
                                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={selectedIndicator.color} stopOpacity={0.3} />
                                        <stop offset="95%" stopColor={selectedIndicator.color} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
                                <XAxis dataKey="day" hide />
                                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={40} />
                                <Tooltip
                                    content={<CustomTooltip formatter={(val: number) => val.toFixed(2)} />}
                                    cursor={{ stroke: selectedIndicator.color, strokeWidth: 1, strokeDasharray: '3 3' }}
                                />
                                <Area
                                    name={selectedIndicator.name}
                                    type="monotone"
                                    dataKey="value"
                                    isAnimationActive={false} // Disable animation for smoother real-time feel
                                    stroke={selectedIndicator.color}
                                    fillOpacity={1}
                                    fill="url(#colorValue)"
                                    strokeWidth={3}
                                />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>

                {/* Impact Analysis */}
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <Zap size={20} className="text-yellow-500 dark:text-yellow-400" /> Impact Analysis
                    </h3>
                    <div className="space-y-4">
                        {IMPACT_RULES.filter(rule => rule.condition(macroIndicators)).map((rule, idx) => (
                            <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${rule.impact === 'POSITIVE' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
                                        {rule.impact}
                                    </span>
                                    <span className="text-xs text-slate-500 dark:text-slate-400">for</span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {rule.sectors.map(sector => (
                                        <span key={sector} className="text-xs font-bold text-slate-800 dark:text-white bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">
                                            {sector}
                                        </span>
                                    ))}
                                </div>
                                <div className="flex gap-2 items-start">
                                    <Info size={14} className="text-slate-500 shrink-0 mt-0.5" />
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                        {rule.reason}
                                    </p>
                                </div>
                            </div>
                        ))}
                        {IMPACT_RULES.filter(rule => rule.condition(macroIndicators)).length === 0 && (
                            <div className="text-center py-8 text-slate-500">
                                <AlertTriangle size={32} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No major macro alerts currently.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Row: Economic Calendar & Sector Heatmap */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Economic Calendar */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col h-[400px]">
                    <div className="flex items-center justify-between mb-4 shrink-0">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <Calendar size={20} className="text-indigo-500" /> Economic Calendar
                        </h3>
                        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-800">
                            {economicCalendar.length} Events
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                        {economicCalendar.map((event, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 hover:border-indigo-500/30 transition-all">
                                <div className="flex items-center gap-3">
                                    <div className="flex flex-col items-center justify-center w-11 h-11 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
                                        <span className="text-[9px] font-black text-indigo-500 uppercase tracking-tighter">
                                            {event.date && event.date.includes(' ') ? event.date.split(' ')[0] : 'UP'}
                                        </span>
                                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                                            {event.date && event.date.includes(' ') ? event.date.split(' ')[1] : idx + 1}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight">{event.event}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                                                event.impact === 'HIGH' 
                                                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20' 
                                                    : event.impact === 'MEDIUM' 
                                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' 
                                                    : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20'
                                            }`}>
                                                {event.impact} IMPACT
                                            </span>
                                            {event.forecast && (
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                                    Fcst: <span className="font-semibold text-slate-700 dark:text-slate-300">{event.forecast}</span>
                                                </span>
                                            )}
                                            {event.previous && (
                                                <span className="text-[10px] text-slate-400 hidden sm:inline">
                                                    Prev: {event.previous}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 text-[11px] text-slate-400 shrink-0 font-medium">
                                    <Clock size={12} className="text-slate-500" />
                                    {event.date && event.date.includes(' ') ? event.date.split(' ').slice(2).join(' ') || 'TBD' : ''}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Sector Heatmap */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col h-[400px]">
                    <div className="flex items-center justify-between mb-3 shrink-0">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                <BarChart3 size={20} className="text-emerald-500" /> Sector Heatmap (Today)
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                                    {advancesCount} Advances
                                </span>
                                <span className="text-[10px] font-black text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800">
                                    {declinesCount} Declines
                                </span>
                            </div>
                        </div>

                        {/* View Switcher */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            <button
                                onClick={() => setSectorViewMode('bar')}
                                className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-md transition-colors ${sectorViewMode === 'bar' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                            >
                                Bar
                            </button>
                            <button
                                onClick={() => setSectorViewMode('grid')}
                                className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-md transition-colors ${sectorViewMode === 'grid' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                            >
                                Grid
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                        {sectorViewMode === 'bar' ? (
                            <div style={{ height: Math.max(340, sortedSectorHeatmap.length * 26) }} className="w-full">
                                <SafeChartContainer>
                                    <BarChart data={sortedSectorHeatmap} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" opacity={0.1} />
                                        <XAxis type="number" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`} />
                                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#94a3b8' }} width={85} />
                                        <Tooltip
                                            content={<CustomTooltip formatter={(val: number) => `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`} />}
                                            cursor={{ fill: 'rgba(99, 102, 241, 0.05)' }}
                                        />
                                        <Bar dataKey="value" name="Change %" radius={[0, 4, 4, 0]} barSize={16}>
                                            {sortedSectorHeatmap.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#10b981' : '#ef4444'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </SafeChartContainer>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-1">
                                {sortedSectorHeatmap.map((sector, idx) => (
                                    <div key={idx} className={`p-2.5 rounded-xl border transition-all ${
                                        sector.value >= 0 
                                            ? 'bg-emerald-500/5 dark:bg-emerald-950/20 border-emerald-500/20 hover:border-emerald-500/40' 
                                            : 'bg-rose-500/5 dark:bg-rose-950/20 border-rose-500/20 hover:border-rose-500/40'
                                    }`}>
                                        <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 block truncate">{sector.name}</span>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className={`text-xs font-mono font-black ${sector.value >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {sector.value >= 0 ? '+' : ''}{sector.value.toFixed(2)}%
                                            </span>
                                            <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${
                                                sector.value >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                                            }`}>
                                                {sector.value >= 0 ? 'GAIN' : 'LOSS'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* NEW: Fear & Greed, FII/DII, Earnings Calendar Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Fear & Greed Index */}
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <Activity size={20} className="text-orange-500 dark:text-orange-400" /> Fear & Greed Index
                    </h3>
                    <FearGreedGauge value={fearGreedValue} />
                    <p className="text-xs text-slate-500 dark:text-slate-400 text-center mt-4">
                        Based on VIX, market momentum, and investor behavior
                    </p>
                </div>

                {/* FII/DII Activity */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                        <TrendingUp size={20} className="text-indigo-500" /> FII/DII Activity Today
                    </h3>
                    <LiveFiiActivityMiniWidget currentData={fiiDiiData} onApplyData={setFiiDiiData} />
                    <FIIDIIActivityPanel data={fiiDiiData} />
                </div>

                {/* Upcoming Earnings */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                        <Calendar size={20} className="text-purple-500" /> Earnings Calendar
                    </h3>
                    <div className="space-y-3">
                        {earningsCalendar.map((earning, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <div>
                                    <p className="text-sm font-bold text-slate-900 dark:text-white">{earning.company}</p>
                                    <p className="text-xs text-slate-500">{earning.sector}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-mono font-bold text-indigo-600 dark:text-indigo-400">{earning.estimate}</p>
                                    <p className="text-xs text-slate-400">{earning.date}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* IPO Calendar (P2 Enhancement) */}
            </div>

            {/* FII/DII Historical Trend Chart */}
            <div className="w-full">
                <FIIDIIHistoryChart data={fiiDiiData} mode={fiiDiiMode} onModeChange={setFiiDiiMode} />
            </div>
                </>
            )}

            {activeTab !== 'macro' && (
                <Suspense fallback={<DashboardSkeleton />}>
                    {activeTab === 'velocity' && <CatalystVelocityDeck />}
                    {activeTab === 'expiry' && <OptionExpiryCalendar />}
                    {activeTab === 'strategy' && <StrategyLab />}
                    {activeTab === 'agentic' && <AgenticLab />}
                </Suspense>
            )}
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(MacroPulse);
