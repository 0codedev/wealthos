/**
 * SIP (Systematic Investment Plan) Service
 * Handles SIP verification, calculation, and auto-application logic
 */

import { Investment } from '../types';

export interface SIPStatus {
    investmentId: string;
    name: string;
    sipAmount: number;
    sipDay: number;
    startDate: string;
    expectedInstallments: number;
    appliedInstallments: number;
    missedInstallments: number;
    pendingAmount: number;
    isUpToDate: boolean;
    nextDueDate: string;
    isDueToday: boolean;
}

export interface SIPSummary {
    totalSIPAssets: number;
    upToDateCount: number;
    pendingCount: number;
    totalMissedInstallments: number;
    totalPendingAmount: number;
    statuses: SIPStatus[];
}

/**
 * Calculate number of expected installments from start date to today
 * based on SIP day of month
 */
export function calculateExpectedInstallments(
    startDate: string,
    sipDay: number,
    frequency: 'Daily' | 'Monthly' = 'Monthly'
): number {
    const start = new Date(startDate);
    const today = new Date();

    // If start date is in the future, no installments expected
    if (start > today) return 0;

    if (frequency === 'Daily') {
        const diffTime = today.getTime() - start.getTime();
        return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }

    // Monthly calculation
    let installments = 0;
    const startYear = start.getFullYear();
    const startMonth = start.getMonth();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();

    // Calculate total months between start and now
    const totalMonths = (todayYear - startYear) * 12 + (todayMonth - startMonth);

    // For each month, check if SIP day has passed
    for (let m = 0; m <= totalMonths; m++) {
        const year = startYear + Math.floor((startMonth + m) / 12);
        const month = (startMonth + m) % 12;
        // Fix #9: Clamp sipDay to last day of month (e.g. 31 → 28 for Feb)
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        const clampedDay = Math.min(sipDay, lastDayOfMonth);
        const checkDate = new Date(year, month, clampedDay);

        // Only count if the SIP date has passed (or is today)
        if (checkDate <= today) {
            // Don't count months before start date's SIP day
            if (m === 0 && start.getDate() > clampedDay) continue;
            installments++;
        }
    }

    return installments;
}

/**
 * Get SIP status for a single investment
 */
export function verifySIPStatus(investment: Investment): SIPStatus | null {
    const { recurring } = investment;

    if (!recurring?.isEnabled || recurring.amount <= 0) {
        return null;
    }

    const sipDay = recurring.sipDay || 5; // Default to 5th of month
    const startDate = recurring.startDate || investment.lastUpdated;
    const appliedInstallments = recurring.installmentsApplied || 0;

    const expectedInstallments = calculateExpectedInstallments(
        startDate,
        sipDay,
        recurring.frequency as 'Daily' | 'Monthly'
    );

    const missedInstallments = Math.max(0, expectedInstallments - appliedInstallments);
    const pendingAmount = missedInstallments * recurring.amount;

    // Calculate next due date
    const today = new Date();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), sipDay);
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, sipDay);
    const nextDueDate = today.getDate() > sipDay ? nextMonth : thisMonth;

    // Check if today is SIP day
    const isDueToday = today.getDate() === sipDay;

    return {
        investmentId: investment.id,
        name: investment.name,
        sipAmount: recurring.amount,
        sipDay,
        startDate,
        expectedInstallments,
        appliedInstallments,
        missedInstallments,
        pendingAmount,
        isUpToDate: missedInstallments === 0,
        nextDueDate: nextDueDate.toISOString().split('T')[0],
        isDueToday
    };
}

/**
 * Get summary of all pending SIPs across investments
 */
export function getAllSIPStatuses(investments: Investment[]): SIPSummary {
    const statuses: SIPStatus[] = [];

    investments.forEach(inv => {
        const status = verifySIPStatus(inv);
        if (status) {
            statuses.push(status);
        }
    });

    const pendingStatuses = statuses.filter(s => !s.isUpToDate);

    return {
        totalSIPAssets: statuses.length,
        upToDateCount: statuses.filter(s => s.isUpToDate).length,
        pendingCount: pendingStatuses.length,
        totalMissedInstallments: pendingStatuses.reduce((sum, s) => sum + s.missedInstallments, 0),
        totalPendingAmount: pendingStatuses.reduce((sum, s) => sum + s.pendingAmount, 0),
        statuses
    };
}

/**
 * Calculate the update payload to apply SIP installments
 * Returns the updated invested and current values, and new installment count
 */
export function calculateSIPApplication(
    investment: Investment,
    installmentsToApply: number = 1
): {
    newInvestedAmount: number;
    newCurrentValue: number;
    newInstallmentsApplied: number;
    totalAdded: number;
} {
    const amount = investment.recurring?.amount || 0;
    const currentInstallments = investment.recurring?.installmentsApplied || 0;
    const totalAdded = amount * installmentsToApply;

    return {
        newInvestedAmount: investment.investedAmount + totalAdded,
        newCurrentValue: investment.currentValue + totalAdded,
        newInstallmentsApplied: currentInstallments + installmentsToApply,
        totalAdded
    };
}

/**
 * Check if today is SIP day for any investments
 */
export function getInvestmentsDueToday(investments: Investment[]): SIPStatus[] {
    const summary = getAllSIPStatuses(investments);
    return summary.statuses.filter(s => s.isDueToday && s.missedInstallments > 0);
}

/**
 * Format currency for display
 */
export function formatPendingAmount(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
}

export const SIPService = {
    calculateExpectedInstallments,
    verifySIPStatus,
    getAllSIPStatuses,
    calculateSIPApplication,
    getInvestmentsDueToday,
    formatPendingAmount
};

export default SIPService;
