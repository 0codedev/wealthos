// hooks/useMcsSnapshot.ts
// Selects pre-entry or hold snapshot from mceStore.
// Drives a 2-s re-score cycle.

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMceStore } from '../store/mceStore';
import { mceOrchestrator } from '../services/mce/orchestrator';
import { McsSnapshot, HoldSnapshot, GexFeatureVector } from '../services/mce/types';

const REFRESH_MS = 2000;
const GEX_REFRESH_MS = 60_000;

export function usePreEntrySnapshot(symbol: string | null): McsSnapshot | null {
  const snapshot = useMceStore(
    useShallow(s => (symbol ? s.preEntrySnapshots.get(symbol) ?? null : null))
  );

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const next = await mceOrchestrator.score(symbol, 'PRE_ENTRY');
      if (cancelled || !next) return;
      useMceStore.getState().setPreEntrySnapshot(symbol, next);
    };
    tick();
    const id = window.setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol]);

  return snapshot;
}

export function useHoldSnapshot(symbol: string | null): HoldSnapshot | null {
  const hold = useMceStore(
    useShallow(s => (symbol ? s.holdSnapshots.get(symbol) ?? null : null))
  );

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const next = await mceOrchestrator.score(symbol, 'HOLD');
      if (cancelled || !next) return;
      const fillMcs = mceOrchestrator.getFillMcs(symbol);
      const { computeHoldVerdict } = await import('../services/mce/confluenceScorer');
      const holdVerdict = computeHoldVerdict(next.score, fillMcs);
      const delta = fillMcs == null ? 0 : next.score.total - fillMcs;
      useMceStore.getState().setHoldSnapshot(symbol, {
        current: next,
        fillMcs,
        delta,
        holdVerdict,
      });
    };
    tick();
    const id = window.setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol]);

  return hold;
}

export function useGexSnapshot(symbol: string | null): GexFeatureVector | null {
  const features = useMceStore(
    useShallow(s => (symbol ? s.gexSnapshots.get(symbol)?.features ?? null : null))
  );

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const { extractGexFeatures } = await import('../services/mce/gexExtractor');
        const { scoreGex } = await import('../services/mce/gexScorer');
        const { DEFAULT_WEIGHTS } = await import('../services/mce/types');
        const f = await extractGexFeatures(symbol, Date.now());
        if (cancelled || !f) return;
        const subScore = scoreGex(f, DEFAULT_WEIGHTS.gex);
        useMceStore.getState().setGexSnapshot(symbol, { symbol, asOf: f.asOf, features: f, subScore });
      } catch {
        // swallow — orchestrator handles errors
      }
    };
    tick();
    const id = window.setInterval(tick, GEX_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol]);

  return features;
}

export function useActiveTickerSymbol(): string | null {
  return useMceStore(useShallow(s => {
    let latestSymbol: string | null = null;
    let latestAsOf = -1;
    s.preEntrySnapshots.forEach((snap, sym) => {
      if (snap.asOf > latestAsOf) {
        latestAsOf = snap.asOf;
        latestSymbol = sym;
      }
    });
    return latestSymbol;
  }));
}