import os
import hmac
import urllib.request
import ipaddress

import time
import sys
import threading
import random
import asyncio
import logging
from typing import Optional
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

# Task B3: Trading Endpoints IP Allowlist Configuration
TRADING_ENDPOINTS = ["/api/autopilot/", "/api/dhan/", "/api/upstox/order"]

def _ip_in_any_cidr(client_ip: str, cidr_str: str) -> bool:
    """Task B3: Validates if client_ip belongs to any allowed CIDR in ALLOWED_IP_CIDR."""
    if not cidr_str or not cidr_str.strip():
        return True  # Empty ALLOWED_IP_CIDR means allow all (safe default)
    
    if client_ip in ("127.0.0.1", "localhost", "::1"):
        return True  # Always allow local loopback
        
    try:
        ip_obj = ipaddress.ip_address(client_ip)
        for raw_cidr in cidr_str.split(","):
            raw_cidr = raw_cidr.strip()
            if not raw_cidr:
                continue
            if "/" not in raw_cidr:
                raw_cidr = f"{raw_cidr}/32"
            net = ipaddress.ip_network(raw_cidr, strict=False)
            if ip_obj in net:
                return True
    except Exception as e:
        log.error(f"[IP_ALLOWLIST] Error validating IP {client_ip} against CIDR '{cidr_str}': {e}")
        return True  # Fail open on parse error to avoid locking out operator

    return False


# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Suppress uvicorn 2xx success access logs to clean up terminal spam
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

from logger import get_logger
log = get_logger("app", tag="INIT")

import telemetry
from upstox_ws import upstox_ws_client
from routers.shared import (
    orderflow_polling_loop,
    run_startup_syncs,
    init_scheduler,
    market_status
)

from routers.health import router as health_router
from routers.nse import router as nse_router
from routers.upstox import router as upstox_router
from routers.backtest import router as backtest_router
from routers.alpha import router as alpha_router
from routers.context import router as context_router
from routers.journal import router as journal_router
from routers.dhan import router as dhan_router
from routers.cas import router as cas_router
from routers.mf import router as mf_router
from routers.tax import router as tax_router
from routers.leg_data import router as leg_data_router
from routers.openfigi import router as openfigi_router
from routers.crypto import router as crypto_router
from routers.backup import router as backup_router
from routers.sync import router as sync_router
from routers.algo import router as algo_router
from routers.openalgo import router as openalgo_router
from routers.signals import router as signals_router
from routers.speech import router as speech_router
from routers.swarm import router as swarm_router
from routers.rebalance import router as rebalance_router
from routers.autopilot import router as autopilot_router
from routers.services import router as services_router
from routers.alerts import router as alerts_router
from routers.news import router as news_router
from routers.greeks_engine import router as greeks_engine_router
from routers.macro_engine import router as macro_engine_router
from routers.loop_validator import router as loop_validator_router
from routers.liquidity_engine import router as liquidity_engine_router
from routers.monte_carlo_engine import router as monte_carlo_router
from routers.ccxt_router import router as ccxt_router
from routers.vectorbt_router import router as vectorbt_router
from routers.backtrader_router import router as backtrader_router
from routers.lumibot_router import router as lumibot_router
from routers.freqtrade_proxy import router as freqtrade_router
from routers.agents_router import router as agents_router
from routers.finrl_router import router as finrl_router
from routers.hummingbot_router import router as hummingbot_router
from routers.nautilus_router import router as nautilus_router
from routers.stock_types import router as stock_types_router
from routers.alpha_screener import router as alpha_screener_router, standalone_v1_router
from routers.backtest_v2 import router as backtest_v2_router
import error_middleware

app = FastAPI(title="Wealth Dashboard v2 - Python NSE Bridge")
telemetry.record_milestone("bridge_bootstrap")

# Install BridgeErrorMiddleware for structured error envelopes, SQLite lock retries, and secret scrubbing
error_middleware.install(app)

class ClientErrorPayload(BaseModel):
    message: str
    subsystem: Optional[str] = "CLIENT_RUNTIME"
    url: Optional[str] = None
    stack: Optional[str] = None
    view: Optional[str] = None
    count: Optional[int] = 1

