import os
import time
import shutil
import threading
from collections import deque
from datetime import datetime
import psutil
import db

# Global HTTP latency history registry
LATENCY_HISTORY = {}  # {route: deque(maxlen=100)}
_latency_lock = threading.Lock()

# Global HTTP traffic logs registry
TRAFFIC_LOGS = deque(maxlen=100)
_traffic_lock = threading.Lock()

# Global security logs registry
SECURITY_LOGS = deque(maxlen=100)
_security_lock = threading.Lock()

# Startup timeline logging state
STARTUP_TIMELINE = []
_timeline_lock = threading.Lock()
BRIDGE_START_TIME = time.perf_counter()

def record_milestone(name: str):
    elapsed = (time.perf_counter() - BRIDGE_START_TIME) * 1000
    with _timeline_lock:
        # Check if this milestone has already been logged, if so, append suffix to avoid overwrite/confusion
        existing_count = sum(1 for item in STARTUP_TIMELINE if item["milestone"].split("-")[0] == name)
        milestone_name = f"{name}-{existing_count}" if existing_count > 0 else name
        STARTUP_TIMELINE.append({
            "milestone": milestone_name,
            "elapsed_ms": round(elapsed, 1)
        })

def get_startup_timeline():
    with _timeline_lock:
        return list(STARTUP_TIMELINE)

def record_traffic(client_ip: str, method: str, path: str, status_code: int, duration_ms: float):
    with _traffic_lock:
        TRAFFIC_LOGS.append({
            "timestamp": datetime.now().isoformat(),
            "client_ip": client_ip,
            "method": method,
            "path": path,
            "status_code": status_code,
            "duration_ms": duration_ms
        })

def get_traffic_logs():
    with _traffic_lock:
        return list(TRAFFIC_LOGS)

def record_security_event(event_type: str, message: str, severity: str = "INFO", client_ip: str = "unknown"):
    with _security_lock:
        SECURITY_LOGS.append({
            "timestamp": datetime.now().isoformat(),
            "event_type": event_type,
            "message": message,
            "severity": severity,
            "client_ip": client_ip
        })

def get_security_logs():
    with _security_lock:
        return list(SECURITY_LOGS)

# Global HTTP response status counters
HTTP_STATUS_COUNTS = {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
    "exceptions": 0
}
_status_lock = threading.Lock()

def record_http_latency(route_path: str, duration_seconds: float):
    """Logs route latency into sliding window history"""
    with _latency_lock:
        if route_path not in LATENCY_HISTORY:
            LATENCY_HISTORY[route_path] = deque(maxlen=100)
        LATENCY_HISTORY[route_path].append(duration_seconds * 1000.0)  # Store in ms

def record_http_status(status_code: int):
    """Increments status code bucket telemetry"""
    group = f"{status_code // 100}xx"
    with _status_lock:
        HTTP_STATUS_COUNTS[group] = HTTP_STATUS_COUNTS.get(group, 0) + 1

def record_http_exception():
    """Increments exceptions count"""
    with _status_lock:
        HTTP_STATUS_COUNTS["exceptions"] += 1

def get_directory_size(path: str) -> float:
    """Calculates recursive directory size in Megabytes"""
    total_size = 0
    if not os.path.exists(path):
        return 0.0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if os.path.exists(fp) and not os.path.islink(fp):
                try:
                    total_size += os.path.getsize(fp)
                except OSError:
                    pass
    return total_size / (1024.0 * 1024.0)

