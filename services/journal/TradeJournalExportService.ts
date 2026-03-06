/**
 * TradeJournalExportService.ts
 * Exhaustive Trade Journal Export & Restore Service for WealthOS.
 * 
 * Provides:
 * 1. Machine-Readable Export (.json): Normalized JSON with metadata, SHA-256 checksum,
 *    and an embedded AI summary header for external AI agent analysis and 1-click device migration.
 * 2. Human-Readable Export (.html & .csv): Standalone offline visual HTML dossier with
 *    interactive SVG equity curve, filterable trade ledger, and printable PDF styling, plus Excel CSV.
 * 3. 1-Click Restore: Validates and bulk-puts exported trade journal tables into Dexie with 0 schema conflicts.
 */

import { db, Trade, DailyReview, Mistake, Strategy, MirrorRule, MissedTrade, calculatePnL } from '../../database';
import { logger } from '../Logger';

export interface TradeJournalDataPackage {
    trades: Trade[];
    sandboxTrades: Trade[];
    dailyReviews: DailyReview[];
    mistakes: Mistake[];
    missedTrades: MissedTrade[];
    strategies: Strategy[];
    mirrorRules: MirrorRule[];
    tradeLegs: any[];
    sharedJournal: any[];
    voiceSessions: any[];
}

export interface TradeJournalAiSummary {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    scratchTrades: number;
    winRate: number;
    netPnL: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number;
    maxDrawdown: number;
    averageTradePnL: number;
    totalMistakeCost: number;
    mistakeCount: number;
    topMistakes: { title: string; cost: number; count: number }[];
    activeStrategies: string[];
    averageDisciplineRating: number;
    dateRange: { start: string; end: string };
}

export interface TradeJournalExportPayload {
    $schema: string;
    meta: {
        app: 'WealthOS';
        module: 'TradeJournal';
        exportVersion: string;
        exportedAt: string;
        checksum?: string;
        counts: Record<string, number>;
        aiSummary: TradeJournalAiSummary;
    };
    data: TradeJournalDataPackage;
    preferences: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256Hex(text: string): Promise<string> {
    try {
        if (typeof crypto === 'undefined' || !crypto.subtle) return '';
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return '';
    }
}

const safeFetchTable = async <T>(tableName: string): Promise<T[]> => {
    try {
        const table = db.table<T>(tableName);
        if (!table) return [];
        const rows = await table.toArray();
        return (rows || []).filter((r: any) => !r.isDeleted);
    } catch (e) {
        logger.warn(`[TradeJournalExport] Failed to query table "${tableName}"`, e);
        return [];
    }
};

const triggerDownload = (content: string, fileName: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 200);
};

