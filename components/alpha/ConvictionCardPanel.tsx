// components/alpha/ConvictionCardPanel.tsx
// Phase 25 / CC68 (E.5) — Reusable unified conviction card.
// Header: CX /100 + Checks /23 + MCS /100 + verdict + magnitude bonus.
// Expand: 23 ConvictionEngine checks + 5-tile MCS sub-score strip
//         (reusing McsSubScoreCard.tsx from the MCE work — no duplicate work).
//
// Refactor on top, don't delete. The existing ConvergenceEngine and
// computeSniperScore continue to run; we just add a layer on top.

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, TrendingUp, TrendingDown, Flame, AlertTriangle, ChevronDown, ChevronRight, Zap, Activity, Crosshair, Eye, Ban } from 'lucide-react';
import type { ConvictionScore, ConvictionCheckResult } from '../../services/alpha/ConvictionEngine';
import { McsSubScoreCard } from './McsSubScoreCard';

// CC68.21: A McsSubScore's `reason` is a one-line phrase plus sometimes a
// secondary line. The McsSubScoreCard shows both, joined by a bullet. Strip
// out the duplicated "data unavailable — neutral" suffix the orchestrator
// appends so the card doesn't show the same wording twice.
const trimReason = (reason: string): string => {
  if (!reason) return reason;
  const cut = reason.indexOf(' — ');
  return cut > 0 ? reason.slice(0, cut) : reason;
};

// ──────────────────────────────────────────────────────────────────────────
// Single-line verdict (CC68.16) — one label, not 23 checks
// ──────────────────────────────────────────────────────────────────────────

type SingleVerdict = 'ENTRY' | 'WATCH' | 'SKIP';

const singleVerdict = (c: ConvictionScore): SingleVerdict => {
  if (c.killed) return 'SKIP';
  if (c.score >= 70 && c.mcs?.verdict === 'FIRE') return 'ENTRY';
  if (c.score >= 50) return 'WATCH';
  return 'SKIP';
};

