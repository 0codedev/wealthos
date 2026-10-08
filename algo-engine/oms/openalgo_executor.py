"""
OpenAlgo Execution Bridge
Replaces the broker-specific order_manager.py.
All strategies call execute_signal(signal) and this handles the rest.
"""
import os
import datetime
import sys

# Ensure parent directory is in path for relative imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openalgo import api as OpenAlgoAPI
from journal.trade_logger import TradeLogger

# ── Configuration ────────────────────────────────────────────────────
# Load configurations, fallback to the validated local defaults
OPENALGO_API_KEY = os.getenv("OPENALGO_API_KEY", "openalgo_mcp_api_key_2026")
OPENALGO_HOST    = os.getenv("OPENALGO_HOST", "http://127.0.0.1:5000")
USE_SMART_ORDER  = os.getenv("USE_SMART_ORDER", "true").lower() == "true"

print(f"[OMS] Connecting to OpenAlgo at {OPENALGO_HOST}...")

# OpenAlgo Python SDK client
client = OpenAlgoAPI(api_key=OPENALGO_API_KEY, host=OPENALGO_HOST)
logger = TradeLogger()


import sqlite3

def _get_symbol_from_token(token: str, exchange: str = "NSE") -> str:
    """Helper to translate numeric Dhan security ID (token) to human-readable trading symbol."""
    if not token or not token.isdigit():
        return token
        
    db_path = r"c:\Users\gadda\Desktop\Projects\openalgo\db\openalgo.db"
    if not os.path.exists(db_path):
        return token
        
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        # Look up symbol from token mapping for the specific exchange
        cursor.execute("SELECT symbol FROM symtoken WHERE token = ? AND exchange = ? LIMIT 1", (token, exchange))
        row = cursor.fetchone()
        if row:
            return row[0]
        else:
            # Fallback if exchange matching fails: just get first match
            cursor.execute("SELECT symbol FROM symtoken WHERE token = ? LIMIT 1", (token,))
            row = cursor.fetchone()
            if row:
                return row[0]
    except Exception as e:
        print(f"[OMS WARNING] Failed to map token {token} to symbol: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass
    return token


def execute_signal(signal) -> dict:
    """
    Universal signal executor via OpenAlgo.
    
    Args:
        signal: A strategy signal object with fields:
            - symbol (str): e.g. "BEL"
            - exchange (str): "NSE" or "NFO"
            - direction (str): "BUY" or "SELL"
            - quantity (int): Number of shares/lots
            - price (float): 0 for MARKET, else LIMIT price
            - stop_loss (float): Stop price
            - target (float): Target price
            - strategy_name (str): e.g. "ORB_Enhanced"
            - position_size (int): Net position size for smart orders
    
    Returns:
        dict: OpenAlgo API response
    """
    # Safeguard fields: support both base_signal attributes and dictionary items
    symbol = getattr(signal, 'symbol', None)
    instrument = getattr(signal, 'instrument', '')
    exchange = getattr(signal, 'exchange', 'NSE')
    
    # Auto-translate Dhan numeric ID to symbol if symbol is empty
    if not symbol:
        symbol = _get_symbol_from_token(str(instrument), exchange)
    else:
        symbol = _get_symbol_from_token(str(symbol), exchange)
        
    direction = getattr(signal, 'direction', 'BUY')
    quantity = int(getattr(signal, 'quantity', 1))
    price = float(getattr(signal, 'price', 0))
    strategy_name = getattr(signal, 'strategy_name', 'OpenAlgo_Strategy')
    position_size = int(getattr(signal, 'position_size', quantity if direction == 'BUY' else -quantity))

    price_type = "MARKET" if price == 0 else "LIMIT"
    
    order_params = dict(
        strategy = strategy_name,
        symbol   = symbol,
        action   = direction,      # "BUY" or "SELL"
        exchange = exchange,
        price_type = price_type,
        product  = "MIS",                 # Intraday
        quantity = quantity,
    )

    if price_type == "LIMIT":
        order_params["price"] = price

    try:
        if USE_SMART_ORDER:
            # Smart order: OpenAlgo auto-manages position flips (long → short)
            order_params["position_size"] = position_size
            response = client.placesmartorder(**order_params)
        else:
            response = client.placeorder(**order_params)

        _log_trade(signal, response)
        return response

    except Exception as e:
        print(f"[OPENALGO EXECUTOR ERROR] Failed to execute order via OpenAlgo: {e}")
        return {"status": "failure", "remarks": str(e)}


def get_positions() -> list:
    """Fetch current open positions from OpenAlgo (broker-agnostic)."""
    try:
        return client.positionbook().get("data", [])
    except Exception as e:
        print(f"[POSITION FETCH ERROR] {e}")
        return []


def get_funds() -> dict:
    """Fetch available margin/funds from OpenAlgo."""
    try:
        return client.funds().get("data", {})
    except Exception as e:
        print(f"[FUNDS FETCH ERROR] {e}")
        return []


def _log_trade(signal, response: dict):
    """Write every executed signal to the trade journal."""
    status = response.get("status", "failure")
    order_id = response.get("orderid", response.get("order_id", "NONE"))
    remarks = response.get("remarks", response.get("message", ""))
    
    symbol = getattr(signal, 'symbol', None)
    if symbol is None:
        symbol = getattr(signal, 'instrument', 'UNKNOWN')
        
    direction = getattr(signal, 'direction', 'BUY')
    quantity = getattr(signal, 'quantity', 0)
    
    # Auto-translate numeric ID if needed
    symbol = _get_symbol_from_token(str(symbol), getattr(signal, 'exchange', 'NSE'))
    
    logger.log({
        "timestamp":     datetime.datetime.now().isoformat(),
        "strategy":      getattr(signal, 'strategy_name', 'OpenAlgo'),
        "instrument":    symbol,
        "symbol":        symbol,
        "direction":     direction,
        "quantity":      quantity,
        "price":         getattr(signal, 'price', 0),
        "stop_loss":     getattr(signal, 'stop_loss', 0),
        "target":        getattr(signal, 'target', 0),
        "status":        "PLACED" if status == "success" else f"FAILED: {remarks}",
        "order_id":      order_id,
        "openalgo_host": OPENALGO_HOST,
    })
    print(f"[OPENALGO ORDER PLACED] Status: {status}, OrderID: {order_id}, Remarks: {remarks}")
