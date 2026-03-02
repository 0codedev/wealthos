/**
 * A4 — Daily 9 AM Telegram Digest
 *
 * One per IST day. Triggers on first tab open / `visibilitychange →
 * visible` after 09:00 IST. Re-uses `TelegramEarManager.summarize()`
 * (existing per-ear Groq path) and stitches the results into a single
 * `DailyDigestRecord` that lives in Dexie (`db.daily_digest`, v44
 * additive). Best-effort pushes the same brief to Telegram "me" via
 * the ear server `/api/daily-digest` endpoint — silently skips if the
 * server is offline.
 *
 * No new dependencies. No timers. No background work. Pulls everything
 * from the existing Telegram + Groq pipeline.
 */
import { db, type DailyDigestRecord, type DailyDigestSentiment } from '../database';
import { EarSummary, telegramEarManager } from './TelegramEarManager';
import { logger } from '../utils/logger';

export const IST_TZ = 'Asia/Kolkata';
export const QUIET_THRESHOLD = 3;
export const NINE_AM_HOUR_IST = 9;
export const MAX_KEY_SIGNALS = 8;
export const MAX_NEWS_HEADLINES = 6;

export interface GenerateResult {
    record: DailyDigestRecord;
    pushed: boolean;
    skippedPushReason?: 'quiet-day' | 'server-offline' | 'server-error';
}

/**
 * Returns 'YYYY-MM-DD' for the given epoch ms in Asia/Kolkata.
 * Stable across DST (IST has no DST).
 * Pure function — no Date side-effects that depend on local tz.
 */
export function getIstDateString(epochMs: number = Date.now()): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: IST_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = fmt.formatToParts(new Date(epochMs));
    const y = parts.find(p => p.type === 'year')?.value ?? '1970';
    const m = parts.find(p => p.type === 'month')?.value ?? '01';
    const d = parts.find(p => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
}

function getIstHour(epochMs: number): number {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: IST_TZ,
        hour: '2-digit',
        hour12: false
    });
    const parts = fmt.formatToParts(new Date(epochMs));
    const hourStr = parts.find(p => p.type === 'hour')?.value ?? '00';
    return parseInt(hourStr, 10);
}

/**
 * True if:
 *   (a) it's at-or-after 09:00 IST today, AND
 *   (b) `lastStoredDate` is not today's IST date.
 */
export function shouldGenerateToday(
    nowEpochMs: number,
    lastStoredDate: string | undefined
): boolean {
    const today = getIstDateString(nowEpochMs);
    if (lastStoredDate === today) return false;
    return getIstHour(nowEpochMs) >= NINE_AM_HOUR_IST;
}

/**
 * Read the stored digest for today's IST date, if any.
 */
export async function getStoredDigestForToday(): Promise<DailyDigestRecord | undefined> {
    try {
        if (!(db as any).daily_digest) return undefined;
        const today = getIstDateString();
        const rows = await (db as any).daily_digest.where('date').equals(today).toArray();
        return rows[0];
    } catch {
        return undefined;
    }
}

/**
 * Stitch per-ear summaries into a single DailyDigestRecord.
 * Pure (no I/O) — exposed for testing.
 */
export function stitchDigest(
    sections: EarSummary[],
    messageCount: number,
    date: string,
    generatedAt: number,
    pushed: boolean
): DailyDigestRecord {
    const briefs = sections.map(s => s.brief).filter(b => b && b.length > 0);
    const sentiment = majoritySentiment(sections);
    const keySignals = dedupCap(sections.flatMap(s => s.keySignals || []), MAX_KEY_SIGNALS);
    const newsHeadlines = dedupCap(sections.flatMap(s => s.newsHeadlines || []), MAX_NEWS_HEADLINES);
    const sentimentEmoji = sentiment === 'BULLISH' ? '🐂' : sentiment === 'BEARISH' ? '🐻' : '⚖️';
    const header = `${sentimentEmoji} ${sentiment} · ${date} 09:00 IST`;
    const combinedBrief = briefs.length === 0
        ? `${header}\n\nNo overnight activity to summarize.`
        : `${header}\n\n${briefs.join('\n\n---\n\n')}`;
    return {
        date,
        generatedAt,
        sections,
        combinedBrief,
        sentiment,
        keySignals,
        newsHeadlines,
        messageCount,
        pushedToTelegram: pushed
    };
}

