import Dexie, { type Table } from 'dexie';
import { Investment, HistoryEntry } from './types';
import type { EarSummary } from './services/TelegramEarManager';

export const EXPECTED_SCHEMA_VERSION = 18;

export class SchemaVersionError extends Error {
  constructor(public currentVersion: number, public expectedVersion: number) {
    super(`IndexedDB Dexie schema version mismatch (Current: ${currentVersion}, Expected: ${expectedVersion})`);
    this.name = 'SchemaVersionError';
  }
}

export async function validateSchemaVersion(db: Dexie): Promise<boolean> {
  try {
    const current = db.verno;
    if (current > 0 && current !== EXPECTED_SCHEMA_VERSION) {
      console.warn(`[DEXIE SCHEMA] Version mismatch: ${current} != ${EXPECTED_SCHEMA_VERSION}`);
    }
    return true;
  } catch (err) {
    console.error('[DEXIE SCHEMA] Schema validation error:', err);
    return true;
  }
}

export type TradeDirection = 'Long' | 'Short';
export type MoodEntry = 'Focused' | 'Anxious' | 'Bored' | 'Revenge' | 'Greedy';
export type MoodExit = 'Satisfied' | 'Panic' | 'Regret' | 'Euphoric';
export type TradeMistake = 'FOMO' | 'Chasing' | 'No Stop Loss' | 'Overleveraged' | 'Early Exit' | 'Hesitation' | 'Revenge Trade' | 'News Trading';
// Changed to string to allow dynamic strategies
export type TradeSetup = string;
export const KNOWN_SETUPS = ['A+', 'A', 'B', 'C', 'D', 'F'] as const;
export type SetupGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface Annotation { x: number; y: number; type: string; }

export interface TradeScreenshot {
  id: string;
  filename: string;
  blob: Blob;
  annotations?: Annotation[]; // Drawing data
  uploadedAt: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  mandatory?: boolean;
}

export interface EmotionLog {
  primary: string;
  intensity: number; // 1-5
  notes?: string;
}

export interface Trade {
  id?: number;
  ticker: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss?: number;
  quantity: number;
  direction: TradeDirection;
  date: string; // ISO string
  entryTime?: string; // HH:mm format (Module 4)
  exitTime?: string; // HH:mm format - actual exit timestamp (Dhan-synced trades)
  isDeleted?: boolean; // soft-delete flag (undo window)
  moodEntry: MoodEntry;
  moodExit: MoodExit;
  mistakes: string[];
  setup?: TradeSetup;
  grade?: SetupGrade;
  screenshot?: string | Blob;
  notes?: string;
  pnl?: number;
  riskRewardRatio?: number;
  fees?: number;
  mae?: number;
  mfe?: number;
  // Phase 16: Pro Trade Journal Features
  assetClass?: 'Equity' | 'Options' | 'Crypto' | 'Forex' | 'Futures';
  setupTags?: string[]; // Multiple setups combined
  takeProfit?: number;
  ahaMoment?: string;
  // Phase 18: Advanced Pro Features
  stopLossMoved?: boolean;
  scaledOut?: boolean;
  timeInTrade?: string;
  tiltScore?: number;
  forcedTrade?: boolean;
  screenshotHTF?: string | Blob;
  screenshotEntry?: string | Blob;
  screenshotExit?: string | Blob;
  // Module 5: Compliance
  complianceScore?: number; // 0-100
  // Sprint 2: Trading Journal Pro
  screenshots?: TradeScreenshot[];
  preTradeEmotion?: EmotionLog;
  postTradeEmotion?: EmotionLog;
  checklist?: {
    items: ChecklistItem[];
    completed: boolean;
    completedAt?: string;
  };
  // P2: Trade Tagging System
  tags?: string[]; // Custom tags like 'Earnings', 'Breakout', 'Momentum', etc.
  // Phase 20: Execution Desk Pro Upgrades - Step 1
  setupConvexityScore?: number;
  correlatedAssets?: string[];
  macroEvents?: string[];
  timeOfDay?: string;
  // Phase 20: Execution Desk Pro Upgrades - Step 2
  brokerProfile?: 'Intraday Equity' | 'Delivery Equity' | 'Futures' | 'Options' | 'MTF / Margin';
  trailingStopType?: 'None' | 'Manual' | 'Auto (ATR)' | 'Auto (Moving Average)';
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  // Phase 20: Execution Desk Pro Upgrades - Step 3
  convictionLevel?: number; // 1-10 string mapped to number or just 1-10
  fomoLevel?: number; // 1-10
  stressLevel?: number; // 1-10
  physicalState?: 'Rested' | 'Fatigued' | 'Caffeinated' | 'Hungover' | 'Sick';
  focusState?: 'Hyper-Focused' | 'Distracted' | 'Bored' | 'Flow State';
  // Phase 20: Execution Desk Pro Upgrades - Step 4
  loomUrl?: string;
  isStitchedEntry?: boolean;
  isStitchedExit?: boolean;
  chartAnnotations?: { htf?: string; entry?: string; exit?: string };
  // Phase 20: Execution Desk Pro Upgrades - Step 5
  wouldTakeAgain?: boolean;
  isTextbook?: boolean;
  coreLesson?: string;
  adjustedGrade?: 'A' | 'B' | 'C' | 'D' | 'F';
  // Phase 26: God-Tier DhanHQ features
  feeBreakdown?: {
    stt: number;
    sebiTax: number;
    brokerage: number;
    serviceTax: number;
    exchangeTransactionCharges: number;
    stampDuty: number;
  };
  orderType?: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | string;
  optionsData?: {
    strikePrice: number;
    optionType: 'CE' | 'PE' | string;
    expiryDate: string;
    daysToExpiry: number;
  };
  productType?: string; // CNC, INTRADAY, MARGIN
  legsCount?: number;
  isin?: string;
  isImported?: boolean; // Flag to preserve Dhan HQ original synced data from auto-recalculation
  broker?: 'dhan' | 'manual' | 'other';
  brokerAccountId?: string;
  brokerOrderId?: string;
  brokerTradeId?: string;
  brokerSecurityId?: string;
  source?: string;
  sourceId?: string;
  sourceChecksum?: string;
  syncStatus?: 'SYNCED' | 'PENDING' | 'STALE' | 'CONFLICT' | 'ERROR';
  importConfidence?: number;
  reviewStatus?: 'NEEDS_ANNOTATION' | 'NEEDS_SCREENSHOTS' | 'ANNOTATED' | 'READY_FOR_LESSON';
  marketThesis?: string;
  // Phase 29: Agentic Intelligence Integration
  aiVerdict?: 'BUY' | 'SELL' | 'HOLD' | 'WAIT';
  aiConvictionScore?: number;
  aiReportPath?: string;
  aiFullLog?: string;

