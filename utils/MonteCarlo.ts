/**
 * Enhanced Monte Carlo Simulation Engine for Wealth Projection
 * Version 2.0 - With Paths, Scenarios, and Black Swan Support
 */

export interface SimulationResult {
    percentiles: {
        p5: number;   // 5th percentile (very pessimistic)
        p10: number;  // 10th percentile
        p25: number;  // 25th percentile
        p50: number;  // Median
        p75: number;  // 75th percentile
        p90: number;  // 90th percentile  
        p95: number;  // 95th percentile (very optimistic)
    };
    successProbability: number;
    yearlyPaths: YearlyPath[]; // For charting confidence bands
    statistics: {
        mean: number;
        std: number;
        min: number;
        max: number;
    };
}

export interface YearlyPath {
    year: number;
    p5: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
}

export interface Scenario {
    name: string;
    expectedReturn: number;
    volatility: number;
    description: string;
}

export const PRESET_SCENARIOS: Scenario[] = [
    { name: 'Conservative', expectedReturn: 0.08, volatility: 0.10, description: 'Debt-heavy, low risk' },
    { name: 'Balanced', expectedReturn: 0.11, volatility: 0.14, description: 'Mixed equity-debt' },
    { name: 'Aggressive', expectedReturn: 0.14, volatility: 0.20, description: 'Equity-heavy growth' },
    { name: 'Index Only', expectedReturn: 0.12, volatility: 0.15, description: 'Nifty 50 benchmark' },
];

export interface BlackSwanEvent {
    name: string;
    impact: number; // -1 to 0 (percentage drop)
    recoveryYears: number;
    probability: number; // Annual probability
}

export const BLACK_SWAN_EVENTS: BlackSwanEvent[] = [
    { name: '2008 Financial Crisis', impact: -0.52, recoveryYears: 4, probability: 0.05 },
    { name: 'COVID-19 Crash', impact: -0.38, recoveryYears: 0.5, probability: 0.03 },
    { name: 'Tech Bubble Burst', impact: -0.45, recoveryYears: 3, probability: 0.04 },
    { name: 'Currency Crisis', impact: -0.30, recoveryYears: 2, probability: 0.06 },
    { name: 'Hyperinflation', impact: -0.60, recoveryYears: 5, probability: 0.02 },
    // New Scenarios
    { name: '1997 Asian Financial Crisis', impact: -0.35, recoveryYears: 2.5, probability: 0.04 },
    { name: 'Eurozone Debt Crisis (2011)', impact: -0.25, recoveryYears: 1.5, probability: 0.05 },
    { name: 'Flash Crash (2010)', impact: -0.10, recoveryYears: 0.1, probability: 0.08 },
    { name: 'Geopolitical Shock (War)', impact: -0.28, recoveryYears: 1, probability: 0.06 },
];

// Box-Muller transform for standard normal distribution
function randn_bm(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Calculate percentile from sorted array
function percentile(arr: number[], p: number): number {
    const index = Math.floor(arr.length * p);
    const val = arr[Math.min(index, arr.length - 1)];
    return val !== undefined ? val : 0;
}

export const runMonteCarlo = (
    currentPrincipal: number,
    monthlyContribution: number,
    years: number,
    targetWealth: number,
    expectedMeanReturn: number = 0.12,
    volatility: number = 0.15,
    includeBlackSwan: boolean = false
): SimulationResult => {
    const ITERATIONS = 1000;
    const finalWealths: number[] = [];
    const yearlyWealths: number[][] = Array(years + 1).fill(null).map(() => []);

    const monthlyReturnMean = expectedMeanReturn / 12;
    const monthlyVolatility = volatility / Math.sqrt(12);
    const months = years * 12;

    let successes = 0;

    for (let i = 0; i < ITERATIONS; i++) {
        let wealth = currentPrincipal;
        const year0 = yearlyWealths[0];
        if (year0) year0.push(wealth);

        for (let m = 0; m < months; m++) {
            const shock = randn_bm();
            let periodReturn = monthlyReturnMean + (monthlyVolatility * shock);

            // Black Swan injection (rare extreme events)
            if (includeBlackSwan && Math.random() < 0.001) { // ~1% annual chance
                periodReturn = -0.15 - Math.random() * 0.15; // -15% to -30% monthly crash
            }

            wealth = Math.max(0, wealth * (1 + periodReturn) + monthlyContribution);

            // Record yearly snapshots
            if ((m + 1) % 12 === 0) {
                const yearIndex = Math.floor((m + 1) / 12);
                const yearData = yearlyWealths[yearIndex];
                if (yearData) yearData.push(wealth);
            }
        }

        finalWealths.push(wealth);
        if (wealth >= targetWealth) successes++;
    }

    // Sort for percentile calculations
    finalWealths.sort((a, b) => a - b);
    yearlyWealths.forEach(arr => arr.sort((a, b) => a - b));

    // Calculate statistics
    const mean = finalWealths.reduce((a, b) => a + b, 0) / finalWealths.length;
    const variance = finalWealths.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / finalWealths.length;
    const std = Math.sqrt(variance);

    // Build yearly paths for charting
    const yearlyPaths: YearlyPath[] = yearlyWealths.map((yearData, idx) => ({
        year: idx,
        p5: percentile(yearData, 0.05),
        p10: percentile(yearData, 0.10),
        p25: percentile(yearData, 0.25),
        p50: percentile(yearData, 0.50),
        p75: percentile(yearData, 0.75),
        p90: percentile(yearData, 0.90),
        p95: percentile(yearData, 0.95),
    }));

    return {
        percentiles: {
            p5: percentile(finalWealths, 0.05),
            p10: percentile(finalWealths, 0.10),
            p25: percentile(finalWealths, 0.25),
            p50: percentile(finalWealths, 0.50),
            p75: percentile(finalWealths, 0.75),
            p90: percentile(finalWealths, 0.90),
            p95: percentile(finalWealths, 0.95),
        },
        successProbability: (successes / ITERATIONS) * 100,
        yearlyPaths,
        statistics: {
            mean,
            std,
            min: finalWealths[0] ?? 0,
            max: finalWealths[finalWealths.length - 1] ?? 0,
        }
    };
};

// Compare multiple scenarios
export const compareScenarios = (
    currentPrincipal: number,
    monthlyContribution: number,
    years: number,
    targetWealth: number,
    scenarios: Scenario[]
): Map<string, SimulationResult> => {
    const results = new Map<string, SimulationResult>();

    scenarios.forEach(scenario => {
        const result = runMonteCarlo(
            currentPrincipal,
            monthlyContribution,
            years,
            targetWealth,
            scenario.expectedReturn,
            scenario.volatility
        );
        results.set(scenario.name, result);
    });

    return results;
};

// Calculate recovery time after a black swan event
export const calculateRecoveryPath = (
    currentPrincipal: number,
    monthlyContribution: number,
    blackSwanEvent: BlackSwanEvent,
    years: number = 10
): YearlyPath[] => {
    const postCrashValue = currentPrincipal * (1 + blackSwanEvent.impact);
    const recoverySimulation = runMonteCarlo(
        postCrashValue,
        monthlyContribution,
        years,
        currentPrincipal, // Target: recover to pre-crash level
        0.12,
        0.15
    );

    return recoverySimulation.yearlyPaths;
};
