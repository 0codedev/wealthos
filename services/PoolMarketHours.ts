/**
 * CC39 — Momentum Pool Market Hours Utility
 * Single source of truth for "should the Pool poll right now?".
 *
 * NSE cash + F&O session: 09:15 to 15:30 IST, Monday-Friday.
 * NSE holidays are NOT excluded (we'd need a holiday list and the user can
 * pause manually). The Pool always pauses outside these hours, so the cost
 * is one stuck toast that says "market closed" instead of a missed alert.
 *
 * TIMEZONE FIX: previously these checks used raw local getHours() which broke
 * on any non-IST machine. All gates now use explicit UTC+5:30 conversion,
 * matching types/trust.ts conventions.
 */
const NSE_OPEN_MIN = 9 * 60 + 15;   // 09:15 IST
const NSE_CLOSE_MIN = 15 * 60 + 30; // 15:30 IST
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Shift a timestamp into the IST wall-clock frame (read Y/M/D/H/M off it). */
function istView(date: Date): Date {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + IST_OFFSET_MS);
}

/** Epoch ms for hh:mm IST on the calendar date carried by the given IST view parts. */
function istWallToEpoch(y: number, m: number, d: number, hh: number, mm: number): number {
  return Date.UTC(y, m, d, hh, mm, 0, 0) - IST_OFFSET_MS;
}

/**
 * Returns true if the Pool should be polling right now.
 * Uses explicit IST conversion - correct regardless of machine timezone.
 */
export function isMarketHours(now: Date = new Date()): boolean {
  const ist = istView(now);
  const day = ist.getDay(); // 0 = Sunday, 6 = Saturday (IST frame)
  if (day === 0 || day === 6) return false;

  const totalMinutes = ist.getHours() * 60 + ist.getMinutes();
  return totalMinutes >= NSE_OPEN_MIN && totalMinutes < NSE_CLOSE_MIN;
}

/**
 * Returns milliseconds until the next market open (09:15 IST). Negative never -
 * returns 0 if currently open, else ms until the next weekday 09:15 IST.
 */
export function msUntilNextOpen(now: Date = new Date()): number {
  if (isMarketHours(now)) return 0;

  const ist = istView(now);
  const dayOk = (dow: number) => dow >= 1 && dow <= 5;

  let y = ist.getFullYear();
  let m = ist.getMonth();
  let d = ist.getDate();
  let candidateEpoch = istWallToEpoch(y, m, d, 9, 15);

  // If today's 09:15 IST already passed (or today is a weekend), walk forward.
  if (!dayOk(ist.getDay()) || now.getTime() >= candidateEpoch) {
    do {
      const nextUtcMidnight = Date.UTC(y, m, d) + 24 * 60 * 60 * 1000;
      const nd = new Date(nextUtcMidnight);
      y = nd.getUTCFullYear();
      m = nd.getUTCMonth();
      d = nd.getUTCDate();
      candidateEpoch = istWallToEpoch(y, m, d, 9, 15);
    } while (!dayOk(new Date(candidateEpoch + IST_OFFSET_MS).getUTCDay()));
  }

  return Math.max(0, candidateEpoch - now.getTime());
}

/**
 * Returns a short human label like "3h 12m" or "Mon 09:15" for the next open.
 */
export function formatNextOpen(now: Date = new Date()): string {
  const ms = msUntilNextOpen(now);
  if (ms === 0) return 'Open now';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return `${hours}h ${remMin}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * Returns the current 5-minute candle boundary in epoch ms.
 * Used by PoolPollEngine to decide when to re-run verdicts.
 * Candle boundaries are 09:15, 09:20, 09:25, ... in IST - aligned via IST
 * frame arithmetic so they are correct on any machine timezone.
 */
export function currentCandleBoundary(now: Date = new Date()): number {
  const istFrame = now.getTime() + IST_OFFSET_MS;
  const bucketMs = Math.floor(istFrame / (5 * 60 * 1000)) * (5 * 60 * 1000);
  return bucketMs - IST_OFFSET_MS;
}
