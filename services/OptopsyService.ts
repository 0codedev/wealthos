import { safeAsync } from '../utils/safeAsync';

const BRIDGE_BASE = 'http://127.0.0.1:8765';

export interface OptionLeg {
  strike: number;
  type: 'CE' | 'PE';
  action: 'BUY' | 'SELL';
  premium: number;
  quantity?: number;
}

export interface OptopsyResponse {
  symbol: string;
  underlying_spot: number;
  net_premium: number;
  strategy_type: 'Debit' | 'Credit';
  max_profit: number | 'Unlimited';
  max_loss: number | 'Unlimited';
  break_evens: number[];
  payoff_curve: Array<{ spot: number; pnl: number }>;
  status: string;
}

export async function runOptionsBacktest(
  symbol: string,
  spotPrice: number,
  legs: OptionLeg[]
): Promise<OptopsyResponse> {
  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/backtest/optopsy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        spot_price: spotPrice,
        legs: legs.map(l => ({ ...l, quantity: l.quantity ?? 1 }))
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as OptopsyResponse;
  }, { context: 'optopsy' });
  if (!r.ok) throw r.error;
  return r.data;
}
