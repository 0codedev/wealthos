import { db } from '../database';
import { useCrossTabStore, CrossTabSignal } from '../store/crossTabStore';
import { llmPipeline } from './llm';
import { MarketPulseService } from './MarketPulseService';
import { AstroPsychologyService } from './AstroPsychologyService';
import { useSettingsStore } from '../store/settingsStore';
import { logger } from './Logger';

const LOCK_KEY = 'wealth_crosstab_correlator_lock';
const LOCK_TTL = 30 * 1000; // 30s execution window

let tabId = '';
function getTabId() {
  if (!tabId) {
    tabId = 'tab_' + Math.random().toString(36).substring(2) + '_' + Date.now();
  }
  return tabId;
}

function acquireLock(): boolean {
  const now = Date.now();
  const rawLock = localStorage.getItem(LOCK_KEY);
  if (rawLock) {
    try {
      const lock = JSON.parse(rawLock);
      if (now < lock.expiresAt && lock.tabId !== getTabId()) {
        return false;
      }
    } catch {
      localStorage.removeItem(LOCK_KEY);
    }
  }
  localStorage.setItem(LOCK_KEY, JSON.stringify({
    expiresAt: now + LOCK_TTL,
    tabId: getTabId()
  }));
  return true;
}

function releaseLock() {
  try {
    const rawLock = localStorage.getItem(LOCK_KEY);
    if (rawLock) {
      const lock = JSON.parse(rawLock);
      if (lock.tabId === getTabId()) {
        localStorage.removeItem(LOCK_KEY);
      }
    }
  } catch {}
}

export class CrossTabCorrelator {
  private static instance: CrossTabCorrelator;
  private intervalId: any = null;

  private constructor() {}

  public static getInstance(): CrossTabCorrelator {
    if (!CrossTabCorrelator.instance) {
      CrossTabCorrelator.instance = new CrossTabCorrelator();
    }
    return CrossTabCorrelator.instance;
  }

  public startPolling(intervalMs: number = 60 * 60 * 1000) {
    if (this.intervalId) return;

    // Debounce boot run by 10 seconds
    setTimeout(() => {
      this.correlate();
    }, 10000);

    this.intervalId = setInterval(() => {
      this.correlate();
    }, intervalMs);
  }