const singleVerdictStyle = (v: SingleVerdict): { label: string; className: string; Icon: typeof Crosshair } => {
  if (v === 'ENTRY') {
    return {
      label: 'ENTRY',
      className: 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]',
      Icon: Crosshair,
    };
  }
  if (v === 'WATCH') {
    return {
      label: 'WATCH',
      className: 'bg-amber-500/10 border-amber-500/40 text-amber-300',
      Icon: Eye,
    };
  }
  return {
    label: 'SKIP',
    className: 'bg-slate-800/60 border-slate-700 text-slate-400',
    Icon: Ban,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type ConvictionCardVariant = 'cash' | 'fno';

export interface ConvictionCard {
  symbol: string;
  companyName?: string;
  ltp?: number;
  change?: number;
  sector?: string;
  conviction: ConvictionScore;
}

export interface ConvictionCardPanelProps {
  title: string;
  cards: ConvictionCard[];
  variant: ConvictionCardVariant;
  /** Optional cap. Defaults to 20 to keep the panel compact. */
  maxRows?: number;
  /** Show a small header pill summarizing the top result. */
  showHeaderPill?: boolean;
  emptyMessage?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Visual constants
// ──────────────────────────────────────────────────────────────────────────

const tierColor = (score: number, killed: boolean): { bg: string; text: string; badge: string; border: string } => {
  if (killed) {
    return {
      bg: 'bg-slate-900/40 border-slate-800/60',
      text: 'text-slate-500',
      badge: 'bg-slate-800 border-slate-700 text-slate-500',
      border: 'border-slate-800',
    };
  }
  if (score >= 80) {
    return {
      bg: 'bg-emerald-950/40 border-emerald-500/30 hover:border-emerald-500/60 hover:shadow-[0_0_20px_rgba(16,185,129,0.25)]',
      text: 'text-emerald-400',
      badge: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
      border: 'border-emerald-500/30',
    };
  }
  if (score >= 60) {
    return {
      bg: 'bg-indigo-950/40 border-indigo-500/30 hover:border-indigo-500/60 hover:shadow-[0_0_20px_rgba(99,102,241,0.25)]',
      text: 'text-indigo-400',
      badge: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400',
      border: 'border-indigo-500/30',
    };
  }
  if (score >= 40) {
    return {
      bg: 'bg-amber-950/30 border-amber-500/30 hover:border-amber-500/60',
      text: 'text-amber-400',
      badge: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
      border: 'border-amber-500/30',
    };
  }
  return {
    bg: 'bg-slate-900/40 border-slate-800 hover:border-slate-700',
    text: 'text-slate-400',
    badge: 'bg-slate-800 border-slate-700 text-slate-400',
    border: 'border-slate-800',
  };
};

const verdictBadge = (verdict: 'FIRE' | 'WAIT' | 'ABORT' | undefined): { label: string; className: string } => {
  if (verdict === 'FIRE') {
    return { label: 'MCS FIRE', className: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' };
  }
  if (verdict === 'ABORT') {
    return { label: 'MCS ABORT', className: 'bg-rose-500/10 border-rose-500/30 text-rose-400' };
  }
  return { label: 'MCS WAIT', className: 'bg-amber-500/10 border-amber-500/30 text-amber-400' };
};

// ──────────────────────────────────────────────────────────────────────────
// Check row
// ──────────────────────────────────────────────────────────────────────────

const CheckRow: React.FC<{ check: ConvictionCheckResult }> = ({ check }) => {
  const groupBadge: Record<ConvictionCheckResult['group'], string> = {
    A: 'A',
    B: 'B',
    C: 'C',
    D: 'D',
    E: 'E',
    F: 'F',
    G: 'G',
  };
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[10.5px] font-medium transition-all ${
        check.passed
          ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
          : 'bg-slate-950/50 border-slate-900 text-slate-500'
      }`}
    >
      <span className="text-[8.5px] font-black text-slate-500 w-3 shrink-0">{groupBadge[check.group]}</span>
      {check.passed ? (
        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
      ) : (
        <XCircle className="w-3 h-3 text-slate-700 shrink-0" />
      )}
      <span className="flex-1 truncate">{check.name}</span>
      <span className="text-[9.5px] text-slate-400 tabular-nums shrink-0">w{check.weight}</span>
      {check.measuredValue != null && (
        <span className="text-[9.5px] text-slate-300 tabular-nums shrink-0">
          {String(check.measuredValue)}
        </span>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// Single card
// ──────────────────────────────────────────────────────────────────────────

const ConvictionCard: React.FC<{ card: ConvictionCard; rank: number }> = ({ card, rank }) => {
  const [expanded, setExpanded] = useState(false);
  const { conviction } = card;
  const palette = tierColor(conviction.score, conviction.killed);
  const isBull = conviction.direction === 'CALL';
  const DirectionIcon = isBull ? TrendingUp : TrendingDown;
  const passes = conviction.checks.filter((c) => c.passed).length;
  const verdict = conviction.mcs?.verdict;
  // CC68.16: single-line ENTRY/WATCH/SKIP label
  const singleV = singleVerdict(conviction);
  const singleVStyle = singleVerdictStyle(singleV);
  const VerdictIcon = singleVStyle.Icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`rounded-2xl border p-3.5 backdrop-blur-sm transition-all ${palette.bg}`}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 text-left"
        aria-expanded={expanded}
        aria-label={`${card.symbol} conviction card`}
      >
        {/* Rank */}
        <span className="text-[10.5px] font-black text-slate-500 tabular-nums w-5 shrink-0">
          #{rank}
        </span>

        {/* Symbol + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-bold text-white truncate">{card.symbol}</span>
            {isBull ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            )}
            {card.sector && (
              <span className="text-[10px] text-slate-500 truncate">· {card.sector}</span>
            )}
          </div>
          {card.companyName && (
            <div className="text-[10.5px] text-slate-400 truncate mt-0.5">{card.companyName}</div>
          )}
        </div>

        {/* CX + checks */}
        <div className="text-right shrink-0">
          <div className={`text-[20px] font-black tabular-nums ${palette.text}`}>
            {conviction.killed ? 'KILLED' : conviction.score}
          </div>
          <div className="text-[9.5px] text-slate-500 tabular-nums -mt-0.5">
            CX /100 · {passes}/{conviction.checks.length} checks
          </div>
        </div>

        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
        )}
      </button>

      {/* CC68.16: Single-line verdict badge — ENTRY / WATCH / SKIP */}
      <div className="mt-2.5 flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] font-black uppercase tracking-wider ${singleVStyle.className}`}
        >
          <VerdictIcon className="w-3.5 h-3.5" />
          {singleVStyle.label}
        </span>
        {conviction.kills[0] && (
          <span className="text-[10px] text-rose-300/80 font-semibold truncate">
            {conviction.kills[0].id.replace(/_/g, ' ').toLowerCase()}
          </span>
        )}
      </div>

      {/* Sub-header: magnitude bonus + MCS verdict + direction */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        <span className={`text-[9.5px] font-bold uppercase px-2 py-0.5 rounded border ${palette.badge}`}>
          {conviction.direction}
        </span>
        {!conviction.killed && conviction.magnitudeBonus > 0 && (
          <span className="text-[9.5px] font-bold uppercase px-2 py-0.5 rounded border bg-amber-500/10 border-amber-500/20 text-amber-400 flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" /> +{conviction.magnitudeBonus}
          </span>
        )}
        {conviction.mcs && (
          <span className={`text-[9.5px] font-bold uppercase px-2 py-0.5 rounded border ${verdictBadge(verdict).className}`}>
            {conviction.mcs.total}/100
          </span>
        )}
        {conviction.kills.length > 0 && (
          <span className="text-[9.5px] font-bold uppercase px-2 py-0.5 rounded border bg-rose-500/10 border-rose-500/30 text-rose-400 flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" /> {conviction.kills[0].id}
          </span>
        )}
      </div>

      {/* Reason line */}
      <div className="text-[10.5px] text-slate-300 mt-2 line-clamp-2">
        {conviction.reason}
        {conviction.weakness && (
          <span className="text-slate-500"> · weak: {conviction.weakness}</span>
        )}
      </div>

      {/* Expand */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="pt-3 mt-3 border-t border-slate-800/60 space-y-3">
              {/* 23-check grid */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1.5">
                  <Activity className="w-3 h-3" /> 23 checks
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {conviction.checks.map((c) => (
                    <CheckRow key={c.id} check={c} />
                  ))}
                </div>
              </div>

              {/* MCS sub-score strip */}
              {conviction.mcs && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1.5">
                    <Flame className="w-3 h-3" /> MCS momentum continuation (5 sub-scores)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <McsSubScoreCard label="HTF" score={conviction.mcs.subScores.htf} bullets={[trimReason(conviction.mcs.subScores.htf.reason)]} />
                    <McsSubScoreCard label="Indicators" score={conviction.mcs.subScores.indicators} bullets={[trimReason(conviction.mcs.subScores.indicators.reason)]} />
                    <McsSubScoreCard label="Flow" score={conviction.mcs.subScores.flow} bullets={[trimReason(conviction.mcs.subScores.flow.reason)]} />
                    <McsSubScoreCard label="Regime" score={conviction.mcs.subScores.regime} bullets={[trimReason(conviction.mcs.subScores.regime.reason)]} />
                    <McsSubScoreCard label="GEX" score={conviction.mcs.subScores.gex} bullets={[trimReason(conviction.mcs.subScores.gex.reason)]} />
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// Panel
// ──────────────────────────────────────────────────────────────────────────

export const ConvictionCardPanel: React.FC<ConvictionCardPanelProps> = ({
  title,
  cards,
  variant,
  maxRows = 20,
  showHeaderPill = true,
  emptyMessage = 'No candidates',
}) => {
  const sortedCards = useMemo(
    () =>
      [...cards]
        .filter((c) => !c.conviction.killed)
        .sort((a, b) => b.conviction.score - a.conviction.score || b.conviction.passedWeight - a.conviction.passedWeight)
        .slice(0, maxRows),
    [cards, maxRows]
  );

  // CC68.19: Diagnostic — every card is being marked `killed` because
  // `buildInputsFromStock` maps `rvol=undefined → 0` and the RVOL_DEAD
  // kill (weight 8) fires immediately. Show all cards (including killed)
  // so the panel is never empty, and surface the kill reason. The user
  // asked for "single verdict information" — SKIP is itself a verdict.
  const displayCards = cards.slice(0, maxRows);

  const topScore = sortedCards[0]?.conviction.score ?? 0;
  const topPasses = sortedCards[0]?.conviction.checks.filter((c) => c.passed).length ?? 0;
  const topTotal = sortedCards[0]?.conviction.checks.length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-white uppercase tracking-wider flex items-center gap-2">
          {variant === 'cash' ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <Flame className="w-4 h-4 text-rose-400" />}
          {title}
          <span className="text-[10px] text-slate-500 font-normal normal-case">({variant === 'cash' ? 'Cash' : 'F&O'})</span>
        </h3>
        {showHeaderPill && topScore > 0 && (
          <div className="text-[10.5px] text-slate-400">
            Top: <span className="text-emerald-400 font-bold">{sortedCards[0].symbol}</span> · {topScore}/100 · {topPasses}/{topTotal} checks
          </div>
        )}
      </div>

      {displayCards.length === 0 ? (
        <div className="text-[12px] text-slate-500 italic text-center py-6 border border-dashed border-slate-800 rounded-xl">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedCards.length === 0 && cards.length > 0 && (
            <div className="text-[10.5px] text-amber-400/80 italic px-3 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
              All {cards.length} cards are flagged as SKIP — showing them with their kill reason so you can see the verdict anyway.
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {displayCards.map((card, i) => (
              <ConvictionCard key={card.symbol} card={card} rank={i + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConvictionCardPanel;
