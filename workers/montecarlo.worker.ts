/**
 * Portfolio Stress Test Monte Carlo Simulation Web Worker
 */

interface StressTestParams {
  assets: { ticker: string; type: string; weight: number; volatility: number; value: number }[];
  correlationMatrix: { tickers: string[]; matrix: number[][] };
  shocks: Record<string, number>; // Maps type or ticker to shock coefficient
  numSimulations?: number;
  steps?: number; // default 252 days
}

function generateGaussian(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function choleskyDecompose(matrix: number[][]): number[][] {
  const n = matrix.length;
  const l: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const rowI = l[i];
    const matrixRowI = matrix[i];
    if (!rowI || !matrixRowI) continue;
    for (let j = 0; j <= i; j++) {
      const rowJ = l[j];
      if (!rowJ) continue;
      let sum = 0;
      for (let k = 0; k < j; k++) {
        const valIK = rowI[k];
        const valJK = rowJ[k];
        if (valIK !== undefined && valJK !== undefined) {
          sum += valIK * valJK;
        }
      }
      if (i === j) {
        const matrixValII = matrixRowI[i];
        if (matrixValII !== undefined) {
          rowI[j] = Math.sqrt(Math.max(0, matrixValII - sum));
        }
      } else {
        const rowJValJJ = rowJ[j];
        const matrixValIJ = matrixRowI[j];
        if (rowJValJJ !== undefined && matrixValIJ !== undefined) {
          rowI[j] = rowJValJJ === 0 ? 0 : (matrixValIJ - sum) / rowJValJJ;
        }
      }
    }
  }
  return l;
}

