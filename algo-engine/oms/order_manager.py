import os
import json
import sqlite3
import datetime
import sys

# Ensure parent directory is in path for relative imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from journal.trade_logger import TradeLogger
from dhanhq import DhanContext, dhanhq

PAPER_TRADING = os.getenv("PAPER_TRADING", "true").lower() == "true"
ALGO_ID = os.getenv("ALGO_ID", "PAPER_MODE")
DHAN_CLIENT_ID = os.getenv("DHAN_CLIENT_ID")
DHAN_ACCESS_TOKEN = os.getenv("DHAN_ACCESS_TOKEN")

# Initialize the connections
dhan_context = DhanContext(DHAN_CLIENT_ID, DHAN_ACCESS_TOKEN)

# IMPORTANT: If PAPER_TRADING is enabled, direct HTTP requests to Dhan's Sandbox server
if PAPER_TRADING:
    dhan_context.dhan_http.base_url = "https://sandbox.dhan.co/v2"
    print("[OMS] Running in Dhan SANDBOX Mode (Simulated Trading)")
else:
    print("[OMS] WARNING: Running in Dhan LIVE Mode (Real Money)")

dhan = dhanhq(dhan_context)
logger = TradeLogger()

class SmartOrderRouter:
    """
    Task A2: Smart Order Router (SOR) — selects optimal exchange segment and product type.
    Priority map:
    EQUITY   -> ["NSE", "BSE"]
    FNO      -> ["NFO", "BFO"]
    CURRENCY -> ["CDS"]
    """
    SEGMENT_PRIORITY = {
        "EQUITY": ["NSE", "BSE"],
        "FNO": ["NFO", "BFO"],
        "CURRENCY": ["CDS"]
    }

    def _get_spread_from_tick_cache(self, symbol: str) -> float:
        """Reads latest ask-bid spread from tick_cache if available."""
        try:
            sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "python-bridge"))
            from services.tick_cache import get_tick
            tick = get_tick(symbol)
            if tick and "bid" in tick and "ask" in tick:
                return float(tick["ask"]) - float(tick["bid"])
        except Exception:
            pass
        return 0.05  # Default tight 5 paise spread assumption

    def route(self, instrument: str, direction: str, qty: int) -> dict:
        """Determines best exchange_segment and product_type."""
        instrument_str = str(instrument).upper()

        if any(x in instrument_str for x in ("FUT", "OPT", "NSE_FNO", "NFO")):
            segment_type = "FNO"
            exchange_segment = dhanhq.FNO
            product_type = dhanhq.MARGIN
        elif any(x in instrument_str for x in ("CDS", "USDINR")):
            segment_type = "CURRENCY"
            exchange_segment = getattr(dhanhq, "CURRENCY", dhanhq.NSE)
            product_type = dhanhq.MARGIN
        else:
            segment_type = "EQUITY"
            exchange_segment = dhanhq.NSE
            product_type = dhanhq.CNC

        spread = self._get_spread_from_tick_cache(instrument)

        return {
            "segment_type": segment_type,
            "exchange_segment": exchange_segment,
            "product_type": product_type,
            "estimated_spread": spread,
            "priority_exchanges": self.SEGMENT_PRIORITY.get(segment_type, ["NSE"])
        }

sor = SmartOrderRouter()

def record_slippage(order_id: str, signal_price: float, fill_price: float, qty: int, symbol: str = "UNKNOWN") -> dict:
    """
    Task A4: Logs trade fill slippage in basis points to SQLite DB table `slippage_log`.
    Alerts if slippage > 5 basis points (0.05%).
    Formula: slippage_bps = ((fill_price - signal_price) / signal_price) * 10000
    """
    if signal_price <= 0:
        return {"slippage_bps": 0.0, "alert": False}

    slippage_bps = round(((fill_price - signal_price) / signal_price) * 10000.0, 2)
    is_alert = abs(slippage_bps) > 5.0

    if is_alert:
        print(f"[SLIPPAGE ALERT] 🚨 High slippage on Order {order_id} ({symbol}): {slippage_bps:.1f} bps (Signal: ₹{signal_price}, Fill: ₹{fill_price})")

    try:
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "python-bridge", "cache.db")
        if not os.path.exists(db_path):
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "python-bridge", "database.db")

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS slippage_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                order_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                signal_price REAL,
                fill_price REAL,
                quantity INTEGER,
                slippage_bps REAL,
                is_alert INTEGER
            )
        """)
        cursor.execute("""
            INSERT INTO slippage_log (timestamp, order_id, symbol, signal_price, fill_price, quantity, slippage_bps, is_alert)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            datetime.datetime.now().isoformat(),
            str(order_id),
            str(symbol),
            float(signal_price),
            float(fill_price),
            int(qty),
            float(slippage_bps),
            1 if is_alert else 0
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[SLIPPAGE DB ERROR] Failed to record slippage log: {e}")

    return {"slippage_bps": slippage_bps, "alert": is_alert}

