
export enum InvestmentType {
  MUTUAL_FUND = 'Mutual Fund',
  DIGITAL_GOLD = 'Digital Gold',
  DIGITAL_SILVER = 'Digital Silver',
  SMALLCASE = 'Smallcase',
  STOCKS = 'Stocks',
  CRYPTO = 'Crypto',
  FD = 'Fixed Deposit',
  ETF = 'ETF',
  REAL_ESTATE = 'Real Estate',
  CASH = 'Cash/Bank',
  IPO = 'IPO',
  TRADING = 'Trading Alpha'
}

export enum RecurringFrequency {
  DAILY = 'Daily',
  MONTHLY = 'Monthly',
}

export interface RecurringConfig {
  isEnabled: boolean;
  frequency: RecurringFrequency;
  amount: number;
  sipDay?: number; // Day of month (1-31), default 5
  startDate?: string; // ISO date when SIP started
  installmentsApplied?: number; // Number of SIP installments already applied
}

export interface Investment {
  id: string;
  name: string;
  ticker?: string;
  type: InvestmentType;
  platform: string;
  createdAt?: string;
  effectiveAt?: string;
  acquiredAt?: string;
  disposedAt?: string;
  brokerUpdatedAt?: string;
  sector?: string;
  country?: string;
  tags?: string[];
  category?: 'PORTFOLIO' | 'TRADING_WALLET';
  quantity?: number;
  investedAmount: number;
  currentValue: number;
  lastUpdated: string; // ISO Date string
  recurring?: RecurringConfig;
  isHiddenFromTotals?: boolean;
  owner?: 'SELF' | 'SPOUSE' | 'HUF' | 'KIDS' | 'JOINT' | 'MOM'; // Family Office Support
  status?: 'ACTIVE' | 'ARCHIVED'; // Default 'ACTIVE'
  dhanSecurityId?: string; // Sync ID from Dhan HQ API
  broker?: 'dhan' | 'manual' | 'other';
  brokerAccountId?: string;
  brokerSecurityId?: string;
  brokerOrderId?: string;
  brokerTradeId?: string;
  source?: 'dhan' | 'manual' | 'import' | 'firebase' | 'supabase' | 'system'; // Differentiate origin
  sourceId?: string;
  syncStatus?: 'SYNCED' | 'PENDING' | 'STALE' | 'CONFLICT' | 'ERROR';
  syncChecksum?: string;
  syncVersion?: number;
  lastSyncedAt?: string;
  lastConflictAt?: string;
  encrypted?: boolean;
  reconciliationStatus?: 'MATCHED' | 'UNMATCHED' | 'ORPHANED' | 'PARTIAL' | 'ARCHIVED';
  costBasisMethod?: 'AVERAGE' | 'FIFO' | 'LIFO' | 'SPECIFIC_ID';
  cashflowType?: 'LUMPSUM' | 'SIP' | 'BROKER_IMPORT' | 'CORPORATE_ACTION' | 'MANUAL_ADJUSTMENT';
  realizedPnL?: number;
  unrealizedPnL?: number;
  // eCAS import (CC51) — additive fields, all optional, no schema migration.
  amfiCode?: string;          // 6-digit AMFI scheme code
  folio?: string;              // AMC folio number
  ecasImportMeta?: {           // Provenance trail for eCAS-imported holdings
    importedAt: string;        // ISO timestamp
    statementDate: string;     // ISO date from the eCAS
    source: 'eCAS';
    investorPAN: string;       // masked, last 4 only (e.g. "XXXX1234")
  };
}

export interface Holding extends Investment {
  brokerPositionType?: 'DELIVERY' | 'INTRADAY' | 'MTF' | 'MARGIN';
}

export interface Position {
  id: string;
  broker: string;
  brokerAccountId?: string;
  brokerSecurityId: string;
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  productType?: string;
  positionType?: string;
  realizedPnL?: number;
  unrealizedPnL?: number;
  fetchedAt: string;
}

export interface BrokerOrder {
  id: string;
  broker: string;
  brokerOrderId: string;
  brokerAccountId?: string;
  brokerSecurityId?: string;
  ticker: string;
  transactionType: 'BUY' | 'SELL';
  orderType: string;
  quantity: number;
  price: number;
  status: string;
  placedAt: string;
}

export interface BrokerTrade {
  id: string;
  broker: string;
  brokerTradeId: string;
  brokerOrderId?: string;
  brokerAccountId?: string;
  brokerSecurityId?: string;
  ticker: string;
  transactionType: 'BUY' | 'SELL';
  quantity: number;
  tradedPrice: number;
  tradedAt: string;
  fees?: number;
  taxes?: number;
  productType?: string;
  importConfidence?: number;
}

export interface Cashflow {
  id: string;
  investmentId?: string;
  date: string;
  amount: number;
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'SIP' | 'FEE' | 'TAX' | 'ADJUSTMENT';
  source?: string;
}

export interface PortfolioSnapshot {
  asOf: string;
  totalAssets: number;
  totalLiability: number;
  totalInvested: number;
  totalCurrent: number;
  totalGain: number;
  totalGainPercent: string;
}

