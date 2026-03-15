/**
 * Portfolio Export Service
 * Generates professional PDF and Excel reports for tax filing and CA handoff
 */

import { Investment, InvestmentType } from '../types';
import { formatCurrency } from '../utils/helpers';

export interface ExportConfig {
    title?: string;
    includeCharts?: boolean;
    includeAnalytics?: boolean;
    includeTaxSummary?: boolean;
    dateRange?: { start: string; end: string };
    groupBy?: 'type' | 'platform' | 'sector';
}

export interface PortfolioSummary {
    totalInvested: number;
    totalCurrent: number;
    unrealizedPnL: number;
    unrealizedPnLPercent: number;
    holdingsCount: number;
    platformCount: number;
    topGainer: { name: string; gain: number; gainPercent: number } | null;
    topLoser: { name: string; loss: number; lossPercent: number } | null;
    sectorAllocation: { sector: string; value: number; percentage: number }[];
    typeAllocation: { type: string; value: number; percentage: number }[];
}

export class PortfolioExportService {
    // Generate portfolio summary from investments
    generateSummary(investments: Investment[]): PortfolioSummary {
        const totalInvested = investments.reduce((sum, i) => sum + i.investedAmount, 0);
        const totalCurrent = investments.reduce((sum, i) => sum + i.currentValue, 0);
        const unrealizedPnL = totalCurrent - totalInvested;
        const unrealizedPnLPercent = totalInvested > 0 ? (unrealizedPnL / totalInvested) * 100 : 0;

        const platforms = new Set(investments.map(i => i.platform));

        // Find top gainer/loser
        let topGainer: PortfolioSummary['topGainer'] = null;
        let topLoser: PortfolioSummary['topLoser'] = null;

        investments.forEach(inv => {
            const pnl = inv.currentValue - inv.investedAmount;
            const pnlPercent = inv.investedAmount > 0 ? (pnl / inv.investedAmount) * 100 : 0;

            if (pnl > 0 && (!topGainer || pnl > topGainer.gain)) {
                topGainer = { name: inv.name, gain: pnl, gainPercent: pnlPercent };
            }
            if (pnl < 0 && (!topLoser || pnl < topLoser.loss)) {
                topLoser = { name: inv.name, loss: pnl, lossPercent: pnlPercent };
            }
        });

        // Sector allocation
        const sectorMap: Record<string, number> = {};
        investments.forEach(inv => {
            const sector = inv.sector || 'Other';
            sectorMap[sector] = (sectorMap[sector] || 0) + inv.currentValue;
        });
        const sectorAllocation = Object.entries(sectorMap)
            .map(([sector, value]) => ({
                sector,
                value,
                percentage: totalCurrent > 0 ? (value / totalCurrent) * 100 : 0
            }))
            .sort((a, b) => b.value - a.value);

        // Type allocation
        const typeMap: Record<string, number> = {};
        investments.forEach(inv => {
            const type = inv.type || 'Other';
            typeMap[type] = (typeMap[type] || 0) + inv.currentValue;
        });
        const typeAllocation = Object.entries(typeMap)
            .map(([type, value]) => ({
                type,
                value,
                percentage: totalCurrent > 0 ? (value / totalCurrent) * 100 : 0
            }))
            .sort((a, b) => b.value - a.value);

        return {
            totalInvested,
            totalCurrent,
            unrealizedPnL,
            unrealizedPnLPercent,
            holdingsCount: investments.length,
            platformCount: platforms.size,
            topGainer,
            topLoser,
            sectorAllocation,
            typeAllocation,
        };
    }

