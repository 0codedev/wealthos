import sqlite3
import os
import time
import random
import threading
from datetime import datetime, timedelta
import pandas as pd
from logger import get_logger

log = get_logger("db", tag="DB")

DB_FILE = os.path.join(os.path.dirname(__file__), "cache.db")

# Atomic counters for Telemetry tracking
_active_connections = 0
_peak_connections = 0
_conn_lock = threading.Lock()

class TelemetryConnection(sqlite3.Connection):
    def close(self):
        global _active_connections
        try:
            super().close()
        finally:
            with _conn_lock:
                if not hasattr(self, "_closed_tracked"):
                    self._closed_tracked = True
                    _active_connections = max(0, _active_connections - 1)

_wal_initialized = False
_wal_init_lock = threading.Lock()

def get_db_connection(write=False):
    global _active_connections, _peak_connections, _wal_initialized
    
    # Enable isolation_level=None for IMMEDIATE write transactions
    # Timeout increased to 30.0 to prevent locks on Windows
    if write:
        conn = sqlite3.connect(DB_FILE, timeout=30.0, isolation_level=None, factory=TelemetryConnection)
    else:
        conn = sqlite3.connect(DB_FILE, timeout=30.0, factory=TelemetryConnection)
        
    conn.row_factory = sqlite3.Row
    
    with _conn_lock:
        _active_connections += 1
        if _active_connections > _peak_connections:
            _peak_connections = _active_connections
    
    # Execute persistent WAL configuration once per process lifecycle to prevent filesystem churn
    if not _wal_initialized:
        with _wal_init_lock:
            if not _wal_initialized:
                try:
                    conn.execute("PRAGMA journal_mode = WAL;")             # Persistent in DB header
                    conn.execute("PRAGMA synchronous = NORMAL;")           # Faster writes without risk
                    conn.execute("PRAGMA journal_size_limit = 67108864;")  # 64MB WAL Cap
                    conn.execute("PRAGMA busy_timeout = 30000;")           # 30-sec retry on lock
                    _wal_initialized = True
                except Exception as e:
                    log.warning(f"WAL init warning: {e}")

    try:
        conn.execute("PRAGMA cache_size = -32000;")            # 32MB Memory Cache per connection
    except Exception as e:
        log.warning(f"PRAGMA execution warning: {e}")
        
    return conn

def get_active_connection_stats() -> dict:
    """Returns telemetry metrics of active database connections"""
    with _conn_lock:
        return {
            "active_connections": _active_connections,
            "peak_connections": _peak_connections
        }

def run_db_write_with_retry(func, *args, **kwargs):
    """
    Executes a write function with automatic retries and exponential backoff
    to handle SQLite 'database is locked' errors under WAL mode.
    """
    retries = 5
    backoff = 0.1
    last_err = None
    for attempt in range(retries):
        try:
            return func(*args, **kwargs)
        except sqlite3.OperationalError as e:
            last_err = e
            if "locked" in str(e).lower() and attempt < retries - 1:
                sleep_time = backoff * (2 ** attempt) + random.uniform(0.05, 0.15)
                log.warning(f"Database locked. Retrying write in {sleep_time:.2f}s (Attempt {attempt+1}/{retries})...")
                time.sleep(sleep_time)
                continue
            raise e
    if last_err is not None:
        raise last_err
    raise RuntimeError("Database write failed with unknown error")

