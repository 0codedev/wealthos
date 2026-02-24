/**
 * WealthOS Adaptive Battery & Market Session Poller
 * Intelligently scales data stream and polling rates based on:
 * 1. Indian Market Hours (09:15 to 15:30 IST Mon-Fri)
 * 2. Document Focus / Visibility state (tab active vs background)
 * 3. Device Battery Status (Battery Saver / Low Battery throttling)
 */

export interface PollingConfig {
    intervalMs: number;
    mode: 'HIGH_FREQUENCY_MARKET' | 'NORMAL' | 'BACKGROUND' | 'BATTERY_SAVER';
    isMarketOpen: boolean;
    isTabVisible: boolean;
    isBatteryLow: boolean;
}

class AdaptivePollerService {
    private config: PollingConfig = {
        intervalMs: 5000,
        mode: 'NORMAL',
        isMarketOpen: false,
        isTabVisible: true,
        isBatteryLow: false
    };

    private listeners: Set<(cfg: PollingConfig) => void> = new Set();

    constructor() {
        if (typeof window !== 'undefined') {
            this.initListeners();
            this.recalculate();
        }
    }

    private initListeners() {
        document.addEventListener('visibilitychange', () => {
            this.config.isTabVisible = !document.hidden;
            this.recalculate();
        });

        // Check market hours every minute
        setInterval(() => this.recalculate(), 60000);

        // Check Battery API if available
        if ('getBattery' in navigator) {
            (navigator as any).getBattery?.().then((battery: any) => {
                const updateBattery = () => {
                    this.config.isBatteryLow = battery.level <= 0.20 && !battery.charging;
                    this.recalculate();
                };
                updateBattery();
                battery.addEventListener('levelchange', updateBattery);
                battery.addEventListener('chargingchange', updateBattery);
            }).catch(() => { /* Battery API unsupported */ });
        }
    }

    private checkMarketOpen(): boolean {
        const now = new Date();
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const istTime = new Date(utcTime + (3600000 * 5.5));
        const day = istTime.getDay();
        const hours = istTime.getHours();
        const minutes = istTime.getMinutes();
        const totalMinutes = hours * 60 + minutes;

        const isWeekday = day >= 1 && day <= 5;
        const isMarketHours = totalMinutes >= (9 * 60 + 15) && totalMinutes <= (15 * 60 + 30);
        return isWeekday && isMarketHours;
    }

    public recalculate() {
        const isMarketOpen = this.checkMarketOpen();
        const isTabVisible = typeof document !== 'undefined' ? !document.hidden : true;
        const isBatteryLow = this.config.isBatteryLow;

        let mode: PollingConfig['mode'] = 'NORMAL';
        let intervalMs = 5000;

        if (isBatteryLow) {
            mode = 'BATTERY_SAVER';
            intervalMs = 30000;
        } else if (!isTabVisible) {
            mode = 'BACKGROUND';
            intervalMs = 45000;
        } else if (isMarketOpen) {
            mode = 'HIGH_FREQUENCY_MARKET';
            intervalMs = 1500; // Sub-2s live market stream
        } else {
            mode = 'NORMAL';
            intervalMs = 8000;
        }

        this.config = {
            intervalMs,
            mode,
            isMarketOpen,
            isTabVisible,
            isBatteryLow
        };

        this.listeners.forEach(fn => fn({ ...this.config }));
    }

    public getConfig(): PollingConfig {
        return { ...this.config };
    }

    public isMarketOpen(): boolean {
        return this.config.isMarketOpen;
    }

    public subscribe(fn: (cfg: PollingConfig) => void): () => void {
        this.listeners.add(fn);
        fn({ ...this.config });
        return () => this.listeners.delete(fn);
    }
}

export const adaptivePollerService = new AdaptivePollerService();
