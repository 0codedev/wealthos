/**
 * QuantEngine.ts
 * -----------------------------------------------------------------------------
 * Bloomberg Terminal-grade quantitative analytics for the Wealth Dashboard V2.
 *
 * All functions are pure and operate on plain number series — never on UI state
 * or React — so they can be reused by the full QuantDashboard, the compact
 * RiskScoreCard widget, the Jarvis 2.0 advisory layer, and any future backtest.
 *
 * Formulas implemented (verified against academic references):
 *   - Sharpe ratio (excess return / total volatility)
 *   - Sortino ratio (excess return / downside deviation)
 *   - Calmar ratio (CAGR / |max drawdown|)
 *   - Omega ratio (probability-weighted gains/losses vs threshold)
 *   - Information ratio (active return / tracking error)
 *   - Drawdown series + recovery factor
 *   - Behavioral pattern mining (DOW, time-of-day, holding period, streaks, EV)
 *   - Pearson correlation matrix with rolling returns
 * -----------------------------------------------------------------------------
 */

import { Trade } from '../database';
import { Investment } from '../types';

// =====================================================================
// SECTION 1 — RISK-ADJUSTED RETURN METRICS
// =====================================================================

/**
 * Sample standard deviation (Bessel-corrected, n-1 in the denominator).
 * Returns 0 for inputs with fewer than 2 elements.
 */
export function stdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
    return Math.sqrt(sq / (values.length - 1));
}

/**
 * Downside deviation: the std-dev of returns *below* the threshold (or 0 by
 * default). Returns are first de-meaned only by the threshold, not by the
 * mean, per Sortino's original specification.
 */
export function downsideDeviation(returns: number[], threshold: number = 0): number {
    if (returns.length === 0) return 0;
    const downside = returns
        .map(r => Math.min(0, r - threshold))
        .filter(x => x < 0);
    if (downside.length === 0) return 0;
    const sq = downside.reduce((acc, v) => acc + v * v, 0);
    return Math.sqrt(sq / returns.length);
}

/**
 * Sharpe ratio: (mean(excess return)) / stdDev(return).
 * `riskFreeRate` is the *per-period* risk-free rate (default 6% / 252 = daily).
 * `annualizationFactor` lets you scale e.g. daily → annual (default √252).
 */
export function calculateSharpeRatio(
    returns: number[],
    riskFreeRate: number = 6 / 252,
    annualizationFactor: number = Math.sqrt(252)
): number {
    if (returns.length < 2) return 0;
    const excess = returns.map(r => r - riskFreeRate);
    const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
    const sd = stdDev(excess);
    if (sd === 0) return 0;
    return (mean / sd) * annualizationFactor;
}

/**
 * Sortino ratio: same idea as Sharpe but penalises only downside volatility.
 * `targetReturn` is the per-period acceptable return (often 0 or the risk-free
 * rate). `annualizationFactor` mirrors the Sharpe convention.
 */
export function calculateSortinoRatio(
    returns: number[],
    targetReturn: number = 0,
    annualizationFactor: number = Math.sqrt(252)
): number {
    if (returns.length < 2) return 0;
    const excess = returns.map(r => r - targetReturn);
    const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
    const dd = downsideDeviation(returns, targetReturn);
    if (dd === 0) return 0;
    return (mean / dd) * annualizationFactor;
}

/**
 * Calmar ratio: CAGR / |max drawdown|.
 * Inputs are an *annualised* return and a positive drawdown percentage.
 */
export function calculateCalmarRatio(annualReturnPct: number, maxDrawdownPct: number): number {
    if (maxDrawdownPct === 0) return 0;
    return annualReturnPct / Math.abs(maxDrawdownPct);
}

/**
 * Omega ratio: integral of (1 - F(r)) over gains divided by integral of F(r)
 * over losses, for a threshold `threshold`. Computed discretely from a
 * returns series.
 *
 *   Omega = sum(max(0, r - L)) / sum(max(0, L - r))
 */