function majoritySentiment(sections: EarSummary[]): DailyDigestSentiment {
    if (sections.length === 0) return 'NEUTRAL';
    const tally: Record<DailyDigestSentiment, number> = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
    for (const s of sections) {
        if (s.sentiment === 'BULLISH' || s.sentiment === 'BEARISH' || s.sentiment === 'NEUTRAL') {
            tally[s.sentiment]++;
        }
    }
    const winner = (Object.keys(tally) as DailyDigestSentiment[]).reduce((a, b) => tally[a] >= tally[b] ? a : b);
    return winner;
}

function dedupCap(items: string[], cap: number): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
        const s = (raw ?? '').trim();
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
        if (out.length >= cap) break;
    }
    return out;
}

/**
 * Run summarization across all registered ears, stitch, persist, push.
 *
 * - Returns null when shouldGenerateToday() is false and `force` is unset.
 * - Each per-ear summarize() call is wrapped — failures don't abort the
 *   rest of the run.
 * - Push is best-effort; skipped silently on offline / error.
 */
export async function generateForToday(force: boolean = false): Promise<GenerateResult | null> {
    const now = Date.now();
    const today = getIstDateString(now);

    if (!force) {
        const lastStoredDate = (await getStoredDigestForToday())?.date;
        if (!shouldGenerateToday(now, lastStoredDate)) {
            logger.log('DailyDigestService', `Skipping generate (lastStored=${lastStoredDate}, today=${today})`);
            return null;
        }
    }

    const ears: Array<{ id: string; name: string; color: string }> = [
        { id: 'premium_signals', name: 'Premium Signal Channels', color: '#a855f7' },
        { id: 'news_data',       name: 'News & Data Channels',      color: '#06b6d4' },
        { id: 'general_archive', name: 'General Market Channels',   color: '#64748b' }
    ];

    const sections: EarSummary[] = [];
    let messageCount = 0;
    // SPRINT-0 noise fix: when AI is unavailable, all three ears warn on every
    // digest attempt. One warning per ear per 30-minute window.
    const warnNow = Date.now();
    if (!(window as any).__digestWarnAt) (window as any).__digestWarnAt = {};

    for (const ear of ears) {
        try {
            const summary: EarSummary = await telegramEarManager.summarize(ear.id);
            if (summary && summary.brief && !/no messages received/i.test(summary.brief)) {
                messageCount += 1; // at least one message contributed
            }
            sections.push(summary);
        } catch (err) {
            const lastWarn = (window as any).__digestWarnAt[ear.id] || 0;
            if (warnNow - lastWarn > 30 * 60 * 1000) {
                (window as any).__digestWarnAt[ear.id] = warnNow;
                logger.warn('DailyDigestService', `summarize(${ear.id}) failed; skipping ear`, err);
            }
        }
    }

    const shouldPush = messageCount >= QUIET_THRESHOLD;

    const partialRecord = stitchDigest(sections, messageCount, today, now, false);
    let persistedId: any = undefined;
    if ((db as any).daily_digest) {
        persistedId = await (db as any).daily_digest.put(partialRecord);
    }

    if (!shouldPush) {
        logger.log('DailyDigestService', `Quiet day (messageCount=${messageCount}); skipping Telegram push`);
        const record = { ...partialRecord, id: persistedId, pushedToTelegram: false };
        return { record, pushed: false, skippedPushReason: 'quiet-day' };
    }

    let pushed = false;
    let skippedPushReason: GenerateResult['skippedPushReason'];
    try {
        const lines = [
            `📊 <b>Daily Digest · ${today}</b>`,
            `Sentiment: <b>${partialRecord.sentiment || 'NEUTRAL'}</b>`,
            '',
            partialRecord.combinedBrief
        ];
        if (Array.isArray(partialRecord.keySignals) && partialRecord.keySignals.length > 0) {
            lines.push('', '🔔 <b>Key Signals:</b>');
            for (const s of partialRecord.keySignals.slice(0, 8)) lines.push(`  • ${s}`);
        }
        if (Array.isArray(partialRecord.newsHeadlines) && partialRecord.newsHeadlines.length > 0) {
            lines.push('', '📰 <b>Headlines:</b>');
            for (const h of partialRecord.newsHeadlines.slice(0, 6)) lines.push(`  • ${h}`);
        }
        const text = lines.join('\n');

        const { telegramAlertService } = await import('./TelegramAlertService');
        pushed = await telegramAlertService.send(text);
        if (!pushed) skippedPushReason = 'server-error';
    } catch (err) {
        logger.warn('DailyDigestService', 'Telegram push failed; ignoring', err);
        skippedPushReason = 'server-error';
    }

    const finalRecord: DailyDigestRecord = {
        ...partialRecord,
        id: persistedId,
        pushedToTelegram: pushed
    };
    await db.daily_digest.put(finalRecord);

    return { record: finalRecord, pushed, skippedPushReason };
}
