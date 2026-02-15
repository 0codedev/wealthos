
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureZustandStorage, secureBrokerStorage, secureExternalApiStorage, storeApiKey, getApiKey, removeApiKey } from '../utils/Encryption';

export interface TelegramBotConfig {
  id: string;
  name: string;
  token: string;
  chatId: string;
  role: 'alerts' | 'autopilot' | 'n8n' | 'none';
  enabled: boolean;
}

export type ExperienceTier = 'INVESTOR' | 'TRADER' | 'QUANT';

export interface CategoryMeta {
  id: string;
  label: string;
  defaultTier: ExperienceTier;
  description: string;
}

export const WORKSPACE_CATEGORIES: CategoryMeta[] = [
  { id: 'dashboard', label: 'Dashboard', defaultTier: 'INVESTOR', description: 'Overview, net worth, asset allocation' },
  { id: 'charts', label: 'Pro Charts', defaultTier: 'INVESTOR', description: 'OpenAlgo Canvas terminal, Upstox stream' },
  { id: 'portfolio', label: 'Portfolio Hub', defaultTier: 'INVESTOR', description: 'Holdings, family accounts, vaults' },
  { id: 'ipo', label: 'IPO War Room', defaultTier: 'INVESTOR', description: 'GMP radar, subscription, allotment' },
  { id: 'journal', label: 'Trading Journal', defaultTier: 'INVESTOR', description: 'Trade logs, analytics, psychology' },
  { id: 'growth', label: 'Growth Engine', defaultTier: 'INVESTOR', description: 'Compounding goals, alpha predator' },

  { id: 'tradefinder', label: 'TradeFinder', defaultTier: 'TRADER', description: 'Setup scanner, breakout radar' },
  { id: 'alpha', label: 'Alpha Engine', defaultTier: 'TRADER', description: 'Momentum, quant screener, breadth' },
  { id: 'signals', label: 'Signal Intel', defaultTier: 'TRADER', description: 'Multi-timeframe alerts, volume spikes' },
  { id: 'telegram', label: 'Telegram Intel', defaultTier: 'TRADER', description: 'Channel feeds, signal ear' },
  { id: 'pool', label: 'Momentum Pool', defaultTier: 'TRADER', description: 'Relative strength, liquidity waves' },
  { id: 'tools', label: 'Advanced Tools', defaultTier: 'TRADER', description: 'Sector rotation, correlation, greeks' },
  { id: 'vibe-trading', label: 'Vibe-Trading AI', defaultTier: 'TRADER', description: 'Voice trading, AI execution' },

  { id: 'algo-bots', label: 'Algo Bots', defaultTier: 'QUANT', description: 'Execution daemons, OpenAlgo, paper' },
  { id: 'ai-research', label: 'AI Research Lab', defaultTier: 'QUANT', description: 'Deep logic, LLM quant research' },
  { id: 'backtester', label: 'Strategy Lab', defaultTier: 'QUANT', description: 'Apex backtester, 7 quant engines' },
  { id: 'launchpad', label: 'Launchpad', defaultTier: 'QUANT', description: 'Command terminal, utility matrix' },
  { id: 'market', label: 'Market Intel', defaultTier: 'QUANT', description: 'Option chain intel, F&O radar, heatmaps' },
  { id: 'innovation', label: 'Moonshot Lab', defaultTier: 'QUANT', description: 'Boardroom, experimental concepts' },
  { id: 'analytics', label: 'Analytics Hub', defaultTier: 'QUANT', description: 'Math lab, Monte Carlo, VaR models' },
];

export const TIER_CATEGORIES: Record<ExperienceTier, string[]> = {
  INVESTOR: ['dashboard', 'charts', 'portfolio', 'ipo', 'journal', 'growth'],
  TRADER: ['dashboard', 'charts', 'portfolio', 'ipo', 'journal', 'growth', 'tradefinder', 'alpha', 'signals', 'telegram', 'pool', 'tools', 'vibe-trading'],
  QUANT: [
    'dashboard', 'charts', 'vibe-trading', 'algo-bots', 'ai-research', 'portfolio',
    'tradefinder', 'alpha', 'backtester', 'launchpad', 'market',
    'ipo', 'journal', 'signals', 'telegram', 'pool',
    'growth', 'innovation', 'analytics', 'tools'
  ]
};