const formatCurrencyINR = (num: number): string => {
    const sign = num < 0 ? '-' : '';
    const abs = Math.abs(num);
    return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

// ---------------------------------------------------------------------------
// Data Gathering & Analytics
// ---------------------------------------------------------------------------

export const gatherTradeJournalData = async (): Promise<TradeJournalDataPackage> => {
    const [
        trades,
        sandboxTrades,
        dailyReviews,
        mistakes,
        missedTrades,
        strategies,
        mirrorRules,
        tradeLegs,
        sharedJournal,
        voiceSessions
    ] = await Promise.all([
        safeFetchTable<Trade>('trades'),
        safeFetchTable<Trade>('sandbox_trades'),
        safeFetchTable<DailyReview>('daily_reviews'),
        safeFetchTable<Mistake>('mistakes'),
        safeFetchTable<MissedTrade>('missed_trades'),
        safeFetchTable<Strategy>('strategies'),
        safeFetchTable<MirrorRule>('mirror_rules'),
        safeFetchTable<any>('trade_legs'),
        safeFetchTable<any>('shared_journal'),
        safeFetchTable<any>('voice_sessions'),
    ]);

    return {
        trades,
        sandboxTrades,
        dailyReviews,
        mistakes,
        missedTrades,
        strategies,
        mirrorRules,
        tradeLegs,
        sharedJournal,
        voiceSessions,
    };
};

export const computeAiSummary = (data: TradeJournalDataPackage): TradeJournalAiSummary => {
    const allTrades = [...data.trades].map(t => ({
        ...t,
        pnl: calculatePnL(t)
    }));

    let grossProfit = 0;
    let grossLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let scratchTrades = 0;

    let peakEquity = 0;
    let currentEquity = 0;
    let maxDrawdown = 0;

    // Sort chronologically for equity curve analysis
    const sortedTrades = [...allTrades].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    sortedTrades.forEach(t => {
        const pnl = t.pnl || 0;
        currentEquity += pnl;
        if (currentEquity > peakEquity) {
            peakEquity = currentEquity;
        }
        const dd = currentEquity - peakEquity;
        if (dd < maxDrawdown) {
            maxDrawdown = dd;
        }

        if (pnl > 0) {
            grossProfit += pnl;
            winningTrades++;
        } else if (pnl < 0) {
            grossLoss += Math.abs(pnl);
            losingTrades++;
        } else {
            scratchTrades++;
        }
    });

    const totalTrades = allTrades.length;
    const netPnL = grossProfit - grossLoss;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 0;
    const averageTradePnL = totalTrades > 0 ? netPnL / totalTrades : 0;

    // Mistake Analytics
    const mistakeMap: Record<string, { cost: number; count: number }> = {};
    let totalMistakeCost = 0;

    data.mistakes.forEach(m => {
        const cost = m.cost || 0;
        totalMistakeCost += cost;
        const key = m.title || 'Uncategorized';
        if (!mistakeMap[key]) {
            mistakeMap[key] = { cost: 0, count: 0 };
        }
        mistakeMap[key].cost += cost;
        mistakeMap[key].count += 1;
    });

    const topMistakes = Object.entries(mistakeMap)
        .map(([title, stats]) => ({ title, cost: stats.cost, count: stats.count }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

    // Discipline Ratings
    const validReviews = data.dailyReviews.filter(r => typeof r.rating === 'number' && r.rating > 0);
    const avgDiscipline = validReviews.length > 0
        ? validReviews.reduce((sum, r) => sum + r.rating, 0) / validReviews.length
        : 0;

    const dates = sortedTrades.map(t => t.date).filter(Boolean);
    const dateRange = {
        start: dates[0] || 'N/A',
        end: dates[dates.length - 1] || 'N/A'
    };

    const activeStrategies = data.strategies.filter(s => s.isActive !== false).map(s => s.name);

    return {
        totalTrades,
        winningTrades,
        losingTrades,
        scratchTrades,
        winRate: Math.round(winRate * 10) / 10,
        netPnL: Math.round(netPnL * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossLoss: Math.round(grossLoss * 100) / 100,
        profitFactor: Math.round(profitFactor * 100) / 100,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        averageTradePnL: Math.round(averageTradePnL * 100) / 100,
        totalMistakeCost: Math.round(totalMistakeCost * 100) / 100,
        mistakeCount: data.mistakes.length,
        topMistakes,
        activeStrategies,
        averageDisciplineRating: Math.round(avgDiscipline * 10) / 10,
        dateRange
    };
};

export const gatherTradingPreferences = (): Record<string, any> => {
    const prefs: Record<string, any> = {};
    const relevantKeys = [
        'trading-journal-prefs',
        'cosmic-governor-storage',
        'isSandboxMode',
        'pre-trade-checklist-custom'
    ];
    relevantKeys.forEach(k => {
        try {
            const val = localStorage.getItem(k);
            if (val) {
                try {
                    prefs[k] = JSON.parse(val);
                } catch {
                    prefs[k] = val;
                }
            }
        } catch {
            // Ignore storage access errors
        }
    });
    return prefs;
};

// ---------------------------------------------------------------------------
// 1. Machine-Readable Export (.json)
// ---------------------------------------------------------------------------

export const exportMachineReadableJSON = async (): Promise<{ fileName: string; counts: Record<string, number> }> => {
    const data = await gatherTradeJournalData();
    const aiSummary = computeAiSummary(data);
    const preferences = gatherTradingPreferences();

    const counts: Record<string, number> = {
        trades: data.trades.length,
        sandboxTrades: data.sandboxTrades.length,
        dailyReviews: data.dailyReviews.length,
        mistakes: data.mistakes.length,
        missedTrades: data.missedTrades.length,
        strategies: data.strategies.length,
        mirrorRules: data.mirrorRules.length,
        tradeLegs: data.tradeLegs.length,
        sharedJournal: data.sharedJournal.length,
        voiceSessions: data.voiceSessions.length,
    };

    const payload: TradeJournalExportPayload = {
        $schema: 'https://wealthos.dev/schemas/trade-journal-v1.json',
        meta: {
            app: 'WealthOS',
            module: 'TradeJournal',
            exportVersion: '1.0.0',
            exportedAt: new Date().toISOString(),
            counts,
            aiSummary
        },
        data,
        preferences
    };

    const rawJson = JSON.stringify(payload, null, 2);
    const checksum = await sha256Hex(rawJson);
    payload.meta.checksum = checksum;

    const finalJson = JSON.stringify(payload, null, 2);
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `wealthos_trade_journal_${dateStr}.json`;

    triggerDownload(finalJson, fileName, 'application/json');
    logger.info(`[TradeJournalExport] Machine-readable JSON exported successfully: ${fileName}`);
    return { fileName, counts };
};

// ---------------------------------------------------------------------------
// 2. Human-Readable Export (.html Standalone Visual Dossier)
// ---------------------------------------------------------------------------

export const exportHumanReadableHTML = async (): Promise<{ fileName: string; tradeCount: number }> => {
    const data = await gatherTradeJournalData();
    const aiSummary = computeAiSummary(data);
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `wealthos_trade_journal_dossier_${dateStr}.html`;

    const allTrades = [...data.trades].map(t => ({
        ...t,
        pnl: calculatePnL(t)
    })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Build SVG Equity Curve
    const chronologicalTrades = [...allTrades].reverse();
    let runningPnL = 0;
    const equityPoints: { date: string; pnl: number }[] = [{ date: 'Start', pnl: 0 }];
    chronologicalTrades.forEach(t => {
        runningPnL += (t.pnl || 0);
        equityPoints.push({ date: t.date || '', pnl: runningPnL });
    });

    const svgWidth = 800;
    const svgHeight = 220;
    const pnlValues = equityPoints.map(p => p.pnl);
    const minPnl = Math.min(0, ...pnlValues);
    const maxPnl = Math.max(1, ...pnlValues);
    const pnlRange = maxPnl - minPnl || 1;

    const polylineCoords = equityPoints.map((p, idx) => {
        const x = Math.round((idx / Math.max(1, equityPoints.length - 1)) * (svgWidth - 40)) + 20;
        const normalizedY = (p.pnl - minPnl) / pnlRange;
        const y = Math.round(svgHeight - 30 - normalizedY * (svgHeight - 60));
        return `${x},${y}`;
    }).join(' ');

    const zeroLineY = Math.round(svgHeight - 30 - ((0 - minPnl) / pnlRange) * (svgHeight - 60));

    // Construct self-contained HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WealthOS Trade Journal Dossier - ${dateStr}</title>
    <style>
        :root {
            --bg-base: #090A10;
            --bg-card: #111422;
            --bg-elevated: #181C30;
            --border: rgba(255, 255, 255, 0.08);
            --border-highlight: rgba(99, 102, 241, 0.3);
            --text-main: #F8FAFC;
            --text-muted: #94A3B8;
            --accent: #6366F1;
            --profit: #10B981;
            --loss: #F43F5E;
            --warning: #F59E0B;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-base);
            color: var(--text-main);
            line-height: 1.5;
            padding: 32px 24px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-b: 1px solid var(--border);
            padding-bottom: 24px;
            margin-bottom: 32px;
            flex-wrap: wrap;
            gap: 16px;
        }
        .logo-title h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
        .logo-title h1 span { color: var(--accent); }
        .logo-title p { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-top: 4px; }
        .export-meta { text-align: right; font-size: 12px; color: var(--text-muted); }
        .export-meta strong { color: var(--text-main); }
        
        /* KPI Cards */
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
            gap: 16px;
            margin-bottom: 32px;
        }
        .kpi-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 14px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        .kpi-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-weight: 700; margin-bottom: 8px; }
        .kpi-card .value { font-size: 22px; font-weight: 800; font-family: monospace; }
        .kpi-card .sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .profit-text { color: var(--profit); }
        .loss-text { color: var(--loss); }
        .accent-text { color: var(--accent); }

        /* Chart Section */
        .section-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 32px;
        }
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .section-header h2 { font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
        .chart-container { width: 100%; overflow-x: auto; background: var(--bg-elevated); border-radius: 12px; padding: 12px; border: 1px solid var(--border); }

        /* Tables */
        .table-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            gap: 12px;
            flex-wrap: wrap;
        }
        .search-box {
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            color: var(--text-main);
            padding: 8px 14px;
            border-radius: 10px;
            font-size: 13px;
            width: 260px;
            outline: none;
        }
        .search-box:focus { border-color: var(--accent); }
        .table-responsive { width: 100%; overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
        th {
            background: var(--bg-elevated);
            color: var(--text-muted);
            padding: 10px 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-size: 10px;
            border-bottom: 1px solid var(--border);
        }
        td { padding: 12px; border-bottom: 1px solid var(--border); font-family: -apple-system, sans-serif; }
        tr:hover td { background: rgba(255, 255, 255, 0.02); }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 6px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            font-family: monospace;
        }
        .badge-long { background: rgba(16, 185, 129, 0.15); color: var(--profit); border: 1px solid rgba(16, 185, 129, 0.3); }
        .badge-short { background: rgba(244, 63, 94, 0.15); color: var(--loss); border: 1px solid rgba(244, 63, 94, 0.3); }
        .badge-neutral { background: rgba(255, 255, 255, 0.08); color: var(--text-muted); }

        /* Mistakes & Playbooks Grid */
        .dual-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 24px; }
        .item-card {
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 12px;
        }
        .item-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .item-card-header h3 { font-size: 13px; font-weight: 700; }
        .cost-badge { color: var(--loss); font-family: monospace; font-weight: 800; font-size: 12px; }
        .item-lesson { font-size: 12px; color: var(--text-muted); line-height: 1.4; }

        @media print {
            body { background: #FFFFFF; color: #000000; padding: 0; }
            .kpi-card, .section-card, .chart-container, .item-card, th { background: #FAFAFA !important; border: 1px solid #CCCCCC !important; color: #000000 !important; }
            .search-box { display: none; }
            polyline { stroke: #000000 !important; }
            .profit-text { color: #059669 !important; }
            .loss-text { color: #DC2626 !important; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <div class="logo-title">
                <h1>Wealth<span>OS</span> Trading Journal Dossier</h1>
                <p>Executive Performance & Psychological Audit</p>
            </div>
            <div class="export-meta">
                <div>Export Date: <strong>${dateStr}</strong></div>
                <div>Coverage: <strong>${aiSummary.dateRange.start}</strong> to <strong>${aiSummary.dateRange.end}</strong></div>
                <div>Total Database Records: <strong>${allTrades.length} Trades · ${data.mistakes.length} Mistakes</strong></div>
            </div>
        </div>

        <!-- KPI Grid -->
        <div class="kpi-grid">
            <div class="kpi-card">
                <span class="label">Net Realized PnL</span>
                <span class="value ${aiSummary.netPnL >= 0 ? 'profit-text' : 'loss-text'}">${formatCurrencyINR(aiSummary.netPnL)}</span>
                <span class="sub">Gross: ${formatCurrencyINR(aiSummary.grossProfit)}</span>
            </div>
            <div class="kpi-card">
                <span class="label">Win Rate</span>
                <span class="value accent-text">${aiSummary.winRate}%</span>
                <span class="sub">${aiSummary.winningTrades}W / ${aiSummary.losingTrades}L / ${aiSummary.scratchTrades}S</span>
            </div>
            <div class="kpi-card">
                <span class="label">Profit Factor</span>
                <span class="value ${aiSummary.profitFactor >= 1.5 ? 'profit-text' : 'accent-text'}">${aiSummary.profitFactor}</span>
                <span class="sub">Max DD: ${formatCurrencyINR(aiSummary.maxDrawdown)}</span>
            </div>
            <div class="kpi-card">
                <span class="label">Total Trades</span>
                <span class="value">${aiSummary.totalTrades}</span>
                <span class="sub">Avg: ${formatCurrencyINR(aiSummary.averageTradePnL)} / trade</span>
            </div>
            <div class="kpi-card">
                <span class="label">Mistake Leakage</span>
                <span class="value loss-text">${formatCurrencyINR(aiSummary.totalMistakeCost)}</span>
                <span class="sub">${aiSummary.mistakeCount} Logged Mistakes</span>
            </div>
            <div class="kpi-card">
                <span class="label">Discipline Score</span>
                <span class="value accent-text">${aiSummary.averageDisciplineRating} / 5.0</span>
                <span class="sub">${data.dailyReviews.length} Daily Reviews</span>
            </div>
        </div>

        <!-- Cumulative Equity Curve SVG -->
        <div class="section-card">
            <div class="section-header">
                <h2>Cumulative Equity Progression Curve</h2>
                <span style="font-size: 12px; color: var(--text-muted);">Baseline Zero Line Included</span>
            </div>
            <div class="chart-container">
                <svg width="100%" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="none">
                    <!-- Zero Axis Line -->
                    <line x1="10" y1="${zeroLineY}" x2="${svgWidth - 10}" y2="${zeroLineY}" stroke="rgba(255,255,255,0.15)" stroke-dasharray="4" stroke-width="1" />
                    <text x="15" y="${zeroLineY - 6}" fill="rgba(255,255,255,0.4)" font-size="10" font-family="monospace">₹0 Baseline</text>
                    <!-- Equity Polyline -->
                    <polyline fill="none" stroke="${aiSummary.netPnL >= 0 ? '#10B981' : '#F43F5E'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${polylineCoords}" />
                </svg>
            </div>
        </div>

        <!-- Master Trade Ledger Table -->
        <div class="section-card">
            <div class="table-controls">
                <h2>Master Trade Ledger (${allTrades.length} Trades)</h2>
                <input type="text" id="tradeSearchInput" class="search-box" placeholder="Filter by Ticker, Setup, Mood..." onkeyup="filterTradesTable()">
            </div>
            <div class="table-responsive">
                <table id="tradesTable">
                    <thead>
                        <tr>
                            <th>Date / Time</th>
                            <th>Ticker</th>
                            <th>Side</th>
                            <th>Qty</th>
                            <th>Entry</th>
                            <th>Exit</th>
                            <th>Net PnL</th>
                            <th>Setup</th>
                            <th>Mood</th>
                            <th>Mistakes</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allTrades.map(t => {
                            const pnl = t.pnl || 0;
                            const isWin = pnl > 0;
                            const isLoss = pnl < 0;
                            const side = (t.direction || 'Long').toUpperCase();
                            return `<tr>
                                <td style="white-space:nowrap; font-family: monospace;">${t.date || ''} ${t.entryTime || ''}</td>
                                <td style="font-weight: 700; font-family: monospace;">${t.ticker || ''}</td>
                                <td><span class="badge ${side === 'LONG' ? 'badge-long' : 'badge-short'}">${side}</span></td>
                                <td style="font-family: monospace;">${t.quantity || 0}</td>
                                <td style="font-family: monospace;">₹${(t.entryPrice || 0).toLocaleString('en-IN')}</td>
                                <td style="font-family: monospace;">₹${(t.exitPrice || 0).toLocaleString('en-IN')}</td>
                                <td style="font-weight: 800; font-family: monospace;" class="${isWin ? 'profit-text' : isLoss ? 'loss-text' : ''}">
                                    ${formatCurrencyINR(pnl)}
                                </td>
                                <td><span class="badge badge-neutral">${t.setup || 'General'}</span></td>
                                <td>${t.moodEntry || '-'} &rarr; ${t.moodExit || '-'}</td>
                                <td style="color: var(--loss);">${(t.mistakes || []).join(', ') || '-'}</td>
                                <td style="color: var(--text-muted); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.notes || '-'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Dual Grid: Mirror of Truth & Daily Reviews -->
        <div class="dual-grid">
            <!-- Mistakes / Mirror of Truth -->
            <div class="section-card">
                <div class="section-header">
                    <h2>Mirror of Truth: Logged Mistakes (${data.mistakes.length})</h2>
                </div>
                ${data.mistakes.length === 0 ? '<p style="color: var(--text-muted); font-size: 13px;">No mistakes logged in Mirror of Truth.</p>' : ''}
                ${data.mistakes.map(m => `
                    <div class="item-card">
                        <div class="item-card-header">
                            <h3>${m.title || 'Untitled Mistake'}</h3>
                            <span class="cost-badge">${formatCurrencyINR(m.cost || 0)}</span>
                        </div>
                        <p class="item-lesson"><strong>Lesson:</strong> ${m.lesson || 'No lesson recorded'}</p>
                        ${m.actionItems && m.actionItems.length > 0 ? `<p class="item-lesson" style="margin-top: 4px; color: var(--accent);"><strong>Action:</strong> ${m.actionItems.join('; ')}</p>` : ''}
                    </div>
                `).join('')}
            </div>

            <!-- Playbook Strategies -->
            <div class="section-card">
                <div class="section-header">
                    <h2>Playbook Strategies (${data.strategies.length})</h2>
                </div>
                ${data.strategies.length === 0 ? '<p style="color: var(--text-muted); font-size: 13px;">No strategies defined in playbook.</p>' : ''}
                ${data.strategies.map(s => `
                    <div class="item-card">
                        <div class="item-card-header">
                            <h3>${s.name}</h3>
                            <span class="badge ${s.isActive !== false ? 'badge-long' : 'badge-neutral'}">${s.isActive !== false ? 'ACTIVE' : 'INACTIVE'}</span>
                        </div>
                        ${s.description ? `<p class="item-lesson" style="margin-bottom: 6px;">${s.description}</p>` : ''}
                        ${s.rules && s.rules.length > 0 ? `
                            <ul style="padding-left: 18px; font-size: 11px; color: var(--text-muted); line-height: 1.5;">
                                ${s.rules.map(r => `<li>${r}</li>`).join('')}
                            </ul>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    </div>

    <!-- Client-side Search Script -->
    <script>
        function filterTradesTable() {
            var input = document.getElementById("tradeSearchInput");
            var filter = input.value.toUpperCase();
            var table = document.getElementById("tradesTable");
            var tr = table.getElementsByTagName("tr");
            for (var i = 1; i < tr.length; i++) {
                var text = tr[i].textContent || tr[i].innerText;
                if (text.toUpperCase().indexOf(filter) > -1) {
                    tr[i].style.display = "";
                } else {
                    tr[i].style.display = "none";
                }
            }
        }
    </script>
</body>
</html>`;

    triggerDownload(html, fileName, 'text/html');
    logger.info(`[TradeJournalExport] Human-readable HTML exported successfully: ${fileName}`);
    return { fileName, tradeCount: allTrades.length };
};

// ---------------------------------------------------------------------------
// 3. Human-Readable CSV Export (.csv)
// ---------------------------------------------------------------------------

export const exportCSV = async (): Promise<{ fileName: string; tradeCount: number }> => {
    const data = await gatherTradeJournalData();
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `wealthos_trades_${dateStr}.csv`;

    const allTrades = [...data.trades].map(t => ({
        ...t,
        pnl: calculatePnL(t)
    })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const headers = [
        'ID',
        'Date',
        'Entry Time',
        'Exit Time',
        'Ticker',
        'Direction',
        'Asset Class',
        'Quantity',
        'Entry Price',
        'Exit Price',
        'Stop Loss',
        'Take Profit',
        'Net PnL',
        'Setup',
        'Grade',
        'Mood Entry',
        'Mood Exit',
        'Mistakes',
        'Compliance Score',
        'Risk Reward Ratio',
        'Notes',
        'Source'
    ];

    const escapeCsv = (str: any): string => {
        if (str === null || str === undefined) return '';
        const s = String(str).replace(/"/g, '""');
        return `"${s}"`;
    };

    const rows = allTrades.map(t => [
        t.id ?? '',
        escapeCsv(t.date || ''),
        escapeCsv(t.entryTime || ''),
        escapeCsv(t.exitTime || ''),
        escapeCsv(t.ticker || ''),
        escapeCsv(t.direction || 'Long'),
        escapeCsv(t.assetClass || 'Equity'),
        t.quantity ?? 0,
        t.entryPrice ?? 0,
        t.exitPrice ?? 0,
        t.stopLoss ?? '',
        t.takeProfit ?? '',
        t.pnl ?? 0,
        escapeCsv(t.setup || ''),
        escapeCsv(t.grade || ''),
        escapeCsv(t.moodEntry || ''),
        escapeCsv(t.moodExit || ''),
        escapeCsv((t.mistakes || []).join('; ')),
        t.complianceScore ?? '',
        t.riskRewardRatio ?? '',
        escapeCsv(t.notes || ''),
        escapeCsv((t as any).source || 'LIVE')
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    triggerDownload(csvContent, fileName, 'text/csv;charset=utf-8;');
    logger.info(`[TradeJournalExport] CSV exported successfully: ${fileName}`);
    return { fileName, tradeCount: allTrades.length };
};

// ---------------------------------------------------------------------------
// 4. Restore Trade Journal from JSON
// ---------------------------------------------------------------------------

export interface RestoreJournalResult {
    success: boolean;
    restoredCounts: Record<string, number>;
    totalRows: number;
    error?: string;
}

export const restoreTradeJournalFromJSON = async (jsonText: string): Promise<RestoreJournalResult> => {
    try {
        const payload: TradeJournalExportPayload = JSON.parse(jsonText);
        if (!payload || typeof payload !== 'object' || !payload.data) {
            throw new Error("Invalid trade journal backup file: Missing 'data' object.");
        }

        const allowedTables = [
            'trades',
            'sandbox_trades',
            'daily_reviews',
            'mistakes',
            'missed_trades',
            'strategies',
            'mirror_rules',
            'trade_legs',
            'shared_journal',
            'voice_sessions'
        ];

        const restoredCounts: Record<string, number> = {};
        let totalRows = 0;

        // Atomically bulkPut data into Dexie tables
        await db.transaction('rw', allowedTables.map(t => db.table(t)), async () => {
            const data = payload.data as any;
            for (const tableKey of Object.keys(data)) {
                // Map camelCase keys to database table names
                const dbTableName = tableKey === 'sandboxTrades' ? 'sandbox_trades'
                    : tableKey === 'dailyReviews' ? 'daily_reviews'
                    : tableKey === 'missedTrades' ? 'missed_trades'
                    : tableKey === 'mirrorRules' ? 'mirror_rules'
                    : tableKey === 'tradeLegs' ? 'trade_legs'
                    : tableKey === 'sharedJournal' ? 'shared_journal'
                    : tableKey === 'voiceSessions' ? 'voice_sessions'
                    : tableKey;

                if (!allowedTables.includes(dbTableName)) continue;

                const rows = data[tableKey];
                if (Array.isArray(rows) && rows.length > 0) {
                    const table = db.table(dbTableName);
                    if (table) {
                        await table.bulkPut(rows);
                        restoredCounts[dbTableName] = rows.length;
                        totalRows += rows.length;
                    }
                }
            }
        });

        // Restore trading preferences into localStorage
        if (payload.preferences && typeof payload.preferences === 'object') {
            Object.entries(payload.preferences).forEach(([k, v]) => {
                try {
                    const strVal = typeof v === 'string' ? v : JSON.stringify(v);
                    localStorage.setItem(k, strVal);
                } catch {
                    // Ignore storage quota errors
                }
            });
        }

        logger.info(`[TradeJournalExport] Restored ${totalRows} rows across ${Object.keys(restoredCounts).length} journal tables.`);
        return {
            success: true,
            restoredCounts,
            totalRows
        };
    } catch (err: any) {
        logger.error('[TradeJournalExport] Failed to restore trade journal:', err);
        return {
            success: false,
            restoredCounts: {},
            totalRows: 0,
            error: err instanceof Error ? err.message : String(err)
        };
    }
};