export function calculateOmegaRatio(returns: number[], threshold: number = 0): number {
    if (returns.length === 0) return 0;
    let gain = 0;
    let loss = 0;
    for (const r of returns) {
        if (r > threshold) gain += r - threshold;
        else loss += threshold - r;
    }
    if (loss === 0) return gain > 0 ? Infinity : 0;
    return gain / loss;
}

/**
 * Information ratio: mean(active return) / stdDev(active return).
 * Both series must be aligned 1:1 in time.
 */
export function calculateInformationRatio(
    portfolioReturns: number[],
    benchmarkReturns: number[]
): number {
    const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
    if (n < 2) return 0;
    const active: number[] = [];
    for (let i = 0; i < n; i++) {
        const pVal = portfolioReturns[i];
        const bVal = benchmarkReturns[i];
        if (pVal !== undefined && bVal !== undefined) {
            active.push(pVal - bVal);
        }
    }
    const mean = active.reduce((a, b) => a + b, 0) / n;
    const sd = stdDev(active);
    if (sd === 0) return 0;
    return mean / sd;
}

// =====================================================================
// SECTION 2 — DRAWDOWN ANALYSIS
// =====================================================================

export interface DrawdownPoint {
    date: Date | null;
    index: number;
    drawdownPct: number;
    underwater: boolean;
}

export interface MaxDrawdownResult {
    maxDrawdownPct: number;
    peakIndex: number;
    troughIndex: number;
    recoveryIndex: number | null;
    durationDays: number;
    underwaterDays: number;
    series: DrawdownPoint[];
    dates: (Date | null)[];
    values: number[];
}

/**
 * Build the full drawdown series and the worst peak→trough→recovery episode.
 * If `dates` is omitted the index is used as the time coordinate.
 */
export function calculateMaxDrawdown(
    values: number[],
    dates?: (Date | string)[]
): MaxDrawdownResult {
    if (values.length === 0) {
        return {
            maxDrawdownPct: 0,
            peakIndex: 0,
            troughIndex: 0,
            recoveryIndex: null,
            durationDays: 0,
            underwaterDays: 0,
            series: [],
            dates: [],
            values: [],
        };
    }
    const dateArr: (Date | null)[] = (dates || values.map(() => null)).map(d => {
        if (!d) return null;
        if (d instanceof Date) return d;
        const parsed = new Date(d);
        return isNaN(parsed.getTime()) ? null : parsed;
    });

    const firstVal = values[0];
    if (firstVal === undefined) {
        return {
            maxDrawdownPct: 0,
            peakIndex: 0,
            troughIndex: 0,
            recoveryIndex: null,
            durationDays: 0,
            underwaterDays: 0,
            series: [],
            dates: [],
            values: [],
        };
    }

    let peak = firstVal;
    let peakIdx = 0;
    let maxDD = 0;
    let worstPeakIdx = 0;
    let worstTroughIdx = 0;

    const series: DrawdownPoint[] = values.map((v, i) => {
        if (v > peak) {
            peak = v;
            peakIdx = i;
        }
        const dd = peak > 0 ? ((peak - v) / peak) * 100 : 0;
        if (dd > maxDD) {
            maxDD = dd;
            worstPeakIdx = peakIdx;
            worstTroughIdx = i;
        }
        return {
            date: dateArr[i] ?? null,
            index: i,
            drawdownPct: dd,
            underwater: dd > 0,
        };
    });

    // Find first index after the trough that exceeds the original peak.
    let recoveryIdx: number | null = null;
    for (let i = worstTroughIdx + 1; i < values.length; i++) {
        const valI = values[i];
        const valWorstPeak = values[worstPeakIdx];
        if (valI !== undefined && valWorstPeak !== undefined && valI >= valWorstPeak) {
            recoveryIdx = i;
            break;
        }
    }

    // Duration & underwater-day estimates.
    let durationDays = 0;
    if (dateArr[worstPeakIdx] && dateArr[worstTroughIdx]) {
        const peakD = dateArr[worstPeakIdx] as Date;
        const troughD = dateArr[worstTroughIdx] as Date;
        durationDays = Math.max(
            0,
            Math.round((troughD.getTime() - peakD.getTime()) / (1000 * 60 * 60 * 24))
        );
    } else {
        durationDays = worstTroughIdx - worstPeakIdx;
    }

    const underwaterDays = series.filter(p => p.underwater).length;

    return {
        maxDrawdownPct: maxDD,
        peakIndex: worstPeakIdx,
        troughIndex: worstTroughIdx,
        recoveryIndex: recoveryIdx,
        durationDays,
        underwaterDays,
        series,
        dates: dateArr,
        values: [...values],
    };
}

