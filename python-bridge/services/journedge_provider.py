"""
journedge_provider.py
Offline-first trade journal SQLite database manager.
"""
import os
import sqlite3
import logging
from typing import List, Dict, Any

log = logging.getLogger("journedge_provider")

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DB_DIR, "journedge.db")

def init_db():
    """Ensure data directory and SQLite database tables exist."""
    try:
        os.makedirs(DB_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS journedge_trades (
                id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                direction TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                entry_price REAL NOT NULL,
                exit_price REAL,
                pnl REAL,
                date TEXT NOT NULL,
                notes TEXT,
                tags TEXT,
                source TEXT
            )
        """)
        conn.commit()
        conn.close()
        log.info("Journedge SQLite database initialized successfully.")
    except Exception as e:
        log.error(f"Failed to initialize Journedge SQLite DB: {e}")

def save_journedge_trade(trade: Dict[str, Any]) -> bool:
    """Save or update a trade record in SQLite."""
    try:
        init_db()
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO journedge_trades (id, ticker, direction, quantity, entry_price, exit_price, pnl, date, notes, tags, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                ticker=excluded.ticker,
                direction=excluded.direction,
                quantity=excluded.quantity,
                entry_price=excluded.entry_price,
                exit_price=excluded.exit_price,
                pnl=excluded.pnl,
                date=excluded.date,
                notes=excluded.notes,
                tags=excluded.tags,
                source=excluded.source
        """, (
            str(trade.get("id")),
            trade.get("ticker"),
            trade.get("direction"),
            int(trade.get("quantity", 1)),
            float(trade.get("entryPrice", 0.0)),
            float(trade.get("exitPrice")) if trade.get("exitPrice") is not None else None,
            float(trade.get("pnl")) if trade.get("pnl") is not None else None,
            trade.get("date"),
            trade.get("notes"),
            trade.get("tags"),
            trade.get("source", "journedge")
        ))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        log.error(f"Failed to save trade to Journedge: {e}")
        return False

def get_journedge_trades() -> List[Dict[str, Any]]:
    """Retrieve all trade records from SQLite."""
    try:
        init_db()
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM journedge_trades ORDER BY date DESC")
        rows = cursor.fetchall()
        trades = []
        for r in rows:
            trades.append({
                "id": r["id"],
                "ticker": r["ticker"],
                "direction": r["direction"],
                "quantity": r["quantity"],
                "entryPrice": r["entry_price"],
                "exitPrice": r["exit_price"],
                "pnl": r["pnl"],
                "date": r["date"],
                "notes": r["notes"],
                "tags": r["tags"],
                "source": r["source"]
            })
        conn.close()
        return trades
    except Exception as e:
        log.error(f"Failed to fetch trades from Journedge: {e}")
        return []
