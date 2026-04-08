import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { tactileHover } from '../../ui/animations';
import { fadeRise } from '../../ui/motion';
import {
  Sun, Sunrise, Sunset, Moon, Clock, TrendingUp, TrendingDown, Sparkles, Coffee
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useFamily } from '../../../contexts/FamilyContext';
import { usePortfolioStore } from '../../../store/portfolioStore';
import { useShallow } from 'zustand/react/shallow';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { formatCurrencyCompact } from '../../../utils/helpers';

// ---------------------------------------------------------------
// Market hours helpers (local IST clock — same source as
// hooks/useMarketSentiment.ts and types/trust.ts:isMarketHours).
// ---------------------------------------------------------------
const MARKET_OPEN_MIN = 9 * 60 + 15;   // 09:15
const MARKET_CLOSE_MIN = 15 * 60 + 30; // 15:30

const IST_HOLIDAYS = new Set<string>([
  '2024-12-25',
  '2025-01-26', '2025-03-14', '2025-04-14', '2025-08-15',
  '2025-10-02', '2025-11-04',
]);

const toIST = (d: Date) => {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 60 * 60000);
};

const isTradingDay = (ist: Date) => {
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const ymd = ist.toISOString().split('T')[0];
  return !IST_HOLIDAYS.has(ymd);
};

const nextTradingDay = (ist: Date) => {
  const probe = new Date(ist);
  probe.setDate(probe.getDate() + 1);
  let guard = 0;
  while (!isTradingDay(probe) && guard < 10) {
    probe.setDate(probe.getDate() + 1);
    guard += 1;
  }
  return probe;
};

type MarketState =
  | { kind: 'PRE'; minutesUntil: number }
  | { kind: 'OPEN'; minutesUntilClose: number }
  | { kind: 'POST'; opensAt: Date; opensLabel: string };

const computeMarketState = (now: Date): MarketState => {
  const ist = toIST(now);
  const minutes = ist.getHours() * 60 + ist.getMinutes();

  if (!isTradingDay(ist)) {
    const next = nextTradingDay(ist);
    const opens = new Date(next);
    opens.setHours(9, 15, 0, 0);
    const opensLabel = next.toLocaleDateString('en-IN', {
      weekday: 'short',
    }) + ' 9:15 AM';
    return { kind: 'POST', opensAt: opens, opensLabel };
  }

  if (minutes < MARKET_OPEN_MIN) {
    return { kind: 'PRE', minutesUntil: MARKET_OPEN_MIN - minutes };
  }
  if (minutes < MARKET_CLOSE_MIN) {
    return { kind: 'OPEN', minutesUntilClose: MARKET_CLOSE_MIN - minutes };
  }
  const next = nextTradingDay(ist);
  const opens = new Date(next);
  opens.setHours(9, 15, 0, 0);
  const opensLabel = next.toLocaleDateString('en-IN', {
    weekday: 'short',
  }) + ' 9:15 AM';
  return { kind: 'POST', opensAt: opens, opensLabel };
};

const formatHM = (totalMinutes: number) => {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
};

// Time-of-day greeting picker
const getGreeting = (ist: Date) => {
  const h = ist.getHours();
  if (h >= 5 && h < 12) return { text: 'Good morning', icon: Sunrise, tone: 'from-amber-50 via-orange-50 to-rose-50 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-rose-950/20' };
  if (h >= 12 && h < 17) return { text: 'Good afternoon', icon: Sun, tone: 'from-sky-50 via-indigo-50 to-violet-50 dark:from-sky-950/30 dark:via-indigo-950/20 dark:to-violet-950/20' };
  if (h >= 17 && h < 22) return { text: 'Good evening', icon: Sunset, tone: 'from-violet-50 via-fuchsia-50 to-rose-50 dark:from-violet-950/30 dark:via-fuchsia-950/20 dark:to-rose-950/20' };
  return { text: 'Late night trader', icon: Moon, tone: 'from-slate-100 via-indigo-100 to-slate-200 dark:from-slate-900 dark:via-indigo-950/30 dark:to-slate-900' };
};

/**
 * CC45 #5 — Daily Greeting Widget
 *
 * Subtle personalized greeting at the top of the dashboard. Three lines of text:
 *   1. "Good morning, {firstName}"   (varies by time of day)
 *   2. Market status with countdown  ("opens in 1h 23m", "open, 2h 15m to close", "closed, opens Mon 9:15 AM")
 *   3. Optional: today's P&L or a one-line "daily plan" note from the user
 *
 * Skipped on mobile (where space is tight) and never re-mounts on tab switch.
 */