def db_write_transaction(func):
    """
    Decorator to wrap a database write function in a retry loop 
    to handle SQLite locks in concurrent/multi-threaded contexts.
    """
    def wrapper(*args, **kwargs):
        return run_db_write_with_retry(func, *args, **kwargs)
    return wrapper

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Configure persistent journal mode and synchronicity in init_db
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
    except sqlite3.Error as e:
        log.warning(f"Failed to initialize WAL: {e}")
    
    # 0. Scheduler Job Metadata table (Persisted Sync Status)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS scheduler_job_metadata (
        job_id TEXT PRIMARY KEY,
        last_run TEXT,
        status TEXT,
        error TEXT
    )
    """)

    # 1. Delivery History table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS delivery_history (
        symbol TEXT,
        date TEXT, -- YYYY-MM-DD
        close REAL,
        delivery_qty INTEGER,
        delivery_pct REAL,
        volume INTEGER,
        trades INTEGER,
        PRIMARY KEY (symbol, date)
    )
    """)
    
    # Drop redundant composite primary key index if it exists
    cursor.execute("DROP INDEX IF EXISTS idx_delivery_date;")
    
    # 2. Insider Trading table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS insider_trading (
        symbol TEXT,
        acquirer_name TEXT,
        sec_type TEXT,
        sec_val REAL,
        action TEXT, -- Buy/Sell
        trans_type TEXT,
        date TEXT, -- YYYY-MM-DD
        qty INTEGER,
        post_share INTEGER,
        post_pct REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, acquirer_name, date, qty, action)
    )
    """)
    
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_insider_date ON insider_trading (symbol, date)")
    
    # 3. Promoter Pledged Shares table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS pledged_shares (
        symbol TEXT PRIMARY KEY,
        company_name TEXT,
        total_shares INTEGER,
        promoter_shares INTEGER,
        pledged_shares INTEGER,
        pledged_pct REAL,
        updated_at TEXT -- YYYY-MM-DD
    )
    """)
    
    # 4. Mutual Fund Insider data
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS mf_insider (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT,
        scheme_name TEXT,
        buy_sell TEXT,
        qty INTEGER,
        value REAL,
        date TEXT, -- YYYY-MM-DD
        isin TEXT,
        UNIQUE(symbol, scheme_name, date, qty, buy_sell)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_mf_insider_symbol ON mf_insider (symbol)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_mf_insider_isin ON mf_insider (isin)")
    
    # 5. Intraday Order Flow table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS intraday_orderflow (
        symbol TEXT,
        timestamp TEXT, -- YYYY-MM-DD HH:MM:00
        time_slot TEXT, -- HH:MM
        option_synergy REAL,
        price_aggression REAL,
        composite_val REAL,
        p_inst REAL,
        spot_price REAL,
        r_factor REAL,
        apex_signal TEXT,
        PRIMARY KEY (symbol, timestamp)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_orderflow_lookup ON intraday_orderflow (symbol, time_slot, timestamp DESC)")
    
    # 6. Upstox Instrument Key Mapping
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upstox_instruments (
        symbol TEXT,
        isin TEXT,
        instrument_key TEXT PRIMARY KEY,
        exchange TEXT,
        lot_size INTEGER,
        updated_at TEXT
    )
    """)
    # Replace single column index with highly optimized composite index (symbol, exchange)
    cursor.execute("DROP INDEX IF EXISTS idx_upstox_instruments_symbol;")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_upstox_instruments_sym_exch ON upstox_instruments (symbol, exchange);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_upstox_instruments_isin ON upstox_instruments (isin)")

    # 7. Upstox 20-Day Volume Averages (replaces manual calculations)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upstox_volume_avg (
        symbol TEXT PRIMARY KEY,
        avg_volume_20d REAL,
        avg_abs_change_20d REAL,
        candle_count INTEGER,
        updated_at TEXT
    )
    """)
    try:
        cursor.execute("ALTER TABLE upstox_volume_avg ADD COLUMN avg_abs_change_20d REAL")
        conn.commit()
    except Exception:
        pass

    # 8. Upstox FII/DII Cache
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upstox_fii_dii (
        date TEXT,
        segment TEXT,
        fii_net REAL,
        dii_net REAL,
        updated_at TEXT,
        PRIMARY KEY (date, segment)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_upstox_fii_dii_segment_date ON upstox_fii_dii (segment, date DESC)")

    # 9. Upstox Market Status Cache
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upstox_market_status (
        segment TEXT PRIMARY KEY,
        status TEXT,
        open_time TEXT,
        close_time TEXT,
        updated_at TEXT
    )
    """)

    # 10. Upstox Caching Layer
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upstox_cache (
        endpoint TEXT,
        params TEXT,
        response_json TEXT,
        fetched_at TEXT,
        ttl_seconds INTEGER,
        PRIMARY KEY (endpoint, params)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_upstox_cache_expiry ON upstox_cache (fetched_at, ttl_seconds)")

    # 11. Upstox Rate Limit Monitor
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upstox_api_usage (
        timestamp TEXT,
        endpoint TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_upstox_api_usage_time ON upstox_api_usage (timestamp)")

    # 12. Upstox Errors and Fallbacks
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upstox_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        endpoint TEXT,
        error_code INTEGER,
        message TEXT,
        fallback_used TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_upstox_errors_time ON upstox_errors (timestamp)")
    
    # 13. Upstox FII/DII History (Phase D)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upstox_fii_history (
        date TEXT,
        segment TEXT,
        buy_value REAL,
        sell_value REAL,
        net_value REAL,
        updated_at TEXT,
        PRIMARY KEY (date, segment)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_fii_history_date ON upstox_fii_history (date)")
    
    # 14. Persistent NSE Cache
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS nse_cache (
        cache_key TEXT PRIMARY KEY,
        response_json TEXT,
        fetched_at TEXT,
        ttl_seconds INTEGER
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_nse_cache_expiry ON nse_cache (fetched_at)")
    
    # 15. Opening Range Expansion (ORE) Cache
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS ore_cache (
        symbol TEXT,
        date TEXT,
        ore_score REAL,
        direction TEXT,
        bsr REAL,
        vs REAL,
        cd REAL,
        compression REAL,
        computed_at TEXT,
        PRIMARY KEY (symbol, date)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ore_cache_date ON ore_cache (date)")
    
    # 16. Relative Strength Rank Cache
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rs_rank_cache (
        symbol TEXT,
        rs_score REAL,
        rs_rank REAL,
        category TEXT,
        computed_date TEXT,
        PRIMARY KEY (symbol, computed_date)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rs_rank_date ON rs_rank_cache (computed_date)")
    
    # 17. Candle Pattern Cache
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS pattern_cache (
        symbol TEXT,
        patterns TEXT,
        pattern_score REAL,
        computed_date TEXT,
        PRIMARY KEY (symbol, computed_date)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_pattern_date ON pattern_cache (computed_date)")
    
    # 18. Shareholding Velocity table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shareholding_velocity (
        symbol TEXT PRIMARY KEY,
        isin TEXT,
        fii_velocity REAL,
        dii_velocity REAL,
        accumulation_flag TEXT,
        fetched_at TEXT
    )
    """)
    
    # 19. Provider Capabilities table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS provider_capabilities (
        provider TEXT,
        capability TEXT,
        auth_mode TEXT,
        state TEXT,
        checked_at TEXT,
        diagnostic TEXT,
        PRIMARY KEY (provider, capability)
    )
    """)

    # 20. Schema Version table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        migrated_at TEXT
    )
    """)

    # Get current schema version
    cursor.execute("SELECT MAX(version) as current_version FROM schema_version")
    row = cursor.fetchone()
    current_version = row["current_version"] if row and row["current_version"] is not None else 0

    if current_version < 1:
        cursor.execute("INSERT OR REPLACE INTO schema_version (version, migrated_at) VALUES (1, ?)", (datetime.now().isoformat(),))

    if current_version < 2:
        # Create instrument_registry table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS instrument_registry (
            canonical_id TEXT PRIMARY KEY,
            asset_class TEXT,
            symbol TEXT,
            exchange TEXT,
            isin TEXT,
            upstox_key TEXT,
            dhan_security_id TEXT,
            dhan_segment TEXT,
            yahoo_ticker TEXT,
            nse_symbol TEXT,
            expiry TEXT,
            strike REAL,
            option_type TEXT,
            aliases TEXT,
            supported_providers TEXT
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_instrument_registry_symbol ON instrument_registry (symbol)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_instrument_registry_isin ON instrument_registry (isin)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_instrument_registry_upstox ON instrument_registry (upstox_key)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_instrument_registry_dhan ON instrument_registry (dhan_security_id)")
        
        cursor.execute("INSERT OR REPLACE INTO schema_version (version, migrated_at) VALUES (2, ?)", (datetime.now().isoformat(),))

    if current_version < 3:
        # Create active_subscriptions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS active_subscriptions (
            client_id TEXT,
            instrument_key TEXT,
            mode TEXT,
            last_requested_at TEXT,
            PRIMARY KEY (client_id, instrument_key)
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_active_subscriptions_key ON active_subscriptions (instrument_key)")
        cursor.execute("INSERT OR REPLACE INTO schema_version (version, migrated_at) VALUES (3, ?)", (datetime.now().isoformat(),))

    if current_version < 4:
        # Create market_snapshots
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS market_snapshots (
            canonical_id TEXT,
            provider TEXT,
            data_type TEXT,
            payload TEXT,
            fetched_at TEXT,
            PRIMARY KEY (canonical_id, provider, data_type)
        )
        """)
        # Create feature_snapshots
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS feature_snapshots (
            canonical_id TEXT,
            feature_name TEXT,
            value TEXT,
            computed_at TEXT,
            PRIMARY KEY (canonical_id, feature_name)
        )
        """)
        # Create data_discrepancies
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS data_discrepancies (
            canonical_id TEXT,
            field TEXT,
            upstox_val REAL,
            dhan_val REAL,
            delta REAL,
            flagged_at TEXT,
            resolved INTEGER DEFAULT 0,
            PRIMARY KEY (canonical_id, field, flagged_at)
        )
        """)
        # Create source_health
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS source_health (
            provider TEXT,
            latency_ms REAL,
            error_rate REAL,
            cache_hit_ratio REAL,
            rate_limit_pressure REAL,
            circuit_state TEXT,
            timestamp TEXT
        )
        """)
        # Create execution_events
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS execution_events (
            event_id TEXT PRIMARY KEY,
            idempotency_key TEXT,
            order_id TEXT,
            event_type TEXT,
            timestamp TEXT,
            raw_payload TEXT,
            reconciliation_state TEXT
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_execution_events_idempotency ON execution_events (idempotency_key)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_data_discrepancies_canonical ON data_discrepancies (canonical_id)")
        cursor.execute("INSERT OR REPLACE INTO schema_version (version, migrated_at) VALUES (4, ?)", (datetime.now().isoformat(),))

    if current_version < 5:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS autopilot_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            strategy TEXT,
            symbol TEXT,
            direction TEXT,
            entry_time TEXT,
            entry_price REAL,
            exit_time TEXT,
            exit_price REAL,
            quantity INTEGER,
            stop_loss REAL,
            target REAL,
            pnl REAL,
            pnl_pct REAL,
            signal_score REAL,
            nifty_direction TEXT,
            sector TEXT,
            sector_strength REAL,
            order_id TEXT,
            status TEXT
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_autopilot_journal_date ON autopilot_journal (date)")
        cursor.execute("INSERT OR REPLACE INTO schema_version (version, migrated_at) VALUES (5, ?)", (datetime.now().isoformat(),))

    if current_version < 6:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS cached_news (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT UNIQUE,
            publisher TEXT,
            published_at TEXT,
            sentiment TEXT,
            ticker TEXT,
            source TEXT
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cached_news_ticker ON cached_news (ticker)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cached_news_published_at ON cached_news (published_at DESC)")
        cursor.execute("INSERT OR REPLACE INTO schema_version (version, migrated_at) VALUES (6, ?)", (datetime.now().isoformat(),))

    # Migration for autopilot_journal composite_score column
    try:
        cursor.execute("PRAGMA table_info(autopilot_journal)")
        cols = [row[1] for row in cursor.fetchall()]
        if "composite_score" not in cols:
            cursor.execute("ALTER TABLE autopilot_journal ADD COLUMN composite_score REAL DEFAULT 0.0")
    except Exception as e:
        log.warning(f"Note on composite_score column migration: {e}")

    conn.commit()
    conn.close()



def save_job_metadata(job_id: str, last_run: str, status: str, error: str = None):
    try:
        conn = get_db_connection(write=True)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO scheduler_job_metadata (job_id, last_run, status, error)
            VALUES (?, ?, ?, ?)
        """, (job_id, last_run, status, error))
        conn.commit()
        conn.close()
    except Exception as e:
        log.error(f"Failed to save scheduler job metadata for {job_id}: {e}")

def get_all_job_metadata() -> dict:
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT job_id, last_run, status, error FROM scheduler_job_metadata")
        rows = cursor.fetchall()
        conn.close()
        return {row["job_id"]: {"last_run": row["last_run"], "status": row["status"], "error": row["error"]} for row in rows}
    except Exception as e:
        log.error(f"Failed to get scheduler job metadata: {e}")
        return {}

# Helper to standardise date format
def parse_date(date_val):
    if not date_val:
        return None
    if isinstance(date_val, datetime):
        return date_val.strftime("%Y-%m-%d")
    date_str = str(date_val).strip()
    # Try multiple formats
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%b %d, %Y"):
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return date_str

# --- DELIVERY HISTORY CACHE ---

def get_cached_delivery(symbol: str, from_date_str: str, to_date_str: str):
    """
    Returns delivery data from cache if present.
    Determines if cache covers the full date range.
    """
    from_date = parse_date(from_date_str)
    to_date = parse_date(to_date_str)
    
    conn = get_db_connection()
    try:
        # Check if cache contains bounds
        cursor = conn.cursor()
        cursor.execute(
            "SELECT MIN(date) as min_d, MAX(date) as max_d, COUNT(*) as cnt FROM delivery_history WHERE symbol = ?", 
            (symbol.upper(),)
        )
        row = cursor.fetchone()
        
        # If cache has data and bounds cover the range, return cache
        if row and row["cnt"] > 0 and row["min_d"] <= from_date and row["max_d"] >= to_date:
            df = pd.read_sql_query(
                "SELECT * FROM delivery_history WHERE symbol = ? AND date BETWEEN ? AND ? ORDER BY date ASC",
                conn,
                params=(symbol.upper(), from_date, to_date)
            )
            # Match columns to what PNSEA outputs
            df.rename(columns={
                "date": "Date",
                "close": "Close",
                "delivery_pct": "Delivery_Pct",
                "delivery_qty": "Deliverable_Qty",
                "volume": "Volume",
                "trades": "Trades"
            }, inplace=True)
            return df
    except Exception as e:
        log.error(f"Error fetching delivery history: {e}")
    finally:
        conn.close()
    return None

@db_write_transaction
def save_delivery(symbol: str, df: pd.DataFrame):
    """
    Saves new delivery history data to cache.
    """
    if df is None or df.empty:
        return
        
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        # Expected standard column mappings
        col_mappings = {
            'Date': 'date',
            'Close': 'close',
            'Delivery_Pct': 'delivery_pct',
            'Deliverable_Qty': 'delivery_qty',
            'Volume': 'volume',
            'Trades': 'trades'
        }
        
        # Normalise columns
        df_db = df.copy()
        for col_src, col_dest in col_mappings.items():
            if col_src not in df_db.columns:
                # Find case-insensitive or loose matches
                for col in df_db.columns:
                    if col.lower() == col_src.lower():
                        df_db.rename(columns={col: col_src}, inplace=True)
                        break
        
        for _, row in df_db.iterrows():
            date_parsed = parse_date(row.get('Date'))
            if not date_parsed:
                continue
                
            cursor.execute("""
            INSERT OR REPLACE INTO delivery_history (symbol, date, close, delivery_qty, delivery_pct, volume, trades)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                symbol.upper(),
                date_parsed,
                float(row.get('Close', 0.0) or 0),
                int(row.get('Deliverable_Qty', 0) or 0),
                float(row.get('Delivery_Pct', 0.0) or 0),
                int(row.get('Volume', 0) or 0),
                int(row.get('Trades', 0) or 0)
            ))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving delivery history: {e}")
        raise e
    finally:
        conn.close()

