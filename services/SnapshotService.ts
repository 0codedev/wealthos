import { db, SnapshotRecord, SnapshotEntry } from '../database';
import { SECTOR_CONSTITUENTS } from '../data/sectorConstituents';
import { evaluateStrategyScore } from './alpha/StrategyEngine';
import { buildInputsFromStock } from './alpha/ConvictionEngine';
import { VerdictEngine } from './alpha/VerdictEngine';
import { loadStockTypeConfig, classifyStockType } from './alpha/StockTypeClassifier';
import { computeStockTypeFeatures, LiveCandle } from './alpha/stockTypeFeatures';

export class SnapshotService {
  /**
   * Save a snapshot of the current stock list to IndexedDB.
   */
  async saveSnapshot(
    trigger: 'auto_925' | 'manual_refresh' | 'eod',
    stocks: any[],
    context?: {
      volumeAverages?: Record<string, number>;
      orbDataCache?: Record<string, any[]>;
      dailyCandleData?: any;
      valuationDataCache?: Record<string, any[]>;
      shareholdingDataCache?: Record<string, any[]>;
      qualityDataCache?: Record<string, any[]>;
      boosterStocksList?: any[];
      historicalDataCache?: Record<string, any[]>;
      fiiDiiPulseData?: any[];
      derivativeSummaryData?: any[];
      oreMap?: Record<string, any>;
      cvdMap?: Record<string, any>;
      rsMap?: Record<string, any>;
      shareholdingMap?: Record<string, any>;
      oiSignalMap?: Record<string, any>;
      liveQuotes?: Record<string, any>;
    }
  ): Promise<void> {
    if (!stocks || stocks.length === 0) return;

    // Stock-type classifier config (shared with algo-engine); classify once per save
    let stockTypeConfig: Awaited<ReturnType<typeof loadStockTypeConfig>> | null = null;
    try {
      stockTypeConfig = await loadStockTypeConfig();
    } catch (err) {
      console.warn('[SnapshotService] stock_types_config unavailable, skipping type labels', err);
    }

    // Convert date to local IST date string (YYYY-MM-DD)
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Map the current stock objects to SnapshotEntry format safely supporting both lowercase and Capitalized shapes
    const entries: SnapshotEntry[] = stocks.map(s => {
      const symbol = (s.Symbol || s.symbol || 'UNKNOWN').toUpperCase().trim();
      const ltp = s.LTP !== undefined ? Number(s.LTP) : (Number(s.lastPrice) || 0);
      const percentChange = s.Change !== undefined ? Number(s.Change) : (Number(s.percentChange) || 0);
      const volume = s.Volume !== undefined ? Number(s.Volume) : (Number(s.volume) || 0);
      const openPrice = s.Open !== undefined ? Number(s.Open) : (Number(s.openPrice) || 0);
      const high = s.High !== undefined ? Number(s.High) : (Number(s.high) || 0);
      const low = s.Low !== undefined ? Number(s.Low) : (Number(s.low) || 0);
      
      const prevClose = s.prevClose !== undefined ? Number(s.prevClose) : (Number(s.previousClose) || ltp);
      const openingGapPct = s.openingGapPct !== undefined 
        ? Number(s.openingGapPct) 
        : (prevClose > 0 ? ((openPrice - prevClose) / prevClose) * 100 : 0);

      // Resolve Whole-day RVOL
      const avgVol = context?.volumeAverages?.[symbol] || context?.volumeAverages?.[symbol.toLowerCase()] || 0;
      const rvol_wholeday = avgVol > 0 ? volume / avgVol : (s.rvol !== undefined ? Number(s.rvol) : 1.0);

      // Resolve Time-of-day RVOL
      const rvol_timeofday = s.timeOfDayRvol !== undefined && s.timeOfDayRvol !== null 
        ? Number(s.timeOfDayRvol) 
        : (s.rvol !== undefined ? Number(s.rvol) : rvol_wholeday);

      const gFactor = s.gFactor !== undefined ? Number(s.gFactor) : (Number(s["Strength Factor"]) || 0);
      const rFactor = s.rFactor !== undefined && s.rFactor !== null ? Number(s.rFactor) : null;

      // Resolve Sector Name
      let sector = s.Sector || s.sector || '';
      if (!sector || sector === 'OTHERS') {
        const foundSector = Object.keys(SECTOR_CONSTITUENTS).find(secName => 
          SECTOR_CONSTITUENTS[secName].map(sym => sym.toUpperCase()).includes(symbol)
        );
        sector = foundSector || 'OTHERS';
      }

      const atr = s.atr !== undefined && s.atr !== null ? Number(s.atr) : null;
      const apexSignal = s.apexSignal || null;

      // ORB High/Low preserved flags
      const isORBLowPreserved = s.isORBLowPreservedProxy !== undefined 
        ? !!s.isORBLowPreservedProxy 
        : (s.isORBLowPreserved !== undefined ? !!s.isORBLowPreserved : low >= openPrice * 0.9985);

      const dayRange = high - low;
      const dayExtremeScore = s.dayExtremeScore !== undefined 
        ? Number(s.dayExtremeScore) 
        : (dayRange > 0 ? (percentChange >= 0 ? (ltp - low) / dayRange : (high - ltp) / dayRange) : 0.5);

      // Calculate Morning Momentum strategy score, verdict, and IGS checks
      let scoreVal: number | undefined;
      let verdictVal: string | undefined;
      let igsCheckCountVal: number | undefined;
      let igsCheckTotalVal: number | undefined;

      try {
        const sdForCalc = {
          symbol,
          companyName: s.CompanyName || s.companyName || '',
          sector,
          previousClose: prevClose,
          openPrice,
          high,
          low,
          lastPrice: ltp,
          percentChange,
          volume,
          value: s.value || 0,
          gFactor,
          rFactor: rFactor || 0,
          upperCircuit: s.upperCircuit,
          lowerCircuit: s.lowerCircuit,
          isTrapRisk: s.isTrapRisk || false,
          isExhausted: s.isExhausted || false,
          dailyPattern: s.dailyPattern,
          weeklyPattern: s.weeklyPattern,
          candleBuffer: s.candleBuffer,
          openingGapPct,
          dayExtremeScore
        };

        const inputs = buildInputsFromStock(sdForCalc as any, {
          rvol: rvol_timeofday || rvol_wholeday,
          direction: s.direction ?? (percentChange >= 0 ? 'CALL' : 'PUT')
        });

        const strategyRes = evaluateStrategyScore(sdForCalc as any, 'morning_snapback', inputs);
        scoreVal = strategyRes.score;
        verdictVal = strategyRes.p0Passed ? 'PO PASS' : 'HEURISTIC';

        if (context) {
          const verdictRes = VerdictEngine.compute(
            symbol,
            {
              orbDataCache: context.orbDataCache,
              dailyCandleData: context.dailyCandleData,
              valuationDataCache: context.valuationDataCache,
              shareholdingDataCache: context.shareholdingDataCache,
              qualityDataCache: context.qualityDataCache,
              boosterStocksList: context.boosterStocksList,
              historicalDataCache: context.historicalDataCache,
              fiiDiiPulseData: context.fiiDiiPulseData,
              derivativeSummaryData: context.derivativeSummaryData
            },
            context.liveQuotes || {},
            context.volumeAverages || {},
            false,
            {
              oreScore: context.oreMap?.[symbol]?.ore_score,
              oreDirection: context.oreMap?.[symbol]?.direction,
              cvd: context.cvdMap?.[symbol],
              oiSignal: context.oiSignalMap?.[symbol],
              rsRank: context.rsMap?.[symbol]?.rs_rank,
              rsCategory: context.rsMap?.[symbol]?.category,
              fiiVelocity: context.shareholdingMap?.[symbol]?.fii_velocity,
              valueZoneFlag: context.shareholdingMap?.[symbol]?.accumulation_flag === 'ACCUMULATING'
            }
          );
          if (verdictRes) {
            igsCheckCountVal = verdictRes.totalScore;
            igsCheckTotalVal = verdictRes.maxScore;
          }
        }
      } catch (err) {
        console.warn(`[SnapshotService] Failed to compute conviction metrics for ${symbol}:`, err);
      }

      // Stock-type classification (frozen with the photograph — never recalculated)
      let stockType: string | undefined;
      let stockPriority: number | undefined;
      let stockEvidence: Record<string, number | null> | undefined;
      if (stockTypeConfig) {
        try {
          const feats = computeStockTypeFeatures(
            {
              ltp, openPrice, high, low, openingGapPct, atr,
              volumeAverages20: avgVol || undefined,
            },
            (s.candleBuffer || s.candles) as LiveCandle[] | undefined,
          );
          const typeRes = classifyStockType(feats, 'cash', stockTypeConfig);
          stockType = typeRes.type_id;
          stockPriority = typeRes.priority;
          stockEvidence = Object.fromEntries(
            Object.entries(typeRes.evidence).map(([k, v]) => [k, typeof v === 'number' ? v : null]),
          );
        } catch (err) {
          console.warn(`[SnapshotService] stock-type classification failed for ${symbol}:`, err);
        }
      }

      return {
        symbol,
        ltp,
        percentChange: parseFloat(percentChange.toFixed(2)),
        volume,
        rvol_wholeday: parseFloat(rvol_wholeday.toFixed(2)),
        rvol_timeofday: rvol_timeofday !== null ? parseFloat(rvol_timeofday.toFixed(2)) : null,
        gFactor: parseFloat(gFactor.toFixed(2)),
        rFactor: rFactor !== null ? parseFloat(rFactor.toFixed(2)) : null,
        openPrice,
        high,
        low,
        openingGapPct: parseFloat(openingGapPct.toFixed(2)),
        isORBLowPreserved,
        dayExtremeScore: parseFloat(dayExtremeScore.toFixed(3)),
        sector,
        atr: atr !== null ? parseFloat(atr.toFixed(2)) : null,
        apexSignal,
        score: scoreVal,
        verdict: verdictVal,
        igsCheckCount: igsCheckCountVal,
        igsCheckTotal: igsCheckTotalVal,
        stockType,
        stockPriority,
        stockEvidence
      };
    });

    try {
      const record: SnapshotRecord = {
        date: todayStr,
        timestamp: new Date().toISOString(),
        trigger,
        stocks: entries
      };

      await db.snapshots.add(record);
      console.log(`[SnapshotService] Successfully saved snapshot with trigger "${trigger}" for date ${todayStr}`);
    } catch (err) {
      console.error('[SnapshotService] Failed to save snapshot:', err);
    }
  }

