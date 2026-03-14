import { useSettingsStore } from '../store/settingsStore';
import { notificationService } from './NotificationService';
import { telegramAlertService, MomentumSpikeEvent } from './TelegramAlertService';
import { jarvis2Service } from './Jarvis2Service';
import { logger } from './Logger';

class OmniAlertDispatcher {
  private lastAlertTimes: Map<string, number> = new Map();

  constructor() {
    // Dynamic import to prevent circular dependency cycles
    setTimeout(() => {
      import('./PoolPollEngine').then(({ poolPollEngine }) => {
        poolPollEngine.onEvent((event) => {
          if (event.type === 'pool:alert-fired') {
            this.handlePoolAlert(event.item, event.verdict);
          }
        });
      }).catch(err => {
        logger.error('OmniAlertDispatcher: Failed to subscribe to PoolPollEngine', err);
      });
    }, 100);
  }

  private async handlePoolAlert(item: any, verdict: any): Promise<void> {
    const settings = useSettingsStore.getState();
    if (!settings.omniAlertEnabled) return;

    logger.info(`OmniAlertDispatcher: Handling pool level alert for ${item.ticker} (Trigger: ${verdict.triggerType})`);

    const tasks: Promise<any>[] = [];

    // 1. Browser Native Notification
    const formattedPrice = item.lastPrice ? item.lastPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'N/A';
    const browserTitle = verdict.triggerType === 'STOP_HIT' ? `🛑 Stop Hit: ${item.ticker}` : `🎯 Target Hit: ${item.ticker}`;
    const browserBody = `CMP: ₹${formattedPrice}\nLevel Alert Triggered.`;

    tasks.push(notificationService.send({
      title: browserTitle,
      body: browserBody,
      tag: `pool-alert-${item.ticker}-${Date.now()}`,
      requireInteraction: true
    }));

    // 2. Telegram Alert (Route to Topic #10)
    if (settings.telegramEnabled) {
      tasks.push(telegramAlertService.sendPoolAlert(
        item.ticker,
        verdict.triggerType as any,
        item.lastPrice || 0,
        { targetSell: item.targetSellPrice, targetBuy: item.targetBuyPrice, stopLoss: item.stopLoss }
      ));
    }

    // 3. Haptic Vibration
    try {
      const { triggerHapticNotification } = require('../utils/haptics');
      triggerHapticNotification(verdict.triggerType === 'STOP_HIT' ? 'error' : 'success');
    } catch (err) {
      // ignore
    }

    await Promise.all(tasks).catch(err => {
      logger.error('OmniAlertDispatcher: Error dispatching pool level alert', err);
    });
  }

