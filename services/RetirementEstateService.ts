/**
 * RetirementEstateService - Healthcare modeling, bucket strategy, estate planning
 */

import { Investment } from '../types';

// ==================== HEALTHCARE EXPENSE MODELING ====================

export interface HealthcareProjection {
    currentAnnualCost: number;
    projectedCosts: Array<{ age: number; cost: number; inflationAdjusted: number }>;
    totalLifetimeCost: number;
    recommendedHealthCorpus: number;
    insuranceCoverage: number;
    gap: number;
}

interface HealthcareParams {
    currentAge: number;
    retirementAge: number;
    lifeExpectancy: number;
    currentAnnualHealthCost: number;
    healthcareInflation: number; // Usually 10-15% in India
    insuranceCoverage: number;
}

export function modelHealthcareExpenses(params: HealthcareParams): HealthcareProjection {
    const {
        currentAge,
        retirementAge,
        lifeExpectancy,
        currentAnnualHealthCost,
        healthcareInflation = 12,
        insuranceCoverage = 0
    } = params;

    const projectedCosts: HealthcareProjection['projectedCosts'] = [];
    let totalLifetimeCost = 0;
    const generalInflation = 6;

    for (let age = retirementAge; age <= lifeExpectancy; age++) {
        const yearsFromNow = age - currentAge;

        // Healthcare costs typically increase faster after 60
        const ageFactor = age > 70 ? 1.5 : age > 60 ? 1.2 : 1.0;

        // Project cost with healthcare inflation
        const nominalCost = currentAnnualHealthCost * Math.pow(1 + healthcareInflation / 100, yearsFromNow) * ageFactor;

        // Adjust for general inflation to get real value
        const inflationAdjusted = nominalCost / Math.pow(1 + generalInflation / 100, yearsFromNow);

        projectedCosts.push({ age, cost: Math.round(nominalCost), inflationAdjusted: Math.round(inflationAdjusted) });
        totalLifetimeCost += nominalCost;
    }

    // Recommended corpus = total costs with buffer
    const recommendedHealthCorpus = Math.round(totalLifetimeCost * 1.2);
    const gap = Math.max(0, recommendedHealthCorpus - insuranceCoverage);

    return {
        currentAnnualCost: currentAnnualHealthCost,
        projectedCosts,
        totalLifetimeCost: Math.round(totalLifetimeCost),
        recommendedHealthCorpus,
        insuranceCoverage,
        gap
    };
}

// ==================== BUCKET STRATEGY ====================

export interface RetirementBucket {
    name: string;
    purpose: string;
    timeHorizon: string;
    allocation: number;
    suggestedInvestments: string[];
    riskLevel: 'Low' | 'Medium' | 'High';
    expectedReturn: number;
}

export const RETIREMENT_BUCKETS: RetirementBucket[] = [
    {
        name: 'Bucket 1: Immediate',
        purpose: 'Living expenses for next 1-2 years',
        timeHorizon: '0-2 years',
        allocation: 20,
        suggestedInvestments: ['Savings Account', 'Liquid Funds', 'Short-term FDs', 'SCSS'],
        riskLevel: 'Low',
        expectedReturn: 5
    },
    {
        name: 'Bucket 2: Near-term',
        purpose: 'Expenses for years 3-7',
        timeHorizon: '2-7 years',
        allocation: 30,
        suggestedInvestments: ['Debt Mutual Funds', 'Corporate Bonds', 'PPF', 'RBI Bonds'],
        riskLevel: 'Low',
        expectedReturn: 7
    },
    {
        name: 'Bucket 3: Growth',
        purpose: 'Long-term growth, refills other buckets',
        timeHorizon: '7+ years',
        allocation: 50,
        suggestedInvestments: ['Index Funds', 'Blue-chip Stocks', 'Balanced Funds', 'Gold'],
        riskLevel: 'Medium',
        expectedReturn: 12
    }
];

export interface BucketPlan {
    totalCorpus: number;
    buckets: Array<{
        bucket: RetirementBucket;
        amount: number;
        monthlyWithdrawal: number;
        yearsOfExpenses: number;
    }>;
    sequenceRiskMitigation: string;
}

