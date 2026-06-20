"""
osint_connector.py
Retrieves global news, financial RSS feeds, Yahoo Finance headlines, and GDELT Project events.
Deduplicates and caches them to SQLite db for real-time signal consumption.
"""
import urllib.request
import json
import logging
import hashlib
import sys
import os
from datetime import datetime

log = logging.getLogger("osint_connector")

# Resolve DB import path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db
from services.news_sentiment_scanner import sentiment_scanner

RSS_FEEDS = {
    "Moneycontrol Markets": "https://www.moneycontrol.com/rss/MC_market_updates.xml",
    "Reuters Business": "https://news.google.com/rss/search?q=when:24h+allinurl:reuters.com&hl=en-US&gl=US&ceid=US:en",
    "CNBC MarketNews": "https://news.google.com/rss/search?q=when:24h+allinurl:cnbc.com&hl=en-US&gl=US&ceid=US:en"
}

def fetch_rss_feed(feed_name: str, feed_url: str) -> list:
    """
    Parses RSS feeds and extracts headlines. Uses simple XML parsing as a fallback
    to avoid strict feedparser package installation if not compiled yet.
    """
    articles = []
    try:
        req = urllib.request.Request(
            feed_url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0"}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            xml_data = response.read().decode("utf-8", errors="ignore")
            
        # Parse titles and links simply using regex to ensure robust fallback
        import re
        items = re.findall(r"<item>(.*?)</item>", xml_data, re.DOTALL)
        for item in items:
            title_match = re.search(r"<title>(.*?)</title>", item, re.DOTALL)
            link_match = re.search(r"<link>(.*?)</link>", item, re.DOTALL)
            pub_match = re.search(r"<pubDate>(.*?)</pubDate>", item, re.DOTALL)
            
            if title_match and link_match:
                title = title_match.group(1).replace("<![CDATA[", "").replace("]]>", "").strip()
                link = link_match.group(1).replace("<![CDATA[", "").replace("]]>", "").strip()
                pub_date = pub_match.group(1) if pub_match else datetime.now().isoformat()
                articles.append({
                    "title": title,
                    "url": link,
                    "publisher": feed_name,
                    "published_at": pub_date
                })
    except Exception as e:
        log.warning(f"Failed to parse RSS feed {feed_name}: {e}")
        
    return articles

def fetch_gdelt_events() -> list:
    """
    Fetch recent geopolitical event records from GDELT Project summary API.
    """
    # GDELT Summary API for active topics
    url = "https://api.gdeltproject.org/api/v2/summary/summary?format=json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            articles = []
            if "toparticles" in data:
                for a in data["toparticles"]:
                    articles.append({
                        "title": a.get("title", "Geopolitical Alert"),
                        "url": a.get("url"),
                        "publisher": "GDELT Project",
                        "published_at": datetime.now().isoformat(),
                        "ticker": "GLOBAL"
                    })
                return articles
    except Exception as e:
        log.warning(f"GDELT Project summary fetch failed: {e}")
    return []

def run_247_news_sync():
    """
    Continuous background synchronization job.
    Fetches feeds, scores sentiment, and saves to SQLite cached_news table.
    """
    log.info("Running 24/7 background news synchronization loop...")
    all_articles = []
    
    # 1. Pull RSS Feeds
    for name, url in RSS_FEEDS.items():
        feed_articles = fetch_rss_feed(name, url)
        all_articles.extend(feed_articles)
        
    # 2. Pull GDELT Geopolitical Updates
    gdelt_articles = fetch_gdelt_events()
    all_articles.extend(gdelt_articles)
    
    # 3. Pull yfinance news for a list of target watchlisted stocks
    target_tickers = ["NIFTY", "SENSEX", "SBIN", "RELIANCE", "HDFCBANK", "INFY", "XAGUSD=X"]
    import yfinance as yf
    for ticker in target_tickers:
        try:
            # Map index/commodity ticker properly for yfinance
            yf_ticker = ticker
            if ticker == "NIFTY": yf_ticker = "^NSEI"
            elif ticker == "SENSEX": yf_ticker = "^BSESN"
            elif ticker == "XAGUSD=X": yf_ticker = "SI=F"
            
            t = yf.Ticker(yf_ticker)
            news = t.news
            if news:
                for item in news:
                    all_articles.append({
                        "title": item.get("title"),
                        "url": item.get("link"),
                        "publisher": item.get("publisher", "Yahoo Finance"),
                        "published_at": str(item.get("providerPublishTime", datetime.now().isoformat())),
                        "ticker": ticker
                    })
        except Exception as e:
            log.warning(f"yfinance fetch failed for {ticker}: {e}")
            
    # Deduplicate and save to database with sentiment scoring
    conn = db.get_db_connection(write=True)
    cursor = conn.cursor()
    
    saved_count = 0
    for art in all_articles:
        title = art.get("title")
        url = art.get("url")
        if not title or not url:
            continue
            
        # Create a unique UUID based on URL
        art_id = hashlib.md5(url.encode("utf-8")).hexdigest()
        
        # Calculate sentiment score
        score = sentiment_scanner.analyze_sentiment(title)
        
        try:
            cursor.execute("""
                INSERT OR IGNORE INTO cached_news (id, title, url, publisher, published_at, sentiment, ticker, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                art_id,
                title,
                url,
                art.get("publisher", "Unknown"),
                str(art.get("published_at")),
                score["verdict"],
                art.get("ticker", "MARKET"),
                "OSINT"
            ))
            saved_count += 1
        except Exception as e:
            log.debug(f"Save news error: {e}")
            
    conn.commit()
    conn.close()
    log.info(f"Background news sync completed. Processed {len(all_articles)} headlines. New saved: {saved_count}")
    
def get_cached_news(limit: int = 50, ticker: str = None) -> list:
    """
    Retrieves sorted cached articles from SQLite database.
    """
    conn = db.get_db_connection()
    cursor = conn.cursor()
    try:
        if ticker:
            cursor.execute("""
                SELECT * FROM cached_news WHERE ticker = ? ORDER BY published_at DESC LIMIT ?
            """, (ticker.strip().upper(), limit))
        else:
            cursor.execute("""
                SELECT * FROM cached_news ORDER BY published_at DESC LIMIT ?
            """, (limit,))
        rows = cursor.fetchall()
        results = []
        for r in rows:
            results.append({
                "id": r["id"],
                "title": r["title"],
                "url": r["url"],
                "publisher": r["publisher"],
                "published_at": r["published_at"],
                "sentiment": r["sentiment"],
                "ticker": r["ticker"],
                "source": r["source"]
            })
        return results
    except Exception as e:
        log.error(f"Failed to query cached_news: {e}")
        return []
    finally:
        conn.close()