const DailyGreetingWidget: React.FC = () => {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { activeEntity, getEntityName } = useFamily();

  // Use lazy subscriptions to avoid re-rendering on every store mutation.
  const dayChange = usePortfolioStore(
    useShallow((s) => s.stats?.dayChange ?? 0),
  );
  const dayChangePercent = usePortfolioStore(
    useShallow((s) => s.stats?.dayChangePercent ?? 0),
  );

  // 1-min tick so the countdown stays live without re-rendering the rest of the dashboard.
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { firstName, fallback } = useMemo(() => {
    const raw =
      (user?.name && user.name.trim()) ||
      (activeEntity !== 'ALL' ? getEntityName(activeEntity) : '') ||
      'Trader';
    const first = raw.split(/\s+/)[0] || 'Trader';
    return { firstName: first, fallback: raw };
  }, [user?.name, activeEntity, getEntityName]);

  const { greeting, market } = useMemo(() => {
    const now = new Date();
    return {
      greeting: getGreeting(toIST(now)),
      market: computeMarketState(now),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1. Mobile → don't render (we want the dashboard to stay compact).
  // 2. Don't render inside SPENDING / MARKETS / COMMUNITY view (only main view is wired in).
  if (isMobile) return null;

  const GreetingIcon = greeting.icon;
  const hasPnL = Math.abs(dayChange) > 0;
  const pnlPositive = dayChange >= 0;
  const PnlIcon = pnlPositive ? TrendingUp : TrendingDown;

  let marketLine: string;
  let marketIcon: typeof Clock = Clock;
  let marketTone = 'text-slate-600 dark:text-slate-300';
  if (market.kind === 'PRE') {
    marketLine = `Market opens in ${formatHM(market.minutesUntil)}`;
    marketIcon = Clock;
    marketTone = 'text-amber-700 dark:text-amber-300';
  } else if (market.kind === 'OPEN') {
    marketLine = `Market is open · ${formatHM(market.minutesUntilClose)} to close`;
    marketIcon = Sparkles;
    marketTone = 'text-emerald-700 dark:text-emerald-300';
  } else {
    marketLine = `Market is closed · opens ${market.opensLabel}`;
    marketIcon = Coffee;
    marketTone = 'text-slate-600 dark:text-slate-400';
  }

  return (
    <motion.div
      variants={fadeRise}
      initial="initial"
      animate="animate"
      {...tactileHover}
      className={`relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-r ${greeting.tone} px-4 py-3 sm:px-5 sm:py-3.5 shadow-sm dark:border-slate-800/70`}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/30 blur-3xl dark:bg-white/5" />
      <div className="relative flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
        {/* Left: greeting */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 text-amber-600 shadow-sm ring-1 ring-amber-200/60 backdrop-blur dark:bg-slate-900/60 dark:text-amber-300 dark:ring-amber-500/20">
            <GreetingIcon size={18} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-white sm:text-base">
              {greeting.text}, <span className="bg-gradient-to-r from-amber-600 via-rose-600 to-indigo-600 bg-clip-text text-transparent dark:from-amber-300 dark:via-rose-300 dark:to-indigo-300">{firstName}</span>
            </p>
            <div className={`mt-0.5 flex items-center gap-1.5 text-[11px] font-medium sm:text-xs ${marketTone}`}>
              {React.createElement(marketIcon, { size: 12, className: 'shrink-0' })}
              <span className="truncate">{marketLine}</span>
            </div>
          </div>
        </div>

        {/* Right: optional P&L pill */}
        {hasPnL && (
          <div className="flex shrink-0 items-center gap-1.5 self-start rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold shadow-sm ring-1 ring-slate-200/60 backdrop-blur sm:self-auto dark:bg-slate-900/60 dark:ring-slate-700/60">
            <PnlIcon
              size={12}
              className={pnlPositive ? 'text-emerald-500' : 'text-rose-500'}
            />
            <span className={pnlPositive ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
              {pnlPositive ? '+' : ''}
              {formatCurrencyCompact(dayChange)} ({pnlPositive ? '+' : ''}
              {dayChangePercent.toFixed(2)}%)
            </span>
            <span className="hidden text-slate-400 sm:inline">today</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default DailyGreetingWidget;
