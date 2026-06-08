"""router/crypto.py — CoinGecko free public prices for crypto holdings.

GET /api/crypto/price?ids=bitcoin,ethereum&vs=inr   → {bitcoin: {inr: ...}, ...}
GET /api/crypto/list                               → top 250 by market cap (for symbol picker)

CoinGecko free tier: 15–30 calls/min (verified 2026-06-15). Caches 60s.
"""
import os
import sys
import time
from typing import Dict, Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, HTTPException, Query

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

router = APIRouter(prefix="/api/crypto", tags=["crypto"])

_COINGECKO_BASE = "https://api.coingecko.com/api/v3"

# In-memory cache: key=(sorted_ids|vs) → {prices, ts}
_PRICE_CACHE: Dict[str, Dict[str, Any]] = {}
_PRICE_TTL_SEC = 60  # CoinGecko free tier: stay well under 30/min

# Symbol → CoinGecko id. Picked the most common retail symbols.
_COMMON_IDS = [
    "bitcoin", "ethereum", "tether", "binancecoin", "solana",
    "ripple", "cardano", "dogecoin", "tron", "polkadot",
    "polygon", "litecoin", "chainlink", "bitcoin-cash", "stellar",
    "uniswap", "cosmos", "monero", "ethereum-classic", "avalanche-2",
    "shiba-inu", "wrapped-bitcoin", "near", "filecoin", "hedera-hashgraph",
]


def _get_json(url: str, timeout: int = 8) -> Any:
    req = urlrequest.Request(
        url,
        headers={
            "User-Agent": "WealthDashboardv2/2.0 (crypto-bridge)",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            import json
            return json.loads(raw)
    except HTTPError as e:
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = str(e)
        raise HTTPException(status_code=e.code, detail=f"CoinGecko: {detail}")
    except URLError as e:
        raise HTTPException(status_code=502, detail=f"CoinGecko unreachable: {e}")


@router.get("/price")
def get_prices(
    ids: str = Query(..., description="comma-separated CoinGecko ids, e.g. bitcoin,ethereum"),
    vs: str = Query(default="inr", description="vs currency: inr|usd|eur"),
):
    """Resolve one or more CoinGecko ids to fiat prices."""
    id_list = [i.strip().lower() for i in ids.split(",") if i.strip()]
    if not id_list:
        raise HTTPException(status_code=400, detail="ids parameter required")
    if len(id_list) > 25:
        raise HTTPException(status_code=400, detail="max 25 ids per call")

    cache_key = "|".join(sorted(id_list)) + "|" + vs.lower()
    now = time.time()
    cached = _PRICE_CACHE.get(cache_key)
    if cached and now - cached["ts"] < _PRICE_TTL_SEC:
        return {"prices": cached["prices"], "cached": True, "vs": vs.lower()}

    url = f"{_COINGECKO_BASE}/simple/price?ids={','.join(id_list)}&vs_currencies={vs.lower()}"
    raw = _get_json(url)
    if not isinstance(raw, dict):
        raise HTTPException(status_code=502, detail="CoinGecko returned unexpected shape")

    prices: Dict[str, Dict[str, float]] = {}
    for cid in id_list:
        entry = raw.get(cid) or {}
        prices[cid] = entry

    _PRICE_CACHE[cache_key] = {"prices": prices, "ts": now}
    return {"prices": prices, "cached": False, "vs": vs.lower()}


@router.get("/list")
def get_list():
    """Top 250 by market cap. Cached 5 min — CoinGecko list endpoint is expensive."""
    cache_key = "list_top250"
    now = time.time()
    cached = _PRICE_CACHE.get(cache_key)
    if cached and now - cached["ts"] < 300:
        return {"coins": cached["coins"], "cached": True}

    url = f"{_COINGECKO_BASE}/coins/markets?vs_currency=inr&order=market_cap_desc&per_page=250&page=1&sparkline=false"
    raw = _get_json(url)
    if not isinstance(raw, list):
        raise HTTPException(status_code=502, detail="CoinGecko list returned unexpected shape")

    coins = [
        {
            "id": c.get("id"),
            "symbol": (c.get("symbol") or "").upper(),
            "name": c.get("name"),
            "current_price_inr": c.get("current_price"),
        }
        for c in raw
        if c.get("id")
    ]
    _PRICE_CACHE[cache_key] = {"coins": coins, "ts": now}
    return {"coins": coins, "cached": False}

# ── CCXT-backed Crypto Exchange endpoints ───────────────────────────────

@router.get("/price/{exchange}/{symbol}")
def get_ccxt_price(exchange: str, symbol: str):
    """Fetch live crypto price via CCXT unified exchange API."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from crypto_provider import get_crypto_price
    formatted_symbol = symbol.replace('-', '/').upper()
    result = get_crypto_price(exchange, formatted_symbol)
    if not result:
        raise HTTPException(status_code=503, detail=f"CCXT could not fetch {symbol} from {exchange}")
    return result

# ── Freqtrade bot endpoints ───────────────────────────────

@router.get("/freqtrade/status")
def get_freqtrade_status_api():
    """Fetch active status, open trades, and profits from the Freqtrade bot."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from freqtrade_client import get_freqtrade_status
    return get_freqtrade_status()