# --- INSIDER TRADING CACHE ---

def get_cached_insider(symbol: str = None, from_date_str: str = None, to_date_str: str = None):
    conn = get_db_connection()
    try:
        query = "SELECT * FROM insider_trading"
        params = []
        conditions = []
        
        if symbol:
            conditions.append("symbol = ?")
            params.append(symbol.upper())
        if from_date_str:
            conditions.append("date >= ?")
            params.append(parse_date(from_date_str))
        if to_date_str:
            conditions.append("date <= ?")
            params.append(parse_date(to_date_str))
            
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY date DESC LIMIT 1000"
        
        df = pd.read_sql_query(query, conn, params=params)
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching insider data: {e}")
        return []
    finally:
        conn.close()

@db_write_transaction
def save_insider(data):
    if not data:
        return
    if isinstance(data, pd.DataFrame):
        data = data.to_dict(orient="records")
        
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        for item in data:
            # Safely handle keys since NSE payloads can change
            symbol = item.get('symbol') or item.get('secVal') or ''
            if not symbol:
                continue
                
            cursor.execute("""
            INSERT OR IGNORE INTO insider_trading 
            (symbol, acquirer_name, sec_type, sec_val, action, trans_type, date, qty, post_share, post_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                symbol.upper(),
                item.get('acquirerName') or item.get('acqName') or '',
                item.get('secType') or '',
                float(item.get('secVal', 0.0) or 0),
                item.get('action') or item.get('buySell') or '',
                item.get('transType') or '',
                parse_date(item.get('date') or item.get('secAcqDate') or item.get('dateOfAcquisition')),
                int(item.get('qty', 0) or 0),
                int(item.get('postShare', 0) or 0),
                float(item.get('postPct', 0.0) or 0)
            ))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving insider data: {e}")
        raise e
    finally:
        conn.close()

# --- PLEDGED SHARES CACHE ---

def get_cached_pledged(symbol: str):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pledged_shares WHERE symbol = ?", (symbol.upper(),))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error fetching pledged shares: {e}")
    finally:
        conn.close()
    return None

@db_write_transaction
def save_pledged(symbol: str, data):
    if not data:
        return
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO pledged_shares (symbol, company_name, total_shares, promoter_shares, pledged_shares, pledged_pct, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            symbol.upper(),
            data.get('companyName') or '',
            int(data.get('totalShares', 0) or 0),
            int(data.get('promoterShares', 0) or 0),
            int(data.get('pledgedShares', 0) or 0),
            float(data.get('pledgedPct', 0.0) or 0),
            parse_date(data.get('updatedAt') or datetime.now())
        ))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving pledged shares: {e}")
        raise e
    finally:
        conn.close()

# --- MUTUAL FUND INSIDER CACHE ---

def get_cached_mf_insider(symbol: str = None, isin: str = None):
    conn = get_db_connection()
    try:
        query = "SELECT * FROM mf_insider"
        params = []
        conditions = []
        if symbol:
            conditions.append("symbol LIKE ?")
            params.append(f"%{symbol}%")
        if isin:
            conditions.append("isin = ?")
            params.append(isin)
            
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY date DESC LIMIT 500"
        
        df = pd.read_sql_query(query, conn, params=params)
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching MF insider data: {e}")
        return []
    finally:
        conn.close()

@db_write_transaction
def save_mf_insider(data):
    if not data:
        return
    if isinstance(data, pd.DataFrame):
        data = data.to_dict(orient="records")
        
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        for item in data:
            cursor.execute("""
            INSERT OR IGNORE INTO mf_insider (symbol, scheme_name, buy_sell, qty, value, date, isin)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                item.get('symbol') or '',
                item.get('schemeName') or '',
                item.get('buySell') or '',
                int(item.get('qty', 0) or 0),
                float(item.get('value', 0.0) or 0),
                parse_date(item.get('date')),
                item.get('isin') or ''
            ))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving MF insider data: {e}")
        raise e
    finally:
        conn.close()

