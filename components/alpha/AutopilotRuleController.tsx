import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Shield,
  Clock,
  Compass,
  Percent,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Zap,
  Target,
  Layers,
  TrendingUp,
  Sparkles,
  Scale,
} from 'lucide-react';
import {
  useAutopilotRuleStore,
  CONSERVATIVE_15K_PRESET,
  DEFAULT_AUTOPILOT_RULES,
} from '../../store/autopilotRuleStore';
import { useToast } from '../shared/ToastProvider';

interface AutopilotRuleControllerProps {
  onClose?: () => void;
}

export const AutopilotRuleController: React.FC<AutopilotRuleControllerProps> = () => {
  const {
    rules,
    loading,
    saving,
    error,
    lastSyncedAt,
    fetchRules,
    updateRule,
    applyPreset,
    saveRulesToServer,
    resetToDefaults,
  } = useAutopilotRuleStore();
  const { toast } = useToast();
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleSave = async () => {
    const success = await saveRulesToServer();
    if (success) {
      setDirty(false);
      toast.success('Autopilot rules updated & persisted to backend daemon.', {
        title: 'Rules Saved ⚡',
      });
    } else {
      toast.error(error || 'Failed to save rules', { title: 'Save Failed' });
    }
  };

  const handleReset = async () => {
    const success = await resetToDefaults();
    if (success) {
      setDirty(false);
      toast.info('Autopilot rules reset to institutional defaults.', {
        title: 'Defaults Restored',
      });
    }
  };

  const handleApplyConservativePreset = () => {
    applyPreset(CONSERVATIVE_15K_PRESET);
    setDirty(true);
    toast.info('Applied ₹15K–₹25K Conservative Account Defaults (1 Lot, ATM, ₹2.5K Risk, Dynamic 2x Runner).', {
      title: '15K Preset Loaded 🛡️',
    });
  };

  const handleApplyInstitutionalPreset = () => {
    applyPreset({
      ...DEFAULT_AUTOPILOT_RULES,
      max_daily_loss_inr: 10000,
      lot_multiplier: 2,
      target_model: 'HARD_TARGET',
      max_trades_per_day: 2,
    });
    setDirty(true);
    toast.info('Applied Institutional Multi-Lot Defaults (2 Lots, ₹10K Breaker, 2x Hard Exit).', {
      title: 'Institutional Preset 🏢',
    });
  };

  const onToggle = (key: keyof typeof rules, currentVal: boolean) => {
    updateRule(key, !currentVal);
    setDirty(true);
  };

  const onNumberChange = (key: keyof typeof rules, val: number) => {
    updateRule(key, val);
    setDirty(true);
  };

  const onSelectChange = <K extends keyof typeof rules>(key: K, val: (typeof rules)[K]) => {
    updateRule(key, val);
    setDirty(true);
  };

  return (
    <div className="bg-wa-card border border-wa-border rounded-xl p-3 sm:p-5 mb-4 shadow-xl transition-all">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-wa-border">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-wa-accent-subtle text-wa-accent">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-bold text-wa-text-primary tracking-wide">
                Trader Execution Rules & Risk Gates
              </h3>
              {dirty && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-wa-warning-subtle text-wa-warning border border-wa-warning">
                  Unsaved Changes
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-wa-text-muted mt-0.5">
              Live algorithmic execution gates for Python daemon & sandbox router.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleReset}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-wa-text-muted hover:text-wa-text-primary hover:bg-wa-surface border border-wa-border transition disabled:opacity-50"
            title="Reset to Institutional Defaults"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Reset</span>
          </button>

          <button
            onClick={handleSave}
            disabled={saving || loading || !dirty}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition shadow-sm ${
              dirty
                ? 'bg-wa-accent text-wa-text-primary hover:opacity-90 shadow-wa-accent-subtle'
                : 'bg-wa-surface text-wa-text-muted border border-wa-border opacity-60 cursor-not-allowed'
            }`}
          >
            <Save className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
            <span>{saving ? 'Saving...' : 'Save Rules'}</span>
          </button>
        </div>
      </div>

      {/* Quick Sizing Presets Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 py-3 border-b border-wa-border/60 bg-wa-surface/40 -mx-3 sm:-mx-5 px-3 sm:px-5">
        <div className="flex items-center gap-1.5 text-xs text-wa-text-muted">
          <Sparkles className="w-3.5 h-3.5 text-wa-accent" />
          <span className="font-semibold text-wa-text-secondary">Account Sizing Presets:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleApplyConservativePreset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-wa-bullish-subtle text-wa-bullish border border-wa-bullish hover:opacity-90 transition shadow-sm"
            title="Optimize all rules for ₹15K–₹25K account with 1 lot ATM & Dynamic 2x Trailing Runner"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>⚡ ₹15K–₹25K Conservative (1 Lot · ATM · ₹2.5K Risk)</span>
          </button>
          <button
            type="button"
            onClick={handleApplyInstitutionalPreset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-wa-text-secondary hover:text-wa-text-primary bg-wa-surface border border-wa-border transition"
            title="Institutional multi-lot rules for larger accounts"
          >
            <Scale className="w-3.5 h-3.5" />
            <span>🏢 Institutional Multi-Lot (2 Lots · 2x Hard Exit)</span>
          </button>
        </div>
      </div>

      {/* Sync Status Banner */}
      {error && (
        <div className="mt-3 p-2.5 rounded-lg bg-wa-bearish-subtle border border-wa-bearish text-wa-bearish text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {lastSyncedAt && !error && !dirty && (
        <div className="mt-2.5 flex items-center justify-between text-[11px] text-wa-text-muted">
          <span className="flex items-center gap-1 text-wa-bullish">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Daemon Rules Synchronized
          </span>
          <span>Last sync: {new Date(lastSyncedAt).toLocaleTimeString()}</span>
        </div>
      )}

      {/* Rules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 mt-4">
        {/* Gate 1: Macro Gate */}
        <div className="bg-wa-surface border border-wa-border rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-wa-text-primary">
                <Compass className="w-4 h-4 text-wa-accent" />
                <span>NIFTY Macro Gate</span>
              </div>
              <button
                type="button"
                onClick={() => onToggle('nifty_macro_enabled', rules.nifty_macro_enabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  rules.nifty_macro_enabled ? 'bg-wa-accent' : 'bg-wa-card'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-wa-text-primary shadow ring-0 transition duration-200 ease-in-out ${
                    rules.nifty_macro_enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-[11px] text-wa-text-muted mb-3">
              Filters out contra-trend stock setups when broad NIFTY 50 index moves sharply.
            </p>

            <div className="space-y-2.5 text-xs">
              <div>
                <div className="flex justify-between text-[11px] text-wa-text-secondary mb-1">
                  <span>Bullish Floor Threshold</span>
                  <span className="font-mono text-wa-bullish">+{rules.nifty_long_threshold}%</span>
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="1.00"
                  step="0.05"
                  value={rules.nifty_long_threshold}
                  onChange={(e) => onNumberChange('nifty_long_threshold', parseFloat(e.target.value))}
                  disabled={!rules.nifty_macro_enabled}
                  className="w-full accent-wa-accent h-1.5 bg-wa-card rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-wa-text-secondary mb-1">
                  <span>Bearish Floor Threshold</span>
                  <span className="font-mono text-wa-bearish">{rules.nifty_short_threshold}%</span>
                </div>
                <input
                  type="range"
                  min="-1.00"
                  max="-0.10"
                  step="0.05"
                  value={rules.nifty_short_threshold}
                  onChange={(e) => onNumberChange('nifty_short_threshold', parseFloat(e.target.value))}
                  disabled={!rules.nifty_macro_enabled}
                  className="w-full accent-wa-accent h-1.5 bg-wa-card rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Gate 2: Dual-Polarity Mode */}
        <div className="bg-wa-surface border border-wa-border rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-wa-text-primary">
                <Shield className="w-4 h-4 text-wa-bullish" />
                <span>Dual-Polarity Engine</span>
              </div>
              <button
                type="button"
                onClick={() => onToggle('dual_polarity_enabled', rules.dual_polarity_enabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  rules.dual_polarity_enabled ? 'bg-wa-bullish' : 'bg-wa-card'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-wa-text-primary shadow ring-0 transition duration-200 ease-in-out ${
                    rules.dual_polarity_enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-[11px] text-wa-text-muted mb-3">
              Automatically pivots between Call options (bull market) and Put options (bear market).
            </p>

            <div className="mt-2 p-2.5 rounded bg-wa-card border border-wa-border">
              <div className="flex items-center justify-between">
                <span className="text-xs text-wa-text-secondary">Force Long-Only Mode</span>
                <button
                  type="button"
                  onClick={() => onToggle('force_long_only', rules.force_long_only)}
                  className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out ${
                    rules.force_long_only ? 'bg-wa-warning' : 'bg-wa-surface'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-wa-text-primary shadow ring-0 transition duration-200 ease-in-out ${
                      rules.force_long_only ? 'translate-x-3' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[10px] text-wa-text-muted mt-1">
                Emergency flag. When enabled, only Call options are permitted.
              </p>
            </div>
          </div>
        </div>

        {/* Gate 3: Execution Time Gate */}
        <div className="bg-wa-surface border border-wa-border rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-wa-text-primary">
                <Clock className="w-4 h-4 text-wa-accent" />
                <span>10:15 AM Post-Shakeout Gate</span>
              </div>
              <button
                type="button"
                onClick={() => onToggle('time_gate_enabled', rules.time_gate_enabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  rules.time_gate_enabled ? 'bg-wa-accent' : 'bg-wa-card'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-wa-text-primary shadow ring-0 transition duration-200 ease-in-out ${
                    rules.time_gate_enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-[11px] text-wa-text-muted mb-2">
              Blocks entries before 10:15 AM IST to avoid opening auction noise and whipsaw stop-outs.
            </p>
            <div className="p-2 rounded bg-wa-card border border-wa-border text-[11px] text-wa-text-secondary">
              <span className="font-semibold text-wa-text-primary">Execution Window:</span> 10:15 AM - 11:30 AM IST
            </div>
          </div>
        </div>

        {/* Gate 4: Composite Score Threshold */}
        <div className="bg-wa-surface border border-wa-border rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-wa-text-primary">
                <HelpCircle className="w-4 h-4 text-wa-accent" />
                <span>Quant Composite Score</span>
              </div>
              <span className="font-mono text-xs font-bold text-wa-accent">
                {rules.min_composite_score.toFixed(0)} / 100
              </span>
            </div>
            <p className="text-[11px] text-wa-text-muted mb-3">
              Minimum multi-factor score required for algorithmic trade approval.
            </p>
            <input
              type="range"
              min="50"
              max="90"
              step="1"
              value={rules.min_composite_score}
              onChange={(e) => onNumberChange('min_composite_score', parseFloat(e.target.value))}
              className="w-full accent-wa-accent h-1.5 bg-wa-card rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-wa-text-muted mt-1">
              <span>Aggressive (50)</span>
              <span>Balanced (70)</span>
              <span>Ultra-Strict (90)</span>
            </div>
          </div>
        </div>

        {/* Gate 5: Option Stop Loss & Trailing */}
        <div className="bg-wa-surface border border-wa-border rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-wa-text-primary">
                <Percent className="w-4 h-4 text-wa-bearish" />
                <span>Option Risk & Stop Loss</span>
              </div>
              <span className="font-mono text-xs font-bold text-wa-bearish">
                -{rules.hard_sl_pct.toFixed(0)}%
              </span>
            </div>
            <p className="text-[11px] text-wa-text-muted mb-3">
              Premium percentage stop loss (replaces equity ATR to prevent noise stop-outs).
            </p>
            <input
              type="range"
              min="15"
              max="50"
              step="5"
              value={rules.hard_sl_pct}
              onChange={(e) => onNumberChange('hard_sl_pct', parseFloat(e.target.value))}
              className="w-full accent-wa-bearish h-1.5 bg-wa-card rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-wa-text-muted mt-1">
              <span>Tight (-15%)</span>
              <span>Institutional (-35%)</span>
              <span>Wide (-50%)</span>
            </div>
          </div>
        </div>

        {/* Gate 6: Daily Circuit Breaker */}
        <div className="bg-wa-surface border border-wa-border rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-wa-text-primary">
                <Shield className="w-4 h-4 text-wa-warning" />
                <span>Capital Preservation Limit</span>
              </div>
              <span className="font-mono text-xs font-bold text-wa-warning">
                ₹{rules.max_daily_loss_inr.toLocaleString()}
              </span>
            </div>
            <p className="text-[11px] text-wa-text-muted mb-3">
              Daily realized loss breaker. Halts all automated trading once breached.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1000"
                max="50000"
                step="500"
                value={rules.max_daily_loss_inr}
                onChange={(e) => onNumberChange('max_daily_loss_inr', parseFloat(e.target.value) || 2500)}
                className="w-full bg-wa-card border border-wa-border rounded px-2.5 py-1 text-xs text-wa-text-primary font-mono focus:outline-none focus:border-wa-accent"
              />
              <span className="text-xs text-wa-text-muted shrink-0">INR</span>
            </div>
            <div className="flex justify-between text-[10px] text-wa-text-muted mt-2">
              <span>₹15K Base: ₹2,500</span>
              <span>₹50K Base: ₹5,000</span>
            </div>
          </div>
        </div>

        {/* Gate 7: Target & Dynamic Runner Engine */}
        <div className="bg-wa-surface border border-wa-border rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-wa-text-primary">
                <Target className="w-4 h-4 text-wa-bullish" />
                <span>Target & Dynamic Runner</span>
              </div>
              <span className={`text-[10px] uppercase font-bold font-mono px-2 py-0.5 rounded ${
                rules.target_model === 'DYNAMIC_TRAILING'
                  ? 'bg-wa-bullish-subtle text-wa-bullish border border-wa-bullish'
                  : 'bg-wa-card text-wa-text-secondary border border-wa-border'
              }`}>
                {rules.target_model === 'DYNAMIC_TRAILING' ? 'Dynamic Runner 🚀' : 'Hard Exit'}
              </span>
            </div>
            <p className="text-[11px] text-wa-text-muted mb-2.5">
              At 2x (+100%), lock in +75% profit floor and trail for 3x–5x trend runs instead of premature exits.
            </p>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-wa-card border border-wa-border">
                <span className="text-[11px] text-wa-text-secondary">Execution Model</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelectChange('target_model', 'DYNAMIC_TRAILING')}
                    className={`px-2 py-1 rounded text-[11px] font-bold transition ${
                      rules.target_model === 'DYNAMIC_TRAILING'
                        ? 'bg-wa-bullish text-wa-text-primary'
                        : 'text-wa-text-muted hover:text-wa-text-primary'
                    }`}
                  >
                    Dynamic Trailing
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectChange('target_model', 'HARD_TARGET')}
                    className={`px-2 py-1 rounded text-[11px] font-bold transition ${
                      rules.target_model === 'HARD_TARGET'
                        ? 'bg-wa-accent text-wa-text-primary'
                        : 'text-wa-text-muted hover:text-wa-text-primary'
                    }`}
                  >
                    Hard 2x Exit
                  </button>
                </div>
              </div>

              {rules.target_model === 'DYNAMIC_TRAILING' && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="p-2 rounded bg-wa-card border border-wa-border">
                    <span className="block text-[10px] text-wa-text-muted">Profit Floor Lock</span>
                    <span className="text-xs font-mono font-bold text-wa-bullish">+{rules.dynamic_trail_lock_pct}%</span>
                  </div>
                  <div className="p-2 rounded bg-wa-card border border-wa-border">
                    <span className="block text-[10px] text-wa-text-muted">Trailing Cushion</span>
                    <span className="text-xs font-mono font-bold text-wa-accent">{rules.dynamic_trail_step_pct}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Gate 8: Position Sizing & Moneyness */}
        <div className="bg-wa-surface border border-wa-border rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-wa-text-primary">
                <Layers className="w-4 h-4 text-wa-accent" />
                <span>Sizing & Moneyness</span>
              </div>
              <span className="font-mono text-xs font-bold text-wa-bullish">
                {rules.lot_multiplier} Lot · {rules.moneyness}
              </span>
            </div>
            <p className="text-[11px] text-wa-text-muted mb-2.5">
              Strict position risk sizing & contract strike selection relative to live spot price.
            </p>

            <div className="space-y-2 text-xs">
              <div>
                <span className="block text-[11px] text-wa-text-secondary mb-1">Contract Strike (Moneyness)</span>
                <div className="grid grid-cols-3 gap-1 bg-wa-card p-1 rounded border border-wa-border text-center">
                  {(['ATM', 'ITM_1', 'OTM_1'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onSelectChange('moneyness', m)}
                      className={`py-1 rounded text-[11px] font-bold transition ${
                        rules.moneyness === m
                          ? 'bg-wa-accent text-wa-text-primary shadow-sm'
                          : 'text-wa-text-muted hover:text-wa-text-primary'
                      }`}
                    >
                      {m === 'ATM' ? 'ATM (Δ 0.50)' : m === 'ITM_1' ? 'ITM 1 (Δ 0.70)' : 'OTM 1 (Δ 0.30)'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex-1">
                  <span className="block text-[10px] text-wa-text-muted mb-1">Lot Multiplier</span>
                  <select
                    value={rules.lot_multiplier}
                    onChange={(e) => onNumberChange('lot_multiplier', parseInt(e.target.value) || 1)}
                    className="w-full bg-wa-card border border-wa-border rounded px-2 py-1 text-xs text-wa-text-primary font-mono focus:outline-none focus:border-wa-accent"
                  >
                    <option value="1">1 Lot (₹15K–₹25K Recommended)</option>
                    <option value="2">2 Lots (Runner Scaling)</option>
                    <option value="3">3 Lots</option>
                  </select>
                </div>
                <div className="flex-1">
                  <span className="block text-[10px] text-wa-text-muted mb-1">Max Trades/Day</span>
                  <select
                    value={rules.max_trades_per_day}
                    onChange={(e) => onNumberChange('max_trades_per_day', parseInt(e.target.value) || 1)}
                    className="w-full bg-wa-card border border-wa-border rounded px-2 py-1 text-xs text-wa-text-primary font-mono focus:outline-none focus:border-wa-accent"
                  >
                    <option value="1">1 Trade / Day (Strict Anti-Churn)</option>
                    <option value="2">2 Trades / Day</option>
                    <option value="3">3 Trades / Day</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Gate 9: Session Timing & Afternoon Cutoff */}
        <div className="bg-wa-surface border border-wa-border rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-wa-text-primary">
                <Clock className="w-4 h-4 text-wa-accent" />
                <span>Afternoon Cutoff & Expiry Defense</span>
              </div>
              <button
                type="button"
                onClick={() => onToggle('expiry_cutoff_enabled', rules.expiry_cutoff_enabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  rules.expiry_cutoff_enabled ? 'bg-wa-accent' : 'bg-wa-card'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-wa-text-primary shadow ring-0 transition duration-200 ease-in-out ${
                    rules.expiry_cutoff_enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-[11px] text-wa-text-muted mb-2.5">
              Halts holding positions past afternoon session to protect gains from 0-DTE theta decay.
            </p>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-wa-card border border-wa-border">
                <span className="text-[11px] text-wa-text-secondary">Cutoff Time (IST)</span>
                <select
                  value={rules.afternoon_cutoff_time}
                  onChange={(e) => onSelectChange('afternoon_cutoff_time', e.target.value)}
                  className="bg-wa-surface border border-wa-border rounded px-2 py-0.5 text-xs font-mono text-wa-text-primary focus:outline-none focus:border-wa-accent"
                >
                  <option value="13:30">13:30 (1:30 PM)</option>
                  <option value="14:00">14:00 (2:00 PM - Standard)</option>
                  <option value="14:30">14:30 (2:30 PM)</option>
                  <option value="15:00">15:00 (3:00 PM)</option>
                </select>
              </div>

              <div className="p-2 rounded bg-wa-card border border-wa-border text-[11px] text-wa-text-secondary">
                <span className="font-semibold text-wa-text-primary">Application:</span>{' '}
                {rules.expiry_cutoff_enabled
                  ? 'Active on Expiry Days (Tues/Wed/Thurs); full trend run allowed on Mon/Fri.'
                  : 'Active every day at specified cutoff.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
