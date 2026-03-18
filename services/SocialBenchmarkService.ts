
import { logger } from './Logger';

export interface BenchmarkData {
    category: string;
    userValue: number;
    benchmarkAvg: number;
    percentile: number;
    description: string;
}

class SocialBenchmarkService {
    private static instance: SocialBenchmarkService;

    private constructor() {}

    public static getInstance(): SocialBenchmarkService {
        if (!SocialBenchmarkService.instance) {
            SocialBenchmarkService.instance = new SocialBenchmarkService();
        }
        return SocialBenchmarkService.instance;
    }

    /**
     * Compare user stats with retail community benchmarks.
     * Data sourced from synthetic distribution of Indian retail investors (NSE/SEBI reports).
     */
    public async getBenchmarks(userStats: { xirr: number, winRate: number, diversification: number }): Promise<BenchmarkData[]> {
        // Benchmark Distribution (Simulated based on SEBI/NSE retail data)
        // Retail Average XIRR: ~12-14%
        // Retail Win Rate: ~40-45%
        // Retail Diversification: 4.2 assets avg
        
        return [
            {
                category: 'Annualized Returns (XIRR)',
                userValue: userStats.xirr,
                benchmarkAvg: 13.5,
                percentile: this.calculatePercentile(userStats.xirr, 13.5, 8),
                description: 'Performance relative to the average retail portfolio.'
            },
            {
                category: 'Trade Win Rate',
                userValue: userStats.winRate,
                benchmarkAvg: 42.0,
                percentile: this.calculatePercentile(userStats.winRate, 42.0, 15),
                description: 'Execution consistency compared to active traders.'
            },
            {
                category: 'Portfolio Diversification',
                userValue: userStats.diversification,
                benchmarkAvg: 4.0,
                percentile: this.calculatePercentile(userStats.diversification, 4.0, 2),
                description: 'Risk spread across asset classes.'
            }
        ];
    }

    private calculatePercentile(value: number, mean: number, stdDev: number): number {
        // Standard normal distribution approximation
        const z = (value - mean) / stdDev;
        const percentile = 0.5 * (1 + this.erf(z / Math.sqrt(2)));
        return Math.min(Math.round(percentile * 100), 99);
    }

    private erf(x: number): number {
        // Error function approximation
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x);

        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return sign * y;
    }
}

export const socialBenchmarkService = SocialBenchmarkService.getInstance();