export interface SyncRecord {
  id: string;
  entityType: string;
  entityId: string;
  source: string;
  sourceId?: string;
  syncStatus: 'SYNCED' | 'PENDING' | 'STALE' | 'CONFLICT' | 'ERROR';
  syncVersion: number;
  lastSyncedAt: string;
  lastConflictAt?: string;
}

export interface AIContextPolicy {
  includeAbsoluteValues: boolean;
  includeHoldings: boolean;
  includeAllocationBreakdown: boolean;
  includeSensitiveBrokerFields: boolean;
}

export interface HistoryEntry {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface AggregatedData {
  name: string;
  value: number;
  color?: string;
  [key: string]: unknown;
}

export const CHART_COLORS = [
  '#4f46e5', // Indigo
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#64748b', // Slate
];

export const ASSET_CLASS_COLORS: Record<string, string> = {
  'Equity & Related': '#4f46e5',
  'Commodities': '#f59e0b',
  'Crypto': '#8b5cf6',
  'Fixed Income': '#10b981',
  'Real Estate': '#ec4899',
  'Other': '#64748b',
};
export interface PortfolioStats {
  totalValue: number;
  totalCurrent: number;
  totalInvested: number;
  totalAssets: number;
  totalGain: number;
  totalPL: number;
  totalGainPercent: string;
  totalPLPercent: string;
  dayChange: number;
  dayChangePercent: number;
  diversityScore: number;
  topAsset: { name: string; percent: number };
  totalLiability?: number;
  byCategory?: Record<string, number>;
}

export type MarketStatus = 'NORMAL' | 'EUPHORIA' | 'FEAR' | 'CRASH';

// ============================================================
// TIER 3 TYPES (Features 11, 12, 13)
// ============================================================

export interface FactorExposure {
  ticker: string;
  alpha: number;         // Jensen's alpha (annualized %)
  beta: number;          // Market beta
  smbLoading: number;    // Size factor loading
  hmlLoading: number;    // Value factor loading
  rSquared: number;      // Regression fit quality 0-1
  volatility: number;    // Annualized std dev
  sharpe: number;        // Sharpe ratio
}

export interface CorrelationMatrix {
  tickers: string[];
  matrix: number[][];    // Symmetric [n×n] matrix of -1 to +1 values
}

export interface DNAReport {
  generatedAt: string;
  factorExposures: FactorExposure[];
  correlationMatrix: CorrelationMatrix;
  concentrationScore: number;  // 0-100 (100 = dangerously concentrated)
  diversificationScore: number;  // 0-100
  riskInsights: string[];      // NL sentences
}

// ============================================================
// CC30 — Portfolio DNA, Factor Attribution & Smart Rebalancing
// ============================================================

/** Result of a 4-factor OLS regression. */
export interface MultiFactorResult {
  alpha: number;        // Daily Jensen alpha (intercept)
  betaMarket: number;   // Factor loading on Mkt-Rf
  betaSMB: number;      // Size factor loading
  betaHML: number;      // Value factor loading
  betaMOM: number;      // Momentum factor loading
  rSquared: number;     // 0-1 model fit
  adjRSquared: number;  // Adjusted R²
  residualStd: number;  // Standard error of regression
  warning?: string;     // Set if insufficient samples (CAPM fallback)
}

/** A point on the Markowitz efficient frontier. */
export interface FrontierPoint {
  variance: number;     // Annualized portfolio variance
  volatility: number;   // Annualized σ
  expectedReturn: number; // Annualized μ
  sharpe: number;       // Sharpe ratio
  weights: number[];    // Weight per ticker
}

/** Tax-aware lot recommendation. */
export interface LotRecommendation {
  ticker: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  weightChange: number; // pp delta (e.g., +5 means add 5%)
  lots: number;         // Number of share units to trade
  taxImpact: number;    // Estimated tax ₹ (negative = credit)
  sharpeImpact: number; // Estimated ΔSharpe
  rationale: string;
}

export type RiskProfile = 'conservative' | 'balanced' | 'aggressive';

export interface RebalancePlan {
  profile: RiskProfile;
  recommendations: LotRecommendation[];
  expectedSharpe: number;
  expectedVolatility: number;
  expectedBeta: number;
  targetVolatility: number;
  generatedAt: string;
}

export interface HarvestOpportunity {
  investmentId: string;
  ticker: string;
  assetType: string;
  unrealizedLoss: number;          // negative value (₹)
  taxSaving: number;               // positive value (₹)
  gainType: 'STCG' | 'LTCG';
  taxSection: string;
  suggestedReplacement: string;    // ETF/fund name
  replacementRationale: string;
  lockInPeriod: number;            // days before buyback
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface HarvestPlan {
  totalTaxSaving: number;
  opportunities: HarvestOpportunity[];
  warnings: string[];              // e.g., wash sale warning
  generatedAt: string;
}

export enum MacroRegime {
  RISK_ON = 'RISK_ON',
  RISK_OFF = 'RISK_OFF',
  STAGFLATION = 'STAGFLATION',
  REFLATION = 'REFLATION',
  DEFLATION = 'DEFLATION',
  GOLDILOCKS = 'GOLDILOCKS'
}

export interface RegimeConfig {
  name: string;
  color: string;
  icon: string;
  description: string;
  preferredSetups: string[];
}