export type DesignPreset = 'wealthos-classic' | 'reui-nova' | 'shadcn' | 'astryx';

export interface SettingsState {
  targetNetWorth: number;
  targetDate: string;
  riskPerTrade: number;
  bullionCap: number;
  telegramBots: TelegramBotConfig[];
  greedKillerRoi: number;
  loanPrincipal: number;
  loanInterest: number;
  ipoFreshIssueThreshold: number;
  allocationTargets: Record<string, number>; // New Field
  isEditMode: boolean; // Global dashboard edit mode
  isDarkMode: boolean;
  isAmoled: boolean; // True-black variant for OLED panels (only applies with isDarkMode)
  activeTheme: 'default' | 'classic-dark' | 'omen-cyber' | 'grey-dark' | 'aurora' | 'default-glass' | 'nebula-violet' | 'cyber-emerald' | 'solar-amber' | 'obsidian';
  designPreset: DesignPreset;
  expertMode: boolean;
  experienceTier: ExperienceTier;
  customEnabledCategories?: string[];
  isHighContrast: boolean;
  isAstroPsychologyEnabled: boolean;
  astroProfile: {
    lagna: string;
    rulingPlanets: string[];
    tradingShadow: string;
    disciplineStrength: string;
    maxTradesPerDay: number;
    emotionalCircuitBreaker: boolean;
    favorableDigits: number[];
    hazardDigits: number[];
    operationalDays: string[];
    hazardDays: string[];
    baseMaxTrades: number;
    tuesdayMaxTrades: number;
    marsMuddaMaxTrades: number;
    baseMaxFees: number;
    marsRahuMuddaMaxFees: number;
    currentLifePhase: string;
  };

  // Real-Time Data Config
  dataMode: 'SIMULATION' | 'LIVE';
  apiKeys: {
    rapidApi?: string;
    alphaVantage?: string;
    finnhub?: string;
    fmp?: string;
  };
  dhanClientId: string; // DhanHQ Trading API Client ID
  dhanAccessToken: string; // DhanHQ Trading API Access Token
  dhanPin: string; // DhanHQ PIN for TOTP automated login
  dhanTotpSecret: string; // DhanHQ TOTP Secret Key
  dhanApiKey: string; // DhanHQ Application API Key
  dhanApiSecret: string; // DhanHQ Application API Secret
  isDhanDataApiEnabled: boolean; // Flag for paid Data API subscription
  upstoxApiKey: string; // Upstox API Key
  upstoxApiSecret: string; // Upstox API Secret
  upstoxAccessToken: string; // Upstox Access Token
  upstoxRedirectUri: string; // Upstox Redirect URI
  isUpstoxEnabled: boolean; // Flag to enable Upstox integration
  showOrderBookDepth: boolean; // Flag to enable Order Book L2 depth and computation
  geminiApiKey: string; // BYOK Support
  groqApiKey: string; // Groq API Key
  openRouterApiKey: string; // OpenRouter API Key
  mistralApiKey: string;
  cerebrasApiKey: string;
  githubToken: string;
  cloudflareToken: string;
  cloudflareAccountId: string;
  cohereApiKey: string;
  omnirouteEnabled: boolean;
  omnirouteEndpoint: string;
  omnirouteApiKey: string;
  geminiApiKeys: string[];
  groqApiKeys: string[];
  cerebrasApiKeys: string[];
  openrouterApiKeys: string[];

  preferredModelId?: string; // User's primary fallback/preference
  modelGeneralId?: string; // Model for Ambient Insights
  modelCoachId?: string; // Model for AI Trading Coach
  modelInsightsId?: string; // Model for Deep Logic Engine
  modelAlphaEngineId?: string; // Model for Pattern Scanning
  modelMacroPulseId?: string; // Model for Macro Summaries
  modelJournalId?: string; // Model for Journal Notes
  modelTelegramNewsId?: string; // Model for Telegram News/Briefs
  modelTelegramEarId?: string; // Model for Telegram Ear Summaries