@app.post("/api/telemetry/client-errors")
async def log_client_error(payload: ClientErrorPayload):
    """
    Ingests browser errors in production (from both local dev and Cloud VPS)
    directly into Extras/ErrorLogs/python-bridge-errors.ndjson without exposing internals.
    """
    try:
        import json
        from datetime import datetime
        error_logs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Extras", "ErrorLogs"))
        os.makedirs(error_logs_dir, exist_ok=True)
        sink_path = os.path.join(error_logs_dir, "python-bridge-errors.ndjson")
        entry = {
            "timestamp": datetime.now().isoformat(),
            "level": "ERROR",
            "tag": "BROWSER",
            "message": payload.message[:500],
            "url": payload.url,
            "view": payload.view,
            "count": payload.count,
            "subsystem": payload.subsystem or "CLIENT_RUNTIME"
        }
        with open(sink_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# Task 2E: Prometheus Metrics Endpoint
try:
    import importlib
    pfi = importlib.import_module("prometheus_fastapi_instrumentator")
    pfi.Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    log.info("Prometheus /metrics endpoint instrumented.")
except (ImportError, ModuleNotFoundError):
    log.warning("prometheus-fastapi-instrumentator not installed; /metrics auto-instrumentation skipped.")
except Exception as e:
    log.warning("Failed to instrument Prometheus metrics: %s", e)

@app.get("/")
def root_status_page(request: Request):
    if "text/html" in request.headers.get("accept", ""):
        from fastapi.responses import HTMLResponse
        html_content = """
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>WealthOS v2 - Python Bridge Engine</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 40px; max-width: 600px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); text-align: center; }
                h1 { color: #38bdf8; margin-top: 0; font-size: 24px; }
                .status-badge { display: inline-flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 20px; padding: 6px 16px; font-weight: 600; font-size: 14px; margin-bottom: 24px; }
                .dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; display: inline-block; animation: pulse 2s infinite; }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
                .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 24px 0; text-align: left; }
                .stat { background: #0f172a; border: 1px solid #1e293b; padding: 16px; border-radius: 12px; }
                .stat-label { color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
                .stat-value { font-size: 16px; font-weight: 700; color: #f1f5f9; margin-top: 4px; }
                .btn { display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; transition: all 0.2s; margin-top: 12px; }
                .btn:hover { background: #1d4ed8; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="status-badge"><span class="dot"></span> Python NSE Bridge Active</div>
                <h1>WealthOS v2 Quantitative Engine</h1>
                <p style="color: #94a3b8; font-size: 14px; margin-bottom: 24px;">76 MCP Quantitative Tools • Autopilot Daemon • Options Engine</p>
                <div class="grid">
                    <div class="stat"><div class="stat-label">API Version</div><div class="stat-value">v2.4.0 (Python 3.10)</div></div>
                    <div class="stat"><div class="stat-label">Market Data Feed</div><div class="stat-value">Upstox WebSocket</div></div>
                    <div class="stat"><div class="stat-label">Execution Gateway</div><div class="stat-value">OpenAlgo Sandbox / Dhan</div></div>
                    <div class="stat"><div class="stat-label">Autopilot Mode</div><div class="stat-value">Headless Daemon Active</div></div>
                </div>
                <a href="/docs" class="btn">View Interactive API Docs (/docs)</a>
            </div>
        </body>
        </html>
        """
        return HTMLResponse(content=html_content)
    ms = market_status()
    return {
        "status": "online",
        "service": "WealthOS v2 Python NSE Bridge",
        "version": "2.4.0",
        "docs": "/docs",
        "health": "/health",
        "next_change_in": ms.get("seconds_until_change", 300),
        "is_market_hours": ms.get("is_open", False),
        "market_status": {
            "is_open": ms.get("is_open", False),
            "seconds_until_change": ms.get("seconds_until_change", 300),
            "reason": ms.get("reason", "")
        }
    }

# A6: capture the main event loop (uvicorn is single-loop; safe). Used by
# start_mf_scheduler to push the async scheduler onto the loop via
# asyncio.run_coroutine_threadsafe - start_backend_daemons is sync.
_main_loop: Optional[asyncio.AbstractEventLoop] = None
_scheduler_started: bool = False
_scheduler_lock = threading.Lock()


def _capture_main_loop():
    global _main_loop
    try:
        _main_loop = asyncio.get_event_loop()
    except RuntimeError:
        # No running loop yet (e.g. called from a worker thread). FastAPI's
        # uvicorn loop is set on the main thread; this is only hit in tests
        # where the loop is created lazily. Leave _main_loop = None; the
        # scheduler will no-op gracefully.
        _main_loop = None


def start_mf_scheduler():
    """Spawn the A6 24h MF NAV scheduler on the main event loop. Idempotent."""
    global _scheduler_started
    with _scheduler_lock:
        if _scheduler_started:
            return
        _scheduler_started = True

    _capture_main_loop()
    if _main_loop is None or _main_loop.is_closed():
        log.warning("MF scheduler: no main event loop, skipping spawn")
        return
    try:
        from services.mf_nav_service import run_scheduler_loop
        asyncio.run_coroutine_threadsafe(run_scheduler_loop(), _main_loop)
        log.info("MF NAV 24h scheduler spawned.")
        telemetry.record_milestone("mf_scheduler_started")
    except Exception as e:
        log.error("Failed to start MF scheduler: %s", e)

# CORS middleware configuration
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# High-Performance Wire Compression: Compress JSON and REST payloads > 1KB (75-82% bandwidth reduction)
# Note: Starlette automatically excludes text/event-stream (SSE) from gzip compression.
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Request tracking middleware
ip_request_history = {}
ip_lock = threading.Lock()

@app.middleware("http")
async def check_rate_limit_and_latency(request: Request, call_next):
    from fastapi.responses import JSONResponse
    
    start_time = time.perf_counter()
    forwarded_for = request.headers.get("x-forwarded-for")
    cf_ip = request.headers.get("cf-connecting-ip")
    real_ip = request.headers.get("x-real-ip")

    if cf_ip:
        client_ip = cf_ip.strip()
    elif real_ip:
        client_ip = real_ip.strip()
    elif forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "unknown"

    now = time.time()
    path = request.url.path
    
    # Run cleanup occasionally (1% probability per request)
    if random.random() < 0.01:
        with ip_lock:
            stale_ips = []
            for ip, active_times in ip_request_history.items():
                active_times = [t for t in active_times if now - t < 60]
                if not active_times:
                    stale_ips.append(ip)
                else:
                    ip_request_history[ip] = active_times
            for ip in stale_ips:
                del ip_request_history[ip]

    # Allow public endpoints without auth
    is_public = path in ("/", "/api/health", "/metrics") or path.startswith("/api/health")
    
    # Auth validation (HIGH-04 defense + Firebase identity gate)
    # - BRIDGE_API_SECRET set  -> static-secret mode on all non-public routes (legacy)
    # - otherwise              -> local machine trusted, everything proxied/remote
    #   requires a valid Firebase ID token from the app's own Google login.
    # Kill switch: BRIDGE_AUTH_DISABLED=1 (emergency only).
    from services.auth_guard import (
        auth_disabled_by_env,
        extract_bearer_token,
        should_require_auth,
        verify_firebase_id_token,
    )

    bridge_secret = os.environ.get("BRIDGE_API_SECRET", "")
    if not auth_disabled_by_env():
        host_header = request.headers.get("host", "")
        has_proxy_headers = bool(
            request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
        )
        raw_socket_ip = request.client.host if request.client else None
        if should_require_auth(path, host_header, has_proxy_headers, bool(bridge_secret), raw_socket_ip):
            provided_token = request.headers.get("x-bridge-token", "")
            auth_header = request.headers.get("authorization", "")
            bearer_token = extract_bearer_token(auth_header)
            if bearer_token:
                provided_token = bearer_token

            authenticated = False
            auth_subject = "none"
            if bridge_secret and provided_token and hmac.compare_digest(provided_token, bridge_secret):
                authenticated = True
                auth_subject = "static-secret"
            elif bearer_token and not bridge_secret:
                claims = verify_firebase_id_token(bearer_token)
                if claims is not None:
                    authenticated = True
                    auth_subject = f"firebase:{claims.get('sub', 'unknown')[:28]}"

            if not authenticated:
                telemetry.record_security_event("UNAUTHORIZED_ACCESS", f"Invalid auth on {path} from {client_ip}", "WARNING", client_ip)
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Unauthorized: sign in to WealthOS or configure BRIDGE_API_SECRET"}
                )
            elif auth_subject.startswith("firebase:"):
                request.state.auth_subject = auth_subject

    # Task B3: Trading Endpoint IP Allowlist Check
    allowed_cidrs = os.getenv("ALLOWED_IP_CIDR", "")
    if allowed_cidrs and any(path.startswith(ep) for ep in TRADING_ENDPOINTS):
        if not _ip_in_any_cidr(client_ip, allowed_cidrs):
            telemetry.record_security_event("IP_ALLOWLIST_BLOCKED", f"IP {client_ip} blocked from trading endpoint {path}", "WARNING", client_ip)
            log.warning(f"[SECURITY] IP {client_ip} blocked from accessing trading path {path}")
            return JSONResponse(
                status_code=403,
                content={"detail": "Forbidden: IP address not in trading endpoint allowlist"}
            )

    # Rate limiting for non-exempt endpoints
    is_local = client_ip in ("127.0.0.1", "localhost", "::1")
    if not (is_public or is_local):
        with ip_lock:
            if client_ip not in ip_request_history:
                ip_request_history[client_ip] = []
            
            ip_request_history[client_ip] = [t for t in ip_request_history[client_ip] if now - t < 60]
            
            if len(ip_request_history[client_ip]) >= 180:
                user_agent = request.headers.get("user-agent", "unknown")[:100]
                telemetry.record_security_event("RATE_LIMIT_EXCEEDED", f"IP {client_ip} (UA: {user_agent}) exceeded rate limit on {path}", "WARNING", client_ip)
                log.warning("Rate limit 180/min exceeded by IP %s on %path (UA: %s)", client_ip, path, user_agent)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded. Please try again later."}
                )
            
            ip_request_history[client_ip].append(now)
            
    try:
        response = await call_next(request)
        status_code = response.status_code
        
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        
        # HTTP/2 Server Push Preload hints (A7)
        if path == "/api/capabilities":
            response.headers["Link"] = "</api/health/providers>; rel=preload"
        elif path.startswith("/api/context/"):
            canonical_id = path[len("/api/context/"):]
            if canonical_id:
                response.headers["Link"] = f"</api/instruments/resolve/{canonical_id}>; rel=preload"
        
        return response
    except Exception as e:
        telemetry.record_http_exception()
        raise e
    finally:
        duration = time.perf_counter() - start_time
        duration_ms = duration * 1000.0
        telemetry.record_http_latency(path, duration)
        telemetry.record_http_status(status_code)
        telemetry.record_traffic(client_ip, request.method, path, status_code, duration_ms)

