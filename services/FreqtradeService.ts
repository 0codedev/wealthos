import { safeAsync } from '../utils/safeAsync';

const BRIDGE_BASE = 'http://127.0.0.1:8765';

export interface FreqtradeStatusResponse {
  status: 'online' | 'offline';
  bot_status: string;
  open_trades: any[];
  fallback_mock_trades?: any[];
  message?: string;
  source: string;
}

export async function getFreqtradeStatus(): Promise<FreqtradeStatusResponse> {
  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/crypto/freqtrade/status`, {
      method: 'GET',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as FreqtradeStatusResponse;
  }, { context: 'freqtrade' });
  if (!r.ok) throw r.error;
  return r.data;
}