  public stopPolling() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public async correlate(force: boolean = false): Promise<void> {
    const store = useCrossTabStore.getState();
    const settings = useSettingsStore.getState();

    if (!settings.isAICoachEnabled) return;

    const now = Date.now();
    const minInterval = 15 * 60 * 1000; // 15 mins minimum interval unless forced

    if (!force && (now - store.lastRunTimestamp < minInterval)) {
      logger.debug("CrossTabCorrelator: Skipped correlation, fresh enough.");
      return;
    }

    // Try to acquire distributed lock
    if (!acquireLock()) {
      logger.debug("CrossTabCorrelator: Another tab holds the lock. Skipping execution.");
      return;
    }

    try {
      store.setCorrelating(true);
      logger.info("CrossTabCorrelator: Acquiring data for holistic cross-tab analysis...");

      const investments = await db.investments.toArray();
      const trades = await db.trades.toArray();
      const ipos = await db.ipo_applications.toArray();
      const goals = await db.goals.toArray();
      const mistakes = await db.mistakes.toArray();
      const pulse = await MarketPulseService.getPulse();
      
      const astroStats = settings.isAstroPsychologyEnabled ? 
        await AstroPsychologyService.getTodayAstroStats() : null;

      const totalPortfolioValue = investments.reduce((sum, inv) => sum + (inv.currentValue || 0), 0);
      const totalBlockedIpo = ipos.filter(i => i.status === 'BLOCKED').reduce((sum, i) => sum + (i.amount || 0), 0);
      
      const setupPerformance = trades.reduce((acc, t) => {
        if (t.setup) acc[t.setup] = (acc[t.setup] || 0) + (t.pnl || 0);
        return acc;
      }, {} as Record<string, number>);

      const contextBlock = `
=== PORTFOLIO ===
- Total Value: ₹${totalPortfolioValue.toLocaleString('en-IN')}
- Holdings count: ${investments.length}
- Sectors: ${Array.from(new Set(investments.map(i => i.sector))).join(', ')}

=== JOURNAL & BEHAVIOR ===
- Total Trades: ${trades.length}
- Setup PnL: ${JSON.stringify(setupPerformance)}
- Total Mistakes Logged: ${mistakes.length}
- Recent Mistakes: ${mistakes.slice(-5).map(m => `${m.title} (Cost: ₹${m.cost})`).join(', ') || 'None'}

=== IPO PIPELINE ===
- Total Locked Capital: ₹${totalBlockedIpo.toLocaleString('en-IN')}
- Overdue blocks (>30 days): ${ipos.filter(i => i.status === 'BLOCKED' && (Date.now() - new Date(i.appliedDate).getTime()) > 30 * 24 * 60 * 60 * 1000).length}

=== GOALS ===
- Total Goals: ${goals.length}
- Critical Goals: ${goals.filter(g => g.priority === 'Critical').map(g => `${g.name} (Target: ₹${g.targetAmount}, Current: ₹${g.currentAmount})`).join(', ') || 'None'}

=== MARKET PULSE ===
- Nifty Trend: ${pulse.niftyTrend}
- FII Flow: ${pulse.fiiFlow}
- Hot Sectors: ${pulse.hotSectors.join(', ')}
- Avoid Sectors: ${pulse.avoidSectors.join(', ')}

=== BEHAVIORAL SHADOW (ASTRO) ===
${astroStats ? `- Today's trades: ${astroStats.todayTradeCount}
- Rahu Intensity: ${astroStats.rahuIntensity}/100
- Saturn Strength: ${astroStats.saturnStrength}/100
- Inside Rahu Shadow: ${astroStats.isInsideShadow}` : 'Astro-Psychology Disabled'}
      `;

      const prompt = `
You are the centralized brain of a Wealth Dashboard app. Your job is to perform a cross-domain correlation analysis of the user's trading patterns, portfolio risk, locked IPO capital, financial goals, and today's market conditions to identify hidden conflicts or compounding risks.

Review the user data and generate 2-4 critical "Cross-Tab Correlation Signals". These signals MUST connect at least two different domains/tabs (e.g. Journal + Portfolio, IPO + Goals, Portfolio + Market).

Respond ONLY with a JSON object:
{
  "signals": [
    {
      "type": "string_identifier_lowercase_with_underscores",
      "severity": "critical|warning|positive|info",
      "message": "One/two-sentence directive. Be specific, name tickers, setups, and numbers.",
      "affectedTabs": ["tab1", "tab2"]
    }
  ]
}

Available tabs to target in "affectedTabs": ["dashboard", "portfolio", "journal", "ipo", "market", "growth", "academy", "momentum", "backtester", "alpha", "analytics", "trading"].

Examples:
- "Revenge trading F&O setups (Journal) while BANKNIFTY is in a sharp downtrend (Market) is draining capital. Halt trading." -> ["journal", "market", "trading"]
- "₹85,000 blocked in overdue IPOs (IPO) is causing you to fall behind on your House SIP Goal (Growth)." -> ["ipo", "growth"]
- "IT holdings are 35% of portfolio (Portfolio), but IT is marked as an Avoid Sector this week (Market)." -> ["portfolio", "market"]
      
User context:
${contextBlock}
      `;

      const response = await llmPipeline(prompt, {
        jsonMode: true,
        modelOverride: 'gemini-3.1-flash-lite-preview'
      });

      const parsed = JSON.parse(response.text.replace(/```json|```/g, '').trim());
      const signals: CrossTabSignal[] = parsed.signals || [];
      
      store.setSignals(signals);
      store.setLastRunTimestamp(Date.now());
      logger.info(`CrossTabCorrelator: Holistically correlated and generated ${signals.length} signals.`);

    } catch (e) {
      logger.error("CrossTabCorrelator: Correlation execution failed", e);
    } finally {
      store.setCorrelating(false);
      releaseLock();
    }
  }
}
