/**
 * StockTypeClassifier — live TypeScript mirror of algo-engine/screener/stock_types.py.
 *
 * Both read the SAME thresholds from public/config/stock_types_config.json
 * (canonical source: algo-engine/screener/stock_types_config.json).
 * Classifies one stock snapshot into the docs/algo/strategy_brief.md taxonomy:
 *   Cash: TYPE1_ACCUMULATOR / TYPE2_EXHAUSTION_TRAP / TYPE3_PULLBACK_CONTINUE /
 *         TYPE4_FRONT_LOADED / TYPE5_GAP_FREEZE
 *   F&O:  FNO1_HOD_EXHAUSTION_SHORT / FNO2_VWAP_SNAPBACK_SHORT /
 *         FNO3_GAP_EXHAUSTION_SHORT / FNO4_ACCUMULATION_LONG
 */

export interface StockTypeThresholds {
  decision_windows: {
    cash_scan_minutes: [number, number];
    fno_scan_start_minute: number;
    fno_scan_end_minute: number;
  };
  type1_accumulator: ThresholdSet;
  type2_exhaustion_trap: ThresholdSet & { min_gap_pct: number; min_fc15_vol_ratio: number };
  type3_pullback_continue: ThresholdSet & { min_minutes_since_open: number };
  type4_front_loaded: ThresholdSet & { max_minutes_since_open: number; require_volume_spike?: boolean };
  type5_gap_freeze: ThresholdSet;
  fno1_hod_exhaustion_short: ThresholdSet;
  fno2_vwap_snapback_short: ThresholdSet;
  fno3_gap_exhaustion_short: ThresholdSet;
  fno4_accumulation_long: string;
  risk: Record<string, number>;
}

interface ThresholdSet {
  direction: 'LONG' | 'SHORT' | 'NONE';
  priority: number;
  action?: string;
  [key: string]: number | string | boolean | undefined;
}

/** Feature vector consumed by the classifier (mirrors build_screener.py columns). */
export interface StockTypeFeatures {
  minutes_since_open: number;
  gap_pct: number;
  low_vs_open: number;
  day_range_pos: number;
  chg_from_open_pct: number;
  fc_range_pct: number;
  fc15_vol_ratio: number;
  vol_pace_45: number;
  vol_stab_45: number;
  body_open30: number;
  d_atr14: number;
  candle_body_fade: number;
  em_coverage: number;
  freeze_streak: number;
  push_from_open_pct: number;
  low6_vs_open_pct: number;
  pb_vol_ratio: number;
  dist_vwap_pct: number;
  vwap_z: number;
  close: number;
  atr_14: number;
}

export interface StockTypeResult {
  segment: 'cash' | 'fno';
  type_id: string;
  direction: 'LONG' | 'SHORT' | 'NONE';
  priority: number;
  action?: string;
  evidence: Partial<Record<keyof StockTypeFeatures, number>>;
}

export type Segment = 'cash' | 'fno';

type Rule = [keyof StockTypeFeatures, string, 'ge' | 'le'];

/** Declarative rule sets — must stay identical to _RULES in stock_types.py. */
const RULES: Record<string, Rule[]> = {
  TYPE1_ACCUMULATOR: [
    ['low_vs_open', 'min_low_vs_open', 'ge'],
    ['day_range_pos', 'max_day_range_pos', 'le'],
    ['chg_from_open_pct', 'min_chg_from_open_pct', 'ge'],
    ['chg_from_open_pct', 'max_chg_from_open_pct', 'le'],
    ['fc_range_pct', 'max_fc_range_pct', 'le'],
    ['vol_pace_45', 'min_vol_pace_45', 'ge'],
    ['vol_pace_45', 'max_vol_pace_45', 'le'],
    ['vol_stab_45', 'max_vol_stab_45', 'le'],
  ],
  TYPE2_EXHAUSTION_TRAP: [
    // Volume leg is the validated trigger (checked separately); the gap leg is
    // evaluated at 5% — a 3% gap measured mildly BULLISH in the 2026-09 edge scan.
  ],
  TYPE3_PULLBACK_CONTINUE: [
    ['push_from_open_pct', 'min_push_from_open_pct', 'ge'],
    ['low6_vs_open_pct', 'min_low6_vs_open_pct', 'ge'],
    ['pb_vol_ratio', 'max_pb_vol_ratio', 'le'],
    ['dist_vwap_pct', 'min_dist_vwap_pct', 'ge'],
    ['day_range_pos', 'max_day_range_pos', 'le'],
  ],
  TYPE4_FRONT_LOADED: [
    ['em_coverage', 'min_em_coverage', 'ge'],
  ],
  TYPE5_GAP_FREEZE: [
    ['gap_pct', 'min_gap_pct', 'ge'],
    ['gap_pct', 'max_gap_pct', 'le'],
    ['freeze_streak', 'min_freeze_streak', 'ge'],
  ],
  FNO1_HOD_EXHAUSTION_SHORT: [
    ['day_range_pos', 'min_day_range_pos', 'ge'],
    ['chg_from_open_pct', 'min_chg_from_open_pct', 'ge'],
    ['candle_body_fade', 'max_candle_body_fade', 'le'],
    ['vol_pace_45', 'max_vol_pace_45', 'le'],
  ],
  FNO2_VWAP_SNAPBACK_SHORT: [
    ['vwap_z', 'min_vwap_z', 'ge'],
    ['day_range_pos', 'min_day_range_pos', 'ge'],
    ['candle_body_fade', 'max_candle_body_fade', 'le'],
  ],
  FNO3_GAP_EXHAUSTION_SHORT: [
    ['gap_pct', 'min_gap_pct', 'ge'],
    ['day_range_pos', 'min_day_range_pos', 'ge'],
  ],
};

