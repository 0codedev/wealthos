export function poolAlertMessage(
  ticker: string,
  kind: 'TARGET_HIT' | 'STOP_HIT' | 'VERDICT_FIRE',
  price: number,
  levels: { targetSell?: number; targetBuy?: number; stopLoss?: number }
): string {
  const formattedPrice = price.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
  
  if (kind === 'TARGET_HIT') {
    const levelStr = levels.targetSell 
      ? `Target: ₹${levels.targetSell.toLocaleString('en-IN')}` 
      : levels.targetBuy 
        ? `Target Buy: ₹${levels.targetBuy.toLocaleString('en-IN')}`
        : '';
    return `🎯 <b>TARGET HIT — ${ticker}</b>\nCMP: <b>${formattedPrice}</b> | ${levelStr}`;
  }
  
  if (kind === 'STOP_HIT') {
    const slStr = levels.stopLoss ? `SL: ₹${levels.stopLoss.toLocaleString('en-IN')}` : '';
    return `🛑 <b>STOP HIT — ${ticker}</b>\nCMP: <b>${formattedPrice}</b> | ${slStr}`;
  }
  
  return `🔥 <b>STRONG VERDICT — ${ticker}</b>\nCMP: <b>${formattedPrice}</b>`;
}
