import { logger } from '../Logger';

export interface SmartAlert {
  id: string;
  timestamp: string;
  type: 'VIX' | 'PCR' | 'FII' | 'PAIN' | 'CONVICTION';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  read: boolean;
}

export interface AlertConfig {
  enableVix: boolean;
  enablePcr: boolean;
  enableFii: boolean;
  enablePain: boolean;
  enableConviction: boolean;
  vixThreshold: number;
  pcrUpperThreshold: number;
  pcrLowerThreshold: number;
}

const DEFAULT_CONFIG: AlertConfig = {
  enableVix: true,
  enablePcr: true,
  enableFii: true,
  enablePain: true,
  enableConviction: true,
  vixThreshold: 20.0,
  pcrUpperThreshold: 1.4,
  pcrLowerThreshold: 0.7,
};

class SmartAlertEngine {
  private static instance: SmartAlertEngine;
  private config: AlertConfig = DEFAULT_CONFIG;
  private alerts: SmartAlert[] = [];

  private constructor() {
    this.loadConfig();
    this.loadAlerts();
  }

  static getInstance(): SmartAlertEngine {
    if (!SmartAlertEngine.instance) {
      SmartAlertEngine.instance = new SmartAlertEngine();
    }
    return SmartAlertEngine.instance;
  }

  private loadConfig() {
    try {
      const stored = localStorage.getItem('alpha_alert_config');
      if (stored) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
      }
    } catch (e) {
      logger.error('SmartAlertEngine: Failed to load config:', e);
    }
  }

  private loadAlerts() {
    try {
      const stored = localStorage.getItem('alpha_alert_history');
      if (stored) {
        this.alerts = JSON.parse(stored);
      }
    } catch (e) {
      logger.error('SmartAlertEngine: Failed to load alerts:', e);
    }
  }

  private saveAlerts() {
    try {
      // Ring buffer: keep last 100 alerts
      if (this.alerts.length > 100) {
        this.alerts = this.alerts.slice(0, 100);
      }
      localStorage.setItem('alpha_alert_history', JSON.stringify(this.alerts));
      // Dispatch custom event for UI updates
      window.dispatchEvent(new CustomEvent('alpha_alerts_updated', { detail: this.alerts }));
    } catch (e) {
      logger.error('SmartAlertEngine: Failed to save alerts:', e);
    }
  }

  getConfig(): AlertConfig {
    return this.config;
  }

  saveConfig(newConfig: AlertConfig) {
    this.config = newConfig;
    try {
      localStorage.setItem('alpha_alert_config', JSON.stringify(newConfig));
    } catch (e) {
      logger.error('SmartAlertEngine: Failed to save config:', e);
    }
  }

  getAlerts(): SmartAlert[] {
    return this.alerts;
  }

  clearAlerts() {
    this.alerts = [];
    this.saveAlerts();
  }

  markAllAsRead() {
    this.alerts = this.alerts.map(a => ({ ...a, read: true }));
    this.saveAlerts();
  }

  triggerAlert(type: SmartAlert['type'], title: string, message: string, severity: SmartAlert['severity']) {
    // Prevent duplicate alerts in a short time frame (e.g. 5 minutes)
    const now = Date.now();
    const isDuplicate = this.alerts.some(
      a => a.type === type && 
           a.message === message && 
           (now - new Date(a.timestamp).getTime()) < 5 * 60 * 1000
    );
    if (isDuplicate) return;

    const alert: SmartAlert = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type,
      title,
      message,
      severity,
      read: false,
    };

    this.alerts.unshift(alert);
    this.saveAlerts();

    // Trigger HTML5 Notification if permission granted
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`Wealth Dashboard Alert: ${title}`, { body: message });
    }

    // Trigger custom audio feedback if desired (premium feel)
    this.playAlertSound(severity);
  }

  private playAlertSound(severity: SmartAlert['severity']) {
    if (typeof window === 'undefined') return;
    try {
      // Basic synthesizer beep using Web Audio API (cross-platform compatible without audio files)
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (severity === 'critical') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.setValueAtTime(330, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      } else if (severity === 'warning') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
      }
    } catch (e) {
      // Silent catch (audio context disabled by user gesture policies)
    }
  }

  // --- ANALYSIS ENGINE ---
  
  checkVix(vix: number) {
    if (!this.config.enableVix) return;
    if (vix >= this.config.vixThreshold) {
      this.triggerAlert(
        'VIX',
        'High Volatility Regime Alert',
        `India VIX spiked to ${vix.toFixed(2)}. Hedging strategies advised (buy protective index put options).`,
        'critical'
      );
    }
  }

  checkPcr(pcr: number) {
    if (!this.config.enablePcr) return;
    if (pcr >= this.config.pcrUpperThreshold) {
      this.triggerAlert(
        'PCR',
        'Extreme Put-Call Ratio (Bullish Support)',
        `Put-Call Ratio reached ${pcr.toFixed(2)}. Extreme put writing suggests strong support floor. Contrarian buy setup.`,
        'warning'
      );
    } else if (pcr <= this.config.pcrLowerThreshold) {
      this.triggerAlert(
        'PCR',
        'Low Put-Call Ratio (Euphoria Alert)',
        `Put-Call Ratio dropped to ${pcr.toFixed(2)}. Heavy call buying/put covering indicates resistance near highs. Caution on fresh longs.`,
        'warning'
      );
    }
  }

  checkFiiStreak(history: any[]) {
    if (!this.config.enableFii || !history || history.length < 3) return;
    
    // Check last 3 entries for persistent selling
    const last3 = history.slice(0, 3);
    const allSell = last3.every(h => {
      const net = h.net_amount ?? h.net_value ?? 0;
      return net < 0;
    });

    if (allSell) {
      const netTotal = last3.reduce((sum, h) => sum + (h.net_amount ?? h.net_value ?? 0), 0);
      this.triggerAlert(
        'FII',
        'Institutional FII Sell Streak Active',
        `FIIs sold for 3 consecutive sessions, totaling ₹${Math.abs(netTotal).toFixed(0)} Cr net outflow. Negative cash market pressure.`,
        'warning'
      );
    }
  }

  checkMaxPainGravity(spot: number, maxPain: number) {
    if (!this.config.enablePain || spot <= 0 || maxPain <= 0) return;
    
    const gap = Math.abs(spot - maxPain) / spot;
    if (gap <= 0.005) {
      this.triggerAlert(
        'PAIN',
        'NIFTY Max Pain Pinning Zone Active',
        `NIFTY spot (₹${spot.toFixed(1)}) is within 0.5% of the Max Pain strike (₹${maxPain}). Pinning force active towards expiry.`,
        'info'
      );
    }
  }

  checkConvictionSurge(symbol: string, oldScore: number, newScore: number) {
    if (!this.config.enableConviction) return;
    
    if (oldScore < 70 && newScore >= 75) {
      this.triggerAlert(
        'CONVICTION',
        `High Conviction Spike: ${symbol}`,
        `${symbol} Trade Conviction surged from ${oldScore} to ${newScore} on live parameter updates. Bullish setup aligned.`,
        'critical'
      );
    }
  }
}

export const smartAlertEngine = SmartAlertEngine.getInstance();
