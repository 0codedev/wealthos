import { db } from '../database';
import { Investment } from '../types';
import { MarketPulseService } from './MarketPulseService';

/**
 * TabContextInjector — Extracts live, tab-specific data blocks for the AI Coach.
 * This makes the AI "see" exactly what the user is looking at.
 */
export class TabContextInjector {
    static async build(tab: string, investments: Investment[], maskPII: boolean = true): Promise<string> {
        try {
            switch (tab) {
                case 'dashboard': return await this.buildDashboardContext(investments, maskPII);
                case 'portfolio': return await this.buildPortfolioContext(investments, maskPII);
                case 'journal': return await this.buildJournalContext();
                case 'ipo': return await this.buildIPOContext(maskPII);
                case 'market': return await this.buildMarketContext(investments);
                case 'growth': return await this.buildGrowthContext(maskPII);
                case 'academy': return await this.buildAcademyContext();
                default: return '';
            }
        } catch (err) {
            console.error(`[TabContextInjector] Failed to build context for ${tab}:`, err);
            return '';
        }
    }

    private static async buildDashboardContext(investments: Investment[], maskPII: boolean): Promise<string> {
        const today = new Date().toISOString().split('T')[0];
        const todayTrades = await db.trades.where('date').startsWith(today).toArray();
        const totalPnL = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const pulse = await MarketPulseService.getPulse();

        const heatmapData = sessionStorage.getItem('fno_sector_heatmap');
        const hotSector = heatmapData ? JSON.parse(heatmapData).leaders?.[0]?.sector : 'N/A';

        return [
            `[DASH] T:${todayTrades.length}, PnL:${maskPII ? '[MASKED]' : '₹' + totalPnL}, Mkt:${pulse.niftyTrend}, Sec:${hotSector}, FII:${pulse.fiiFlow}`
        ].join('\n');
    }

    private static async buildPortfolioContext(investments: Investment[], maskPII: boolean): Promise<string> {
        const totalValue = investments.reduce((sum, inv) => sum + (inv.currentValue || 0), 0);
        
        const concentrationAlerts = investments
            .filter(inv => ((inv.currentValue || 0) / totalValue) > 0.20)
            .map(inv => `${inv.ticker || inv.name}(${((inv.currentValue || 0) / totalValue * 100).toFixed(0)}%)`);

        const underperformers = investments
            .filter(inv => {
                const returns = ((inv.currentValue || 0) - (inv.investedAmount || 0)) / (inv.investedAmount || 1);
                return returns < -0.10;
            })
            .map(inv => {
                const returns = (((inv.currentValue || 0) - (inv.investedAmount || 0)) / (inv.investedAmount || 1)) * 100;
                return `${inv.ticker || inv.name}(${returns.toFixed(0)}%)`;
            });

        return [
            `[PORT] Conc:${concentrationAlerts.join(',') || 'OK'}, Under:${underperformers.join(',') || 'OK'}, Div:${new Set(investments.map(i => i.sector)).size}s/${investments.length}a`
        ].join('\n');
    }

    private static async buildJournalContext(): Promise<string> {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentTrades = await db.trades
            .where('date')
            .above(thirtyDaysAgo.toISOString())
            .toArray();

        const setups = recentTrades.reduce((acc, t) => {
            if (t.setup) {
                acc[t.setup] = (acc[t.setup] || 0) + (t.pnl || 0);
            }
            return acc;
        }, {} as Record<string, number>);

        const bestSetup = Object.entries(setups).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
        const worstSetup = Object.entries(setups).sort((a, b) => a[1] - b[1])[0]?.[0] || 'N/A';

        let streak = 0;
        const sorted = [...recentTrades].sort((a, b) => b.date.localeCompare(a.date));
        if (sorted.length > 0) {
            const firstIsWin = (sorted[0].pnl || 0) >= 0;
            for (const t of sorted) {
                const isWin = (t.pnl || 0) >= 0;
                if (isWin === firstIsWin) streak++;
                else break;
            }
            streak = firstIsWin ? streak : -streak;
        }

        return [
            `[JRNL] Trds:${recentTrades.length}, Best:${bestSetup}, Worst:${worstSetup}, Strk:${streak}, Mist:${(await this.getTopMistake()) || 'None'}`
        ].join('\n');
    }

    private static async buildIPOContext(maskPII: boolean): Promise<string> {
        const applications = await db.ipo_applications.where('status').equals('BLOCKED').toArray();
        const totalBlocked = applications.reduce((sum, app) => sum + (app.amount || 0), 0);
        const overdueCount = applications.filter(app => (Date.now() - new Date(app.appliedDate).getTime()) > 30 * 24 * 60 * 60 * 1000).length;

        return [
            `[IPO] Blocked:${maskPII ? '[MASKED]' : '₹' + totalBlocked}, Pend:${applications.length}, Over:${overdueCount}`
        ].join('\n');
    }

    private static async buildMarketContext(investments: Investment[]): Promise<string> {
        const pulse = await MarketPulseService.getPulse();
        const heatmapData = sessionStorage.getItem('fno_sector_heatmap');
        const leaders = heatmapData ? JSON.parse(heatmapData).leaders : [];
        const laggards = heatmapData ? JSON.parse(heatmapData).laggards : [];

        const exposureToLaggards = investments.filter(inv => 
            laggards.some((l: any) => l.sector.toLowerCase() === (inv.sector || '').toLowerCase())
        );

        return [
            `[MKT] Lead:${leaders.slice(0, 2).map((l: any) => l.sector).join(',')}, Lag:${laggards.slice(0, 2).map((l: any) => l.sector).join(',')}, Exp:${exposureToLaggards.length}h, Sent:${pulse.fiiFlow}`
        ].join('\n');
    }

    private static async buildGrowthContext(maskPII: boolean): Promise<string> {
        const goals = await db.goals.toArray();
        const criticalGoals = goals.filter(g => g.priority === 'Critical');
        
        const behindSchedule = goals.filter(g => {
            const createdAt = new Date(g.createdAt || Date.now()).getTime();
            const targetDate = new Date(g.targetDate).getTime();
            const now = Date.now();
            const totalDays = targetDate - createdAt;
            const elapsedDays = now - createdAt;
            const expectedProgress = elapsedDays / (totalDays || 1);
            const actualProgress = (g.currentAmount || 0) / (g.targetAmount || 1);
            return actualProgress < expectedProgress * 0.8;
        });

        return [
            `[GROW] Goals:${goals.length}, Crit:${criticalGoals.length}, Delay:${behindSchedule.length}`
        ].join('\n');
    }

    private static async buildAcademyContext(): Promise<string> {
        const topMistakeType = await this.getTopMistake();
        const progress = await db.quiz_progress.where('userId').equals('default').first();

        return [
            `[ACAD] Mist:${topMistakeType || 'None'}, XP:${progress?.totalXP || 0}`
        ].join('\n');
    }

    private static async getTopMistake(): Promise<string | null> {
        const mistakes = await db.mistakes.toArray();
        if (mistakes.length === 0) return null;
        const counts = mistakes.reduce((acc, m) => {
            acc[m.title] = (acc[m.title] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }

    private static mapMistakeToModule(mistake: string | null): string {
        if (!mistake) return 'Fundamentals of Wealth';
        const m = mistake.toLowerCase();
        if (m.includes('revenge') || m.includes('tilt')) return 'Emotional Mastery';
        if (m.includes('fomo') || m.includes('chase')) return 'Patience & Entry Protocol';
        if (m.includes('stop loss') || m.includes('risk')) return 'Risk Management 101';
        return 'Advanced Technical Analysis';
    }
}