const TYPE_TO_CONFIG: Record<string, string> = {
  TYPE1_ACCUMULATOR: 'type1_accumulator',
  TYPE2_EXHAUSTION_TRAP: 'type2_exhaustion_trap',
  TYPE3_PULLBACK_CONTINUE: 'type3_pullback_continue',
  TYPE4_FRONT_LOADED: 'type4_front_loaded',
  TYPE5_GAP_FREEZE: 'type5_gap_freeze',
  FNO1_HOD_EXHAUSTION_SHORT: 'fno1_hod_exhaustion_short',
  FNO2_VWAP_SNAPBACK_SHORT: 'fno2_vwap_snapback_short',
  FNO3_GAP_EXHAUSTION_SHORT: 'fno3_gap_exhaustion_short',
};

let cachedConfig: StockTypeThresholds | null = null;

export async function loadStockTypeConfig(): Promise<StockTypeThresholds> {
  if (cachedConfig) return cachedConfig;
  const res = await fetch('/config/stock_types_config.json');
  if (!res.ok) throw new Error(`stock_types_config fetch failed: ${res.status}`);
  cachedConfig = (await res.json()) as StockTypeThresholds;
  return cachedConfig;
}

/** Test seam — inject thresholds without fetching. */
export function setStockTypeConfig(cfg: StockTypeThresholds): void {
  cachedConfig = cfg;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

function check(
  f: StockTypeFeatures,
  ruleSet: string,
  cfg: StockTypeThresholds,
  cfgKey: string,
): { passed: boolean; evidence: StockTypeResult['evidence'] } {
  const t = (cfg as Record<string, any>)[cfgKey] as ThresholdSet;
  const evidence: StockTypeResult['evidence'] = {};
  for (const [feat, thrKey, op] of RULES[ruleSet] ?? []) {
    const v = num(f[feat]);
    const thr = t[thrKey] as number;
    evidence[feat] = v ?? undefined;
    if (v === null) return { passed: false, evidence };
    if (op === 'ge' && !(v >= thr)) return { passed: false, evidence };
    if (op === 'le' && !(v <= thr)) return { passed: false, evidence };
  }
  return { passed: true, evidence };
}

function type1BodyOk(f: StockTypeFeatures, cfg: StockTypeThresholds): boolean {
  const max = cfg.type1_accumulator.max_body_open30_to_atr as number;
  const body = num(f.body_open30);
  const atr = num(f.d_atr14);
  if (body === null || atr === null || atr <= 0) return false;
  return body / atr <= max;
}

const none = (segment: Segment, evidence: StockTypeResult['evidence'] = {}): StockTypeResult => ({
  segment, type_id: 'NONE', direction: 'NONE', priority: 9, evidence,
});

export function classifyCash(f: StockTypeFeatures, cfg: StockTypeThresholds): StockTypeResult {
  const t1 = cfg.type1_accumulator;
  const t2 = cfg.type2_exhaustion_trap;
  const t3 = cfg.type3_pullback_continue;
  const t4 = cfg.type4_front_loaded;
  const t5 = cfg.type5_gap_freeze;
  const mins = num(f.minutes_since_open);
  const gap = num(f.gap_pct);

  // blockers first — a blocked stock can never be a long candidate.
  // Evidence 2026-09: em_coverage alone has no edge, so Type 4 also needs the
  // validated volume spike; Type 2 keys on volume (gap leg now 5%).
  const volSpike = (num(f.fc15_vol_ratio) ?? 0) >= t2.min_fc15_vol_ratio;
  const c4 = check(f, 'TYPE4_FRONT_LOADED', cfg, 'type4_front_loaded');
  if (c4.passed && mins !== null && mins <= t4.max_minutes_since_open
      && (volSpike || !t4.require_volume_spike)) {
    return { segment: 'cash', type_id: 'TYPE4_FRONT_LOADED', direction: t4.direction as StockTypeResult['direction'], priority: t4.priority, action: t4.action, evidence: c4.evidence };
  }
  if (volSpike || (gap !== null && gap > t2.min_gap_pct)) {
    const ev = { ...c4.evidence, fc15_vol_ratio: num(f.fc15_vol_ratio) ?? undefined, gap_pct: gap ?? undefined };
    return { segment: 'cash', type_id: 'TYPE2_EXHAUSTION_TRAP', direction: t2.direction as StockTypeResult['direction'], priority: t2.priority, action: t2.action, evidence: ev };
  }

  const [wLo, wHi] = cfg.decision_windows.cash_scan_minutes;
  if (mins === null || mins < wLo || mins > wHi) {
    return none('cash');
  }

  const c1 = check(f, 'TYPE1_ACCUMULATOR', cfg, 'type1_accumulator');
  if (c1.passed && type1BodyOk(f, cfg)) {
    return { segment: 'cash', type_id: 'TYPE1_ACCUMULATOR', direction: t1.direction as StockTypeResult['direction'], priority: t1.priority, evidence: c1.evidence };
  }
  const c3 = check(f, 'TYPE3_PULLBACK_CONTINUE', cfg, 'type3_pullback_continue');
  if (c3.passed && mins >= t3.min_minutes_since_open) {
    return { segment: 'cash', type_id: 'TYPE3_PULLBACK_CONTINUE', direction: t3.direction as StockTypeResult['direction'], priority: t3.priority, evidence: c3.evidence };
  }
  const c5 = check(f, 'TYPE5_GAP_FREEZE', cfg, 'type5_gap_freeze');
  if (c5.passed) {
    return { segment: 'cash', type_id: 'TYPE5_GAP_FREEZE', direction: t5.direction as StockTypeResult['direction'], priority: t5.priority, action: t5.action, evidence: c5.evidence };
  }
  return none('cash');
}

export function classifyFno(f: StockTypeFeatures, cfg: StockTypeThresholds): StockTypeResult {
  const { fno_scan_start_minute: start, fno_scan_end_minute: end } = cfg.decision_windows;
  const mins = num(f.minutes_since_open);
  if (mins === null || mins < start || mins > end) return none('fno');

  const r1 = check(f, 'FNO1_HOD_EXHAUSTION_SHORT', cfg, 'fno1_hod_exhaustion_short');
  if (r1.passed) return { segment: 'fno', type_id: 'FNO1_HOD_EXHAUSTION_SHORT', direction: 'SHORT', priority: cfg.fno1_hod_exhaustion_short.priority, evidence: r1.evidence };
  const r2 = check(f, 'FNO2_VWAP_SNAPBACK_SHORT', cfg, 'fno2_vwap_snapback_short');
  if (r2.passed) return { segment: 'fno', type_id: 'FNO2_VWAP_SNAPBACK_SHORT', direction: 'SHORT', priority: cfg.fno2_vwap_snapback_short.priority, evidence: r2.evidence };
  const r3 = check(f, 'FNO3_GAP_EXHAUSTION_SHORT', cfg, 'fno3_gap_exhaustion_short');
  if (r3.passed) return { segment: 'fno', type_id: 'FNO3_GAP_EXHAUSTION_SHORT', direction: 'SHORT', priority: cfg.fno3_gap_exhaustion_short.priority, evidence: r3.evidence };
  // F&O Type 4 = cash accumulator rules on the F&O universe
  const r4 = check(f, 'TYPE1_ACCUMULATOR', cfg, 'type1_accumulator');
  if (r4.passed && type1BodyOk(f, cfg)) {
    return { segment: 'fno', type_id: 'FNO4_ACCUMULATION_LONG', direction: 'LONG', priority: cfg.type1_accumulator.priority, evidence: r4.evidence };
  }
  return none('fno');
}

export function classifyStockType(f: StockTypeFeatures, segment: Segment, cfg: StockTypeThresholds): StockTypeResult {
  return segment === 'fno' ? classifyFno(f, cfg) : classifyCash(f, cfg);
}

/** Human label for UI badges. */
export const TYPE_LABELS: Record<string, string> = {
  TYPE1_ACCUMULATOR: '🟢 Accumulator',
  TYPE2_EXHAUSTION_TRAP: '🔴 Exhaustion Trap',
  TYPE3_PULLBACK_CONTINUE: '🟠 Pullback-Continue',
  TYPE4_FRONT_LOADED: '⛔ Front-Loaded',
  TYPE5_GAP_FREEZE: '🟡 Gap-Freeze',
  FNO1_HOD_EXHAUSTION_SHORT: '📉 HOD Exhaustion',
  FNO2_VWAP_SNAPBACK_SHORT: '📉 VWAP Snapback',
  FNO3_GAP_EXHAUSTION_SHORT: '📉 Gap Exhaustion',
  FNO4_ACCUMULATION_LONG: '📈 F&O Accumulation',
  NONE: '—',
};
