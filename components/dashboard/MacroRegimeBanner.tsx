import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, ShieldAlert, Flame, Activity,
  ArrowDownCircle, Sparkles, AlertCircle, RefreshCw
} from 'lucide-react';
import { useMarketSentiment } from '../../hooks/useMarketSentiment';
import { usePausedInterval } from '../../hooks/usePausedInterval';
import { fetchMacroIndicators, MacroIndicator } from '../../services/RealDataService';
import { useMacroRegimeStore } from '../../store/macroRegimeStore';
import { useShallow } from 'zustand/react/shallow';
import { macroRegimeService } from '../../services/MacroRegimeService';
import { MacroRegime } from '../../types';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

const ICON_MAP = {
  TrendingUp: TrendingUp,
  ShieldAlert: ShieldAlert,
  Flame: Flame,
  Activity: Activity,
  ArrowDownCircle: ArrowDownCircle,
  Sparkles: Sparkles,
};

export const MacroRegimeBanner: React.FC = () => {
  const { vix, fiiDiiNet } = useMarketSentiment();
  // P0#3: useShallow wraps the multi-field destructure so the banner only
  // re-renders when one of these 5 fields actually changes.
  const { currentRegime, lastUpdated, filterEnabled, updateRegime, toggleFilter } = useMacroRegimeStore(
    useShallow(state => ({
      currentRegime: state.currentRegime,
      lastUpdated: state.lastUpdated,
      filterEnabled: state.filterEnabled,
      updateRegime: state.updateRegime,
      toggleFilter: state.toggleFilter,
    }))
  );
  const [indicators, setIndicators] = useState<MacroIndicator[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAndSync = async (force = false) => {
    try {
      setLoading(true);
      const macroList = await fetchMacroIndicators(force);
      setIndicators(macroList);
      updateRegime(macroList, fiiDiiNet);
    } catch (e) {
      console.warn('MacroRegimeBanner: failed to sync indicators', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAndSync();
  }, [vix, fiiDiiNet]);

  usePausedInterval(() => fetchAndSync(true), 10 * 60 * 1000, { runImmediately: false });

  const config = macroRegimeService.getRegimeConfig(currentRegime);
  const IconComponent = ICON_MAP[config.icon as keyof typeof ICON_MAP] || AlertCircle;

  return (
    <div className="w-full rounded-wa-lg bg-slate-900/80 dark:bg-wa-card backdrop-blur-xl px-4 py-3 border border-slate-800/80 dark:border-wa-border relative z-20 overflow-hidden shadow-sm">
      {/* Visual background elements */}
      <div className={`absolute inset-0 bg-gradient-to-r ${config.color} opacity-25 dark:opacity-20 transition-all duration-500`} />
      
      <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Left: Icon, Name and Description */}
        <div className="flex items-start gap-3 max-w-3xl">
          <div className="p-2 rounded-wa-sm bg-indigo-500/10 dark:bg-wa-card-elevated border border-indigo-500/20 dark:border-wa-border shadow-inner mt-0.5 backdrop-blur-md">
            <IconComponent className="w-5 h-5 animate-pulse text-indigo-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black tracking-widest text-slate-400 uppercase">
                Macro Regime Detector
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500/50" />
              <span className="text-sm font-black uppercase text-indigo-400">
                {config.name}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              {config.description}
            </p>
          </div>
        </div>

        {/* Right: Quick Action Controls and Stats */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto md:justify-end">
          {/* Spark metrics (VIX, FII) */}
          <div className="flex items-center gap-3 bg-slate-900/60 dark:bg-wa-surface/80 backdrop-blur-md border border-slate-800/80 dark:border-wa-border rounded-wa-md px-3 py-1.5 text-[10px] font-mono">
            <div className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-400">INDIA VIX</span>
              <span className={`font-bold ${vix > 20 ? 'text-amber-500 dark:text-amber-400' : 'text-emerald-500 dark:text-emerald-400'}`}>
                {vix.toFixed(2)}
              </span>
            </div>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
            <div className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-400">FII NET FLOW</span>
              <span className={`font-bold ${fiiDiiNet >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                {fiiDiiNet >= 0 ? '+' : ''}{fiiDiiNet.toLocaleString('en-IN')} Cr
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant={filterEnabled ? "default" : "secondary"}
              size="sm"
              onClick={() => toggleFilter()}
              className="text-[10px] uppercase font-bold tracking-wider h-7 px-3"
            >
              {filterEnabled ? 'Regime Filtering On' : 'Regime Filter Off'}
            </Button>

            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => fetchAndSync(true)}
              disabled={loading}
              title="Refresh Macro Data"
              className="h-7 w-7 p-0 aspect-square flex items-center justify-center shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MacroRegimeBanner;
