import os
import sqlite3
import json
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

def get_data_dir() -> str:
    candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data")),
        "/home/ubuntu/WealthOS/data",
        os.path.abspath("data")
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    os.makedirs(candidates[0], exist_ok=True)
    return candidates[0]

DATA_DIR = get_data_dir()
DB_PATH = os.path.join(DATA_DIR, "autopilot.db")

def get_ist_now_str() -> str:
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).strftime("%Y-%m-%d %H:%M:%S")

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_autopilot_db():
    """Initializes the SQLite schema for the Autopilot Reinforcement Learning Engine."""
    conn = get_connection()
    cur = conn.cursor()

    # 1. Telemetry table (trade excursions & outcomes)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS autopilot_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT UNIQUE,
        order_id TEXT,
        channel_id TEXT,
        channel_name TEXT,
        underlying TEXT,
        symbol TEXT,
        exchange TEXT,
        action TEXT,
        option_type TEXT,
        strike REAL,
        quantity REAL,
        entry_price REAL,
        exit_price REAL,
        initial_sl REAL,
        current_sl REAL,
        highest_ltp REAL,
        lowest_ltp REAL,
        mfe_pct REAL,
        mae_pct REAL,
        mfe_capture_ratio REAL,
        duration_seconds REAL,
        pnl REAL,
        pnl_pct REAL,
        exit_reason TEXT,
        regime TEXT DEFAULT 'TRENDING',
        status TEXT,
        created_at TEXT,
        closed_at TEXT
    )
    """)

    # 2. Hyperparameters table (5 adaptive reinforcement parameters per regime)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS autopilot_hyperparameters (
        regime TEXT PRIMARY KEY,
        theta_conviction REAL DEFAULT 0.70,
        alpha_sl REAL DEFAULT 0.95,
        beta_trail REAL DEFAULT 1.00,
        lambda_slack REAL DEFAULT 1.05,
        gamma_t1 REAL DEFAULT 1.15,
        updated_at TEXT
    )
    """)

    # 3. Parameter modification audit log
    cur.execute("""
    CREATE TABLE IF NOT EXISTS autopilot_parameter_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        regime TEXT,
        parameter_name TEXT,
        old_value REAL,
        new_value REAL,
        reason TEXT,
        changed_by TEXT,
        timestamp TEXT
    )
    """)

    # 4. Daily performance summaries
    cur.execute("""
    CREATE TABLE IF NOT EXISTS autopilot_daily_summaries (
        date TEXT PRIMARY KEY,
        total_trades INTEGER,
        winning_trades INTEGER,
        losing_trades INTEGER,
        total_pnl REAL,
        win_rate REAL,
        avg_mfe_pct REAL,
        avg_mae_pct REAL,
        rejected_orders INTEGER,
        top_performer_channel TEXT,
        worst_performer_channel TEXT,
        regime_detected TEXT,
        summary_json TEXT,
        created_at TEXT
    )
    """)

    # Seed baseline hyperparameters for standard market regimes if empty
    cur.execute("SELECT count(*) FROM autopilot_hyperparameters")
    if cur.fetchone()[0] == 0:
        now = get_ist_now_str()
        default_regimes = [
            ("TRENDING", 0.70, 0.95, 1.00, 1.05, 1.15, now),
            ("RANGING", 0.75, 0.97, 0.98, 1.03, 1.10, now),
            ("HIGH_VOLATILITY", 0.80, 0.92, 1.00, 1.08, 1.25, now),
            ("LOW_VOLATILITY", 0.65, 0.96, 1.00, 1.02, 1.08, now)
        ]
        cur.executemany("""
        INSERT INTO autopilot_hyperparameters
        (regime, theta_conviction, alpha_sl, beta_trail, lambda_slack, gamma_t1, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, default_regimes)

    conn.commit()
    conn.close()

# Auto-initialize tables on module import
init_autopilot_db()

def insert_or_update_telemetry(record: Dict[str, Any]) -> bool:
    """Inserts or updates a trade excursion telemetry record."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
        INSERT INTO autopilot_telemetry (
            trade_id, order_id, channel_id, channel_name, underlying, symbol,
            exchange, action, option_type, strike, quantity, entry_price,
            exit_price, initial_sl, current_sl, highest_ltp, lowest_ltp,
            mfe_pct, mae_pct, mfe_capture_ratio, duration_seconds, pnl,
            pnl_pct, exit_reason, regime, status, created_at, closed_at
        ) VALUES (
            :trade_id, :order_id, :channel_id, :channel_name, :underlying, :symbol,
            :exchange, :action, :option_type, :strike, :quantity, :entry_price,
            :exit_price, :initial_sl, :current_sl, :highest_ltp, :lowest_ltp,
            :mfe_pct, :mae_pct, :mfe_capture_ratio, :duration_seconds, :pnl,
            :pnl_pct, :exit_reason, :regime, :status, :created_at, :closed_at
        )
        ON CONFLICT(trade_id) DO UPDATE SET
            order_id=excluded.order_id,
            exit_price=excluded.exit_price,
            highest_ltp=excluded.highest_ltp,
            lowest_ltp=excluded.lowest_ltp,
            mfe_pct=excluded.mfe_pct,
            mae_pct=excluded.mae_pct,
            mfe_capture_ratio=excluded.mfe_capture_ratio,
            duration_seconds=excluded.duration_seconds,
            pnl=excluded.pnl,
            pnl_pct=excluded.pnl_pct,
            exit_reason=excluded.exit_reason,
            status=excluded.status,
            closed_at=excluded.closed_at
        """, record)
        conn.commit()
        return True
    except Exception as e:
        print(f"[AutopilotDB Error] Failed to insert telemetry: {e}")
        return False
    finally:
        conn.close()

def get_recent_telemetry(limit: int = 100) -> List[Dict[str, Any]]:
    """Fetches recent telemetry records sorted newest first."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM autopilot_telemetry ORDER BY id DESC LIMIT ?", (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def get_hyperparameters(regime: str = "TRENDING") -> Dict[str, Any]:
    """Fetches active hyperparameters for a given regime."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM autopilot_hyperparameters WHERE regime = ?", (regime,))
    row = cur.fetchone()
    conn.close()
    if row:
        return dict(row)
    return {
        "regime": regime,
        "theta_conviction": 0.70,
        "alpha_sl": 0.95,
        "beta_trail": 1.00,
        "lambda_slack": 1.05,
        "gamma_t1": 1.15
    }

def update_hyperparameter(regime: str, param_name: str, new_val: float, reason: str = "", changed_by: str = "AI_Pool") -> bool:
    """Updates a hyperparameter and writes an audit log to autopilot_parameter_history."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT {param_name} FROM autopilot_hyperparameters WHERE regime = ?", (regime,))
        old_row = cur.fetchone()
        old_val = old_row[0] if old_row else 0.0

        now = get_ist_now_str()
        cur.execute(f"""
        UPDATE autopilot_hyperparameters
        SET {param_name} = ?, updated_at = ?
        WHERE regime = ?
        """, (new_val, now, regime))

        cur.execute("""
        INSERT INTO autopilot_parameter_history
        (regime, parameter_name, old_value, new_value, reason, changed_by, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (regime, param_name, old_val, new_val, reason, changed_by, now))

        conn.commit()
        return True
    except Exception as e:
        print(f"[AutopilotDB Error] Failed to update hyperparameter {param_name}: {e}")
        return False
    finally:
        conn.close()

def save_daily_summary(summary: Dict[str, Any]) -> bool:
    """Inserts or updates a daily performance summary."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
        INSERT INTO autopilot_daily_summaries (
            date, total_trades, winning_trades, losing_trades, total_pnl,
            win_rate, avg_mfe_pct, avg_mae_pct, rejected_orders,
            top_performer_channel, worst_performer_channel, regime_detected,
            summary_json, created_at
        ) VALUES (
            :date, :total_trades, :winning_trades, :losing_trades, :total_pnl,
            :win_rate, :avg_mfe_pct, :avg_mae_pct, :rejected_orders,
            :top_performer_channel, :worst_performer_channel, :regime_detected,
            :summary_json, :created_at
        )
        ON CONFLICT(date) DO UPDATE SET
            total_trades=excluded.total_trades,
            winning_trades=excluded.winning_trades,
            losing_trades=excluded.losing_trades,
            total_pnl=excluded.total_pnl,
            win_rate=excluded.win_rate,
            avg_mfe_pct=excluded.avg_mfe_pct,
            avg_mae_pct=excluded.avg_mae_pct,
            rejected_orders=excluded.rejected_orders,
            top_performer_channel=excluded.top_performer_channel,
            worst_performer_channel=excluded.worst_performer_channel,
            regime_detected=excluded.regime_detected,
            summary_json=excluded.summary_json
        """, summary)
        conn.commit()
        return True
    except Exception as e:
        print(f"[AutopilotDB Error] Failed to save daily summary: {e}")
        return False
    finally:
        conn.close()