  // Google Drive Sync
  googleDriveClientId: string;
  lastGoogleSyncTime: string | null;

  // Automation Hub
  isAICoachEnabled: boolean;
  n8nWebhookUrl: string;
  jarvisMuted: boolean;
  jarvisAutonomousMode: boolean;

  // Omni-Alert Settings
  omniAlertEnabled: boolean;
  omniAlertSpikeEnabled: boolean;
  omniAlertSpikeMode: 'A' | 'B' | 'C' | 'D';
  omniAlertCustomPctThreshold: number;
  omniAlertCustomWindowMinutes: number;
  omniAlertNewsAlwaysFires: boolean;
  omniAlertScope: 'A' | 'B' | 'C';
  omniAlertScopeTopNByRFactor: number;
  omniAlertVolumeSurgeMultiplier: number;
  omniAlertCooldownMinutes: number;
  omniAlertJarvisVoice: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  telegramEnabled: boolean;
  dhanDayHLAlertsEnabled: boolean;
  dhanAlertLastSyncAt: string;
  dhanAlertSyncedSymbols: string[];
  orbAlertIndices: string[];
  enabledOrbTriggerTypes: string[];
  indexVelocityAlertsEnabled: boolean;
  indexVelocityMode: 'A' | 'B' | 'C' | 'D';
  indexVelocityCustomWindow: number;
  indexVelocityCustomPct: number;
  indexVelocityCooldownMinutes: number;

  // HFT Velocity Trader (OpenAlgo SANDBOX ONLY - no real-money path exists)
  hftAutoTradeSandboxEnabled: boolean;
  hftVolMultiplier: number;        // trigger when candle move >= N x rolling baseline
  hftConfirmWindowMinutes: number; // evaluate on N-minute candle close
  hftMaxTradesPerDay: number;
  hftQuantity: number;

  // CC39 — Momentum Pool settings
  poolMarketHoursOnly: boolean;
  poolAlertMinScore: number;
  poolModelId: string;
  autoPoolEnabled: boolean;
  autoPoolTrustThreshold: number;

  // Unified Alert settings
  orbTimeframe: number;
  aiAnalysisDepth: 'quick' | 'deep';
  tradingViewEmailAlertsEnabled: boolean;
  preMarketDigestEnabled: boolean;
  preMarketDigestTime: string;

  enableMutualFunds: boolean;

  // Alpha Engine Cadence Control
  alphaRefreshInterval: 'manual' | '15s' | '30s' | '60s' | '120s' | '300s';

  hasCompletedOnboarding: boolean;
  isWelcomeWizardOpen: boolean;
  setWelcomeWizardOpen: (open: boolean) => void;

  updateSetting: (key: keyof SettingsState, value: any) => void;
  resetDefaults: () => void;
}


