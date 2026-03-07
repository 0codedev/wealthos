import { Trade } from '../database';
import { safeAsync } from '../utils/safeAsync';

const BRIDGE_BASE = 'http://127.0.0.1:8765';

export async function syncTradeToJournedge(trade: Trade): Promise<boolean> {
  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/journal/journedge/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: String(trade.id),
        ticker: trade.ticker,
        direction: trade.direction,
        quantity: trade.quantity || 1,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        pnl: trade.pnl,
        date: new Date(trade.date).toISOString().split('T')[0],
        notes: trade.notes || '',
        tags: (trade.tags || []).join(','),
        source: 'journedge'
      })
    });
    return resp.ok;
  }, { context: 'journedge' });
  return r.ok && r.data;
}

export async function getJournedgeTrades(): Promise<any[]> {
  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/journal/journedge/trades`, {
      method: 'GET',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }, { context: 'journedge' });
  return r.ok ? r.data : [];
}
