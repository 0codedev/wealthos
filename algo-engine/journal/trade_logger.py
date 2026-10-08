import sqlite3
import os
import datetime

# Dynamic resolution of DB_PATH to stay relative to this file's directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "trades.db")

class TradeLogger:
    def __init__(self):
        self._init_db()
    
    def _init_db(self):
        # Create directories if not exists
        os.makedirs(BASE_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                algo_id TEXT,
                strategy TEXT,
                direction TEXT,
                instrument TEXT,
                quantity INTEGER,
                price REAL,
                stop_loss REAL,
                target REAL,
                mode TEXT,
                status TEXT,
                order_id TEXT,
                pnl REAL DEFAULT 0.0
            )
        """)
        conn.commit()
        conn.close()
    
    def log(self, record: dict):
        conn = sqlite3.connect(DB_PATH)
        conn.execute("""
            INSERT INTO trades 
            (timestamp, algo_id, strategy, direction, instrument, quantity, price, stop_loss, target, mode, status, order_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            record.get("timestamp"), 
            record.get("algo_id"), 
            record.get("strategy"),
            record.get("direction"), 
            record.get("instrument"), 
            int(record.get("quantity", 0)),
            float(record.get("price", 0.0)), 
            float(record.get("stop_loss", 0.0)), 
            float(record.get("target", 0.0)),
            record.get("mode"), 
            record.get("status"),
            record.get("order_id", "NONE")
        ))
        conn.commit()
        conn.close()