const DEFAULTS = {
  targetNetWorth: 500000,
  targetDate: '2027-12-31',
  riskPerTrade: 2.0,
  bullionCap: 40,
  greedKillerRoi: 20,
  loanPrincipal: 405859,
  loanInterest: 7.15,
  ipoFreshIssueThreshold: 70,
  allocationTargets: {
    'Equity & Related': 40,
    'Commodities': 25,
    'Fixed Income': 20,
    'Crypto': 5,
    'Real Estate': 5,
    'Other': 5
  },
  isEditMode: false,
  isAstroPsychologyEnabled: true,
  astroProfile: {
    lagna: 'Aquarius',
    rulingPlanets: ['Saturn', 'Rahu'],
    tradingShadow: 'Rahu',
    disciplineStrength: 'Saturn',
    maxTradesPerDay: 10,
    emotionalCircuitBreaker: true,
    favorableDigits: [1, 3, 6, 7, 9],
    hazardDigits: [5, 8],
    operationalDays: ['Wednesday', 'Friday', 'Saturday'],
    hazardDays: ['Thursday', 'Tuesday'],
    baseMaxTrades: 10,
    tuesdayMaxTrades: 5,
    marsMuddaMaxTrades: 3,
    baseMaxFees: 500,
    marsRahuMuddaMaxFees: 300,
    currentLifePhase: 'Jupiter-Rahu-Rahu'
  },

  dataMode: 'SIMULATION' as const,
  apiKeys: {
    rapidApi: '',
    alphaVantage: '',
    finnhub: '',
    fmp: ''
  },

  dhanClientId: "",
  dhanAccessToken: "",
  dhanPin: "",
  dhanTotpSecret: "",
  dhanApiKey: "",
  dhanApiSecret: "",
  isDhanDataApiEnabled: false,
  upstoxApiKey: "",
  upstoxApiSecret: "",
  upstoxAccessToken: "",
  upstoxRedirectUri: typeof window !== 'undefined' ? `${window.location.origin}/upstox/callback` : "http://localhost:3000/upstox/callback",
  isUpstoxEnabled: false, // User must explicitly enable and configure Upstox
  showOrderBookDepth: true,
  geminiApiKey: "",
  groqApiKey: "",
  openRouterApiKey: "",
  mistralApiKey: "",
  cerebrasApiKey: "",
  githubToken: "",
  cloudflareToken: "",
  cloudflareAccountId: "",
  cohereApiKey: "",
  geminiApiKeys: [],
  groqApiKeys: [],
  cerebrasApiKeys: [],
  openrouterApiKeys: [],

  preferredModelId: "gemini-3.1-flash-lite-preview",
  modelGeneralId: "gemini-3.1-flash-lite-preview",
  modelCoachId: "gemini-3.1-flash-lite-preview",
  modelInsightsId: "gemini-3.1-flash-lite-preview",
  modelAlphaEngineId: "gemini-3.1-flash-lite-preview",
  modelMacroPulseId: "gemini-3.1-flash-lite-preview",
  modelJournalId: "gemini-3.1-flash-lite-preview",
  modelTelegramNewsId: "llama-3.1-8b-instant",
  modelTelegramEarId: "llama-3.1-8b-instant",
  omnirouteEnabled: true,
  omnirouteEndpoint: "http://localhost:20128/v1",
  omnirouteApiKey: "sk-e6a9216978dae0dd-3bffe6-afca39cb",
  googleDriveClientId: "",
  lastGoogleSyncTime: null as string | null,
  n8nWebhookUrl: "",
  isAICoachEnabled: false,
  jarvisMuted: true,
  jarvisAutonomousMode: false,

  // Omni-Alert Defaults
  omniAlertEnabled: true,
  omniAlertSpikeEnabled: true,
  omniAlertSpikeMode: 'B' as const,
  omniAlertCustomPctThreshold: 0.75,
  omniAlertCustomWindowMinutes: 4,
  omniAlertNewsAlwaysFires: true,
  omniAlertScope: 'B' as const,
  omniAlertScopeTopNByRFactor: 10,
  omniAlertVolumeSurgeMultiplier: 3.0,
  omniAlertCooldownMinutes: 10,
  omniAlertJarvisVoice: true,
  telegramBotToken: "your_telegram_bot_token_here",
  telegramChatId: "-1004326362283#8",
  telegramEnabled: true,
  telegramBots: [
    {
      id: "bot_1786127722528",
      name: "Trade Trigger Bot",
      token: "your_telegram_bot_token_here",
      chatId: "-1004326362283#8",
      role: "autopilot",
      enabled: true
    },
    {
      id: "bot_1786127759198",
      name: "Wealthos Alerts Bot",
      token: "your_telegram_bot_token_here",
      chatId: "-1004326362283#10",
      role: "alerts",
      enabled: true
    },
    {
      id: "bot_1786127790567",
      name: "Trade Trigger Bot PnL",
      token: "your_telegram_bot_token_here",
      chatId: "-1004326362283#22",
      role: "pnl_report",
      enabled: true
    },
    {
      id: "bot_1786127833493",
      name: "n8n Bot",
      token: "your_telegram_bot_token_here",
      chatId: "-1004326362283",
      role: "n8n",
      enabled: true
    }
  ] as TelegramBotConfig[],
  dhanDayHLAlertsEnabled: false,
  dhanAlertLastSyncAt: "",
  dhanAlertSyncedSymbols: [],

  // CC39 — Momentum Pool defaults (per user choice: market-hours only, 75 min score)
  poolMarketHoursOnly: true,
  poolAlertMinScore: 75,
  poolModelId: 'gemini-3.1-flash-lite-preview',
  autoPoolEnabled: false,
  autoPoolTrustThreshold: 80,

  // Unified Alert Defaults
  orbTimeframe: 15,
  orbAlertIndices: ['NIFTY', 'BANKNIFTY', 'SENSEX'],
  enabledOrbTriggerTypes: ['ORB_BREAKOUT', 'HOD_BREAKOUT', 'LOD_BREAKOUT', 'HOD_PROXIMITY', 'LOD_PROXIMITY'],
  indexVelocityAlertsEnabled: true,
  indexVelocityMode: 'B' as const,
  indexVelocityCustomWindow: 10,
  indexVelocityCustomPct: 0.08,
  indexVelocityCooldownMinutes: 3,

  // HFT Velocity Trader defaults - auto-trading OFF until the human flips it
  hftAutoTradeSandboxEnabled: false,
  hftVolMultiplier: 4,
  hftConfirmWindowMinutes: 2,
  hftMaxTradesPerDay: 5,
  hftQuantity: 75,
  aiAnalysisDepth: 'deep' as const,
  tradingViewEmailAlertsEnabled: false,
  preMarketDigestEnabled: true,
  preMarketDigestTime: '08:45',

  enableMutualFunds: false,

  // Alpha Engine Cadence Control Default
  alphaRefreshInterval: '60s' as const,

  isDarkMode: true, // Default to Dark Mode
  isAmoled: false,
  activeTheme: 'default' as const,
  designPreset: 'wealthos-classic' as DesignPreset,
  expertMode: true,
  experienceTier: 'QUANT' as ExperienceTier,
  customEnabledCategories: undefined as string[] | undefined,
  isHighContrast: false,
  hasCompletedOnboarding: false,
  isWelcomeWizardOpen: false,
};

