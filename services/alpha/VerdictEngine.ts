import { alphaEngineService } from '../AlphaEngineService';

export interface VerdictSignal {
  label: string;
  description: string;
  points: number;
  earned: boolean;
  source: 'StockeZee' | 'Upstox' | 'NSE';
}

export interface VerdictResult {
  symbol: string;
  totalScore: number;
  maxScore: number;
  verdict: 'HIGH CONVICTION' | 'MODERATE' | 'SPECULATIVE' | 'AVOID';
  verdictColor: string;
  signals: VerdictSignal[];
  dataCompleteness: number; // Percentage (0-100)
  computedAt: string;
  depthPressure?: 'BUY_SIDE' | 'SELL_SIDE' | 'NEUTRAL';
  igs?: number;
}

export class VerdictEngine {
  /**
   * Computes the Unified Alpha Verdict for a stock symbol based on cached screener datasets.
   * Pure read-only lookup, zero network requests.
   */
  static compute(
    symbol: string,
    caches: {
      orbDataCache?: Record<string, any[]>;
      dailyCandleData?: any;
      valuationDataCache?: Record<string, any[]>;
      shareholdingDataCache?: Record<string, any[]>;
      qualityDataCache?: Record<string, any[]>;
      boosterStocksList?: any[];
      historicalDataCache?: Record<string, any[]>;
      fiiDiiPulseData?: any[];
      derivativeSummaryData?: any[];
    },
    liveQuotes?: Record<string, any>,
    volumeAverages?: Record<string, number>,
    isBearish: boolean = false,
    alphaSignals?: {
      oreScore?: number;
      oreDirection?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      cvd?: number;
      oiSignal?: 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWIND' | 'NEUTRAL';
      rsRank?: number;
      rsCategory?: 'LEADER' | 'LAGGARD' | 'NEUTRAL';
      fiiVelocity?: number;
      valueZoneFlag?: boolean;
    }
  ): VerdictResult {
    const sym = symbol.toUpperCase();
    const signals: VerdictSignal[] = [];
    let checkedSourcesCount = 0;
    let presentSourcesCount = 0;

    const {
      orbDataCache = {},
      dailyCandleData = null,
      valuationDataCache = {},
      shareholdingDataCache = {},
      qualityDataCache = {},
      boosterStocksList = [],
      historicalDataCache = {},
      fiiDiiPulseData = [],
      derivativeSummaryData = [],
    } = caches;

    // 1. Bullish ORB (+3 pts)
    let orbBullish = false;
    let hasOrbData = false;
    const orbKeys = Object.keys(orbDataCache);
    if (orbKeys.length > 0) {
      hasOrbData = true;
      for (const key of orbKeys) {
        const list = orbDataCache[key];
        if (Array.isArray(list)) {
          const match = list.find(item => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
          if (match && (match.breakout === 'Bullish' || match.sentiment === 'Bullish')) {
            orbBullish = true;
            break;
          }
        }
      }
    }
    checkedSourcesCount++;
    if (hasOrbData) presentSourcesCount++;
    signals.push({
      label: 'Bullish ORB Breakout',
      description: orbBullish ? 'Detected Bullish ORB Breakout' : 'No Bullish ORB Breakout detected',
      points: 3,
      earned: orbBullish,
      source: 'StockeZee'
    });

    // 2. Bullish Candlestick Pattern (+3 pts)
    let candleBullish = false;
    let hasCandleData = false;
    if (dailyCandleData && typeof dailyCandleData === 'object') {
      hasCandleData = true;
      const patternKeys = Object.keys(dailyCandleData).filter(k => k !== 'available_pattens');
      for (const key of patternKeys) {
        const list = dailyCandleData[key];
        if (Array.isArray(list)) {
          const match = list.find(item => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
          if (match && (match.pattern_sentiment === 'Bullish' || match.sentiment === 'Bullish')) {
            candleBullish = true;
            break;
          }
        }
      }
    }
    checkedSourcesCount++;
    if (hasCandleData) presentSourcesCount++;
    signals.push({
      label: 'Bullish Daily Candle Pattern',
      description: candleBullish ? 'Bullish daily candlestick pattern active' : 'No Bullish daily pattern found',
      points: 3,
      earned: candleBullish,
      source: 'StockeZee'
    });

    // 3. Undervalued (+2 pts)
    let isUndervalued = false;
    let hasValuationData = false;
    const underValuedList = valuationDataCache['under_valued'];
    if (underValuedList && Array.isArray(underValuedList)) {
      hasValuationData = true;
      const match = underValuedList.find(item => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
      if (match) {
        const ltp = match.last_trade_price || match.LTP || 0;
        const intrinsic = match.intrinsic_value || match.intrinsicValue || 0;
        const upside = match.upside || (ltp > 0 ? ((intrinsic - ltp) / ltp) * 100 : 0);
        if (intrinsic > ltp || upside > 10) {
          isUndervalued = true;
        }
      }
    }
    checkedSourcesCount++;
    if (hasValuationData) presentSourcesCount++;
    signals.push({
      label: 'Undervalued Stock (Upside)',
      description: isUndervalued ? 'Intrinsic value indicates positive margin of safety' : 'Not identified as undervalued',
      points: 2,
      earned: isUndervalued,
      source: 'StockeZee'
    });

    // 4. FII/Promoter Buying (+2 pts)
    let hasBuying = false;
    let hasShareholdingData = false;
    const fiiBuy = shareholdingDataCache['fii_buy'];
    const promoterBuy = shareholdingDataCache['promoter_buy'];
    if ((fiiBuy && Array.isArray(fiiBuy)) || (promoterBuy && Array.isArray(promoterBuy))) {
      hasShareholdingData = true;
      const fiiMatch = fiiBuy?.find(item => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
      const promoterMatch = promoterBuy?.find(item => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
      if (fiiMatch || promoterMatch) {
        hasBuying = true;
      }
    }
    checkedSourcesCount++;
    if (hasShareholdingData) presentSourcesCount++;
    signals.push({
      label: 'FII/Promoter Buying Activity',
      description: hasBuying ? 'FII or Promoter buying detected in recent quarters' : 'No institutional accumulation pattern',
      points: 2,
      earned: hasBuying,
      source: 'StockeZee'
    });

    // 5. High Quality Score (+2 pts)
    let isHighQuality = false;
    let hasQualityData = false;
    let qualityScore = 0;
    const qualityKeys = Object.keys(qualityDataCache);
    if (qualityKeys.length > 0) {
      hasQualityData = true;
      for (const key of qualityKeys) {
        const list = qualityDataCache[key];
        if (Array.isArray(list)) {
          const match = list.find(item => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
          if (match) {
            const score = Number(match.total_score || match.score || 0);
            if (score > qualityScore) {
              qualityScore = score;
            }
          }
        }
      }
      if (qualityScore >= 70) {
        isHighQuality = true;
      }
    }
    checkedSourcesCount++;
    if (hasQualityData) presentSourcesCount++;
    signals.push({
      label: 'High Quality Score (>=70)',
      description: isHighQuality ? `Excellent fundamentals (Score: ${qualityScore})` : qualityScore > 0 ? `Moderate quality score (${qualityScore})` : 'No quality metrics available',
      points: 2,
      earned: isHighQuality,
      source: 'StockeZee'
    });

    // 6. Intraday Booster Bullish (+2 pts)
    let boosterBullish = false;
    let hasBoosterData = false;
    if (boosterStocksList && Array.isArray(boosterStocksList) && boosterStocksList.length > 0) {
      hasBoosterData = true;
      const match = boosterStocksList.find(item => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
      if (match && (match.trend === 'Bullish' || match.direction === 'Bullish')) {
        boosterBullish = true;
      }
    }
    checkedSourcesCount++;
    if (hasBoosterData) presentSourcesCount++;
    signals.push({
      label: 'Intraday Booster Trend',
      description: boosterBullish ? 'Bullish breakout identified by Intraday Booster' : 'No active Intraday Booster alert',
      points: 2,
      earned: boosterBullish,
      source: 'StockeZee'
    });

    // 7. Volume Surge (+2 pts)
    let volumeSurge = false;
    let hasVolumeData = false;
    const quote = liveQuotes ? liveQuotes[sym] : null;
    const avgVolume = volumeAverages ? volumeAverages[sym] : 0;
    if (quote && avgVolume > 0) {
      hasVolumeData = true;
      const rvol = quote.volume / avgVolume;
      if (rvol >= 2.0) {
        volumeSurge = true;
      }
    }
    checkedSourcesCount++;
    if (hasVolumeData) presentSourcesCount++;
    signals.push({
      label: 'Volume Surge (RVOL >= 2.0x)',
      description: volumeSurge 
        ? `High volume momentum: ${(quote && avgVolume > 0 ? (quote.volume / avgVolume).toFixed(1) : '2.0')}x normal volume` 
        : 'Volume within average levels',
      points: 2,
      earned: volumeSurge,
      source: 'Upstox'
    });

    // 8. OI Long Buildup (+2 pts)
    let longBuildup = false;
    let hasOiData = false;
    if (derivativeSummaryData && Array.isArray(derivativeSummaryData) && derivativeSummaryData.length > 0) {
      hasOiData = true;
      const match = derivativeSummaryData.find(item => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
      if (match && match.built_up === 'long_build_up') {
        longBuildup = true;
      }
    }
    checkedSourcesCount++;
    if (hasOiData) presentSourcesCount++;
    signals.push({
      label: 'OI Long Buildup',
      description: longBuildup ? 'Long buildup in open interest detected' : 'No long buildup trend detected',
      points: 2,
      earned: longBuildup,
      source: 'StockeZee'
    });

    // 9. Historical Gainer (+1 pt)
    let isHistGainer = false;
    let hasHistData = false;
    const histKeys = Object.keys(historicalDataCache).filter(k => k.startsWith('gainers_'));
    if (histKeys.length > 0) {
      hasHistData = true;
      for (const key of histKeys) {
        const list = historicalDataCache[key];
        if (Array.isArray(list)) {
          const match = list.find(item => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
          if (match) {
            isHistGainer = true;
            break;
          }
        }
      }
    }
    checkedSourcesCount++;
    if (hasHistData) presentSourcesCount++;
    signals.push({
      label: 'Historical Gainer',
      description: isHistGainer ? 'Appears in short-to-medium term gainer lists' : 'No recent gainer listing',
      points: 1,
      earned: isHistGainer,
      source: 'StockeZee'
    });

    // 10. Positive FII Net Flow (+1 pt)
    let positiveMarketFlow = false;
    let hasPulseData = false;
    if (fiiDiiPulseData && Array.isArray(fiiDiiPulseData) && fiiDiiPulseData.length > 0) {
      hasPulseData = true;
      const latest = fiiDiiPulseData[0];
      const fiiCashNet = latest.fii_cash?.find((f: any) => f.category === 'FII/FPI')?.net_value || 0;
      if (fiiCashNet > 0) {
        positiveMarketFlow = true;
      }
    }
    checkedSourcesCount++;
    if (hasPulseData) presentSourcesCount++;
    signals.push({
      label: 'Positive Market FII Flow',
      description: positiveMarketFlow ? 'FIIs are net buyers in the cash market today' : 'FIIs are net sellers or data not synced',
      points: 1,
      earned: positiveMarketFlow,
      source: 'StockeZee'
    });

    // 11. Bid-Ask Depth Imbalance (DAI) (+2 pts)
    let hasDaiPressure = false;
    let depthPressure: 'BUY_SIDE' | 'SELL_SIDE' | 'NEUTRAL' = 'NEUTRAL';
    let dai = 1.0;
    if (quote) {
      dai = quote.dai || 1.0;
      depthPressure = quote.depth_pressure || 'NEUTRAL';
      if (isBearish) {
        hasDaiPressure = depthPressure === 'SELL_SIDE';
      } else {
        hasDaiPressure = depthPressure === 'BUY_SIDE';
      }
    }
    checkedSourcesCount++;
    if (quote && quote.dai !== undefined) presentSourcesCount++;
    signals.push({
      label: 'Bid-Ask Depth Pressure',
      description: hasDaiPressure
        ? `Order book shows strong pressure on our side: ${dai.toFixed(2)}x ratio`
        : `Order book depth is balanced/neutral: ${dai.toFixed(2)}x ratio`,
      points: 2,
      earned: hasDaiPressure,
      source: 'Upstox'
    });

    // --- Technical Metrics & Candle Shadow Calculations ---
    const open = quote?.ohlc?.open || quote?.todayOpen || 0;
    const ltpVal = quote?.last_price || 0;
    const high = quote?.ohlc?.high || 0;
    const low = quote?.ohlc?.low || 0;
    const vol = quote?.volume || 0;
    const o2c = open > 0 ? ((ltpVal - open) / open) * 100 : 0;
    const rvol = avgVolume > 0 ? vol / avgVolume : 1.0;
    const lowerShadow = open > 0 ? ((Math.min(open, ltpVal) - low) / open) * 100 : 0;
    const upperShadow = open > 0 ? ((high - Math.max(open, ltpVal)) / open) * 100 : 0;
    const vwap = quote?.average_price || (open + high + low + ltpVal) / 4;
    const vwapDist = vwap > 0 ? ((ltpVal - vwap) / vwap) * 100 : 0;
    const hodProximity = ltpVal > 0 ? ((high - ltpVal) / ltpVal) * 100 : 0;
    const lodProximity = ltpVal > 0 ? ((ltpVal - low) / ltpVal) * 100 : 0;
    const proximityVal = isBearish ? lodProximity : hodProximity;

    // --- One-Way Trend Factor (OWTF) Calculations ---
    // Specifically designed to identify stocks moving in a single direction with minimal pullbacks
    // and strong institutional volume, separating clean institutional momentum from volatile zig-zag moves.
    const isBullishMomentum = !isBearish && o2c > 3.0;
    const isBearishMomentum = isBearish && o2c < -3.0;
    
    let owtf = 0.0;
    if (isBullishMomentum || isBearishMomentum) {
      // 1. Proximity to Day Extreme (HOD for Bullish, LOD for Bearish)
      const extremeProximity = isBearishMomentum ? lodProximity : hodProximity;
      const proximityFactor = Math.max(0, 1.0 - extremeProximity / 1.5); // tolerant up to 1.5% pullback

      // 2. Body-to-Range Ratio (Solid Body check)
      const rangeVal = high - low;
      const bodyVal = Math.abs(ltpVal - open);
      const shadowFactor = rangeVal > 0 ? bodyVal / rangeVal : 1.0;

      // 3. VWAP Alignment
      const vwapDistanceValue = isBearishMomentum ? -vwapDist : vwapDist;
      const vwapFactor = Math.min(Math.max(vwapDistanceValue / 0.5, 0), 1.0); // full points at 0.5% or more above/below VWAP

      // 4. Volume Surge (RVOL)
      const volumeFactor = Math.min(Math.max((rvol - 0.8) / 1.7, 0), 1.0); // RVOL >= 2.5 gets full points

      // 5. Bid-Ask Depth Pressure (DAI)
      let depthFactor = 0.5; // neutral
      if (isBullishMomentum && depthPressure === 'BUY_SIDE') depthFactor = 1.0;
      else if (isBearishMomentum && depthPressure === 'SELL_SIDE') depthFactor = 1.0;
      else if ((isBullishMomentum && depthPressure === 'SELL_SIDE') || (isBearishMomentum && depthPressure === 'BUY_SIDE')) depthFactor = 0.0;

      // 6. Cumulative Volume Delta (CVD)
      let cvdFactor = 0.5;
      const cvdVal = alphaSignals?.cvd ?? 0;
      if (cvdVal !== 0) {
        const tanhCvd = Math.tanh(cvdVal / 1000000);
        cvdFactor = isBearishMomentum ? (1.0 - (tanhCvd + 1) / 2) : (tanhCvd + 1) / 2;
      }

      // Combine factors into a One-Way Trend Score (0.0 to 1.0)
      owtf = (proximityFactor * 0.30) + (shadowFactor * 0.25) + (vwapFactor * 0.15) + (volumeFactor * 0.15) + (depthFactor * 0.10) + (cvdFactor * 0.05);
    }

    // 12. One-Way Institutional Momentum (+6 pts)
    const isOneWayMomentum = owtf >= 0.70;
    signals.push({
      label: 'One-Way Institutional Momentum',
      description: isOneWayMomentum 
        ? `Clean institutional one-way footprint detected (OWTF: ${(owtf * 100).toFixed(0)}%)`
        : `No clean one-way trend (OWTF: ${(owtf * 100).toFixed(0)}%)`,
      points: 6,
      earned: isOneWayMomentum,
      source: 'Upstox'
    });

    // Score calculations
    const totalScore = signals.reduce((acc, sig) => acc + (sig.earned ? sig.points : 0), 0);
    const maxScore = signals.reduce((acc, sig) => acc + sig.points, 0);

    const dataCompleteness = checkedSourcesCount > 0 
      ? Math.round((presentSourcesCount / checkedSourcesCount) * 100) 
      : 0;

    // --- Core 8 Technical Components ---
    const o2cScore = Math.min(Math.max((isBearish ? -o2c : o2c) / 3.0, 0), 1.0);
    const rvolScore = Math.min(Math.max((rvol - 0.5) / 2.5, 0), 1.0);
    
    // Fix shadowScore: Reward solid body (bodyVal/rangeVal ratio) instead of long shadows
    const rangeValForShadow = high - low;
    const bodyValForShadow = Math.abs(ltpVal - open);
    const shadowScore = rangeValForShadow > 0 ? bodyValForShadow / rangeValForShadow : 1.0;
    
    const vwapScore = Math.min(Math.max((isBearish ? -vwapDist : vwapDist) / 3.0, 0), 1.0);
    const gFactor = o2c * Math.log(rvol + 1) * (1 - Math.min(100, Math.max(0, proximityVal)) / 100);
    const gScore = Math.min(Math.max((isBearish ? -gFactor : gFactor) / 10.0, 0), 1.0);
    const proximityScore = Math.min(Math.max(1 - proximityVal / 1.5, 0), 1.0);
    const tradedValue = (vol * ltpVal) / 100000;
    const valueScore = Math.min(Math.max((tradedValue - 10) / 290, 0), 1.0);
    const intradayRange = low > 0 ? ((high - low) / low) * 100 : 0;
    const rangeScore = Math.min(Math.max((intradayRange - 1.0) / 5.0, 0), 1.0);
    
    const existing8Score = (o2cScore + rvolScore + shadowScore + vwapScore + gScore + proximityScore + valueScore + rangeScore) / 8;
    const daiScore = hasDaiPressure ? 1.0 : (depthPressure === 'NEUTRAL' ? 0.5 : 0.0);
    const macroBias = alphaEngineService.getMacroBias();
    const fiiScore = macroBias === 'STRONG_BULLISH' ? 1.0 : macroBias === 'HEDGED' ? 0.7 : macroBias === 'NEUTRAL' ? 0.5 : 0.0;
    const pcrZone = alphaEngineService.getPCRGate();

    // Parse live alpha signal inputs
    const ore = alphaSignals?.oreScore ?? 0.5;
    const oreDir = alphaSignals?.oreDirection ?? 'NEUTRAL';
    const cvdVal = alphaSignals?.cvd ?? 0;
    const oiSig = alphaSignals?.oiSignal ?? 'NEUTRAL';
    const rsRank = alphaSignals?.rsRank ?? 50;
    const fiiVel = alphaSignals?.fiiVelocity ?? 0.0;
    const valZone = alphaSignals?.valueZoneFlag ?? false;

    // 1. ORE Direction Alignment
    let oreScore = ore;
    if (oreDir !== 'NEUTRAL') {
      if (isBearish && oreDir === 'BEARISH') {
        oreScore = Math.min(1.0, ore + 0.15);
      } else if (!isBearish && oreDir === 'BULLISH') {
        oreScore = Math.min(1.0, ore + 0.15);
      } else {
        oreScore = Math.max(0.0, ore - 0.20); // Penalty
      }
    }

    // 2. CVD Scaled Score
    const rawCvdScore = (Math.tanh(cvdVal / 1000000) + 1) / 2;
    const cvdScore = isBearish ? (1.0 - rawCvdScore) : rawCvdScore;

    // 3. OI Signal Alignment
    let oiScore = 0.5;
    if (oiSig === 'LONG_BUILDUP') oiScore = isBearish ? 0.0 : 1.0;
    else if (oiSig === 'SHORT_COVERING') oiScore = isBearish ? 0.3 : 0.8;
    else if (oiSig === 'LONG_UNWIND') oiScore = isBearish ? 0.8 : 0.3;
    else if (oiSig === 'SHORT_BUILDUP') oiScore = isBearish ? 1.0 : 0.0;

    // 4. Relative Strength Score
    const rsPercentile = rsRank / 100;
    const rsScore = isBearish ? (1.0 - rsPercentile) : rsPercentile;

    // 5. Shareholding Velocity Score
    const rawVelScore = Math.min(Math.max((fiiVel + 0.5) / 1.0, 0.0), 1.0);
    const fiiVelocityScore = isBearish ? (1.0 - rawVelScore) : rawVelScore;

    // 6. Value Zone Score
    const valueZoneScore = valZone ? 1.0 : 0.0;

    let igs = 
      (existing8Score * 0.35) +
      (oreScore * 0.15) +
      (daiScore * 0.10) +
      (cvdScore * 0.10) +
      (oiScore * 0.08) +
      (fiiScore * 0.07) +
      (rsScore * 0.07) +
      (fiiVelocityScore * 0.05) +
      (valueZoneScore * 0.03);

    // Apply macro bias multipliers
    if (macroBias === 'DISTRIBUTION') {
      if (!isBearish) igs *= 0.85;
      else igs *= 1.15;
    } else if (macroBias === 'STRONG_BULLISH') {
      if (!isBearish) igs *= 1.08;
      else igs *= 0.85;
    }

    // Apply PCR Gate Rule
    if (pcrZone === 'BEARISH' && !isBearish) {
      igs = Math.min(igs, 0.5);
    } else if (pcrZone === 'BULLISH' && isBearish) {
      igs = Math.min(igs, 0.5);
    } else if (pcrZone === (isBearish ? 'BEARISH' : 'BULLISH')) {
      igs = Math.min(1.0, igs + 0.05);
    }

    // --- Dynamic OWTF Blend into IGS ---
    // If we have verified clean one-way momentum, blend OWTF strongly (60% weight) to lift the score 
    // above the background data drag.
    if (owtf >= 0.65) {
      igs = (igs * 0.40) + (owtf * 0.60);
    }

    igs = Math.min(Math.max(igs, 0.0), 1.0);

    // --- Unified Verdict Classification ---
    // Classify using BOTH point-based totalScore and percentage-based blended igs
    let verdict: VerdictResult['verdict'] = 'AVOID';
    let verdictColor = 'text-rose-400 bg-rose-500/10 border-rose-500/20';

    if (igs >= 0.75 || totalScore >= 16) {
      verdict = 'HIGH CONVICTION';
      verdictColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    } else if (igs >= 0.55 || totalScore >= 11) {
      verdict = 'MODERATE';
      verdictColor = 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
    } else if (igs >= 0.35 || totalScore >= 5) {
      verdict = 'SPECULATIVE';
      verdictColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    }

    return {
      symbol: sym,
      totalScore,
      maxScore,
      verdict,
      verdictColor,
      signals,
      dataCompleteness,
      depthPressure,
      igs: Number(igs.toFixed(4)),
      computedAt: new Date().toLocaleTimeString()
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // CC68.29 — IGS 0..100 (the new formula)
  //
  // Six sub-scores, each 0..1, weight-summed. Designed to consume every
  // valuable data point from the 17 Shadow Screener cards. Missing data
  // is neutral 0.5 (NOT 0) so warm-state cards don't drag the score down.
  //
  // Usage:
  //   const bundle = buildAlphaInputs(symbol, segment, direction, state);
  //   const result = VerdictEngine.computeIGS100(bundle);
  //
  // ──────────────────────────────────────────────────────────────────────

  /**
   * IGS sub-score weights. Tunable per Phase-D ML trainer.
   * Sum = 1.00.
   */
  static readonly IGS_WEIGHTS = {
    pattern:      0.18,   // Cards #1 (Candle), #3 (ORB), #9 (FnO Pulse)
    smart_money:  0.16,   // Cards #6 (Shareholding), #11 (FII/DII), #13 (Insider), #14 (MF)
    fundamentals: 0.14,   // Cards #4 (Valuation), #7 (Quality), #12 (Delivery)
    flow_options: 0.16,   // Cards #11 (FII OI, derivative), #15 (Order flow), #16 (OI/PCR)
    momentum:     0.16,   // Cards #2 (Top Gainers), #9 (FnO Pulse)
    risk_gates:   0.20,   // RVOL + spread + OI change + liquidity + earnings
  } as const;

  /**
   * Normalize a sub-score so that:
   *  - empty (weight=0) → 0.5
   *  - single source at 0.5 contribution → 0.5 (true neutral)
   *  - single source at 1.0 contribution → 1.0
   *  - single source at 0.0 contribution → 0.0
   *  - multi-source passes through the (clamped) average
   *
   * The key insight: contributions are ALREADY in [0,1] range
   * (e.g. `0.5 + 0.5 * tanh(...)` produces values in [0,1]).
   * The `weight` is just a presence counter; we should not divide by it.
   *
   * For 1 source, the contribution IS the sub-score.
   * For 2+ sources, average the contributions and clamp.
   */
  private static _normaliseSubScore(total: number, weight: number): number {
    if (weight === 0) return 0.5;
    if (weight <= 0.4) {
      // Single source: use its contribution directly (already 0..1).
      return Math.max(0, Math.min(1, total));
    }
    // Multi-source: average.
    return Math.max(0, Math.min(1, total / weight));
  }
  static computeIGS100(
    bundle: import('./UnifiedAlphaInputs').AlphaInputsBundle,
  ): IGS100Result {
    const s_pattern      = VerdictEngine._igsPattern(bundle);
    const s_smart_money  = VerdictEngine._igsSmartMoney(bundle);
    const s_fundamentals = VerdictEngine._igsFundamentals(bundle);
    const s_flow_options = VerdictEngine._igsFlowOptions(bundle);
    const s_momentum     = VerdictEngine._igsMomentum(bundle);
    const s_risk_gates   = VerdictEngine._igsRiskGates(bundle);

    const w = VerdictEngine.IGS_WEIGHTS;
    const igs0to1 =
        w.pattern      * s_pattern
      + w.smart_money  * s_smart_money
      + w.fundamentals * s_fundamentals
      + w.flow_options * s_flow_options
      + w.momentum     * s_momentum
      + w.risk_gates   * s_risk_gates;

    const igs0to100 = Math.max(0, Math.min(100, Math.round(igs0to1 * 100)));

    // Verdict bands
    let verdict: IGS100Result['verdict'];
    let verdictColor: string;
    if (igs0to100 >= 75) {
      verdict = 'HIGH CONVICTION';
      verdictColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    } else if (igs0to100 >= 55) {
      verdict = 'MODERATE';
      verdictColor = 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
    } else if (igs0to100 >= 35) {
      verdict = 'SPECULATIVE';
      verdictColor = 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    } else {
      verdict = 'AVOID';
      verdictColor = 'text-rose-400 bg-rose-500/10 border-rose-500/20';
    }

    return {
      symbol: bundle.symbol,
      igs: igs0to100,
      verdict,
      verdictColor,
      subScores: {
        pattern:      s_pattern,
        smart_money:  s_smart_money,
        fundamentals: s_fundamentals,
        flow_options: s_flow_options,
        momentum:     s_momentum,
        risk_gates:   s_risk_gates,
      },
      weights: w,
      dataCompleteness: VerdictEngine._igsDataCompleteness(bundle),
      computedAt: new Date().toISOString(),
    };
  }

  // ── Sub-score 1: pattern (0..1) — Cards #1, #3, #9 ────────────────

  private static _igsPattern(b: import('./UnifiedAlphaInputs').AlphaInputsBundle): number {
    // Direction-aware bullish/bearish match on each pattern source.
    const wantBull = b.direction === 'CALL';
    let total = 0;
    let weight = 0;

    // Daily candle (3 of 4 weight)
    if (b.candle.daily) {
      const isMatch = (b.candle.daily.pattern_sentiment === 'Bullish') === wantBull;
      total += isMatch ? 1.0 : 0.0;
      weight += 1;
    }
    // Weekly candle
    if (b.candle.weekly) {
      const isMatch = (b.candle.weekly.pattern_sentiment === 'Bullish') === wantBull;
      total += isMatch ? 1.0 : 0.0;
      weight += 1;
    }
    // ORB
    if (b.orb && b.orb.breakout) {
      const isMatch = (b.orb.breakout === 'Bullish') === wantBull;
      total += isMatch ? 1.0 : 0.0;
      weight += 1;
    }
    // FnO Movements (booster pulse)
    if (b.historical.is_fno_pulse) {
      total += 1.0;
      weight += 1;
    }

    if (weight === 0) return 0.5;        // no data → neutral
    return VerdictEngine._normaliseSubScore(total, weight);
  }

  // ── Sub-score 2: smart_money (0..1) — Cards #6, #11, #13, #14 ─────

  private static _igsSmartMoney(b: import('./UnifiedAlphaInputs').AlphaInputsBundle): number {
    let total = 0;
    let weight = 0;

    // 2a. FII velocity (from shareholdingMap) — 0.4 weight
    if (b.shareholding?.fii_velocity != null) {
      const v = b.shareholding.fii_velocity;            // -1..+1
      const sign = b.direction === 'CALL' ? 1 : -1;
      total += 0.5 + 0.5 * Math.tanh(v * 3 * sign);
      weight += 0.4;
    }

    // 2b. Ownership momentum score (0.4·FII + 0.3·DII + 0.3·Promoter) — 0.2 weight
    if (b.shareholding?.ownership_momentum_score != null) {
      const m = b.shareholding.ownership_momentum_score;
      const sign = b.direction === 'CALL' ? 1 : -1;
      const normalised = Math.tanh(m * sign);            // -1..+1
      total += 0.5 + 0.5 * normalised;
      weight += 0.2;
    }

    // 2c. FII cash net today — 0.2 weight
    if (b.fiiDii?.fii_cash_net_cr != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const v = Math.tanh(b.fiiDii.fii_cash_net_cr / 2000 * sign);
      total += 0.5 + 0.5 * v;
      weight += 0.2;
    }

    // 2d. Insider net — 0.1 weight
    if (b.insider?.net_value_cr != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const v = Math.tanh(b.insider.net_value_cr / 3 * sign);
      total += 0.5 + 0.5 * v;
      weight += 0.1;
    }

    // 2e. MF net flow — 0.1 weight
    if (b.mfFlow?.pct_change != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const v = Math.tanh(b.mfFlow.pct_change / 5 * sign);
      total += 0.5 + 0.5 * v;
      weight += 0.1;
    }

    if (weight === 0) return 0.5;
    return VerdictEngine._normaliseSubScore(total, weight);
  }

  // ── Sub-score 3: fundamentals (0..1) — Cards #4, #7, #12 ──────────

  private static _igsFundamentals(b: import('./UnifiedAlphaInputs').AlphaInputsBundle): number {
    let total = 0;
    let weight = 0;

    // 3a. Quality total_score — 0.4 weight
    if (b.quality?.total_score != null) {
      total += b.quality.total_score / 100;
      weight += 0.4;
    }
    // 3b. Valuation upside % — 0.4 weight (direction-aware: positive for CALL)
    if (b.valuation?.upside_pct != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const v = Math.tanh(b.valuation.upside_pct / 20 * sign);
      total += 0.5 + 0.5 * v;
      weight += 0.4;
    }
    // 3c. Delivery % — 0.2 weight (cash-only signal)
    if (b.delivery?.pct != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const c2c = b.live.change_pct ?? 0;
      const deliveryOnGreen = c2c > 0 ? b.delivery.pct : 0;  // 0 if not green
      // Score 0..1: 60%+ delivery is good, 30% is bad
      const v = sign > 0
        ? Math.max(0, Math.min(1, (deliveryOnGreen - 20) / 50))
        : Math.max(0, Math.min(1, (100 - deliveryOnGreen) / 50));
      total += v;
      weight += 0.2;
    }

    if (weight === 0) return 0.5;
    return VerdictEngine._normaliseSubScore(total, weight);
  }

  // ── Sub-score 4: flow_options (0..1) — Cards #11, #15, #16 ────────

  private static _igsFlowOptions(b: import('./UnifiedAlphaInputs').AlphaInputsBundle): number {
    let total = 0;
    let weight = 0;

    // 4a. CVD — 0.3 weight
    if (b.orderFlow?.cvd != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const v = Math.tanh(b.orderFlow.cvd * 2 * sign);
      total += 0.5 + 0.5 * v;
      weight += 0.3;
    }
    // 4b. OBI (proxy from ore_score) — 0.2 weight
    if (b.orderFlow?.obi != null) {
      const v = Math.tanh(b.orderFlow.obi);
      total += 0.5 + 0.5 * v;
      weight += 0.2;
    }
    // 4c. PCR — 0.2 weight
    if (b.optionChain?.pcr != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      // PCR > 1 favours CALL (more puts = bearish hedging = bullish), PCR < 1 favours PUT
      const pcrScore = 0.5 + 0.5 * Math.tanh((b.optionChain.pcr - 1) * 2 * sign);
      total += pcrScore;
      weight += 0.2;
    }
    // 4d. FII total OI net — 0.3 weight
    if (b.fiiDii?.fii_total_oi_net != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const v = Math.tanh(b.fiiDii.fii_total_oi_net / 5000 * sign);
      total += 0.5 + 0.5 * v;
      weight += 0.3;
    }

    if (weight === 0) return 0.5;
    return VerdictEngine._normaliseSubScore(total, weight);
  }

  // ── Sub-score 5: momentum (0..1) — Cards #2, #9 ────────────────────

  private static _igsMomentum(b: import('./UnifiedAlphaInputs').AlphaInputsBundle): number {
    let total = 0;
    let weight = 0;

    // 5a. Top gainer flag(s) — 0.3 weight
    if (b.historical.is_weekly_gainer || b.historical.is_monthly_gainer || b.historical.is_yearly_gainer) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      // For PUT, we want losers
      const onRightSide = sign > 0
        ? (b.historical.is_weekly_gainer || b.historical.is_monthly_gainer || b.historical.is_yearly_gainer)
        : (b.historical.is_weekly_loser || b.historical.is_monthly_loser);
      total += onRightSide ? 1.0 : 0.0;
      weight += 0.3;
    }
    // 5b. ORB breakout — 0.2 weight
    if (b.orb?.breakout) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const isMatch = (b.orb.breakout === 'Bullish') === (sign > 0);
      total += isMatch ? 1.0 : 0.0;
      weight += 0.2;
    }
    // 5c. RVOL — 0.3 weight
    if (b.live.rvol != null && b.live.rvol > 0) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const c2c = b.live.change_pct ?? 0;
      const rvolOnDirection = (c2c * sign) > 0 ? b.live.rvol : Math.max(0, 2 - b.live.rvol);
      total += Math.max(0, Math.min(1, (rvolOnDirection - 1) / 2));
      weight += 0.3;
    }
    // 5d. Day change% aligned with direction — 0.2 weight
    if (b.live.change_pct != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      total += Math.max(0, Math.min(1, 0.5 + 0.5 * Math.tanh(b.live.change_pct * sign / 2)));
      weight += 0.2;
    }

    if (weight === 0) return 0.5;
    return VerdictEngine._normaliseSubScore(total, weight);
  }

  // ── Sub-score 6: risk_gates (0..1) — RVOL + spread + OI + liq + earnings ──

  private static _igsRiskGates(b: import('./UnifiedAlphaInputs').AlphaInputsBundle): number {
    let total = 0;
    let weight = 0;

    // 6a. RVOL — 0.3 weight
    if (b.live.rvol != null && b.live.rvol > 0) {
      total += Math.max(0, Math.min(1, b.live.rvol / 2));
      weight += 0.3;
    }
    // 6b. Earnings risk gate — 0.2 weight (failing or imminent = 0)
    if (b.earnings) {
      total += b.earnings.imminent ? 0.0 : 1.0;
      weight += 0.2;
    }
    // 6c. OI change% — 0.2 weight
    if (b.derivativeQuadrant?.oi_change_pct != null) {
      const sign = b.direction === 'CALL' ? 1 : -1;
      const v = Math.tanh(Math.abs(b.derivativeQuadrant.oi_change_pct) / 5 * sign);
      total += 0.5 + 0.5 * v;
      weight += 0.2;
    }
    // 6d. Valuation bubble penalty — 0.1 weight
    if (b.valuation?.upside_pct != null && b.valuation.upside_pct < -30) {
      total += 0;
    } else if (b.valuation?.upside_pct != null) {
      // Valuation present but not a bubble — neutral 1.0
      total += 1.0;
      weight += 0.1;
    }
    // (no data → no contribution)
    // 6e. Insider/MF exit penalty — 0.2 weight
    if (b.insider?.significant_exit != null || b.mfFlow?.significant_exit != null) {
      const exitPenalty = (b.insider?.significant_exit ? 0.5 : 1.0) *
                          (b.mfFlow?.significant_exit ? 0.5 : 1.0);
      total += exitPenalty;
      weight += 0.2;
    }

    if (weight === 0) return 0.5;
    return VerdictEngine._normaliseSubScore(total, weight);
  }

  // ── Data completeness (% of sub-scores that have any data) ────────

  private static _igsDataCompleteness(b: import('./UnifiedAlphaInputs').AlphaInputsBundle): number {
    const subScores = [
      VerdictEngine._igsPattern(b),
      VerdictEngine._igsSmartMoney(b),
      VerdictEngine._igsFundamentals(b),
      VerdictEngine._igsFlowOptions(b),
      VerdictEngine._igsMomentum(b),
      VerdictEngine._igsRiskGates(b),
    ];
    const present = subScores.filter((s) => s !== 0.5).length;
    return Math.round((present / subScores.length) * 100);
  }
}

// ──────────────────────────────────────────────────────────────────────
// CC68.29 — IGS 0..100 result type
// ──────────────────────────────────────────────────────────────────────

export interface IGS100Result {
  symbol: string;
  igs: number;                    // 0..100
  verdict: 'HIGH CONVICTION' | 'MODERATE' | 'SPECULATIVE' | 'AVOID';
  verdictColor: string;
  subScores: {
    pattern: number;              // 0..1
    smart_money: number;
    fundamentals: number;
    flow_options: number;
    momentum: number;
    risk_gates: number;
  };
  weights: Readonly<typeof VerdictEngine.IGS_WEIGHTS>;
  dataCompleteness: number;       // 0..100
  computedAt: string;
}
