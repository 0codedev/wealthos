/**
 * ITR Pre-Fill Generator Service
 * Generates JSON data compatible with ITR-2/ITR-3 forms for capital gains reporting
 * Based on Indian Income Tax Department AY 2024-25 format
 */

import { db, Trade } from '../database';
import { Investment } from '../types';

// ITR Schedule CG (Capital Gains) Structure
export interface ScheduleCG {
    assessmentYear: string;
    shortTermGains: ShortTermGains;
    longTermGains: LongTermGains;
    summary: CGSummary;
    deductions: CGDeductions;
}

export interface ShortTermGains {
    section111A: {
        // Equity shares where STT paid
        fullValue: number;
        costOfAcquisition: number;
        expenses: number;
        gains: number;
        taxRate: 0.15;
    };
    otherAssets: {
        fullValue: number;
        costOfAcquisition: number;
        gains: number;
    };
    totalSTCG: number;
}

export interface LongTermGains {
    section112A: {
        // Equity shares where STT paid (FY 24-25: 12.5% above ₹1.25L)
        fullValue: number;
        costOfAcquisition: number;
        expenses: number;
        gainsBeforeExemption: number;
        exemption: number; // ₹1.25 Lakh
        taxableGains: number;
        taxRate: 0.125;
    };
    section112: {
        // Other capital assets (20% with indexation)
        fullValue: number;
        indexedCost: number;
        gains: number;
        taxRate: 0.20;
    };
    totalLTCG: number;
}

export interface CGSummary {
    grossSTCG: number;
    grossLTCG: number;
    exemptionsApplied: number;
    netTaxableGains: number;
    estimatedTax: number;
}

export interface CGDeductions {
    section54: number; // Reinvestment in house
    section54F: number; // Reinvestment from non-house assets
    section54EC: number; // Investment in bonds
    totalDeductions: number;
}

// Transaction detail for ITR
export interface CGTransaction {
    id: string;
    assetType: 'Listed Equity' | 'Unlisted Equity' | 'Mutual Fund' | 'Debt' | 'Gold' | 'Property' | 'Other';
    description: string;
    acquisitionDate: string;
    acquisitionCost: number;
    saleDate: string;
    saleValue: number;
    expenses: number;
    gainType: 'STCG' | 'LTCG';
    taxSection: '111A' | '112A' | '112' | 'Other';
    gain: number;
    holdingPeriod: number; // days
}

// Constants for FY 2024-25
const LTCG_EXEMPTION_LIMIT = 125000; // ₹1.25 Lakh
const LTCG_TAX_RATE = 0.125; // 12.5%
const STCG_TAX_RATE = 0.15; // 15%
const EQUITY_HOLDING_PERIOD = 365; // 12 months

export class ITRGeneratorService {
    private fiscalYearStart: string;
    private fiscalYearEnd: string;
    private assessmentYear: string;

    constructor(fiscalYear: string = '2024-25') {
        const [startYear] = fiscalYear.split('-').map(Number);
        this.fiscalYearStart = `${startYear}-04-01`;
        this.fiscalYearEnd = `${startYear + 1}-03-31`;
        this.assessmentYear = `${startYear + 1}-${(startYear + 2).toString().slice(2)}`;
    }

    // Fetch trades within fiscal year
    private async getTradesInFY(): Promise<Trade[]> {
        const allTrades = await db.trades.toArray();
        return allTrades.filter(trade => {
            const tradeDate = new Date(trade.date);
            return tradeDate >= new Date(this.fiscalYearStart) &&
                tradeDate <= new Date(this.fiscalYearEnd);
        });
    }

