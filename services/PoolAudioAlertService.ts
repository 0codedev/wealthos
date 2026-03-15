/**
 * PoolAudioAlertService
 * 
 * Lightweight Web Audio API synthesizer for Momentum Pool alerts.
 * Requires zero external audio files. Generates pleasant, non-jarring tones.
 */

class PoolAudioAlertService {
  private audioCtx: AudioContext | null = null;
  private soundEnabled: boolean = true;
  private lastAlertTime: Record<string, number> = {};

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('wealthos_pool_sound_enabled');
      this.soundEnabled = saved !== 'false';
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  public isEnabled(): boolean {
    return this.soundEnabled;
  }

  public setEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('wealthos_pool_sound_enabled', enabled ? 'true' : 'false');
    }
  }

  /**
   * Play a soft 2-tone amber proximity chime when price approaches within 0.5% of trigger
   */
  public playProximityWarning(symbol?: string): void {
    if (!this.soundEnabled) return;
    
    // Throttle per symbol to at most once per 60 seconds
    if (symbol) {
      const last = this.lastAlertTime[`prox_${symbol}`] || 0;
      if (Date.now() - last < 60000) return;
      this.lastAlertTime[`prox_${symbol}`] = Date.now();
    }

    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880.00, now + 0.12); // A5

      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      console.warn('[PoolAudioAlertService] Audio playback warning:', e);
    }
  }

  /**
   * Play an energetic 3-tone emerald fanfare when trigger price is breached
   */
  public playTriggerBreached(symbol?: string): void {
    if (!this.soundEnabled) return;

    // Throttle per symbol to at most once per 5 minutes
    if (symbol) {
      const last = this.lastAlertTime[`trig_${symbol}`] || 0;
      if (Date.now() - last < 300000) return;
      this.lastAlertTime[`trig_${symbol}`] = Date.now();
    }

    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      
      const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.06, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.25);
      });
    } catch (e) {
      console.warn('[PoolAudioAlertService] Audio playback warning:', e);
    }
  }
}

export const poolAudioAlertService = new PoolAudioAlertService();
