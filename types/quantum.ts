/**
 * Quantum Phase 12 — Shared types.
 *
 * The "Quantum" surface in Wealth Dashboard V2 is a unified, version 10
 * generational deck that exposes:
 *   - Cross-asset correlation, beta, scenario stress (QuantumConfluenceDeck)
 *   - Voice + text command plane with NLP dispatch (JarvisVoiceConsole)
 *   - Multi-leg strategy parameter sweep + Sharpe surface (StrategyOptimizer)
 *   - Gamified RPG skill tree & XP engine (WealthQuestMatrix)
 *   - Diagnostics, telemetry, OCR verify, slide-to-confirm (ResilienceCore)
 *
 * These types are the contract between the components and the shared
 * Zustand store (store/quantumStore.ts) so that selecting an asset in
 * one component (e.g. QuantumConfluenceDeck) instantly rebroadcasts to
 * the others (e.g. StrategyOptimizer fills in strikes for the same
 * underlying; Jarvis 4.0 surfaces the active context; ResilienceCore
 * shows the live ticks for that symbol).
 */

import type { Investment } from '../types';

// =====================================================================
// ASSET UNIVERSE
// =====================================================================

export type QuantumAssetClass =
    | 'EQUITY'
    | 'INDEX_FUT'
    | 'INDEX_OPT'
    | 'STOCK_OPT'
    | 'COMMODITY'
    | 'CURRENCY'
    | 'CRYPTO'
    | 'DEBT'
    | 'GOLD';

export interface QuantumAsset {
    symbol: string;
    name: string;
    assetClass: QuantumAssetClass;
    /** ₹ — current LTP or last close. */
    price: number;
    /** Daily change as decimal (0.0125 = +1.25%). */
    changePct: number;
    /** Annualised volatility decimal (0.18 = 18%). */
    volatility: number;
    /** Beta vs NIFTY 50 (1.0 = market). */
    beta: number;
    /** Position size in ₹ for portfolio holdings (0 for non-portfolio). */
    exposure: number;
    /** Whether the asset is an open options position. */
    isOption?: boolean;
    /** Underlying index for index options. */
    underlying?: string;
    /** Strike (for options). */
    strike?: number;
    /** CE / PE. */
    optionType?: 'CE' | 'PE';
    /** Days to expiry. */
    dte?: number;
}

// =====================================================================
// CORRELATION & RISK
// =====================================================================

export interface CorrelationCell {
    rowSymbol: string;
    colSymbol: string;
    /** Pearson correlation [-1, 1]. */
    value: number;
}

export interface CrossAssetRisk {
    asOf: number;
    assets: QuantumAsset[];
    /** Square correlation matrix. Row/column order matches `assets`. */
    matrix: number[][];
    /** Portfolio beta vs NIFTY 50. */
    portfolioBeta: number;
    /** Beta-weighted delta equivalent (in points of NIFTY). */
    portfolioDeltaWeighted: number;
    /** Total ₹ VaR at 95% (1-day, parametric). */
    var95: number;
    /** Total ₹ CVaR (expected shortfall). */
    cvar95: number;
}

// =====================================================================
// SCENARIO STRESS
// =====================================================================

export type ScenarioAxis = 'NIFTY' | 'VIX' | 'RATES' | 'USDINR' | 'CRUDE';

export interface ScenarioShock {
    axis: ScenarioAxis;
    /** Decimal shock. +0.05 = +5% NIFTY, +0.20 = +20% VIX. */
    value: number;
}

export interface ScenarioImpact {
    axis: ScenarioAxis;
    label: string;
    shockPct: number;
    /** Total P&L impact in ₹ across the user's universe. */
    pnlImpact: number;
    /** Per-asset contribution, in ₹. */
    perAsset: Record<string, number>;
}

// =====================================================================
// STRATEGY OPTIMIZER
// =====================================================================

export type StrategyKind =
    | 'LONG_CALL'
    | 'LONG_PUT'
    | 'SHORT_CALL'
    | 'SHORT_PUT'
    | 'BULL_CALL_SPREAD'
    | 'BEAR_PUT_SPREAD'
    | 'STRADDLE'
    | 'STRANGLE'
    | 'IRON_CONDOR'
    | 'BUTTERFLY'
    | 'CALENDAR'
    | 'RATIO_SPREAD';

