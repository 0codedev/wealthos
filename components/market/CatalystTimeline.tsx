import React, { useState, useEffect, useMemo } from 'react';
import { newsService } from '../../services/NewsService';
import { CatalystTimelineService, CatalystItem, CatalystCategory } from '../../services/CatalystTimelineService';
import { Flame, Activity, MessageSquare, AlertCircle, FileText, Settings, AlertTriangle, Layers, Calendar, ChevronRight } from 'lucide-react';

interface CatalystTimelineProps {
  symbol: string;
}

const CATEGORY_MAP: Record<CatalystCategory, { label: string; color: string; icon: any }> = {
  earnings: { label: 'Earnings', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: Activity },
  corporate_action: { label: 'Corp Action', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20', icon: FileText },
  regulation: { label: 'Regulation', color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: Settings },
  management: { label: 'Management', color: 'bg-teal-500/10 text-teal-400 border-teal-500/20', icon: Layers },
  rumor: { label: 'Rumor', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: MessageSquare },
  macro: { label: 'Macro', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: Calendar },
  sector: { label: 'Sector', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20', icon: AlertTriangle },
  general: { label: 'General', color: 'bg-slate-800 text-slate-400 border-slate-700', icon: AlertCircle }
};

export default function CatalystTimeline({ symbol }: CatalystTimelineProps) {
  const [items, setItems] = useState<CatalystItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<CatalystCategory | 'all'>('all');

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    const loadNews = async () => {
      try {
        const rawNews = await newsService.fetchUpstoxNews([symbol]);
        if (!active) return;
        
        const categorized = CatalystTimelineService.categorizeNews(rawNews);
        setItems(categorized);
      } catch (err) {
        console.error('Failed to load catalyst news for ' + symbol, err);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadNews();

    return () => {
      active = false;
    };
  }, [symbol]);

  // Filter items
  const filteredItems = useMemo(() => {
    if (selectedFilter === 'all') return items;
    return items.filter(item => item.catalystCategory === selectedFilter);
  }, [items, selectedFilter]);

  // Count items per category for filter badges
  const categoryCounts = useMemo(() => {
    const counts: Record<CatalystCategory | 'all', number> = {
      all: items.length,
      earnings: 0,
      corporate_action: 0,
      regulation: 0,
      management: 0,
      rumor: 0,
      macro: 0,
      sector: 0,
      general: 0
    };
    (items || []).forEach(item => {
      if (item?.catalystCategory && counts[item.catalystCategory] !== undefined) {
        counts[item.catalystCategory]++;
      } else {
        counts.general++;
      }
    });
    return counts;
  }, [items]);

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return 'Recent';
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4 select-none h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 shrink-0">
        <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
          <Flame size={16} className="text-amber-500 animate-pulse" />
          Catalyst Timeline
        </h3>
        <span className="text-[10px] text-slate-400 font-bold uppercase">
          {items.length} Events
        </span>
      </div>

      {/* Categories Filter list (Horizontal Scroll) */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 shrink-0 select-none">
        {(['all', 'earnings', 'corporate_action', 'regulation', 'management', 'rumor', 'macro', 'sector', 'general'] as const).map(filter => {
          const count = categoryCounts[filter];
          if (count === 0 && filter !== 'all') return null;

          const isActive = selectedFilter === filter;
          return (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-all shrink-0 ${
                isActive
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-850 text-slate-500 hover:text-slate-755 hover:border-slate-300'
              }`}
            >
              {filter === 'all' ? 'All' : CATEGORY_MAP[filter].label} ({count})
            </button>
          );
        })}
      </div>

      {/* News Timeline Container */}
      <div className="flex-grow overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Activity className="w-5 h-5 animate-spin text-indigo-500 mb-2" />
            <span className="text-[9px] font-black uppercase tracking-widest">Scanning News Feed...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-16 text-slate-400 space-y-2">
            <AlertCircle size={24} className="mx-auto text-slate-500" />
            <p className="text-[10px] font-bold">No active catalysts identified.</p>
            <p className="text-[9px] text-slate-500 max-w-[200px] mx-auto">
              There are no current announcements or market updates matching this category.
            </p>
          </div>
        ) : (
          <div className="relative border-l border-slate-200 dark:border-slate-800 pl-4 ml-2.5 space-y-5 py-2">
            {filteredItems.map(item => {
              const catMeta = CATEGORY_MAP[item.catalystCategory] || CATEGORY_MAP.general;
              const CatIcon = catMeta.icon;
              
              // Sentiment styling
              const sentimentDotColor = 
                item.sentimentRating === 'bullish' ? 'bg-emerald-500 shadow-emerald-500/50' : 
                item.sentimentRating === 'bearish' ? 'bg-rose-500 shadow-rose-500/50' : 
                'bg-slate-400 dark:bg-slate-600 shadow-slate-500/50';

              return (
                <div key={item.id} className="relative group animate-in fade-in slide-in-from-left-2 duration-300">
                  {/* Timeline bullet dot */}
                  <span className={`absolute -left-[20.5px] top-1.5 flex h-2.5 w-2.5 items-center justify-center rounded-full ring-4 ring-white dark:ring-slate-900 ${sentimentDotColor} shadow-md`}></span>

                  {/* Catalyst Item content */}
                  <div className="space-y-1.5 hover:translate-x-0.5 transition-transform duration-300">
                    {/* Category tag & Date */}
                    <div className="flex items-center justify-between">
                      <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border flex items-center gap-1 ${catMeta.color}`}>
                        <CatIcon size={9} />
                        {catMeta.label}
                      </span>
                      <span className="text-[8px] font-mono font-bold text-slate-400">
                        {formatDate(item.publishedAt)}
                      </span>
                    </div>

                    {/* Headline */}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group/link block"
                    >
                      <h4 className="text-[11px] font-black text-slate-800 dark:text-white group-hover/link:text-indigo-400 transition-colors leading-tight">
                        {item.title}
                        <ChevronRight size={10} className="inline-block opacity-0 group-hover/link:opacity-100 group-hover/link:translate-x-0.5 transition-all ml-0.5" />
                      </h4>
                    </a>

                    {/* Description summary */}
                    {item.description && (
                      <p className="text-[9.5px] text-slate-500 dark:text-slate-400 leading-normal font-medium line-clamp-3">
                        {item.description}
                      </p>
                    )}

                    {/* Source badge */}
                    <div className="flex items-center gap-1.5 text-[8px] text-slate-400 font-bold">
                      <span className="uppercase">{item.source}</span>
                      {item.sentimentRating !== 'neutral' && (
                        <span className={`uppercase tracking-wider ${item.sentimentRating === 'bullish' ? 'text-emerald-500' : 'text-rose-500'}`}>
                          • {item.sentimentRating}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