export const GOD_MODE_ADMIN_EMAIL = 'gaddamsudhanshu@gmail.com';

/**
 * Checks whether the current user is the Master Builder / God Mode Admin.
 * Used to guard live broker routing, VIP Telegram sockets, and prop desk controls.
 */
export function isGodModeAdmin(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === GOD_MODE_ADMIN_EMAIL;
}

export function getPersistedBrokerCreds(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  let creds: Record<string, string> = {};

  // 1. Read from plain persistent JSON (saved locally on this device)
  try {
    const rawBackup = localStorage.getItem('wealthos_persistent_broker_creds_v2');
    if (rawBackup) {
      const parsed = JSON.parse(rawBackup);
      if (parsed && typeof parsed === 'object') {
        creds = { ...parsed };
      }
    }
  } catch {
    // backup storage read fallback
  }

  // 2. Read from secure storage if present (overlay non-empty values)
  try {
    const fromSecure = secureBrokerStorage.get<Record<string, string>>();
    if (fromSecure && typeof fromSecure === 'object') {
      for (const [k, v] of Object.entries(fromSecure)) {
        if (v && typeof v === 'string' && v.trim()) {
          creds[k] = v.trim();
        }
      }
    }
  } catch {
    // secure storage read fallback
  }

  // 3. Fallback to clean empty defaults - NEVER inject hardcoded credentials into any account
  return {
    dhanClientId: creds.dhanClientId?.trim() || '',
    dhanAccessToken: creds.dhanAccessToken || localStorage.getItem('wealthos_dhan_pulse_last_synced_token_v2') || '',
    dhanPin: creds.dhanPin || '',
    dhanTotpSecret: creds.dhanTotpSecret || '',
    dhanApiKey: creds.dhanApiKey?.trim() || '',
    dhanApiSecret: creds.dhanApiSecret?.trim() || '',
    upstoxApiKey: creds.upstoxApiKey?.trim() || '',
    upstoxApiSecret: creds.upstoxApiSecret?.trim() || '',
    upstoxAccessToken: creds.upstoxAccessToken || localStorage.getItem('upstox_access_token') || '',
    upstoxRedirectUri: creds.upstoxRedirectUri?.trim() || (typeof window !== 'undefined' ? `${window.location.origin}/upstox/callback` : 'http://localhost:3000/upstox/callback'),
  };
}

