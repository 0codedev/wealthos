import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Calendar, Clock, ShieldAlert, Sparkles, HelpCircle, RefreshCw
} from 'lucide-react';
import { upstoxMarketDataService } from '../../services/UpstoxMarketDataService';
import DataFreshnessTag from '../shared/DataFreshnessTag';

interface Holiday {
  date: string;
  description: string;
  day: string;
}

const STATIC_HOLIDAYS_2026: Holiday[] = [
  { date: '2026-06-18', description: 'Bakri Id (Id-ul-Zuha)', day: 'Thursday' },
  { date: '2026-07-17', description: 'Moharram', day: 'Friday' },
  { date: '2026-08-15', description: 'Independence Day', day: 'Saturday' },
  { date: '2026-10-02', description: 'Mahatma Gandhi Jayanti', day: 'Friday' },
  { date: '2026-11-08', description: 'Diwali (Laxmi Puja)', day: 'Sunday' },
  { date: '2026-11-24', description: 'Gurunanak Jayanti', day: 'Tuesday' },
  { date: '2026-12-25', description: 'Christmas', day: 'Friday' }
];

export const MarketCalendarWidget: React.FC = () => {
  const [holidays, setHolidays] = useState<Holiday[]>(STATIC_HOLIDAYS_2026);
  const [nextExpiry, setNextExpiry] = useState<Date | null>(null);
  const [daysToExpiry, setDaysToExpiry] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<string>('');
  const [source, setSource] = useState<'cache' | 'live'>('live');

  // Dynamically calculate the next Thursday (Nifty Weekly Expiry)
  const calculateNextThursday = () => {
    const today = new Date();
    const resultDate = new Date(today.getTime());
    resultDate.setDate(today.getDate() + (3 + 7 - today.getDay()) % 7);
    resultDate.setHours(15, 30, 0, 0); // Expiry time
    return resultDate;
  };

  const fetchCalendarData = useCallback(async () => {
    try {
      // 1. Fetch holidays from API
      const holidaysData = await upstoxMarketDataService.getMarketHolidays();
      if (holidaysData && Array.isArray(holidaysData)) {
        // Parse dates and filter past holidays
        const todayStr = new Date().toISOString().split('T')[0];
        const upcoming = holidaysData
          .filter((h: any) => h.date >= todayStr)
          .map((h: any) => ({
            date: h.date,
            description: h.description,
            day: h.day || new Date(h.date).toLocaleDateString('en-US', { weekday: 'long' })
          }));
        
        if (upcoming.length > 0) {
          setHolidays(upcoming.slice(0, 5));
        }
      }

      // 2. Fetch expiries for Nifty from Option Contracts endpoint
      try {
        const response = await fetch('/api/python-nse/api/upstox/option-contracts?symbol=NIFTY');
        if (response.ok) {
          const contracts = await response.json();
          if (contracts && contracts.status === 'success' && Array.isArray(contracts.data)) {
            // Find closest expiry from list
            const today = new Date();
            const expiries = contracts.data
              .map((c: any) => new Date(c.expiry))
              .filter((d: Date) => d >= today)
              .sort((a: Date, b: Date) => a.getTime() - b.getTime());

            if (expiries.length > 0) {
              setNextExpiry(expiries[0]);
            }
          }
        }
      } catch (err) {
        console.warn('Option contracts lookup failed, falling back to dynamic Thursday calculation:', err);
      }

      setLastFetched(new Date().toISOString());
      setSource('live');
      setLoading(false);
    } catch (err) {
      console.error('Error fetching calendar:', err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalendarData();
  }, [fetchCalendarData]);

  // Calculate days remaining and option decay metrics
  useEffect(() => {
    const expiry = nextExpiry || calculateNextThursday();
    const today = new Date();
    
    // Calculate difference in days
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    setDaysToExpiry(Math.max(0, diffDays));
  }, [nextExpiry]);

  // Theta Premium Decay Math (B.5.2)
  // Options decay exponentially over the last 7 days.
  // Standard approximation: Remaining Value = (Days Remaining / 7) ^ 0.5 (under square-root law of time decay)
  const getRemainingPremiumPercentage = () => {
    if (daysToExpiry >= 7) return 100;
    if (daysToExpiry === 0) return 0;
    return Math.round(Math.sqrt(daysToExpiry / 7) * 100);
  };

  const remainingValue = getRemainingPremiumPercentage();
  const decayValue = 100 - remainingValue;

  return (
    <div className="bg-slate-950/20 border border-slate-900 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-3">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-indigo-400" />
          <h3 className="text-xs font-black text-slate-400 tracking-wider uppercase">Market Timings & Expiry</h3>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && <DataFreshnessTag fetchedAt={lastFetched} source={source} />}
          <button 
            onClick={fetchCalendarData} 
            className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-500 hover:text-white transition-colors"
          >
            <RefreshCw size={10} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 font-mono">
        {/* Days to Expiry and Decay Indicator (B.5.2) */}
        <div className="space-y-4 bg-slate-900/20 border border-slate-900 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 font-sans uppercase font-black tracking-wider">Next Nifty Expiry</span>
            <span className="text-xs text-white font-bold bg-indigo-500/15 border border-indigo-500/20 px-2 py-0.5 rounded">
              {nextExpiry 
                ? nextExpiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                : calculateNextThursday().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              }
            </span>
          </div>

          <div className="flex flex-col items-center justify-center py-2">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Time to Expiry</span>
            <span className="text-3xl font-black text-white tracking-tighter">
              {daysToExpiry} {daysToExpiry === 1 ? 'DAY' : 'DAYS'}
            </span>
          </div>

          {/* Theta Decay Progress Bar */}
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-[9px] text-slate-500">
              <span className="uppercase font-bold tracking-wider">Option Time Value Decay</span>
              <span className="font-bold text-amber-400">-{decayValue}% Decay</span>
            </div>
            <div className="h-2 w-full bg-slate-950 border border-slate-900 rounded overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-500" 
                style={{ width: `${decayValue}%` }} 
              />
            </div>
            <p className="text-[9px] text-slate-500 leading-tight font-sans">
              *Theta decay is currently eating approx. <strong className="text-slate-400">{Math.round(100 / (daysToExpiry || 1))}%</strong> of OTM premium daily.
            </p>
          </div>
        </div>

        {/* Upcoming Holidays */}
        <div className="space-y-3">
          <span className="text-[10px] text-slate-500 font-sans uppercase font-black tracking-wider block">Upcoming Holidays (30 Days)</span>
          <div className="space-y-2 max-h-[170px] overflow-y-auto pr-1">
            {holidays.slice(0, 3).map((h, i) => {
              const hDate = new Date(h.date);
              return (
                <div 
                  key={i} 
                  className="flex items-center justify-between p-2.5 bg-slate-900/30 border border-slate-900/60 rounded"
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-200 truncate max-w-[170px]">{h.description}</span>
                    <span className="text-[9px] text-slate-500">{h.day}</span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">
                    {hDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              );
            })}
            {holidays.length === 0 && (
              <div className="text-center py-6 text-[10px] text-slate-600 font-sans">
                No trading holidays in next 30 days.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
export default MarketCalendarWidget;