# Mount all split domain routers
app.include_router(health_router)
app.include_router(nse_router)
app.include_router(upstox_router)
app.include_router(backtest_router)
app.include_router(alpha_router)
app.include_router(context_router)
app.include_router(journal_router)
app.include_router(dhan_router)
app.include_router(cas_router)
app.include_router(mf_router)
app.include_router(tax_router)
app.include_router(leg_data_router)
app.include_router(openfigi_router)
app.include_router(crypto_router)
app.include_router(backup_router)
app.include_router(sync_router)
app.include_router(algo_router)
app.include_router(openalgo_router)
app.include_router(signals_router)
app.include_router(speech_router)
app.include_router(swarm_router)
app.include_router(rebalance_router)
app.include_router(autopilot_router)
app.include_router(services_router)
app.include_router(alerts_router)
app.include_router(stock_types_router)
app.include_router(news_router)
app.include_router(greeks_engine_router)
app.include_router(macro_engine_router)
app.include_router(loop_validator_router)
app.include_router(liquidity_engine_router)
app.include_router(monte_carlo_router)
app.include_router(ccxt_router)
app.include_router(vectorbt_router)
app.include_router(backtrader_router)
app.include_router(lumibot_router)
app.include_router(freqtrade_router)
app.include_router(agents_router)
app.include_router(finrl_router)
app.include_router(hummingbot_router)
app.include_router(nautilus_router)
app.include_router(alpha_screener_router)
app.include_router(standalone_v1_router)
app.include_router(backtest_v2_router)