  /**
   * Delete an individual snapshot from IndexedDB.
   */
  async deleteSnapshot(id: number): Promise<void> {
    try {
      await db.snapshots.delete(id);
      console.log(`[SnapshotService] Successfully deleted snapshot with ID ${id}`);
    } catch (err) {
      console.error(`[SnapshotService] Failed to delete snapshot with ID ${id}:`, err);
    }
  }

  /**
   * Get all snapshots recorded for a specific date (YYYY-MM-DD)
   */
  async getSnapshotsForDate(date: string): Promise<SnapshotRecord[]> {
    try {
      return await db.snapshots.where('date').equals(date).toArray();
    } catch (err) {
      console.error(`[SnapshotService] Failed to load snapshots for date ${date}:`, err);
      return [];
    }
  }

  /**
   * Get list of unique dates (YYYY-MM-DD) that have snapshots recorded. Sorted newest first.
   */
  async getAllDates(): Promise<string[]> {
    try {
      const dates = await db.snapshots.orderBy('date').uniqueKeys();
      return (dates as string[]).reverse();
    } catch (err) {
      console.error('[SnapshotService] Failed to load unique snapshot dates:', err);
      return [];
    }
  }

  /**
   * Delete all snapshots completely from IndexedDB (explicit manual action only)
   */
  async purgeAllSnapshots(): Promise<void> {
    try {
      await db.snapshots.clear();
      console.log('[SnapshotService] Cleared all snapshots successfully.');
    } catch (err) {
      console.error('[SnapshotService] Failed to clear snapshots:', err);
    }
  }
}

export const snapshotService = new SnapshotService();
