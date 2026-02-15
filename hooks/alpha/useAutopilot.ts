import { useState, useEffect, useRef } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useToast } from '../../components/shared/ToastProvider';
import { FNO_STOCKS } from '../../data/fno_stocks';
import { alphaEngineService } from '../../services/AlphaEngineService';
import { score as convictionScore, buildInputsFromStock } from '../../services/alpha/ConvictionEngine';
import { mceOrchestrator } from '../../services/mce/orchestrator';

export interface AutopilotTrade {
  symbol: string;
  dhan_symbol: string;
  option_instrument_key: string;
  journal_row_id: number;
  entry_price: number;
  highest_premium: number;
  sl_offset: number;
  stop_loss: number;
  quantity: number;
  strategy: string;
  order_id: string;
}

export interface AutopilotStatus {
  enabled: boolean;
  active_trade: AutopilotTrade | null;
  has_telegram: boolean;
}

export interface AutopilotResult {
  id: number;
  date: string;
  strategy: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entry_time: string;
  entry_price: number;
  exit_time: string | null;
  exit_price: number | null;
  quantity: number;
  stop_loss: number;
  target: number;
  pnl: number | null;
  pnl_pct: number | null;
  signal_score: number;
  nifty_direction: 'BULL' | 'BEAR';
  sector: string;
  sector_strength: number;
  order_id: string;
  status: 'OPEN' | 'CLOSED' | 'FAILED' | 'SKIPPED';
}