    // Generate CSV export
    exportToCSV(investments: Investment[], filename?: string): void {
        const headers = [
            'Name',
            'Type',
            'Platform',
            'Units',
            'Avg Cost',
            'Current Price',
            'Invested Amount',
            'Current Value',
            'P&L',
            'P&L %',
            'Sector',
            'Country',
            'Added Date'
        ];

        const rows = investments.map(inv => {
            const i = inv as any; // Cast to any to access potentially missing fields or legacy fields
            const pnl = inv.currentValue - inv.investedAmount;
            const pnlPercent = inv.investedAmount > 0 ? (pnl / inv.investedAmount) * 100 : 0;
            return [
                `"${inv.name}"`,
                inv.type,
                inv.platform || '',
                (i.units || 0).toString(),
                (i.avgBuyPrice || 0).toFixed(2),
                (i.currentPrice || 0).toFixed(2) || '',
                inv.investedAmount.toFixed(2),
                inv.currentValue.toFixed(2),
                pnl.toFixed(2),
                pnlPercent.toFixed(2) + '%',
                inv.sector || '',
                inv.country || '',
                (i.addedAt || '')
            ];
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        this.downloadFile(csvContent, filename || `Portfolio_Export_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
    }

    // Generate detailed JSON export
    exportToJSON(investments: Investment[], summary: PortfolioSummary, filename?: string): void {
        const exportData = {
            generatedAt: new Date().toISOString(),
            generatedBy: 'Wealth Aggregator',
            version: '2.0',
            summary: {
                ...summary,
                formattedValues: {
                    totalInvested: formatCurrency(summary.totalInvested),
                    totalCurrent: formatCurrency(summary.totalCurrent),
                    unrealizedPnL: formatCurrency(summary.unrealizedPnL),
                    unrealizedPnLPercent: summary.unrealizedPnLPercent.toFixed(2) + '%',
                }
            },
            holdings: investments.map(inv => ({
                ...inv,
                pnl: inv.currentValue - inv.investedAmount,
                pnlPercent: inv.investedAmount > 0
                    ? ((inv.currentValue - inv.investedAmount) / inv.investedAmount) * 100
                    : 0
            })),
            disclaimer: 'This report is generated for informational purposes only. Verify with your broker statements before filing taxes.'
        };

        this.downloadFile(
            JSON.stringify(exportData, null, 2),
            filename || `Portfolio_Report_${new Date().toISOString().split('T')[0]}.json`,
            'application/json'
        );
    }

    // Generate printable HTML report
    exportToHTML(investments: Investment[], summary: PortfolioSummary): void {
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Portfolio Report - ${new Date().toLocaleDateString()}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1e293b; }
        h1 { color: #4f46e5; margin-bottom: 10px; }
        .subtitle { color: #64748b; margin-bottom: 30px; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }
        .summary-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
        .summary-card h3 { font-size: 12px; color: #64748b; text-transform: uppercase; margin-bottom: 5px; }
        .summary-card p { font-size: 24px; font-weight: 700; }
        .green { color: #10b981; }
        .red { color: #ef4444; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background: #4f46e5; color: white; padding: 12px; text-align: left; font-size: 12px; }
        td { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        tr:hover { background: #f1f5f9; }
        .text-right { text-align: right; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 11px; }
        @media print { body { padding: 20px; } }
    </style>
</head>
<body>
    <h1>💼 Portfolio Report</h1>
    <p class="subtitle">Generated on ${new Date().toLocaleString()} by Wealth Aggregator</p>
    
    <div class="summary-grid">
        <div class="summary-card">
            <h3>Total Invested</h3>
            <p>${formatCurrency(summary.totalInvested)}</p>
        </div>
        <div class="summary-card">
            <h3>Current Value</h3>
            <p>${formatCurrency(summary.totalCurrent)}</p>
        </div>
        <div class="summary-card">
            <h3>Unrealized P&L</h3>
            <p class="${summary.unrealizedPnL >= 0 ? 'green' : 'red'}">
                ${formatCurrency(summary.unrealizedPnL)} (${summary.unrealizedPnLPercent.toFixed(2)}%)
            </p>
        </div>
        <div class="summary-card">
            <h3>Holdings</h3>
            <p>${summary.holdingsCount} across ${summary.platformCount} platforms</p>
        </div>
    </div>
    
    <h2>Holdings Detail</h2>
    <table>
        <thead>
            <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Platform</th>
                <th class="text-right">Units</th>
                <th class="text-right">Invested</th>
                <th class="text-right">Current</th>
                <th class="text-right">P&L</th>
                <th class="text-right">P&L %</th>
            </tr>
        </thead>
        <tbody>
            ${investments.map(inv => {
            const pnl = inv.currentValue - inv.investedAmount;
            const pnlPercent = inv.investedAmount > 0 ? (pnl / inv.investedAmount) * 100 : 0;
            const i = inv as any;
            return `
                <tr>
                    <td><strong>${inv.name}</strong></td>
                    <td>${inv.type}</td>
                    <td>${inv.platform || '-'}</td>
                    <td class="text-right">${(i.units || 0).toFixed(2)}</td>
                    <td class="text-right">${formatCurrency(inv.investedAmount)}</td>
                    <td class="text-right">${formatCurrency(inv.currentValue)}</td>
                    <td class="text-right ${pnl >= 0 ? 'green' : 'red'}">${formatCurrency(pnl)}</td>
                    <td class="text-right ${pnl >= 0 ? 'green' : 'red'}">${pnlPercent.toFixed(2)}%</td>
                </tr>`;
        }).join('')}
        </tbody>
    </table>
    
    <div class="footer">
        <p>⚠️ Disclaimer: This report is for informational purposes only. Please verify with your broker statements and consult a CA for tax filing.</p>
        <p>Generated by Wealth Aggregator • www.wealthaggregator.app</p>
    </div>
</body>
</html>`;

        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const win = window.open(url, '_blank');
        if (win) {
            win.onload = () => win.print();
        }
    }

    // Helper to download file
    private downloadFile(content: string, filename: string, mimeType: string): void {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

export const portfolioExportService = new PortfolioExportService();
export default PortfolioExportService;