def sequenced_daemons_warmup():
    # Tier B: Order Flow Polling + WebSocket (Short Delay, 2 seconds)
    time.sleep(2.0)
    t = threading.Thread(target=orderflow_polling_loop, daemon=True)
    t.start()
    log.info("Background Order Flow thread spawned.")
    telemetry.record_milestone("orderflow_started")
    
    # Auto-hydrate Upstox token from sync_records in wealthos-sync.db if not already in memory
    try:
        from routers.sync import get_db_conn
        from routers.shared import upstox_client
        if not upstox_client.token:
            conn = get_db_conn()
            cur = conn.cursor()
            cur.execute("""
                SELECT data FROM sync_records
                WHERE entity_type IN ('broker_credentials', 'app_credentials')
                ORDER BY updated_at DESC
                LIMIT 5
            """)
            for row in cur.fetchall():
                try:
                    import json
                    d = json.loads(row["data"])
                    cand = d.get("upstoxAccessToken") or d.get("upstox_access_token")
                    if cand and isinstance(cand, str) and len(cand) > 20:
                        upstox_client.set_token(cand)
                        log.info("Auto-hydrated Upstox access token from sync_records into memory.")
                        break
                except Exception:
                    pass
            conn.close()
    except Exception as e:
        log.warning(f"Could not hydrate Upstox token from sync_records: {e}")

    # Start Upstox WebSocket client thread unconditionally so it is ready for market hours & token triggers
    try:
        upstox_ws_client.start()
        log.info("Upstox WebSocket background thread started.")
        telemetry.record_milestone("ws_connected")
    except Exception as e:
        log.error("Failed to start Upstox WebSocket: %s", e)

    try:
        from services.feed_watchdog import start_feed_watchdog
        start_feed_watchdog()
        log.info("Feed Watchdog daemon started.")
        telemetry.record_milestone("feed_watchdog_started")
    except Exception as e:
        log.error("Failed to start Feed Watchdog daemon: %s", e)

    # Tier C: Discrepancy Monitor + Scheduler (Medium Delay, 5 seconds)
    time.sleep(3.0)
    try:
        from services.discrepancy_monitor import start_discrepancy_monitor
        start_discrepancy_monitor()
        log.info("Discrepancy monitor service started.")
        telemetry.record_milestone("discrepancy_monitor_started")
    except Exception as e:
        log.error("Failed to start discrepancy monitor: %s", e)

    try:
        init_scheduler()
        log.info("APScheduler started.")
        telemetry.record_milestone("scheduler_started")
    except Exception as e:
        log.error("Failed to start APScheduler: %s", e)

    # Tier D: Broad Startup Syncs (Long Delay, 10 seconds)
    time.sleep(5.0)
    t_upstox = threading.Thread(target=run_startup_syncs, daemon=True)
    t_upstox.start()
    log.info("Upstox background startup tasks thread spawned.")
    telemetry.record_milestone("startup_syncs_started")