export const useAutopilot = (bullishStocks: any[], bearishStocks: any[]) => {
  const [enabled, setEnabled] = useState(false);
  const [expiryRollover, setExpiryRollover] = useState(false);
  const [activeTrade, setActiveTrade] = useState<AutopilotTrade | null>(null);
  const [hasTelegram, setHasTelegram] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [results, setResults] = useState<AutopilotResult[]>([]);
  const { toast } = useToast();
  
  const telegramBots = useSettingsStore(s => s.telegramBots);
  const rootTelegramBotToken = useSettingsStore(s => s.telegramBotToken);
  const rootTelegramChatId = useSettingsStore(s => s.telegramChatId);

  // Find bot with 'autopilot' role, fall back to root keys
  const autopilotBot = (telegramBots || []).find(b => b.role === 'autopilot' && b.enabled);
  const telegramBotToken = autopilotBot ? autopilotBot.token : rootTelegramBotToken;
  const telegramChatId = autopilotBot ? autopilotBot.chatId : rootTelegramChatId;
  
  const hasTriggeredToday = useRef(false);

  // Helper to get current time in IST
  const getISTTime = () => {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 5.5));
  };

  const fetchStatus = async (showToast: boolean = false) => {
    try {
      if (showToast) {
        setSyncing(true);
        // Simultaneously fetch execution logs/results to refresh all tables on click
        fetchResults();
      }
      
      const response = await fetch('/api/python-nse/api/autopilot/status');
      if (response.ok) {
        const data = await response.json();
        setEnabled(data.enabled);
        if (data.expiry_rollover !== undefined) {
          setExpiryRollover(data.expiry_rollover);
        }
        setActiveTrade(data.active_trade);
        setHasTelegram(data.has_telegram);
        if (showToast) {
          toast.success('Synced positions and active status with OpenAlgo.', { title: 'Sync Successful 🔄' });
        }
      }
    } catch (err) {
      console.error('Failed to fetch autopilot status:', err);
      if (showToast) {
        toast.error('Could not connect to OpenAlgo bridge.', { title: 'Sync Error ❌' });
      }
    } finally {
      if (showToast) {
        // Ensure the spin animation plays for at least 800ms for a premium responsive feel
        setTimeout(() => setSyncing(false), 800);
      }
    }
  };

  const fetchResults = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/python-nse/api/autopilot/results');
      if (response.ok) {
        const data = await response.json();
        setResults(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch autopilot results:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleAutopilot = async (val: boolean) => {
    console.log('[Autopilot] toggleAutopilot called with:', val);
    try {
      const response = await fetch('/api/python-nse/api/autopilot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: val })
      });
      if (response.ok) {
        setEnabled(val);
        if (val) {
          toast.success('Scanning live signals for Dhan Sandbox execution...', { title: 'Autopilot Enabled 🤖' });
        } else {
          toast.info('Automated trading monitor turned off.', { title: 'Autopilot Disabled ⏹' });
        }
      } else {
        const data = await response.json();
        console.error('[Autopilot] toggle failed:', data);
        toast.error(data.detail || 'Failed to update autopilot state on server.', { title: 'Toggle Failed ❌' });
      }
    } catch (err) {
      console.error(err);
      toast.error('Network error during autopilot toggle.', { title: 'Network Error' });
    }
  };

  const toggleExpiryRollover = async (val: boolean) => {
    try {
      const response = await fetch('/api/python-nse/api/autopilot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiry_rollover: val })
      });
      if (response.ok) {
        setExpiryRollover(val);
        toast.info(val ? 'Expiry Roll-Over enabled: Options will roll to next expiry on expiry days.' : 'Expiry Roll-Over disabled: Using 0DTE nearest expiry.', { title: 'Theta Guard Updated 🛡️' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const forceClose = async () => {
    try {
      const response = await fetch('/api/python-nse/api/autopilot/close', {
        method: 'POST'
      });
      if (response.ok) {
        toast.success('Manual square-off order placed successfully.', { title: 'Position Exited ⏹' });
        fetchStatus();
      } else {
        const data = await response.json();
        toast.error(data.detail || 'Failed to close position.', { title: 'Exit Failed ❌' });
      }
    } catch (err) {
      console.error(err);
      toast.error('Network error during manual close request.', { title: 'Network Error' });
    }
  };

  // Poll status every 30 seconds
  useEffect(() => {
    fetchStatus(false);
    fetchResults();
    const interval = setInterval(() => fetchStatus(false), 30000);
    return () => clearInterval(interval);
  }, []);

  // Main automation trigger logic
  useEffect(() => {
    if (!enabled || activeTrade) return;
    
    const checkAndTriggerTrade = async () => {
      const ist = getISTTime();
      const isTradingDay = ist.getDay() >= 1 && ist.getDay() <= 5; // Mon-Fri
      if (!isTradingDay) return;

      const hour = ist.getHours();
      const minute = ist.getMinutes();
      const isWindow = (hour === 10) || (hour === 11 && minute <= 30); // Active window 10:00 AM to 11:30 AM IST

      if (!isWindow) {
        // Reset trigger flag outside the window
        if (hour < 10) {
          hasTriggeredToday.current = false;
        }
        return;
      }

      if (hasTriggeredToday.current) return;

      // 1. Fetch Nifty change
      let niftyChange = null;
      try {
        const niftyRes = await fetch('/api/python-nse/api/upstox/ltp-quotes?symbols=NIFTY');
        if (niftyRes.ok) {
          const ltpData = await niftyRes.json();
          const niftyData = ltpData.data?.['NSE_INDEX:Nifty 50'] || ltpData.data?.['NSE_INDEX|Nifty 50'];
          if (niftyData && niftyData.last_price && niftyData.cp) {
            niftyChange = ((niftyData.last_price - niftyData.cp) / niftyData.cp) * 100;
          }
        }
      } catch (err) {
        console.error('Autopilot Nifty fetch error:', err);
        return; // Skip this cycle if Nifty query fails
      }

      if (niftyChange === null) return;

      // 2. Fetch cached stocks and sectors from the global service
      const allStocks = alphaEngineService.getCachedStocks() || [];
      const allSectors = alphaEngineService.getCachedSectors() || [];
      const mood = alphaEngineService.getCachedMood() ?? null;
      const isBullishMood = mood?.isBullish ?? (niftyChange > 0);

      if (allStocks.length === 0) return;

      // Setup F&O symbol checker
      const fnoSymbols = new Set(FNO_STOCKS.map(x => x.symbol.toUpperCase()));

      // Helper: hard-kill check
      const isKilled = (stock: any, sectorSCS: number, isBull: boolean): boolean => {
        if (stock.isExhausted) return true;
        if (stock.isTrapRisk) return true;
        if ((stock.gFactor ?? 0) < 4.0) return true;
        // Must have sector in the right direction
        if (isBull && sectorSCS < 0) return true;
        if (!isBull && sectorSCS > 0) return true;
        return false;
      };

      // Helper: computeTradeSniperScore
      const computeSniperScore = (
        stock: any,
        sectorSCS: number,
        sectorFatigueScore: number,
        marketBullish: boolean
      ) => {
        const isBull = stock.signal === 'Up';
        const dir: 'CALL' | 'PUT' = isBull ? 'CALL' : 'PUT';

        const flags = {
          marketBullish: isBull ? marketBullish : !marketBullish,
          sectorStrong: isBull ? sectorSCS >= 25 : sectorSCS <= -25,
          sectorNotExhausted: isBull ? sectorFatigueScore <= 2 : sectorFatigueScore >= -2,
          gFactorOk: (stock.gFactor ?? 0) >= 6.0,
          rFactorOk: (stock.rFactor ?? 1.0) >= 1.5, // R_FACTOR_SECONDARY is 1.5
          notExhausted: !stock.isExhausted,
          notTrapRisk: !stock.isTrapRisk,
          orbPreserved: isBull ? (stock.isORBLowPreservedProxy ?? false) : (stock.isORBHighPreservedProxy ?? false),
        };

        const weights = {
          marketBullish: 10,
          sectorStrong: 20,
          sectorNotExhausted: 10,
          gFactorOk: 20,
          rFactorOk: 15,
          notExhausted: 15,
          notTrapRisk: 5,
          orbPreserved: 5,
        };

        let scoreVal = 0;
        let checksPassed = 0;
        (Object.keys(flags) as (keyof typeof flags)[]).forEach(k => {
          if (flags[k]) {
            scoreVal += weights[k];
            checksPassed++;
          }
        });

        // Bonuses
        if (isBull && sectorFatigueScore <= -3) scoreVal = Math.min(100, scoreVal + 8);
        if (!isBull && sectorFatigueScore >= 3) scoreVal = Math.min(100, scoreVal + 8);
        if ((stock.gFactor ?? 0) >= 8.0) scoreVal = Math.min(100, scoreVal + 5);
        if (stock.isRebound && isBull) scoreVal = Math.min(100, scoreVal + 5);

        return { score: scoreVal, passingChecks: checksPassed, direction: dir };
      };

      const candidatesList: any[] = [];

      allStocks.forEach(stock => {
        const symbolUpper = stock.symbol.toUpperCase();
        if (!fnoSymbols.has(symbolUpper)) return;

        const isBull = stock.signal === 'Up';

        // Find sector info
        const sData = allSectors.find(s =>
          s.sector === stock.sector ||
          s.sector === stock.sector?.replace('NIFTY ', '') ||
          stock.sector?.includes(s.sector)
        );

        const sectorSCS = sData?.confluenceScore ?? 0;
        const sectorFatigueScore = sData?.fatigueScore ?? 0;
        const sectorName = sData?.sector ?? stock.sector ?? 'Unknown';

        // Kill check
        if (isKilled(stock, sectorSCS, isBull)) return;

        // Score check
        const { score, passingChecks, direction: dir } = computeSniperScore(
          stock, sectorSCS, sectorFatigueScore, isBullishMood
        );

        if (passingChecks < 5 || score < 55) return;

        candidatesList.push({
          stock,
          sectorName,
          sectorSCS,
          sectorFatigue: sectorFatigueScore,
          direction: dir,
          score,
        });
      });

      if (candidatesList.length === 0) return;

      // Take top 8 candidates sorted by sync score
      candidatesList.sort((a, b) => b.score - a.score);
      const top8 = candidatesList.slice(0, 8);

      // Async conviction enrichment
      const enriched = await Promise.all(
        top8.map(async (cand) => {
          try {
            const mcsSnap = await mceOrchestrator.score(cand.stock.symbol, 'PRE_ENTRY');
            const inputs = buildInputsFromStock(cand.stock, {
              mcs: mcsSnap,
              direction: cand.direction,
              sectorSCSOverride: cand.sectorSCS,
              sectorFatigueOverride: cand.sectorFatigue,
              fiiNetBuyer: isBullishMood,
            });
            const cx = convictionScore(inputs);
            return { ...cand, conviction: cx };
          } catch {
            return cand;
          }
        })
      );

      // Sort by final conviction score descending
      enriched.sort((a, b) => {
        const aScore = a.conviction && !a.conviction.killed ? a.conviction.score : a.score;
        const bScore = b.conviction && !b.conviction.killed ? b.conviction.score : b.score;
        return bScore - aScore;
      });

      const topPick = enriched[0];
      if (!topPick) return;

      const finalScore = topPick.conviction && !topPick.conviction.killed ? topPick.conviction.score : topPick.score;

      // Minimum score threshold of 70 Conviction Points
      if (finalScore < 70) return;

      hasTriggeredToday.current = true;
      const tradeDirection = topPick.direction === 'CALL' ? 'BUY' : 'SELL';
      logTrigger(topPick.stock, tradeDirection, finalScore);

      try {
        const response = await fetch('/api/python-nse/api/autopilot/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: topPick.stock.symbol,
            sector: topPick.sectorName || 'UNKNOWN',
            direction: tradeDirection,
            ltp: topPick.stock.lastPrice || 0,
            strengthFactor: finalScore,
            sectorStrength: topPick.sectorSCS || 1.0,
            niftyChange: niftyChange,
            strategy: 'FNO_SectorRotation',
            bot_token: telegramBotToken || null,
            chat_id: telegramChatId || null,
            bypass_checks: false
          })
        });

        if (response.ok) {
          toast.success(`Punching 1 lot ATM option for ${topPick.stock.symbol} on Dhan Sandbox.`, { title: 'Autopilot Trade Triggered! 🚀' });
          fetchStatus();
        } else {
          const data = await response.json();
          console.warn('Autopilot execution rejected:', data.detail);
        }
      } catch (err) {
        console.error('Failed to trigger autopilot signal:', err);
      }
    };

    const logTrigger = (stock: any, dir: string, score: number) => {
      console.log(`🤖 Autopilot selecting top conviction pick: ${stock.symbol} (${dir}) with score ${score}`);
    };

    checkAndTriggerTrade();
    const triggerInterval = setInterval(checkAndTriggerTrade, 30000); // Check every 30s
    return () => clearInterval(triggerInterval);
  }, [enabled, activeTrade, telegramBotToken, telegramChatId]);

  return {
    enabled,
    expiryRollover,
    activeTrade,
    hasTelegram,
    loading,
    syncing,
    results,
    toggleAutopilot,
    toggleExpiryRollover,
    forceClose,
    fetchStatus: () => fetchStatus(true),
    fetchResults
  };
};
