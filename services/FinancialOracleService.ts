import { runMonteCarlo, SimulationResult, YearlyPath } from '../utils/MonteCarlo';
import { llmPipeline } from './llm';
import { alphaCache } from '../lib/alphaCache';
import { logger } from './Logger';
import { Investment } from '../types';

export interface OracleScenario {
    id: string;
    name: string;
    isActive: boolean;
    type: 'JOB_LOSS' | 'MEDICAL_EMERGENCY' | 'BULL_MARKET' | 'RECESSION' | 'EARLY_RETIREMENT';
    params: any;
}

export interface OracleResult {
    baseline: SimulationResult;
    scenarios: Record<string, SimulationResult>;
    aiNarrative: string;
}

// Enhanced Monte Carlo with Scenario Modifiers
function runEnhancedMonteCarlo(
    currentPrincipal: number,
    monthlyContribution: number,
    years: number,
    targetWealth: number,
    baseReturn: number,
    volatility: number,
    scenarios: OracleScenario[]
): SimulationResult {
    const ITERATIONS = 2000;
    const finalWealths: number[] = [];
    const yearlyWealths: number[][] = Array(years + 1).fill(null).map(() => []);

    for (let i = 0; i < ITERATIONS; i++) {
        let wealth = currentPrincipal;
        yearlyWealths[0].push(wealth);

        for (let y = 1; y <= years; y++) {
            let yearlyReturn = baseReturn;
            let currentMonthlyContribution = monthlyContribution;

            // Apply Scenario Modifiers
            scenarios.filter(s => s.isActive).forEach(scenario => {
                switch (scenario.type) {
                    case 'JOB_LOSS':
                        if (y === scenario.params.startYear) {
                            currentMonthlyContribution = 0; // Simplified: 0 for the whole year
                        }
                        break;
                    case 'MEDICAL_EMERGENCY':
                        if (y === scenario.params.year) {
                            wealth -= scenario.params.cost;
                        }
                        break;
                    case 'BULL_MARKET':
                        yearlyReturn += scenario.params.boost;
                        break;
                    case 'RECESSION':
                        if (y === scenario.params.year) {
                            yearlyReturn -= scenario.params.drawdown;
                        }
                        break;
                    case 'EARLY_RETIREMENT':
                        if (y >= scenario.params.age - scenario.params.currentAge) {
                            currentMonthlyContribution = -scenario.params.withdrawalAmount;
                        }
                        break;
                }
            });

            // Standard Normal Random Walk (Yearly simplified for speed/readability in service)
            const u1 = Math.random();
            const u2 = Math.random();
            const shock = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
            
            const periodReturn = yearlyReturn + (volatility * shock);
            
            // Compound wealth: (Wealth + Contributions) * (1 + Return)
            // Using a simple mid-year contribution assumption
            wealth = Math.max(0, (wealth + (currentMonthlyContribution * 6)) * (1 + periodReturn) + (currentMonthlyContribution * 6));
            yearlyWealths[y].push(wealth);
        }
        finalWealths.push(wealth);
    }

    // Sort and calculate percentiles (reusing logic from MonteCarlo.ts)
    finalWealths.sort((a, b) => a - b);
    yearlyWealths.forEach(arr => arr.sort((a, b) => a - b));

    const percentile = (arr: number[], p: number) => arr[Math.min(Math.floor(arr.length * p), arr.length - 1)];

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

    const mean = finalWealths.reduce((a, b) => a + b, 0) / finalWealths.length;
    const successes = finalWealths.filter(w => w >= targetWealth).length;

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
            std: 0, // Simplified
            min: finalWealths[0],
            max: finalWealths[finalWealths.length - 1],
        }
    };
}

export class FinancialOracleService {
    private static instance: FinancialOracleService;

    private constructor() {}

    public static getInstance(): FinancialOracleService {
        if (!FinancialOracleService.instance) {
            FinancialOracleService.instance = new FinancialOracleService();
        }
        return FinancialOracleService.instance;
    }

