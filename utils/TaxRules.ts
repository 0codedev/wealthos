
import { Investment } from '../types';

export interface TaxOpportunity {
    investmentId: string;
    name: string;
    ticker: string;
    unrealizedLoss: number;
    potentialTaxSaving: number;
    lossPercentage: number;
}

const getTaxRate = (inv: Investment): number => {
    const parts = inv.id?.split('_') || [];
    let purchaseDate = new Date(inv.lastUpdated);
    if (parts.length >= 2) {
        const partVal = parts[1];
        if (partVal !== undefined) {
            const timestamp = parseInt(partVal, 10);
            if (!isNaN(timestamp) && timestamp > 1600000000000) {
                purchaseDate = new Date(timestamp);
            }
        }
    }
    const daysHeld = (Date.now() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24);

    // Short Term (20%) vs Long Term (12.5%) for Equities (using 365 day threshold)
    return daysHeld < 365 ? 0.20 : 0.125;
};

export const findHarvestingOpportunities = (investments: Investment[]): TaxOpportunity[] => {
    const opportunities: TaxOpportunity[] = [];

    investments.forEach(inv => {
        // Only consider currently held assets (quantity > 0 implies active, though schema varies)
        if (inv.currentValue < inv.investedAmount) {
            const loss = inv.investedAmount - inv.currentValue;
            if (loss > 100) { // Ignore micro-losses < ₹100
                const applicableTaxRate = getTaxRate(inv);
                opportunities.push({
                    investmentId: inv.id!,
                    name: inv.name,
                    ticker: inv.ticker || inv.name,
                    unrealizedLoss: loss,
                    potentialTaxSaving: loss * applicableTaxRate, // Alpha generated
                    lossPercentage: (loss / inv.investedAmount) * 100
                });
            }
        }
    });

    // Sort by Highest Tax Saving Potential
    return opportunities.sort((a, b) => b.potentialTaxSaving - a.potentialTaxSaving);
};
