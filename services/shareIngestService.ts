/**
 * A3 — Share Target API ingest service.
 *
 * Reads a share payload stashed by `public/sw-share-target.js` into the
 * `share-inbox` Cache API, runs OCR on the image (if any), and decides
 * what to do with the share. Three outcomes:
 *
 *   1. `savedAs: 'TRADE'`   — image OCR found a parseable signal.
 *                            Returns a `TradePrefill` for the page to
 *                            open `AddTradeModal` with. NEVER auto-saves.
 *   2. `savedAs: 'JOURNAL'` — image with no parseable signal, OR plain
 *                            text share. Falls back to a free-text note
 *                            in `db.shared_journal`.
 *   3. `savedAs: 'NONE'`    — empty share, no payload to ingest.
 *
 * The image blob itself stays in the `share-inbox` Cache API; we only
 * persist the `imageBlobId` (cache key) + OCR text into Dexie, so we
 * don't bloat IndexedDB with binary.
 *
 * The secondary service worker at `/sw-share-target.js` is registered
 * lazily on the first call to `ensureShareTargetSwRegistered()`. It is
 * a static file in `public/`, not bundled by Workbox.
 *
 * Spec: docs/superpowers/specs/2026-06-20-share-target-api-design.md
 */
import { db } from '../database';
import { OCREngine } from './ocrService';
import { regexParseSignal, ParsedSignal } from './TelegramSignalParser';
import { logger } from './Logger';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** What the SW stashed into the `share-inbox` Cache API. */
export type SharedPayload =
    | {
          kind: 'image';
          blob: Blob;
          filename?: string;
          title?: string;
          text?: string;
          url?: string;
          sid: string;
      }
    | { kind: 'text'; text: string; url?: string; title?: string; sid: string }
    | { kind: 'empty'; sid: string | null };

/** Prefill hint for the AddTradeModal — populated only when `savedAs: 'TRADE'`. */
export interface TradePrefill {
    ticker: string;
    side: 'Long' | 'Short';
    entryPrice: number;
    stopLoss?: number;
    targets?: number[];
    rawText: string;
    imageBlobId?: string;
    confidence: number;
}

