import logging
from typing import Optional

log = logging.getLogger("crypto_provider")

def get_crypto_price(exchange_id: str, symbol: str) -> Optional[dict]:
    """Fetch live ticker data using CCXT unified API."""
    try:
        import ccxt
        exchange_class = getattr(ccxt, exchange_id.lower())
        exchange = exchange_class()
        ticker = exchange.fetch_ticker(symbol.upper())
        if not ticker:
            return None
        return {
            "symbol": symbol,
            "exchange": exchange_id,
            "ask": ticker.get("ask"),
            "bid": ticker.get("bid"),
            "last": ticker.get("last"),
            "volume": ticker.get("baseVolume"),
            "change": ticker.get("change"),
            "percentage": ticker.get("percentage"),
            "source": "ccxt"
        }
    except Exception as e:
        log.error(f"CCXT price fetch failed for {symbol} on {exchange_id}: {e}")
        return None
