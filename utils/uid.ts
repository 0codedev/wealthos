/**
 * Stable, collision-resistant ID generator.
 *
 * Why this exists (P0#4 stability audit 2026-06-18):
 * - The codebase used `Math.random().toString(36).slice(2, N)` for short IDs
 *   in 20+ places. Math.random is not cryptographically random, collisions are
 *   possible at scale, and it makes test fixtures flaky.
 * - `crypto.randomUUID()` is universally available in modern browsers and
 *   Node ≥ 14.17; the fallback path is a one-liner for the rare edge case.
 *
 * Usage:
 *   const id = uid();          // "f81d4fae-7dec-11d0-a765-00a0c91e6bf6"
 *   const short = uidShort();  // "f81d4fae"   (8 hex chars, still unique enough)
 */
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for very old environments — RFC4122 v4-ish shape from getRandomValues.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Per RFC 4122 §4.4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last-resort: timestamp + crypto-strong-ish entropy via Math.random.
  // Better than pure Math.random because the timestamp gives monotonicity.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Short ID — first 8 hex chars of a v4 UUID. */
export function uidShort(): string {
  return uid().split('-')[0];
}