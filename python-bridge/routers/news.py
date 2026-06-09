"""
news.py
FastAPI router for news sentiment analysis and real-time feeds.
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
import sys
import os

# Import service logic
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.news_sentiment_scanner import sentiment_scanner

router = APIRouter(prefix="/api/news", tags=["news"])

class SentimentRequest(BaseModel):
    headlines: List[str]

class SentimentResult(BaseModel):
    headline: str
    positive: float
    negative: float
    neutral: float
    verdict: str

@router.post("/sentiment")
def calculate_sentiment(req: SentimentRequest):
    """
    Analyzes a list of news headlines and returns sentiment scores.
    """
    results = []
    for h in req.headlines:
        score = sentiment_scanner.analyze_sentiment(h)
        results.append({
            "headline": h,
            "positive": score["positive"],
            "negative": score["negative"],
            "neutral": score["neutral"],
            "verdict": score["verdict"]
        })
    return {"status": "success", "results": results}

@router.get("/headlines/{symbol}")
def get_ticker_headlines(symbol: str):
    """
    Fetches real-time headlines for a symbol from Yahoo Finance and runs sentiment scoring.
    """
    symbol_clean = symbol.strip().upper()
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol_clean if "." in symbol_clean or "^" in symbol_clean else f"{symbol_clean}.NS")
        news_items = ticker.news
        if not news_items:
            # Fallback to general market news or empty list
            return {"status": "success", "symbol": symbol_clean, "articles": []}
            
        articles = []
        for item in news_items:
            title = item.get("title", "")
            sentiment = sentiment_scanner.analyze_sentiment(title)
            articles.append({
                "uuid": item.get("uuid"),
                "title": title,
                "publisher": item.get("publisher"),
                "url": item.get("link"),
                "published_at": item.get("providerPublishTime"),
                "sentiment": sentiment["verdict"],
                "positive": sentiment["positive"],
                "negative": sentiment["negative"],
                "neutral": sentiment["neutral"]
            })
        return {"status": "success", "symbol": symbol_clean, "articles": articles}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch news for {symbol}: {str(e)}")

# ── OSINT & 24/7 background sync endpoints ───────────────────────────

@router.get("/osint-feed")
def get_osint_feed(
    limit: int = Query(50, description="Max articles to fetch"),
    ticker: Optional[str] = Query(None, description="Optional symbol filter")
):
    """
    Retrieves latest news cached from RSS, GDELT, and Yahoo Finance feeds.
    """
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from osint_connector import get_cached_news
    articles = get_cached_news(limit, ticker)
    return {"status": "success", "articles": articles}

@router.post("/sync")
def trigger_news_sync():
    """
    Manually triggers background sync for RSS feeds, GDELT, and Yahoo Finance.
    """
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from osint_connector import run_247_news_sync
    try:
        run_247_news_sync()
        return {"status": "success", "message": "News synchronization completed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class MacroScalpRequest(BaseModel):
    symbol: str
    current_price: float
    event_name: str
    pre_event_price: float

@router.post("/macro-scalp")
def calculate_macro_scalping(req: MacroScalpRequest):
    """
    Evaluates Phase 2 pullback zones for macroeconomic scalping.
    """
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
    from macro_scalping_signal import generate_scalping_signal
    try:
        sig = generate_scalping_signal(req.symbol, req.current_price, req.event_name, req.pre_event_price)
        return sig
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


