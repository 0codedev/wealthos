import React, { useMemo, useState, useEffect } from 'react';
import { liveQuery } from 'dexie';
import { formatCurrency } from '../../utils/helpers';
import { db, IPOApplication, Trade } from '../../database';

interface ArchivedListProps {
    listedApps: IPOApplication[];
    realizedGains: number;
}

const cleanIpoName = (name: string): string => {
    return (name || '')
        .replace(/^IPO Gain:\s*/i, '')
        .replace(/\s*IPO$/i, '')
        .replace(/\s*Limited$/i, '')
        .replace(/\s*Ltd\.?$/i, '')
        .replace(/\s*India$/i, '')
        .replace(/\s*Asset Management$/i, '')
        .replace(/\s*AMC$/i, '')
        .trim()
        .toUpperCase();
};

export const ArchivedList = React.memo(({ listedApps, realizedGains }: ArchivedListProps) => {
    const [trades, setTrades] = useState<Trade[]>([]);

    useEffect(() => {
        const sub = liveQuery(() => db.trades.toArray()).subscribe(setTrades);
        return () => sub.unsubscribe();
    }, []);

    // Build map of clean IPO name -> realized profit from trades
    const ipoProfitMap = useMemo(() => {
        const map: Record<string, number> = {};
        trades.forEach(t => {
            if (t.isDeleted) return;
            const cleaned = cleanIpoName(t.ticker || '');
            if (cleaned) {
                map[cleaned] = (map[cleaned] || 0) + (t.pnl || 0);
            }
        });
        return map;
    }, [trades]);

    // Group listed applications by clean IPO name to calculate each app's capital share
    const groupCapitalMap = useMemo(() => {
        const map: Record<string, number> = {};
        listedApps.forEach(app => {
            const cleaned = cleanIpoName(app.ipoName);
            const cap = app.allottedAmount ?? app.amount ?? 0;
            map[cleaned] = (map[cleaned] || 0) + cap;
        });
        return map;
    }, [listedApps]);

    if (listedApps.length === 0) return null;

    return (
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase">Recent Listings (Archived)</h4>
                </div>
                <span className="text-xs font-mono text-emerald-500 font-bold">
                    Total Realized: {formatCurrency(realizedGains || Object.values(ipoProfitMap).reduce((a, b) => a + b, 0))}
                </span>
            </div>
            <div className="space-y-2">
                {listedApps.map(app => {
                    const cleaned = cleanIpoName(app.ipoName);
                    const appCap = app.allottedAmount ?? app.amount ?? 0;
                    const groupCap = groupCapitalMap[cleaned] || appCap || 1;
                    
                    // Match profit by exact or partial name
                    let totalProfitForIpo = ipoProfitMap[cleaned] ?? 0;
                    if (!totalProfitForIpo) {
                        for (const [k, v] of Object.entries(ipoProfitMap)) {
                            if (k.includes(cleaned) || cleaned.includes(k)) {
                                totalProfitForIpo = v;
                                break;
                            }
                        }
                    }

                    const appProfit = groupCap > 0 && totalProfitForIpo > 0 
                        ? (appCap / groupCap) * totalProfitForIpo 
                        : (app.realizedPnL ?? 0);

                    return (
                        <div 
                            key={app.id} 
                            className="flex justify-between items-center text-xs py-1.5 px-2.5 rounded-lg bg-slate-50/50 dark:bg-slate-900/30 hover:bg-slate-100 dark:hover:bg-slate-900/60 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-800"
                        >
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{app.ipoName}</span>
                                <span className="text-slate-500 dark:text-slate-400 text-[11px]">({app.applicantName})</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-slate-400 dark:text-slate-400 font-mono text-[11px]">
                                    {formatCurrency(app.amount)} <span className="text-slate-500 dark:text-slate-500 text-[10px]">(Invested)</span>
                                </span>
                                {appProfit > 0 ? (
                                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200/60 dark:border-emerald-500/20 text-xs">
                                        +{formatCurrency(appProfit)}
                                    </span>
                                ) : appProfit < 0 ? (
                                    <span className="font-mono font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded border border-rose-200/60 dark:border-rose-500/20 text-xs">
                                        {formatCurrency(appProfit)}
                                    </span>
                                ) : (
                                    <span className="font-mono text-slate-400 text-[11px] px-1">
                                        ₹0
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