export function createBucketPlan(
    totalCorpus: number,
    monthlyExpenses: number
): BucketPlan {
    const annualExpenses = monthlyExpenses * 12;

    const buckets = RETIREMENT_BUCKETS.map(bucket => {
        const amount = totalCorpus * bucket.allocation / 100;
        const monthlyWithdrawal = bucket.name.includes('Immediate') ? monthlyExpenses : 0;
        const yearsOfExpenses = amount / annualExpenses;

        return {
            bucket,
            amount: Math.round(amount),
            monthlyWithdrawal,
            yearsOfExpenses: Math.round(yearsOfExpenses * 10) / 10
        };
    });

    return {
        totalCorpus,
        buckets,
        sequenceRiskMitigation: 'Bucket 1 provides 2 years of expenses without selling Bucket 3 during market downturns. Refill Bucket 1 from Bucket 2 annually, and Bucket 2 from Bucket 3 every 5 years during market highs.'
    };
}

// ==================== PENSION INCOME INTEGRATION ====================

export interface PensionSource {
    id: string;
    name: string;
    type: 'EPF' | 'PPF' | 'NPS' | 'Annuity' | 'Corporate Pension' | 'Other';
    currentValue: number;
    monthlyContribution: number;
    employerContribution?: number;
    expectedRetirementValue: number;
    monthlyPension?: number;
    startAge: number;
}

export function calculatePensionIncome(
    sources: PensionSource[],
    currentAge: number,
    retirementAge: number
): {
    totalAccumulatedValue: number;
    estimatedMonthlyPension: number;
    incomeBySource: Array<{ name: string; monthly: number; percentage: number }>;
} {
    const yearsToRetirement = retirementAge - currentAge;
    let totalValue = 0;
    let totalMonthlyPension = 0;

    const incomeBySource = sources.map(source => {
        // Project future value
        let projectedValue = source.currentValue;
        const totalMonthlyContrib = source.monthlyContribution + (source.employerContribution || 0);

        // Different growth rates for different types
        const growthRates: Record<string, number> = {
            'EPF': 8.1,
            'PPF': 7.1,
            'NPS': 10,
            'Annuity': 6,
            'Corporate Pension': 8,
            'Other': 7
        };

        const rate = growthRates[source.type] / 100 / 12;
        const months = yearsToRetirement * 12;

        // Future value of current amount
        projectedValue = source.currentValue * Math.pow(1 + rate, months);

        // Future value of SIP
        if (rate > 0 && totalMonthlyContrib > 0) {
            projectedValue += totalMonthlyContrib * ((Math.pow(1 + rate, months) - 1) / rate) * (1 + rate);
        }

        totalValue += projectedValue;

        // Estimate monthly pension (4% withdrawal rate or actual pension)
        const monthlyPension = source.monthlyPension || (projectedValue * 0.04 / 12);
        totalMonthlyPension += monthlyPension;

        return {
            name: source.name,
            monthly: Math.round(monthlyPension),
            percentage: 0 // Calculate after totals
        };
    });

    // Calculate percentages
    incomeBySource.forEach(source => {
        source.percentage = Math.round((source.monthly / totalMonthlyPension) * 100);
    });

    return {
        totalAccumulatedValue: Math.round(totalValue),
        estimatedMonthlyPension: Math.round(totalMonthlyPension),
        incomeBySource
    };
}

// ==================== INSURANCE POLICY TRACKER ====================

export interface InsurancePolicy {
    id: string;
    type: 'Term Life' | 'Health' | 'Critical Illness' | 'Accident' | 'Motor' | 'Home' | 'ULIP';
    provider: string;
    policyNumber: string;
    sumAssured: number;
    premium: number;
    premiumFrequency: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Annual';
    startDate: string;
    endDate: string;
    nominee: string;
    status: 'Active' | 'Lapsed' | 'Surrendered';
    nextPremiumDue: string;
    maturityValue?: number;
}

