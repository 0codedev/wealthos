import { Investment } from '../types';

export interface InsightAlert {
    id: string;
    type: 'anomaly' | 'price' | 'sip' | 'tax' | 'news' | 'risk' | 'milestone';
    title: string;
    message: string;
    time: string;
    read: boolean;
    severity: 'low' | 'medium' | 'high';
}

export const InsightService = {
    analyzePortfolio: (investments: Investment[]): InsightAlert[] => {
        const alerts: InsightAlert[] = [];
        const totalValue = investments.reduce((sum, inv) => sum + (inv.currentValue || 0), 0);

        // 1. Concentration Risk Analysis
        const groupedByAsset = investments.reduce((acc, inv) => {
            acc[inv.name] = (acc[inv.name] || 0) + (inv.currentValue || 0);
            return acc;
        }, {} as Record<string, number>);

        Object.entries(groupedByAsset).forEach(([asset, value]) => {
            const concentration = (value / totalValue) * 100;
            if (concentration > 20 && totalValue > 100000) {
                alerts.push({
                    id: `conc-${asset}`,
                    type: 'risk',
                    title: 'High Concentration Risk',
                    message: `${asset} makes up ${concentration.toFixed(1)}% of your portfolio. Consider diversifying.`,
                    time: 'Just now',
                    read: false,
                    severity: 'high'
                });
            }
        });

        // 2. Asset Allocation Check (Simple Heuristic for now)
        const assetClasses = investments.reduce((acc, inv) => {
            acc[inv.type] = (acc[inv.type] || 0) + (inv.currentValue || 0);
            return acc;
        }, {} as Record<string, number>);

        const cashPercent = (assetClasses['Cash'] || 0) / totalValue * 100;
        if (cashPercent > 25 && totalValue > 500000) {
            alerts.push({
                id: 'cash-drag',
                type: 'anomaly',
                title: 'High Cash Drag',
                message: `You have ${cashPercent.toFixed(1)}% in cash. Inflation is eating your returns.`,
                time: '1h ago',
                read: false,
                severity: 'medium'
            });
        }

        // 3. Milestones
        if (totalValue > 10000000) { // 1 Cr
            alerts.push({
                id: 'club-1cr',
                type: 'milestone',
                title: '🏆 Crorepati Club Member',
                message: 'Congratulations! Your portfolio has crossed ₹1 Crore.',
                time: 'Just now',
                read: false,
                severity: 'low'
            });
        } else if (totalValue > 1000000) { // 10 L
            alerts.push({
                id: 'club-10l',
                type: 'milestone',
                title: 'Level Up: ₹10 Lakh Club',
                message: 'Your portfolio is growing strong. Next stop: ₹50L.',
                time: 'Just now',
                read: false,
                severity: 'low'
            });
        }

        // 4. SIP Reminders (Mock logic based on date)
        const day = new Date().getDate();
        if (day >= 1 && day <= 5) {
            alerts.push({
                id: 'sip-reminder',
                type: 'sip',
                title: 'SIP Week Started',
                message: 'Ensure your bank account is funded for monthly SIPs.',
                time: '9:00 AM',
                read: false,
                severity: 'low'
            });
        }

        return alerts;
    }
};
