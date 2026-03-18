import { SCENARIOS } from './ScenarioLibrary';
import { portfolioDNAService } from './PortfolioDNAService';
import { Investment, InvestmentType } from '../types';
import { logger } from './Logger';

export interface StressTestResult {
  initialValue: number;
  var95: number;
  cvar95: number;
  avgMaxDrawdown: number;
  worstDrawdown: number;
  probLoss10: number;
  probLoss20: number;
  samplePaths: number[][];
  finalValuesSample: number[];
}

export class StressTestEngine {
  private worker: Worker | null = null;
  private onProgressCb: ((progress: number) => void) | null = null;
  private onCompleteCb: ((result: StressTestResult) => void) | null = null;
  private onErrorCb: ((err: string) => void) | null = null;

  constructor() {}

  /**
   * Spawns worker and runs the simulation
   */
  public runSimulation(
    investments: Investment[],
    scenarioName: string,
    customShocks: Record<string, number> = {},
    options: { numSimulations?: number; steps?: number } = {}
  ) {
    this.terminate();

    // 1. Resolve shocks
    const scenario = SCENARIOS[scenarioName];
    const baseShocks = scenario ? scenario.shocks : {};
    const shocks = { ...baseShocks, ...customShocks };

    // 2. Prepare holdings list
    const assets = investments.map(inv => {
      // Map asset volatility fallback if not defined in DNA exposures
      const isEquity = [InvestmentType.STOCKS, InvestmentType.MUTUAL_FUND, InvestmentType.ETF, InvestmentType.SMALLCASE].includes(inv.type);
      const isCrypto = inv.type === InvestmentType.CRYPTO;
      const defaultVol = isCrypto ? 65 : (isEquity ? 22 : 8);

      return {
        ticker: inv.ticker || inv.name,
        type: inv.type,
        weight: inv.currentValue,
        volatility: defaultVol, // will be overridden by real DNA volatility if available
        value: inv.currentValue
      };
    });

    // Clean zero-value holdings
    const activeAssets = assets.filter(a => a.value > 0);
    if (activeAssets.length === 0) {
      if (this.onErrorCb) this.onErrorCb('No active holdings to simulate.');
      return;
    }

    // 3. Obtain correlation matrix
    void this.startWorker(activeAssets, shocks, options);
  }

  private async startWorker(
    activeAssets: any[],
    shocks: Record<string, number>,
    options: any
  ) {
    try {
      // Fetch DNA report to use true volatilities and correlation matrix if possible
      const dummyInvestments = activeAssets.map(a => ({
        id: a.ticker,
        name: a.ticker,
        ticker: a.ticker,
        type: a.type as InvestmentType,
        investedAmount: a.value,
        currentValue: a.value,
        platform: 'Manual',
        lastUpdated: new Date().toISOString()
      }));

      const dna = await portfolioDNAService.generateDNAReport(dummyInvestments).catch(() => null);
      
      // Override default volatilities with OLS volatilities from DNA
      if (dna && dna.factorExposures.length > 0) {
        activeAssets.forEach(asset => {
          const exp = dna.factorExposures.find((e: any) => e.ticker.toUpperCase() === asset.ticker.toUpperCase());
          if (exp && exp.volatility > 0) {
            asset.volatility = exp.volatility;
          }
        });
      }

      const correlationMatrix = (dna && dna.correlationMatrix.tickers.length > 0)
        ? dna.correlationMatrix
        : { tickers: activeAssets.map(a => a.ticker), matrix: activeAssets.map((_, i) => activeAssets.map((_, j) => i === j ? 1 : 0.1)) };

      // Initialize Web Worker using Vite-compatible URL loading
      this.worker = new Worker(
        new URL('../workers/montecarlo.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (e: MessageEvent) => {
        const { type, progress, result, error } = e.data;
        if (type === 'PROGRESS' && this.onProgressCb) {
          this.onProgressCb(progress);
        } else if (type === 'COMPLETE' && this.onCompleteCb) {
          this.onCompleteCb(result);
        } else if (type === 'ERROR' && this.onErrorCb) {
          this.onErrorCb(error || 'Worker execution failed.');
        }
      };

      this.worker.onerror = (err) => {
        logger.error('[StressTestEngine] Worker errored', err);
        if (this.onErrorCb) this.onErrorCb(err.message);
      };

      // Dispatch task to worker
      this.worker.postMessage({
        assets: activeAssets,
        correlationMatrix,
        shocks,
        numSimulations: options.numSimulations || 2000,
        steps: options.steps || 252
      });

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[StressTestEngine] Spawning failed', err);
      if (this.onErrorCb) this.onErrorCb(message || 'Failed to start simulation.');
    }
  }

  public onProgress(cb: (p: number) => void): this {
    this.onProgressCb = cb;
    return this;
  }

  public onComplete(cb: (r: StressTestResult) => void): this {
    this.onCompleteCb = cb;
    return this;
  }

  public onError(cb: (e: string) => void): this {
    this.onErrorCb = cb;
    return this;
  }

  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export const stressTestEngine = new StressTestEngine();
export default stressTestEngine;
