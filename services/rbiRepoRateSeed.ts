/**
 * RBI Repo Rate Seed — A2 (Lane 3.1 of ULTIMATE_BREAKTHROUGH_FEATURES.md)
 *
 * RBI publishes the policy repo rate 8 times a year after the MPC review.
 * There is no official JSON API, so this file is the operator-maintained
 * source of truth for the *current* repo rate. The contract is simple:
 *
 *   1. Operator edits `RBI_REPO_SEED` after each MPC review (8 edits/year).
 *   2. `RbiPolicyService.fetchRepoRate()` reads from cache → seed.
 *   3. If `Date.now() - effectiveDate > 14 days`, the widget shows an
 *      amber "needs refresh" eyebrow (stale flag is computed at the
 *      consumer; see `RbiPolicyService.isStale`).
 *
 * MPC meeting dates are public. The 2026 schedule is in `MPC_CALENDAR`.
 *
 * Zero new dependencies. Mirrors the operator-seeded-source pattern used
 * by every bridge status / static-config in the project.
 */

/** Repo rate snapshot, as known at a specific MPC decision date. */
export interface RbiPolicySnapshot {
    /** Current repo rate, in percent. e.g. 6.50. */
    repoRate: number;
    /** Repo rate that was in force just before this decision. */
    previousRepoRate: number;
    /** ISO date the current rate took effect (MPC announcement day). */
    effectiveDate: string;
    /** ISO date of the prior MPC decision. */
    priorDate: string;
    /** Direction-of-change vs the prior decision. */
    direction: 'HAWKISH' | 'DOVISH' | 'NEUTRAL';
    /**
     * Provenance label. The service computes this — the seed is always
     * `source: 'seed'` at definition time. The service may relabel to
     * `'cache'` or `'ai'` based on where the value actually came from.
     */
    source: 'seed' | 'cache' | 'ai' | 'mock';
}

/**
 * Current RBI repo rate, as of the 04–06 Jun 2026 MPC review.
 * The MPC kept the rate on hold at 6.50% (prior decision 6.50%).
 */
export const RBI_REPO_SEED: RbiPolicySnapshot = {
    repoRate: 6.50,
    previousRepoRate: 6.50,
    effectiveDate: '2026-06-06',
    priorDate: '2026-04-04',
    direction: 'NEUTRAL',
    source: 'seed',
};

/** One MPC meeting window. */
export interface MpcMeeting {
    /** First day of the meeting (inclusive), ISO date. */
    start: string;
    /** Last day of the meeting (inclusive), ISO date. */
    end: string;
    /** Short label like "Jun 2026" used in footer copy. */
    label: string;
    /** True if this meeting is in the future (as of the file's last edit). */
    upcoming: boolean;
}

/**
 * 2026 RBI MPC meeting dates (public schedule, 8 meetings/year).
 * `upcoming` is a hint for the footer copy in the widget; the service
 * recomputes "last" vs "next" at runtime from `effectiveDate` and the
 * current date, so this list is informational.
 */
export const MPC_CALENDAR: MpcMeeting[] = [
    { start: '2026-02-04', end: '2026-02-06', label: 'Feb 2026', upcoming: false },
    { start: '2026-04-04', end: '2026-04-06', label: 'Apr 2026', upcoming: false },
    { start: '2026-06-04', end: '2026-06-06', label: 'Jun 2026', upcoming: false },
    { start: '2026-08-06', end: '2026-08-08', label: 'Aug 2026', upcoming: true },
    { start: '2026-10-06', end: '2026-10-08', label: 'Oct 2026', upcoming: true },
    { start: '2026-12-04', end: '2026-12-06', label: 'Dec 2026', upcoming: true },
];

/** Cache key for the 7-day IndexedDB TTL entry. Stable across builds. */
export const RBI_REPO_CACHE_KEY = 'rbi_repo_rate';

/** TTL for the IndexedDB cache entry: 7 days in ms. */
export const RBI_REPO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Window after which the seed is considered "stale" and the widget
 * renders the amber "needs refresh" eyebrow. 14 days covers a long
 * weekend plus operator-response slack; the next MPC is always within
 * 8 weeks, so this is well below the legitimate inter-MPC window.
 */
export const RBI_STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Direction-classification floor. Indian MPC moves in 25 bps increments;
 * a 5–10 bps "move" is unusual and almost always a transcription error
 * in some upstream source. We treat any |delta| < 10 bps as NEUTRAL.
 */
export const DIRECTION_FLOOR_BPS = 10;