self.onmessage = (e: MessageEvent) => {
  const { assets, correlationMatrix, shocks, numSimulations = 2000, steps = 252 } = e.data as StressTestParams;

  try {
    const n = assets.length;
    if (n === 0) {
      throw new Error('No assets in portfolio to stress test.');
    }

    // Map assets to correlation matrix indices
    const corrTickers = correlationMatrix.tickers.map(t => t.toUpperCase());
    const fullMatrix = correlationMatrix.matrix;

    // Build the correlation matrix for the active assets
    const activeMatrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      const activeRowI = activeMatrix[i];
      const assetI = assets[i];
      if (!activeRowI || !assetI) continue;
      for (let j = 0; j < n; j++) {
        if (i === j) {
          activeRowI[j] = 1.0;
        } else {
          const assetJ = assets[j];
          if (!assetJ) continue;
          const idxI = corrTickers.indexOf(assetI.ticker.toUpperCase());
          const idxJ = corrTickers.indexOf(assetJ.ticker.toUpperCase());
          if (idxI !== -1 && idxJ !== -1) {
            const matrixRowI = fullMatrix[idxI];
            const val = matrixRowI ? matrixRowI[idxJ] : undefined;
            activeRowI[j] = val !== undefined ? val : 0.1;
          } else {
            activeRowI[j] = 0.1; // Default low correlation if not found
          }
        }
      }
    }

    const L = choleskyDecompose(activeMatrix);

    // Initial portfolio value
    const initialPortfolioValue = assets.reduce((sum, a) => sum + a.value, 0);

    // Pre-calculate drift (shocks) and volatilities per asset
    const drifts = assets.map(a => {
      // Find shock by ticker or by type
      const shock = shocks[a.ticker] ?? shocks[a.type] ?? 0.0;
      return shock; // Annual drift
    });

    const volatilities = assets.map(a => a.volatility / 100); // Volatility in decimal (e.g. 0.2)

    // Store ending values for metrics
    const finalValues: number[] = [];
    const simulatedPaths: number[][] = [];
    const maxDrawdowns: number[] = [];

    // Run simulations
    for (let sim = 0; sim < numSimulations; sim++) {
      const path: number[] = [initialPortfolioValue];
      const currentAssetValues = assets.map(a => a.value);
      let maxVal = initialPortfolioValue;
      let maxDD = 0;

      for (let t = 1; t <= steps; t++) {
        // Generate correlated random shocks
        const Z = Array(n).fill(0).map(() => generateGaussian());
        const Y = Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          const rowI = L[i];
          if (!rowI) continue;
          let sum = 0;
          for (let j = 0; j <= i; j++) {
            const valIJ = rowI[j];
            const valZj = Z[j];
            if (valIJ !== undefined && valZj !== undefined) {
              sum += valIJ * valZj;
            }
          }
          Y[i] = sum;
        }

        // Update each asset value using daily step of GBM
        let portfolioVal = 0;
        for (let i = 0; i < n; i++) {
          const mu = drifts[i];
          const sigma = volatilities[i];
          const valY = Y[i];
          const currentVal = currentAssetValues[i];
          if (mu === undefined || sigma === undefined || valY === undefined || currentVal === undefined) continue;

          const dt = 1 / steps;
          const returnStep = (mu * dt) + (sigma * Math.sqrt(dt) * valY);
          const newVal = currentVal * (1 + returnStep);
          currentAssetValues[i] = newVal;
          portfolioVal += newVal;
        }

        path.push(portfolioVal);

        // Keep track of drawdown
        if (portfolioVal > maxVal) {
          maxVal = portfolioVal;
        } else {
          const dd = (maxVal - portfolioVal) / maxVal;
          if (dd > maxDD) maxDD = dd;
        }
      }

      const finalVal = path[path.length - 1];
      if (finalVal !== undefined) {
        finalValues.push(finalVal);
      }
      maxDrawdowns.push(maxDD);

      // Keep only first 20 paths for plotting to save memory
      if (sim < 20) {
        simulatedPaths.push(path);
      }

      // Send progress update
      if (sim % Math.round(numSimulations / 10) === 0) {
        self.postMessage({
          type: 'PROGRESS',
          progress: Math.round((sim / numSimulations) * 100)
        });
      }
    }

    // Compute metrics
    finalValues.sort((a, b) => a - b);
    const varIndex = Math.floor(numSimulations * 0.05);
    const varValue = finalValues[varIndex] ?? finalValues[0] ?? initialPortfolioValue;
    const var95 = initialPortfolioValue - varValue;
    
    // CVaR (Conditional VaR - average loss below VaR threshold)
    const tailValues = finalValues.slice(0, varIndex);
    const firstFinalValue = finalValues[0] ?? initialPortfolioValue;
    const avgTailValue = tailValues.length > 0
      ? tailValues.reduce((s, v) => s + v, 0) / tailValues.length
      : firstFinalValue;
    const cvar95 = initialPortfolioValue - avgTailValue;

    const maxDD = maxDrawdowns.reduce((sum, val) => sum + val, 0) / numSimulations; // Average max drawdown
    const peakMaxDD = Math.max(...maxDrawdowns); // Worst-case scenario drawdown

    // Probability of loss > 10% and > 20%
    const loss10Count = finalValues.filter(v => (initialPortfolioValue - v) / initialPortfolioValue > 0.10).length;
    const loss20Count = finalValues.filter(v => (initialPortfolioValue - v) / initialPortfolioValue > 0.20).length;

    const probLoss10 = (loss10Count / numSimulations) * 100;
    const probLoss20 = (loss20Count / numSimulations) * 100;

    // Calculate P10, P50, P90 paths
    // We can transpose paths or sample percentiles at each step
    // Since we didn't save all paths to save memory, we can reconstruct the final metrics or interpolate.
    // To do it accurately without storing all 10000 paths, let's keep a downsampled array of step values.
    // But since it runs fast, we can return the metrics and the 20 sample paths directly.
    // Let's sample 100 steps for the Recharts plot
    const stepInterval = Math.max(1, Math.round(steps / 50));
    
    const results = {
      initialValue: initialPortfolioValue,
      var95,
      cvar95,
      avgMaxDrawdown: maxDD * 100,
      worstDrawdown: peakMaxDD * 100,
      probLoss10,
      probLoss20,
      samplePaths: simulatedPaths.map(p => p.filter((_, idx) => idx % stepInterval === 0)),
      finalValuesSample: finalValues.filter((_, idx) => idx % Math.round(numSimulations / 20) === 0),
    };

    self.postMessage({ type: 'COMPLETE', result: results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'ERROR', error: message });
  }
};
export {};