def get_all_cached_delivery_radar():
    """
    Computes delivery radar stats for all cached symbols in SQLite.
    Returns: list of dicts with symbol, latest_date, latest_delivery_pct, avg_delivery_pct, is_rising, etc.
    """
    conn = get_db_connection()
    try:
        df = pd.read_sql_query("""
            SELECT symbol, date, close, delivery_pct, volume, delivery_qty
            FROM delivery_history
            ORDER BY symbol, date DESC
        """, conn)
        
        if df.empty:
            return []
            
        results = []
        for symbol, group in df.groupby('symbol'):
            group_sorted = group.sort_values('date', ascending=False)
            if len(group_sorted) < 3:
                continue
                
            latest = group_sorted.iloc[0]
            five_day_group = group_sorted.iloc[:5]
            avg_5d = float(five_day_group['delivery_pct'].mean())
            avg_volume_5d = float(five_day_group['volume'].mean())
            
            is_rising = False
            if len(group_sorted) >= 3:
                pct_0 = float(group_sorted.iloc[0]['delivery_pct'] or 0.0)
                pct_1 = float(group_sorted.iloc[1]['delivery_pct'] or 0.0)
                pct_2 = float(group_sorted.iloc[2]['delivery_pct'] or 0.0)
                if pct_0 > pct_1 > pct_2:
                    is_rising = True
                    
            results.append({
                "symbol": symbol,
                "latest_date": str(latest['date']),
                "close": float(latest['close'] or 0.0),
                "delivery_pct": float(latest['delivery_pct'] or 0.0),
                "volume": int(latest['volume'] or 0),
                "avg_delivery_pct": avg_5d,
                "avg_volume": avg_volume_5d,
                "is_rising": is_rising,
                "deviation": float((latest['delivery_pct'] or 0.0) - avg_5d)
            })
            
        return results
    except Exception as e:
        log.error(f"Error calculating delivery radar: {e}")
        return []
    finally:
        conn.close()

# --- INTRADAY ORDER FLOW ---

@db_write_transaction
def save_orderflow_tick(symbol: str, timestamp: str, time_slot: str, option_synergy: float, price_aggression: float, composite_val: float, p_inst: float, spot_price: float, r_factor: float, apex_signal: str):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO intraday_orderflow 
        (symbol, timestamp, time_slot, option_synergy, price_aggression, composite_val, p_inst, spot_price, r_factor, apex_signal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            symbol.upper(),
            timestamp,
            time_slot,
            option_synergy,
            price_aggression,
            composite_val,
            p_inst,
            spot_price,
            r_factor,
            apex_signal
        ))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving orderflow tick: {e}")
        raise e
    finally:
        conn.close()

def get_timeslot_baseline(symbol: str, time_slot: str, limit: int = 20) -> float:
    """
    Returns rolling N-day average of composite_val for a specific time slot.
    """
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT AVG(composite_val) as avg_val, COUNT(*) as cnt 
            FROM (
                SELECT composite_val 
                FROM intraday_orderflow 
                WHERE symbol = ? AND time_slot = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            )
        """, (symbol.upper(), time_slot, limit))
        row = cursor.fetchone()
        if row and row["cnt"] > 0 and row["avg_val"] is not None:
            return float(row["avg_val"])
    except Exception as e:
        log.error(f"Error getting timeslot baseline: {e}")
    finally:
        conn.close()
    return 1.0 # Default fallback multiplier

def get_intraday_history(symbol: str, date_str: str):
    """
    Returns all orderflow ticks for a specific symbol on a given date (YYYY-MM-DD).
    """
    conn = get_db_connection()
    try:
        df = pd.read_sql_query("""
            SELECT * FROM intraday_orderflow 
            WHERE symbol = ? AND timestamp LIKE ? 
            ORDER BY timestamp ASC
        """, conn, params=(symbol.upper(), f"{date_str}%"))
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching intraday history: {e}")
        return []
    finally:
        conn.close()

# --- UPSTOX ACCESS HELPERS ---

@db_write_transaction
def save_upstox_instruments(instruments: list):
    """Saves a batch of Upstox instrument keys"""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()
    try:
        for inst in instruments:
            cursor.execute("""
            INSERT OR REPLACE INTO upstox_instruments (symbol, isin, instrument_key, exchange, lot_size, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (
                inst.get("symbol"),
                inst.get("isin"),
                inst.get("instrument_key"),
                inst.get("exchange"),
                inst.get("lot_size"),
                now_str
            ))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving Upstox instruments: {e}")
        raise e
    finally:
        conn.close()

_LIQUID_CASH_CACHE = None

def get_liquid_cash_universe() -> list:
    """Returns the pre-curated liquid cash universe (~660 stocks) with memory caching"""
    global _LIQUID_CASH_CACHE
    if _LIQUID_CASH_CACHE is not None:
        return _LIQUID_CASH_CACHE
    universe_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "liquid_cash_universe.json")
    if os.path.exists(universe_path):
        try:
            with open(universe_path, "r", encoding="utf-8") as f:
                _LIQUID_CASH_CACHE = json.load(f)
                return _LIQUID_CASH_CACHE
        except Exception as e:
            log.error(f"Failed to load liquid_cash_universe.json: {e}")
    return []

def get_upstox_instrument_key(symbol: str, exchange: str = None) -> str:
    """Returns instrument key for symbol with smart index/general fallback"""
    symbol_clean = symbol.upper().strip()
    
    # Static mapping for indices to avoid DB lookup and BSE/NSE index syncing mismatches
    static_indices = {
        "NIFTY": "NSE_INDEX|Nifty 50",
        "NIFTY50": "NSE_INDEX|Nifty 50",
        "NIFTY 50": "NSE_INDEX|Nifty 50",
        "BANKNIFTY": "NSE_INDEX|Nifty Bank",
        "NIFTY BANK": "NSE_INDEX|Nifty Bank",
        "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
        "MIDCPNIFTY": "NSE_INDEX|NIFTY MID SELECT",
        "SENSEX": "BSE_INDEX|SENSEX",
        "INDIA VIX": "NSE_INDEX|India VIX",
        "VIX": "NSE_INDEX|India VIX"
    }
    
    if symbol_clean in static_indices:
        return static_indices[symbol_clean]
        
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if exchange:
            cursor.execute(
                "SELECT instrument_key FROM upstox_instruments WHERE symbol = ? AND exchange = ?",
                (symbol_clean, exchange.upper().strip())
            )
            row = cursor.fetchone()
            if row:
                return row["instrument_key"]
                
        # Fallback: search without exchange filter prioritizing NSE_FO -> NSE_EQ -> NSE_INDEX -> BSE_INDEX
        cursor.execute("""
            SELECT instrument_key FROM upstox_instruments 
            WHERE symbol = ? 
            ORDER BY CASE exchange 
                WHEN 'NSE_FO' THEN 1 
                WHEN 'NSE_EQ' THEN 2 
                WHEN 'NSE_INDEX' THEN 3 
                WHEN 'BSE_INDEX' THEN 4 
                ELSE 5 
            END ASC
            LIMIT 1
        """, (symbol_clean,))
        
        row = cursor.fetchone()
        if row:
            return row["instrument_key"]
    except Exception as e:
        log.error(f"Error fetching Upstox key for {symbol}: {e}")
    finally:
        conn.close()
    return ""


