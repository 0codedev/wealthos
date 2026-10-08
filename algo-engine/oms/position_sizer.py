"""
algo-engine/oms/position_sizer.py — Kelly Criterion & Volatility-Adjusted Position Sizing Engine

Calculates optimal position sizing using half-Kelly Criterion and India VIX volatility scaling.
Reads historical trade statistics from SQLite autopilot_journal (last 30 closed trades).
Controlled by feature flag USE_KELLY_SIZING (default: "false").
"""

import os
import sqlite3
import numpy as np
import logging
from typing import Dict, Any, Tuple

log = logging.getLogger("position_sizer")

def kelly_fraction(win_rate: float, avg_win: float, avg_loss: float) -> float:
    """
    Computes full Kelly fraction and applies a 0.5x half-Kelly multiplier for risk safety.
    Caps max capital allocation per trade at 20% (0.20).
    """
    if avg_loss <= 0 or avg_win <= 0 or win_rate <= 0:
        return 0.05  # Default conservative 5% allocation

    b = avg_win / avg_loss
    p = win_rate
    q = 1.0 - p

    full_kelly = (b * p - q) / b
    if full_kelly <= 0:
        return 0.02  # Minimum 2% probe sizing on low/negative edge

    # Half-Kelly for capital preservation + cap at 20%
    half_kelly = full_kelly * 0.5
    return float(np.clip(half_kelly, 0.02, 0.20))

def size_from_kelly(capital: float, win_rate: float, avg_win: float, avg_loss: float, price: float) -> int:
    """
    Calculates integer share/contract quantity based on Kelly allocation fraction.
    Guarantees at least 1 share/lot minimum.
    """
    if price <= 0 or capital <= 0:
        return 1

    fraction = kelly_fraction(win_rate, avg_win, avg_loss)
    notional_capital = capital * fraction
    qty = int(notional_capital / price)
    return max(1, qty)

def volatility_adjusted_qty(base_qty: int, current_vix: float, baseline_vix: float = 15.0) -> int:
    """
    Scales down position quantity when India VIX is elevated.
    Formula: multiplier = min(1.0, sqrt(baseline_vix / current_vix))
    Example: VIX=25 → multiplier=0.77 → 10 contracts become 7 contracts.
    """
    if current_vix <= 0 or base_qty <= 0:
        return max(1, base_qty)

    multiplier = min(1.0, (baseline_vix / current_vix) ** 0.5)
    adjusted_qty = int(base_qty * multiplier)
    return max(1, adjusted_qty)

def get_historical_trade_stats(lookback_trades: int = 30) -> Dict[str, float]:
    """
    Reads past N closed trades from autopilot_journal to calculate win_rate, avg_win, avg_loss.
    """
    default_stats = {"win_rate": 0.55, "avg_win": 1500.0, "avg_loss": 1000.0}
    try:
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "python-bridge", "cache.db")
        if not os.path.exists(db_path):
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "python-bridge", "database.db")

        if not os.path.exists(db_path):
            return default_stats

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT pnl FROM autopilot_journal WHERE status = 'CLOSED' AND pnl IS NOT NULL ORDER BY id DESC LIMIT ?",
            (lookback_trades,)
        )
        rows = cursor.fetchall()
        conn.close()

        if not rows:
            return default_stats

        pnls = [float(r[0]) for r in rows]
        wins = [p for p in pnls if p > 0]
        losses = [abs(p) for p in pnls if p < 0]

        win_rate = len(wins) / len(pnls) if pnls else 0.55
        avg_win = float(np.mean(wins)) if wins else 1500.0
        avg_loss = float(np.mean(losses)) if losses else 1000.0

        return {
            "win_rate": round(win_rate, 4),
            "avg_win": round(avg_win, 2),
            "avg_loss": round(avg_loss, 2),
            "sample_trades": len(pnls)
        }
    except Exception as e:
        log.error(f"[KELLY SIZER] Error reading historical trade stats: {e}")
        return default_stats

def compute_dynamic_position_size(capital: float, price: float, current_vix: float = 15.0) -> Tuple[int, Dict[str, Any]]:
    """
    Master function: Computes final trade quantity applying Kelly + VIX adjustment.
    Respects USE_KELLY_SIZING environment variable feature flag.
    """
    use_kelly = os.getenv("USE_KELLY_SIZING", "false").lower() in ("true", "1", "yes")
    stats = get_historical_trade_stats()

    base_qty = size_from_kelly(
        capital=capital,
        win_rate=stats["win_rate"],
        avg_win=stats["avg_win"],
        avg_loss=stats["avg_loss"],
        price=price
    )

    final_qty = volatility_adjusted_qty(base_qty, current_vix)

    details = {
        "use_kelly_sizing": use_kelly,
        "base_kelly_qty": base_qty,
        "final_vix_adj_qty": final_qty,
        "kelly_fraction": kelly_fraction(stats["win_rate"], stats["avg_win"], stats["avg_loss"]),
        "vix_multiplier": round(min(1.0, (15.0 / current_vix) ** 0.5), 3) if current_vix > 0 else 1.0,
        "stats": stats
    }

    log.info(f"[KELLY SIZER] Sizing computed: price=₹{price}, capital=₹{capital:.0f} → base={base_qty}, final={final_qty} (vix={current_vix})")
    return final_qty, details
