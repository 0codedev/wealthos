import { SimulatedTrade, BacktestMetrics } from '../../types/backtester.types';

export class MetricsCalculator {
  
  static calculate(
    trades: SimulatedTrade[], 
    initialCapital: number
  ): BacktestMetrics {
    
    let currentCapital = initialCapital;
    let peakCapital = initialCapital;
    
    let maxDrawdownAmount = 0;
    let maxDrawdownPercent = 0;
    let sumDrawdowns = 0;
    let drawdownCount = 0;
    
    let totalBrokerage = 0;
    let totalTaxes = 0;

    let winningTradesCount = 0;
    let losingTradesCount = 0;
    let sumWins = 0;
    let sumLosses = 0;

    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;

    const returnsArray: number[] = [];

    // Calculate trade-by-trade metrics and equity curve characteristics
    for (const trade of trades) {
      // Assuming netPnL already has costs deducted
      const tradeReturnPct = trade.netPnL / trade.capitalAtRisk;
      returnsArray.push(tradeReturnPct);

      currentCapital += trade.netPnL;
      totalBrokerage += trade.totalCosts; // Simplified: assuming costs are mainly brokerage for this field
      totalTaxes += 0; // Simplified for now, can be extracted from trade.totalCosts if detailed

      if (currentCapital > peakCapital) {
        peakCapital = currentCapital;
      }

      const currentDrawdownAmount = peakCapital - currentCapital;
      const currentDrawdownPct = currentDrawdownAmount / peakCapital;

      if (currentDrawdownAmount > maxDrawdownAmount) maxDrawdownAmount = currentDrawdownAmount;
      if (currentDrawdownPct > maxDrawdownPercent) maxDrawdownPercent = currentDrawdownPct;
      
      if (currentDrawdownPct > 0) {
        sumDrawdowns += currentDrawdownPct;
        drawdownCount++;
      }

      if (trade.netPnL > 0) {
        winningTradesCount++;
        sumWins += trade.netPnL;
        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > maxConsecutiveWins) maxConsecutiveWins = currentWinStreak;
      } else if (trade.netPnL < 0) {
        losingTradesCount++;
        sumLosses += Math.abs(trade.netPnL);
        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentLossStreak;
      }
    }

    const totalTrades = winningTradesCount + losingTradesCount; // Ignoring breakevens for win rate calc
    const winRate = totalTrades > 0 ? winningTradesCount / totalTrades : 0;
    const lossRate = 1 - winRate;

    const avgWin = winningTradesCount > 0 ? sumWins / winningTradesCount : 0;
    const avgLoss = losingTradesCount > 0 ? sumLosses / losingTradesCount : 0;

    const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;
    const expectancy = (winRate * avgWin) - (lossRate * avgLoss);
    
    const grossProfit = sumWins;
    const grossLoss = sumLosses;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

    const netProfit = currentCapital - initialCapital;
    const totalReturnPercent = initialCapital > 0 ? (netProfit / initialCapital) * 100 : 0;

    // CAGR Approximation (assumes roughly 1 year if not specified, but ideally needs start/end dates)
    // For exact CAGR, we need the date range. Simplified to just return percent for now if < 1yr.
    let cagr = totalReturnPercent; 
    if (trades.length > 0) {
      const firstDate = new Date(trades[0].date);
      const lastDate = new Date(trades[trades.length - 1].date);
      const years = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (years > 0) {
        cagr = (Math.pow(currentCapital / initialCapital, 1 / years) - 1) * 100;
      }
    }

    const recoveryFactor = maxDrawdownAmount > 0 ? netProfit / maxDrawdownAmount : netProfit > 0 ? 999 : 0;
    const avgDrawdownPercent = drawdownCount > 0 ? sumDrawdowns / drawdownCount : 0;

    // Sharpe and Sortino Ratios (Simplified annualized calculation)
    // Assuming risk-free rate = 0 for simplicity, and returnsArray are per-trade returns.
    // In a real scenario, these are usually daily returns.
    const averageReturn = returnsArray.length > 0 ? returnsArray.reduce((a, b) => a + b, 0) / returnsArray.length : 0;
    const variance = returnsArray.length > 0 ? returnsArray.reduce((a, b) => a + Math.pow(b - averageReturn, 2), 0) / returnsArray.length : 0;
    const stdDev = Math.sqrt(variance);

    const downsideReturns = returnsArray.filter(r => r < 0);
    const downsideVariance = downsideReturns.length > 0 ? downsideReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / downsideReturns.length : 0;
    const downsideStdDev = Math.sqrt(downsideVariance);

    // Approximate annualization factor (assuming average 252 trading days, but we have trade frequency)
    // We'll calculate a raw per-trade Sharpe, then scale it.
    const tradesPerYearApprox = trades.length > 0 && cagr !== totalReturnPercent ? trades.length / ((cagr === 0 ? 1 : totalReturnPercent / cagr) || 1) : 252;
    const annualizationFactor = Math.sqrt(tradesPerYearApprox);

    const sharpeRatio = stdDev > 0 ? (averageReturn / stdDev) * annualizationFactor : 0;
    const sortinoRatio = downsideStdDev > 0 ? (averageReturn / downsideStdDev) * annualizationFactor : 0;
    const calmarRatio = maxDrawdownPercent > 0 ? cagr / (maxDrawdownPercent * 100) : 0;

    return {
      initialCapital,
      finalCapital: currentCapital,
      netProfit,
      totalReturnPercent,
      cagr,
      
      maxDrawdownAmount,
      maxDrawdownPercent,
      avgDrawdownPercent,
      recoveryFactor,

      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      profitFactor,

      totalTrades: trades.length,
      winningTrades: winningTradesCount,
      losingTrades: losingTradesCount,
      winRate,
      avgWin,
      avgLoss,
      payoffRatio,
      expectancy,

      maxConsecutiveWins,
      maxConsecutiveLosses,

      totalBrokeragePaid: totalBrokerage,
      totalTaxesPaid: totalTaxes,
      
      // VaR 95% Calculation
      valueAtRisk95: (() => {
        if (returnsArray.length < 10) return 0;
        const sortedReturns = [...returnsArray].sort((a, b) => a - b);
        const index = Math.floor(sortedReturns.length * 0.05);
        return sortedReturns[index] * 100; // Convert to %
      })(),
      
      // CVaR Calculation
      conditionalVaR: (() => {
        if (returnsArray.length < 10) return 0;
        const sortedReturns = [...returnsArray].sort((a, b) => a - b);
        const index = Math.floor(sortedReturns.length * 0.05);
        const tailReturns = sortedReturns.slice(0, index + 1);
        const avgTailReturn = tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length;
        return avgTailReturn * 100; // Convert to %
      })()
    };
  }
}