  // TradeDiary Integration
  tradeOutcome?: 'Full Win' | 'Partial Success' | 'Breakeven' | 'Partial Loss' | 'Full Loss' | 'Stopped Out';
  satisfactionRating?: number; // 1-10
  rulesFollowed?: string[];
}

export interface HistoricalPoint {
  id?: number;
  date: string;
  symbol: string;
  assetClass: 'Equity' | 'Options' | 'Futures' | 'Forex' | 'Crypto' | 'Commodity';
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  oi?: number;
  optionType?: 'CE' | 'PE' | string;
  strike?: number;
  expiry?: string;
}

export interface Dividend {
  id?: number;
  date: string;
  ticker: string;
  amount: number;
  credited: boolean;
}

export interface IPOApplication {
  id?: number;
  applicantName: string;
  ipoName: string;
  amount: number;
  status: 'BLOCKED' | 'ALLOTTED' | 'REFUNDED' | 'LISTED';
  upiHandle: string;
  appliedDate: string;
  issueId?: string;
  blockedAmount?: number;
  lotCount?: number;
  lotSize?: number;
  issuePrice?: number;
  allotmentDate?: string;
  refundDate?: string;
  listingDate?: string;
  refundAmount?: number;
  listingPrice?: number;
  realizedPnL?: number;
  quota?: 'RETAIL' | 'SHAREHOLDER' | 'SMALL_HNI' | 'BIG_HNI';
  ipoType?: 'MAINBOARD' | 'SME';
  allottedAmount?: number;
}

export interface TaxRecord {
  id?: number;
  fy: string;
  realizedLTCG: number;
  realizedSTCG: number;
  lastUpdated: string;
}

export interface RealizedTransaction {
  id?: number;
  investmentId: string;
  assetName: string;
  type: 'PARTIAL_EXIT' | 'FULL_EXIT';
  saleDate: string;
  saleAmount: number;
  salePrice?: number; // Price per unit if applicable
  costBasis: number; // The portion of invested amount removed
  realizedPL: number;
  realizedPLPercent: number;
  notes?: string;
}

// Module 6: Strategy Rulebook
export interface Strategy {
  id?: number;
  name: string;
  description?: string;
  rules: string[]; // Checklist items
  winRate?: number;
  avgRMultiple?: number;
  totalTrades?: number;
  isActive?: boolean;
}

// Module 6: Daily Report Card
export interface QuickLog {
  id?: string;
  timestamp: string; // ISO string
  note: string;
}

export interface DailyReview {
  date: string; // YYYY-MM-DD (Primary Key)
  rating: number; // 1-5 Stars
  marketCondition: 'Trending' | 'Choppy' | 'Volatile' | 'Sideways';
  notes: string;
  didWell: string;
  didPoorly: string;
  // Phase 15: Life Journal Integrations
  sleepHours?: number;
  mood?: 'Focused' | 'Tilted' | 'Anxious' | 'Confident' | 'Neutral';
  energyLevel?: number; // 1-10
  exercise?: boolean;
  quickLogs?: QuickLog[];
}

export interface VoiceSession {
  id?: number;
  date: string;
  durationSeconds: number;
  transcript: string;
  dominantEmotion: string;
  emotionTimeline: { timestamp: number; emotion: string; intensity: number }[];
  aiCommentary: string;
  instruments: string[];
  keyIdeas: string[];
}

// Module 7: Life Events (Wealth Simulator)
export interface LifeEvent {
  id?: number;
  name: string;
  date: string; // YYYY-MM-DD
  amount: number;
  type: 'EXPENSE' | 'INCOME';
}

export interface PaperTrade {
  id?: number;
  ticker: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  quantity: number;
  openDate: string; // ISO
  status: 'OPEN' | 'CLOSED';
  closePrice?: number;
  closeDate?: string; // Fix #14: Use string ISO to match openDate
  pnl?: number;
  notes?: string;
}

// Mirror of Truth: Financial Mistakes & Lessons
export interface Mistake {
  id: string;
  date: string;
  title: string;
  cost: number;
  category: 'TRADING' | 'LIFE';
  lesson: string;
  emotionalState?: string;
  tags?: string[];
  actionItems?: string[];
  relatedTopics?: string[];
  summary?: string;
  describeContext?: string;
}

export interface MirrorRule {
  id: string;
  date: string;
  text: string;
  version: number;
  isActive: boolean;
  sourceMistakeId?: string; // If this rule was born from a specific mistake
}

