import { SourceResult } from "./trust";

export interface MarketDiscrepancy {
  field: string;
  upstoxValue: number;
  dhanValue: number;
  delta: number; // percentage divergence (e.g. 0.005 for 0.5%)
  flaggedAt: string; // ISO timestamp
  resolved: boolean;
}

export interface MarketContextEnvelope {
  canonicalId: string;
  asOf: string; // ISO timestamp
  quote?: SourceResult<any>;
  ohlc?: SourceResult<any>;
  depth?: SourceResult<any>;
  derivatives?: SourceResult<any>;
  cvd?: SourceResult<any>;
  ownership?: SourceResult<any>;
  institutionalFlows?: SourceResult<any>;
  catalystNews?: SourceResult<any>;
  discrepancies: MarketDiscrepancy[];
  trustScore: number; // 0 to 100
}
