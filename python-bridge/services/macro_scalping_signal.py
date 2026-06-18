"""
macro_scalping_signal.py
Detects macroeconomic event breakouts (like CPI, FOMC) and generates
Phase 2 pullback entry signals for high-frequency scalping.
"""
import logging
from datetime import datetime

log = logging.getLogger("macro_scalping_signal")

def generate_scalping_signal(symbol: str, current_price: float, event_name: str, pre_event_price: float) -> dict:
    """
    Evaluates macro breakout phases and returns a trade recommendation.
    
    Phases:
    - Phase 1: Immediate spike (>1% move from pre-event price within 30s)
    - Phase 2: Pulback consolidation (re-entry near support / 5-min EMA)
    - Phase 3: Trend continuation
    """
    symbol = symbol.upper()
    change_pct = ((current_price - pre_event_price) / pre_event_price) * 100
    abs_change = abs(change_pct)
    
    verdict = "WAIT"
    entry_price = 0.0
    stop_loss = 0.0
    target_price = 0.0
    rationale = "No significant macro volatility detected yet."
    
    if abs_change >= 0.8:
        # Volatile move detected (Phase 1 or Phase 2)
        direction = "Long" if change_pct > 0 else "Short"
        
        # Pullback Zone is calculated as a 30-50% retracement of the spike move
        pullback_pct = 0.40
        spike_size = current_price - pre_event_price
        
        if direction == "Long":
            # Pullback target price
            entry_price = round(current_price - (spike_size * pullback_pct), 2)
            stop_loss = round(pre_event_price - (pre_event_price * 0.002), 2)  # 0.2% below pre-event consolidation
            target_price = round(current_price + (spike_size * 0.5), 2)  # 1.5x extension
            
            # If current price is close to the entry pullback zone, trigger buy
            if current_price <= entry_price * 1.01 and current_price >= entry_price * 0.995:
                verdict = "BUY"
                rationale = f"Phase 2 Pullback entry detected for {symbol} near support at {entry_price} after +{abs_change:.2f}% CPI spike."
            else:
                verdict = "MONITOR"
                rationale = f"Spike detected (+{abs_change:.2f}%). Waiting for pullback consolidation near {entry_price} before entry."
        else:
            # Short side
            entry_price = round(current_price - (spike_size * pullback_pct), 2)
            stop_loss = round(pre_event_price + (pre_event_price * 0.002), 2)
            target_price = round(current_price + (spike_size * 0.5), 2)
            
            if current_price >= entry_price * 0.99 and current_price <= entry_price * 1.005:
                verdict = "SELL"
                rationale = f"Phase 2 Short Pullback entry detected for {symbol} near resistance at {entry_price} after -{abs_change:.2f}% spike."
            else:
                verdict = "MONITOR"
                rationale = f"Downside spike detected (-{abs_change:.2f}%). Waiting for upward pullback near {entry_price} before short entry."
                
    return {
        "status": "success",
        "symbol": symbol,
        "current_price": current_price,
        "pre_event_price": pre_event_price,
        "event": event_name,
        "change_pct": round(change_pct, 2),
        "verdict": verdict,
        "suggested_entry": entry_price,
        "stop_loss": stop_loss,
        "target": target_price,
        "rationale": rationale,
        "timestamp": datetime.now().isoformat()
    }
