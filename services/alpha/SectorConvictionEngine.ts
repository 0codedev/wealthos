/**
 * SectorConvictionEngine — Unified sector score (E.5b)
 * ─────────────────────────────────────────────────────────────────────────
 * Phase 25 / CC68. Sits ON TOP of the existing per-sector signals.
 *   • X-Factor z-score (existing, weight 30) — from services/AlphaEngineService.computeXFactor
 *   • SCS — Sector Confluence Score proxy (existing, weight 25) — from TradeSniperPanel
 *   • Fatigue inverse — springboard bonus (existing, weight 20) — from services/AlphaEngineService
 *   • Rotation rank (existing, weight 25) — from services/alpha/StockSelectionEngine
 *
 * Output: a single per-sector score in -100..+100 with intensity |score|
 * and a tier label. Treemap tile color/intensity is driven by this.
 *
 * Hard rules (project-wide):
 *   • No I/O. Pure function. ~0.05 ms per sector.
 *   • No new dependencies.
 *   • Refactor on top. The existing sector signals keep running.
 */

export type SectorTier =
  | 'EXTREME_BULL'
  | 'STRONG_BULL'
  | 'MILD_BULL'
  | 'NEUTRAL'
  | 'MILD_BEAR'
  | 'STRONG_BEAR'
  | 'EXTREME_BEAR';

export interface SectorConvictionInputs {
  sectorName: string;
  /** Z-score against 20-day distribution. Range roughly -5..+5. */
  zFactor: number | null;
  /** Sector Confluence Score proxy. Range -100..+100. */
  scs: number | null;
  /** Consecutive days direction. Negative = springboard, positive = exhaustion. */
  fatigueScore: number | null;
  fatigueState?: 'springboard' | 'exhaustion' | 'neutral' | null;
  /** 1 = leader, higher = lagging. */
  rotationRank: number | null;
  /** Total sectors in rotation board. */
  rotationTotal: number | null;
}

export interface SectorConvictionScore {
  sectorName: string;
  score: number;                // -100..+100
  intensity: number;            // 0..100, |score|
  tier: SectorTier;
  components: {
    zFactor: number;            // 0..100 normalized
    scs: number;
    fatigue: number;            // 0..100 normalized, 100 = strong springboard for bull or strong exhaustion for bear
    rotation: number;           // 0..100 normalized, 100 = leader
  };
  reason: string;               // one-line, e.g. "z=+2.4, leader, springboard"
}

// ──────────────────────────────────────────────────────────────────────────
// Weights (sum to 100)
// ──────────────────────────────────────────────────────────────────────────

const W_ZFACTOR = 30;
const W_SCS = 25;
const W_FATIGUE = 20;
const W_ROTATION = 25;

// ──────────────────────────────────────────────────────────────────────────
// Component normalizers (each returns 0..100 with 50 = neutral)
// ──────────────────────────────────────────────────────────────────────────

function normZFactor(z: number | null): number {
  if (z == null) return 50;
  // Map z in [-3, +3] to [0, 100]. Saturates outside.
  return Math.max(0, Math.min(100, 50 + (z / 3) * 50));
}

function normScs(scs: number | null): number {
  if (scs == null) return 50;
  // Map scs in [-100, +100] to [0, 100].
  return Math.max(0, Math.min(100, 50 + scs / 2));
}

function normFatigue(fatigue: number | null, state: SectorConvictionInputs['fatigueState']): number {
  if (fatigue == null && state == null) return 50;
  // Springboard (fatigue <= -3) is BULLISH — score high.
  // Exhaustion (fatigue >= 3) is BEARISH — score low.
  // Explicit states short-circuit the score.
  if (state === 'springboard') return fatigue != null && fatigue <= -3
    ? Math.min(100, 80 + Math.min(20, Math.abs(fatigue) * 3))
    : 80;
  if (state === 'exhaustion') return fatigue != null && fatigue >= 3
    ? Math.max(0, 20 - Math.min(20, fatigue * 3))
    : 20;
  const f = fatigue ?? 0;
  if (f <= -3) return Math.min(100, 80 + Math.min(20, Math.abs(f) * 3));
  if (f >= 3)  return Math.max(0, 20 - Math.min(20, f * 3));
  // Mid-range: linear in [-3..+3] → [80..20], centered at 50
  return 50 - (f / 3) * 30;
}

