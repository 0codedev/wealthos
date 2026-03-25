// components/alpha/MomentumContinuationWidget.tsx
// First card on the Alpha tab. Full-width. 2-col sub-score grid.
// Spec: §6

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight, RefreshCw, CircleDot } from 'lucide-react';
import { usePreEntrySnapshot, useActiveTickerSymbol, useGexSnapshot } from '../../hooks/useMcsSnapshot';
import { useMlWeights } from '../../hooks/useMlWeights';
import { McsSubScoreCard } from './McsSubScoreCard';
import { McsEmptyState } from './McsEmptyState';
import { CountUp } from '../shared/CountUp';
import { ValueFlash } from '../shared/ValueFlash';
import { SkeletonWidget } from '../ui/Skeleton';
import { useNavigationIntentStore } from '../../store/navigationIntentStore';
import { mceOrchestrator } from '../../services/mce/orchestrator';
import { logger } from '../../services/Logger';
import { consultFinanceAi, type LlmConfirmResponse } from '../../services/mce/llmConfirm';
import type { GexFeatureVector } from '../../services/mce/types';

function buildGexBullets(features: GexFeatureVector | null): string[] {
  if (!features) return ['GEX computing…'];
  const bullets: string[] = [];
  if (features.netGexCrores !== 0) {
    const tone = features.netGexCrores > 2 ? 'range-bound' : features.netGexCrores < -2 ? 'trending' : 'neutral';
    const sign = features.netGexCrores >= 0 ? '+' : '−';
    bullets.push(`Net GEX ${sign}₹${Math.abs(features.netGexCrores).toFixed(1)} cr (${tone})`);
  }
  if (features.magnetStrike != null) {
    const wall = (features.magnetGexCrores ?? 0) < 0 ? 'call wall' : 'put wall';
    const sign = (features.magnetGexCrores ?? 0) >= 0 ? '+' : '−';
    bullets.push(`Magnet ${features.magnetStrike} (${wall}, ${sign}₹${Math.abs(features.magnetGexCrores ?? 0).toFixed(1)} cr)`);
  }
  if (features.ivSkewAtm != null) {
    const tone = features.ivSkewAtm > 0.5 ? 'fear' : features.ivSkewAtm < -0.5 ? 'complacency' : 'balanced';
    bullets.push(`IV skew ${features.ivSkewAtm >= 0 ? '+' : ''}${features.ivSkewAtm.toFixed(2)} (${tone})`);
  }
  if (features.distanceToMagnetPct != null) {
    const zone = features.distanceToMagnetPct < 0.3 ? 'in reaction zone' : features.distanceToMagnetPct < 1 ? 'approaching' : 'far';
    bullets.push(`${features.distanceToMagnetPct.toFixed(2)}% from magnet — ${zone}`);
  }
  if (features.dataQuality === 'THIN') {
    bullets.push('Chain thin — GEX unreliable');
  }
  return bullets.slice(0, 4);
}

function buildGexSubScore(features: GexFeatureVector | null): { value: number; weight: number; reason: string; dataAvailable: boolean } {
  if (!features) return { value: 0.5, weight: 0.20, reason: 'GEX computing…', dataAvailable: false };
  if (features.dataQuality === 'THIN') return { value: 0.5, weight: 0.20, reason: 'Chain thin — GEX unreliable', dataAvailable: false };
  if (features.magnetStrike == null || features.distanceToMagnetPct == null) {
    return { value: 0.5, weight: 0.20, reason: 'No magnet strike identified', dataAvailable: false };
  }
  const d = features.distanceToMagnetPct;
  const raw = 1 - Math.min(d / 2.0, 1);
  return { value: 0.5 + 0.5 * raw, weight: 0.20, reason: '', dataAvailable: true };
}

function verdictChip(verdict: 'FIRE' | 'WAIT' | 'ABORT') {
  const map = {
    FIRE:  'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
    WAIT:  'bg-amber-500/20 text-amber-200 border-amber-400/40',
    ABORT: 'bg-rose-500/25 text-rose-200 border-rose-400/40',
  };
  return map[verdict];
}