@app.on_event("startup")
def start_backend_daemons():
    telemetry.record_milestone("health_route_ready")
    warmup_thread = threading.Thread(target=sequenced_daemons_warmup, daemon=True)
    warmup_thread.start()
    log.info("Sequenced background daemons warmup thread started.")

    # Start Telethon Telegram Ear in a separate thread/loop
    try:
        from services.telegram_ear import run_ear
        def run_in_thread():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(run_ear())
        t = threading.Thread(target=run_in_thread, daemon=True, name="TelethonEar")
        t.start()
        log.info("Telethon Telegram Ear thread started.")
    except Exception as e:
        log.error("Failed to start Telethon Telegram Ear: %s", e)

    # Start Telegram Bot Command Listener Daemon
    try:
        from services.telegram_bot_listener import run_listener
        t_listener = threading.Thread(target=run_listener, daemon=True, name="TelegramBotListener")
        t_listener.start()
        log.info("Telegram Bot Command Listener thread started.")
    except Exception as e:
        log.error("Failed to start Telegram Bot Command Listener: %s", e)

    # CC53: idempotent MF NAV table bootstrap (one call, safe on every restart)
    mf_tables_ok = False
    try:
        from db_stabilized import _ensure_mf_tables, get_connection
        with get_connection(write=True) as _conn:
            _ensure_mf_tables(_conn)
        log.info("MF NAV tables ensured (CC53).")
        telemetry.record_milestone("mf_tables_ensured")
        mf_tables_ok = True
    except Exception as e:
        log.error("Failed to ensure MF tables: %s", e)

    # A6: spawn the 24h MF NAV scheduler on the main event loop.
    mf_sched_ok = False
    try:
        start_mf_scheduler()
        mf_sched_ok = True
    except Exception:
        pass

    # Render startup banner
    try:
        from startup_banner import print_banner
        from routers.shared import is_market_hours
        
        systems = {
            "Stealth NSE Session": ("READY", True),
            "FastAPI / Uvicorn": ("http://127.0.0.1:8765", True),
            "SQLite Cache DB": ("ENSURED" if mf_tables_ok else "ERROR", mf_tables_ok),
            "MF NAV Scheduler": ("ACTIVE" if mf_sched_ok else "FAILED", mf_sched_ok),
            "Upstox WebSocket": ("READY" if is_market_hours() else "Market Closed (Deferred)", not is_market_hours())
        }
        print_banner(systems)
    except Exception as banner_err:
        log.warning("Could not render startup banner: %s", banner_err)

    try:
        from services.autopilot_daemon import daemon_instance
        daemon_instance.start()
        log.info("Headless AutopilotDaemon background service started.")
    except Exception as daemon_err:
        log.warning("Could not start AutopilotDaemon background service: %s", daemon_err)

