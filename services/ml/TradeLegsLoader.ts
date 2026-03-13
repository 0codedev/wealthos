// services/ml/TradeLegsLoader.ts
// Phase B: read python-bridge/data/trade_legs/YYYY-MM-DD.json files (served by
// the Python bridge at /api/leg-data/{date}) and bulk-insert into
// db.trade_legs. Idempotent: re-running on the same day updates the same rows
// by (date, securityId, transactionType, exchangeTime).
//
// The Python bridge (localhost:8765) hosts the JSON files — no need to copy
// anything into Vite's public/ folder. The frontend talks to it directly.

import { db, type TradeLeg } from '../../database';
import { parseDayFile, type DayFile } from './TradeLegsIngest';
import { logger } from '../Logger';

const BRIDGE_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BRIDGE_URL)
  || 'http://127.0.0.1:8765';

export interface LegIngestSummary {
  filesRead: number;
  legsInserted: number;
  legsUpdated: number;
  daysSkipped: number;
  errors: { file: string; message: string }[];
}

/** Discover available days via the Python bridge's /api/leg-data/_index. */
export async function listAvailableDayFiles(): Promise<string[]> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/api/leg-data/_index`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.days) ? json.days : [];
  } catch (err) {
    logger.warn('[TradeLegsLoader] could not reach Python bridge at ' + BRIDGE_BASE, err);
    return [];
  }
}

export async function loadDayFile(dayIso: string): Promise<DayFile | null> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/api/leg-data/${dayIso}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.missing) {
      // Explicit empty day
      return { date: dayIso, leg_count: 0, legs: [] };
    }
    return parseDayFile(JSON.stringify(json));
  } catch (err) {
    logger.warn(`[TradeLegsLoader] failed to read ${dayIso} from bridge`, err);
    return null;
  }
}

/** In-memory source — used by tests and by the backfill orchestrator. */
export async function ingestFromMap(
  byDay: Record<string, DayFile>,
): Promise<LegIngestSummary> {
  const summary: LegIngestSummary = {
    filesRead: 0, legsInserted: 0, legsUpdated: 0, daysSkipped: 0, errors: [],
  };
  const now = Date.now();

  for (const [date, day] of Object.entries(byDay)) {
    summary.filesRead++;
    if (!day.legs || day.legs.length === 0) {
      summary.daysSkipped++;
      continue;
    }
    try {
      // Upsert by (date, securityId, transactionType, exchangeTime) — same day
      // and same Dhan tradeId guarantee uniqueness.
      for (const leg of day.legs) {
        const fees =
          (leg.stt ?? 0) + (leg.sebiTax ?? 0) + (leg.brokerageCharges ?? 0)
        + (leg.serviceTax ?? 0) + (leg.exchangeTransactionCharges ?? 0)
        + (leg.stampDuty ?? 0);
        const row: TradeLeg = {
          ...leg,
          date,
          fees: Number(fees.toFixed(2)),
          importedAt: now,
          source: 'dhan_backfill_v1',
        };
        const existing = await db.trade_legs
          .where('[date+ticker]').equals([date, leg.ticker])
          .and(l =>
            l.securityId === leg.securityId &&
            l.transactionType === leg.transactionType &&
            l.exchangeTime === leg.exchangeTime
          )
          .first();
        if (existing?.id != null) {
          await db.trade_legs.update(existing.id, row);
          summary.legsUpdated++;
        } else {
          await db.trade_legs.add(row);
          summary.legsInserted++;
        }
      }
    } catch (err: any) {
      summary.errors.push({ file: date, message: String(err?.message ?? err) });
    }
  }
  return summary;
}

/** End-to-end: discover day files via /data/trade_legs/_index.json and ingest. */
export async function ingestAllFromPublic(): Promise<LegIngestSummary> {
  const days = await listAvailableDayFiles();
  const byDay: Record<string, DayFile> = {};
  for (const d of days) {
    const day = await loadDayFile(d);
    if (day) byDay[d] = day;
  }
  return ingestFromMap(byDay);
}

/** Count of legs in the table — used by retrain to decide which path. */
export async function countLegs(): Promise<number> {
  return db.trade_legs.count();
}

/** Read all legs sorted by date ascending. Used by retrain. */
export async function readAllLegs(): Promise<TradeLeg[]> {
  return db.trade_legs.orderBy('date').toArray();
}
