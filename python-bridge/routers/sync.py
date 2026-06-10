import os
import time
import re
import json
import sqlite3
from pathlib import Path
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Header, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/sync", tags=["sync"])

BRIDGE_DIR = Path(os.path.dirname(os.path.abspath(__file__))).parent
DATA_DIR = Path(os.getenv("WEALTHOS_DATA_DIR", str(BRIDGE_DIR / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "wealthos-sync.db"

# 1. Strict Whitelist of Syncable Tables to prevent DB Bloating & memory exhaustion
SYNCABLE_TABLES = {
    'trades', 'sandbox_trades', 'investments', 'transactions', 'dividends',
    'goals', 'strategies', 'tax_records', 'realized_transactions',
    'paper_trades', 'mistakes', 'daily_reviews', 'life_events',
    'beneficiaries', 'friends', 'ipo_applications', 'missed_trades',
    'alerts', 'signal_providers', 'parsed_signals', 'shared_journal',
    'daily_digest', 'mirror_rules', 'watchlist', 'ear_configs',
    'user_settings', 'broker_credentials', 'external_api_keys',
    'app_credentials', 'pool_items', 'pool_verdicts', 'history',
    'chat_messages', 'conversations', 'voice_sessions', 'jarvis_briefs',
    'trade_legs', 'parsed_signal_records', 'forward_duels',
    'quiz_progress', 'pool_sources', 'model_versions'
}

# 2. Blacklist of Transient / Massive Cache tables that must NEVER be synced over API
BLOCKED_TABLES = {
    'telegram_messages', 'telegram_ear_cache', 'brain_vectors',
    'ml_weights', 'ml_models', 'candle_cache', 'cache',
    'broker_holdings_cache', 'broker_positions_cache'
}

MAX_ITEMS_PER_PUSH = 500
MAX_ROW_DATA_BYTES = 500 * 1024  # 500 KB max per individual row

USER_ID_REGEX = re.compile(r'^[a-zA-Z0-9_\-\.@:]{1,128}$')

def validate_user_id(user_id: str):
    if not user_id or not USER_ID_REGEX.match(user_id):
        raise HTTPException(status_code=400, detail="Invalid user_id format. Must be alphanumeric (1-128 chars).")

def get_db_conn():
    conn = sqlite3.connect(str(DB_PATH), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn

def init_db():
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA busy_timeout = 5000;")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sync_records (
                user_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                data TEXT NOT NULL,
                updated_at REAL NOT NULL,
                device_id TEXT,
                PRIMARY KEY (user_id, entity_type, entity_id)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_sync_updated 
            ON sync_records(user_id, updated_at)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_sync_entity 
            ON sync_records(user_id, entity_type)
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS device_sessions (
                device_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                device_name TEXT NOT NULL,
                device_type TEXT NOT NULL,
                os TEXT NOT NULL,
                browser TEXT NOT NULL,
                ip_address TEXT,
                first_seen_at REAL NOT NULL,
                last_active_at REAL NOT NULL,
                is_revoked INTEGER DEFAULT 0
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_device_user 
            ON device_sessions(user_id)
        """)
        conn.commit()
    finally:
        conn.close()

init_db()

class SyncItem(BaseModel):
    entity_type: str = Field(..., max_length=128)
    entity_id: Any = Field(...)
    data: Any = Field(...)
    updated_at: Optional[float] = None
    device_id: Optional[str] = Field(default="unknown", max_length=256)

class PushSyncRequest(BaseModel):
    user_id: str = Field(..., max_length=256)
    items: List[SyncItem] = Field(default_factory=list)

class DeleteSyncItem(BaseModel):
    entity_type: str = Field(..., max_length=128)
    entity_id: Any = Field(...)

class DeleteSyncRequest(BaseModel):
    user_id: str = Field(..., max_length=256)
    entity_type: Optional[str] = Field(None, max_length=128)
    entity_id: Optional[Any] = Field(None)
    items: Optional[List[DeleteSyncItem]] = None

class PullSyncResponse(BaseModel):
    status: str
    user_id: str
    server_time: float
    items: List[Dict[str, Any]]

class DeviceHeartbeatRequest(BaseModel):
    user_id: str = Field(..., max_length=256)
    device_id: str = Field(..., max_length=256)
    device_name: str = Field(default="Unknown Device", max_length=128)
    device_type: str = Field(default="desktop", max_length=32)
    os: str = Field(default="Unknown OS", max_length=64)
    browser: str = Field(default="Unknown Browser", max_length=64)

class DeviceRevokeRequest(BaseModel):
    user_id: str = Field(..., max_length=256)
    device_id: str = Field(..., max_length=256)

def check_user_authorization(request: Request, user_id: str):
    validate_user_id(user_id)
    auth_sub = getattr(request.state, "auth_subject", None)
    if auth_sub and auth_sub.startswith("firebase:"):
        token_sub = auth_sub.split(":", 1)[1]
        # Compare token prefix or exact UID
        if token_sub and token_sub != "unknown" and not user_id.startswith(token_sub):
            raise HTTPException(
                status_code=403,
                detail="Forbidden: Cannot access or mutate data for a user_id differing from authenticated identity."
            )

    # Session revocation check for hardware device_id if provided
    device_id = request.headers.get("x-device-id")
    if device_id:
        conn = get_db_conn()
        try:
            cur = conn.cursor()
            cur.execute("SELECT is_revoked FROM device_sessions WHERE device_id = ? AND user_id = ?", (device_id, user_id))
            row = cur.fetchone()
            if row and row["is_revoked"] == 1:
                raise HTTPException(
                    status_code=401,
                    detail="Session revoked: This device has been logged out remotely."
                )
        finally:
            conn.close()

@router.post("/push")
async def push_sync_records(payload: PushSyncRequest, request: Request):
    check_user_authorization(request, payload.user_id)

    if not payload.items:
        return {"status": "success", "synced_count": 0, "server_time": time.time() * 1000}

    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        now = time.time() * 1000
        synced_count = 0
        skipped_count = 0

        for item in payload.items:
            table_name = item.entity_type.strip().lower()

            # Anti-bloat protection: Discard unwhitelisted or blacklisted tables
            if table_name in BLOCKED_TABLES or table_name not in SYNCABLE_TABLES:
                skipped_count += 1
                continue

            try:
                json_data = json.dumps(item.data, default=str)
            except Exception:
                json_data = str(item.data)

            if len(json_data) > MAX_ROW_DATA_BYTES:
                skipped_count += 1
                continue

            updated_at = float(item.updated_at) if item.updated_at else float(now)
            entity_id_str = str(item.entity_id)

            cursor.execute("""
                INSERT INTO sync_records (user_id, entity_type, entity_id, data, updated_at, device_id)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET
                    data = excluded.data,
                    updated_at = excluded.updated_at,
                    device_id = excluded.device_id
                WHERE excluded.updated_at >= sync_records.updated_at
            """, (payload.user_id, table_name, entity_id_str, json_data, updated_at, str(item.device_id or "web")[:64]))
            synced_count += 1

        conn.commit()

        # In-Memory Token Auto-Hydration Hook:
        # Ensures VPS bridge memory is fed the active Upstox access token immediately to establish upstream WebSocket stream
        hydrated_upstox_token = None
        for item in payload.items:
            t_name = item.entity_type.strip().lower()
            if t_name in ("broker_credentials", "app_credentials") and isinstance(item.data, dict):
                cand = item.data.get("upstoxAccessToken") or item.data.get("upstox_access_token")
                if cand and isinstance(cand, str) and len(cand) > 20:
                    hydrated_upstox_token = cand
                    break

        if hydrated_upstox_token:
            try:
                from routers.shared import upstox_client, upstox_ws_client
                if upstox_client.token != hydrated_upstox_token:
                    upstox_client.set_token(hydrated_upstox_token)
                    upstox_ws_client.trigger_reconnect()
            except Exception:
                pass

        return {
            "status": "success",
            "synced_count": synced_count,
            "skipped_count": skipped_count,
            "server_time": now
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database sync failed: {str(e)}")
    finally:
        conn.close()

@router.post("/delete")
async def delete_sync_records(payload: DeleteSyncRequest, request: Request):
    check_user_authorization(request, payload.user_id)

    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        now = time.time() * 1000
        deleted_count = 0

        # Collect targets to delete
        targets = []
        if payload.items:
            for item in payload.items:
                targets.append((item.entity_type.strip().lower(), str(item.entity_id)))
        elif payload.entity_type and payload.entity_id is not None:
            targets.append((payload.entity_type.strip().lower(), str(payload.entity_id)))

        for entity_type, entity_id in targets:
            cursor.execute("""
                DELETE FROM sync_records
                WHERE user_id = ? AND entity_type = ? AND entity_id = ?
            """, (payload.user_id, entity_type, entity_id))
            deleted_count += cursor.rowcount

        conn.commit()
        return {
            "status": "success",
            "deleted_count": deleted_count,
            "server_time": now
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database deletion failed: {str(e)}")
    finally:
        conn.close()

@router.get("/pull", response_model=PullSyncResponse)
async def pull_sync_records(
    request: Request,
    user_id: str = Query(..., description="Unique User ID / Google UID"),
    since: float = Query(0.0, description="Timestamp in ms to pull changes since"),
    entity_type: Optional[str] = Query(None, description="Optional entity type filter"),
    limit: int = Query(2500, le=10000, description="Max rows to return")
):
    check_user_authorization(request, user_id)

    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        now = time.time() * 1000

        if entity_type:
            clean_type = entity_type.strip().lower()
            cursor.execute("""
                SELECT entity_type, entity_id, data, updated_at, device_id
                FROM sync_records
                WHERE user_id = ? AND updated_at > ? AND entity_type = ?
                ORDER BY updated_at ASC
                LIMIT ?
            """, (user_id, since, clean_type, limit))
        else:
            cursor.execute("""
                SELECT entity_type, entity_id, data, updated_at, device_id
                FROM sync_records
                WHERE user_id = ? AND updated_at > ?
                ORDER BY updated_at ASC
                LIMIT ?
            """, (user_id, since, limit))

        rows = cursor.fetchall()
        items = []
        for r in rows:
            try:
                parsed_data = json.loads(r["data"])
            except Exception:
                parsed_data = {}
            items.append({
                "entity_type": r["entity_type"],
                "entity_id": r["entity_id"],
                "data": parsed_data,
                "updated_at": r["updated_at"],
                "device_id": r["device_id"]
            })

        return PullSyncResponse(
            status="success",
            user_id=user_id,
            server_time=now,
            items=items
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve sync records: {str(e)}")
    finally:
        conn.close()

@router.get("/status")
async def get_sync_status(user_id: str = Query(...)):
    validate_user_id(user_id)
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT entity_type, count(*) as count, max(updated_at) as last_updated
            FROM sync_records
            WHERE user_id = ?
            GROUP BY entity_type
        """, (user_id,))
        summary = [dict(r) for r in cursor.fetchall()]
        return {
            "status": "online",
            "user_id": user_id,
            "whitelisted_tables": list(SYNCABLE_TABLES),
            "summary": summary,
            "server_time": time.time() * 1000
        }
    finally:
        conn.close()

@router.post("/device/heartbeat")
async def device_heartbeat(payload: DeviceHeartbeatRequest, request: Request):
    check_user_authorization(request, payload.user_id)
    conn = get_db_conn()
    now = time.time() * 1000
    client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else "unknown")
    if "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()

    try:
        cursor = conn.cursor()
        # Check if already exists
        cursor.execute("SELECT first_seen_at, is_revoked FROM device_sessions WHERE device_id = ? AND user_id = ?", (payload.device_id, payload.user_id))
        existing = cursor.fetchone()

        if existing:
            is_revoked = bool(existing["is_revoked"])
            if not is_revoked:
                cursor.execute("""
                    UPDATE device_sessions SET
                        device_name = ?,
                        device_type = ?,
                        os = ?,
                        browser = ?,
                        ip_address = ?,
                        last_active_at = ?
                    WHERE device_id = ? AND user_id = ?
                """, (payload.device_name, payload.device_type, payload.os, payload.browser, client_ip, now, payload.device_id, payload.user_id))
                conn.commit()
            return {
                "status": "revoked" if is_revoked else "ok",
                "is_revoked": is_revoked,
                "server_time": now
            }
        else:
            cursor.execute("""
                INSERT INTO device_sessions (device_id, user_id, device_name, device_type, os, browser, ip_address, first_seen_at, last_active_at, is_revoked)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """, (payload.device_id, payload.user_id, payload.device_name, payload.device_type, payload.os, payload.browser, client_ip, now, now))
            conn.commit()
            return {
                "status": "ok",
                "is_revoked": False,
                "server_time": now
            }
    finally:
        conn.close()

@router.get("/devices")
async def get_user_devices(request: Request, user_id: str = Query(...)):
    check_user_authorization(request, user_id)
    conn = get_db_conn()
    now = time.time() * 1000
    current_device_id = request.headers.get("x-device-id")

    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT device_id, user_id, device_name, device_type, os, browser, ip_address, first_seen_at, last_active_at, is_revoked
            FROM device_sessions
            WHERE user_id = ?
            ORDER BY last_active_at DESC
        """, (user_id,))
        rows = cursor.fetchall()
        devices = []
        for r in rows:
            last_active = float(r["last_active_at"] or 0)
            is_online = (now - last_active) < 120000 and not bool(r["is_revoked"]) # Active in last 2 mins
            devices.append({
                "device_id": r["device_id"],
                "device_name": r["device_name"],
                "device_type": r["device_type"],
                "os": r["os"],
                "browser": r["browser"],
                "ip_address": r["ip_address"],
                "first_seen_at": r["first_seen_at"],
                "last_active_at": r["last_active_at"],
                "is_online": is_online,
                "is_current": (r["device_id"] == current_device_id) if current_device_id else False,
                "is_revoked": bool(r["is_revoked"])
            })
        return {
            "status": "success",
            "devices": devices,
            "server_time": now
        }
    finally:
        conn.close()

@router.post("/device/revoke")
async def revoke_device_session(payload: DeviceRevokeRequest, request: Request):
    check_user_authorization(request, payload.user_id)
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE device_sessions
            SET is_revoked = 1
            WHERE device_id = ? AND user_id = ?
        """, (payload.device_id, payload.user_id))
        conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Device session not found.")
        return {
            "status": "success",
            "message": f"Device session {payload.device_id} successfully revoked."
        }
    finally:
        conn.close()