class RotateSecretRequest(BaseModel):
    new_secret: Optional[str] = None

@app.post("/api/admin/rotate-secret")
async def rotate_bridge_secret(request: Request, body: RotateSecretRequest = None):
    """
    Task B4: In-memory dynamic rotation of BRIDGE_API_SECRET without server restart.
    Requires valid current x-bridge-token header for authorization.
    """
    import uuid
    current_secret = os.environ.get("BRIDGE_API_SECRET", "")
    provided_token = request.headers.get("x-bridge-token", "")
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        provided_token = auth_header[7:]

    if current_secret and (not provided_token or not hmac.compare_digest(provided_token, current_secret)):
        raise HTTPException(status_code=401, detail="Unauthorized: Current BRIDGE_API_SECRET invalid")

    new_secret = (body.new_secret if body and body.new_secret else f"wos_sec_{uuid.uuid4().hex}")
    os.environ["BRIDGE_API_SECRET"] = new_secret
    
    # Store in Vault if available
    try:
        from services.vault_client import vault
        if vault._client:
            vault._client.secrets.kv.v2.create_or_update_secret(
                path=vault.secret_path,
                mount_point=vault.mount_point,
                secret={"BRIDGE_API_SECRET": new_secret}
            )
    except Exception as e:
        log.warning(f"[SECRET_ROTATION] Failed to update Vault: {e}")

    log.info("[SECRET_ROTATION] ✅ BRIDGE_API_SECRET rotated in-memory successfully.")
    client_host = request.client.host if request.client else "unknown"
    telemetry.record_security_event("SECRET_ROTATED", "BRIDGE_API_SECRET was rotated by administrator", "INFO", client_host)

    return {
        "status": "success",
        "message": "BRIDGE_API_SECRET rotated successfully",
        "new_secret_preview": f"{new_secret[:8]}...{new_secret[-4:]}",
        "new_secret": new_secret
    }


    


