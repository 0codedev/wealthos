import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AutopilotRules {
  nifty_macro_enabled: boolean;
  nifty_long_threshold: number;
  nifty_short_threshold: number;
  neutral_divergence_override: number;
  dual_polarity_enabled: boolean;
  force_long_only: boolean;
  time_gate_enabled: boolean;
  min_composite_score: number;
  hard_sl_pct: number;
  trail_trigger_pct: number;
  max_daily_loss_inr: number;
  max_trades_per_day: number;
  lot_multiplier: number;
  moneyness: 'ATM' | 'ITM_1' | 'OTM_1';
  target_model: 'DYNAMIC_TRAILING' | 'HARD_TARGET';
  target_multiplier: number;
  dynamic_trail_lock_pct: number;
  dynamic_trail_step_pct: number;
  afternoon_cutoff_time: string;
  expiry_cutoff_enabled: boolean;
  scale_out_enabled?: boolean;
  scale_out_trigger_pct?: number;
  scale_out_ratio?: number;
}

export const DEFAULT_AUTOPILOT_RULES: AutopilotRules = {
  nifty_macro_enabled: true,
  nifty_long_threshold: 0.35,
  nifty_short_threshold: -0.35,
  neutral_divergence_override: 2.0,
  dual_polarity_enabled: true,
  force_long_only: false,
  time_gate_enabled: true,
  min_composite_score: 70.0,
  hard_sl_pct: 35.0,
  trail_trigger_pct: 40.0,
  scale_out_enabled: true,
  scale_out_trigger_pct: 40.0,
  scale_out_ratio: 0.50,
  max_daily_loss_inr: 2500.0,
  max_trades_per_day: 1,
  lot_multiplier: 1,
  moneyness: 'ATM',
  target_model: 'DYNAMIC_TRAILING',
  target_multiplier: 2.0,
  dynamic_trail_lock_pct: 75.0,
  dynamic_trail_step_pct: 20.0,
  afternoon_cutoff_time: '14:00',
  expiry_cutoff_enabled: true,
};

export const CONSERVATIVE_15K_PRESET: Partial<AutopilotRules> = {
  max_daily_loss_inr: 2500.0,
  lot_multiplier: 1,
  moneyness: 'ATM',
  hard_sl_pct: 35.0,
  trail_trigger_pct: 40.0,
  target_model: 'DYNAMIC_TRAILING',
  target_multiplier: 2.0,
  dynamic_trail_lock_pct: 75.0,
  dynamic_trail_step_pct: 20.0,
  max_trades_per_day: 1,
  min_composite_score: 75.0,
  afternoon_cutoff_time: '14:00',
  expiry_cutoff_enabled: true,
};

interface AutopilotRuleState {
  rules: AutopilotRules;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastSyncedAt: number | null;
  fetchRules: () => Promise<void>;
  updateRule: <K extends keyof AutopilotRules>(key: K, value: AutopilotRules[K]) => void;
  applyPreset: (preset: Partial<AutopilotRules>) => void;
  saveRulesToServer: (customRules?: Partial<AutopilotRules>) => Promise<boolean>;
  resetToDefaults: () => Promise<boolean>;
}

export const useAutopilotRuleStore = create<AutopilotRuleState>()(
  persist(
    (set, get) => ({
      rules: { ...DEFAULT_AUTOPILOT_RULES },
      loading: false,
      saving: false,
      error: null,
      lastSyncedAt: null,

      fetchRules: async () => {
        set({ loading: true, error: null });
        try {
          const res = await fetch('/api/python-nse/api/autopilot/rules');
          if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
              set({
                rules: { ...get().rules, ...data },
                lastSyncedAt: Date.now(),
                loading: false,
              });
              return;
            }
          }
          set({ loading: false });
        } catch (err: unknown) {
          // Graceful fallback to local cache
          set({
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to fetch rules',
          });
        }
      },

      updateRule: (key, value) => {
        set((state) => ({
          rules: {
            ...state.rules,
            [key]: value,
          },
        }));
      },

      applyPreset: (preset) => {
        set((state) => ({
          rules: {
            ...state.rules,
            ...preset,
          },
        }));
      },

      saveRulesToServer: async (customRules) => {
        set({ saving: true, error: null });
        try {
          const payload = customRules ? { ...get().rules, ...customRules } : get().rules;
          const res = await fetch('/api/python-nse/api/autopilot/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            const data = await res.json();
            set({
              rules: data.rules ? { ...get().rules, ...data.rules } : payload,
              saving: false,
              lastSyncedAt: Date.now(),
            });
            return true;
          } else {
            const errData = await res.json().catch(() => ({}));
            set({
              saving: false,
              error: errData.detail || 'Failed to save rules to server',
            });
            return false;
          }
        } catch (err: unknown) {
          set({
            saving: false,
            error: err instanceof Error ? err.message : 'Network error saving rules',
          });
          return false;
        }
      },

      resetToDefaults: async () => {
        set({ rules: { ...DEFAULT_AUTOPILOT_RULES } });
        return get().saveRulesToServer(DEFAULT_AUTOPILOT_RULES);
      },
    }),
    {
      name: 'wealthos-autopilot-rules-v1',
    }
  )
);