// Phase 24: Missed Trades Logger
export type MissedReason = 'FOMO' | 'Hesitation' | 'Distracted' | 'Setup Invalidated Early' | 'Too Fast' | 'Other';

export interface MissedTrade {
  id?: number;
  date: string; // ISO string
  ticker: string;
  assetClass: 'Equity' | 'Options' | 'Crypto' | 'Forex' | 'Futures';
  direction: TradeDirection;
  setup: string;
  reason: MissedReason;
  notes?: string;
  screenshotHTF?: string | Blob;
  screenshotEntry?: string | Blob;
}

// Phase 25: DhanHQ Instrument Master
export interface DhanInstrument {
  securityId: string; // Unique primary key
  symbol: string;
  name: string;
  exchangeSegment: string;
  instrumentType?: string;
}

export interface BrokerHoldingCache {
  id?: number;
  broker: string;
  brokerAccountId: string;
  brokerSecurityId: string;
  tradingSymbol: string;
  quantity: number;
  avgCostPrice: number;
  lastPrice: number;
  currentValue: number;
  fetchedAt: string;
  staleAt: string;
  raw?: unknown;
}

export interface BrokerPositionCache {
  id?: number;
  broker: string;
  brokerAccountId: string;
  brokerSecurityId: string;
  tradingSymbol: string;
  netQty: number;
  buyAvg: number;
  sellAvg: number;
  productType?: string;
  positionType?: string;
  unrealizedProfit?: number;
  realizedProfit?: number;
  fetchedAt: string;
  staleAt: string;
  raw?: unknown;
}

export interface SyncRecordRow {
  id: string;
  scope: string;
  entityType: string;
  entityId: string;
  source: string;
  sourceId?: string;
  syncVersion: number;
  syncStatus: 'SYNCED' | 'PENDING' | 'STALE' | 'CONFLICT' | 'ERROR';
  checksum?: string;
  lastSyncedAt: string;
  lastConflictAt?: string;
  diagnostic?: string;
}

// Legacy Vault: Estate Planning Beneficiaries
export interface Beneficiary {
  id?: number;
  name: string;
  relation: string;
  allocation: number; // Percentage 0-100
  color: string;
}

// AI Advisor: Conversation History
export interface Conversation {
  id?: number;
  title: string;
  persona: string; // 'advisor' | 'oracle' | 'wolf' | 'roast'
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview?: string; // First 100 chars of last message
}

export interface ChatMessage {
  id?: number;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
  imageUrl?: string;
}

// Smart Alerts
export interface Alert {
  id?: number;
  type: 'price_target' | 'stop_loss' | 'sip_reminder' | 'tax_deadline' | 'custom';
  title: string;
  description: string;
  triggerValue?: number;
  assetId?: string;
  isActive: boolean;
  createdAt: string;
  triggeredAt?: string;
  notified: boolean;
}

// Financial Goals (P1 Enhancement)
export interface Goal {
  id?: number;
  name: string;
  targetAmount: number;
  targetDate: string; // YYYY-MM-DD
  currentAmount: number; // Manually tracked or auto-calculated
  priority: 'Critical' | 'Important' | 'Nice-to-Have';
  category: 'Retirement' | 'House' | 'Education' | 'Travel' | 'Emergency' | 'Wedding' | 'Vehicle' | 'Other';
  color: string;
  linkedInvestmentIds?: string[]; // Investments allocated to this goal
  inflationRate?: number; // Default 6%
  createdAt: string;
  completedAt?: string;
  notes?: string;
}

export interface Transaction {
  id: string; // txn_...
  date: string;
  description: string;
  amount: number;
  category: string;
  type: 'credit' | 'debit';
  bankName?: string;
  merchant?: string;
  icon?: string;
  tags?: string[];
  balance?: number;
  upiRef?: string;
  upiId?: string;
  notes?: string;
  excluded?: boolean;
}

// P3: IPO Vault Synergies
export interface Friend {
  id?: number;
  name: string;
  balance: number;
  totalProfits?: number;
  history?: { date: string, amount: number, type: 'DEPOSIT' | 'WITHDRAW' | 'PROFIT' | 'REFUND' | 'BLOCKED', notes?: string }[];
  color?: string;
  notes?: string;
}

// Module 8: Academy (Quiz Progress)
export interface QuizProgress {
  id?: number;
  userId: string; // 'default'
  totalXP: number;
  currentStreak: number;
  longestStreak: number;
  quizzesCompleted: number;
  lastQuizDate: string | null;
  badges: string[];
  categoryProgress: Record<string, { correct: number; total: number }>;
}

export interface ForwardDuel {
  id?: number;
  date: string;                  // YYYY-MM-DD
  
  // System parameters
  systemTicker: string;          // Selected stock at 9:50 AM
  systemEntryPrice: number;
  systemPeakPrice: number;       // Peak price seen during the session
  systemTroughPrice: number;     // Lowest price seen during the session
  systemExitPrice?: number;
  systemStatus: 'PENDING' | 'TARGET_HIT' | 'STOP_HIT' | 'EOD_EXIT';
  systemPnL: number;
  systemStopLoss?: number;       // Dynamic Stop Loss
  systemTarget?: number;         // Dynamic Target
  
  // User parameters
  userTicker: string;            // Selected stock manually
  userEntryPrice: number;
  userPeakPrice: number;         // Peak price seen during the session
  userTroughPrice: number;       // Lowest price seen during the session
  userExitPrice?: number;
  userStatus: 'PENDING' | 'TARGET_HIT' | 'STOP_HIT' | 'EOD_EXIT';
  userPnL: number;
  userStopLoss?: number;         // Dynamic Stop Loss
  userTarget?: number;           // Dynamic Target
  modelRunTime?: string;         // '09:50' | '10:30' | '11:00'
}