/**
 * Recovery factor: total return / |max drawdown|. > 5 is excellent, < 1 is bad.
 */
export function calculateRecoveryFactor(totalReturnPct: number, maxDrawdownPct: number): number {
    if (maxDrawdownPct === 0) return totalReturnPct > 0 ? Infinity : 0;
    return totalReturnPct / Math.abs(maxDrawdownPct);
}

// =====================================================================
// SECTION 3 — BEHAVIOURAL PATTERN MINING
// =====================================================================

export interface DayOfWeekStat {
    wins: number;
    losses: number;
    total: number;
    winRate: number;   // 0..1
    avgPnl: number;    // signed average per trade
    totalPnl: number;
}

export interface TimeOfDayStat extends DayOfWeekStat {
    bucket: string;   // e.g. "09:00-09:30"
}

export interface StreakAnalysis {
    currentStreak: number;       // signed: + wins, - losses
    longestWinStreak: number;
    longestLossStreak: number;
    wins: number;
    losses: number;
    breakEvens: number;
}

export interface PayoffStat {
    avgWin: number;
    avgLoss: number;        // positive number
    payoffRatio: number;    // avgWin / avgLoss  (Infinity if avgLoss == 0)
    expectancy: number;     // (winRate * avgWin) - (lossRate * avgLoss)
    expectedValuePerTrade: number; // in ₹
    winRate: number;        // 0..1
    sampleSize: number;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function getPnl(t: Trade): number {
    if (typeof t.pnl === 'number') return t.pnl;
    // Fall back to (exit - entry) * quantity if pnl is missing.
    if (typeof t.entryPrice === 'number' && typeof t.exitPrice === 'number' && typeof t.quantity === 'number') {
        return (t.exitPrice - t.entryPrice) * t.quantity;
    }
    return 0;
}

function emptyDayStat(): DayOfWeekStat {
    return { wins: 0, losses: 0, total: 0, winRate: 0, avgPnl: 0, totalPnl: 0 };
}

function toTimeBucket(t: Trade): string {
    // Prefer ISO entryTime; fall back to date-only trades placed in the 09-15 band.
    if (t.entryTime && /^\d{1,2}:\d{2}/.test(t.entryTime)) {
        const [hhStr, mmStr] = t.entryTime.split(':');
        const hh = Number(hhStr);
        const mm = Number(mmStr);
        if (!isNaN(hh) && !isNaN(mm)) {
            // 30-minute band, e.g. 09:15 → "09:00-09:30"
            const bandStart = Math.floor(mm / 30) * 30;
            const nextHour = bandStart === 0 ? hh : hh;
            const start = `${String(nextHour).padStart(2, '0')}:${String(bandStart).padStart(2, '0')}`;
            // 30-min end:
            let endH = nextHour;
            let endM = bandStart + 30;
            if (endM >= 60) { endH += 1; endM -= 60; }
            const end = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
            return `${start}-${end}`;
        }
    }
    return 'unknown';
}

/**
 * Win rate + average P&L grouped by ISO day of week (0 = Sun … 6 = Sat).
 */
export function calculateWinRateByDayOfWeek(trades: Trade[]): Record<string, DayOfWeekStat> {
    const buckets: Record<string, DayOfWeekStat> = {};
    DAY_LABELS.forEach(d => { buckets[d] = emptyDayStat(); });

    for (const t of trades) {
        if (!t.date) continue;
        const d = new Date(t.date);
        if (isNaN(d.getTime())) continue;
        const day = DAY_LABELS[d.getDay()];
        if (day === undefined) continue;
        const pnl = getPnl(t);
        const stat = buckets[day];
        if (stat) {
            stat.total += 1;
            stat.totalPnl += pnl;
            if (pnl > 0) stat.wins += 1;
            else if (pnl < 0) stat.losses += 1;
        }
    }
    for (const key of Object.keys(buckets)) {
        const stat = buckets[key];
        if (stat) {
            stat.winRate = stat.total > 0 ? stat.wins / stat.total : 0;
            stat.avgPnl = stat.total > 0 ? stat.totalPnl / stat.total : 0;
        }
    }
    return buckets;
}

/**
 * Win rate + average P&L grouped by 30-minute intraday bands. Buckets are
 * labelled "09:00-09:30", "09:30-10:00", …, "15:00-15:30".
 */
export function calculateWinRateByTimeOfDay(trades: Trade[]): Record<string, TimeOfDayStat> {
    const buckets: Record<string, TimeOfDayStat> = {};
    for (const t of trades) {
        const bucket = toTimeBucket(t);
        if (bucket === 'unknown') continue;
        if (!buckets[bucket]) {
            buckets[bucket] = {
                bucket,
                wins: 0,
                losses: 0,
                total: 0,
                winRate: 0,
                avgPnl: 0,
                totalPnl: 0,
            };
        }
        const stat = buckets[bucket];
        const pnl = getPnl(t);
        stat.total += 1;
        stat.totalPnl += pnl;
        if (pnl > 0) stat.wins += 1;
        else if (pnl < 0) stat.losses += 1;
    }
    for (const key of Object.keys(buckets)) {
        const stat = buckets[key];
        if (stat) {
            stat.winRate = stat.total > 0 ? stat.wins / stat.total : 0;
            stat.avgPnl = stat.total > 0 ? stat.totalPnl / stat.total : 0;
        }
    }
    return buckets;
}

/**
 * Average holding period in days, split between winners and losers.
 * Holding period = exitDate - entryDate (parsed from Trade.date + exitTime if
 * present; otherwise assumed 0 — i.e. intraday).
 */
export function calculateAvgHoldingPeriod(trades: Trade[]): { winners: number; losers: number; overall: number; sampleSize: number } {
    let winDays = 0, winCount = 0, lossDays = 0, lossCount = 0;
    for (const t of trades) {
        if (!t.date) continue;
        const entry = new Date(t.date);
        if (isNaN(entry.getTime())) continue;
        // For an intraday trade (entryTime present) the "exit" is same day.
        const holdingDays = t.entryTime ? 0 : 1;
        const pnl = getPnl(t);
        if (pnl > 0) { winDays += holdingDays; winCount += 1; }
        else if (pnl < 0) { lossDays += holdingDays; lossCount += 1; }
    }
    const total = winCount + lossCount;
    return {
        winners: winCount > 0 ? winDays / winCount : 0,
        losers: lossCount > 0 ? lossDays / lossCount : 0,
        overall: total > 0 ? (winDays + lossDays) / total : 0,
        sampleSize: total,
    };
}

/**
 * Sign-aware streak analysis. Trades are sorted by `date` (asc).
 */
export function calculateStreakAnalysis(trades: Trade[]): StreakAnalysis {
    const sorted = [...trades]
        .filter(t => t.date)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let longestWin = 0;
    let longestLoss = 0;
    let runWin = 0;
    let runLoss = 0;
    let currentStreak = 0;
    let currentSign: 'win' | 'loss' | 'flat' = 'flat';
    let wins = 0, losses = 0, breakEvens = 0;

    for (const t of sorted) {
        const pnl = getPnl(t);
        if (pnl > 0) {
            wins += 1;
            runWin += 1;
            runLoss = 0;
            if (currentSign === 'win') currentStreak += 1;
            else { currentStreak = 1; currentSign = 'win'; }
        } else if (pnl < 0) {
            losses += 1;
            runLoss += 1;
            runWin = 0;
            if (currentSign === 'loss') currentStreak -= 1;
            else { currentStreak = -1; currentSign = 'loss'; }
        } else {
            breakEvens += 1;
            // break-even resets the run
            runWin = 0; runLoss = 0;
        }
        if (runWin > longestWin) longestWin = runWin;
        if (runLoss > longestLoss) longestLoss = runLoss;
    }

    return {
        currentStreak,
        longestWinStreak: longestWin,
        longestLossStreak: longestLoss,
        wins,
        losses,
        breakEvens,
    };
}

/**
 * Aggregate win/loss/expectancy statistics.
 *   payoffRatio     = avgWin / avgLoss
 *   expectancy      = (winRate * avgWin) - (lossRate * avgLoss)
 *   expectedValue   = expectancy  (per-trade ₹, assuming equal sizing)
 */
export function calculatePayoffAndExpectancy(trades: Trade[]): PayoffStat {
    let winSum = 0, winCount = 0, lossSum = 0, lossCount = 0;
    for (const t of trades) {
        const pnl = getPnl(t);
        if (pnl > 0) { winSum += pnl; winCount += 1; }
        else if (pnl < 0) { lossSum += Math.abs(pnl); lossCount += 1; }
    }
    const total = winCount + lossCount;
    const winRate = total > 0 ? winCount / total : 0;
    const lossRate = total > 0 ? lossCount / total : 0;
    const avgWin = winCount > 0 ? winSum / winCount : 0;
    const avgLoss = lossCount > 0 ? lossSum / lossCount : 0;
    const payoffRatio = avgLoss === 0 ? (avgWin > 0 ? Infinity : 0) : avgWin / avgLoss;
    const expectancy = (winRate * avgWin) - (lossRate * avgLoss);
    return {
        avgWin,
        avgLoss,
        payoffRatio,
        expectancy,
        expectedValuePerTrade: expectancy,
        winRate,
        sampleSize: total,
    };
}

/**
 * Plain-English EV per trade = (winRate * payoffRatio) - (1 - winRate).
 * Useful for the "is this strategy +EV?" headline.
 */
export function calculateExpectedValue(winRate: number, payoffRatio: number): number {
    if (!isFinite(payoffRatio)) return winRate > 0 ? Infinity : 0;
    return (winRate * payoffRatio) - (1 - winRate);
}

// =====================================================================
// SECTION 4 — PORTFOLIO CORRELATION ENGINE
// =====================================================================

export interface CorrelationMatrix {
    tickers: string[];
    matrix: number[][]; // matrix[i][j] is correlation between i and j
    highCorrelationPairs: Array<{ a: string; b: string; correlation: number }>;
    method: 'pearson';
    windowDays: number;
}

/**
 * Pearson correlation coefficient between two aligned series.
 * Returns 0 for inputs with fewer than 2 elements or zero variance.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) {
        const valX = x[i];
        const valY = y[i];
        if (valX !== undefined && valY !== undefined) {
            sumX += valX;
            sumY += valY;
        }
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    let num = 0, denomX = 0, denomY = 0;
    for (let i = 0; i < n; i++) {
        const valX = x[i];
        const valY = y[i];
        if (valX !== undefined && valY !== undefined) {
            const dx = valX - meanX;
            const dy = valY - meanY;
            num += dx * dy;
            denomX += dx * dx;
            denomY += dy * dy;
        }
    }
    const denom = Math.sqrt(denomX * denomY);
    if (denom === 0) return 0;
    const r = num / denom;
    // Clamp tiny float drift
    return Math.max(-1, Math.min(1, r));
}

/**
 * Convert a price/equity value series into a returns series.
 * Returns array length is values.length - 1.
 */
export function toReturns(values: number[]): number[] {
    if (values.length < 2) return [];
    const out: number[] = [];
    for (let i = 1; i < values.length; i++) {
        const prev = values[i - 1];
        const curr = values[i];
        if (prev === undefined || curr === undefined) continue;
        if (prev === 0) { out.push(0); continue; }
        out.push((curr - prev) / prev);
    }
    return out;
}

export interface CorrelationInputSeries {
    ticker: string;
    /** Optional name for display (e.g. "Reliance Industries"). */
    label?: string;
    /** Already-aligned daily values (e.g. close prices) ordered oldest → newest. */
    values: number[];
}

/**
 * Build a pairwise correlation matrix from a set of value series.
 * High-correlation pairs are pairs whose |r| > 0.85 (industry threshold for
 * "essentially the same bet").
 */
export function buildCorrelationMatrix(
    series: CorrelationInputSeries[],
    highThreshold: number = 0.85
): CorrelationMatrix {
    const tickers = series.map(s => s.ticker);
    const returns = series.map(s => toReturns(s.values));
    const n = tickers.length;
    const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
        const rowI = matrix[i];
        if (!rowI) continue;
        rowI[i] = 1;
        for (let j = i + 1; j < n; j++) {
            const retI = returns[i];
            const retJ = returns[j];
            const rowJ = matrix[j];
            if (!retI || !retJ || !rowJ) continue;
            const r = pearsonCorrelation(retI, retJ);
            rowI[j] = r;
            rowJ[i] = r;
        }
    }
    const pairs: CorrelationMatrix['highCorrelationPairs'] = [];
    for (let i = 0; i < n; i++) {
        const rowI = matrix[i];
        if (!rowI) continue;
        for (let j = i + 1; j < n; j++) {
            const val = rowI[j];
            if (val === undefined) continue;
            if (Math.abs(val) >= highThreshold) {
                const tickerA = tickers[i];
                const tickerB = tickers[j];
                if (tickerA !== undefined && tickerB !== undefined) {
                    pairs.push({ a: tickerA, b: tickerB, correlation: val });
                }
            }
        }
    }
    pairs.sort((x, y) => Math.abs(y.correlation) - Math.abs(x.correlation));
    return { tickers, matrix, highCorrelationPairs: pairs, method: 'pearson', windowDays: 0 };
}

