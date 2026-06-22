"""
WealthOS SRE Watchdog Daemon — Institutional Post-Production Hardening (Work Package 07)
Canonical autonomous guardian monitoring WebSocket heartbeat, memory quarantine,
SQLite WAL write health, event loop latency, and broker connection status.

Provides multi-tiered progressive escalation:
  Tier 1: Soft in-process WebSocket reconnect
  Tier 2: In-memory cache purge & garbage collection (gc.collect())
  Tier 3: Graceful PM2 worker reload (pm2 reload wealthos-api)

Dual-sink incident logging:
  - Local SQLite audit table: system_incidents
  - Synchronous Telegram Sentinel alert dispatch
"""

import os
import sys
import time
import sqlite3
import threading
import logging
import subprocess
import gc
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from collections import deque
import psutil
import httpx

# Configure logging
log = logging.getLogger("sre_watchdog")
if not log.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [SRE_WATCHDOG] %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)

IST = timezone(timedelta(hours=5, minutes=30))

# Thresholds & Windows
SILENCE_WARN_SECONDS = 15.0       # Warn if no ticks for 15s during market hours
SILENCE_RECONNECT_SECONDS = 30.0  # Trigger soft reconnect after 30s silence
SILENCE_ESCALATE_SECONDS = 120.0  # Escalate after 120s persistent silence
RECONNECT_COOLDOWN_SECONDS = 60.0 # Min seconds between reconnect triggers
MEMORY_WARN_MB = 1200.0           # Trigger GC and cache eviction
MEMORY_CRITICAL_MB = 1500.0       # Escalate to graceful PM2 reload
MAX_CONSECUTIVE_RECONNECTS = 3    # Max soft reconnects before PM2 reload escalation
EVENT_LOOP_LAG_WARN_MS = 50.0     # Event loop latency threshold
CANARY_DB_TIMEOUT_MS = 1500.0     # Max acceptable SQLite lock acquisition time

# In-Memory State
_lock = threading.Lock()
_start_time = time.time()
_last_tick_time = time.time()
_last_reconnect_trigger_time = 0.0
_consecutive_reconnect_count = 0
_last_gc_trigger_time = 0.0
_last_pm2_reload_time = 0.0
_last_wal_checkpoint_time = 0.0
_event_loop_heartbeat_time = time.time()
_event_loop_lag_ms = 0.0

# Action counters
_action_counters = {
    "soft_reconnects": 0,
    "gc_purges": 0,
    "pm2_reloads": 0,
    "wal_checkpoints": 0,
}

# Broker state
_broker_health = {
    "upstox": {"status": "unknown", "last_check": 0.0, "consecutive_errors": 0},
    "dhan": {"status": "unknown", "last_check": 0.0, "consecutive_errors": 0},
}

# Incident ring buffer (in-memory fast lookups)
_recent_incidents: deque = deque(maxlen=50)

# Path to database
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "wealthos.db")