export interface SignalProvider {
  id?: number;
  name: string;
  totalSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRR: number;
  lastActive: string;
}

export interface ParsedSignal {
  id?: number;
  instrument: string;
  action: 'BUY' | 'SELL' | 'SHORT' | 'COVER';
  entryPrice: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  target3?: number;
  provider: string;
  timestamp: string;
  status: 'NEEDS_REVIEW' | 'ACTIVE' | 'TARGET_HIT' | 'SL_HIT' | 'CLOSED' | 'EXPIRED';
  outcomePnL?: number;
  riskRewardRatio?: number;
  notes?: string;
  expiryDate?: string;
  threadId?: string;
  quantity?: number;
  mlScore?: number;
  isPhantom?: number;
  phantomPnL?: number;
}

/**
 * CC33 — Telegram Multi-Ear OCR Parser & Dhan/Upstox Signal Ledger
 * Stores the output of the regex/LLM parser, optionally attached to an
 * OCR-extracted image (base64 thumbnail) for audit replay.
 */
export interface ParsedSignalRecord {
  id?: number;
  rawText: string;
  parsed: {
    action: 'BUY' | 'SELL';
    tradingSymbol: string;
    strike?: number | null;
    type?: 'CE' | 'PE' | null;
    entry: number;
    sl: number;
    targets: number[];
    expiry?: string | null;
    productType?: 'INTRADAY' | 'MARGIN' | 'CNC';
    exchangeSegment?: 'NSE_EQ' | 'NSE_FNO' | 'BSE_EQ' | 'MCX_COMM';
  };
  confidence: number; // 0-1
  source: 'TEXT' | 'OCR';
  status: 'PARSED' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED';
  timestamp: number;
  executedAt?: number;
  ocrImageData?: string; // optional base64 thumbnail (kept short for Dexie)
  notes?: string;
  ticker?: string; // mirrored for the [timestamp+status] index
}

/**
 * CC39 — Momentum Pool (Pre-Market Watchlist with Auto-Verdict)
 * A symbol the user wants to track and get an auto-verdict + alert on.
 * `source` records the intake path (MANUAL / TELEGRAM / INSTAGRAM / NEWS /
 * TWEET / SCAN) so the UI can show provenance and we can learn which sources
 * produce the best outcomes.
 */
export interface PoolItem {
  id?: number;
  ticker: string;                 // RELIANCE, NIFTY, BANKNIFTY...
  exchange: 'NSE_EQ' | 'NSE_FNO' | 'BSE_EQ' | 'MCX_COMM';
  displayName?: string;           // "Reliance Industries"
  instrumentKey?: string;         // Upstox key, resolved async
  addedAt: number;                // epoch ms
  source: 'MANUAL' | 'TELEGRAM' | 'INSTAGRAM' | 'NEWS' | 'TWEET' | 'SCAN' | 'ALPHA_ENGINE';
  sourceMeta?: {
    channelId?: string;
    messageId?: number;
    threadId?: number;
    handle?: string;
    caption?: string;
  };
  notes?: string;
  targetBuyPrice?: number;
  targetSellPrice?: number;
  stopLoss?: number;
  tags?: string[];
  alertEnabled: 0 | 1;
  alertOn?: Array<'VERDICT_FIRE' | 'PRICE_TARGET_HIT' | 'STOP_HIT' | 'PATTERN_MATCH' | 'NEWS_HIT' | 'VOLUME_SURGE'>;
  autoPoll?: 0 | 1; // 1 = enabled (default), 0 = disabled (manual resolve)
  status: 'WATCHING' | 'VERDICT_READY' | 'TRIGGERED' | 'EXECUTED' | 'EXPIRED' | 'DISMISSED';
  expiresAt?: number;
  cost?: number;
  quantity?: number;
  lastPrice?: number;
  lastVerdictAt?: number;
  lastVerdictScore?: number;
}

/**
 * CC39 — One AI verdict produced by PoolVerdictEngine for a PoolItem.
 * `score` is a 0-100 strength of the conviction; `verdict` is a discrete
 * label; `confidence` is the LLM's self-reported 0-1.
 */
