/**
 * ExportService - Export portfolio data in various formats
 * PDF, Excel/CSV, and shareable portfolio views
 */

import { Investment } from '../types';
import { escapeHtml } from '../utils/security';

export type ExportFormat = 'pdf' | 'csv' | 'excel' | 'json';

interface ExportOptions {
    includePrivate?: boolean;
    dateRange?: { start: Date; end: Date };
    format: ExportFormat;
}

interface PortfolioSummary {
    totalInvested: number;
    totalCurrent: number;
    totalGain: number;
    gainPercent: number;
    assetCount: number;
    topPerformer: Investment | null;
    worstPerformer: Investment | null;
}

class ExportService {
    /**
     * Export investments to CSV format
     */
    exportToCSV(investments: Investment[], filename: string = 'portfolio'): void {
        const headers = [
            'Name',
            'Type',
            'Platform',
            'Invested Amount',
            'Current Value',
            'Gain/Loss',
            'Gain %',
            'Last Updated',
        ];

        const rows = investments.map(inv => {
            const gain = inv.currentValue - inv.investedAmount;
            const gainPercent = ((gain / inv.investedAmount) * 100).toFixed(2);

            return [
                inv.name,
                inv.type,
                inv.platform || '',
                inv.investedAmount.toFixed(2),
                inv.currentValue.toFixed(2),
                gain.toFixed(2),
                gainPercent + '%',
                inv.lastUpdated,
            ];
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        this.downloadFile(csvContent, `${filename}.csv`, 'text/csv');
    }

    /**
     * Export investments to JSON format
     */
    exportToJSON(investments: Investment[], filename: string = 'portfolio'): void {
        const data = {
            exportedAt: new Date().toISOString(),
            version: '1.0',
            investments: investments.map(inv => ({
                ...inv,
                gain: inv.currentValue - inv.investedAmount,
                gainPercent: ((inv.currentValue - inv.investedAmount) / inv.investedAmount) * 100,
            })),
            summary: this.calculateSummary(investments),
        };

        const jsonContent = JSON.stringify(data, null, 2);
        this.downloadFile(jsonContent, `${filename}.json`, 'application/json');
    }

    /**
     * Generate shareable portfolio link (anonymized)
     */
    generateShareableLink(investments: Investment[]): string {
        // Create anonymized allocation data
        const allocation = this.getAssetAllocation(investments);
        const data = {
            totalAssets: investments.length,
            allocation,
            performance: this.calculatePerformance(investments),
        };

        // Encode as base64 for URL
        const encoded = btoa(JSON.stringify(data));
        return `${window.location.origin}/share?data=${encoded}`;
    }

    /**
     * Export to printable HTML (for PDF via browser print)
     */
    exportToPrintableHTML(investments: Investment[]): void {
        const summary = this.calculateSummary(investments);

        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Portfolio Report - ${new Date().toLocaleDateString()}</title>
    <style>
        body { font-family: 'Inter', -apple-system, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
        h1 { color: #4f46e5; border-bottom: 2px solid #4f46e5; padding-bottom: 10px; }
        .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 30px 0; }
        .summary-card { background: #f1f5f9; padding: 20px; border-radius: 12px; text-align: center; }
        .summary-value { font-size: 24px; font-weight: bold; color: #1e293b; }
        .summary-label { font-size: 12px; color: #64748b; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 30px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f8fafc; font-weight: 600; }
        .positive { color: #10b981; }
        .negative { color: #ef4444; }
        .footer { margin-top: 40px; text-align: center; color: #94a3b8; font-size: 12px; }
        @media print { body { padding: 0; } }
    </style>
</head>
<body>
    <h1>📊 Portfolio Report</h1>
    <p style="color: #64748b;">Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
    
    <div class="summary">
        <div class="summary-card">
            <div class="summary-value">₹${summary.totalCurrent.toLocaleString()}</div>
            <div class="summary-label">Current Value</div>
        </div>
        <div class="summary-card">
            <div class="summary-value ${summary.totalGain >= 0 ? 'positive' : 'negative'}">
                ${summary.totalGain >= 0 ? '+' : ''}₹${summary.totalGain.toLocaleString()}
            </div>
            <div class="summary-label">Total Gain/Loss</div>
        </div>
        <div class="summary-card">
            <div class="summary-value ${summary.gainPercent >= 0 ? 'positive' : 'negative'}">
                ${summary.gainPercent >= 0 ? '+' : ''}${summary.gainPercent.toFixed(2)}%
            </div>
            <div class="summary-label">Returns</div>
        </div>
    </div>

    <h2>Holdings (${investments.length})</h2>
    <table>
        <thead>
            <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Invested</th>
                <th>Current</th>
                <th>Gain/Loss</th>
            </tr>
        </thead>
        <tbody>
            ${investments.map(inv => {
            const gain = inv.currentValue - inv.investedAmount;
            const gainPercent = ((gain / inv.investedAmount) * 100).toFixed(2);
            return `
                    <tr>
                        <td><strong>${escapeHtml(inv.name)}</strong><br><small style="color:#94a3b8">${escapeHtml(inv.platform || '')}</small></td>
                        <td>${escapeHtml(inv.type)}</td>
                        <td>₹${inv.investedAmount.toLocaleString()}</td>
                        <td>₹${inv.currentValue.toLocaleString()}</td>
                        <td class="${gain >= 0 ? 'positive' : 'negative'}">
                            ${gain >= 0 ? '+' : ''}₹${gain.toLocaleString()} (${gainPercent}%)
                        </td>
                    </tr>
                `;
        }).join('')}
        </tbody>
    </table>

    <div class="footer">
        <p>Generated by Wealth Aggregator • For personal use only</p>
    </div>
</body>
</html>
        `;

        // Open in new window for printing
        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 500);
        }
    }

    /**
     * Copy portfolio summary to clipboard
     */
    async copyToClipboard(investments: Investment[]): Promise<boolean> {
        const summary = this.calculateSummary(investments);

        const text = `📊 Portfolio Summary
━━━━━━━━━━━━━━━━━━━━
💰 Total Value: ₹${summary.totalCurrent.toLocaleString()}
📈 Total Invested: ₹${summary.totalInvested.toLocaleString()}
${summary.totalGain >= 0 ? '🟢' : '🔴'} Returns: ${summary.totalGain >= 0 ? '+' : ''}₹${summary.totalGain.toLocaleString()} (${summary.gainPercent.toFixed(2)}%)
📦 Assets: ${summary.assetCount}
${summary.topPerformer ? `🏆 Top: ${summary.topPerformer.name}` : ''}

Generated by Wealth Aggregator`;

        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }

    // Helper: Download file
    private downloadFile(content: string, filename: string, mimeType: string): void {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // Helper: Calculate portfolio summary
    private calculateSummary(investments: Investment[]): PortfolioSummary {
        const totalInvested = investments.reduce((sum, inv) => sum + inv.investedAmount, 0);
        const totalCurrent = investments.reduce((sum, inv) => sum + inv.currentValue, 0);
        const totalGain = totalCurrent - totalInvested;
        const gainPercent = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

        // Find top/worst performers
        const sorted = [...investments].sort((a, b) => {
            const gainA = (a.currentValue - a.investedAmount) / a.investedAmount;
            const gainB = (b.currentValue - b.investedAmount) / b.investedAmount;
            return gainB - gainA;
        });

        return {
            totalInvested,
            totalCurrent,
            totalGain,
            gainPercent,
            assetCount: investments.length,
            topPerformer: sorted[0] || null,
            worstPerformer: sorted[sorted.length - 1] || null,
        };
    }

    // Helper: Get asset allocation
    private getAssetAllocation(investments: Investment[]): Record<string, number> {
        const totalValue = investments.reduce((sum, inv) => sum + inv.currentValue, 0);
        const allocation: Record<string, number> = {};

        investments.forEach(inv => {
            const type = inv.type || 'Other';
            allocation[type] = (allocation[type] || 0) + (inv.currentValue / totalValue) * 100;
        });

        return allocation;
    }

    // Helper: Calculate performance metrics
    private calculatePerformance(investments: Investment[]): { cagr: number; bestMonth: number; worstMonth: number } {
        // Simplified performance calculation
        const summary = this.calculateSummary(investments);
        return {
            cagr: summary.gainPercent,
            bestMonth: summary.gainPercent * 0.3,
            worstMonth: summary.gainPercent * -0.2,
        };
    }
}

// Export singleton instance
export const exportService = new ExportService();

export default ExportService;