  async fire(event: MomentumSpikeEvent, newsHeadline?: string): Promise<void> {
    const settings = useSettingsStore.getState();
    if (!settings.omniAlertEnabled) return;

    // Enforce user-configured alert cooldown check (per symbol + alert type)
    const cooldownMins = settings.omniAlertCooldownMinutes || 10;
    const cooldownMs = cooldownMins * 60 * 1000;
    const cooldownKey = `${event.symbol}-${event.triggerType}`;
    const lastAlert = this.lastAlertTimes.get(cooldownKey) || 0;
    const now = Date.now();

    // News driven alerts can bypass cooldown if settings allow
    const isNews = event.triggerType === 'NEWS_DRIVEN';
    const bypassCooldown = isNews && settings.omniAlertNewsAlwaysFires;

    if (!bypassCooldown && (now - lastAlert < cooldownMs)) {
      logger.info(`OmniAlertDispatcher: Suppressing duplicate alert for ${event.symbol} (${event.triggerType}) - cooldown active`);
      return;
    }
    
    // Set the cooldown timestamp
    this.lastAlertTimes.set(cooldownKey, now);

    logger.info(`OmniAlertDispatcher: Firing alert for ${event.symbol}. Trigger: ${event.triggerType}`);

    // Create parallel tasks
    const tasks: Promise<any>[] = [];

    // 1. Browser Native Notification
    const formattedPrice = event.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const formattedPct = event.movePct !== 0 ? ` (${event.direction === 'UP' ? '+' : ''}${event.movePct.toFixed(2)}%)` : '';
    const browserTitle = `${event.direction === 'UP' ? '🚀' : '⚠️'} ${event.symbol} Alert`;
    
    const bodyLines = [
      `🎯 Trigger: ${event.triggerType.replace(/_/g, ' ')}`,
      `💰 LTP: ₹${formattedPrice}${formattedPct}`
    ];
    if (event.velocity && event.velocity !== 'N/A') {
      bodyLines.push(`⚡ Speed: ${event.velocity}`);
    }
    if (event.volumeMultiplier > 0) {
      bodyLines.push(`📊 Vol Spike: ${event.volumeMultiplier}x`);
    }
    if (newsHeadline) {
      bodyLines.push(`📰 Detail: ${newsHeadline}`);
    }
    
    const browserBody = bodyLines.join('\n');

    tasks.push(notificationService.send({
      title: browserTitle,
      body: browserBody,
      tag: `omni-${event.symbol}-${event.timestamp}`,
      requireInteraction: false
    }));

    // 2. Telegram Alert (Route to correct bot based on symbol type)
    if (settings.telegramEnabled) {
      const telegramMsg = this.buildTelegramMessage(event, newsHeadline);
      const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX', 'NIFTY50', 'NIFTY_50', 'BANK_NIFTY'].some(
        idx => event.symbol.toUpperCase().includes(idx)
      );
      
      if (isIndex) {
        // Indices, HOD/LOD, approaching range and velocity spikes go to the 'alerts' bot (Wealthos Alerts Bot)
        tasks.push(telegramAlertService.sendToRole('alerts', telegramMsg));
      } else {
        // F&O stock breakouts, ORB levels, etc. go to the 'autopilot' bot (Trade Trigger Bot)
        tasks.push(telegramAlertService.sendToRole('autopilot', telegramMsg));
      }
    }

    // 3. n8n Webhook
    if (settings.n8nWebhookUrl) {
      tasks.push(notificationService.sendToNervousSystem('momentum_spike', {
        event,
        newsHeadline,
        timestamp: new Date().toISOString()
      }));
    }

    // 4. Jarvis Voice Announcement (if app is focused and setting enabled)
    if (settings.omniAlertJarvisVoice && typeof document !== 'undefined' && document.hasFocus()) {
      const voiceText = this.buildJarvisAnnouncement(event, newsHeadline);
      jarvis2Service.speak(voiceText);
    }