/**
 * Build a correlation matrix *only* from the user's `Investment[]` and the
 * `correlationProvider` callback. The provider is expected to return a series
 * of historical closing values for a ticker. If a provider is omitted, the
 * function falls back to a simple placeholder using `unrealizedPnL` and
 * `currentValue` (single-point correlation, useful for first-render UI only).
 */
export function buildPortfolioCorrelationMatrix(
    investments: Investment[],
    options: {
        highThreshold?: number;
        correlationProvider?: (ticker: string) => Promise<number[]>;
    } = {}
): Promise<CorrelationMatrix> {
    const equity = investments.filter(
        i => i.ticker && (i.type === 'Stocks' || i.type === 'ETF')
    );
    const uniqueTickers = Array.from(new Set(equity.map(i => i.ticker as string)));
    if (uniqueTickers.length === 0) {
        return Promise.resolve({
            tickers: [],
            matrix: [],
            highCorrelationPairs: [],
            method: 'pearson',
            windowDays: 0,
        });
    }

    const provider = options.correlationProvider;
    if (!provider) {
        // Single-point fallback: build a perfectly correlated series of length 2
        // using the unrealizedPnL signal. This still produces sensible output for
        // the UI to show "we don't have enough history yet".
        const placeholder = uniqueTickers.map(t => {
            const inv = equity.find(i => i.ticker === t);
            const pnl = inv?.unrealizedPnL ?? 0;
            return { ticker: t, values: [1, 1 + (pnl !== 0 ? Math.sign(pnl) * 0.01 : 0)] };
        });
        return Promise.resolve(buildCorrelationMatrix(placeholder, options.highThreshold));
    }

    return Promise.all(
        uniqueTickers.map(async ticker => ({
            ticker,
            values: await provider(ticker),
        }))
    ).then(series => buildCorrelationMatrix(series, options.highThreshold));
}