export interface StrategyLeg {
    kind: 'CE' | 'PE' | 'FUT';
    side: 'BUY' | 'SELL';
    strike: number;
    /** Premium paid/received per share. */
    premium: number;
    /** Days to expiry. */
    dte: number;
    /** Lot size (NIFTY=25, BANKNIFTY=15, etc). */
    lotSize: number;
    quantity: number;
}

export interface OptimizerRequest {
    underlying: string;
    spot: number;
    strategy: StrategyKind;
    /** Strike range to sweep (₹). Defaults to ±10% of spot. */
    strikeRangePct?: number;
    /** Days-to-expiry grid to sweep. */
    dteGrid?: number[];
    /** Annualised vol for pricing. */
    iv?: number;
    /** Risk-free rate decimal. */
    rate?: number;
    /** Trades assumed per setup. */
    trials?: number;
    /** Days to hold to compute theta decay in the metric. */
    holdDays?: number;
}

export interface OptimizerRow {
    strike: number;
    dte: number;
    /** Net debit (positive) or credit (negative). */
    netPremium: number;
    /** Theoretical win rate from a GBM Monte Carlo with 1k paths. */
    winRate: number;
    /** Average winning trade ₹. */
    avgWin: number;
    /** Average losing trade ₹. */
    avgLoss: number;
    /** Expectancy per trade ₹. */
    expectancy: number;
    /** Profit factor = sum(wins)/|sum(losses)|. */
    profitFactor: number;
    /** Max drawdown in ₹ for the strategy. */
    maxDrawdown: number;
    /** Sharpe-like score (avg / std) over 1k paths. */
    sharpe: number;
    /** Recovery factor = totalPnL / maxDD. */
    recovery: number;
    /** A composite ranking [0..100]. */
    score: number;
}

export interface OptimizerResult {
    request: OptimizerRequest;
    rows: OptimizerRow[];
    best: OptimizerRow | null;
    /** Avg time per row in ms. */
    durationMs: number;
}

// =====================================================================
// QUEST MATRIX
// =====================================================================

export type QuestBranchId = 'QUANT' | 'SENTINEL' | 'SCRIBE';

export type QuestState = 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED';

export interface QuestNode {
    id: string;
    branch: QuestBranchId;
    title: string;
    description: string;
    level: number;
    prereqIds: string[];
    xpReward: number;
    /** 0..1 — live progress (computed from real metrics). */
    progress: number;
    state: QuestState;
    /** Human-friendly metric label (e.g. "Win 5 trades in a row"). */
    questHint: string;
    icon: string;
    accentColor: string;
}

export interface QuestBranch {
    id: QuestBranchId;
    name: string;
    description: string;
    color: string;
    nodes: QuestNode[];
}

export interface QuestMatrix {
    branches: QuestBranch[];
    totalXp: number;
    level: number;
    levelName: string;
    /** XP needed to reach the next level. */
    nextLevelXp: number;
    /** 0..1 — progress to the next level. */
    levelProgress: number;
    /** Recent unlocks (max 5). */
    recentUnlocks: { nodeId: string; at: number }[];
}

// =====================================================================
// RESILIENCE / TELEMETRY
// =====================================================================

export type SourceHealth = 'GREEN' | 'YELLOW' | 'RED' | 'OFFLINE';

export interface TelemetrySource {
    id: string;
    name: string;
    kind: 'WS' | 'HTTP' | 'OCR' | 'BRIDGE' | 'SCRAPER';
    health: SourceHealth;
    /** Last successful message timestamp. */
    lastBeat: number | null;
    /** ms round-trip time. */
    latencyMs: number | null;
    /** 0..1 quota use in the current window. */
    quotaUsed: number | null;
    /** Free-text status / error. */
    note?: string;
}

export interface ConfluenceSignal {
    id: string;
    receivedAt: number;
    source: 'OCR' | 'TELEGRAM' | 'BRIDGE' | 'ALPHA' | 'MANUAL';
    raw: string;
    ticker: string;
    side: 'BUY' | 'SELL';
    strike?: number;
    optionType?: 'CE' | 'PE';
    limit?: number;
    quantity: number;
    expiry?: string;
    confidence: number;        // 0..1
    /** Has the underlying been verified against the active chain. */
    chainVerified: boolean;
    /** True if limit is within today's intraday range. */
    rangeVerified: boolean;
    /** True if quantity matches lot-size rules. */
    lotVerified: boolean;
    status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'SENT' | 'FAILED';
    /** Optional rejection reason. */
    rejection?: string;
    /** Source OCR bounding boxes, for the verify overlay. */
    ocrBoxes?: Array<{ text: string; bbox: { x: number; y: number; w: number; h: number }; confidence: number }>;
    /** Original image (data URL or blob URL) for OCR verify. */
    imageUrl?: string;
}

