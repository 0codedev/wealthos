"""
nse_provider.py
Thin adapter around nsepython for use as Tier-3 market data fallback.
Handles all session/cookie management automatically via nsepython.
"""
import logging
from typing import Optional

log = logging.getLogger("nse_provider")

def get_quote(symbol: str) -> Optional[dict]:
    """Fetch live NSE quote for an equity symbol."""
    try:
        from nsepython import nse_quote_meta
        data = nse_quote_meta(symbol, "equity", "info")
        if not data:
            return None
        return {
            "symbol": symbol,
            "ltp": data.get("lastPrice"),
            "open": data.get("open"),
            "high": data.get("dayHigh"),
            "low": data.get("dayLow"),
            "close": data.get("previousClose"),
            "change": data.get("change"),
            "pChange": data.get("pChange"),
            "totalBuyQty": data.get("totalBuyQuantity"),
            "totalSellQty": data.get("totalSellQuantity"),
            "volume": data.get("totalTradedVolume"),
            "source": "nsepython"
        }
    except Exception as e:
        log.warning(f"nsepython quote failed for {symbol}: {e}")
        return None


def get_option_chain(symbol: str) -> Optional[dict]:
    """Fetch full NSE option chain for an index or F&O stock."""
    try:
        from nsepython import nse_optionchain_scripmaster
        chain = nse_optionchain_scripmaster(symbol)
        return {"symbol": symbol, "chain": chain, "source": "nsepython"}
    except Exception as e:
        log.warning(f"nsepython option chain failed for {symbol}: {e}")
        return None


def get_fii_dii() -> Optional[dict]:
    """Fetch FII/DII buy-sell activity for today."""
    try:
        from nsepython import fii_dii_data
        return {"data": fii_dii_data(), "source": "nsepython"}
    except Exception as e:
        log.warning(f"nsepython FII/DII failed: {e}")
        return None


def get_india_vix() -> Optional[float]:
    """Fetch India VIX current value."""
    try:
        from nsepython import nse_quote_meta
        data = nse_quote_meta("INDIA VIX", "equity", "info")
        return data.get("lastPrice") if data else None
    except Exception as e:
        log.warning(f"nsepython VIX failed: {e}")
        return None
