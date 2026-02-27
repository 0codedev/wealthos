import { safeAsync } from '../utils/safeAsync';

const BRIDGE_BASE = 'http://127.0.0.1:8765';

export interface HedgeLeg {
  leg_type: string;
  strike: number;
  option_type: 'CE' | 'PE';
  action: 'BUY' | 'SELL';
  rationale: string;
}

export interface AutoHedgeResponse {
  symbol: string;
  spot_price: number;
  position_type: 'LONG' | 'SHORT';
  hedging_verdict: 'RECOMMENDED' | 'NO_ACTION';
  recommended_legs: HedgeLeg[];
  status: string;
  agent_consensus: Record<string, string>;
}

export async function runHedgeRecommendation(
  symbol: string,
  spotPrice: number,
  positionType: 'LONG' | 'SHORT' = 'LONG'
): Promise<AutoHedgeResponse> {
  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/swarm/hedge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        spot_price: spotPrice,
        position_type: positionType
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as AutoHedgeResponse;
  }, { context: 'autohedge' });
  if (!r.ok) throw r.error;
  return r.data;
}