export interface PoolVerdict {
  id?: number;
  poolItemId: number;
  ticker: string;
  generatedAt: number;
  verdict: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL' | 'AVOID';
  score: number;                  // 0-100
  confidence: number;             // 0-1
  summary: string;
  reasoning: string[];
  signals: {
    technical: {
      rsi: number;
      macdHist: number;
      above200sma: boolean;
      bbPos: number;              // 0=lower band, 1=upper band
    };
    flow: {
      oiChangePct: number;
      volumeMultiplier: number;
    };
    pattern?: string;
    news?: Array<{ headline: string; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' }>;
  };
  suggestedEntry?: number;
  suggestedStop?: number;
  suggestedTarget?: number;
  riskRewardRatio?: number;
  sourceModel: string;
  triggerType: 'SCHEDULED_OPEN' | 'PATTERN' | 'NEWS' | 'MANUAL' | 'POLL' | 'TARGET_HIT' | 'STOP_HIT';
  notifiedAt?: number;
}

/**
 * CC39 — An intake source the user wants to draw signals from.
 * Currently we support TELEGRAM_CHANNEL/GROUP (wired) and INSTAGRAM/TWITTER/
 * NEWS_FEED (manual label — the user pastes a symbol and we just label the
 * source so trust scoring works).
 */
export interface PoolSource {
  id?: number;
  kind: 'TELEGRAM_CHANNEL' | 'TELEGRAM_GROUP' | 'INSTAGRAM' | 'TWITTER' | 'NEWS_FEED' | 'MANUAL';
  handle: string;
  displayName?: string;
  enabled: 0 | 1;
  trustScore: number;             // 0-100, auto-learned from win/loss
  lastSeenAt?: number;
}

export interface TelegramMessage {
  id?: number;
  earId: string;
  threadId?: number;
  channelName?: string;
  text: string;
  messageType?: string;
  parsedJson?: string;
  confidence?: number;
  receivedAt: number;
  isStarred?: number;
  isLifecycle?: number;
}

export interface TelegramEarCache {
  id?: number;
  earId: string;
  lastSync: number;
}

export interface JarvisBrief {
  id?: number;
  timestamp: number;
  briefText: string;
  sentinelData: {
    vix: number;
    fiiFlow: number;
    signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
  };
  paperTradeId?: number;
}

export interface BrainVector {
  id?: number;
  docType: 'trade' | 'signal' | 'journal';
  docId: string;
  text: string;
  vector: number[];
  timestamp: number;
}

export interface RLExperience {
  id?: number;
  timestamp: number;
  signalId?: number;
  reward: number;
  state: number[];
  action: number;
}

export interface ModelVersion {
  id?: number;
  version: number;
  accuracy: number;
  loss: number;
  sampleCount: number;
  timestamp: number;
  isCurrent: number; // 1 for true, 0 for false
}



export class TradeDatabase extends Dexie {
  trades!: Table<Trade>;
  sandbox_trades!: Table<Trade>;
  dividends!: Table<Dividend>;
  ipo_applications!: Table<IPOApplication>;
  investments!: Table<Investment>;
  history!: Table<HistoryEntry>;
  tax_records!: Table<TaxRecord>;
  strategies!: Table<Strategy>;
  daily_reviews!: Table<DailyReview>;
  life_events!: Table<LifeEvent>;
  paper_trades!: Table<PaperTrade>;
  beneficiaries!: Table<Beneficiary>;
  conversations!: Table<Conversation>;
  chat_messages!: Table<ChatMessage>;
  alerts!: Table<Alert>;
  transactions!: Table<Transaction>;
  goals!: Table<Goal>;
  friends!: Table<Friend>;
  quiz_progress!: Table<QuizProgress>;
  realized_transactions!: Table<RealizedTransaction>;
  mistakes!: Table<Mistake>;
  cache!: Table<{ id?: number; key: string; data: unknown; timestamp: number; ttl?: number }>;
  missed_trades!: Table<MissedTrade>;
  instruments!: Table<DhanInstrument>;
  broker_holdings_cache!: Table<BrokerHoldingCache>;
  broker_positions_cache!: Table<BrokerPositionCache>;
  sync_records!: Table<SyncRecordRow>;
  mirror_rules!: Table<MirrorRule>;
  historical_data!: Table<HistoricalPoint>;
  forward_duels!: Table<ForwardDuel>;
  alphaSnapshots!: Table<{ id?: number; key: string; data: unknown; cachedAt: number; ttlHours: number }>;
  signal_providers!: Table<SignalProvider>;
  parsed_signals!: Table<ParsedSignal>;
  parsed_signal_records!: Table<ParsedSignalRecord>;
  telegram_messages!: Table<TelegramMessage>;
  telegram_ear_cache!: Table<TelegramEarCache>;
  jarvis_briefs!: Table<JarvisBrief>;
  brain_vectors!: Table<BrainVector>;
  rl_experiences!: Table<RLExperience>;
  model_versions!: Table<ModelVersion>;
  voice_sessions!: Table<VoiceSession>;
  pool_items!: Table<PoolItem>;
  pool_verdicts!: Table<PoolVerdict>;
  pool_sources!: Table<PoolSource>;
  ml_models!: Table<MlModelVersion>;
  ml_weights!: Table<MlWeightRow>;
  trade_legs!: Table<TradeLeg>;
  first_run_meta!: Table<FirstRunMeta>;
  market_day_features!: Table<{ id?: number; date: string; nifty1dReturn: number; vixLevel: number; vix5dChange: number; fiiFlowDelta: number; adRatio: number; realizedVol10d: number; anomalyScore?: number }>;
  mce_feature_history!: Table<{ id?: number; symbol: string; asOf: number; featuresJson: string }>;
  watchlist_snapshots!: Table<{ id?: number; symbol: string; asOf: number; featuresJson: string; crossedBuyZone: boolean }>;
  shared_journal!: Table<SharedJournalEntry>;
  daily_digest!: Table<DailyDigestRecord>;
  snapshots!: Table<SnapshotRecord>;
  candle_cache!: Table<CandleCacheEntry>;
  scan_candidates!: Table<{ id?: number; symbol: string; combinedScore: number; mlProb: number; quantScore: number; aiConviction: number; scanTime: number; wasTraded: boolean; actualReturn?: number | null }>;