def place_order(signal):
    """Place order — sandbox mode calls sandbox.dhan.co, live mode calls api.dhan.co."""
    # Smart Order Router (SOR) segment & product determination
    route_info = sor.route(signal.instrument, signal.direction, signal.quantity)
    exchange_segment = route_info["exchange_segment"]
    product_type = route_info["product_type"]

    try:
        response = dhan.place_order(
            security_id=str(signal.instrument),
            exchange_segment=exchange_segment,
            transaction_type=signal.direction,             # BUY / SELL
            quantity=int(signal.quantity),
            order_type=dhanhq.LIMIT if float(signal.price) > 0 else dhanhq.MARKET,
            product_type=product_type,
            price=float(signal.price),
            validity=dhanhq.DAY,
            tag=str(ALGO_ID)                                # Tagged with Algo ID / Strategy
        )

        status = response.get("status", "failure")
        remarks = response.get("remarks", "")
        data = response.get("data", {}) or {}
        order_id = data.get("orderId", "NONE")

        order_record = {
            "timestamp": datetime.datetime.now().isoformat(),
            "algo_id": ALGO_ID,
            "strategy": getattr(signal, "strategy_name", "UNKNOWN"),
            "direction": signal.direction,
            "instrument": signal.instrument,
            "quantity": signal.quantity,
            "price": signal.price,
            "stop_loss": getattr(signal, "stop_loss", 0.0),
            "target": getattr(signal, "target", 0.0),
            "mode": "SANDBOX" if PAPER_TRADING else "LIVE",
            "status": "PLACED" if status == "success" else f"FAILED: {remarks}",
            "order_id": order_id,
            "sor_route": route_info["segment_type"]
        }
        logger.log(order_record)
        print(f"[{'SANDBOX' if PAPER_TRADING else 'LIVE'} ORDER PLACED] Route: {route_info['segment_type']}, Status: {status}, OrderID: {order_id}, Remarks: {remarks}")
        return response
    except Exception as e:
        print(f"[ORDER EXCEPTION] Failed to execute order: {e}")
        return {"status": "failure", "remarks": str(e)}

def confirm_order_fill(dhan_instance=None, order_id: str = None, timeout_seconds: int = 30, signal_price: float = 0.0, symbol: str = "UNKNOWN") -> dict:
    """
    Task 2C & A4: Polls Dhan order status to confirm fill execution within timeout.
    Records slippage upon fill confirmation.
    """
    import time
    if not order_id or order_id == "NONE":
        return {"confirmed": False, "status": "INVALID_ORDER_ID", "order_id": order_id}

    target_dhan = dhan_instance or dhan
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        try:
            orders = target_dhan.get_order_list()
            data = orders.get("data") if isinstance(orders, dict) else []
            if isinstance(data, list):
                for order in data:
                    if str(order.get("orderId")) == str(order_id):
                        status = str(order.get("orderStatus", "")).upper()
                        if status in ("TRADED", "FILLED"):
                            fill_price = float(order.get("tradedPrice") or order.get("price") or signal_price)
                            qty = int(order.get("quantity") or 1)
                            slippage_res = record_slippage(order_id, signal_price, fill_price, qty, symbol)
                            return {
                                "confirmed": True,
                                "status": "FILLED",
                                "order": order,
                                "slippage": slippage_res
                            }
                        elif status in ("CANCELLED", "REJECTED"):
                            return {"confirmed": False, "status": status, "order": order}
        except Exception as e:
            print(f"[OMS CONFIRM] Poll error: {e}")
        time.sleep(2)

    return {"confirmed": False, "status": "TIMEOUT", "order_id": order_id}
