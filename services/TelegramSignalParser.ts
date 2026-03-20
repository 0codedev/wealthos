import { chatWithGroq } from './groqService';
import { DhanOrderRequest } from './DhanBrokerService';
import { DhanScripResolver } from './DhanScripResolver';
import { logger } from './Logger';
import { db } from '../database';
import { OCRResult, OCRWord } from './ocrService';


export interface ParsedSignal {
    rawSignal: string;
    confidence: number; // 0 to 1
    action: 'BUY' | 'SELL';
    tradingSymbol: string;
    suggestedEntryPrice: number;
    stopLoss: number;
    targets: number[];
    productType: 'INTRADAY' | 'MARGIN' | 'CNC';
    exchangeSegment: 'NSE_EQ' | 'NSE_FNO' | 'BSE_EQ' | 'MCX_COMM';
    expiryDate?: string;
}

export interface LifecycleAction {
    action: 'MODIFY_SL' | 'MOVE_SL' | 'BOOK_PROFIT' | 'FULL_EXIT' | 'PARTIAL_EXIT' | string;
    tradingSymbol?: string;
    newValue?: number;
    rawText?: string;
}

/** Internal structured form used by the regex parser before mapping to ParsedSignal. */
export interface RegexParseOutput {
    index: 'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | 'MIDCPNIFTY' | 'SENSEX' | null;
    equitySymbol?: string | null;
    action: 'BUY' | 'SELL' | null;
    strike: number | null;
    type: 'CE' | 'PE' | null;
    entry: number | null;
    sl: number | null;
    targets: number[];
    expiryText: string | null;
    expiryDate: string | null;
    productType: ParsedSignal['productType'];
    exchangeSegment: ParsedSignal['exchangeSegment'];
    confidence: number; // 0-1
    raw: string;
    tradingSymbol?: string;
}

const PARSING_SYSTEM_PROMPT = `You are a financial NLP parser specializing in translating Indian Stock Market informal Telegram trade signals into strict JSON data.
Given an options or equity trade signal, extract the relevant fields.

RULES:
1. Return ONLY valid JSON, no markdown, no other text.
2. Example Signal: "CRUDEOIL 8700 CE Near 225 TGT 240/260/280+ Sl below 210"
3. JSON Format to return:
{
  "action": "BUY", // or SELL
  "tradingSymbol": "CRUDEOIL 8700 CE", // The scrip name and strike
  "suggestedEntryPrice": 225,
  "stopLoss": 210,
  "targets": [240, 260, 280],
  "productType": "MARGIN", // Default to MARGIN for options/commodities
  "exchangeSegment": "MCX_COMM" // Infer: CRUDEOIL=MCX_COMM, NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY=NSE_FNO, Others=NSE_EQ/NSE_FNO
}

Infer "action" as BUY if Targets > Entry for CE/PE.
If multiple targets are given, extract them as an array of numbers.
If you cannot parse the signal, return {"error": "unparseable"}
`;

// --------------------------------------------------------------------------
// Index metadata — used for expiry weekday resolution & segment inference.
// --------------------------------------------------------------------------
const INDEX_META: Record<string, { expiryWeekday: number; segment: ParsedSignal['exchangeSegment']; productType: ParsedSignal['productType'] }> = {
    NIFTY:      { expiryWeekday: 4, segment: 'NSE_FNO', productType: 'MARGIN' }, // Thu
    BANKNIFTY:  { expiryWeekday: 3, segment: 'NSE_FNO', productType: 'MARGIN' }, // Wed
    FINNIFTY:   { expiryWeekday: 2, segment: 'NSE_FNO', productType: 'MARGIN' }, // Tue
    MIDCPNIFTY: { expiryWeekday: 1, segment: 'NSE_FNO', productType: 'MARGIN' }, // Mon
    SENSEX:     { expiryWeekday: 5, segment: 'BSE_EQ', productType: 'INTRADAY' }, // Fri
};