def get_symbol_from_instrument_key(instrument_key: str) -> str:
    """Returns symbol for instrument key"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT symbol FROM upstox_instruments WHERE instrument_key = ? LIMIT 1",
            (instrument_key.strip(),)
        )
        row = cursor.fetchone()
        if row:
            return row["symbol"]
    except Exception as e:
        log.error(f"Error fetching symbol for key {instrument_key}: {e}")
    finally:
        conn.close()
    return ""

@db_write_transaction
def save_upstox_volume_avg(symbol: str, avg_volume_20d: float, avg_abs_change_20d: float, candle_count: int):
    """Saves average volume and average absolute change for a symbol"""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    now_str = datetime.now().strftime("%Y-%m-%d")
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO upstox_volume_avg (symbol, avg_volume_20d, avg_abs_change_20d, candle_count, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """, (symbol.upper().strip(), avg_volume_20d, avg_abs_change_20d, candle_count, now_str))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving volume avg for {symbol}: {e}")
        raise e
    finally:
        conn.close()

def get_upstox_volume_avg(symbol: str) -> dict:
    """Returns cached volume average for a symbol"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM upstox_volume_avg WHERE symbol = ?", (symbol.upper().strip(),))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error fetching volume avg for {symbol}: {e}")
    finally:
        conn.close()
    return None

@db_write_transaction
def save_fii_dii(date_str: str, segment: str, fii_net: float, dii_net: float):
    """Saves FII/DII net flows for a specific date and segment"""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO upstox_fii_dii (date, segment, fii_net, dii_net, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """, (date_str, segment, fii_net, dii_net, now_str))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving FII/DII: {e}")
        raise e
    finally:
        conn.close()

def get_fii_dii_history(segment: str = "FO", limit: int = 30) -> list:
    """Returns recent FII/DII flows"""
    conn = get_db_connection()
    try:
        df = pd.read_sql_query("""
            SELECT * FROM upstox_fii_dii 
            WHERE segment = ? 
            ORDER BY date DESC 
            LIMIT ?
        """, conn, params=(segment, limit))
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching FII/DII history: {e}")
        return []
    finally:
        conn.close()

@db_write_transaction
def save_market_status(segment: str, status: str, open_time: str, close_time: str):
    """Saves market status cache"""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO upstox_market_status (segment, status, open_time, close_time, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """, (segment, status, open_time, close_time, now_str))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving market status: {e}")
        raise e
    finally:
        conn.close()

def get_market_status(segment: str = "NSE_CM") -> dict:
    """Returns cached market status"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM upstox_market_status WHERE segment = ?", (segment,))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error fetching market status: {e}")
    finally:
        conn.close()
    return None

import json

# --- UPSTOX CACHE LAYER HELPERS ---

def get_cached_upstox_response(endpoint: str, params: dict) -> dict:
    """
    Looks up a cached response in upstox_cache.
    Returns: None if cache miss, or a dict containing:
      - 'data': decoded JSON payload
      - 'is_expired': bool indicating if TTL has passed
      - 'fetched_at': ISO 8601 string of when it was fetched
    """
    params_str = json.dumps(params, sort_keys=True) if params else "{}"
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT response_json, fetched_at, ttl_seconds FROM upstox_cache WHERE endpoint = ? AND params = ?",
            (endpoint, params_str)
        )
        row = cursor.fetchone()
        if row:
            fetched_at = datetime.fromisoformat(row["fetched_at"])
            ttl_seconds = row["ttl_seconds"]
            is_expired = (datetime.now() - fetched_at).total_seconds() > ttl_seconds
            try:
                data = json.loads(row["response_json"])
            except Exception:
                data = {}
            return {
                "data": data,
                "is_expired": is_expired,
                "fetched_at": row["fetched_at"]
            }
    except Exception as e:
        log.error(f"Error fetching from upstox_cache: {e}")
    finally:
        conn.close()
    return None

@db_write_transaction
def set_cached_upstox_response(endpoint: str, params: dict, response_data: dict, ttl_seconds: int):
    """Saves/replaces a response in upstox_cache"""
    params_str = json.dumps(params, sort_keys=True) if params else "{}"
    response_json = json.dumps(response_data)
    now_str = datetime.now().isoformat()
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT OR REPLACE INTO upstox_cache (endpoint, params, response_json, fetched_at, ttl_seconds)
            VALUES (?, ?, ?, ?, ?)
        """, (endpoint, params_str, response_json, now_str, ttl_seconds))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving to upstox_cache: {e}")
        raise e
    finally:
        conn.close()

@db_write_transaction
def clear_upstox_cache():
    """Clears all entries in upstox_cache"""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM upstox_cache")
        conn.commit()
        return True
    except Exception as e:
        log.error(f"Failed to clear upstox_cache: {e}")
        raise e
    finally:
        conn.close()

def get_upstox_cache_stats() -> dict:
    """Calculates active cache items, expired/stale count, and total items"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Total cached items
        cursor.execute("SELECT COUNT(*) as count FROM upstox_cache")
        total = cursor.fetchone()["count"]
        
        # Expired cached items
        cursor.execute("SELECT response_json, fetched_at, ttl_seconds FROM upstox_cache")
        rows = cursor.fetchall()
        expired_count = 0
        now = datetime.now()
        for row in rows:
            fetched_at = datetime.fromisoformat(row["fetched_at"])
            ttl = row["ttl_seconds"]
            if (now - fetched_at).total_seconds() > ttl:
                expired_count += 1
                
        cursor.execute("SELECT COUNT(*) as count FROM upstox_api_usage")
        api_calls = cursor.fetchone()["count"]
        
        return {
            "total_items": total,
            "stale_items": expired_count,
            "fresh_items": total - expired_count,
            "api_calls_logged": api_calls
        }
    except Exception as e:
        log.error(f"Failed to compute cache stats: {e}")
        return {"total_items": 0, "stale_items": 0, "fresh_items": 0, "api_calls_logged": 0}
    finally:
        conn.close()

# --- UPSTOX RATE LIMIT MONITOR HELPERS ---

def log_upstox_api_call(endpoint: str):
    """Logs the timestamp of an outbound API request"""
    now_str = datetime.now().isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO upstox_api_usage (timestamp, endpoint) VALUES (?, ?)",
            (now_str, endpoint)
        )
        conn.commit()
    except Exception as e:
        log.error(f"Failed to log API usage: {e}")
    finally:
        conn.close()

def get_upstox_api_usage(seconds_window: int = 60) -> int:
    """Returns count of requests logged in the last N seconds"""
    cutoff = (datetime.now() - timedelta(seconds=seconds_window)).isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT COUNT(*) as count FROM upstox_api_usage WHERE timestamp >= ?",
            (cutoff,)
        )
        row = cursor.fetchone()
        if row:
            return row["count"]
    except Exception as e:
        log.error(f"Failed to retrieve API usage count: {e}")
    finally:
        conn.close()
    return 0

def clean_api_usage_logs():
    """Removes API usage logs older than 24 hours to prevent db bloat"""
    cutoff = (datetime.now() - timedelta(hours=24)).isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM upstox_api_usage WHERE timestamp < ?", (cutoff,))
        conn.commit()
    except Exception as e:
        log.error(f"Failed to clean old API logs: {e}")
    finally:
        conn.close()

# --- UPSTOX ERROR & FALLBACK LOGGING HELPERS ---