function pickBullets(s: { reason: string }): string[] {
  return s.reason.split(';').map(p => p.trim()).filter(Boolean).slice(0, 3);
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

export const MomentumContinuationWidget: React.FC = () => {
  const symbol = useActiveTickerSymbol();
  const snapshot = usePreEntrySnapshot(symbol);
  const gexSnapshot = useGexSnapshot(symbol);
  const weightsLookup = useMlWeights(symbol, snapshot?.features ?? null);
  const [now, setNow] = useState(Date.now());
  const [aiOpinion, setAiOpinion] = useState<LlmConfirmResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!symbol) return <McsEmptyState />;
  if (!snapshot) return <SkeletonWidget className="mb-4" />;

  const { score, asOf } = snapshot;

  const handleAskFinanceAi = async () => {
    if (!symbol || !snapshot) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const resp = await consultFinanceAi({
        symbol,
        totalScore: score.total,
        verdict: score.verdict,
        confidence: score.confidence,
        subScores: {
          htf: score.subScores.htf,
          indicators: score.subScores.indicators,
          flow: score.subScores.flow,
          regime: score.subScores.regime,
          gex: buildGexSubScore(gexSnapshot),
        },
        gexSnapshot,
      });
      setAiOpinion(resp);
    } catch (err: any) {
      setAiError(err?.message || 'Failed to fetch AI second opinion');
    } finally {
      setAiLoading(false);
    }
  };

  const handlePrepareOrder = () => {
    if (score.verdict !== 'FIRE') return;
    window.dispatchEvent(new CustomEvent('mce:prepare-order', {
      detail: { symbol, snapshot },
    }));
    useNavigationIntentStore.getState().setIntent({
      target: 'portfolio',
      action: 'open-add-trade-modal',
      payload: { symbol, mcsTotal: score.total },
      createdAt: Date.now(),
    });
    logger.info('[MCE] prepare-order dispatched', { symbol, mcsTotal: score.total });
  };

  return (
    <motion.section
      aria-label="Momentum Continuation Score"
      className="glass-card p-5 mb-4 col-span-full"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xs uppercase tracking-[0.18em] text-slate-400">Momentum Continuation</h2>
          <p className="text-sm text-slate-300 mt-1">
            {symbol} · pre-entry · updated {ago(asOf)} at {new Date(now).toLocaleTimeString()}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ValueFlash value={score.total}>
              <CountUp value={score.total} duration={0.6} className="text-4xl font-bold tabular-nums text-white" />
            </ValueFlash>
            <div className="flex flex-col">
              <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${verdictChip(score.verdict)}`}>
                {score.verdict}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-slate-400 mt-1">
                <CircleDot className={`w-3 h-3 ${score.confidence >= 0.7 ? 'text-emerald-400' : score.confidence >= 0.4 ? 'text-amber-400' : 'text-rose-400'}`} />
                Confidence {Math.round(score.confidence * 100)}%
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Ask Ling-3.0 Finance AI for institutional second opinion"
            onClick={handleAskFinanceAi}
            disabled={aiLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-xs font-medium text-indigo-300 transition-all disabled:opacity-50"
            title="Institutional trade second opinion powered by Ling-3.0-flash-Fin"
          >
            <Sparkles className={`w-3.5 h-3.5 ${aiLoading ? 'animate-spin text-indigo-400' : 'text-indigo-400'}`} />
            {aiLoading ? 'Consulting Finance AI…' : 'Ask Finance AI'}
          </button>
        </div>
      </header>

      {aiOpinion && (
        <div className="mb-4 p-3.5 rounded-lg bg-indigo-950/30 border border-indigo-500/30 text-xs space-y-2">
          <div className="flex items-center justify-between text-indigo-200 font-semibold">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Institutional Second Opinion ({aiOpinion.modelUsed})
            </span>
            <button
              type="button"
              onClick={() => setAiOpinion(null)}
              className="text-slate-400 hover:text-slate-200 text-xs px-1"
            >
              ✕
            </button>
          </div>
          <p className="text-slate-200 font-medium">{aiOpinion.verdictSummary}</p>
          {aiOpinion.bulletPoints.length > 0 && (
            <ul className="space-y-1 text-slate-300 pl-4 list-disc">
              {aiOpinion.bulletPoints.map((bp, idx) => (
                <li key={idx}>{bp}</li>
              ))}
            </ul>
          )}
          <div className="pt-1 text-[11px] text-indigo-300/80 font-mono">
            ⚡ Action: {aiOpinion.recommendedAction}
          </div>
        </div>
      )}

      {aiError && (
        <div className="mb-4 p-2.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <span>{aiError}</span>
          <button type="button" onClick={() => setAiError(null)} className="text-rose-400 hover:text-rose-200 px-1">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <McsSubScoreCard label="Higher-Timeframe Context"   score={score.subScores.htf}        bullets={pickBullets(score.subScores.htf)} />
        <McsSubScoreCard label="Indicators"                 score={score.subScores.indicators} bullets={pickBullets(score.subScores.indicators)} />
        <McsSubScoreCard label="Order Flow & Derivatives"   score={score.subScores.flow}       bullets={pickBullets(score.subScores.flow)} />
        <McsSubScoreCard label="Market Regime"              score={score.subScores.regime}     bullets={pickBullets(score.subScores.regime)} />
        <McsSubScoreCard
          label="Dealer Gamma (GEX)"
          score={buildGexSubScore(gexSnapshot)}
          bullets={buildGexBullets(gexSnapshot)}
        />
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span
          className="text-[11px] text-slate-400 flex items-center gap-1"
          title={
            `htf: ${weightsLookup.weights.htf.toFixed(3)}\n` +
            `indicators: ${weightsLookup.weights.indicators.toFixed(3)}\n` +
            `flow: ${weightsLookup.weights.flow.toFixed(3)}\n` +
            `regime: ${weightsLookup.weights.regime.toFixed(3)}\n` +
            `gex: ${weightsLookup.weights.gex.toFixed(3)}\n` +
            `FIRE ≥ ${weightsLookup.fireCutoff}, WAIT ≥ ${weightsLookup.waitCutoff}\n` +
            `source: ${weightsLookup.source}`
          }
        >
          Weights: {weightsLookup.source === 'HARD_DEFAULT' ? 'equal (defaults)' : `learned (${weightsLookup.source.toLowerCase().replace('_', ' ')})`}
          <span aria-hidden>·</span>
          <RefreshCw className="inline w-3 h-3" /> 2-s refresh
        </span>
        <button
          type="button"
          onClick={handlePrepareOrder}
          disabled={score.verdict !== 'FIRE'}
          aria-label="Prepare order based on this momentum score"
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold transition ${
            score.verdict === 'FIRE'
              ? 'bg-emerald-500/90 text-slate-900 hover:bg-emerald-400'
              : 'bg-slate-700/50 text-slate-400 cursor-not-allowed'
          }`}
        >
          Prepare order <ArrowRight className="w-4 h-4" />
        </button>
      </footer>
    </motion.section>
  );
};

// helper exported for App.tsx fill-recording
export function recordFillForSymbol(symbol: string, mcsTotal: number) {
  mceOrchestrator.recordFill(symbol, mcsTotal);
}