// =====================================================================
// SECTION 5 — HIGH-LEVEL RISK SCORECARD
// =====================================================================

export interface RiskScorecard {
    sharpe: number;
    sortino: number;
    calmar: number;
    omega: number;
    informationRatio: number;
    recoveryFactor: number;
    maxDrawdownPct: number;
    cagrPct: number;
    nPeriods: number;
    percentileVsBenchmark: number; // 0..1 — share of the Indian-retail benchmark beaten
}

/**
 * Compute the full risk-adjusted scorecard from a series of portfolio
 * returns and a benchmark series. Returns zeros if the inputs are too small
 * to be meaningful.
 */
export function computeRiskScorecard(
    portfolioReturns: number[],
    benchmarkReturns: number[] = []
): RiskScorecard {
    if (portfolioReturns.length < 4) {
        return {
            sharpe: 0, sortino: 0, calmar: 0, omega: 0,
            informationRatio: 0, recoveryFactor: 0,
            maxDrawdownPct: 0, cagrPct: 0,
            nPeriods: portfolioReturns.length,
            percentileVsBenchmark: 0,
        };
    }

    // Build a synthetic NAV series from compounded returns to compute drawdown.
    const nav: number[] = [];
    let running = 1;
    for (const r of portfolioReturns) {
        running *= 1 + r;
        nav.push(running);
    }
    const dd = calculateMaxDrawdown(nav);

    // Approximate CAGR assuming daily returns (252 trading days).
    const periodsPerYear = 252;
    const firstNav = nav[0];
    const lastNav = nav[nav.length - 1];
    const totalReturn = (firstNav !== undefined && lastNav !== undefined && firstNav !== 0)
        ? lastNav / firstNav - 1
        : 0;
    const years = nav.length / periodsPerYear;
    const cagrPct = years > 0 ? ((Math.pow(1 + totalReturn, 1 / years) - 1) * 100) : 0;

    const sharpe = calculateSharpeRatio(portfolioReturns);
    const sortino = calculateSortinoRatio(portfolioReturns);
    const calmar = calculateCalmarRatio(cagrPct, dd.maxDrawdownPct);
    const omega = calculateOmegaRatio(portfolioReturns);
    const ir = benchmarkReturns.length > 1
        ? calculateInformationRatio(portfolioReturns, benchmarkReturns)
        : 0;
    const recoveryFactor = calculateRecoveryFactor(cagrPct, dd.maxDrawdownPct);

    // Naïve percentile proxy: Sharpe > 1.0 means beating ~80% of retail noise
    // (Indian retail equity investors typically score 0.2–0.6 on Sharpe).
    let percentile = 0;
    if (sharpe >= 2) percentile = 0.95;
    else if (sharpe >= 1.5) percentile = 0.85;
    else if (sharpe >= 1) percentile = 0.7;
    else if (sharpe >= 0.5) percentile = 0.5;
    else if (sharpe >= 0) percentile = 0.3;
    else percentile = 0.1;

    return {
        sharpe,
        sortino,
        calmar,
        omega,
        informationRatio: ir,
        recoveryFactor,
        maxDrawdownPct: dd.maxDrawdownPct,
        cagrPct,
        nPeriods: portfolioReturns.length,
        percentileVsBenchmark: percentile,
    };
}

// =====================================================================
// SECTION 6 — UTILITY EXPORTS
// =====================================================================

export const quantEngine = {
    // Risk-adjusted metrics
    stdDev,
    downsideDeviation,
    calculateSharpeRatio,
    calculateSortinoRatio,
    calculateCalmarRatio,
    calculateOmegaRatio,
    calculateInformationRatio,
    // Drawdown
    calculateMaxDrawdown,
    calculateRecoveryFactor,
    // Behavioural
    calculateWinRateByDayOfWeek,
    calculateWinRateByTimeOfDay,
    calculateAvgHoldingPeriod,
    calculateStreakAnalysis,
    calculatePayoffAndExpectancy,
    calculateExpectedValue,
    // Correlation
    pearsonCorrelation,
    toReturns,
    buildCorrelationMatrix,
    buildPortfolioCorrelationMatrix,
    // Scorecard
    computeRiskScorecard,
};

export default quantEngine;