def log_upstox_error(endpoint: str, error_code: int, message: str, fallback_used: str):
    """Logs an API error or fallback trigger to the DB"""
    now_str = datetime.now().isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO upstox_errors (timestamp, endpoint, error_code, message, fallback_used)
            VALUES (?, ?, ?, ?, ?)
        """, (now_str, endpoint, error_code, message, fallback_used))
        conn.commit()
    except Exception as e:
        log.error(f"Failed to log error: {e}")
    finally:
        conn.close()

def get_last_upstox_errors(limit: int = 5) -> list:
    """Retrieves the most recent API errors/warnings"""
    conn = get_db_connection()
    try:
        df = pd.read_sql_query(
            "SELECT * FROM upstox_errors ORDER BY timestamp DESC LIMIT ?",
            conn,
            params=(limit,)
        )
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Failed to get error list: {e}")
        return []
    finally:
        conn.close()

# --- UPSTOX FII/DII HISTORY HELPERS (Phase D) ---

@db_write_transaction
def save_fii_history(date_str: str, segment: str, buy_val: float, sell_val: float, net_val: float):
    """Saves daily FII/DII flow details to SQLite"""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO upstox_fii_history (date, segment, buy_value, sell_value, net_value, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (date_str, segment, buy_val, sell_val, net_val, now_str))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving FII history: {e}")
        raise e
    finally:
        conn.close()

def get_fii_history(segment: str = None, limit: int = 30) -> list:
    """Retrieves daily FII/DII flow details from SQLite"""
    conn = get_db_connection()
    try:
        if segment:
            df = pd.read_sql_query("""
                SELECT * FROM upstox_fii_history 
                WHERE segment = ? 
                ORDER BY date DESC 
                LIMIT ?
            """, conn, params=(segment, limit))
        else:
            df = pd.read_sql_query("""
                SELECT * FROM upstox_fii_history 
                ORDER BY date DESC, segment ASC 
                LIMIT ?
            """, conn, params=(limit * 5)) # Multiply limit to capture multiple segments per day
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching FII history: {e}")
        return []
    finally:
        conn.close()

def bootstrap_fii_history():
    """Bootstraps FII/DII history from public/data/fii-dii.json if table is empty"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) as count FROM upstox_fii_history")
        count = cursor.fetchone()["count"]
        if count > 0:
            return # Already has data
            
        # Locate the JSON file
        json_path = os.path.join(os.path.dirname(__file__), "..", "public", "data", "fii-dii.json")
        if not os.path.exists(json_path):
            json_path = os.path.join(os.path.dirname(__file__), "public", "data", "fii-dii.json")
            
        if not os.path.exists(json_path):
            log.info(f"FII/DII fallback file not found at {json_path}")
            return
            
        import json
        with open(json_path, "r") as f:
            data = json.load(f)
            
        initial_data = data.get("pageProps", {}).get("initialData", [])
        if not initial_data:
            initial_data = data.get("pageProps", {}).get("fiiDiiPulse", [])
            
        if not initial_data:
            log.info("No data found in fii-dii.json structure.")
            return
            
        log.info(f"Bootstrapping {len(initial_data)} days of FII/DII history...")
        now_str = datetime.now().isoformat()
        
        # Sort initial data ascending to preserve chronological insert logic if needed
        for day_item in initial_data:
            raw_date = day_item.get("date")
            if not raw_date:
                continue
            date_str = raw_date.split("T")[0] # YYYY-MM-DD
            
            # 1. Cash Market FII and DII
            fii_cash_list = day_item.get("fii_cash", [])
            for cash_item in fii_cash_list:
                cat = cash_item.get("category")
                net_val = float(cash_item.get("net_value", 0.0) or 0.0)
                if cat == "DII":
                    cursor.execute("""
                    INSERT OR REPLACE INTO upstox_fii_history (date, segment, buy_value, sell_value, net_value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, (date_str, "CM_DII", 0.0, 0.0, net_val, now_str))
                elif cat == "FII/FPI":
                    cursor.execute("""
                    INSERT OR REPLACE INTO upstox_fii_history (date, segment, buy_value, sell_value, net_value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, (date_str, "CM", 0.0, 0.0, net_val, now_str))
            
            # 2. Derivative FII (aggregate all types under 'FO')
            fii_oi_list = day_item.get("fii_oi", [])
            total_fo_net = 0.0
            for oi_item in fii_oi_list:
                net_amt = float(oi_item.get("net_amount", 0.0) or 0.0)
                total_fo_net += net_amt
                oi_type = oi_item.get("type", "").upper().replace(" ", "_")
                if oi_type:
                    cursor.execute("""
                    INSERT OR REPLACE INTO upstox_fii_history (date, segment, buy_value, sell_value, net_value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, (date_str, oi_type, 0.0, 0.0, net_amt, now_str))
            
            # Save aggregated F&O
            cursor.execute("""
            INSERT OR REPLACE INTO upstox_fii_history (date, segment, buy_value, sell_value, net_value, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (date_str, "FO", 0.0, 0.0, total_fo_net, now_str))
            
            # 3. Indices
            indices_list = day_item.get("indices", [])
            for index_item in indices_list:
                name = index_item.get("symbol_name", "").upper().replace(" ", "_")
                ltp = float(index_item.get("last_trade_price", 0.0) or 0.0)
                chg = float(index_item.get("change", 0.0) or 0.0)
                chg_pct = float(index_item.get("change_percent", 0.0) or 0.0)
                if name:
                    cursor.execute("""
                    INSERT OR REPLACE INTO upstox_fii_history (date, segment, buy_value, sell_value, net_value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, (date_str, name, ltp, chg, chg_pct, now_str))
            
        conn.commit()
        log.info("FII/DII history successfully bootstrapped.")
    except Exception as e:
        log.error(f"Failed to bootstrap FII/DII history: {e}")
    finally:
        conn.close()

def get_nse_db_cache(key: str) -> dict:
    import json
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT response_json, fetched_at, ttl_seconds FROM nse_cache WHERE cache_key = ?",
            (key,)
        )
        row = cursor.fetchone()
        if row:
            fetched_at = datetime.fromisoformat(row["fetched_at"])
            ttl_seconds = row["ttl_seconds"]
            # Check if expired
            if (datetime.now() - fetched_at).total_seconds() <= ttl_seconds:
                try:
                    return json.loads(row["response_json"])
                except Exception:
                    pass
    except Exception as e:
        log.error(f"Error fetching from nse_cache: {e}")
    finally:
        conn.close()
    return None

@db_write_transaction
def set_nse_db_cache(key: str, data, ttl_seconds: int):
    import json
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO nse_cache (cache_key, response_json, fetched_at, ttl_seconds)
        VALUES (?, ?, ?, ?)
        """, (key, json.dumps(data), now_str, ttl_seconds))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving to nse_cache: {e}")
        raise e
    finally:
        conn.close()

@db_write_transaction
def cleanup_expired_caches():
    """Removes expired entries from upstox_cache and nse_cache to prevent file size bloat"""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        now_str = datetime.now().isoformat()
        
        # SQL Bulk Deletes using datetime math
        cursor.execute("DELETE FROM upstox_cache WHERE datetime(fetched_at, ttl_seconds || ' seconds') < datetime(?)", (now_str,))
        deleted_upstox = cursor.rowcount
        
        cursor.execute("DELETE FROM nse_cache WHERE datetime(fetched_at, ttl_seconds || ' seconds') < datetime(?)", (now_str,))
        deleted_nse = cursor.rowcount
        
        # Clean API usage logs older than 24 hours
        cutoff = (datetime.now() - timedelta(hours=24)).isoformat()
        cursor.execute("DELETE FROM upstox_api_usage WHERE timestamp < ?", (cutoff,))
        deleted_usage = cursor.rowcount
        
        conn.commit()
        log.info(f"Cleaned {deleted_upstox} Upstox and {deleted_nse} NSE cache records. SQLite cleanup complete.")
        import gc
        gc.collect()
        return True
    except Exception as e:
        log.error(f"Failed to clean expired cache entries: {e}")
        raise e
    finally:
        conn.close()

@db_write_transaction
def save_ore(symbol: str, date: str, ore_score: float, direction: str, bsr: float, vs: float, cd: float, compression: float):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO ore_cache (symbol, date, ore_score, direction, bsr, vs, cd, compression, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (symbol.upper().strip(), date, ore_score, direction, bsr, vs, cd, compression, now_str))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving ORE for {symbol}: {e}")
        raise e
    finally:
        conn.close()

def get_cached_ore(symbol: str, date: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM ore_cache WHERE symbol = ? AND date = ?", (symbol.upper().strip(), date))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error fetching cached ORE for {symbol}: {e}")
    finally:
        conn.close()
    return None

def get_all_cached_ore(date: str) -> list:
    conn = get_db_connection()
    try:
        df = pd.read_sql_query("SELECT * FROM ore_cache WHERE date = ?", conn, params=(date,))
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching all cached ORE: {e}")
        return []
    finally:
        conn.close()

@db_write_transaction
def save_rs_rank(symbol: str, rs_score: float, rs_rank: float, category: str, computed_date: str):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO rs_rank_cache (symbol, rs_score, rs_rank, category, computed_date)
        VALUES (?, ?, ?, ?, ?)
        """, (symbol.upper().strip(), rs_score, rs_rank, category, computed_date))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving RS Rank for {symbol}: {e}")
        raise e
    finally:
        conn.close()

def get_cached_rs_rank(symbol: str, date: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM rs_rank_cache WHERE symbol = ? AND computed_date = ?", (symbol.upper().strip(), date))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error fetching RS Rank for {symbol}: {e}")
    finally:
        conn.close()
    return None

def get_all_cached_rs_ranks(date: str) -> list:
    conn = get_db_connection()
    try:
        df = pd.read_sql_query("SELECT * FROM rs_rank_cache WHERE computed_date = ?", conn, params=(date,))
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching all cached RS ranks: {e}")
        return []
    finally:
        conn.close()

@db_write_transaction
def save_pattern(symbol: str, patterns: str, pattern_score: float, computed_date: str):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO pattern_cache (symbol, patterns, pattern_score, computed_date)
        VALUES (?, ?, ?, ?)
        """, (symbol.upper().strip(), patterns, pattern_score, computed_date))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving patterns for {symbol}: {e}")
        raise e
    finally:
        conn.close()

def get_cached_pattern(symbol: str, date: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM pattern_cache WHERE symbol = ? AND computed_date = ?", (symbol.upper().strip(), date))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error fetching patterns for {symbol}: {e}")
    finally:
        conn.close()
    return None

def get_all_cached_patterns(date: str) -> list:
    conn = get_db_connection()
    try:
        df = pd.read_sql_query("SELECT * FROM pattern_cache WHERE computed_date = ?", conn, params=(date,))
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching all cached patterns: {e}")
        return []
    finally:
        conn.close()

@db_write_transaction
def save_shareholding_velocity(symbol: str, isin: str, fii_velocity: float, dii_velocity: float, accumulation_flag: str):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO shareholding_velocity (symbol, isin, fii_velocity, dii_velocity, accumulation_flag, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (symbol.upper().strip(), isin, fii_velocity, dii_velocity, accumulation_flag, now_str))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving shareholding velocity for {symbol}: {e}")
        raise e
    finally:
        conn.close()

def get_cached_shareholding_velocity(symbol: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM shareholding_velocity WHERE symbol = ?", (symbol.upper().strip(),))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error fetching shareholding velocity for {symbol}: {e}")
    finally:
        conn.close()
    return None

def get_all_cached_shareholding_velocities() -> list:
    conn = get_db_connection()
    try:
        df = pd.read_sql_query("SELECT * FROM shareholding_velocity", conn)
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching all shareholding velocities: {e}")
        return []
@db_write_transaction
def save_provider_capability(provider: str, capability: str, auth_mode: str, state: str, diagnostic: str):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO provider_capabilities (provider, capability, auth_mode, state, checked_at, diagnostic)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (provider.lower().strip(), capability.lower().strip(), auth_mode, state, now_str, diagnostic))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving capability {capability} for {provider}: {e}")
        raise e
    finally:
        conn.close()

