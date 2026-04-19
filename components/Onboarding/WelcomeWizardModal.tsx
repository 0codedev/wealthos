import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sparkles, Wallet, TrendingUp, Cpu, ShieldCheck, ArrowRight, ArrowLeft, 
  Check, Database, Zap, X, Sliders, CheckCircle2, ChevronRight, Lock
} from 'lucide-react';
import { useSettingsStore, ExperienceTier, TIER_CATEGORIES, isGodModeAdmin } from '../../store/settingsStore';
import { useFirebaseAuth } from '../../contexts/FirebaseAuthContext';
import { useFirstRunStore } from '../../store/firstRunStore';
import { seedDemoPortfolio } from '../../services/seedDemoPortfolio';
import { useToast } from '../shared/ToastProvider';

interface WelcomeWizardModalProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export const WelcomeWizardModal: React.FC<WelcomeWizardModalProps> = ({ forceOpen, onClose }) => {
  const { user, loading: authLoading } = useFirebaseAuth();
  const settings = useSettingsStore();
  const firstRunStore = useFirstRunStore();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedTier, setSelectedTier] = useState<ExperienceTier>(settings.experienceTier || 'QUANT');
  const [targetNetWorth, setTargetNetWorth] = useState<number>(settings.targetNetWorth || 500000);
  const [riskPerTrade, setRiskPerTrade] = useState<number>(settings.riskPerTrade || 2.0);
  const [executionMode, setExecutionMode] = useState<'SANDBOX' | 'BROKER'>('SANDBOX');
  const [dataChoice, setDataChoice] = useState<'DEMO' | 'EMPTY'>('DEMO');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Determine if wizard should be visible
  const isAdmin = isGodModeAdmin(user?.email);
  const isExplicitlyOpen = settings.isWelcomeWizardOpen || forceOpen;
  
  // Auto-display for non-admin users who haven't completed onboarding and are not in authLoading
  const shouldAutoDisplay = !authLoading && !isAdmin && !settings.hasCompletedOnboarding && !firstRunStore.firstRunComplete;
  const isOpen = Boolean(isExplicitlyOpen || shouldAutoDisplay);

  // If admin logs in, ensure onboarding flag is marked completed silently
  useEffect(() => {
    if (isAdmin && !settings.hasCompletedOnboarding) {
      settings.updateSetting('hasCompletedOnboarding', true);
    }
  }, [isAdmin, settings]);

  if (!isOpen) return null;

  const handleClose = () => {
    settings.setWelcomeWizardOpen(false);
    onClose?.();
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // 1. Save preferences
      settings.updateSetting('experienceTier', selectedTier);
      settings.updateSetting('targetNetWorth', targetNetWorth);
      settings.updateSetting('riskPerTrade', riskPerTrade);
      settings.updateSetting('dataMode', executionMode === 'SANDBOX' ? 'SIMULATION' : 'LIVE');
      settings.updateSetting('hasCompletedOnboarding', true);

      // 2. Data choice handling
      if (dataChoice === 'DEMO') {
        const result = await seedDemoPortfolio();
        const total =
          result.inserted.holdings +
          result.inserted.trades +
          result.inserted.reviews +
          result.inserted.mistakes +
          result.inserted.goals;
        firstRunStore.enterDemoMode();
        firstRunStore.setDemoRowCount(total);
      } else {
        firstRunStore.dismissFirstRun('empty');
      }

      toast.success(`Welcome to WealthOS! Workspace tailored for ${selectedTier} mode.`);
      handleClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to complete setup');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-950/85 backdrop-blur-xl"
          onClick={handleClose}
        />

        {/* Ambient glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-indigo-500/15 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        {/* Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ type: 'spring', stiffness: 280, damping: 26 }}
          className="relative w-full max-w-2xl bg-slate-900/95 border border-slate-700/60 rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-black text-sm">
                W2
              </div>
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  WealthOS Onboarding
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Step {step} of 4
                  </span>
                </h2>
                <p className="text-xs text-slate-400">Configure your personalized trading & wealth cockpit</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close Wizard"
            >
              <X size={18} />
            </button>
          </div>

          {/* Stepper Progress Indicator */}
          <div className="grid grid-cols-4 gap-2 my-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  step >= i
                    ? 'bg-gradient-to-r from-indigo-500 to-emerald-400'
                    : 'bg-slate-800'
                }`}
              />
            ))}
          </div>

          {/* Step Content */}
          <div className="flex-1 overflow-y-auto py-2 pr-1 custom-scrollbar">
            {/* STEP 1: Experience Tier */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="text-left mb-3">
                  <h3 className="text-base font-bold text-white">Choose Your Workspace Persona</h3>
                  <p className="text-xs text-slate-400">
                    Select your trading intensity. This customizes your navigation tabs and algorithm controls.
                  </p>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  {/* INVESTOR */}
                  <div
                    onClick={() => setSelectedTier('INVESTOR')}
                    className={`cursor-pointer rounded-2xl p-4 border transition-all relative ${
                      selectedTier === 'INVESTOR'
                        ? 'bg-emerald-950/40 border-emerald-500/60 ring-1 ring-emerald-500/40'
                        : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-300">
                        <Wallet size={20} />
                      </div>
                      {selectedTier === 'INVESTOR' && <CheckCircle2 size={16} className="text-emerald-400" />}
                    </div>
                    <div className="font-bold text-sm text-white">🌱 Investor</div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      Core wealth, Mutual Funds, IPOs, SIPs, and disciplined long-term compounding.
                    </p>
                    <div className="mt-3 text-[10px] font-mono text-emerald-400/80">
                      5 focused modules
                    </div>
                  </div>

                  {/* TRADER */}
                  <div
                    onClick={() => setSelectedTier('TRADER')}
                    className={`cursor-pointer rounded-2xl p-4 border transition-all relative ${
                      selectedTier === 'TRADER'
                        ? 'bg-blue-950/40 border-blue-500/60 ring-1 ring-blue-500/40'
                        : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="p-2 rounded-xl bg-blue-500/20 text-blue-300">
                        <TrendingUp size={20} />
                      </div>
                      {selectedTier === 'TRADER' && <CheckCircle2 size={16} className="text-blue-400" />}
                    </div>
                    <div className="font-bold text-sm text-white">⚡ Trader</div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      Swing setups, Trade Finder, Alpha scanner, sector rotation, and signal alerts.
                    </p>
                    <div className="mt-3 text-[10px] font-mono text-blue-400/80">
                      12 active modules
                    </div>
                  </div>

                  {/* QUANT PRO */}
                  <div
                    onClick={() => setSelectedTier('QUANT')}
                    className={`cursor-pointer rounded-2xl p-4 border transition-all relative ${
                      selectedTier === 'QUANT'
                        ? 'bg-indigo-950/40 border-indigo-500/60 ring-1 ring-indigo-500/40'
                        : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300">
                        <Cpu size={20} />
                      </div>
                      {selectedTier === 'QUANT' && <CheckCircle2 size={16} className="text-indigo-400" />}
                    </div>
                    <div className="font-bold text-sm text-white">🔬 Quant Pro</div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      Full institutional suite: Telegram Ears, OpenAlgo sandbox, Options Greeks, and AI Prop desk.
                    </p>
                    <div className="mt-3 text-[10px] font-mono text-indigo-400/80">
                      All 19 modules
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Capital & Targets */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="text-left mb-3">
                  <h3 className="text-base font-bold text-white">Portfolio Capital & Risk Sizing</h3>
                  <p className="text-xs text-slate-400">
                    Define your starting target capital and position sizing safety constraints.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Target Net Worth Goal (₹)
                    </label>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {[100000, 500000, 2500000, 10000000].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setTargetNetWorth(val)}
                          className={`py-1.5 px-2 rounded-xl text-xs font-mono font-medium transition-all ${
                            targetNetWorth === val
                              ? 'bg-indigo-600 text-white font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          ₹{(val / 100000).toLocaleString()}L
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      value={targetNetWorth}
                      onChange={(e) => setTargetNetWorth(Number(e.target.value))}
                      className="w-full bg-slate-950/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-mono focus:border-indigo-500 focus:outline-none"
                      placeholder="Custom target net worth..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Risk Per Trade: <span className="font-mono text-indigo-400 font-bold">{riskPerTrade}%</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {[1.0, 2.0, 3.0].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRiskPerTrade(r)}
                          className={`py-1.5 px-2 rounded-xl text-xs font-medium transition-all ${
                            riskPerTrade === r
                              ? 'bg-indigo-600 text-white font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {r}% {r === 1.0 ? '(Conservative)' : r === 2.0 ? '(Recommended)' : '(Aggressive)'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Execution Mode */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="text-left mb-3">
                  <h3 className="text-base font-bold text-white">Execution & Privacy Boundary</h3>
                  <p className="text-xs text-slate-400">
                    WealthOS uses a multi-tenant zero-trust container. Choose how you want to run trades.
                  </p>
                </div>

                <div className="space-y-3">
                  <div
                    onClick={() => setExecutionMode('SANDBOX')}
                    className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                      executionMode === 'SANDBOX'
                        ? 'bg-indigo-950/40 border-indigo-500/60 ring-1 ring-indigo-500/40'
                        : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-bold text-sm text-white flex items-center gap-2">
                        <ShieldCheck size={18} className="text-emerald-400" />
                        Isolated Sandbox Mode (Recommended)
                      </div>
                      {executionMode === 'SANDBOX' && <CheckCircle2 size={16} className="text-indigo-400" />}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Safe simulated execution. Test strategies, parse Telegram signals, and trade risk-free with zero broker accounts required.
                    </p>
                  </div>

                  <div
                    onClick={() => setExecutionMode('BROKER')}
                    className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                      executionMode === 'BROKER'
                        ? 'bg-indigo-950/40 border-indigo-500/60 ring-1 ring-indigo-500/40'
                        : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-bold text-sm text-white flex items-center gap-2">
                        <Zap size={18} className="text-amber-400" />
                        Direct Broker Link (Dhan / Upstox)
                      </div>
                      {executionMode === 'BROKER' && <CheckCircle2 size={16} className="text-indigo-400" />}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Link your personal broker credentials safely via encrypted local storage. You can configure keys anytime inside Settings.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: Initial Data Setup */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="text-left mb-3">
                  <h3 className="text-base font-bold text-white">Sample Data & Exploration</h3>
                  <p className="text-xs text-slate-400">
                    How would you like to initialize your local IndexedDB workspace?
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div
                    onClick={() => setDataChoice('DEMO')}
                    className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                      dataChoice === 'DEMO'
                        ? 'bg-amber-950/40 border-amber-500/60 ring-1 ring-amber-500/40'
                        : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300">
                        <Sparkles size={20} />
                      </div>
                      {dataChoice === 'DEMO' && <CheckCircle2 size={16} className="text-amber-400" />}
                    </div>
                    <div className="font-bold text-sm text-white">Populate Demo Portfolio</div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Inject simulated stock holdings, historical trades, and journals to explore charts and AI metrics immediately.
                    </p>
                  </div>

                  <div
                    onClick={() => setDataChoice('EMPTY')}
                    className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                      dataChoice === 'EMPTY'
                        ? 'bg-slate-800/80 border-indigo-500/60 ring-1 ring-indigo-500/40'
                        : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="p-2 rounded-xl bg-slate-700/50 text-slate-300">
                        <Database size={20} />
                      </div>
                      {dataChoice === 'EMPTY' && <CheckCircle2 size={16} className="text-indigo-400" />}
                    </div>
                    <div className="font-bold text-sm text-white">Clean Slate (Pristine)</div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Start completely empty. Add your own holdings, import broker statements, or log trades manually.
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 flex items-center gap-2.5 text-xs text-slate-400">
                  <Lock size={14} className="text-emerald-400 shrink-0" />
                  <span>Your data is stored locally in client IndexedDB with zero cloud transmission without explicit login.</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-800/80">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as any)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 transition-colors"
              >
                <ArrowLeft size={14} /> Back
              </button>
            ) : (
              <div />
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s + 1) as any)}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/20 transition-colors"
              >
                Continue <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleComplete}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-indigo-600 hover:from-emerald-400 hover:to-indigo-500 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span className="block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                  <>
                    <Check size={14} /> Finish & Launch Cockpit
                  </>
                )}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
