"""
Cash Engine 2.0 - Headless Liquid Cash Market Daemon
=====================================================
Ingests ~660 liquid NSE Cash equities using Upstox 500-symbol batching.
Computes real-time market physics:
  - Live VWAP (average_price)
  - Live HOD Proximity (Anti-Dump Shield)
  - Live Depth Asymmetry Index (DAI) & Depth Pressure
  - 20-Day RVOL Pacing
  - True Circuit Band & Runway
Emits data/cash_snapshot.json for sub-30ms frontend hydration.
"""

import os
import sys
import time
import json
import asyncio
from datetime import datetime, timezone, timedelta

# Ensure python-bridge root is in path
BRIDGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BRIDGE_ROOT not in sys.path:
    sys.path.append(BRIDGE_ROOT)

from logger import get_logger
log = get_logger("cash_daemon", tag="CASH_DAEMON")

import db
from routers.shared import upstox_client

SNAPSHOT_FILE = os.path.join(BRIDGE_ROOT, "data", "cash_snapshot.json")
STATUS_FILE = os.path.join(BRIDGE_ROOT, "data", "cash_daemon_status.json")

def get_ist_now() -> datetime:
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist)

def is_market_open(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    market_open = now.replace(hour=9, minute=15, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=30, second=0, microsecond=0)
    return market_open <= now <= market_close

class CashDaemon:
    def __init__(self, cadence_seconds: int = 15):
        self.cadence_seconds = cadence_seconds
        self._running = False
        self._stop_event = asyncio.Event()

    def generate_snapshot(self) -> dict:
        """Fetches full quotes for liquid universe (~660 stocks) and returns processed snapshot"""
        start_time = time.time()
        universe = db.get_liquid_cash_universe()
        if not universe:
            log.warning("No liquid cash universe symbols found in db.")
            return {"status": "error", "message": "Liquid universe empty", "stocks": []}

        # Build instrument key map and symbol list
        key_to_meta = {}
        all_keys = []
        for item in universe:
            key = item.get("instrument_key")
            if key:
                all_keys.append(key)
                key_to_meta[key] = item
                # Also index with normalized colon/pipe
                norm_pipe = key.replace(":", "|")
                norm_colon = key.replace("|", ":")
                key_to_meta[norm_pipe] = item
                key_to_meta[norm_colon] = item

        # Upstox get_full_quotes chunks automatically into 500-key requests
        try:
            raw_quotes = upstox_client.get_full_quotes(all_keys)
        except Exception as e:
            log.error(f"Error fetching full quotes from Upstox: {e}")
            raw_quotes = {}

        processed_stocks = []
        volume_averages = {}

        if not raw_quotes:
            log.warning("Upstox raw quotes empty (token may need refresh). Populating baseline universe from metadata.")
            for item in universe:
                sym = item.get("symbol")
                adv_20d = float(item.get("adv_20d", 0))
                sec = item.get("sector", "CASH_ALPHA")
                ikey = item.get("instrument_key", "")
                if sym:
                    volume_averages[sym] = adv_20d
                    processed_stocks.append({
                        "symbol": sym,
                        "sector": sec,
                        "instrument_key": ikey,
                        "lastPrice": 0.0,
                        "openPrice": 0.0,
                        "high": 0.0,
                        "low": 0.0,
                        "close": 0.0,
                        "volume": 0,
                        "percentChange": 0.0,
                        "average_price": 0.0,
                        "vwap": 0.0,
                        "vwap_dist_pct": 0.0,
                        "is_above_vwap": True,
                        "hod_proximity": 1.0,
                        "is_hod_retaining": True,
                        "adv": adv_20d,
                        "rvol": 1.0,
                        "upper_circuit_limit": 0.0,
                        "lower_circuit_limit": 0.0,
                        "room_to_uc": 20.0,
                        "dai": 1.0,
                        "depth_pressure": "NEUTRAL",
                        "total_buy_quantity": 0,
                        "total_sell_quantity": 0,
                        "updated_at": datetime.now().isoformat()
                    })

        for key, quote in raw_quotes.items():
            if not isinstance(quote, dict):
                continue

            meta = key_to_meta.get(key)
            if not meta:
                # Try colon or pipe variant
                alt_key = key.replace(":", "|") if ":" in key else key.replace("|", ":")
                meta = key_to_meta.get(alt_key)

            sym = meta.get("symbol") if meta else quote.get("symbol")
            if not sym:
                continue

            sector = meta.get("sector", "CASH_ALPHA") if meta else "CASH_ALPHA"
            adv_20d = float(meta.get("adv_20d", 0)) if meta else 0.0

            ohlc = quote.get("ohlc", {}) or {}
            open_p = float(ohlc.get("open", 0.0) or 0.0)
            high_p = float(ohlc.get("high", 0.0) or 0.0)
            low_p = float(ohlc.get("low", 0.0) or 0.0)
            close_p = float(ohlc.get("close", 0.0) or 0.0)
            ltp = float(quote.get("last_price", 0.0) or 0.0)
            vol = int(quote.get("volume", 0) or 0)
            avg_p = float(quote.get("average_price", 0.0) or 0.0)

            uc_limit = float(quote.get("upper_circuit_limit", 0.0) or 0.0)
            lc_limit = float(quote.get("lower_circuit_limit", 0.0) or 0.0)

            # Net change calculation
            net_change = float(quote.get("net_change", 0.0) or 0.0)
            pct_change = ((ltp - close_p) / close_p * 100) if close_p > 0 else 0.0

            # RVOL
            rvol = round(vol / adv_20d, 2) if adv_20d > 0 else 1.0

            # Live HOD Retention
            hod_proximity = round((ltp / high_p), 4) if high_p > 0 else 1.0
            is_hod_retaining = (ltp >= high_p * 0.985) if high_p > 0 else True

            # Live VWAP Defense
            vwap = avg_p if avg_p > 0 else ltp
            is_above_vwap = (ltp >= vwap) if vwap > 0 else True
            vwap_dist = round(((ltp - vwap) / vwap * 100), 2) if vwap > 0 else 0.0

            # Room to Upper Circuit
            room_to_uc = round(((uc_limit - ltp) / ltp * 100), 2) if (uc_limit > 0 and ltp > 0) else 15.0

            # Gap, Day Extreme & Retest Runway calculations
            opening_gap_pct = round(((open_p - close_p) / close_p * 100), 2) if close_p > 0 else 0.0
            day_range = high_p - low_p
            day_extreme = round(((ltp - low_p) / day_range), 2) if day_range > 0 else 0.5
            upper_wick = high_p - max(open_p, ltp)
            upper_wick_ratio = round((upper_wick / day_range * 100), 1) if day_range > 0 else 0.0
            retest_runway = round(((high_p - ltp) / ltp * 100), 2) if (high_p > ltp and ltp > 0) else 0.0
            is_exhaustion_risk = rvol >= 6.0 or (opening_gap_pct >= 4.5 and hod_proximity < 0.95)

            # Depth metrics
            dai = quote.get("dai", 1.0)
            depth_pressure = quote.get("depth_pressure", "NEUTRAL")
            total_buy = quote.get("total_buy_quantity", 0)
            total_sell = quote.get("total_sell_quantity", 0)

            stock_payload = {
                "symbol": sym,
                "sector": sector,
                "instrument_key": key,
                "lastPrice": ltp,
                "openPrice": open_p,
                "high": high_p,
                "low": low_p,
                "close": close_p,
                "volume": vol,
                "percentChange": round(pct_change, 2),
                "opening_gap_pct": opening_gap_pct,
                "day_extreme": day_extreme,
                "upper_wick_ratio": upper_wick_ratio,
                "retest_runway": retest_runway,
                "is_exhaustion_risk": is_exhaustion_risk,
                "average_price": vwap,
                "vwap": vwap,
                "vwap_dist_pct": vwap_dist,
                "is_above_vwap": is_above_vwap,
                "hod_proximity": hod_proximity,
                "is_hod_retaining": is_hod_retaining,
                "adv": adv_20d,
                "rvol": rvol,
                "upper_circuit_limit": uc_limit,
                "lower_circuit_limit": lc_limit,
                "room_to_uc": room_to_uc,
                "dai": dai,
                "depth_pressure": depth_pressure,
                "total_buy_quantity": total_buy,
                "total_sell_quantity": total_sell,
                "updated_at": datetime.now().isoformat()
            }

            processed_stocks.append(stock_payload)
            if adv_20d > 0:
                volume_averages[sym] = adv_20d

        elapsed = round(time.time() - start_time, 2)
        snapshot = {
            "status": "success",
            "timestamp": datetime.now().isoformat(),
            "count": len(processed_stocks),
            "elapsed_seconds": elapsed,
            "stocks": processed_stocks,
            "volume_averages": volume_averages
        }

        # Atomically write to snapshot file
        temp_file = SNAPSHOT_FILE + ".tmp"
        try:
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(snapshot, f)
            os.replace(temp_file, SNAPSHOT_FILE)
            log.info(f"Generated cash snapshot: {len(processed_stocks)} stocks in {elapsed}s")
        except Exception as e:
            log.error(f"Failed to write cash_snapshot.json: {e}")

        # Update daemon status
        status = {
            "last_cycle_time": datetime.now().isoformat(),
            "stocks_processed": len(processed_stocks),
            "elapsed_seconds": elapsed,
            "is_running": self._running
        }
        try:
            with open(STATUS_FILE, "w", encoding="utf-8") as f:
                json.dump(status, f, indent=2)
        except Exception:
            pass

        return snapshot

    async def run_forever(self):
        self._running = True
        log.info(f"Starting CashDaemon loop (cadence: {self.cadence_seconds}s)")
        while self._running:
            try:
                now = get_ist_now()
                # Run snapshot generation during market hours (or initial cycle)
                self.generate_snapshot()
            except Exception as e:
                log.error(f"Error in CashDaemon cycle: {e}")

            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.cadence_seconds)
            except asyncio.TimeoutError:
                pass

    def stop(self):
        self._running = False
        self._stop_event.set()

_daemon_instance = None

def get_cash_daemon() -> CashDaemon:
    global _daemon_instance
    if _daemon_instance is None:
        _daemon_instance = CashDaemon()
    return _daemon_instance

if __name__ == "__main__":
    daemon = get_cash_daemon()
    snap = daemon.generate_snapshot()
    print(f"Manual snapshot generated: {snap.get('count', 0)} stocks in {snap.get('elapsed_seconds', 0)}s.")