def get_provider_capability(provider: str, capability: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT * FROM provider_capabilities WHERE provider = ? AND capability = ?",
            (provider.lower().strip(), capability.lower().strip())
        )
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error fetching capability {capability} for {provider}: {e}")
    finally:
        conn.close()
def get_all_provider_capabilities() -> list:
    conn = get_db_connection()
    try:
        df = pd.read_sql_query("SELECT * FROM provider_capabilities", conn)
        return df.to_dict(orient="records")
    except Exception as e:
        log.error(f"Error fetching all provider capabilities: {e}")
        return []
    finally:
        conn.close()

@db_write_transaction
def save_instrument_to_registry(canonical_id: str, asset_class: str, symbol: str, exchange: str, isin: str = None, 
                                 upstox_key: str = None, dhan_security_id: str = None, dhan_segment: str = None, 
                                 yahoo_ticker: str = None, nse_symbol: str = None, expiry: str = None, 
                                 strike: float = None, option_type: str = None, aliases: str = None, 
                                 supported_providers: str = None):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO instrument_registry 
        (canonical_id, asset_class, symbol, exchange, isin, upstox_key, dhan_security_id, dhan_segment, yahoo_ticker, nse_symbol, expiry, strike, option_type, aliases, supported_providers)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (canonical_id, asset_class, symbol, exchange, isin, upstox_key, dhan_security_id, dhan_segment, yahoo_ticker, nse_symbol, expiry, strike, option_type, aliases, supported_providers))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving instrument to registry {canonical_id}: {e}")
        raise e
    finally:
        conn.close()

@db_write_transaction
def save_instruments_to_registry_bulk(instruments: list):
    """Saves a batch of canonical instruments to registry inside a single transaction."""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        for inst in instruments:
            cursor.execute("""
            INSERT OR REPLACE INTO instrument_registry 
            (canonical_id, asset_class, symbol, exchange, isin, upstox_key, dhan_security_id, dhan_segment, yahoo_ticker, nse_symbol, expiry, strike, option_type, aliases, supported_providers)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                inst.get("canonical_id"),
                inst.get("asset_class"),
                inst.get("symbol"),
                inst.get("exchange"),
                inst.get("isin"),
                inst.get("upstox_key"),
                inst.get("dhan_security_id"),
                inst.get("dhan_segment"),
                inst.get("yahoo_ticker"),
                inst.get("nse_symbol"),
                inst.get("expiry"),
                inst.get("strike"),
                inst.get("option_type"),
                inst.get("aliases"),
                inst.get("supported_providers")
            ))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving bulk instruments to registry: {e}")
        raise e
    finally:
        conn.close()

def resolve_instrument_by_symbol(symbol: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM instrument_registry WHERE symbol = ?", (symbol.upper().strip(),))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error resolving instrument by symbol {symbol}: {e}")
    finally:
        conn.close()
    return None

def resolve_instrument_by_isin(isin: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM instrument_registry WHERE isin = ?", (isin.upper().strip(),))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error resolving instrument by ISIN {isin}: {e}")
    finally:
        conn.close()
    return None

def resolve_instrument_by_upstox_key(key: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM instrument_registry WHERE upstox_key = ?", (key,))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error resolving instrument by Upstox key {key}: {e}")
    finally:
        conn.close()
    return None

def resolve_instrument_by_dhan_id(dhan_id: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM instrument_registry WHERE dhan_security_id = ?", (dhan_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
    except Exception as e:
        log.error(f"Error resolving instrument by Dhan ID {dhan_id}: {e}")
    finally:
        conn.close()
    return None

@db_write_transaction
def clear_instrument_registry():
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM instrument_registry")
        conn.commit()
    except Exception as e:
        log.error(f"Error clearing instrument registry: {e}")
        raise e
    finally:
        conn.close()

# --- ACTIVE SUBSCRIPTIONS CACHE ---

@db_write_transaction
def save_active_subscription(client_id: str, instrument_key: str, mode: str):
    """Saves or updates an active client subscription."""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        now_str = datetime.now().isoformat()
        cursor.execute("""
            INSERT OR REPLACE INTO active_subscriptions (client_id, instrument_key, mode, last_requested_at)
            VALUES (?, ?, ?, ?)
        """, (client_id, instrument_key, mode, now_str))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving active subscription: {e}")
        raise e
    finally:
        conn.close()

@db_write_transaction
def remove_active_subscription(client_id: str, instrument_key: str):
    """Removes an active subscription for a client/instrument key."""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            DELETE FROM active_subscriptions 
            WHERE client_id = ? AND instrument_key = ?
        """, (client_id, instrument_key))
        conn.commit()
    except Exception as e:
        log.error(f"Error removing active subscription: {e}")
        raise e
    finally:
        conn.close()

