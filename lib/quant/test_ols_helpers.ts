// Standalone OLS helpers for the test script (no Logger import)
/* eslint-disable */

function computeOLSRegression(y: number[], x: number[]): { alpha: number; beta: number; rSquared: number } {
  const n = Math.min(y.length, x.length);
  if (n < 5) return { alpha: 0, beta: 0, rSquared: 0 };
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += x[i]; sumY += y[i]; }
  const meanX = sumX / n, meanY = sumY / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - meanX) * (y[i] - meanY); den += (x[i] - meanX) ** 2; }
  const beta = den === 0 ? 0 : num / den;
  const alpha = meanY - beta * meanX;
  let totalSS = 0, residualSS = 0;
  for (let i = 0; i < n; i++) {
    totalSS += (y[i] - meanY) ** 2;
    residualSS += (y[i] - (alpha + beta * x[i])) ** 2;
  }
  const rSquared = totalSS === 0 ? 0 : 1 - residualSS / totalSS;
  return { alpha, beta, rSquared };
}

function invert5x5(m: number[][]): number[][] | null {
  const n = 5;
  const aug: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(m[i][j]);
    for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0);
    aug.push(row);
  }
  for (let i = 0; i < n; i++) {
    let pivotRow = i, maxVal = Math.abs(aug[i][i]);
    for (let k = i + 1; k < n; k++) {
      const v = Math.abs(aug[k][i]);
      if (v > maxVal) { maxVal = v; pivotRow = k; }
    }
    if (maxVal < 1e-10) return null;
    if (pivotRow !== i) { const tmp = aug[i]; aug[i] = aug[pivotRow]; aug[pivotRow] = tmp; }
    const pivot = aug[i][i];
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= pivot;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = aug[k][i];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
    }
  }
  const inv: number[][] = [];
  for (let i = 0; i < n; i++) inv.push(aug[i].slice(n));
  return inv;
}

export function computeMultiFactorOLS(
  returns: number[], marketReturns: number[],
  smbReturns: number[], hmlReturns: number[], momReturns: number[],
  Rf: number = 0.065 / 252
) {
  const n = Math.min(returns.length, marketReturns.length, smbReturns.length, hmlReturns.length, momReturns.length);
  if (n < 10) {
    const capm = computeOLSRegression(
      returns.map(r => r - Rf),
      marketReturns.slice(0, n).map(r => r - Rf)
    );
    return { alpha: capm.alpha, betaMarket: capm.beta, betaSMB: 0, betaHML: 0, betaMOM: 0, rSquared: capm.rSquared, adjRSquared: capm.rSquared, residualStd: 0, warning: 'Insufficient samples' };
  }
  const k = 5;
  const XtX: number[][] = Array(k).fill(0).map(() => Array(k).fill(0));
  const XtY: number[] = Array(k).fill(0);
  for (let t = 0; t < n; t++) {
    const yi = returns[t] - Rf;
    const row = [1, marketReturns[t], smbReturns[t], hmlReturns[t], momReturns[t]];
    for (let i = 0; i < k; i++) {
      XtY[i] += row[i] * yi;
      for (let j = 0; j < k; j++) XtX[i][j] += row[i] * row[j];
    }
  }
  const inv = invert5x5(XtX);
  if (!inv) return { alpha: 0, betaMarket: 0, betaSMB: 0, betaHML: 0, betaMOM: 0, rSquared: 0, adjRSquared: 0, residualStd: 0, warning: 'Singular' };
  const beta: number[] = Array(k).fill(0);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) beta[i] += inv[i][j] * XtY[j];
  let totalSS = 0, residualSS = 0;
  const meanY = returns.reduce((a, b) => a + b, 0) / n;
  for (let t = 0; t < n; t++) {
    const yi = returns[t] - Rf;
    const predicted = beta[0] + beta[1] * marketReturns[t] + beta[2] * smbReturns[t] + beta[3] * hmlReturns[t] + beta[4] * momReturns[t];
    residualSS += (yi - predicted) ** 2;
    totalSS += (returns[t] - meanY) ** 2;
  }
  const rSquared = totalSS === 0 ? 0 : Math.max(0, Math.min(1, 1 - residualSS / totalSS));
  const adjRSquared = 1 - (1 - rSquared) * (n - 1) / (n - k);
  return { alpha: beta[0], betaMarket: beta[1], betaSMB: beta[2], betaHML: beta[3], betaMOM: beta[4], rSquared, adjRSquared, residualStd: Math.sqrt(residualSS / (n - k)), warning: undefined };
}

export function computeMomentumFactor(returns: number[], lookback: number = 21): number {
  if (returns.length < lookback) return returns.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = returns.length - lookback; i < returns.length; i++) sum += returns[i];
  return sum;
}

export function computeOptimalFrontier(holdings: any[], targetReturn: number, returnsMatrix: number[][]) {
  return { weights: [], variance: 0, expectedReturn: targetReturn };
}

export function generateRebalancePlan(current: any[], target: any, report?: any) {
  return { profile: target, recommendations: [], expectedSharpe: 0, expectedVolatility: 0, expectedBeta: 0, targetVolatility: 0, generatedAt: new Date().toISOString() };
}