    public async runOracle(
        investments: Investment[],
        monthlyContribution: number,
        years: number,
        targetWealth: number,
        scenarios: OracleScenario[]
    ): Promise<OracleResult> {
        const totalPrincipal = investments.reduce((sum, inv) => sum + (inv.currentValue || 0), 0);
        const baseReturn = 0.12; // Default 12%
        const volatility = 0.18; // Default 18%

        // 1. Run Baseline
        const baseline = runEnhancedMonteCarlo(
            totalPrincipal,
            monthlyContribution,
            years,
            targetWealth,
            baseReturn,
            volatility,
            []
        );

        // 2. Run Individual Scenarios
        const scenarioResults: Record<string, SimulationResult> = {};
        scenarios.forEach(s => {
            scenarioResults[s.id] = runEnhancedMonteCarlo(
                totalPrincipal,
                monthlyContribution,
                years,
                targetWealth,
                baseReturn,
                volatility,
                [s]
            );
        });

        // 3. Generate AI Narrative
        const aiNarrative = await this.generateNarrative(totalPrincipal, baseline, scenarioResults, scenarios);

        return {
            baseline,
            scenarios: scenarioResults,
            aiNarrative
        };
    }

    private async generateNarrative(
        principal: number,
        baseline: SimulationResult,
        scenarioResults: Record<string, SimulationResult>,
        scenarios: OracleScenario[]
    ): Promise<string> {
        const stateHash = this.hashState(principal, baseline);
        const cached = await alphaCache.get(`oracle_narrative:${stateHash}`);
        if (cached && !cached.isStale) return cached.data;

        const prompt = `
            You are the "Financial Oracle", an advanced AI quantitative analyst. 
            Analyze these wealth projection results for a user's portfolio.
            
            CURRENT PRINCIPAL: ₹${(principal / 10000000).toFixed(2)} Cr
            BASELINE PROJECTED (20 Years):
            - P50 (Median): ₹${(baseline.percentiles.p50 / 10000000).toFixed(2)} Cr
            - P95 (Optimistic): ₹${(baseline.percentiles.p95 / 10000000).toFixed(2)} Cr
            - P5 (Pessimistic): ₹${(baseline.percentiles.p5 / 10000000).toFixed(2)} Cr
            - Success Probability: ${baseline.successProbability.toFixed(1)}%
            
            ACTIVE SCENARIOS:
            ${scenarios.filter(s => s.isActive).map(s => {
                const res = scenarioResults[s.id];
                return `- ${s.name}: Projected ₹${(res.percentiles.p50 / 10000000).toFixed(2)} Cr (P50)`;
            }).join('\n')}

            GOAL: Generate a personalized 3-paragraph narrative.
            1. Paragraph 1: Explain what these numbers mean in plain English. Are they on track?
            2. Paragraph 2: What are the biggest risk factors based on the P5 outcome and active scenarios?
            3. Paragraph 3: Specific actions to improve their P95 outcome (optimistic ceiling).

            STRICT RULES:
            - Use a professional, slightly prophetic, yet data-backed tone.
            - Be concise but high-impact.
            - Format with Markdown.
        `;

        try {
            const response = await llmPipeline(prompt, {
                modelOverride: 'gemini-3.1-pro-preview',
                requireHighIntelligence: true
            });
            
            await alphaCache.set(`oracle_narrative:${stateHash}`, response.text, 24);
            return response.text;
        } catch (error) {
            logger.error("FinancialOracle: Narrative generation failed", error);
            return "The oracle is momentarily clouded. Your numbers are solid, but a qualitative analysis is unavailable.";
        }
    }

    private hashState(principal: number, baseline: SimulationResult): string {
        const str = `${principal}_${baseline.percentiles.p50}_${baseline.successProbability}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }
}

export const financialOracleService = FinancialOracleService.getInstance();