@db_write_transaction
def remove_all_client_subscriptions(client_id: str):
    """Removes all active subscriptions for a client connection."""
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM active_subscriptions WHERE client_id = ?", (client_id,))
        conn.commit()
    except Exception as e:
        log.error(f"Error removing all client subscriptions: {e}")
        raise e
    finally:
        conn.close()

def get_all_aggregated_subscriptions() -> dict:
    """
    Returns aggregated instrument keys mapped to the highest requested subscription mode.
    Mode hierarchy: full_d30 (highest) > full > option_greeks > ltpc (lowest)
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT instrument_key, mode FROM active_subscriptions")
        rows = cursor.fetchall()
        
        mode_priority = {
            "full_d30": 4,
            "full": 3,
            "option_greeks": 2,
            "ltpc": 1
        }
        
        aggregated = {}
        for row in rows:
            key = row["instrument_key"]
            mode = row["mode"]
            
            if mode not in mode_priority:
                continue
                
            if key not in aggregated:
                aggregated[key] = mode
            else:
                current_mode = aggregated[key]
                if mode_priority[mode] > mode_priority[current_mode]:
                    aggregated[key] = mode
                    
        return aggregated
    except Exception as e:
        log.error(f"Error fetching aggregated subscriptions: {e}")
        return {}
    finally:
        conn.close()

def save_market_snapshot(canonical_id: str, provider: str, data_type: str, payload: dict):
    import json
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        payload_str = json.dumps(payload)
        fetched_at = datetime.now().isoformat()
        cursor.execute("""
            INSERT OR REPLACE INTO market_snapshots (canonical_id, provider, data_type, payload, fetched_at)
            VALUES (?, ?, ?, ?, ?)
        """, (canonical_id, provider, data_type, payload_str, fetched_at))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving market snapshot: {e}")
    finally:
        conn.close()

def get_market_snapshot(canonical_id: str, provider: str, data_type: str) -> dict:
    import json
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT payload, fetched_at FROM market_snapshots
            WHERE canonical_id = ? AND provider = ? AND data_type = ?
        """, (canonical_id, provider, data_type))
        row = cursor.fetchone()
        if row:
            return {
                "payload": json.loads(row["payload"]),
                "fetched_at": row["fetched_at"]
            }
        return None
    except Exception as e:
        log.error(f"Error getting market snapshot: {e}")
        return None
    finally:
        conn.close()

def save_feature_snapshot(canonical_id: str, feature_name: str, value: dict):
    import json
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        value_str = json.dumps(value)
        computed_at = datetime.now().isoformat()
        cursor.execute("""
            INSERT OR REPLACE INTO feature_snapshots (canonical_id, feature_name, value, computed_at)
            VALUES (?, ?, ?, ?)
        """, (canonical_id, feature_name, value_str, computed_at))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving feature snapshot: {e}")
    finally:
        conn.close()

def get_feature_snapshot(canonical_id: str, feature_name: str) -> dict:
    import json
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT value, computed_at FROM feature_snapshots
            WHERE canonical_id = ? AND feature_name = ?
        """, (canonical_id, feature_name))
        row = cursor.fetchone()
        if row:
            return {
                "value": json.loads(row["value"]),
                "computed_at": row["computed_at"]
            }
        return None
    except Exception as e:
        log.error(f"Error getting feature snapshot: {e}")
        return None
    finally:
        conn.close()

def log_discrepancy(canonical_id: str, field: str, upstox_val: float, dhan_val: float, delta: float):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        flagged_at = datetime.now().isoformat()
        cursor.execute("""
            INSERT OR REPLACE INTO data_discrepancies (canonical_id, field, upstox_val, dhan_val, delta, flagged_at, resolved)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        """, (canonical_id, field, upstox_val, dhan_val, delta, flagged_at))
        conn.commit()
    except Exception as e:
        log.error(f"Error logging discrepancy: {e}")
    finally:
        conn.close()

def get_active_discrepancies() -> list:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT canonical_id, field, upstox_val, dhan_val, delta, flagged_at, resolved
            FROM data_discrepancies
            WHERE resolved = 0
        """)
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        log.error(f"Error getting active discrepancies: {e}")
        return []
    finally:
        conn.close()

def resolve_discrepancy(canonical_id: str, field: str):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE data_discrepancies
            SET resolved = 1
            WHERE canonical_id = ? AND field = ? AND resolved = 0
        """, (canonical_id, field))
        conn.commit()
    except Exception as e:
        log.error(f"Error resolving discrepancy: {e}")
    finally:
        conn.close()

def log_source_health(provider: str, latency_ms: float, error_rate: float, cache_hit_ratio: float, rate_limit_pressure: float, circuit_state: str):
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        timestamp = datetime.now().isoformat()
        cursor.execute("""
            INSERT INTO source_health (provider, latency_ms, error_rate, cache_hit_ratio, rate_limit_pressure, circuit_state, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (provider, latency_ms, error_rate, cache_hit_ratio, rate_limit_pressure, circuit_state, timestamp))
        conn.commit()
    except Exception as e:
        log.error(f"Error logging source health: {e}")
    finally:
        conn.close()

def get_latest_source_health() -> list:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT sh.provider, sh.latency_ms, sh.error_rate, sh.cache_hit_ratio, sh.rate_limit_pressure, sh.circuit_state, sh.timestamp
            FROM source_health sh
            INNER JOIN (
                SELECT provider, MAX(timestamp) as max_ts
                FROM source_health
                GROUP BY provider
            ) grouped ON sh.provider = grouped.provider AND sh.timestamp = grouped.max_ts
        """)
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        log.error(f"Error getting latest source health: {e}")
        return []
    finally:
        conn.close()

def save_execution_event(event_id: str, idempotency_key: str, order_id: str, event_type: str, timestamp: str, raw_payload: dict, reconciliation_state: str = "pending"):
    import json
    conn = get_db_connection(write=True)
    cursor = conn.cursor()
    try:
        raw_payload_str = json.dumps(raw_payload)
        cursor.execute("""
            INSERT OR REPLACE INTO execution_events (event_id, idempotency_key, order_id, event_type, timestamp, raw_payload, reconciliation_state)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (event_id, idempotency_key, order_id, event_type, timestamp, raw_payload_str, reconciliation_state))
        conn.commit()
    except Exception as e:
        log.error(f"Error saving execution event: {e}")
    finally:
        conn.close()

def get_execution_event_by_idempotency_key(idempotency_key: str) -> dict:
    import json
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT event_id, idempotency_key, order_id, event_type, timestamp, raw_payload, reconciliation_state
            FROM execution_events
            WHERE idempotency_key = ?
        """, (idempotency_key,))
        row = cursor.fetchone()
        if row:
            d = dict(row)
            d["raw_payload"] = json.loads(d["raw_payload"])
            return d
        return None
    except Exception as e:
        log.error(f"Error getting execution event: {e}")
        return None
    finally:
        conn.close()

def get_execution_events() -> list:
    import json
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT event_id, idempotency_key, order_id, event_type, timestamp, raw_payload, reconciliation_state
            FROM execution_events
            ORDER BY timestamp DESC
        """)
        rows = cursor.fetchall()
        events = []
        for row in rows:
            d = dict(row)
            d["raw_payload"] = json.loads(d["raw_payload"])
            events.append(d)
        return events
    except Exception as e:
        log.error(f"Error getting execution events: {e}")
        return []
    finally:
        conn.close()

# Initialize DB on load
init_db()
bootstrap_fii_history()