def _init_sqlite_incidents_table():
    """Initializes the system_incidents table with WAL mode and generous busy timeout."""
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with sqlite3.connect(DB_PATH, timeout=15.0) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA busy_timeout=15000;")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS system_incidents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    subsystem TEXT NOT NULL,
                    message TEXT NOT NULL,
                    action_taken TEXT NOT NULL,
                    resolved INTEGER DEFAULT 0
                );
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_system_incidents_ts
                ON system_incidents(timestamp DESC);
            """)
    except Exception as e:
        log.error(f"Failed to initialize system_incidents table: {e}")


# Initialize table on module load
_init_sqlite_incidents_table()


def record_tick():
    """
    Thread-safe tick timestamp updater.
    Called by market feed WebSocket listeners on every incoming market tick.
    """
    global _last_tick_time
    with _lock:
        _last_tick_time = time.time()


def record_event_loop_heartbeat(lag_ms: float = 0.0):
    """Called by asyncio loop to record microsecond latency heartbeat."""
    global _event_loop_heartbeat_time, _event_loop_lag_ms
    with _lock:
        _event_loop_heartbeat_time = time.time()
        _event_loop_lag_ms = max(0.0, lag_ms)


def record_broker_status(broker: str, is_ok: bool, error_msg: str = ""):
    """Updates broker status and consecutive error counters."""
    broker_key = broker.lower()
    if broker_key not in _broker_health:
        _broker_health[broker_key] = {"status": "unknown", "last_check": 0.0, "consecutive_errors": 0}
    
    with _lock:
        info = _broker_health[broker_key]
        info["last_check"] = time.time()
        if is_ok:
            info["status"] = "healthy"
            info["consecutive_errors"] = 0
        else:
            info["status"] = "degraded"
            info["consecutive_errors"] += 1
            if info["consecutive_errors"] >= 3:
                info["status"] = "offline"
                log_incident(
                    severity="S1",
                    subsystem=f"broker_{broker_key}",
                    message=f"Broker {broker} reported 3 consecutive errors: {error_msg}",
                    action_taken="Marked broker offline; alert dispatched"
                )


def _send_telegram_alert_sync(message: str):
    """Sends a Telegram alert via synchronous HTTP REST. Never touches the asyncio event loop."""
    try:
        config_file = os.path.join(DATA_DIR, "telegram_config.json")
        token, chat_id = None, None

        if os.path.exists(config_file):
            import json
            try:
                with open(config_file, "r") as f:
                    bots = json.load(f)
                    bot = next((b for b in bots if b.get("role") == "system" and b.get("enabled")), None)
                    if not bot:
                        bot = next((b for b in bots if b.get("enabled")), None)
                    if bot:
                        token, chat_id = bot.get("token"), bot.get("chatId")
            except Exception:
                pass

        if not token or not chat_id:
            token = os.getenv("TELEGRAM_BOT_TOKEN")
            chat_id = os.getenv("TELEGRAM_CHAT_ID")

        if not token or not chat_id:
            log.warning("Telegram credentials missing. Sentinel alert skipped.")
            return

        target_chat = str(chat_id)
        thread_id = None
        if "#" in target_chat:
            parts = target_chat.split("#", 1)
            target_chat = parts[0]
            try:
                thread_id = int(parts[1])
            except ValueError:
                pass

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {"chat_id": target_chat, "text": message, "parse_mode": "HTML"}
        if thread_id is not None:
            payload["message_thread_id"] = thread_id

        httpx.post(url, json=payload, timeout=5.0)
        log.info("Telegram Sentinel alert dispatched successfully.")
    except Exception as e:
        log.error(f"Telegram Sentinel alert HTTP call failed: {e}")


def log_incident(severity: str, subsystem: str, message: str, action_taken: str = "", resolved: bool = False):
    """
    Dual-sink incident logger:
    1. Writes to SQLite system_incidents table.
    2. Keeps record in fast in-memory deque.
    3. Dispatches Telegram Sentinel alert if S0 or S1.
    """
    now_iso = datetime.now(timezone.utc).astimezone(IST).isoformat()
    record = {
        "timestamp": now_iso,
        "severity": severity,
        "subsystem": subsystem,
        "message": message,
        "action_taken": action_taken,
        "resolved": 1 if resolved else 0,
    }

    # In-memory storage
    with _lock:
        _recent_incidents.append(record)

    # SQLite persistence
    try:
        with sqlite3.connect(DB_PATH, timeout=15.0) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA busy_timeout=15000;")
            conn.execute("""
                INSERT INTO system_incidents (timestamp, severity, subsystem, message, action_taken, resolved)
                VALUES (?, ?, ?, ?, ?, ?);
            """, (now_iso, severity, subsystem, message, action_taken, 1 if resolved else 0))
    except Exception as e:
        log.error(f"Failed to record incident to SQLite: {e}")

    # Outbound Telegram notification for S0 or S1
    if severity in ("S0", "S1"):
        alert_msg = (
            f"🛡️ <b><u>WEALTHOS | SRE WATCHDOG SENTINEL</u></b>\n"
            f"⚠️ <b>SEVERITY:</b> <code>{severity}</code>\n"
            f"─────────────────────────\n"
            f"<blockquote>• <b>Subsystem:</b> <code>{subsystem}</code>\n"
            f"• <b>Message:</b> {message}\n"
            f"• <b>Action:</b> <code>{action_taken}</code></blockquote>\n"
            f"─────────────────────────\n"
            f"⚡ <i>Timestamp: {now_iso}</i>"
        )
        _send_telegram_alert_sync(alert_msg)


def _is_market_open_now() -> bool:
    """Checks if the Indian market is open right now."""
    try:
        from routers.shared import is_market_hours
        return is_market_hours()
    except Exception:
        # Fallback to local IST calculation: Mon-Fri 09:15 - 15:30
        now_ist = datetime.now(timezone.utc).astimezone(IST)
        if now_ist.weekday() >= 5:
            return False
        total_mins = now_ist.hour * 60 + now_ist.minute
        return (9 * 60 + 15) <= total_mins <= (15 * 60 + 30)


def _trigger_soft_reconnect():
    """Tier 1 Action: Soft in-process WebSocket reconnect."""
    global _last_reconnect_trigger_time, _consecutive_reconnect_count
    now = time.time()
    with _lock:
        _last_reconnect_trigger_time = now
        _consecutive_reconnect_count += 1
        _action_counters["soft_reconnects"] += 1

    log.warning(f"Triggering soft WebSocket reconnect (Attempt #{_consecutive_reconnect_count})...")
    try:
        from upstox_ws import upstox_ws_client
        upstox_ws_client.trigger_reconnect()
        log_incident(
            severity="S2",
            subsystem="feed_watchdog",
            message="Market data silence detected; soft WebSocket reconnect triggered.",
            action_taken=f"upstox_ws_client.trigger_reconnect() (Attempt #{_consecutive_reconnect_count})"
        )
    except Exception as e:
        log.error(f"Failed to trigger soft reconnect: {e}")


def _trigger_memory_purge():
    """Tier 2 Action: In-memory cache purge and garbage collection."""
    global _last_gc_trigger_time
    now = time.time()
    with _lock:
        _last_gc_trigger_time = now
        _action_counters["gc_purges"] += 1

    log.warning("Memory threshold exceeded. Triggering gc.collect() and cache purge...")
    try:
        collected = gc.collect()
        # Optionally purge any known in-memory caches
        try:
            from routers.shared import _CACHE
            if isinstance(_CACHE, dict):
                _CACHE.clear()
        except Exception:
            pass

        log_incident(
            severity="S2",
            subsystem="memory_quarantine",
            message=f"Memory threshold breached; gc.collect() recovered {collected} objects.",
            action_taken="gc.collect() + cache purge"
        )
    except Exception as e:
        log.error(f"Error during memory purge: {e}")


def _trigger_pm2_reload(reason: str):
    """Tier 3 Action: Escalate to graceful PM2 reload."""
    global _last_pm2_reload_time
    now = time.time()
    with _lock:
        # Cooldown of at least 300s between PM2 reload commands to prevent reload thrashing
        if now - _last_pm2_reload_time < 300.0:
            log.warning("PM2 reload cooldown active. Skipping reload invocation.")
            return
        _last_pm2_reload_time = now
        _action_counters["pm2_reloads"] += 1

    log.critical(f"🚨 ESCALATING TO PM2 WORKER RELOAD! Reason: {reason}")
    log_incident(
        severity="S1",
        subsystem="sre_watchdog",
        message=f"Critical threshold breach ({reason}). Triggering graceful worker reload.",
        action_taken="pm2 reload wealthos-api --update-env"
    )

    try:
        # Execute PM2 reload asynchronously via subprocess
        # Using PM2 reload ensures zero dropped connections
        subprocess.Popen(
            ["pm2", "reload", "wealthos-api", "--update-env"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=False
        )
        log.info("pm2 reload wealthos-api command dispatched.")
    except Exception as e:
        log.error(f"Failed to invoke pm2 reload command: {e}")


def _check_sqlite_wal_health():
    """Probe 4: Verifies SQLite WAL responsiveness and executes passive checkpoint."""
    global _last_wal_checkpoint_time
    now = time.time()
    start_t = time.perf_counter()
    try:
        with sqlite3.connect(DB_PATH, timeout=15.0) as conn:
            conn.execute("PRAGMA busy_timeout=15000;")
            conn.execute("SELECT 1;").fetchone()
            duration_ms = (time.perf_counter() - start_t) * 1000.0

            if duration_ms > CANARY_DB_TIMEOUT_MS:
                log.warning(f"SQLite canary query took {duration_ms:.1f}ms (> {CANARY_DB_TIMEOUT_MS}ms).")
                log_incident(
                    severity="S2",
                    subsystem="sqlite_wal",
                    message=f"High database acquisition latency: {duration_ms:.1f}ms",
                    action_taken="Warning logged"
                )

            # Passive checkpoint every 10 minutes
            if now - _last_wal_checkpoint_time > 600.0:
                with _lock:
                    _last_wal_checkpoint_time = now
                    _action_counters["wal_checkpoints"] += 1
                conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
                log.info("SQLite passive WAL checkpoint executed successfully.")
    except Exception as e:
        log.error(f"SQLite WAL health check failed: {e}")
        log_incident(
            severity="S1",
            subsystem="sqlite_wal",
            message=f"SQLite health check exception: {e}",
            action_taken="Investigate database file contention"
        )


def _watchdog_sentinel_loop():
    """Main continuous evaluation loop executing all probes every 5 seconds."""
    log.info("Autonomous SRE Watchdog sentinel loop initialized.")
    # Allow 15s settling window on startup
    time.sleep(15.0)

    while True:
        try:
            time.sleep(5.0)
            now = time.time()

            # ----------------------------------------------------
            # PROBE 1: Tick Freshness (Market hours only)
            # ----------------------------------------------------
            market_open = _is_market_open_now()
            if market_open:
                with _lock:
                    silence_duration = now - _last_tick_time
                    time_since_last_reconnect = now - _last_reconnect_trigger_time

                if silence_duration >= SILENCE_RECONNECT_SECONDS:
                    if time_since_last_reconnect >= RECONNECT_COOLDOWN_SECONDS:
                        if _consecutive_reconnect_count >= MAX_CONSECUTIVE_RECONNECTS:
                            _trigger_pm2_reload(f"Feed silence for {silence_duration:.0f}s after {_consecutive_reconnect_count} soft reconnects")
                        else:
                            _trigger_soft_reconnect()
                else:
                    # Reset consecutive reconnect count if ticks are flowing smoothly
                    with _lock:
                        if _consecutive_reconnect_count > 0:
                            _consecutive_reconnect_count = 0

            # ----------------------------------------------------
            # PROBE 2: Process Memory RSS Quarantine
            # ----------------------------------------------------
            try:
                proc = psutil.Process()
                mem_info = proc.memory_info()
                rss_mb = mem_info.rss / (1024.0 * 1024.0)

                if rss_mb >= MEMORY_CRITICAL_MB:
                    _trigger_pm2_reload(f"RSS memory {rss_mb:.1f}MB breached critical threshold {MEMORY_CRITICAL_MB}MB")
                elif rss_mb >= MEMORY_WARN_MB:
                    with _lock:
                        time_since_gc = now - _last_gc_trigger_time
                    if time_since_gc >= 120.0:
                        _trigger_memory_purge()
            except Exception as e:
                log.error(f"Error checking process memory in watchdog: {e}")

            # ----------------------------------------------------
            # PROBE 3: SQLite WAL Health
            # ----------------------------------------------------
            _check_sqlite_wal_health()

        except Exception as e:
            log.error(f"Unhandled exception in SRE Watchdog sentinel loop: {e}")


def get_sre_status() -> Dict[str, Any]:
    """Returns the comprehensive real-time health and diagnostics status."""
    now = time.time()
    try:
        proc = psutil.Process()
        mem_info = proc.memory_info()
        rss_mb = round(mem_info.rss / (1024.0 * 1024.0), 2)
        vms_mb = round(mem_info.vms / (1024.0 * 1024.0), 2)
        cpu_pct = round(proc.cpu_percent(interval=None), 2)
    except Exception:
        rss_mb, vms_mb, cpu_pct = 0.0, 0.0, 0.0

    with _lock:
        silence_s = round(now - _last_tick_time, 1)
        uptime_s = round(now - _start_time, 1)
        lag_ms = round(_event_loop_lag_ms, 2)
        recent = list(_recent_incidents)
        actions = dict(_action_counters)
        brokers = dict(_broker_health)

    market_open = _is_market_open_now()

    # Determine overall health status
    overall_status = "healthy"
    if rss_mb >= MEMORY_WARN_MB or (market_open and silence_s >= SILENCE_WARN_SECONDS):
        overall_status = "degraded"
    if rss_mb >= MEMORY_CRITICAL_MB or (market_open and silence_s >= SILENCE_RECONNECT_SECONDS):
        overall_status = "critical"

    return {
        "status": overall_status,
        "uptime_seconds": uptime_s,
        "market_open": market_open,
        "memory": {
            "rss_mb": rss_mb,
            "vms_mb": vms_mb,
            "cpu_percent": cpu_pct,
            "warn_threshold_mb": MEMORY_WARN_MB,
            "critical_threshold_mb": MEMORY_CRITICAL_MB,
            "status": "critical" if rss_mb >= MEMORY_CRITICAL_MB else ("degraded" if rss_mb >= MEMORY_WARN_MB else "healthy")
        },
        "feed": {
            "last_tick_age_seconds": silence_s,
            "warn_threshold_seconds": SILENCE_WARN_SECONDS,
            "reconnect_threshold_seconds": SILENCE_RECONNECT_SECONDS,
            "status": "stale" if (market_open and silence_s >= SILENCE_WARN_SECONDS) else "flowing"
        },
        "event_loop": {
            "lag_ms": lag_ms,
            "threshold_ms": EVENT_LOOP_LAG_WARN_MS,
            "status": "degraded" if lag_ms > EVENT_LOOP_LAG_WARN_MS else "nominal"
        },
        "brokers": brokers,
        "actions_taken": actions,
        "recent_incidents": recent[-10:],
    }


def start_sre_watchdog():
    """Spawns the Autonomous SRE Watchdog daemon thread."""
    t = threading.Thread(target=_watchdog_sentinel_loop, daemon=True, name="SREWatchdogDaemon")
    t.start()
    log.info("Autonomous SRE Watchdog background thread spawned successfully.")