export type IngestResult =
    | { savedAs: 'TRADE'; summary: string; prefill: TradePrefill }
    | { savedAs: 'JOURNAL'; summary: string; journalId: number }
    | { savedAs: 'NONE'; summary: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Confidence floor for "this OCR result is usable" — below this we fall back to a note. */
const OCR_USABLE_CONFIDENCE = 0.5;

/** Cache name shared with the SW (see public/sw-share-target.js). */
export const SHARE_INBOX_CACHE = 'share-inbox';

/** SW URL — must match the file in public/. */
const SHARE_SW_URL = '/sw-share-target.js';

/** Guard against double-registration. */
let registered = false;

// ---------------------------------------------------------------------------
// SW registration
// ---------------------------------------------------------------------------

/**
 * Register the secondary share-target service worker. Idempotent.
 * No-op in environments without `navigator.serviceWorker` (dev, jsdom).
 * No-op in dev (Vite PWA plugin is `disable: true` in dev, so the
 * primary SW is absent — but we still register the share SW so manual
 * testing works).
 */
export async function ensureShareTargetSwRegistered(): Promise<void> {
    if (registered) return;
    if (typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    try {
        // `updateViaCache: 'none'` so a stale cache can't pin a broken SW.
        const reg = await navigator.serviceWorker.register(SHARE_SW_URL, {
            scope: '/',
            updateViaCache: 'none',
        });
        // The SW handles `/?shared=1` POSTs; we don't need to await
        // activation — the page will redirect to `?shared=1&ready=1`
        // after the SW claims the client.
        registered = true;
        logger.debug('Share-target SW registered', { scope: reg.scope }, 'shareIngestService');
    } catch (err) {
        // Non-fatal — share ingest gracefully degrades to NONE.
        logger.warn('Share-target SW registration failed', err, 'shareIngestService');
    }
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

async function readMetaFromCache(sid: string): Promise<ShareMeta | null> {
    if (typeof caches === 'undefined') return null;
    try {
        const cache = await caches.open(SHARE_INBOX_CACHE);
        const res = await cache.match(`/meta/${sid}`);
        if (!res) return null;
        const json = (await res.json()) as ShareMeta;
        return json;
    } catch (err) {
        logger.warn('readMetaFromCache failed', err, 'shareIngestService');
        return null;
    }
}

async function readBlobFromCache(sid: string): Promise<Blob | null> {
    if (typeof caches === 'undefined') return null;
    try {
        const cache = await caches.open(SHARE_INBOX_CACHE);
        const res = await cache.match(`/blob/${sid}`);
        if (!res) return null;
        return await res.blob();
    } catch (err) {
        logger.warn('readBlobFromCache failed', err, 'shareIngestService');
        return null;
    }
}

async function clearShareEntry(sid: string): Promise<void> {
    if (typeof caches === 'undefined') return;
    try {
        const cache = await caches.open(SHARE_INBOX_CACHE);
        await cache.delete(`/meta/${sid}`);
        await cache.delete(`/blob/${sid}`);
    } catch {
        /* best-effort */
    }
}

interface ShareMeta {
    id: string;
    title: string;
    text: string;
    url: string;
}

// ---------------------------------------------------------------------------
// readSharePayload
// ---------------------------------------------------------------------------

/**
 * Read a share payload from the `share-inbox` Cache API by `sid`.
 *
 * @param sid  The share ID from the `?shared=1&ready=1&sid=…` query.
 * @returns    A `SharedPayload` describing what was shared. Always
 *             resolves — never throws. Returns `{ kind: 'empty' }` if
 *             the cache has no matching entry.
 */
export async function readSharePayload(sid: string | null): Promise<SharedPayload> {
    if (!sid) return { kind: 'empty', sid: null };
    const meta = await readMetaFromCache(sid);
    if (!meta) return { kind: 'empty', sid };
    const blob = await readBlobFromCache(sid);

    if (blob) {
        return {
            kind: 'image',
            blob,
            // The File name isn't preserved by `new Response(blob)`,
            // so we surface a synthetic name. Real filename is opaque
            // to the user in the share sheet anyway.
            filename: `share-${sanitizeId(sid)}.${guessExt(blob.type)}`,
            title: meta.title || undefined,
            text: meta.text || undefined,
            url: meta.url || undefined,
            sid,
        };
    }
    if (meta.text || meta.url || meta.title) {
        return {
            kind: 'text',
            text: meta.text || '',
            url: meta.url || undefined,
            title: meta.title || undefined,
            sid,
        };
    }
    return { kind: 'empty', sid };
}

function guessExt(mime: string): string {
    if (!mime) return 'bin';
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('heic')) return 'heic';
    if (mime.includes('gif')) return 'gif';
    return 'bin';
}

/** Trim the SID for display filenames. Caps at 8 chars, strips non-id chars. */
function sanitizeId(id: string): string {
    return (id || 'shared').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24) || 'shared';
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

/**
 * Run OCR on the image (if any) of a `SharedPayload`. Returns the
 * payload untouched plus `ocrText` and `ocrConfidence` for the
 * downstream `ingestShared` call.
 *
 * For non-image payloads, returns the payload untouched with no OCR
 * fields. For images where OCR fails or returns below
 * `OCR_USABLE_CONFIDENCE`, returns `ocrText: undefined` so the
 * downstream `ingestShared` falls back to a journal entry.
 */
export async function recognizeIfImage(
    payload: SharedPayload
): Promise<{ payload: SharedPayload; ocrText?: string; ocrConfidence?: number }> {
    if (payload.kind !== 'image') {
        return { payload };
    }
    try {
        const result = await OCREngine.recognize(payload.blob);
        const text = (result.text || '').trim();
        const confidence = typeof result.confidence === 'number' ? result.confidence : 0;
        // Below the confidence floor OR no usable text → drop the text
        // so the downstream `ingestShared` always falls back to a note.
        if (!text || confidence < OCR_USABLE_CONFIDENCE) {
            return { payload, ocrText: undefined, ocrConfidence: confidence };
        }
        return { payload, ocrText: text, ocrConfidence: confidence };
    } catch (err) {
        logger.warn('OCR failed for shared image', err, 'shareIngestService');
        return { payload };
    }
}

// ---------------------------------------------------------------------------
// ingestShared
// ---------------------------------------------------------------------------

/**
 * Decide what to do with a shared payload.
 *
 *   - Image + parseable signal → `{ savedAs: 'TRADE', prefill, summary }`
 *   - Image without signal      → row in `db.shared_journal` (kind: shared_image)
 *   - Plain text                → row in `db.shared_journal` (kind: shared_text)
 *   - Empty                     → `{ savedAs: 'NONE' }`
 *
 * Always resolves; logs and never throws.
 */
export async function ingestShared(
    payload: SharedPayload,
    ocrText?: string
): Promise<IngestResult> {
    try {
        if (payload.kind === 'image') {
            return await ingestImage(payload, ocrText);
        }
        if (payload.kind === 'text') {
            return await ingestText(payload);
        }
        return {
            savedAs: 'NONE',
            summary: 'Nothing to share.',
        };
    } catch (err) {
        logger.error('ingestShared failed', err, 'shareIngestService');
        return {
            savedAs: 'NONE',
            summary: 'Could not process the share. Try again.',
        };
    } finally {
        // Best-effort cleanup so a refresh doesn't re-ingest.
        // Awaited so callers can assert the cache is empty after resolution.
        if (payload.sid) {
            await clearShareEntry(payload.sid);
        }
    }
}

async function ingestImage(
    payload: Extract<SharedPayload, { kind: 'image' }>,
    ocrText?: string
): Promise<IngestResult> {
    const parsed: ParsedSignal | null = ocrText ? tryParseSignal(ocrText) : null;
    if (parsed) {
        const prefill: TradePrefill = toPrefill(parsed, ocrText || '', payload);
        return {
            savedAs: 'TRADE',
            summary: 'Looks like a trade — review and save.',
            prefill,
        };
    }
    // No parseable signal — save as a journal note.
    const row = await db.shared_journal.add({
        kind: 'shared_image',
        title: payload.title,
        text: ocrText || payload.text,
        url: payload.url,
        imageBlobId: `share-inbox:${payload.sid}`,
        createdAt: Date.now(),
        source: 'share_target',
    });
    const id = typeof row === 'number' ? row : Number(row);
    return {
        savedAs: 'JOURNAL',
        summary: 'Saved to your journal.',
        journalId: id,
    };
}

async function ingestText(
    payload: Extract<SharedPayload, { kind: 'text' }>
): Promise<IngestResult> {
    const row = await db.shared_journal.add({
        kind: 'shared_text',
        title: payload.title,
        text: payload.text,
        url: payload.url,
        createdAt: Date.now(),
        source: 'share_target',
    });
    const id = typeof row === 'number' ? row : Number(row);
    return {
        savedAs: 'JOURNAL',
        summary: 'Saved to your journal.',
        journalId: id,
    };
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** Try to extract a ParsedSignal. Returns null if no signal is found. */
function tryParseSignal(ocrText: string): ParsedSignal | null {
    try {
        const r = regexParseSignal(ocrText);
        if (!r) return null;
        if (!r.action || !r.index) return null;
        if (r.entry == null) return null;
        // regexParseSignal returns the index name (NIFTY, BANKNIFTY, …)
        // for options. For equity signals the index is null and the
        // tradingSymbol needs to be inferred from the raw text — we
        // punt that to a future task and only support index-based
        // signals for v1. (Better to fall back to a note than to
        // mint a wrong ticker.)
        if (r.strike == null || r.type == null) return null;
        const tradingSymbol = `${r.index} ${r.strike} ${r.type}`;
        return {
            rawSignal: r.raw,
            confidence: r.confidence,
            action: r.action,
            tradingSymbol,
            suggestedEntryPrice: r.entry,
            stopLoss: r.sl ?? r.entry,
            targets: r.targets ?? [],
            productType: r.productType,
            exchangeSegment: r.exchangeSegment,
            expiryDate: r.expiryDate ?? undefined,
        };
    } catch {
        return null;
    }
}

function toPrefill(
    parsed: ParsedSignal,
    rawText: string,
    payload: Extract<SharedPayload, { kind: 'image' }>
): TradePrefill {
    return {
        ticker: parsed.tradingSymbol,
        side: parsed.action === 'BUY' ? 'Long' : 'Short',
        entryPrice: parsed.suggestedEntryPrice,
        stopLoss: parsed.stopLoss,
        targets: parsed.targets,
        rawText,
        imageBlobId: `share-inbox:${payload.sid}`,
        confidence: parsed.confidence,
    };
}