export function savePersistedBrokerCreds(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('wealthos_first_install_done', '1');
    const current = getPersistedBrokerCreds();
    const updated = { ...current, [key]: value };
    // Synchronous plain-text backup - 100% reliable, survives browser restarts, sync pulls, and offline use
    localStorage.setItem('wealthos_persistent_broker_creds_v2', JSON.stringify(updated));
    if (key === 'dhanAccessToken' && value) {
      localStorage.setItem('wealthos_dhan_pulse_last_synced_token_v2', value);
    } else if (key === 'upstoxAccessToken' && value) {
      localStorage.setItem('upstox_access_token', value);
    }
    try {
      secureBrokerStorage.set(updated);
    } catch {
      // secure storage write error should never block persistent save
    }
  } catch (e) {
    console.error('Failed to save persistent broker creds:', e);
  }
}

export function saveAllBrokerCreds(creds: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('wealthos_first_install_done', '1');
    const current = getPersistedBrokerCreds();
    const updated = { ...current, ...creds };
    localStorage.setItem('wealthos_persistent_broker_creds_v2', JSON.stringify(updated));
    if (updated.dhanAccessToken) {
      localStorage.setItem('wealthos_dhan_pulse_last_synced_token_v2', updated.dhanAccessToken);
    }
    if (updated.upstoxAccessToken) {
      localStorage.setItem('upstox_access_token', updated.upstoxAccessToken);
    }
    try {
      secureBrokerStorage.set(updated);
    } catch {
      // ignore
    }
  } catch (e) {
    console.error('Failed to bulk save broker creds:', e);
  }
}

// Sensitive fields that should never be in plain-text localStorage
const SENSITIVE_KEYS = [
  'dhanAccessToken', 'dhanPin', 'dhanTotpSecret',
  'geminiApiKey', 'groqApiKey', 'openRouterApiKey',
  'mistralApiKey', 'cerebrasApiKey', 'githubToken',
  'cloudflareToken', 'cohereApiKey', 'apiKeys', 'telegramBotToken'
] as const;