    await Promise.all(tasks).catch(err => {
      logger.error('OmniAlertDispatcher: Error firing alerts', err);
    });
  }

  buildTelegramMessage(event: MomentumSpikeEvent, news?: string): string {
    const directionEmoji = event.direction === 'UP' ? '📈' : '📉';
    const sign = event.direction === 'UP' ? '+' : '';
    const formattedPrice = event.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const triggerLabel = event.triggerType.replace(/_/g, ' ');

    let headerTitle = '';
    let emojiHeader = '';
    
    if (event.triggerType === 'ORB_BREAKOUT') {
      headerTitle = 'ORB BREAKOUT';
      emojiHeader = '⚡';
    } else if (event.triggerType === 'HOD_BREAKOUT' || event.triggerType === 'LOD_BREAKOUT') {
      headerTitle = event.triggerType === 'HOD_BREAKOUT' ? 'NEW DAY HIGH' : 'NEW DAY LOW';
      emojiHeader = '🏆';
    } else if (event.triggerType === 'INDEX_VELOCITY_SPIKE') {
      headerTitle = 'VELOCITY SPIKE (HFT)';
      emojiHeader = '⚡';
    } else if (event.triggerType === 'HOD_PROXIMITY' || event.triggerType === 'LOD_PROXIMITY') {
      headerTitle = event.triggerType === 'HOD_PROXIMITY' ? 'HOD PROXIMITY' : 'LOD PROXIMITY';
      emojiHeader = '🔔';
    } else if (event.triggerType === 'NEWS_DRIVEN') {
      headerTitle = 'BREAKING NEWS';
      emojiHeader = '📰';
    } else if (event.triggerType === 'VERDICT_FIRE') {
      headerTitle = 'VERDICT TRIGGERED';
      emojiHeader = '🤖';
    } else {
      headerTitle = 'MOMENTUM ALERT';
      emojiHeader = '🚀';
    }

    let message = `${emojiHeader} <b>${headerTitle} | ${event.symbol}</b>\n`;
    message += `━━━━━━━━━━━━━━━━━━━\n`;
    message += `👉 <b>Symbol:</b> <code>${event.symbol}</code>\n`;
    message += `🎯 <b>Trigger:</b> <code>${triggerLabel}</code>\n`;
    message += `💰 <b>LTP:</b> <code>₹${formattedPrice}</code>\n`;

    if (event.movePct !== 0) {
      message += `📈 <b>Change:</b> <code>${sign}${event.movePct.toFixed(2)}%</code>\n`;
    }
    if (event.velocity && event.velocity !== 'N/A') {
      message += `⚡ <b>Speed:</b> <code>${event.velocity}</code>\n`;
    }
    if (event.volumeMultiplier > 0) {
      message += `📊 <b>Volume:</b> <code>${event.volumeMultiplier}x Spike</code>\n`;
    }
    if (news) {
      message += `ℹ️ <b>Detail:</b> <code>${news}</code>\n`;
    }
    message += `━━━━━━━━━━━━━━━━━━━\n`;

    // Add FOMO Guard warning for price spikes/breakouts
    const isFOMOApplicable = event.triggerType !== 'NEWS_DRIVEN' && event.triggerType !== 'HOD_PROXIMITY' && event.triggerType !== 'LOD_PROXIMITY';
    if (isFOMOApplicable) {
      const cooldownMins = useSettingsStore.getState().omniAlertCooldownMinutes || 10;
      message += `⚠️ <b>FOMO GUARD ACTIVE</b>\n`;
      message += `• Wait for pullbacks to VWAP/EMA\n`;
      message += `• Do not chase entry above ₹${formattedPrice}\n`;
      message += `• ${cooldownMins}-min cooldown active\n`;
      message += `━━━━━━━━━━━━━━━━━━━\n`;
    }

    const timeString = new Date(event.timestamp).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    message += `🕐 <i>${timeString} IST</i>`;
    return message;
  }

  buildJarvisAnnouncement(event: MomentumSpikeEvent, news?: string): string {
    const directionWord = event.direction === 'UP' ? 'up' : 'down';
    const cleanSym = event.symbol.split(':').pop() || event.symbol;
    const formattedPrice = event.currentPrice.toFixed(1);

    if (event.triggerType === 'ORB_BREAKOUT') {
      return `Opening range breakout for ${cleanSym} to the ${directionWord} side at ${formattedPrice} rupees.`;
    }
    if (event.triggerType === 'HOD_BREAKOUT') {
      return `New high of day for ${cleanSym} at ${formattedPrice} rupees.`;
    }
    if (event.triggerType === 'LOD_BREAKOUT') {
      return `New low of day for ${cleanSym} at ${formattedPrice} rupees.`;
    }
    if (event.triggerType === 'HOD_PROXIMITY') {
      return `Attention. ${cleanSym} is approaching high of day at ${formattedPrice} rupees.`;
    }
    if (event.triggerType === 'LOD_PROXIMITY') {
      return `Attention. ${cleanSym} is approaching low of day at ${formattedPrice} rupees.`;
    }

    if (event.triggerType === 'NEWS_DRIVEN' && event.movePct === 0) {
      return `Breaking news for ${cleanSym}: ${news || 'Headlines matched'}. Cooldown alert active.`;
    }

    let announcement = `Alert. ${cleanSym} is ${directionWord} ${Math.abs(event.movePct).toFixed(1)} percent in ${event.windowMinutes} minutes at ${formattedPrice} rupees. `;
    
    if (event.volumeMultiplier >= 3.0) {
      announcement += `Volume surge detected. `;
    }

    if (news) {
      announcement += `News: ${news}. `;
    }

    announcement += `FOMO guard active. Do not chase.`;
    return announcement;
  }
}

export const omniAlertDispatcher = new OmniAlertDispatcher();
export default omniAlertDispatcher;
