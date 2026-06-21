"""
python-bridge/services/risk_manager.py — Multi-Level Institutional Risk Management Engine

Implements tiered risk controls modeled after NSE & institutional prop desk standards:
Level 1: Per-trade implied loss limit (MAX_TRADE_LOSS, default ₹2,000)
Level 2: Per-session loss limit (MAX_SESSION_LOSS, default ₹5,000)
Level 3: Daily loss limit (MAX_DAILY_LOSS_INR, default ₹10,000)
Level 4: Weekly loss limit (MAX_WEEKLY_LOSS, default ₹25,000)
Level 5: Max concurrent open positions (MAX_OPEN_POSITIONS, default 3)
Level 6: Max sector exposure limit (MAX_SECTOR_EXPOSURE, default 0.30 / 30%)
"""

import os
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Tuple

log = logging.getLogger("risk_manager")

class RiskManager:
    def __init__(self):
        self.reload_limits()

    def reload_limits(self):
        """Loads risk threshold limits from environment variables."""
        self.per_trade_max_loss = float(os.getenv("MAX_TRADE_LOSS", "2000.0"))
        self.per_session_max_loss = float(os.getenv("MAX_SESSION_LOSS", "5000.0"))
        self.per_day_max_loss = float(os.getenv("MAX_DAILY_LOSS_INR", "10000.0"))
        self.per_week_max_loss = float(os.getenv("MAX_WEEKLY_LOSS", "25000.0"))
        self.max_open_positions = int(os.getenv("MAX_OPEN_POSITIONS", "3"))
        self.max_sector_exposure = float(os.getenv("MAX_SECTOR_EXPOSURE", "0.30"))

    def _get_past_days_realized_pnl(self, days: int = 1) -> float:
        """Helper to sum closed trade PnL over past N days from SQLite autopilot_journal."""
        try:
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache.db")
            if not os.path.exists(db_path):
                db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "database.db")

            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
            cursor.execute(
                "SELECT COALESCE(SUM(pnl), 0) FROM autopilot_journal WHERE date >= ? AND status = 'CLOSED'",
                (start_date,)
            )
            row = cursor.fetchone()
            conn.close()
            return float(row[0]) if row else 0.0
        except Exception as e:
            log.error(f"[RISK] Failed to fetch PnL for past {days} days: {e}")
            return 0.0

    def gate_order(self, signal: Dict[str, Any], current_state: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Evaluates incoming signal against all multi-level risk controls atomically.
        Returns: (allowed: bool, reason: str)
        """
        self.reload_limits()

        symbol = str(signal.get("symbol", "UNKNOWN"))
        sector = str(signal.get("sector", "GENERAL"))
        ltp = float(signal.get("ltp", 100.0))
        qty = int(signal.get("quantity", 1))

        # 1. Per-trade implied loss check (2% adverse move on notional)
        implied_risk = ltp * qty * 0.02
        if implied_risk > self.per_trade_max_loss:
            reason = f"Per-trade risk ₹{implied_risk:.0f} exceeds max trade loss limit ₹{self.per_trade_max_loss:.0f}"
            log.warning(f"[RISK] 🚨 Rejecting {symbol}: {reason}")
            return False, reason

        # 2. Max open positions check
        open_count = int(current_state.get("open_positions_count", 0))
        if open_count >= self.max_open_positions:
            reason = f"Open positions ({open_count}) at max limit ({self.max_open_positions})"
            log.warning(f"[RISK] 🚨 Rejecting {symbol}: {reason}")
            return False, reason

        # 3. Sector concentration check
        sector_exposure = float(current_state.get(f"sector_{sector}_pct", 0.0))
        if sector_exposure >= self.max_sector_exposure:
            reason = f"Sector exposure for {sector} ({sector_exposure*100:.1f}%) exceeds max limit ({self.max_sector_exposure*100:.1f}%)"
            log.warning(f"[RISK] 🚨 Rejecting {symbol}: {reason}")
            return False, reason

        # 4. Daily loss check
        today_pnl = self._get_past_days_realized_pnl(days=1)
        if today_pnl < -abs(self.per_day_max_loss):
            reason = f"Daily loss limit breached (Today PnL: ₹{today_pnl:.0f}, Limit: ₹{-self.per_day_max_loss:.0f})"
            log.warning(f"[RISK] 🚨 Rejecting {symbol}: {reason}")
            return False, reason

        # 5. Weekly loss check
        week_pnl = self._get_past_days_realized_pnl(days=7)
        if week_pnl < -abs(self.per_week_max_loss):
            reason = f"Weekly loss limit breached (7-Day PnL: ₹{week_pnl:.0f}, Limit: ₹{-self.per_week_max_loss:.0f})"
            log.warning(f"[RISK] 🚨 Rejecting {symbol}: {reason}")
            return False, reason

        return True, "APPROVED"

# Global singleton instance
risk_manager = RiskManager()