const initialBroker = getPersistedBrokerCreds();

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      // Initialize sensitive fields from Indestructible Persistent Storage
      dhanClientId: initialBroker.dhanClientId,
      dhanAccessToken: initialBroker.dhanAccessToken,
      dhanPin: initialBroker.dhanPin,
      dhanTotpSecret: initialBroker.dhanTotpSecret,
      dhanApiKey: initialBroker.dhanApiKey,
      dhanApiSecret: initialBroker.dhanApiSecret,
      upstoxApiKey: initialBroker.upstoxApiKey,
      upstoxApiSecret: initialBroker.upstoxApiSecret,
      upstoxAccessToken: initialBroker.upstoxAccessToken,
      upstoxRedirectUri: initialBroker.upstoxRedirectUri,
      apiKeys: secureExternalApiStorage.get<any>() || DEFAULTS.apiKeys,
      geminiApiKey: getApiKey('gemini') || "",
      groqApiKey: getApiKey('groq') || "",
      openRouterApiKey: getApiKey('openrouter') || "",
      mistralApiKey: getApiKey('mistral') || "",
      cerebrasApiKey: getApiKey('cerebras') || "",
      githubToken: getApiKey('github') || "",
      cloudflareToken: getApiKey('cloudflare') || "",
      cohereApiKey: getApiKey('cohere') || "",
      telegramBotToken: getApiKey('telegrambot') || "",
      setWelcomeWizardOpen: (open: boolean) => set({ isWelcomeWizardOpen: open }),

      updateSetting: (key, value) => {
        if (key === 'experienceTier') {
          const tier = value as ExperienceTier;
          const isExpert = tier === 'QUANT' || tier === 'TRADER';
          set((state) => ({
            ...state,
            experienceTier: tier,
            expertMode: isExpert,
            customEnabledCategories: undefined
          }));
          return;
        }

        if (key === 'expertMode') {
          const isExpert = Boolean(value);
          set((state) => ({
            ...state,
            expertMode: isExpert,
            experienceTier: isExpert ? 'QUANT' : 'INVESTOR',
            customEnabledCategories: undefined
          }));
          return;
        }

        if (key === 'customEnabledCategories') {
          set((state) => ({
            ...state,
            customEnabledCategories: value
          }));
          return;
        }

        // Sync broker fields across all storage layers (secure + plain JSON backup + memory)
        const BROKER_KEY_LIST = [
          'dhanAccessToken', 'dhanPin', 'dhanTotpSecret', 'dhanClientId', 'dhanApiKey', 'dhanApiSecret',
          'upstoxApiKey', 'upstoxApiSecret', 'upstoxAccessToken', 'upstoxRedirectUri'
        ];
        if (BROKER_KEY_LIST.includes(key as string)) {
          savePersistedBrokerCreds(key as string, String(value ?? ''));
        } else if (key === 'apiKeys') {
          secureExternalApiStorage.set(value);
        } else if (SENSITIVE_KEYS.includes(key as any)) {
          const provider = key.replace('ApiKey', '').replace('Token', '').toLowerCase();
          storeApiKey(provider, value);
        }

        set((state) => ({ ...state, [key]: value }));
      },
      resetDefaults: () => {
        secureBrokerStorage.remove();
        secureExternalApiStorage.remove();
        localStorage.removeItem('wealthos_persistent_broker_creds_v2');
        localStorage.removeItem('wealthos_first_install_done');
        SENSITIVE_KEYS.forEach(key => {
          const provider = key.replace('ApiKey', '').replace('Token', '').toLowerCase();
          removeApiKey(provider);
        });
        set(DEFAULTS);
      }
    }),
    {
      name: 'wealth-aggregator-logic',
      storage: createJSONStorage(() => secureZustandStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        
        const brokerCreds = getPersistedBrokerCreds();
        const extApiKeys = secureExternalApiStorage.get<any>() || DEFAULTS.apiKeys;
        const resolvedTier: ExperienceTier = state.experienceTier || (state.expertMode ? 'QUANT' : 'INVESTOR');

        useSettingsStore.setState({
          experienceTier: resolvedTier,
          customEnabledCategories: state.customEnabledCategories,
          dhanClientId: brokerCreds.dhanClientId || state.dhanClientId || '',
          dhanAccessToken: brokerCreds.dhanAccessToken || state.dhanAccessToken || localStorage.getItem('wealthos_dhan_pulse_last_synced_token_v2') || '',
          dhanPin: brokerCreds.dhanPin || state.dhanPin || '',
          dhanTotpSecret: brokerCreds.dhanTotpSecret || state.dhanTotpSecret || '',
          dhanApiKey: brokerCreds.dhanApiKey || state.dhanApiKey || '',
          dhanApiSecret: brokerCreds.dhanApiSecret || state.dhanApiSecret || '',
          upstoxApiKey: brokerCreds.upstoxApiKey || state.upstoxApiKey || '',
          upstoxApiSecret: brokerCreds.upstoxApiSecret || state.upstoxApiSecret || '',
          upstoxAccessToken: brokerCreds.upstoxAccessToken || state.upstoxAccessToken || localStorage.getItem('upstox_access_token') || '',
          upstoxRedirectUri: brokerCreds.upstoxRedirectUri || state.upstoxRedirectUri || '',
          apiKeys: extApiKeys,
          geminiApiKey: getApiKey('gemini') || state.geminiApiKey || "",
          groqApiKey: getApiKey('groq') || state.groqApiKey || "",
          openRouterApiKey: getApiKey('openrouter') || state.openRouterApiKey || "",
          mistralApiKey: getApiKey('mistral') || state.mistralApiKey || "",
          cerebrasApiKey: getApiKey('cerebras') || state.cerebrasApiKey || "",
          githubToken: getApiKey('github') || state.githubToken || "",
          cloudflareToken: getApiKey('cloudflare') || state.cloudflareToken || "",
          cohereApiKey: getApiKey('cohere') || state.cohereApiKey || "",
          telegramBotToken: getApiKey('telegrambot') || state.telegramBotToken || "",
        });
      }
    }
  )
);