export function analyzeInsuranceCoverage(
    policies: InsurancePolicy[],
    annualIncome: number,
    age: number
): {
    termCoverageRatio: number; // Should be 10-15x income
    healthCoverage: number;
    totalAnnualPremium: number;
    premiumToIncomeRatio: number;
    recommendations: string[];
    upcomingRenewals: InsurancePolicy[];
} {
    const termPolicies = policies.filter(p => p.type === 'Term Life' && p.status === 'Active');
    const healthPolicies = policies.filter(p => p.type === 'Health' && p.status === 'Active');

    const termCoverage = termPolicies.reduce((sum, p) => sum + p.sumAssured, 0);
    const healthCoverage = healthPolicies.reduce((sum, p) => sum + p.sumAssured, 0);

    const totalAnnualPremium = policies
        .filter(p => p.status === 'Active')
        .reduce((sum, p) => {
            const multiplier = { 'Monthly': 12, 'Quarterly': 4, 'Half-Yearly': 2, 'Annual': 1 };
            return sum + p.premium * multiplier[p.premiumFrequency];
        }, 0);

    const recommendations: string[] = [];
    const requiredTermCover = annualIncome * 12;

    if (termCoverage < requiredTermCover) {
        recommendations.push(`Increase term cover by ₹${((requiredTermCover - termCoverage) / 100000).toFixed(0)}L`);
    }

    if (healthCoverage < 1000000) {
        recommendations.push('Consider increasing health cover to at least ₹10L');
    }

    if (age > 35 && !policies.some(p => p.type === 'Critical Illness')) {
        recommendations.push('Consider adding critical illness coverage');
    }

    const upcomingRenewals = policies
        .filter(p => {
            const dueDate = new Date(p.nextPremiumDue);
            const daysUntilDue = (dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
            return daysUntilDue <= 30 && daysUntilDue >= 0;
        })
        .sort((a, b) => new Date(a.nextPremiumDue).getTime() - new Date(b.nextPremiumDue).getTime());

    return {
        termCoverageRatio: termCoverage / annualIncome,
        healthCoverage,
        totalAnnualPremium,
        premiumToIncomeRatio: (totalAnnualPremium / annualIncome) * 100,
        recommendations,
        upcomingRenewals
    };
}

// ==================== IMPORTANT DOCUMENTS STORAGE ====================

export interface ImportantDocument {
    id: string;
    name: string;
    category: 'Identity' | 'Financial' | 'Property' | 'Insurance' | 'Legal' | 'Medical' | 'Other';
    description?: string;
    expiryDate?: string;
    reminderDays?: number;
    fileType?: string;
    lastUpdated: string;
    tags?: string[];
}

export const DOCUMENT_CATEGORIES = [
    {
        category: 'Identity',
        suggestions: ['Aadhaar Card', 'PAN Card', 'Passport', 'Voter ID', 'Driving License']
    },
    {
        category: 'Financial',
        suggestions: ['Bank Statements', 'Demat Account', 'Tax Returns', 'Form 16', 'Investment Proofs']
    },
    {
        category: 'Property',
        suggestions: ['Property Deed', 'Registration Papers', 'NOC', 'Electricity Bill', 'Property Tax Receipt']
    },
    {
        category: 'Insurance',
        suggestions: ['Term Policy', 'Health Policy', 'Vehicle Insurance', 'Home Insurance']
    },
    {
        category: 'Legal',
        suggestions: ['Will', 'Power of Attorney', 'Trust Deed', 'Marriage Certificate', 'Birth Certificate']
    },
    {
        category: 'Medical',
        suggestions: ['Medical Records', 'Prescriptions', 'Lab Reports', 'Vaccination Records']
    }
];

export function checkDocumentExpiry(documents: ImportantDocument[]): {
    expired: ImportantDocument[];
    expiringSoon: ImportantDocument[];
    valid: ImportantDocument[];
} {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const expired: ImportantDocument[] = [];
    const expiringSoon: ImportantDocument[] = [];
    const valid: ImportantDocument[] = [];

    documents.forEach(doc => {
        if (!doc.expiryDate) {
            valid.push(doc);
            return;
        }

        const expiry = new Date(doc.expiryDate);
        if (expiry < now) {
            expired.push(doc);
        } else if (expiry < thirtyDaysFromNow) {
            expiringSoon.push(doc);
        } else {
            valid.push(doc);
        }
    });

    return { expired, expiringSoon, valid };
}

// ==================== EMERGENCY CONTACTS ====================

export interface EmergencyContact {
    id: string;
    name: string;
    relationship: string;
    phone: string;
    email?: string;
    address?: string;
    isPrimary: boolean;
    hasFinancialAccess: boolean;
    notes?: string;
}

export function generateICEReport(
    contacts: EmergencyContact[],
    documents: ImportantDocument[],
    policies: InsurancePolicy[],
    investments: Investment[]
): string {
    const totalValue = investments.reduce((sum, inv) => sum + inv.currentValue, 0);
    const primaryContact = contacts.find(c => c.isPrimary);

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Emergency (ICE) Report</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
        h1 { color: #dc2626; border-bottom: 2px solid #dc2626; padding-bottom: 10px; }
        h2 { color: #1e40af; margin-top: 30px; }
        .alert { background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 10px; text-align: left; }
        th { background: #f3f4f6; }
        .primary { background: #fef3c7; }
    </style>
</head>
<body>
    <h1>🚨 In Case of Emergency (ICE) Report</h1>
    
    <div class="alert">
        <strong>Primary Contact:</strong> ${primaryContact?.name || 'Not Set'} - ${primaryContact?.phone || 'N/A'}
    </div>

    <h2>Emergency Contacts</h2>
    <table>
        <tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Financial Access</th></tr>
        ${contacts.map(c => `
            <tr class="${c.isPrimary ? 'primary' : ''}">
                <td>${c.name}${c.isPrimary ? ' ⭐' : ''}</td>
                <td>${c.relationship}</td>
                <td>${c.phone}</td>
                <td>${c.hasFinancialAccess ? '✅ Yes' : '❌ No'}</td>
            </tr>
        `).join('')}
    </table>

    <h2>Insurance Policies</h2>
    <table>
        <tr><th>Type</th><th>Provider</th><th>Sum Assured</th><th>Policy No.</th><th>Nominee</th></tr>
        ${policies.filter(p => p.status === 'Active').map(p => `
            <tr>
                <td>${p.type}</td>
                <td>${p.provider}</td>
                <td>₹${p.sumAssured.toLocaleString()}</td>
                <td>${p.policyNumber}</td>
                <td>${p.nominee}</td>
            </tr>
        `).join('')}
    </table>

    <h2>Investment Summary</h2>
    <p><strong>Total Portfolio Value:</strong> ₹${totalValue.toLocaleString()}</p>
    <table>
        <tr><th>Asset</th><th>Type</th><th>Platform</th><th>Value</th></tr>
        ${investments.slice(0, 10).map(inv => `
            <tr>
                <td>${inv.name}</td>
                <td>${inv.type}</td>
                <td>${inv.platform || '-'}</td>
                <td>₹${inv.currentValue.toLocaleString()}</td>
            </tr>
        `).join('')}
    </table>

    <h2>Important Documents Location</h2>
    <table>
        <tr><th>Document</th><th>Category</th><th>Notes</th></tr>
        ${documents.slice(0, 15).map(d => `
            <tr>
                <td>${d.name}</td>
                <td>${d.category}</td>
                <td>${d.description || '-'}</td>
            </tr>
        `).join('')}
    </table>

    <p style="color: #6b7280; font-size: 12px; margin-top: 40px; text-align: center;">
        Generated by Wealth Aggregator • ${new Date().toLocaleDateString()} • CONFIDENTIAL
    </p>
</body>
</html>
    `;
}

export default {
    modelHealthcareExpenses,
    RETIREMENT_BUCKETS,
    createBucketPlan,
    calculatePensionIncome,
    analyzeInsuranceCoverage,
    DOCUMENT_CATEGORIES,
    checkDocumentExpiry,
    generateICEReport
};
