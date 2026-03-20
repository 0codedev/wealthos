import { useSettingsStore } from '../store/settingsStore';
import { logger } from './Logger';
import { isSideEffectAllowed } from '../lib/demoMode';
import { gateNetworkAction, isNetworkActionAllowed } from '../lib/offline';

export interface MomentumSpikeEvent {
  symbol: string;
  instrumentKey: string;
  currentPrice: number;
  movePct: number;
  windowMinutes: number;
  volumeMultiplier: number;
  direction: 'UP' | 'DOWN';
  triggerType: 'PRICE_SPIKE' | 'VOLUME_SURGE' | 'NEWS_DRIVEN' | 'VERDICT_FIRE' | 'ORB_BREAKOUT' | 'HOD_BREAKOUT' | 'LOD_BREAKOUT' | 'HOD_PROXIMITY' | 'LOD_PROXIMITY' | 'INDEX_VELOCITY_SPIKE';
  timestamp: number;
  fomoMinutesElapsed?: number;
  velocity?: string;
}

class TelegramAlertService {
  private getConfig() {
    const { telegramBotToken, telegramChatId } = useSettingsStore.getState();
    return { token: telegramBotToken, chatId: telegramChatId };
  }

  isConfigured(): boolean {
    const { token, chatId } = this.getConfig();
    return !!token && !!chatId;
  }

  async send(htmlMessage: string, customToken?: string, customChatId?: string): Promise<boolean> {
    // --- Offline gate (Top-10 #4) ---
    if (!isNetworkActionAllowed('telegram-alert')) {
      return false;
    }

    const { token: defaultToken, chatId: defaultChatId } = this.getConfig();
    const token = customToken || defaultToken;
    const chatId = customChatId || defaultChatId;

    if (!token || !chatId) {
      logger.warn('TelegramAlertService: Bot token or chat ID is missing.');
      return false;
    }

    // --- Demo-mode side-effect gate (Top-10 #1) ---
    // Only block if we are using the default/legacy dummy token/chatId configuration.
    // If a custom token is explicitly passed or configured, bypass the demo gate to ensure real delivery.
    const isCustomBot = customToken !== undefined || (token && !token.includes('YOUR_BOT_TOKEN') && token.trim() !== '');
    if (!isCustomBot && !isSideEffectAllowed('telegram-alert')) {
      logger.warn('TelegramAlertService: blocked — demo mode active and using dummy bot tokens');
      return false;
    }

    let targetChatId = chatId;
    const lowerMsg = htmlMessage.toLowerCase();

    if (lowerMsg.includes('brief') || lowerMsg.includes('news') || lowerMsg.includes('pre-market')) {
      if (targetChatId.includes('#')) {
        targetChatId = targetChatId.split('#')[0] + '#26';
      } else {
        targetChatId = targetChatId + '#26';
      }
    } else if (lowerMsg.includes('digest') || lowerMsg.includes('pnl') || lowerMsg.includes('profitability')) {
      if (targetChatId.includes('#')) {
        targetChatId = targetChatId.split('#')[0] + '#22';
      } else {
        targetChatId = targetChatId + '#22';
      }
    } else if (lowerMsg.includes('system health') || lowerMsg.includes('diagnostics') || lowerMsg.includes('connection lost') || lowerMsg.includes('vitals') || lowerMsg.includes('reconciliation')) {
      if (targetChatId.includes('#')) {
        targetChatId = targetChatId.split('#')[0] + '#24';
      } else {
        targetChatId = targetChatId + '#24';
      }
    }

    try {
      const response = await fetch('/api/python-nse/api/alerts/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_token: token,
          chat_id: targetChatId,
          message: htmlMessage
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.status === 'success' || data.ok === true;
      }
      return false;
    } catch (err) {
      logger.error('TelegramAlertService: Failed to send message', err);
      return false;
    }
  }

