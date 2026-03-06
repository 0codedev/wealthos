import { llmPipeline } from '../llm';
import { logger } from '../Logger';
import { SentinelTelemetry } from './MarketSentinel';
import { memoryVault } from './MemoryVault';
import { macroRegimeService } from '../MacroRegimeService';
import { useSettingsStore } from '../../store/settingsStore';

export class JarvisBrain {
  private static instance: JarvisBrain;
  private lastBriefTime = 0;
  private briefCooldownMs = 15 * 60 * 1000; // 15 minutes cooldown

  private constructor() {}

  static getInstance(): JarvisBrain {
    if (!JarvisBrain.instance) {
      JarvisBrain.instance = new JarvisBrain();
    }
    return JarvisBrain.instance;
  }

  /**
   * Generates a spoken brief based on sentinel telemetry.
   * Enforces 15-minute rate limit unless force is true.
   */
  async generateBrief(telemetry: SentinelTelemetry, force = false): Promise<string | null> {
    const now = Date.now();
    if (!force && now - this.lastBriefTime < this.briefCooldownMs) {
      logger.info('[JarvisBrain] Brief requested within cooldown period. Skipping LLM call.');
      return null;
    }

    try {
      // Get macro regime classification
      // Convert Sentinel indicators to MacroIndicator array
      const indicators = [
        { id: 'vix', name: 'India VIX', value: telemetry.vix, change: 0, source: 'sentinel' }
      ];
      const regime = macroRegimeService.classifyRegime(indicators, telemetry.fiiNet);
      const regimeConfig = macroRegimeService.getRegimeConfig(regime);

      // Build context description
      let sentinelAlertText = '';
      if (telemetry.confluenceScore >= 2) {
        sentinelAlertText = `WARNING: Telemetry confluence score is ${telemetry.confluenceScore}/3. `;
        if (telemetry.isVixSpike) sentinelAlertText += 'India VIX is elevated. ';
        if (telemetry.isFiiSelling) sentinelAlertText += 'FIIs are net selling aggressively. ';
        if (telemetry.isEmaTesting) sentinelAlertText += 'Nifty 50 spot price is testing the key 200 EMA support zone. ';
      }

      const prompt = `You are Jarvis, a professional, premium, and intelligent personal finance assistant for an Indian investor.
Given the following real-time market telemetry:
- Nifty 50 Spot: ${telemetry.niftySpot.toFixed(2)}
- 200 EMA Level: ${telemetry.nifty200EMA.toFixed(2)}
- India VIX: ${telemetry.vix.toFixed(2)}
- FII Net Cash Flow: ${telemetry.fiiNet} Cr
- Macro Regime Classification: ${regimeConfig.name}
- Sentinel Alert Context: ${sentinelAlertText || 'No major anomalies.'}

Write a short, punchy market briefing (exactly 2 to 3 sentences) suitable for text-to-speech. 
If the confluence score is high (2 or 3), suggest a conservative paper trade strategy inline with preferred setups: ${regimeConfig.preferredSetups.join(', ')}.
Keep comments clear, professional, and do not use any markdown formatting (*, #, \`, _). Provide strictly plain text. Always end with a very short compliance disclaimer.`;

      // Call the LLM pipeline using a fast model (Gemini 2.5 Flash / modelRegistry preferred default)
      const res = await llmPipeline(prompt, {
        noCache: true,
        requireHighIntelligence: false
      });

      const briefText = res.text.trim();
      this.lastBriefTime = now;

      // Save the brief to the memory vault
      await memoryVault.saveBrief(briefText, {
        vix: telemetry.vix,
        fiiFlow: telemetry.fiiNet,
        signal: telemetry.fiiNet > 0 ? 'BULLISH' : (telemetry.fiiNet < -1000 ? 'BEARISH' : 'NEUTRAL'),
        confidence: telemetry.confluenceScore >= 2 ? 85 : 50
      });

      return briefText;
    } catch (err) {
      logger.error('[JarvisBrain] Failed to generate market brief', err);
      return null;
    }
  }

  setCooldownMinutes(mins: number) {
    this.briefCooldownMs = mins * 60 * 1000;
  }
}

export const jarvisBrain = JarvisBrain.getInstance();
