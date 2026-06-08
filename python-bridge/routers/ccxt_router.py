"""
ccxt_router.py — Universal Crypto Exchange Gateway & Polymarket Router
Prefix: /api/ccxt
"""
import os
import sys
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
import ccxt
import httpx

logger = logging.getLogger("ccxt_router")

router = APIRouter(prefix="/api/ccxt", tags=["CCXT — Exchange & Prediction Markets"])

SUPPORTED_EXCHANGES = ["binance", "bybit", "okx", "hyperliquid", "gateio", "kucoin", "kraken"]

def _normalize_symbol(symbol: str) -> str:
    """Normalize symbol representation (convert BTC-USDT or BTC_USDT to BTC/USDT)"""
    return symbol.replace("-", "/").replace("_", "/").upper()

@router.get("/exchanges")
def list_exchanges():
    """List supported exchanges and total CCXT exchanges available"""
    return {
        "supported": SUPPORTED_EXCHANGES,
        "total_available": len(ccxt.exchanges),
        "status": "online"
    }

@router.get("/ticker/{exchange}/{symbol:path}")
def get_ticker(exchange: str, symbol: str):
    """
    Get live ticker for any exchange & symbol (e.g. binance/BTC/USDT or bybit/ETH-USDT)
    """
    ex_name = exchange.lower()
    if ex_name not in ccxt.exchanges:
        raise HTTPException(status_code=400, detail=f"Unsupported exchange: {exchange}")
    
    norm_symbol = _normalize_symbol(symbol)
    try:
        ex_class = getattr(ccxt, ex_name)
        ex = ex_class({"enableRateLimit": True, "timeout": 10000})
        ticker = ex.fetch_ticker(norm_symbol)
        return {
            "exchange": ex_name,
            "symbol": norm_symbol,
            "last": ticker.get("last"),
            "bid": ticker.get("bid"),
            "ask": ticker.get("ask"),
            "high": ticker.get("high"),
            "low": ticker.get("low"),
            "volume": ticker.get("baseVolume") or ticker.get("quoteVolume"),
            "change_24h": ticker.get("percentage"),
            "timestamp": ticker.get("timestamp"),
            "datetime": ticker.get("datetime"),
            "raw": {
                "vwap": ticker.get("vwap"),
                "previousClose": ticker.get("previousClose")
            }
        }
    except ccxt.SymbolNotFound:
        raise HTTPException(status_code=404, detail=f"Symbol '{norm_symbol}' not found on {exchange}")
    except ccxt.ExchangeNotAvailable as e:
        raise HTTPException(status_code=503, detail=f"Exchange {exchange} not available: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CCXT error fetching ticker: {str(e)}")

@router.get("/ohlcv/{exchange}/{symbol:path}")
def get_ohlcv(
    exchange: str,
    symbol: str,
    timeframe: str = Query("1h", description="Candle timeframe: 1m, 5m, 15m, 1h, 4h, 1d"),
    limit: int = Query(100, ge=1, le=1000, description="Max candle count")
):
    """
    Fetch OHLCV candlestick data
    """
    ex_name = exchange.lower()
    if ex_name not in ccxt.exchanges:
        raise HTTPException(status_code=400, detail=f"Unsupported exchange: {exchange}")
    
    norm_symbol = _normalize_symbol(symbol)
    try:
        ex_class = getattr(ccxt, ex_name)
        ex = ex_class({"enableRateLimit": True, "timeout": 10000})
        if not ex.has.get("fetchOHLCV"):
            raise HTTPException(status_code=400, detail=f"Exchange {exchange} does not support fetchOHLCV")
        
        candles = ex.fetch_ohlcv(norm_symbol, timeframe=timeframe, limit=limit)
        formatted = [
            {
                "timestamp": c[0],
                "open": c[1],
                "high": c[2],
                "low": c[3],
                "close": c[4],
                "volume": c[5]
            }
            for c in candles
        ]
        return {
            "exchange": ex_name,
            "symbol": norm_symbol,
            "timeframe": timeframe,
            "count": len(formatted),
            "columns": ["timestamp", "open", "high", "low", "close", "volume"],
            "data": formatted
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CCXT error fetching OHLCV: {str(e)}")

@router.get("/orderbook/{exchange}/{symbol:path}")
def get_orderbook(
    exchange: str,
    symbol: str,
    depth: int = Query(20, ge=1, le=100, description="Orderbook depth limit")
):
    """
    Fetch live order book (bids & asks)
    """
    ex_name = exchange.lower()
    if ex_name not in ccxt.exchanges:
        raise HTTPException(status_code=400, detail=f"Unsupported exchange: {exchange}")
    
    norm_symbol = _normalize_symbol(symbol)
    try:
        ex_class = getattr(ccxt, ex_name)
        ex = ex_class({"enableRateLimit": True, "timeout": 10000})
        book = ex.fetch_order_book(norm_symbol, limit=depth)
        return {
            "exchange": ex_name,
            "symbol": norm_symbol,
            "timestamp": book.get("timestamp"),
            "datetime": book.get("datetime"),
            "bids": book.get("bids", [])[:depth],
            "asks": book.get("asks", [])[:depth]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CCXT error fetching orderbook: {str(e)}")

@router.get("/polymarket/events")
def get_polymarket_events(limit: int = Query(20, ge=1, le=100)):
    """
    Fetch active Polymarket prediction events via Gamma Markets API
    """
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"https://gamma-api.polymarket.com/events?active=true&closed=false&limit={limit}")
            if resp.status_code != 200:
                resp = client.get(f"https://gamma-api.polymarket.com/markets?active=true&limit={limit}")
                if resp.status_code != 200:
                    raise HTTPException(status_code=resp.status_code, detail="Failed to fetch Polymarket events")
            data = resp.json()
            return {"status": "success", "count": len(data) if isinstance(data, list) else 0, "events": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error connecting to Polymarket API: {str(e)}")

@router.get("/polymarket/markets")
def get_polymarket_markets(limit: int = Query(30, ge=1, le=100)):
    """
    Fetch prediction markets either via CCXT Polymarket wrapper or Gamma API
    """
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"https://gamma-api.polymarket.com/markets?active=true&closed=false&limit={limit}")
            if resp.status_code == 200:
                raw = resp.json()
                parsed = []
                for m in raw:
                    if isinstance(m, dict):
                        outcomes = m.get("outcomes", [])
                        outcome_prices = m.get("outcomePrices", [])
                        parsed.append({
                            "id": m.get("id"),
                            "question": m.get("question") or m.get("title"),
                            "slug": m.get("slug"),
                            "category": m.get("category"),
                            "outcomes": outcomes,
                            "outcomePrices": outcome_prices,
                            "volume": m.get("volumeNum") or m.get("volume"),
                            "liquidity": m.get("liquidityNum") or m.get("liquidity"),
                            "icon": m.get("icon") or m.get("image"),
                            "active": m.get("active", True)
                        })
                return {"status": "success", "count": len(parsed), "markets": parsed}
    except Exception as err:
        logger.warning(f"Gamma API fallback error: {err}")
    
    try:
        pm = ccxt.polymarket({"timeout": 10000})
        markets = pm.load_markets()
        market_list = list(markets.values())[:limit]
        return {
            "status": "success",
            "count": len(market_list),
            "markets": market_list
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Polymarket fetch error: {str(e)}")