  async sendToRole(role: 'alerts' | 'autopilot' | 'n8n', htmlMessage: string): Promise<boolean> {
    const { telegramBots, telegramEnabled } = useSettingsStore.getState();
    if (!telegramEnabled) {
      logger.warn(`TelegramAlertService: Cannot send alert to role "${role}". Telegram integration is disabled in settings.`);
      return false;
    }

    const targetBots = (telegramBots || []).filter(bot => bot.enabled && bot.role === role);
    if (targetBots.length === 0) {
      // For backwards compatibility: fallback to root credentials if role is 'alerts'
      if (role === 'alerts') {
        const { token, chatId } = this.getConfig();
        if (token && chatId) {
          logger.info('TelegramAlertService: No active bots found in list for "alerts" role. Falling back to root configuration.');
          return this.send(htmlMessage, token, chatId);
        }
      }
      logger.warn(`TelegramAlertService: No enabled Telegram bots configured for role "${role}".`);
      return false;
    }

    logger.info(`TelegramAlertService: Dispatching alert to ${targetBots.length} bots for role "${role}".`);
    const results = await Promise.all(
      targetBots.map(bot => this.send(htmlMessage, bot.token, bot.chatId))
    );
    return results.some(r => r);
  }

  async test(): Promise<{ success: boolean; error?: string }> {
    const { token, chatId } = this.getConfig();
    if (!token || !chatId) {
      return { success: false, error: 'Token or Chat ID not configured' };
    }

    try {
      const response = await fetch('/api/python-nse/api/alerts/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_token: token,
          chat_id: chatId
        })
      });

      if (!response.ok) {
        return { 
          success: false, 
          error: `Python bridge is offline or returned an error (${response.status}). Please run the launch_bridge script.` 
        };
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return { 
          success: false, 
          error: 'Python bridge returned an invalid response. Ensure the Python server is running.' 
        };
      }

      if (data.status === 'success' || data.ok === true) {
        return { success: true };
      }
      return { success: false, error: data.error || 'Failed to send test message' };
    } catch (err) {
      logger.error('TelegramAlertService: Test connection failed', err);
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async verifyToken(token: string): Promise<{ valid: boolean; botName?: string }> {
    if (!token) return { valid: false };

    try {
      const response = await fetch(`/api/python-nse/api/alerts/telegram/verify?token=${encodeURIComponent(token)}`);
      if (!response.ok) return { valid: false };

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return { valid: false };
      }

      if (data.status === 'success' && data.bot_name) {
        return { valid: true, botName: data.bot_name };
      }
      return { valid: false };
    } catch (err) {
      logger.error('TelegramAlertService: Token verification failed', err);
      return { valid: false };
    }
  }

  async sendPoolAlert(ticker: string, kind: 'TARGET_HIT' | 'STOP_HIT' | 'VERDICT_FIRE', price: number, levels: { targetSell?: number; targetBuy?: number; stopLoss?: number }): Promise<boolean> {
    const { telegramBots, telegramEnabled } = useSettingsStore.getState();
    if (!telegramEnabled) {
      logger.warn(`TelegramAlertService: Cannot send pool alert. Telegram integration is disabled in settings.`);
      return false;
    }

    const { poolAlertMessage } = await import('../utils/telegramAlertTemplates');
    const htmlMessage = poolAlertMessage(ticker, kind, price, levels);

    const targetBots = (telegramBots || []).filter(bot => bot.enabled && bot.role === 'alerts');
    if (targetBots.length === 0) {
      // Backwards compatibility fallback
      const { token, chatId } = this.getConfig();
      if (token && chatId) {
        let baseChatId = chatId.split('#')[0];
        const targetChatId = `${baseChatId}#10`;
        return this.send(htmlMessage, token, targetChatId);
      }
      logger.warn(`TelegramAlertService: No enabled Telegram bots configured for role "alerts" during pool alert.`);
      return false;
    }

    const results = await Promise.all(
      targetBots.map(bot => {
        let baseChatId = bot.chatId.split('#')[0];
        const targetChatId = `${baseChatId}#10`;
        return this.send(htmlMessage, bot.token, targetChatId);
      })
    );
    return results.some(r => r);
  }
}

export const telegramAlertService = new TelegramAlertService();
