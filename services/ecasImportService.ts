/**
 * ecasImportService — CC51
 *
 * Frontend wrapper for the /api/cas/parse Python-bridge endpoint.
 * Handles mapping from parsed JSON → db.investments records,
 * dedupe by (amfiCode + folio), and PAN storage in sessionStorage.
 *
 * The bridge is assumed to be running on 127.0.0.1:8765.
 */

import { db } from '../database';
import { Investment, InvestmentType } from '../types';

const BRIDGE_BASE = 'http://127.0.0.1:8765';
const PAN_STORAGE_KEY = 'ecas:pan';

export interface EcasScheme {
  isin: string | null;
  amfiCode: string | null;
  name: string;
  units: number;
  currentValue: number;
  nav: number;
  navDate: string;
}

export interface EcasFolio {
  folio: string;
  amc: string;
  pan: string | null;
  schemes: EcasScheme[];
}

export interface EcasParseResult {
  investorName: string;
  statementDate: string;
  warnings: string[];
  folios: EcasFolio[];
}

/**
 * Read the PAN from sessionStorage (set when the user typed it in the modal).
 * Returns null if not set. PAN is never persisted to db or localStorage.
 */
export function getStoredPAN(): string | null {
  try {
    return sessionStorage.getItem(PAN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredPAN(pan: string): void {
  try {
    sessionStorage.setItem(PAN_STORAGE_KEY, pan);
  } catch {
    // sessionStorage may be unavailable in some test environments
  }
}

export function clearStoredPAN(): void {
  try {
    sessionStorage.removeItem(PAN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * POST the eCAS PDF blob + PAN to the bridge and return the parsed result.
 * Throws a typed Error for each known failure mode (so the modal
 * can show a user-friendly toast).
 */
export async function parseEcas(pdfBlob: Blob, pan: string): Promise<EcasParseResult> {
  let response: Response;
  try {
    const form = new FormData();
    form.append('file', pdfBlob, 'ecas.pdf');
    if (pan) form.append('password', pan);
    response = await fetch(`${BRIDGE_BASE}/api/cas/parse`, {
      method: 'POST',
      body: form,
    });
  } catch (e) {
    throw new Error(
      'Python bridge not running on 127.0.0.1:8765. Start it with: python python-bridge/app.py'
    );
  }

  if (response.ok) {
    const body = await response.json();
    return body.result as EcasParseResult;
  }

  let errBody: { detail?: string } = {};
  try {
    errBody = await response.json();
  } catch {
    // ignore JSON parse errors on error body
  }
  if (response.status === 422) {
    throw new Error(errBody.detail || 'eCAS is unreadable.');
  }
  if (response.status === 503) {
    throw new Error(errBody.detail || 'eCAS parser unavailable.');
  }
  throw new Error(`eCAS parse failed: ${errBody.detail || response.statusText}`);
}

/**
 * Build a stable dedupe key for a parsed scheme. Uses (amfiCode + folio)
 * when amfiCode is present; falls back to (name + folio) when null.
 */
export function dedupeKey(scheme: EcasScheme, folio: string): string {
  if (scheme.amfiCode) return `${scheme.amfiCode}::${folio}`;
  return `name::${scheme.name}::${folio}`;
}

/**
 * Map a parsed eCAS result to an array of new Investment records.
 *
 * - Uses current_value for both investedAmount and currentValue
 *   (eCAS does not contain average cost basis)
 * - Deduplicates by dedupeKey() within the same parse
 * - Tags every record with 'ecas-import', the folio, and the ISIN
 *   so future re-imports can detect duplicates
 */
export function importEcasFolios(
  parsed: EcasParseResult,
  importedAt: string,
  owner: string,
  pan: string
): Omit<Investment, 'id'>[] {
  const seen = new Set<string>();
  const records: Omit<Investment, 'id'>[] = [];

  for (const folio of parsed.folios) {
    for (const scheme of folio.schemes) {
      const key = dedupeKey(scheme, folio.folio);
      if (seen.has(key)) continue;
      seen.add(key);

      const panLast4 = pan && pan.length >= 4 ? pan.slice(-4) : '';

      records.push({
        name: scheme.name,
        type: InvestmentType.MUTUAL_FUND,
        platform: folio.amc,
        investedAmount: scheme.currentValue,
        currentValue: scheme.currentValue,
        lastUpdated: importedAt,
        sector: 'Mutual Fund',
        country: 'India',
        tags: ['ecas-import', folio.folio, scheme.isin ?? 'no-isin'],
        isHiddenFromTotals: false,
        owner: owner as Investment['owner'],
        amfiCode: scheme.amfiCode ?? undefined,
        folio: folio.folio,
        ecasImportMeta: {
          importedAt,
          statementDate: parsed.statementDate,
          source: 'eCAS',
          investorPAN: panLast4 ? `XXXX${panLast4}` : '',
        },
      });
    }
  }

  return records;
}

/**
 * Find existing Investments that match the given (amfiCode, folio) pairs.
 * Used by the modal to mark rows as "EXISTS" and default-skip them.
 */
export async function findExistingEcasHoldings(
  parsed: EcasParseResult
): Promise<Set<string>> {
  const existing = new Set<string>();
  const all = await db.investments
    .where({ type: InvestmentType.MUTUAL_FUND })
    .toArray();
  for (const inv of all) {
    if (inv.amfiCode && inv.folio) {
      existing.add(`${inv.amfiCode}::${inv.folio}`);
    } else if (inv.folio && inv.amfiCode === undefined && inv.tags) {
      // For legacy records that came in without amfiCode, fall back to name+folio
      const tag = inv.tags.find((t) => t.startsWith('name::'));
      if (tag) existing.add(tag);
    }
  }
  return existing;
}

// --- CC57: re-import detection ---

/**
 * Information about the most recent eCAS import for a given PAN.
 */
export interface LastEcasImport {
  statementDate: string;
  importedAt: string;
  holdingCount: number;
  totalValue: number;
}

/**
 * Find the most recent eCAS import for a given PAN (last 4 chars).
 * Returns null if no prior import exists for that PAN.
 *
 * "Most recent" = the largest statementDate across all matching records.
 * We don't filter by importedAt because the user might re-import a stale
 * statement; the statementDate is the source of truth for "what was the
 * eCAS as of when".
 */
export async function getLastEcasImportForPan(panLast4: string): Promise<LastEcasImport | null> {
  if (!panLast4) return null;
  const all = await db.investments
    .where({ type: InvestmentType.MUTUAL_FUND })
    .toArray();

  let best: LastEcasImport | null = null;
  for (const inv of all) {
    const meta = inv.ecasImportMeta;
    if (!meta || meta.investorPAN !== `XXXX${panLast4}`) continue;
    if (!best || meta.statementDate > best.statementDate) {
      // For "holdingCount" + "totalValue" at the statement date we'd need a
      // historical snapshot which we don't keep. v1 approximates with the
      // CURRENT values, which is fine for the "do you want to replace N
      // holdings?" prompt — the user can see them in the preview.
      best = {
        statementDate: meta.statementDate,
        importedAt: meta.importedAt,
        holdingCount: all.filter(
          (i) => i.ecasImportMeta?.investorPAN === `XXXX${panLast4}`
        ).length,
        totalValue: all
          .filter((i) => i.ecasImportMeta?.investorPAN === `XXXX${panLast4}`)
          .reduce((s, i) => s + (i.currentValue || 0), 0),
      };
    }
  }
  return best;
}

export type ReimportStatus = 'NEW' | 'UPDATE' | 'STALE';

export interface ReimportCheck {
  status: ReimportStatus;
  prior: LastEcasImport | null;
  delta: number; // days between old and new statement date
}

/**
 * Compare a new eCAS parse to the last eCAS import for the same PAN.
 *
 *  - NEW    : no prior import for this PAN
 *  - UPDATE : new statementDate > old (this is the normal "refresh" flow)
 *  - STALE  : new statementDate <= old (user is uploading an old statement)
 *
 * delta = new.statementDate - old.statementDate in days (positive if new is newer)
 */
export function compareForReimport(
  prior: LastEcasImport | null,
  newStatementDate: string,
): ReimportCheck {
  if (!prior) return { status: 'NEW', prior: null, delta: 0 };
  const old = Date.parse(prior.statementDate);
  const neu = Date.parse(newStatementDate);
  if (isNaN(old) || isNaN(neu)) {
    return { status: 'UPDATE', prior, delta: 0 };
  }
  const deltaDays = Math.round((neu - old) / 86_400_000);
  return {
    status: deltaDays > 0 ? 'UPDATE' : 'STALE',
    prior,
    delta: deltaDays,
  };
}

/**
 * Extract the last 4 chars of a PAN (uppercased). Returns '' for empty input.
 */
export function panLast4(pan: string): string {
  if (!pan) return '';
  const cleaned = pan.replace(/\s+/g, '').toUpperCase();
  return cleaned.length >= 4 ? cleaned.slice(-4) : '';
}

// --- CC56: multi-PAN support ---

/**
 * Group an EcasParseResult by PAN. Folios without a PAN are grouped under ''.
 * Returns a Map keyed by the masked PAN ("XXXX1234F" or '' for unknown).
 */
export function groupFoliosByPan(parsed: EcasParseResult): Map<string, EcasFolio[]> {
  const out = new Map<string, EcasFolio[]>();
  for (const f of parsed.folios) {
    const key = f.pan ? `XXXX${panLast4(f.pan)}` : '';
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(f);
  }
  return out;
}

/**
 * Return a list of { pan, schemeCount, totalValue } summaries, one per PAN
 * found in the parsed result. Sorted by totalValue descending.
 */
export interface PanSummary {
  pan: string; // masked "XXXX1234F" or '' for unknown
  folioCount: number;
  schemeCount: number;
  totalValue: number;
}

export function summarizeByPan(parsed: EcasParseResult): PanSummary[] {
  const grouped = groupFoliosByPan(parsed);
  const out: PanSummary[] = [];
  for (const [pan, folios] of grouped.entries()) {
    let schemeCount = 0;
    let totalValue = 0;
    for (const f of folios) {
      for (const s of f.schemes) {
        schemeCount += 1;
        totalValue += s.currentValue || 0;
      }
    }
    out.push({ pan, folioCount: folios.length, schemeCount, totalValue });
  }
  out.sort((a, b) => b.totalValue - a.totalValue);
  return out;
}
