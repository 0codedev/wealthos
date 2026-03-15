import { db, ParsedSignal } from '../database';

export interface ProviderPerformance {
    provider: string;
    totalSignals: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnL: number;
}

export interface PnLPoint {
    date: string;
    cumulativePnL: number;
}

export interface WeeklyReportData {
    totalSignals: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnL: number;
    bestCall: ParsedSignal | null;
    worstCall: ParsedSignal | null;
    providers: ProviderPerformance[];
    pnlCurve: PnLPoint[];
}

export const PerformanceReportService = {
    /**
     * Generates stats for the weekly report.
     */
    async generateReportData(weekStart: Date, weekEnd: Date): Promise<WeeklyReportData> {
        const allSignals = await db.parsed_signals.toArray();
        
        const startTime = weekStart.getTime();
        const endTime = weekEnd.getTime();

        const weekSignals = allSignals.filter((sig: ParsedSignal) => {
            const time = new Date(sig.timestamp).getTime();
            return time >= startTime && time <= endTime && sig.status !== 'NEEDS_REVIEW';
        });

        if (weekSignals.length === 0) {
            return {
                totalSignals: 0,
                wins: 0,
                losses: 0,
                winRate: 0,
                totalPnL: 0,
                bestCall: null,
                worstCall: null,
                providers: [],
                pnlCurve: []
            };
        }

        let totalPnL = 0;
        let wins = 0;
        let losses = 0;
        let bestCall: ParsedSignal | null = null;
        let worstCall: ParsedSignal | null = null;

        const providerMap = new Map<string, { total: number; wins: number; losses: number; pnl: number }>();

        weekSignals.forEach((sig: ParsedSignal) => {
            const pnl = sig.outcomePnL || 0;
            totalPnL += pnl;

            // Track Win/Loss
            if (sig.status === 'TARGET_HIT') {
                wins++;
            } else if (sig.status === 'SL_HIT') {
                losses++;
            }

            // Track Best/Worst
            if (!bestCall || pnl > (bestCall.outcomePnL || 0)) {
                bestCall = sig;
            }
            if (!worstCall || pnl < (worstCall.outcomePnL || 0)) {
                worstCall = sig;
            }

            // Provider Stats
            const provName = sig.provider || 'Unknown';
            if (!providerMap.has(provName)) {
                providerMap.set(provName, { total: 0, wins: 0, losses: 0, pnl: 0 });
            }
            const stat = providerMap.get(provName)!;
            stat.total++;
            stat.pnl += pnl;
            if (sig.status === 'TARGET_HIT') stat.wins++;
            else if (sig.status === 'SL_HIT') stat.losses++;
        });

        const providers: ProviderPerformance[] = Array.from(providerMap.entries()).map(([provider, stat]) => {
            return {
                provider,
                totalSignals: stat.total,
                wins: stat.wins,
                losses: stat.losses,
                winRate: stat.total > 0 ? parseFloat((stat.wins / stat.total).toFixed(2)) : 0,
                totalPnL: parseFloat(stat.pnl.toFixed(2))
            };
        });

        // Sort providers by winRate DESC
        providers.sort((a, b) => b.winRate - a.winRate);

        // Generate P&L Curve
        const pnlCurve = this.generatePnLCurve(weekSignals);

        return {
            totalSignals: weekSignals.length,
            wins,
            losses,
            winRate: parseFloat((wins / (wins + losses || 1)).toFixed(2)),
            totalPnL: parseFloat(totalPnL.toFixed(2)),
            bestCall,
            worstCall,
            providers,
            pnlCurve
        };
    },

    /**
     * Generates running cumulative PnL coordinates over the week's trades.
     */
    generatePnLCurve(signals: ParsedSignal[]): PnLPoint[] {
        // Sort by timestamp ASC
        const sorted = [...signals].sort((a, b) => 
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const curve: PnLPoint[] = [];
        let runningPnL = 0;

        sorted.forEach(sig => {
            const pnl = sig.outcomePnL || 0;
            runningPnL += pnl;
            
            const dateStr = new Date(sig.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
            
            // If the date already exists, update its cumulative P&L
            const existing = curve.find(pt => pt.date === dateStr);
            if (existing) {
                existing.cumulativePnL = parseFloat(runningPnL.toFixed(2));
            } else {
                curve.push({
                    date: dateStr,
                    cumulativePnL: parseFloat(runningPnL.toFixed(2))
                });
            }
        });

        return curve;
    }
};
