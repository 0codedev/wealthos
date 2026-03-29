import React, { useState, useEffect } from 'react';
import { Calendar, HelpCircle, Activity, Award, CheckCircle2, ChevronRight } from 'lucide-react';
import { earningsCalendarService, EarningsEvent } from '../../services/EarningsCalendarService';
import { earningsIntelligenceService, EarningsIntelReport } from '../../services/EarningsIntelligenceService';
import { formatCurrencyCompact } from '../../utils/helpers';

export const EarningsIntelligencePanel: React.FC = () => {
  const [events, setEvents] = useState<EarningsEvent[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [intel, setIntel] = useState<Record<string, EarningsIntelReport>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const list = earningsCalendarService.getUpcomingEvents();
    setEvents(list);
    if (list.length > 0) {
      setSelectedTicker(list[0].ticker);
    }
  }, []);

  const loadIntel = async (ticker: string) => {
    if (intel[ticker] || loading[ticker]) return;
    
    setLoading(prev => ({ ...prev, [ticker]: true }));
    const event = events.find(e => e.ticker === ticker);
    if (event) {
      const report = await earningsIntelligenceService.analyzeEarnings(
        ticker,
        event.expectedEPS || 10,
        event.expectedRevenue || '₹0'
      );
      setIntel(prev => ({ ...prev, [ticker]: report }));
    }
    setLoading(prev => ({ ...prev, [ticker]: false }));
  };

  useEffect(() => {
    if (selectedTicker) {
      void loadIntel(selectedTicker);
    }
  }, [selectedTicker]);

  const activeEvent = events.find(e => e.ticker === selectedTicker);
  const activeIntel = activeEvent ? intel[selectedTicker] : null;
  const isLoadingActive = selectedTicker ? loading[selectedTicker] : false;

  const playBadgeColor = (play: string) => {
    switch (play) {
      case 'Straddle':
      case 'Strangle':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/25';
      case 'Iron Condor':
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25';
      case 'Directional Call':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25';
      case 'Directional Put':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/25';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/25';
    }
  };

  return (
    <div className="bg-slate-900 rounded-2xl border border-indigo-500/20 p-6 text-white shadow-xl">
      <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
        <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
          <Calendar size={22} />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight">Earnings Intelligence</h2>
          <p className="text-xs text-slate-400">Compute options-implied moves and forecast beat/miss outcomes for Nifty 50 companies.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Upcoming Earnings List */}
        <div className="space-y-3 lg:border-r lg:border-slate-800 lg:pr-6 max-h-[500px] overflow-y-auto pr-2">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Upcoming Events (FY26 Q1)</label>
          {events.map((event) => {
            const isSelected = event.ticker === selectedTicker;
            const hasReport = !!intel[event.ticker];
            return (
              <button
                key={event.ticker}
                onClick={() => setSelectedTicker(event.ticker)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                  isSelected
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-950 border-slate-850 hover:bg-slate-900 text-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">{event.ticker}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                      event.daysToEarnings <= 3 ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-800 text-slate-400'
                    }`}>
                      T-{event.daysToEarnings} Days
                    </span>
                  </div>
                  <div className={`text-[10px] ${isSelected ? 'text-indigo-200' : 'text-slate-500'}`}>
                    {event.name}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasReport && <CheckCircle2 size={14} className="text-emerald-400" />}
                  <ChevronRight size={16} className={isSelected ? 'text-indigo-200' : 'text-slate-600'} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Intel Dashboard */}
        <div className="lg:col-span-2 space-y-6">
          {isLoadingActive && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
              <Activity className="animate-spin text-indigo-500" size={32} />
              <p className="text-sm font-mono">Running options implied move calculations...</p>
            </div>
          )}

          {!isLoadingActive && !activeIntel && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-500">
              <HelpCircle size={40} className="mb-2 opacity-30" />
              <p>Select a stock from the list to load Earnings Intel.</p>
            </div>
          )}

          {!isLoadingActive && activeEvent && activeIntel && (
            <div className="space-y-6">
              {/* Event Header Card */}
              <div className="bg-slate-950 border border-slate-850 p-5 rounded-2xl flex flex-wrap justify-between items-center gap-4">
                <div>
                  <h3 className="text-xl font-extrabold text-white flex items-center gap-2">
                    {activeEvent.name}
                    <span className="text-xs bg-slate-850 px-2 py-0.5 rounded border border-slate-800 text-slate-400">
                      {activeEvent.sector}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Earnings Date: <span className="font-mono text-slate-200 font-semibold">{activeEvent.earningsDate}</span>
                  </p>
                </div>
                <div className="flex gap-4 text-right">
                  <div>
                    <span className="block text-[10px] text-slate-500 uppercase font-black">Consensus EPS</span>
                    <span className="font-mono text-sm font-bold text-slate-200">₹{activeEvent.expectedEPS}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-500 uppercase font-black">Consensus Revenue</span>
                    <span className="font-mono text-sm font-bold text-slate-200">{activeEvent.expectedRevenue}</span>
                  </div>
                </div>
              </div>

              {/* Move vs Volatility comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl text-center">
                  <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">ATM Straddle Implied Move</span>
                  <span className="text-3xl font-black font-mono text-indigo-400">±{activeIntel.impliedMovePercent.toFixed(2)}%</span>
                  <p className="text-[10px] text-slate-500 mt-1.5">Options pricing expects a move inside this range.</p>
                </div>
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl text-center">
                  <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Historical Post-Earnings Move</span>
                  <span className="text-3xl font-black font-mono text-slate-300">±{activeIntel.historicalAvgMovePercent.toFixed(2)}%</span>
                  <p className="text-[10px] text-slate-500 mt-1.5">Average absolute 1-day closing move over past 2 years.</p>
                </div>
              </div>

              {/* Beat/Miss Probabilities */}
              <div className="bg-slate-950 border border-slate-850 p-5 rounded-xl space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Award size={14} className="text-amber-400" /> Consensus Beat/Miss AI Probabilities
                </h4>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="text-emerald-400">Beat Consensus</span>
                      <span className="font-mono">{activeIntel.beatProbability}%</span>
                    </div>
                    <div className="h-2.5 bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${activeIntel.beatProbability}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="text-rose-400">Miss Consensus</span>
                      <span className="font-mono">{activeIntel.missProbability}%</span>
                    </div>
                    <div className="h-2.5 bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${activeIntel.missProbability}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="text-slate-400">In-Line / Neutral</span>
                      <span className="font-mono">{activeIntel.inLineProbability}%</span>
                    </div>
                    <div className="h-2.5 bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-500 transition-all duration-500" style={{ width: `${activeIntel.inLineProbability}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Suggested Play Card */}
              <div className="bg-slate-950 border border-slate-850 p-5 rounded-xl flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Suggested Options Play</span>
                    <span className={`px-2.5 py-0.5 rounded border text-xs font-bold uppercase ${playBadgeColor(activeIntel.suggestedPlay)}`}>
                      {activeIntel.suggestedPlay}
                    </span>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed font-medium">
                    {activeIntel.reasoning}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EarningsIntelligencePanel;