    // Calculate holding period in days
    private calculateHoldingPeriod(acquisitionDate: string, saleDate: string): number {
        const acq = new Date(acquisitionDate);
        const sale = new Date(saleDate);
        return Math.floor((sale.getTime() - acq.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Determine tax section based on asset type and holding period
    private determineTaxSection(holdingDays: number, assetType: string): { gainType: 'STCG' | 'LTCG', section: '111A' | '112A' | '112' | 'Other' } {
        const isEquity = ['Listed Equity', 'Mutual Fund'].includes(assetType);
        const isLongTerm = holdingDays >= EQUITY_HOLDING_PERIOD;

        if (isEquity) {
            return {
                gainType: isLongTerm ? 'LTCG' : 'STCG',
                section: isLongTerm ? '112A' : '111A'
            };
        } else {
            // For non-equity, LTCG threshold is typically 24-36 months
            const ltcgThreshold = assetType === 'Property' ? 730 : 1095; // 2 or 3 years
            return {
                gainType: holdingDays >= ltcgThreshold ? 'LTCG' : 'STCG',
                section: holdingDays >= ltcgThreshold ? '112' : 'Other'
            };
        }
    }

    // Convert trades to CG transactions
    private tradesToTransactions(trades: Trade[]): CGTransaction[] {
        return trades
            .filter(t => t.exitPrice > 0) // Only closed trades
            .map(trade => {
                // Calculate accurate holding period from trade metadata
                const isIntraday = trade.brokerProfile === 'Intraday Equity' || 
                    Boolean(trade.entryTime && trade.exitTime && trade.date) ||
                    Boolean(trade.timeInTrade && (trade.timeInTrade.includes('m') || trade.timeInTrade.includes('s') || trade.timeInTrade.includes('h')));

                let holdingPeriod = 0;
                let acquisitionDate = trade.date;

                if (isIntraday) {
                    holdingPeriod = 0;
                    acquisitionDate = trade.date;
                } else if ((trade as any).holdingDays && Number((trade as any).holdingDays) > 0) {
                    holdingPeriod = Number((trade as any).holdingDays);
                    const acqMs = new Date(trade.date).getTime() - holdingPeriod * 24 * 60 * 60 * 1000;
                    acquisitionDate = Number.isFinite(acqMs) ? new Date(acqMs).toISOString().split('T')[0] : trade.date;
                } else if ((trade as any).entryDate && (trade as any).entryDate !== trade.date) {
                    holdingPeriod = Math.max(0, this.calculateHoldingPeriod((trade as any).entryDate, trade.date));
                    acquisitionDate = (trade as any).entryDate;
                } else {
                    // Standard journal swing trades default to short-term holding (STCG Section 111A)
                    holdingPeriod = 1;
                    acquisitionDate = trade.date;
                }

                const assetType: CGTransaction['assetType'] = 'Listed Equity';
                const { gainType, section } = this.determineTaxSection(holdingPeriod, assetType);

                const acquisitionCost = trade.entryPrice * trade.quantity;
                const saleValue = trade.exitPrice * trade.quantity;
                const gain = trade.direction === 'Long'
                    ? saleValue - acquisitionCost - (trade.fees || 0)
                    : acquisitionCost - saleValue - (trade.fees || 0);

                return {
                    id: `TXN-${trade.id}`,
                    assetType,
                    description: trade.ticker,
                    acquisitionDate,
                    acquisitionCost,
                    saleDate: trade.date,
                    saleValue,
                    expenses: trade.fees || 0,
                    gainType,
                    taxSection: section,
                    gain,
                    holdingPeriod
                };
            });
    }

    // Generate Schedule CG
    async generateScheduleCG(customTrades?: Trade[]): Promise<{ schedule: ScheduleCG, transactions: CGTransaction[] }> {
        const trades = customTrades || (await this.getTradesInFY());
        const transactions = this.tradesToTransactions(trades);

        // Calculate Section 111A (STCG on equity)
        const stcg111A = transactions.filter(t => t.taxSection === '111A');
        const stcg111ATotal = {
            fullValue: stcg111A.reduce((sum, t) => sum + t.saleValue, 0),
            costOfAcquisition: stcg111A.reduce((sum, t) => sum + t.acquisitionCost, 0),
            expenses: stcg111A.reduce((sum, t) => sum + t.expenses, 0),
            gains: stcg111A.reduce((sum, t) => sum + t.gain, 0),
            taxRate: STCG_TAX_RATE as 0.15
        };

        // Calculate STCG on other assets
        const stcgOther = transactions.filter(t => t.gainType === 'STCG' && t.taxSection !== '111A');
        const stcgOtherTotal = {
            fullValue: stcgOther.reduce((sum, t) => sum + t.saleValue, 0),
            costOfAcquisition: stcgOther.reduce((sum, t) => sum + t.acquisitionCost, 0),
            gains: stcgOther.reduce((sum, t) => sum + t.gain, 0)
        };

        // Calculate Section 112A (LTCG on equity)
        const ltcg112A = transactions.filter(t => t.taxSection === '112A');
        const ltcg112AGainsBeforeExemption = ltcg112A.reduce((sum, t) => sum + Math.max(0, t.gain), 0);
        const ltcg112AExemption = Math.min(ltcg112AGainsBeforeExemption, LTCG_EXEMPTION_LIMIT);
        const ltcg112ATotal = {
            fullValue: ltcg112A.reduce((sum, t) => sum + t.saleValue, 0),
            costOfAcquisition: ltcg112A.reduce((sum, t) => sum + t.acquisitionCost, 0),
            expenses: ltcg112A.reduce((sum, t) => sum + t.expenses, 0),
            gainsBeforeExemption: ltcg112AGainsBeforeExemption,
            exemption: ltcg112AExemption,
            taxableGains: Math.max(0, ltcg112AGainsBeforeExemption - ltcg112AExemption),
            taxRate: LTCG_TAX_RATE as 0.125
        };

        // Calculate Section 112 (LTCG on other assets)
        const ltcg112 = transactions.filter(t => t.taxSection === '112');
        const ltcg112Total = {
            fullValue: ltcg112.reduce((sum, t) => sum + t.saleValue, 0),
            indexedCost: ltcg112.reduce((sum, t) => sum + t.acquisitionCost, 0), // Would apply CII in real impl
            gains: ltcg112.reduce((sum, t) => sum + t.gain, 0),
            taxRate: 0.20 as 0.20
        };

        const totalSTCG = stcg111ATotal.gains + stcgOtherTotal.gains;
        const totalLTCG = ltcg112ATotal.taxableGains + ltcg112Total.gains;

        // Calculate estimated tax
        const estimatedTax =
            Math.max(0, stcg111ATotal.gains) * STCG_TAX_RATE +
            ltcg112ATotal.taxableGains * LTCG_TAX_RATE +
            Math.max(0, ltcg112Total.gains) * 0.20;

        const schedule: ScheduleCG = {
            assessmentYear: this.assessmentYear,
            shortTermGains: {
                section111A: stcg111ATotal,
                otherAssets: stcgOtherTotal,
                totalSTCG
            },
            longTermGains: {
                section112A: ltcg112ATotal,
                section112: ltcg112Total,
                totalLTCG
            },
            summary: {
                grossSTCG: totalSTCG,
                grossLTCG: ltcg112ATotal.gainsBeforeExemption + ltcg112Total.gains,
                exemptionsApplied: ltcg112AExemption,
                netTaxableGains: totalSTCG + totalLTCG,
                estimatedTax: Math.round(estimatedTax)
            },
            deductions: {
                section54: 0,
                section54F: 0,
                section54EC: 0,
                totalDeductions: 0
            }
        };

        return { schedule, transactions };
    }

    // Export as JSON file
    exportAsJSON(schedule: ScheduleCG, transactions: CGTransaction[]): string {
        const exportData = {
            generatedAt: new Date().toISOString(),
            generatedBy: 'Wealth Aggregator',
            version: '1.0',
            assessmentYear: schedule.assessmentYear,
            scheduleCG: schedule,
            transactionDetails: transactions,
            disclaimer: 'This is an auto-generated report for reference only. Please verify with your CA before filing ITR.'
        };
        return JSON.stringify(exportData, null, 2);
    }

    // Download JSON file
    downloadJSON(schedule: ScheduleCG, transactions: CGTransaction[], filename?: string): void {
        const json = this.exportAsJSON(schedule, transactions);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `ITR_ScheduleCG_AY${schedule.assessmentYear}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

export default ITRGeneratorService;
