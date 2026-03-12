// services/ml/NightlyRetrainScheduler.ts
// Fires once per night at 21:30 IST. Survives backgrounding. Idempotent.

const TARGET_HOUR = 21;
const TARGET_MIN = 30;
const COOLDOWN_MS = 23 * 60 * 60 * 1000;

class NightlyRetrainScheduler {
  private lastRun = 0;
  private intervalId: number | null = null;
  private paused = false;
  private onTick: () => Promise<void> | void = () => {};

  configure(handler: () => Promise<void> | void): void {
    this.onTick = handler;
  }

  start(): void {
    if (this.intervalId != null) return;
    this.intervalId = window.setInterval(() => this.maybeRun(), 60_000);
  }

  stop(): void {
    if (this.intervalId != null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setPaused(p: boolean): void { this.paused = p; }
  isPaused(): boolean { return this.paused; }

  async forceRun(): Promise<void> {
    if (this.paused) return;
    this.lastRun = Date.now();
    try {
      await this.onTick();
    } catch (err) {
      console.warn('[NightlyRetrainScheduler] tick failed', err);
    }
  }

  private maybeRun(): void {
    if (this.paused) return;
    const now = new Date();
    if (now.getHours() !== TARGET_HOUR) return;
    if (now.getMinutes() !== TARGET_MIN) return;
    if (Date.now() - this.lastRun < COOLDOWN_MS) return;
    void this.forceRun();
  }
}

export const nightlyRetrainScheduler = new NightlyRetrainScheduler();
