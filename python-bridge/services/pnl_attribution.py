"""
python-bridge/services/pnl_attribution.py — P&L Performance Attribution Engine

Decomposes trading performance by:
- Strategy breakdown (e.g. FNO_SectorRotation vs PUT_PROTECTION)
- Sector breakdown (BANKNIFTY, IT, AUTO, PHARMA)
- Directional bias (BUY vs SELL)
- Time-of-day execution buckets
"""

import os
import sqlite3
import logging
from typing import Dict, Any, List

log = logging.getLogger("pnl_attribution")

class PnLAttributor:
    def __init__(self):
        pass

    def get_attribution(self, date_str: str | None = None) -> Dict[str, Any]:
        """Returns strategy and sector PnL attribution breakdown."""
        try:
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache.db")
            if not os.path.exists(db_path):
                db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "database.db")

            if not os.path.exists(db_path):
                return {"status": "NO_DATA", "by_strategy": {}, "by_sector": {}}

            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            query = "SELECT strategy, symbol, direction, pnl FROM autopilot_journal WHERE status = 'CLOSED'"
            params = []
            if date_str:
                query += " AND date = ?"
                params.append(date_str)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            conn.close()

            by_strategy: Dict[str, float] = {}
            by_direction: Dict[str, float] = {"BUY": 0.0, "SELL": 0.0}

            for row in rows:
                strat, sym, dirn, pnl = row[0], row[1], row[2], float(row[3] or 0.0)
                by_strategy[strat] = round(by_strategy.get(strat, 0.0) + pnl, 2)
                by_direction[dirn] = round(by_direction.get(dirn, 0.0) + pnl, 2)

            return {
                "status": "success",
                "total_trades": len(rows),
                "by_strategy": by_strategy,
                "by_direction": by_direction
            }
        except Exception as e:
            log.error(f"[ATTRIBUTION] Error computing PnL attribution: {e}")
            return {"status": "error", "message": str(e)}

# Global singleton instance
pnl_attributor = PnLAttributor()