def get_system_telemetry(fastapi_app_start_time: float) -> dict:
    """Aggregates system-wide telemetry statistics"""
    # 1. Server Uptime
    uptime = time.time() - fastapi_app_start_time
    
    # 2. Database stats
    db_stats = db.get_active_connection_stats()
    
    # Calculate row counts for key tables
    row_counts = {}
    conn = None
    try:
        conn = db.get_db_connection()
        cursor = conn.cursor()
        for table in ["upstox_cache", "nse_cache", "delivery_history", "intraday_orderflow", "upstox_errors"]:
            try:
                cursor.execute(f"SELECT COUNT(*) as cnt FROM {table}")
                row_counts[table] = cursor.fetchone()["cnt"]
            except Exception:
                row_counts[table] = 0
    except Exception:
        pass
    finally:
        if conn:
            conn.close()
            
    # 3. HTTP statistics
    with _status_lock:
        status_dist = dict(HTTP_STATUS_COUNTS)
    total_requests = sum(v for k, v in status_dist.items() if k != "exceptions")
    
    # Average latencies calculation
    latencies = {}
    with _latency_lock:
        for route, history in LATENCY_HISTORY.items():
            if history:
                calls = len(history)
                avg_val = sum(history) / calls
                sorted_hist = sorted(history)
                p50 = sorted_hist[int(calls * 0.50)]
                p90 = sorted_hist[int(calls * 0.90)]
                p99 = sorted_hist[int(calls * 0.99)] if calls >= 100 else sorted_hist[-1]
                latencies[route] = {
                    "calls": calls,
                    "avg_ms": round(avg_val, 2),
                    "p50_ms": round(p50, 2),
                    "p90_ms": round(p90, 2),
                    "p99_ms": round(p99, 2)
                }
                
    # 4. Outbound WS client telemetry
    from upstox_ws import upstox_ws_client
    ws_stats = {
        "status": upstox_ws_client.connection_status,
        "ping_time_ms": upstox_ws_client.ping_latency_ms if hasattr(upstox_ws_client, "ping_latency_ms") else -1.0,
        "active_sse_listeners": len(upstox_ws_client.listeners) if hasattr(upstox_ws_client, "listeners") else 0,
        "subscribed_keys_count": len(upstox_ws_client.subscribed_keys)
    }
    
    # 5. File size metrics
    bridge_dir = os.path.dirname(os.path.abspath(__file__))
    db_file = os.path.join(bridge_dir, "cache.db")
    parquet_dir = os.path.join(bridge_dir, "data")
    
    db_size = os.path.getsize(db_file) / (1024.0 * 1024.0) if os.path.exists(db_file) else 0.0
    parquet_size = get_directory_size(parquet_dir)
    
    # Overall drive disk space
    total, used, free = shutil.disk_usage(bridge_dir)
    
    # 6. Overall system resource stats (CPU, RAM, swap)
    sys_cpu_percent = psutil.cpu_percent(interval=None)
    sys_mem = psutil.virtual_memory()
    try:
        sys_swap = psutil.swap_memory()
        swap_used_mb = sys_swap.used / (1024 * 1024)
        swap_total_mb = sys_swap.total / (1024 * 1024)
        swap_percent = sys_swap.percent
    except Exception:
        swap_used_mb = 0.0
        swap_total_mb = 0.0
        swap_percent = 0.0

    # 7. Process specific metrics
    proc = psutil.Process(os.getpid())
    try:
        process_fds = proc.num_fds() if hasattr(proc, "num_fds") else proc.num_handles()
    except Exception:
        process_fds = 0
    process_threads = proc.num_threads() if hasattr(proc, "num_threads") else 0
    process_mem_rss = proc.memory_info().rss / (1024 * 1024)

    return {
        "status": "success",
        "timestamp": datetime.now().isoformat(),
        "server": {
            "uptime_seconds": int(uptime),
            "fastapi_version": "0.110.0"
        },
        "system": {
            "cpu_percent": sys_cpu_percent,
            "ram": {
                "total_mb": round(sys_mem.total / (1024 * 1024), 1),
                "used_mb": round(sys_mem.used / (1024 * 1024), 1),
                "free_mb": round(sys_mem.available / (1024 * 1024), 1),
                "percent": sys_mem.percent
            },
            "swap": {
                "total_mb": round(swap_total_mb, 1),
                "used_mb": round(swap_used_mb, 1),
                "percent": swap_percent
            },
            "threads_active": threading.active_count()
        },
        "process": {
            "pid": os.getpid(),
            "fds": process_fds,
            "threads": process_threads,
            "memory_rss_mb": round(process_mem_rss, 1)
        },
        "http": {
            "total_requests": total_requests,
            "status_distribution": status_dist,
            "latencies": latencies
        },
        "database": {
            "active_connections": db_stats["active_connections"],
            "peak_connections": db_stats["peak_connections"],
            "row_counts": row_counts
        },
        "websocket": ws_stats,
        "storage": {
            "cache_db_size_mb": round(db_size, 2),
            "parquet_archive_size_mb": round(parquet_size, 2),
            "disk": {
                "total_gb": round(total / (1024**3), 2),
                "free_gb": round(free / (1024**3), 2),
                "used_percent": round((used / total) * 100, 1)
            }
        }
    }

def flush_telemetry_snapshot():
    """
    Task 2D: Persists telemetry snapshot to SQLite table 'telemetry_snapshots' for historical analysis.
    Safe, non-disruptive, error-handled flush function.
    """
    try:
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telemetry_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                total_requests INTEGER,
                exceptions INTEGER,
                ws_status TEXT,
                cpu_percent REAL,
                ram_used_mb REAL
            )
        """)
        
        with _status_lock:
            total_req = sum(v for k, v in HTTP_STATUS_COUNTS.items() if k != "exceptions")
            exceptions = HTTP_STATUS_COUNTS.get("exceptions", 0)

        cpu_p = 0.0
        ram_mb = 0.0
        try:
            sys_cpu = psutil.cpu_percent(interval=None)
            cpu_p = float(sys_cpu) if sys_cpu is not None else 0.0
            proc = psutil.Process(os.getpid())
            ram_mb = proc.memory_info().rss / (1024 * 1024)
        except Exception:
            pass

        ws_stat = "unknown"
        try:
            from upstox_ws import upstox_ws_client
            ws_stat = str(upstox_ws_client.connection_status)
        except Exception:
            pass

        cursor.execute("""
            INSERT INTO telemetry_snapshots (timestamp, total_requests, exceptions, ws_status, cpu_percent, ram_used_mb)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            datetime.now().isoformat(),
            total_req,
            exceptions,
            ws_stat,
            round(cpu_p, 2),
            round(ram_mb, 2)
        ))
        conn.commit()
        conn.close()
    except Exception:
        # Telemetry snapshot flush must be completely silent and safe
        pass

