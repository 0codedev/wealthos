import { db, ParsedSignal } from '../database';
import { logger } from './Logger';
import { fetchIndianStockQuote, fetchLiveOptionPremium } from './RealDataService';
import { notificationService } from './NotificationService';
import { signalIntelligenceService } from './SignalIntelligenceService';

class PriceAlertService {
  private static instance: PriceAlertService;
  private timer: NodeJS.Timeout | null = null;
  private isChecking = false;

  private constructor() {}

  static getInstance(): PriceAlertService {
    if (!PriceAlertService.instance) {
      PriceAlertService.instance = new PriceAlertService();
    }
    return PriceAlertService.instance;
  }

  /**
   * Helper to retrieve current price for stocks, indices, or option premiums
   */
  async getCurrentPrice(instrument: string): Promise<number> {
    const clean = instrument.toUpperCase().trim();
    
    // Check if it's an option (e.g. NIFTY 23500 CE)
    const optionMatch = clean.match(/^([A-Z\s\d]+?)\s+(\d+)\s+(CE|PE)$/i);
    if (optionMatch) {
      const fullSymbol = optionMatch[1].trim();
      // Extract core base symbol (e.g. "BANKNIFTY" from "BANKNIFTY 7 JUN")
      const indexSymbol = fullSymbol.split(/\s+/)[0];
      const strike = parseInt(optionMatch[2], 10);
      const type = optionMatch[3].toUpperCase() as 'CE' | 'PE';
      
      let spotPrice = 0;
      try {
        const spotQuote = await fetchIndianStockQuote(indexSymbol);
        spotPrice = spotQuote.price;
      } catch (e) {
        logger.debug(`Could not resolve spot price for option index: ${indexSymbol}`, e);
      }

      const premium = await fetchLiveOptionPremium(indexSymbol, strike, type, spotPrice);
      if (premium !== null && premium > 0) {
        return premium;
      }
    }

    // Default to stock/index quote
    const quote = await fetchIndianStockQuote(clean);
    return quote.price;
  }

  /**
   * Scans active signals, updates status if SL/Tgt breached, and triggers notifications
   */
  async checkAlerts(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;
    
    try {
      const activeSignals = await db.parsed_signals
        .where('status')
        .equals('ACTIVE')
        .toArray();

      if (activeSignals.length === 0) {
        this.isChecking = false;
        return;
      }

      logger.info(`[PriceAlertService] Scanning ${activeSignals.length} active signals for targets/stops`);

      for (const signal of activeSignals) {
        try {
          // Expiry check
          if (signal.expiryDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const exp = new Date(signal.expiryDate);
            exp.setHours(0, 0, 0, 0);
            const diffTime = exp.getTime() - today.getTime();
            const dte = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (dte <= 0) {
              if (signal.id) {
                await db.parsed_signals.update(signal.id, {
                  status: 'EXPIRED',
                  notes: `${signal.notes || ''}\nSignal auto-expired on expiry date.`.trim()
                });
                await notificationService.send({
                  title: `Signal Expired ⏳`,
                  body: `${signal.instrument} reached expiry date (${signal.expiryDate}) and has been archived as EXPIRED.`,
                  tag: `signal-expiry-${signal.id}`
                });
                await signalIntelligenceService.updateProviderStats(signal.provider);
                logger.info(`[PriceAlertService] Signal ${signal.id} (${signal.instrument}) marked EXPIRED`);
                continue;
              }
            } else if (dte <= 2) {
              const warningSentKey = `signal-dte-warning-sent-${signal.id}`;
              const alreadySent = localStorage.getItem(warningSentKey);
              if (!alreadySent) {
                await notificationService.send({
                  title: `Upcoming Option Expiry ⏳`,
                  body: `${signal.instrument} is expiring in ${dte} days (${signal.expiryDate}). Close positions if necessary.`,
                  tag: `signal-expiry-warn-${signal.id}`
                });
                localStorage.setItem(warningSentKey, 'true');
              }
            }
          }

          const currentPrice = await this.getCurrentPrice(signal.instrument);
          if (currentPrice === 0) continue;

          let statusChanged = false;
          let newStatus: ParsedSignal['status'] = 'ACTIVE';
          let outcomePnL = 0;
          let notifyTitle = '';
          let notifyBody = '';

          const isLong = signal.action === 'BUY' || signal.action === 'COVER';

          if (isLong) {
            // STOP LOSS hit
            if (signal.stopLoss && currentPrice <= signal.stopLoss) {
              newStatus = 'SL_HIT';
              outcomePnL = currentPrice - signal.entryPrice;
              statusChanged = true;
              notifyTitle = `Stop Loss Hit! 🚨`;
              notifyBody = `${signal.instrument} hit stop loss at ₹${currentPrice} (Entry: ₹${signal.entryPrice}, SL: ₹${signal.stopLoss})`;
            }
            // TARGET HIT
            else if (signal.target1 && currentPrice >= signal.target1) {
              newStatus = 'TARGET_HIT';
              outcomePnL = currentPrice - signal.entryPrice;
              statusChanged = true;
              notifyTitle = `Target 1 Achieved! 🎯`;
              notifyBody = `${signal.instrument} hit Target 1 at ₹${currentPrice} (Entry: ₹${signal.entryPrice}, Target: ₹${signal.target1})`;
            }
          } else { // Short trade
            // STOP LOSS hit
            if (signal.stopLoss && currentPrice >= signal.stopLoss) {
              newStatus = 'SL_HIT';
              outcomePnL = signal.entryPrice - currentPrice;
              statusChanged = true;
              notifyTitle = `Stop Loss Hit! 🚨`;
              notifyBody = `${signal.instrument} short position hit stop loss at ₹${currentPrice} (Entry: ₹${signal.entryPrice}, SL: ₹${signal.stopLoss})`;
            }
            // TARGET HIT
            else if (signal.target1 && currentPrice <= signal.target1) {
              newStatus = 'TARGET_HIT';
              outcomePnL = signal.entryPrice - currentPrice;
              statusChanged = true;
              notifyTitle = `Target 1 Achieved! 🎯`;
              notifyBody = `${signal.instrument} short position hit Target 1 at ₹${currentPrice} (Entry: ₹${signal.entryPrice}, Target: ₹${signal.target1})`;
            }
          }

          if (statusChanged && signal.id) {
            await db.parsed_signals.update(signal.id, {
              status: newStatus,
              outcomePnL,
              notes: `${signal.notes || ''}\nSystem checked price alert at ₹${currentPrice}.`.trim()
            });

            // Trigger desktop notification
            await notificationService.send({
              title: notifyTitle,
              body: notifyBody,
              tag: `signal-alert-${signal.id}`
            });

            // Update provider performance metrics
            await signalIntelligenceService.updateProviderStats(signal.provider);
            logger.info(`[PriceAlertService] Signal ${signal.id} (${signal.instrument}) updated to ${newStatus}`);
          }
        } catch (err) {
          logger.error(`[PriceAlertService] Error scanning signal ${signal.id}`, err);
        }
      }
    } catch (err) {
      logger.error('[PriceAlertService] Error running checkAlerts', err);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Start polling active signals
   */
  startPolling(intervalMs: number = 60000): void {
    if (this.timer) return;
    logger.info(`[PriceAlertService] Starting active signal polling every ${intervalMs / 1000}s`);
    
    // Run initial scan
    this.checkAlerts();
    
    this.timer = setInterval(() => {
      this.checkAlerts();
    }, intervalMs);
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[PriceAlertService] Polling stopped.');
    }
  }
}

export const priceAlertService = PriceAlertService.getInstance();