// Index aliases that resolve to the canonical NIFTY family name.
const INDEX_ALIASES: Array<[RegExp, string]> = [
    [/\bBANKNIFTY\b/i, 'BANKNIFTY'],
    [/\bBANK\s*NIFTY\b/i, 'BANKNIFTY'],
    [/\bBN\b/i, 'BANKNIFTY'],
    [/\bFINNIFTY\b/i, 'FINNIFTY'],
    [/\bFIN\s*NIFTY\b/i, 'FINNIFTY'],
    [/\bMIDCPNIFTY\b/i, 'MIDCPNIFTY'],
    [/\bMIDCP\s*NIFTY\b/i, 'MIDCPNIFTY'],
    [/\bMIDCAP\s*NIFTY\b/i, 'MIDCPNIFTY'],
    [/\bMCN\b/i, 'MIDCPNIFTY'],
    [/\bSENSEX\b/i, 'SENSEX'],
    [/\bNIFTY\b/i, 'NIFTY'],
];

/** Index-specific weekly expiry resolver for "weekly" / "next week" / weekday roll-forward. */
function resolveWeeklyExpiry(indexName: string | null, when: Date = new Date()): string | null {
    if (!indexName) return null;
    const meta = INDEX_META[indexName];
    if (!meta) return null;
    const targetDow = meta.expiryWeekday; // 0=Sun ... 6=Sat
    const base = new Date(when);
    base.setHours(0, 0, 0, 0);
    const offset = (targetDow - base.getDay() + 7) % 7;
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + offset);
    // If today's expiry has already passed, roll to next week.
    if (candidate.getTime() < base.getTime()) {
        candidate.setDate(candidate.getDate() + 7);
    }
    const yyyy = candidate.getFullYear();
    const mm = String(candidate.getMonth() + 1).padStart(2, '0');
    const dd = String(candidate.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/** Parse a textual expiry like "28 May", "28MAY26", "28 May 2026" → ISO date. */
function parseExplicitExpiry(text: string, when: Date = new Date()): string | null {
    const cleaned = text.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
    // 28MAY26, 28 MAY 26, 28 MAY 2026
    const m1 = cleaned.match(/(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:\s*(\d{2,4}))?/i);
    if (m1) {
        const day = parseInt(m1[1], 10);
        const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const monthIndex = monthNames.indexOf(m1[2].slice(0, 3).toUpperCase());
        if (monthIndex === -1 || day < 1 || day > 31) return null;
        let year = when.getFullYear();
        if (m1[3]) {
            year = m1[3].length === 2 ? 2000 + parseInt(m1[3], 10) : parseInt(m1[3], 10);
        } else {
            // If the parsed month/day is already in the past, assume next year.
            const trial = new Date(year, monthIndex, day);
            if (trial.getTime() < when.getTime() - 24 * 3600 * 1000) {
                year += 1;
            }
        }
        const date = new Date(year, monthIndex, day);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    // Numeric 28/05/26
    const m2 = cleaned.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (m2) {
        const day = parseInt(m2[1], 10);
        const month = parseInt(m2[2], 10) - 1;
        if (day < 1 || day > 31 || month < 0 || month > 11) return null;
        let year = m2[3] ? (m2[3].length === 2 ? 2000 + parseInt(m2[3], 10) : parseInt(m2[3], 10)) : when.getFullYear();
        const date = new Date(year, month, day);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    return null;
}

/** Parse a price-looking number. Handles commas ("19,500") and "K" suffix ("19.5K"→19500). */
function parseNumberToken(token: string): number | null {
    if (!token) return null;
    let t = token.trim().toUpperCase().replace(/,/g, '');
    let multiplier = 1;
    if (t.endsWith('K')) { multiplier = 1000; t = t.slice(0, -1); }
    else if (t.endsWith('L')) { multiplier = 100000; t = t.slice(0, -1); }
    const n = parseFloat(t);
    if (Number.isNaN(n)) return null;
    return n * multiplier;
}

/**
 * Pure regex-based parser — no LLM. Returns a structured `RegexParseOutput` with
 * a per-token confidence score that downstream can blend with the LLM output.
 */
export function regexParseSignal(rawText: string): RegexParseOutput {
    const raw = (rawText || '').toString();
    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();

    // ---- Index detection (try aliases in priority order) ----
    let index: RegexParseOutput['index'] = null;
    for (const [pattern, canonical] of INDEX_ALIASES) {
        if (pattern.test(upper)) {
            index = canonical as RegexParseOutput['index'];
            break;
        }
    }
    const indexMeta = index ? INDEX_META[index] : null;

    // ---- Option type (CE/PE/Call/Put) ----
    let type: RegexParseOutput['type'] = null;
    if (/\bCE\b/.test(upper) || /\bCALL\b/i.test(lower)) type = 'CE';
    else if (/\bPE\b/.test(upper) || /\bPUT\b/i.test(lower)) type = 'PE';

    // ---- Strike (e.g. 19500, 20200, 19,500, 19.5K) ----
    // Heuristic: a number between 1000 and 9999999 not preceded by `sl`/`tgt`/`entry`/etc.
    const strikeCandidates: number[] = [];
    const numberPattern = /\b\d{1,3}(?:[,.]\d{1,3})*(?:\.\d+)?\s*[KkLl]?\b/g;
    const allNumbers: Array<{ value: number; index: number; literal: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = numberPattern.exec(raw)) !== null) {
        const v = parseNumberToken(m[0]);
        if (v !== null && v >= 1) allNumbers.push({ value: v, index: m.index, literal: m[0] });
    }
    for (const n of allNumbers) {
        if (n.value >= 1000 && n.value <= 9999999) strikeCandidates.push(n.value);
    }
    // Prefer a number that immediately precedes a CE/PE token.
    const cePeIdx = (() => {
        const ce = upper.search(/\bCE\b|\bCALL\b/i);
        const pe = upper.search(/\bPE\b|\bPUT\b/i);
        const idx = [ce, pe].filter(i => i > 0).sort((a, b) => a - b)[0];
        return idx && idx > 0 ? idx : -1;
    })();
    let strike: number | null = null;
    if (cePeIdx > 0) {
        // Look for the closest number ending right before the CE/PE token.
        const before = allNumbers.filter(n => n.index + n.literal.length <= cePeIdx + 2 && n.index + n.literal.length >= cePeIdx - 12);
        before.sort((a, b) => (b.index + b.literal.length) - (a.index + a.literal.length));
        if (before[0]) strike = before[0].value;
    }
    if (strike === null && strikeCandidates.length > 0) {
        // Pick the first "strike-shaped" number (>= 1000) in the text.
        strike = strikeCandidates[0];
    }

    // ---- Entry price ----
    // Patterns: "Near 120", "Entry 120", "Entry: 120", "@ 120", "CMP 120", "at 120", "around 120", "ABOVE 100", "Above 150"
    let entry: number | null = null;
    const entryRegex = /\b(?:entry|near|@|cmp|at|around|level|price|lvl|above|below)\b[^0-9+-]{0,12}(\d{1,3}(?:[,.]\d{1,3})*(?:\.\d+)?\s*[KkLl]?)/i;
    const entryMatch = raw.match(entryRegex);
    if (entryMatch) {
        const v = parseNumberToken(entryMatch[1]);
        if (v !== null && v > 0) entry = v;
    }
    // Standalone "ABOVE 100" pattern (on its own line, e.g. "ABOVE 100\nTGT 115/140")
    if (entry === null) {
        const aboveAloneMatch = raw.match(/^ABOVE\s+(\d{1,5}(?:\.\d+)?)\s*$/im);
        if (aboveAloneMatch) {
            const v = parseNumberToken(aboveAloneMatch[1]);
            if (v !== null && v > 0) entry = v;
        }
    }

    // ---- Stop-Loss ----
    let sl: number | null = null;
    const slRegex = /\b(?:sl|stop[\s-]?loss|stopLoss)\b[^0-9+-]{0,12}(?:below\s+|above\s+)?(\d{1,3}(?:[,.]\d{1,3})*(?:\.\d+)?\s*[KkLl]?)/i;
    const slMatch = raw.match(slRegex);
    if (slMatch) {
        const v = parseNumberToken(slMatch[1]);
        if (v !== null && v > 0) sl = v;
    }
    // "SL NEAR BUYING PRICE" or "SL BELOW BUY PRICE" estimation (5% stop loss buffer)
    if (sl === null && /SL\s+(?:NEAR|BELOW)\s+(?:BUYING|BUY(?:ING)?)\s+PRICE/i.test(raw)) {
        if (entry !== null && entry > 0) {
            sl = Math.round(entry * 0.95 * 100) / 100;
        }
    }

    // ---- Targets ----
    // Patterns: "TGT 240/260/280", "Target 1: 240", "T1 240 T2 260", "TARGETS 240 260 280"
    const targets: number[] = [];
    // Slash-separated targets
    const slashTgtRegex = /\b(?:tgt|target|targets|t)\b\s*([0-9KkLl.,\s/]+)/i;
    const slashMatch = raw.match(slashTgtRegex);
    if (slashMatch) {
        const parts = slashMatch[1].split(/[\/]/);
        for (const p of parts) {
            const v = parseNumberToken(p);
            if (v !== null && v > 0) targets.push(v);
        }
    }
    // T1/T2/T3 style
    if (targets.length === 0) {
        const t123 = raw.matchAll(/\bT([123])\b[^0-9+-]{0,6}(\d{1,3}(?:[,.]\d{1,3})*(?:\.\d+)?\s*[KkLl]?)/gi);
        for (const tm of t123) {
            const v = parseNumberToken(tm[2]);
            if (v !== null && v > 0) targets.push(v);
        }
    }
    // "Target 1: 240" colon style
    if (targets.length === 0) {
        const colonTgt = raw.matchAll(/\b[Tt]arget\s*\d?\s*[:=]\s*(\d{1,3}(?:[,.]\d{1,3})*(?:\.\d+)?\s*[KkLl]?)/g);
        for (const tm of colonTgt) {
            const v = parseNumberToken(tm[1]);
            if (v !== null && v > 0) targets.push(v);
        }
    }

    // ---- Action ----
    // BUY / SELL with context: SELL before "PE" or below-spot is a bearish PE trade,
    // BUY before "CE" is bullish. Default BUY unless the action word is explicit.
    let action: 'BUY' | 'SELL' = 'BUY';
    if (/\bSELL\b|\bS\b\b/.test(upper)) {
        // SELL with no "PE" context still bearish by default, but try to be smart
        action = 'SELL';
    } else if (/\bBUY\b|\bB\b\b/.test(upper)) {
        action = 'BUY';
    } else {
        // Infer from option type & targets vs entry
        if (type === 'PE' && entry !== null && sl !== null && sl < entry) action = 'SELL';
        else if (type === 'CE' && entry !== null && sl !== null && sl < entry) action = 'BUY';
    }

    // ---- Expiry ----
    let expiryText: string | null = null;
    let expiryDate: string | null = null;
    // Explicit dates win.
    const explicitMatch = raw.match(/\b\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b(?:\s*\d{2,4})?/i)
        || raw.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/);
    if (explicitMatch) {
        expiryText = explicitMatch[0];
        expiryDate = parseExplicitExpiry(explicitMatch[0]);
    } else if (/\bweekly\b|\bnext\s*week\b|\bnext\s*expiry\b/i.test(lower)) {
        expiryText = /\bnext\s*week\b|\bnext\s*expiry\b/i.test(lower) ? 'next week' : 'weekly';
        expiryDate = resolveWeeklyExpiry(index);
    }

    // ---- Equity Cash Scrip detection if not an index ----
    let equitySymbol: string | null = null;
    if (!index) {
        // Match stock symbol following BUY/SELL or standalone e.g. "BUY SBIN CMP 820" or "RELIANCE 3000 CE"
        const stockRegex = /\b(?:BUY|SELL|LONG|SHORT)\s+([A-Z]{2,12})\b/i;
        const stockMatch = raw.match(stockRegex);
        if (stockMatch && !['CE', 'PE', 'CALL', 'PUT', 'NOW', 'TODAY', 'TARGET', 'SL', 'CMP', 'ABOVE', 'BELOW', 'OPTION', 'STOCK'].includes(stockMatch[1].toUpperCase())) {
            equitySymbol = stockMatch[1].toUpperCase();
        } else {
            // Check for stock preceding CE/PE e.g. "TCS 4200 CE"
            const stockOptionRegex = /\b([A-Z]{2,12})\s+\d{2,6}\s*(?:CE|PE)\b/i;
            const soMatch = raw.match(stockOptionRegex);
            if (soMatch && !['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'].includes(soMatch[1].toUpperCase())) {
                equitySymbol = soMatch[1].toUpperCase();
            }
        }
    }

    // ---- Confidence ----
    // Weight: index/stock=0.25, type=0.20, strike=0.15, entry=0.15, sl=0.10, targets=0.10, action=0.05
    const parts: Array<[boolean, number]> = [
        [!!index || !!equitySymbol, 0.25],
        [!!type, 0.20],
        [strike !== null, 0.15],
        [entry !== null, 0.15],
        [sl !== null, 0.10],
        [targets.length > 0, 0.10],
        [!!explicitMatch || !!expiryDate, 0.05],
    ];
    let confidence = 0;
    for (const [ok, w] of parts) if (ok) confidence += w;
    // Sanity caps
    if (!index && !equitySymbol && !type && strike === null) confidence = Math.min(confidence, 0.35);

    // ---- Product / Exchange defaults ----
    const productType: ParsedSignal['productType'] = equitySymbol && !type ? 'CNC' : (indexMeta?.productType ?? 'MARGIN');
    const exchangeSegment: ParsedSignal['exchangeSegment'] = equitySymbol && !type ? 'NSE_EQ' : (indexMeta?.segment ?? 'NSE_FNO');

    // ---- Build trading symbol ----
    let tradingSymbol = '';
    if (index && strike !== null && type) {
        tradingSymbol = `${index} ${strike} ${type}${expiryDate ? ` ${expiryDate.replace(/-/g, ' ')}` : ''}`.trim();
    } else if (equitySymbol) {
        tradingSymbol = strike !== null && type ? `${equitySymbol} ${strike} ${type}` : equitySymbol;
    }

    return {
        index,
        equitySymbol,
        action,
        strike,
        type,
        entry,
        sl,
        targets,
        expiryText,
        expiryDate,
        productType,
        exchangeSegment,
        confidence,
        raw,
        tradingSymbol,
    };
}

/**
 * Combine LLM (text-only) parse and regex parse into a final ParsedSignal.
 * When `ocr` is provided, the OCR word-level confidence is used to weight the
 * final blend so noisy OCR text lowers the overall confidence.
 */
function combineParseResults(
    llm: ParsedSignal | null,
    regex: RegexParseOutput & { equitySymbol?: string | null; tradingSymbol?: string },
    ocr?: OCRResult | null
): ParsedSignal {
    // Pick the better of the two for each field. Regex wins on numeric fields
    // when the LLM returned 0/undefined or when the LLM did not parse at all.
    const useLlmNumbers = !!(llm && llm.confidence > 0.5);

    const action: 'BUY' | 'SELL' = (llm?.action as 'BUY' | 'SELL') || regex.action || 'BUY';
    const suggestedEntryPrice = useLlmNumbers
        ? (llm!.suggestedEntryPrice || regex.entry || 0)
        : (regex.entry || llm?.suggestedEntryPrice || 0);
    const stopLoss = useLlmNumbers
        ? (llm!.stopLoss || regex.sl || 0)
        : (regex.sl || llm?.stopLoss || 0);
    const targets = useLlmNumbers
        ? ((llm!.targets && llm!.targets.length > 0) ? llm!.targets : regex.targets)
        : ((regex.targets.length > 0) ? regex.targets : (llm?.targets || []));

    const tradingSymbol = llm?.tradingSymbol && llm.tradingSymbol.length > 2 && !llm.tradingSymbol.toUpperCase().includes('UNKNOWN')
        ? llm.tradingSymbol
        : (regex.tradingSymbol || (regex.index && regex.strike && regex.type
            ? `${regex.index} ${regex.strike} ${regex.type}${regex.expiryDate ? ` ${regex.expiryDate}` : ''}`.trim()
            : (regex.equitySymbol || llm?.tradingSymbol || '')));

    // Confidence blend
    const llmConf = llm?.confidence ?? 0;
    const regexConf = regex.confidence;
    let conf = Math.max(llmConf, regexConf * 0.95);

    // OCR weighting: if mean word confidence is low, dampen the overall confidence.
    if (ocr && ocr.words && ocr.words.length > 0) {
        const meanWordConf = ocr.words.reduce((a, w) => a + (w.confidence || 0), 0) / ocr.words.length;
        const ocrWeight = Math.max(0.3, Math.min(1, meanWordConf));
        conf = conf * ocrWeight;
    }
    // If regex didn't find much and LLM did not parse, give a low base.
    if (conf < 0.15) conf = 0.15;
    conf = parseFloat(Math.max(0, Math.min(1, conf)).toFixed(2));

    return {
        rawSignal: regex.raw,
        confidence: conf,
        action,
        tradingSymbol,
        suggestedEntryPrice,
        stopLoss,
        targets,
        productType: regex.productType,
        exchangeSegment: regex.exchangeSegment,
        expiryDate: regex.expiryDate ?? undefined,
    };
}

export const TelegramSignalParser = {
    /**
     * Parses unstructured Telegram text via Groq and converts it to a structured signal.
     * If the LLM call fails or returns nothing, falls back to the pure-regex parser.
     * When `ocr` is passed, the OCR-derived word confidences are used to weight
     * the final combined confidence.
     */
    async parseRawSignal(rawText: string, ocr?: OCRResult | null): Promise<ParsedSignal | null> {
        const regex = regexParseSignal(rawText);
        if (!regex.raw || regex.raw.length < 3) return null;

        let llm: ParsedSignal | null = null;
        try {
            // Use fastest model for instant parsing
            const responseText = await chatWithGroq(
                'llama-3.1-8b-instant',
                [],
                `Parse this signal: ${rawText}`,
                PARSING_SYSTEM_PROMPT
            );

            // Clean any potential markdown wrapper around JSON
            const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(cleanJsonString);

            if (data.error) {
                logger.warn('TelegramSignalParser: Could not parse signal', rawText);
            } else {
                llm = {
                    rawSignal: rawText,
                    confidence: 0.9,
                    action: data.action || 'BUY',
                    tradingSymbol: data.tradingSymbol || '',
                    suggestedEntryPrice: Number(data.suggestedEntryPrice) || 0,
                    stopLoss: Number(data.stopLoss) || 0,
                    targets: Array.isArray(data.targets) ? data.targets.map(Number) : [],
                    productType: data.productType || regex.productType,
                    exchangeSegment: data.exchangeSegment || regex.exchangeSegment,
                };
            }
        } catch (error) {
            logger.warn('TelegramSignalParser: LLM JSON parsing failed, falling back to regex', error);
        }

        const final = combineParseResults(llm, regex, ocr);
        // If neither parser got anything useful, return null
        if (!final.tradingSymbol && !final.suggestedEntryPrice && final.targets.length === 0) {
            return null;
        }
        return final;
    },

    /**
     * Regex-only parse — no LLM. Useful as a fast pre-filter or as a fallback
     * when the LLM is offline.
     */
    parseSignalRegexOnly(rawText: string): ParsedSignal | null {
        const regex = regexParseSignal(rawText);
        const final = combineParseResults(null, regex, null);
        if (!final.tradingSymbol && !final.suggestedEntryPrice && final.targets.length === 0) {
            return null;
        }
        return final;
    },

    /**
     * Converts a Parsed Signal into a Dhan Order Request.
     * Note: This requires the correct generic Dhan Security ID mappings.
     */
    toDhanOrderRequest(signal: ParsedSignal, quantity: number = 15): DhanOrderRequest {
        // Resolve security ID
        const resolvedId = DhanScripResolver.resolveSecurityId(signal.tradingSymbol);

        // Normalize exchangeSegment and productType
        let finalExchangeSegment: any = signal.exchangeSegment || 'NSE_FNO';
        if (finalExchangeSegment === 'NSE') finalExchangeSegment = 'NSE_EQ';
        if (finalExchangeSegment !== 'NSE_EQ' && finalExchangeSegment !== 'NSE_FNO' && finalExchangeSegment !== 'BSE_EQ' && finalExchangeSegment !== 'MCX_COMM') {
            finalExchangeSegment = 'NSE_EQ';
        }

        let finalProductType: any = signal.productType || 'MARGIN';
        if (finalProductType === 'EQUITY' || finalProductType === 'CNC_DELIVERY') {
            finalProductType = 'CNC';
        }
        if (finalProductType !== 'CNC' && finalProductType !== 'INTRADAY' && finalProductType !== 'MARGIN' && finalProductType !== 'MTF' && finalProductType !== 'CO' && finalProductType !== 'BO') {
            finalProductType = (finalExchangeSegment === 'NSE_EQ' || finalExchangeSegment === 'BSE_EQ') ? 'CNC' : 'MARGIN';
        }

        return {
            dhanClientId: 'YOUR_CLIENT_ID', // Replaced correctly at execution layer
            transactionType: signal.action,
            exchangeSegment: finalExchangeSegment,
            productType: finalProductType,
            orderType: signal.suggestedEntryPrice > 0 ? 'LIMIT' : 'MARKET',
            validity: 'DAY',
            tradingSymbol: signal.tradingSymbol,
            securityId: resolvedId || '0', // Fallback to 0, which will fail if executed
            quantity: quantity,
            disclosedQuantity: 0,
            price: signal.suggestedEntryPrice,
            triggerPrice: 0,
            afterMarketOrder: false
        };
    },

    /**
     * Parses a lifecycle keyword or event from signal text updates.
     */
    parseLifecycleAction(text: string): LifecycleAction | null {
        const textUpper = text.toUpperCase();

        // 1. Book Profit / Partial Exit
        if (/(HALF BOOK|PARTIAL|BOOK KRO|BOOK PARTIAL|BOOK PROFIT|SMALL WALE FOCUS|2ND TGT HIT)/i.test(textUpper)) {
            return { action: 'BOOK_PROFIT', rawText: text };
        }
        // 2. Full Exit / Close / Momentum Stall
        if (/(EXIT|CLOSE|SL HIT|STOPLOSS HIT|EXIT NOW|SQUARE OFF|DONE OF THE DAY|CE CAN EXIT|PE CAN EXIT|JACKPOT DAY CLOSE|MARKET NEAR CLOSE|FOCUS ON SMALL|CLOSE ON SMALL|IF U DONT WANT TO RISK)/i.test(textUpper)) {
            return { action: 'FULL_EXIT', rawText: text };
        }
        // 3. Target Hit
        if (/(TGT HIT|TARGET HIT|🎯|T1|T2|T3|TARGET1|TARGET2|TARGET3|TGT1|TGT2|TGT3|1ST TGT|2ND TGT)/i.test(textUpper)) {
            return { action: 'TARGET_HIT', rawText: text };
        }
        // 4. Modify SL / Trailing / Cost
        if (/(MODIFY SL|MOVE SL|SL MODIFY|TRAIL SL|SL TRAIL|SAFE ZONE|TRAIL KARTE JAO|SL NEAR BUYING|SL ABOVE BUYING|SL USE NEAR|SL COST|SAFE TRADER)/i.test(textUpper)) {
            // Check if there is a number for the new SL
            const match = textUpper.match(/(?:SL|STOPLOSS)\s*(?:TO|@|AT|=)?\s*(\d+(?:\.\d+)?)/i);
            const newValue = match ? parseFloat(match[1]) : undefined;
            return { action: 'MODIFY_SL', newValue, rawText: text };
        }
        // 5. Re-Entry Gate
        if (/(AGAIN PLAN|ABOVE HIGH AGAIN|NEAR SAME RANGE AGAIN|ABOVE LAST SWING HIGH)/i.test(textUpper)) {
            return { action: 'RE_ENTRY', rawText: text };
        }

        return null;
    },

    /**
     * Build confidence score dynamically based on provider history.
     */
    async buildConfidenceScore(signal: ParsedSignal, providerName: string): Promise<number> {
        try {
            const provider = await db.signal_providers.where('name').equalsIgnoreCase(providerName).first();
            if (!provider) return 0.7; // default base confidence

            const winRate = provider.winRate || 0.5;
            const winRateBonus = Math.max(-0.2, Math.min(0.2, (winRate - 0.5) * 0.4));

            const rr = provider.avgRR || 1.5;
            const rrBonus = Math.max(-0.1, Math.min(0.1, (rr - 1.5) * 0.1));

            return parseFloat((Math.max(0.1, Math.min(1.0, 0.7 + winRateBonus + rrBonus)).toFixed(2)));
        } catch (e) {
            logger.error('Error building confidence score:', e);
            return 0.7;
        }
    },

    /**
     * Parse expiry date from instrument string, e.g. "BANKNIFTY 7 JUN 47500 CE" -> "2026-06-07"
     */
    parseExpiry(instrumentString: string): string | null {
        return parseExplicitExpiry(instrumentString);
    },

    /**
     * Index-specific weekly expiry resolver.
     * For "weekly" or when the parsed signal has no explicit date, the next
     * index-specific expiry weekday is returned.
     * NIFTY=Thu, BANKNIFTY=Wed, FINNIFTY=Tue, MIDCPNIFTY=Mon, SENSEX=Fri.
     */
    resolveWeeklyExpiry,
};
