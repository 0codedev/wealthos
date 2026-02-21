/**
 * WealthOS 90-Day Predictive Cashflow & Runway Forecaster
 * Forecasts bank balance trajectories across 30, 60, and 90 days
 * by modeling recurring monthly debits (SIPs, Credit Card cycles, Rent, EMI)
 * against projected income deposits.
 */

export interface RecurringDebitPattern {
    id: string;
    label: string;
    amount: number;
    dayOfMonth: number;
    category: 'SIP' | 'RENT' | 'CREDIT_CARD' | 'EMI' | 'UTILITY' | 'SUBSCRIPTION';
}

export interface CashflowForecastDay {
    date: string;
    projectedBalance: number;
    incoming: number;
    outgoing: number;
    events: string[];
    isLowBuffer: boolean;
}

export interface CashflowForecastResult {
    currentLiquidity: number;
    minimumProjectedBalance: number;
    lowestBalanceDate: string;
    daysUntilLowest: number;
    hasLiquidityRisk: boolean;
    safetyThreshold: number;
    timeline: CashflowForecastDay[];
}

export function computeCashflowRunway(
    currentBalance: number,
    monthlyIncome = 150000,
    salaryCreditDay = 1,
    recurringDebits: RecurringDebitPattern[] = [],
    safetyThreshold = 50000,
    forecastDays = 90
): CashflowForecastResult {
    const defaultDebits: RecurringDebitPattern[] = recurringDebits.length > 0 ? recurringDebits : [
        { id: 'd1', label: 'Mutual Fund SIPs', amount: 35000, dayOfMonth: 5, category: 'SIP' },
        { id: 'd2', label: 'House Rent / Maintenance', amount: 28000, dayOfMonth: 3, category: 'RENT' },
        { id: 'd3', label: 'Credit Card Bill 1', amount: 22000, dayOfMonth: 12, category: 'CREDIT_CARD' },
        { id: 'd4', label: 'Credit Card Bill 2', amount: 14000, dayOfMonth: 18, category: 'CREDIT_CARD' },
        { id: 'd5', label: 'Car Loan / EMI', amount: 15000, dayOfMonth: 10, category: 'EMI' },
        { id: 'd6', label: 'Cloud & Subscriptions', amount: 4500, dayOfMonth: 25, category: 'SUBSCRIPTION' },
    ];

    let runningBalance = currentBalance;
    let minBalance = currentBalance;
    let lowestDate = new Date().toISOString().split('T')[0];
    let daysToLowest = 0;

    const timeline: CashflowForecastDay[] = [];
    const today = new Date();

    for (let i = 0; i < forecastDays; i++) {
        const currentDate = new Date(today.getTime() + (i * 24 * 60 * 60 * 1000));
        const dayOfMonth = currentDate.getDate();
        const dateStr = currentDate.toISOString().split('T')[0];

        let dayIncoming = 0;
        let dayOutgoing = 0;
        const dayEvents: string[] = [];

        // Salary / Income Credit
        if (dayOfMonth === salaryCreditDay) {
            dayIncoming += monthlyIncome;
            dayEvents.push(`Salary Credit (+₹${monthlyIncome.toLocaleString('en-IN')})`);
        }

        // Check recurring debits on this day
        defaultDebits.forEach(d => {
            if (d.dayOfMonth === dayOfMonth) {
                dayOutgoing += d.amount;
                dayEvents.push(`${d.label} (-₹${d.amount.toLocaleString('en-IN')})`);
            }
        });

        runningBalance = runningBalance + dayIncoming - dayOutgoing;

        if (runningBalance < minBalance) {
            minBalance = runningBalance;
            lowestDate = dateStr;
            daysToLowest = i;
        }

        timeline.push({
            date: dateStr,
            projectedBalance: runningBalance,
            incoming: dayIncoming,
            outgoing: dayOutgoing,
            events: dayEvents,
            isLowBuffer: runningBalance < safetyThreshold
        });
    }

    return {
        currentLiquidity: currentBalance,
        minimumProjectedBalance: minBalance,
        lowestBalanceDate: lowestDate,
        daysUntilLowest: daysToLowest,
        hasLiquidityRisk: minBalance < safetyThreshold,
        safetyThreshold,
        timeline
    };
}