// =====================================================================
// PROFITABILITY SCORE (the "anyone can win" cross-cutting KPI)
// =====================================================================

/**
 * A 0..100 number that tells the user "if you keep doing what you
 * did this week, here is your expected edge." Computed from the
 * guardrail store + trade history + journal streaks.
 */
export interface ProfitabilityScore {
    score: number;             // 0..100
    tier: 'NOVICE' | 'APPRENTICE' | 'OPERATOR' | 'STRATEGIST' | 'MASTER';
    /** 5 component subscores, each 0..100. */
    components: {
        process: number;       // 4-Point Gate compliance, journaling, square-off
        risk: number;          // Avg risk/trade, max DD, stop-loss discipline
        edge: number;          // Win rate × R-multiple, expectancy
        behavior: number;      // Streak health, sleep proxy, no-revenge rate
        learning: number;      // Backtests run, lessons, papers reviewed
    };
    /** A single-line coaching cue ("Set SL on every trade", etc.). */
    coach: string;
    /** Estimated 21-day expectancy at current trajectory, in ₹. */
    projected21dPnl: number;
    /** Confidence in the score (0..1) — low if too few trades. */
    confidence: number;
    /** Driver (the lowest component) — what to fix first. */
    primaryDriver: keyof ProfitabilityScore['components'];
}

// =====================================================================
// SHARED QUANTUM STATE
// =====================================================================

export interface QuantumState {
    /** Which symbol the user is currently focused on across the deck. */
    activeSymbol: string | null;
    /** Selected scenario axis (QuantumConfluenceDeck). */
    activeAxis: ScenarioAxis;
    /** Scenario shock for that axis (decimal). */
    activeShock: number;
    /** Strategy being optimised (StrategyOptimizer). */
    activeStrategy: StrategyKind;
    /** Underlying for the optimizer. */
    optimizerUnderlying: string;
    /** Quest branch focused. */
    focusedBranch: QuestBranchId;
    /** Last signal id the ResilienceCore should highlight. */
    focusedSignalId: string | null;
    /** Last 200 closed trades for cross-component math. */
    closedTrades: import('../database').Trade[];
    /** Computed ProfitabilityScore. */
    profitability: ProfitabilityScore | null;
    /** Computed CrossAssetRisk. */
    risk: CrossAssetRisk | null;
    /** Computed QuestMatrix. */
    questMatrix: QuestMatrix | null;
    /** Computed OptimizerResult. */
    optimizerResult: OptimizerResult | null;
    /** Telemetry sources. */
    telemetry: TelemetrySource[];
    /** Confluence signals ledger. */
    signals: ConfluenceSignal[];
    /** All available assets the user holds or watches. */
    assets: QuantumAsset[];

    // ---- Actions
    setActiveSymbol: (symbol: string | null) => void;
    setActiveAxis: (axis: ScenarioAxis) => void;
    setActiveShock: (shock: number) => void;
    setActiveStrategy: (strategy: StrategyKind) => void;
    setOptimizerUnderlying: (symbol: string) => void;
    setFocusedBranch: (branch: QuestBranchId) => void;
    setFocusedSignalId: (id: string | null) => void;
    setClosedTrades: (trades: import('../database').Trade[]) => void;
    setProfitability: (p: ProfitabilityScore) => void;
    setRisk: (r: CrossAssetRisk) => void;
    setQuestMatrix: (q: QuestMatrix) => void;
    setOptimizerResult: (r: OptimizerResult) => void;
    setTelemetry: (t: TelemetrySource[]) => void;
    setSignals: (s: ConfluenceSignal[]) => void;
    upsertSignal: (s: ConfluenceSignal) => void;
    setAssets: (assets: QuantumAsset[]) => void;
}

/** A safe default `QuantumAsset` row from an Investment. */
export function investmentToAsset(inv: Investment): QuantumAsset {
    return {
        symbol: inv.ticker || inv.name,
        name: inv.name,
        assetClass: inv.type === 'Stocks' ? 'EQUITY' : (inv.type === 'Crypto' ? 'CRYPTO' : 'EQUITY'),
        price: inv.quantity && inv.quantity > 0 ? inv.currentValue / inv.quantity : inv.currentValue,
        changePct: 0,
        volatility: 0.20,
        beta: 1.0,
        exposure: inv.currentValue,
    };
}