function normRotation(rank: number | null, total: number | null): number {
  if (rank == null || total == null || total === 0) return 50;
  if (total === 1) return 100;  // single-sector board — that sector is the leader
  // Rank 1 = leader = 100. Rank total = laggard = 0.
  const norm = 1 - (rank - 1) / (total - 1);
  return Math.max(0, Math.min(100, norm * 100));
}

// ──────────────────────────────────────────────────────────────────────────
// Tier assignment
// ──────────────────────────────────────────────────────────────────────────

function tierFromScore(score: number): SectorTier {
  if (score >= 60) return 'EXTREME_BULL';
  if (score >= 30) return 'STRONG_BULL';
  if (score >= 10) return 'MILD_BULL';
  if (score > -10) return 'NEUTRAL';
  if (score > -30) return 'MILD_BEAR';
  if (score > -60) return 'STRONG_BEAR';
  return 'EXTREME_BEAR';
}

// ──────────────────────────────────────────────────────────────────────────
// Public scoring function (pure)
// ──────────────────────────────────────────────────────────────────────────

export function scoreSector(input: SectorConvictionInputs): SectorConvictionScore {
  const zNorm = normZFactor(input.zFactor);
  const scsNorm = normScs(input.scs);
  const fatNorm = normFatigue(input.fatigueScore, input.fatigueState);
  const rotNorm = normRotation(input.rotationRank, input.rotationTotal);

  // Blend: weighted average of the 4 components, then remap [0..100] → [-100..+100]
  const blend01 = (
    zNorm   * (W_ZFACTOR / 100) +
    scsNorm * (W_SCS / 100) +
    fatNorm * (W_FATIGUE / 100) +
    rotNorm * (W_ROTATION / 100)
  );
  const score = Math.round((blend01 - 50) * 2);  // -100..+100
  const clamped = Math.max(-100, Math.min(100, score));
  const intensity = Math.abs(clamped);

  // Reason (one-line, top 2 signals)
  const parts: string[] = [];
  if (input.zFactor != null) parts.push(`z=${input.zFactor >= 0 ? '+' : ''}${input.zFactor.toFixed(1)}`);
  if (input.rotationRank === 1) parts.push('leader');
  if (input.fatigueScore != null && input.fatigueScore <= -3) parts.push('springboard');
  if (input.fatigueScore != null && input.fatigueScore >= 3) parts.push('exhausted');
  if (input.scs != null && Math.abs(input.scs) >= 25) parts.push(`SCS ${input.scs.toFixed(0)}`);
  const reason = parts.length > 0 ? parts.join(' · ') : 'neutral';

  return {
    sectorName: input.sectorName,
    score: clamped,
    intensity,
    tier: tierFromScore(clamped),
    components: {
      zFactor: Math.round(zNorm),
      scs: Math.round(scsNorm),
      fatigue: Math.round(fatNorm),
      rotation: Math.round(rotNorm),
    },
    reason,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Convenience: rank an array of sectors
// ──────────────────────────────────────────────────────────────────────────

export function rankSectors(scores: SectorConvictionScore[]): SectorConvictionScore[] {
  return [...scores].sort((a, b) => b.intensity - a.intensity || b.score - a.score);
}

// ──────────────────────────────────────────────────────────────────────────
// Convenience: pick the extreme-momentum sector
// ──────────────────────────────────────────────────────────────────────────

export function pickExtremeMomentum(scores: SectorConvictionScore[]): SectorConvictionScore | null {
  const ranked = rankSectors(scores);
  return ranked.length > 0 ? ranked[0] : null;
}