  constructor() {
    super('WealthAggregatorDB');


    // Schema definition - Version 15 adds conversations, chat_messages, alerts
    (this as any).version(15).stores({
      trades: '++id, ticker, date, direction, moodEntry, moodExit, setup, grade, entryTime, complianceScore',
      dividends: '++id, date, ticker',
      ipo_applications: '++id, applicantName, ipoName, status, upiHandle',
      investments: 'id, type, platform, *tags, sector, country',
      history: 'date',
      tax_records: '++id, fy',
      strategies: '++id, name',
      daily_reviews: 'date',
      life_events: '++id, date',
      paper_trades: '++id, ticker, status, date',
      beneficiaries: '++id, name',
      conversations: '++id, createdAt, updatedAt, persona',
      chat_messages: '++id, conversationId, timestamp',
      alerts: '++id, type, assetId, isActive, createdAt',
    });

    (this as any).version(16).stores({
      transactions: 'id, date, category, type, bankName'
    });

    // Version 17: Goals table for Multi-Goal Tracking
    (this as any).version(17).stores({
      goals: '++id, name, priority, category, targetDate, createdAt'
    });

    // Version 18: IPO Vault (Friends Synergy)
    (this as any).version(18).stores({
      friends: '++id, name, balance'
    });

    // Version 19: Add owner index to investments for Family Office filtering
    (this as any).version(19).stores({
      investments: 'id, type, platform, *tags, sector, country, owner'
    });

    // Version 20: Academy Persistence
    (this as any).version(20).stores({
      quiz_progress: '++id, userId, totalXP'
    });

    // Version 21: Realized Transactions (Profit Booking)
    (this as any).version(21).stores({
      realized_transactions: '++id, investmentId, type, saleDate'
    });

    // Version 22: Mirror of Truth Persistence
    (this as any).version(22).stores({
      mistakes: 'id, date, category'
    });

    // Version 23: Macro Data Cache (Master Remediation)
    (this as any).version(23).stores({
      cache: '++id, key, timestamp, ttl'
    });

    // Version 24: Missed Trades Logger
    (this as any).version(24).stores({
      missed_trades: '++id, date, ticker, reason'
    });

    // Version 25: DhanHQ Instrument Master
    (this as any).version(25).stores({
      instruments: 'securityId, symbol, name, exchangeSegment'
    });

    // Version 26: Broker cache and sync diagnostics
    (this as any).version(26).stores({
      broker_holdings_cache: '++id, broker, brokerAccountId, brokerSecurityId, tradingSymbol, fetchedAt',
      broker_positions_cache: '++id, broker, brokerAccountId, brokerSecurityId, tradingSymbol, fetchedAt',
      sync_records: 'id, scope, entityType, entityId, source, syncStatus, lastSyncedAt'
    });

    // Version 27: Mirror of Truth Rules
    (this as any).version(28).stores({
      cache: '++id, key, timestamp, ttl'
    });

    // Version 29: Agentic Intelligence Integration
    (this as any).version(29).stores({
      trades: '++id, ticker, date, direction, moodEntry, moodExit, setup, grade, entryTime, complianceScore, aiVerdict, aiConvictionScore'
    });

    // Version 30: Historical Data Vault for Backtesting
    (this as any).version(30).stores({
      historical_data: '++id, date, symbol, assetClass, timestamp'
    });

    // Version 31: Forward Duels for Human vs System paper trading
    (this as any).version(31).stores({
      forward_duels: '++id, date, systemTicker, userTicker, systemStatus, userStatus'
    });

    // Version 32: Alpha Engine persistent cache
    (this as any).version(32).stores({
      alphaSnapshots: '++id, key, cachedAt'
    });

    // Version 33 (Agent I): Index audit additions
    // - investments:  +name (used by SyndicateTracker for "IPO Gain: …" lookup)
    // - trades:       +notes (used by ShadowPortfolioService to find tagged trades)
    // - forward_duels:+systemTicker, +userTicker (used by QuantDuelService leaderboards)
    (this as any).version(33).stores({
      investments: 'id, type, platform, *tags, sector, country, owner, name',
      trades: '++id, ticker, date, direction, moodEntry, moodExit, setup, grade, entryTime, complianceScore, aiVerdict, aiConvictionScore, notes',
      forward_duels: '++id, date, systemTicker, userTicker, systemStatus, userStatus'
    });

    // Version 34: Signal Intelligence Hub tables
    (this as any).version(34).stores({
      signal_providers: '++id, name, winRate, avgRR',
      parsed_signals: '++id, instrument, provider, status, timestamp'
    });

    // Version 35: Telegram Multi-Ear Sync & Greeks
    (this as any).version(35).stores({
      telegram_messages: '++id, earId, threadId, channelName, receivedAt, isStarred',
      telegram_ear_cache: '++id, earId, lastSync',
      parsed_signals: '++id, instrument, provider, status, timestamp, expiryDate, threadId'
    });

    // Version 36: Jarvis 3.0, RAG, RL Engine
    (this as any).version(36).stores({
      jarvis_briefs: '++id, timestamp, paperTradeId',
      brain_vectors: '++id, docType, docId, timestamp',
      rl_experiences: '++id, timestamp',
      model_versions: '++id, version, timestamp, isCurrent'
    });

    // Version 37: Voice Journal Sessions
    (this as any).version(37).stores({
      voice_sessions: '++id, date, durationSeconds, dominantEmotion'
    });

    // Version 38: CC33 — Telegram Multi-Ear OCR Parser & Dhan/Upstox Signal Ledger
    // Adds the new `parsed_signal_records` ledger. Empty `.stores({})` bump so we
    // don't disturb existing tables — this version only adds the new table.
    (this as any).version(38).stores({
      parsed_signal_records: '++id, timestamp, source, status, ticker, [timestamp+status]'
    });

    // Version 39: CC39 — Momentum Pool (Pre-Market Watchlist with Auto-Verdict)
    // Three new tables: pool_items (the symbol bucket), pool_verdicts (the AI
    // output), pool_sources (the intake channels). Indexes are tuned for the
    // most common queries: status filter, ticker lookup, generatedAt sort.
    (this as any).version(39).stores({
      pool_items: '++id, ticker, exchange, status, addedAt, alertEnabled, [status+addedAt]',
      pool_verdicts: '++id, poolItemId, ticker, generatedAt, verdict, score, [poolItemId+generatedAt]',
      pool_sources: '++id, kind, handle, enabled'
    });

    // Version 40: P2 — ML Weights learning
    // Two new tables: ml_models (versioned boosters) and ml_weights (lookup-chain overrides).
    // The booster is stored as a JSON-serializable TrainedBooster in a Blob.
    (this as any).version(40).stores({
      ml_models:  '++id, version, isCurrent, regime, trainedOn',
      ml_weights: '++id, [symbolScope+regimeScope], trainedOn',
    });

    // Version 41: Phase B — per-leg trade backfill (Dhan API).
    // NEW table only — does NOT touch existing tables (db.trades is unchanged).
    // Each row = one Dhan leg (BUY or SELL of a single order). The combined
    // round-trip Trade row stays as-is; the ML Labeler can opt into legs
    // instead of combined Trades for higher-quality training data.
    (this as any).version(41).stores({
      trade_legs: '++id, date, ticker, securityId, transactionType, productType, [date+ticker], [securityId+date]'
    });

    // Version 42: First-run demo gate (Top-10 #1 from docs/UX-Audit-2026-06-19.md)
    // NEW table only — does NOT touch existing tables. Key-value shape; one row
    // per meta key. Stores durable record for: critical-path tour progress,
    // demo seed timestamps, etc. The visible-state mirror lives in
    // `store/firstRunStore.ts` (localStorage); Dexie is the durable backup so
    // we don't lose gate state when localStorage is cleared.
    (this as any).version(42).stores({
      first_run_meta: 'key'
    });

    // Version 47: Register missing mirror_rules table
    (this as any).version(47).stores({
      mirror_rules: '++id, date, isActive'
    });

    // Version 48: WealthOS ML Blueprint tables
    (this as any).version(48).stores({
      market_day_features: '++id, date, anomalyScore',
      mce_feature_history: '++id, [symbol+asOf], asOf',
      watchlist_snapshots: '++id, symbol, asOf, crossedBuyZone, [symbol+asOf]'
    });

    // Version 49: Ghost Setup Tracking & ML Calibration Candidates
    (this as any).version(49).stores({
      scan_candidates: '++id, symbol, scanTime, wasTraded, [symbol+scanTime]'
    });

    // Version 50: Register sandbox trades, snapshots, daily digest, shared journal & candle cache
    (this as any).version(50).stores({
      sandbox_trades: '++id, ticker, date, direction, moodEntry, moodExit, setup, grade, entryTime, complianceScore',
      snapshots: '++id, date, timestamp, trigger',
      daily_digest: '++id, date, generatedAt',
      shared_journal: '++id, createdAt, kind',
      candle_cache: 'key, date'
    });



    (this as any).on('populate', () => {
      this.strategies.bulkAdd([
        { name: 'Pullback', description: 'Buying the dip in an uptrend', rules: ['Trend is clearly UP', 'Price at Key Support/EMA', 'Volume declined on pullback', 'Bullish candle confirmation'] },
        { name: 'Breakout', description: 'Momentum entry above resistance', rules: ['Consolidation > 2 weeks', 'Volume spike on breakout', 'Relative Strength > Market', 'No immediate resistance overhead'] },
        { name: 'Reversal', description: 'Catching the turn', rules: ['Price at major support zone', 'RSI Divergence visible', 'Change of Character (ChoCH)', 'Stop loss below swing low'] }
      ]);
    });
  }
}

// === P2 ML Weights — added 2026-06-17 ===

export interface MlModelVersion {
  id?: number;
  version: number;
  trainedOn: number;
  hitProbModelJson: string;        // serialized TrainedBooster
  mfeMaeModelJson: string;         // serialized TrainedBooster
  valHitRate: number;
  valMfeMae: number;
  trainRows: number;
  regime: 'GLOBAL' | 'TRENDING_UP' | 'TRENDING_DOWN' | 'CHOPPY' | 'HIGH_VIX';
  isCurrent: 0 | 1;
  source: 'LEARNED' | 'DEFAULT';
  parentVersion: number | null;
}

export interface MlWeightRow {
  id?: number;
  symbolScope: 'GLOBAL' | string;
  regimeScope: 'ALL' | 'TRENDING_UP' | 'TRENDING_DOWN' | 'CHOPPY' | 'HIGH_VIX';
  weights: { htf: number; indicators: number; flow: number; regime: number; gex: number };
  fireCutoff: number;
  waitCutoff: number;
  trainedOn: number;
  trainRows: number;
  valHitRate: number;
  valMfeMae: number;
  source: 'DEFAULT' | 'LEARNED';
}

// === Phase B — Dhan per-leg trade backfill (added 2026-06-18) ===
// Mirrors Dhan's per-leg shape from GET /v2/trades/{from}/{to}/{page}.
// One row = one BUY or SELL execution leg. Used by ML Labeler when
// useLegSplitter=true to build cleaner training rows than the
// combined Trade round-trip.
export interface TradeLeg {
  id?: number;
  date: string;                    // YYYY-MM-DD (IST)
  ticker: string;                  // normalized display symbol (e.g. "RELIANCE")
  securityId: string;              // Dhan exchange ID (stable, primary key from Dhan)
  transactionType: 'BUY' | 'SELL';
  productType: string;             // MIS / CNC / MTF / NRML / MARGIN / NORMAL / INTRADAY
  exchangeSegment: string;         // NSE_EQ / NSE_FNO / BSE_EQ / NSE_CURRENCY / MCX_COMM
  tradedQuantity: number;
  tradedPrice: number;
  exchangeTime: string;            // raw Dhan timestamp string
  // Execution metadata (added Phase B.4.1)
  orderId?: string;
  exchangeOrderId?: string;
  exchangeTradeId?: string;
  orderType?: string;              // MARKET / LIMIT / STOP_LOSS / SL-M
  // Per-leg charges (sum of stt+sebi+brokerage+serviceTax+exchangeTx+stamp)
  fees?: number;
  stt?: number;
  sebiTax?: number;
  brokerageCharges?: number;
  serviceTax?: number;
  exchangeTransactionCharges?: number;
  stampDuty?: number;
  // Options metadata
  drvExpiryDate?: string;
  drvStrikePrice?: number;
  drvOptionType?: 'CE' | 'PE' | string;
  // Provenance
  importedAt: number;              // Date.now() at insert
  source: 'dhan_backfill_v1';
  rawJson?: string;                // verbatim Dhan response, for re-derivation
}

// === First-run gate (Top-10 #1 from docs/UX-Audit-2026-06-19.md) ===
// Key-value table for durable first-run state. The visible mirror lives
// in `store/firstRunStore.ts` (localStorage); Dexie is the durable
// backup so the gate state survives a localStorage clear.
export interface FirstRunMeta {
  key: string;                    // primary key, e.g. 'critical-path' | 'seeded-at'
  value: unknown;                 // JSON-serialisable
  updatedAt: string;              // ISO timestamp
}

// === A3 — Share Target API ingest (added 2026-06-20) ===
// Anything the user shares INTO the PWA that we couldn't promote to a
// trade (because OCR didn't find a signal, or the share was plain text)
// lands here. Image blobs live in the `share-inbox` Cache API; this
// row stores the lookup key + OCR text + metadata so the journal view
// can render the share contextually.
export interface SharedJournalEntry {
  id?: number;
  kind: 'shared_image' | 'shared_text';
  title?: string;
  text?: string;          // OCR'd text or shared text body
  url?: string;           // URL the user was viewing when they shared
  imageBlobId?: string;   // cache key (e.g. `share-inbox:<uuid>`); blob itself lives in Cache API
  ocrConfidence?: number; // 0..1, only for kind=shared_image
  createdAt: number;      // Date.now()
  source: 'share_target';
}

// === A4 Daily Digest ===

export type DailyDigestSentiment = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface DailyDigestRecord {
    id?: number;
    date: string;                    // 'YYYY-MM-DD' in Asia/Kolkata
    generatedAt: number;             // epoch ms
    sections: EarSummary[];          // one per ear that returned data
    combinedBrief: string;           // stitched narrative
    sentiment: DailyDigestSentiment;
    keySignals: string[];            // deduped, capped to 8
    newsHeadlines: string[];         // deduped, capped to 6
    messageCount: number;            // sum across ears (drives quiet-day)
    pushedToTelegram: boolean;       // did the DM succeed?
}

export interface SnapshotEntry {
  symbol: string;
  ltp: number;
  percentChange: number;
  volume: number;
  rvol_wholeday: number;          // vol / adv20
  rvol_timeofday: number | null;  // ToD RVOL (null if not yet fetched)
  gFactor: number;
  rFactor: number | null;
  openPrice: number;
  high: number;
  low: number;
  openingGapPct: number;
  isORBLowPreserved: boolean;
  dayExtremeScore: number;
  sector: string;
  atr: number | null;
  apexSignal: string | null;
  score?: number;
  verdict?: string;
  igsCheckCount?: number;
  igsCheckTotal?: number;
  // Stock-type classifier (docs/algo/strategy_brief.md) — frozen with the photograph
  stockType?: string;           // TYPE1_ACCUMULATOR | TYPE2_EXHAUSTION_TRAP | ... | NONE
  stockPriority?: number;       // 1 = highest (Type 1), 9 = unclassified
  stockEvidence?: Record<string, number | null>;
}

export interface SnapshotRecord {
  id?: number;
  date: string;         // 'YYYY-MM-DD' in Asia/Kolkata
  timestamp: string;    // ISO full timestamp
  trigger: 'auto_925' | 'manual_refresh' | 'eod';
  stocks: SnapshotEntry[];
}

export interface CandleCacheEntry {
  key: string;          // e.g. "2026-07-01_RELIANCE_5minute"
  date: string;         // 'YYYY-MM-DD'
  data: { ts: string; o: number; h: number; l: number; c: number; v: number }[];
  fetchedAt: number;    // Date.now()
}


export const db = new TradeDatabase();

// Re-route db.trades dynamically based on sandbox mode toggle (prevents TS class fields gotchas)
const originalTradesTable = db.table('trades');
Object.defineProperty(db, 'trades', {
  get() {
    const isSandbox = typeof window !== 'undefined' && window.localStorage.getItem('isSandboxMode') === 'true';
    if (isSandbox) {
      try {
        const sandboxTable = db.table('sandbox_trades');
        if (sandboxTable) return sandboxTable;
      } catch (e) {
        // Fallback if schema hasn't upgraded yet
      }
    }
    return originalTradesTable;
  },
  configurable: true
});

export const calculatePnL = (trade: Trade): number => {
  // If PnL is already explicitly set (manual override or imported), return it directly
  if (trade.pnl !== undefined && trade.pnl !== null) {
    return trade.pnl;
  }

  const diff = trade.exitPrice - trade.entryPrice;
  const grossPnL = trade.direction === 'Long'
    ? diff * trade.quantity
    : -diff * trade.quantity;

  return grossPnL - (trade.fees || 0);
};
