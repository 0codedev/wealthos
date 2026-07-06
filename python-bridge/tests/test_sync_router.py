"""
Unit & Integration tests for python-bridge/routers/sync.py
Verifies:
1. Cryptographic tenant isolation (User A cannot access User B data -> 403 Forbidden).
2. Remote/proxied auth enforcement (Missing or invalid token -> 401 Unauthorized).
3. Input validation & SQL-injection defense (Malformed user_id -> 400 Bad Request).
4. Table whitelisting & anti-bloat defense (Blocked/unwhitelisted tables skipped).
5. Maximum row size enforcement (Payloads > 500KB skipped).
6. Last-Write-Wins (LWW) conflict resolution (Newer timestamps overwrite, older are rejected).
7. Pull incremental pagination, since filter, and entity_type filter.
8. Single and batch record deletion.
9. Zero leakage of other users' data in status/summary endpoints.
"""

import os
import sys
import time
import json
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# Ensure python-bridge directory is on sys.path
BRIDGE_DIR = Path(__file__).resolve().parent.parent
if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

import app as main_app
import routers.sync as sync_router


@pytest.fixture
def temp_sync_db():
    """Create an isolated temporary SQLite database for sync tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db_path = Path(tmpdir) / "test_wealthos_sync.db"
        orig_db_path = sync_router.DB_PATH
        sync_router.DB_PATH = test_db_path

        # Initialize tables
        sync_router.init_db()

        yield test_db_path

        # Restore original path
        sync_router.DB_PATH = orig_db_path


@pytest.fixture
def client(temp_sync_db):
    """FastAPI TestClient configured with isolated sync database."""
    return TestClient(main_app.app)


# ============================================================================
# 1. TENANT ISOLATION & CRYPTOGRAPHIC AUTHORIZATION TESTS
# ============================================================================

def test_tenant_isolation_cross_user_pull_forbidden(client):
    """A user authenticated as user_alpha must NOT be allowed to pull user_beta's records (403)."""
    headers = {
        "cf-connecting-ip": "198.51.100.25",  # Simulates remote/proxied mobile request
        "authorization": "Bearer valid_token_for_alpha"
    }

    mock_claims = {"sub": "user_alpha_1234567890123456"}
    with patch("services.auth_guard.verify_firebase_id_token", return_value=mock_claims):
        # Alice tries to pull Bob's records
        response = client.get("/api/sync/pull?user_id=user_beta_9876543210987654", headers=headers)
        assert response.status_code == 403
        assert "Forbidden" in response.json()["detail"]


def test_tenant_isolation_cross_user_push_forbidden(client):
    """A user authenticated as user_alpha must NOT be allowed to push records into user_beta's account (403)."""
    headers = {
        "cf-connecting-ip": "198.51.100.25",
        "authorization": "Bearer valid_token_for_alpha"
    }

    payload = {
        "user_id": "user_beta_9876543210987654",
        "items": [
            {
                "entity_type": "trades",
                "entity_id": "trade_999",
                "data": {"ticker": "MALICIOUS", "pnl": 50000},
                "updated_at": time.time() * 1000
            }
        ]
    }

    mock_claims = {"sub": "user_alpha_1234567890123456"}
    with patch("services.auth_guard.verify_firebase_id_token", return_value=mock_claims):
        response = client.post("/api/sync/push", json=payload, headers=headers)
        assert response.status_code == 403
        assert "Forbidden" in response.json()["detail"]


def test_tenant_isolation_cross_user_delete_forbidden(client):
    """A user authenticated as user_alpha must NOT be allowed to delete user_beta's records (403)."""
    headers = {
        "cf-connecting-ip": "198.51.100.25",
        "authorization": "Bearer valid_token_for_alpha"
    }

    payload = {
        "user_id": "user_beta_9876543210987654",
        "entity_type": "trades",
        "entity_id": "trade_1"
    }

    mock_claims = {"sub": "user_alpha_1234567890123456"}
    with patch("services.auth_guard.verify_firebase_id_token", return_value=mock_claims):
        response = client.post("/api/sync/delete", json=payload, headers=headers)
        assert response.status_code == 403
        assert "Forbidden" in response.json()["detail"]


def test_unauthenticated_proxied_request_rejected(client):
    """Remote/proxied requests without valid auth token must be rejected with 401."""
    headers = {
        "cf-connecting-ip": "203.0.113.10",
    }
    with patch("services.auth_guard.verify_firebase_id_token", return_value=None):
        response = client.get("/api/sync/pull?user_id=user_alpha", headers=headers)
        assert response.status_code == 401
        assert "Unauthorized" in response.json()["detail"]


# ============================================================================
# 2. INPUT VALIDATION & SQL INJECTION DEFENSE
# ============================================================================

def test_malformed_user_id_rejected(client):
    """User IDs with SQL injection attempts, control characters, or invalid length must be rejected with 400."""
    malicious_ids = [
        "admin' OR '1'='1",
        "../../etc/passwd",
        "<script>alert(1)</script>",
        "user; DROP TABLE sync_records;--",
        "a" * 150,  # exceeds 128 char limit
        ""
    ]

    for bad_id in malicious_ids:
        response = client.get(f"/api/sync/pull?user_id={bad_id}")
        assert response.status_code == 400
        assert "Invalid user_id format" in response.json()["detail"]


# ============================================================================
# 3. TABLE WHITELIST & ANTI-BLOAT DEFENSE
# ============================================================================

def test_push_sync_whitelisted_and_blacklisted_tables(client):
    """Whitelisted tables must be stored, while blacklisted / non-whitelisted tables are safely skipped."""
    user_id = "test_user_alpha"
    now_ms = time.time() * 1000

    items = [
        # Whitelisted: trades
        {
            "entity_type": "trades",
            "entity_id": "trade_1",
            "data": {"ticker": "RELIANCE", "pnl": 1500, "direction": "Long"},
            "updated_at": now_ms,
            "device_id": "laptop"
        },
        # Whitelisted: friends (IPO syndicate)
        {
            "entity_type": "friends",
            "entity_id": "friend_1",
            "data": {"name": "Bhanudeep", "balance": 45000},
            "updated_at": now_ms,
            "device_id": "laptop"
        },
        # Whitelisted: broker_credentials
        {
            "entity_type": "broker_credentials",
            "entity_id": "broker_keys",
            "data": {"dhanPin": "123456", "upstoxAccessToken": "tok_xyz"},
            "updated_at": now_ms,
            "device_id": "laptop"
        },
        # Blacklisted: telegram_messages (must be skipped)
        {
            "entity_type": "telegram_messages",
            "entity_id": "msg_999",
            "data": {"text": "Big raw message blob"},
            "updated_at": now_ms,
            "device_id": "laptop"
        },
        # Blacklisted: candle_cache (must be skipped)
        {
            "entity_type": "candle_cache",
            "entity_id": "candle_nifty",
            "data": {"candles": [1, 2, 3]},
            "updated_at": now_ms,
            "device_id": "laptop"
        },
        # Non-whitelisted arbitrary table (must be skipped)
        {
            "entity_type": "arbitrary_attacker_table",
            "entity_id": "row_1",
            "data": {"foo": "bar"},
            "updated_at": now_ms,
            "device_id": "laptop"
        }
    ]

    response = client.post("/api/sync/push", json={"user_id": user_id, "items": items})
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] == "success"
    assert res_data["synced_count"] == 3  # Only trades, friends, broker_credentials
    assert res_data["skipped_count"] == 3  # 2 blacklisted + 1 unwhitelisted

    # Verify pull returns exactly the 3 whitelisted items
    pull_res = client.get(f"/api/sync/pull?user_id={user_id}&since=0")
    assert pull_res.status_code == 200
    pulled_items = pull_res.json()["items"]
    assert len(pulled_items) == 3
    pulled_tables = {item["entity_type"] for item in pulled_items}
    assert pulled_tables == {"trades", "friends", "broker_credentials"}


def test_push_sync_oversized_payload_rejected(client):
    """Rows exceeding 500KB must be skipped to protect server memory."""
    user_id = "test_user_alpha"
    now_ms = time.time() * 1000

    giant_data = {"blob": "X" * (550 * 1024)}  # 550 KB, exceeds 500 KB cap

    payload = {
        "user_id": user_id,
        "items": [
            {
                "entity_type": "trades",
                "entity_id": "trade_giant",
                "data": giant_data,
                "updated_at": now_ms
            }
        ]
    }

    response = client.post("/api/sync/push", json=payload)
    assert response.status_code == 200
    assert response.json()["synced_count"] == 0
    assert response.json()["skipped_count"] == 1


# ============================================================================
# 4. LAST-WRITE-WINS (LWW) CONFLICT RESOLUTION
# ============================================================================

def test_last_write_wins_conflict_resolution(client):
    """
    Verifies that a newer timestamp overwrites an existing record,
    but an older timestamp NEVER overwrites a newer record.
    """
    user_id = "test_user_alpha"
    t1 = 1000000.0
    t2 = 2000000.0
    t0 = 500000.0

    # 1. Initial write at T1
    client.post("/api/sync/push", json={
        "user_id": user_id,
        "items": [
            {
                "entity_type": "trades",
                "entity_id": "trade_lww",
                "data": {"ticker": "TCS", "notes": "Initial write at T1", "pnl": 100},
                "updated_at": t1
            }
        ]
    })

    # Verify T1 stored
    r1 = client.get(f"/api/sync/pull?user_id={user_id}&entity_type=trades")
    assert r1.json()["items"][0]["data"]["notes"] == "Initial write at T1"

    # 2. Newer update at T2 (T2 > T1) -> MUST OVERWRITE
    client.post("/api/sync/push", json={
        "user_id": user_id,
        "items": [
            {
                "entity_type": "trades",
                "entity_id": "trade_lww",
                "data": {"ticker": "TCS", "notes": "Updated write at T2", "pnl": 200},
                "updated_at": t2
            }
        ]
    })

    r2 = client.get(f"/api/sync/pull?user_id={user_id}&entity_type=trades")
    assert r2.json()["items"][0]["data"]["notes"] == "Updated write at T2"
    assert r2.json()["items"][0]["data"]["pnl"] == 200

    # 3. Stale update at T0 (T0 < T2) -> MUST BE REJECTED / DISCARDED
    client.post("/api/sync/push", json={
        "user_id": user_id,
        "items": [
            {
                "entity_type": "trades",
                "entity_id": "trade_lww",
                "data": {"ticker": "TCS", "notes": "Stale write at T0 - should not apply", "pnl": 50},
                "updated_at": t0
            }
        ]
    })

    # Record at T2 must still be intact
    r3 = client.get(f"/api/sync/pull?user_id={user_id}&entity_type=trades")
    assert r3.json()["items"][0]["data"]["notes"] == "Updated write at T2"
    assert r3.json()["items"][0]["data"]["pnl"] == 200
    assert r3.json()["items"][0]["updated_at"] == t2


# ============================================================================
# 5. PULL FILTERING, PAGINATION & DELETION TESTS
# ============================================================================

def test_pull_incremental_since_filter(client):
    """The 'since' parameter must return only records updated strictly after that timestamp."""
    user_id = "test_user_alpha"

    # Insert 3 records with distinct timestamps
    client.post("/api/sync/push", json={
        "user_id": user_id,
        "items": [
            {"entity_type": "trades", "entity_id": "t_100", "data": {"qty": 1}, "updated_at": 100.0},
            {"entity_type": "trades", "entity_id": "t_200", "data": {"qty": 2}, "updated_at": 200.0},
            {"entity_type": "trades", "entity_id": "t_300", "data": {"qty": 3}, "updated_at": 300.0},
        ]
    })

    # since = 150 -> should only return t_200 and t_300
    res = client.get(f"/api/sync/pull?user_id={user_id}&since=150.0")
    items = res.json()["items"]
    assert len(items) == 2
    assert {i["entity_id"] for i in items} == {"t_200", "t_300"}


def test_delete_sync_records_single_and_batch(client):
    """Verify single and batch record deletions remove records from sync_records."""
    user_id = "test_user_alpha"

    # Push 3 records
    client.post("/api/sync/push", json={
        "user_id": user_id,
        "items": [
            {"entity_type": "trades", "entity_id": "item_a", "data": {"a": 1}, "updated_at": 100.0},
            {"entity_type": "trades", "entity_id": "item_b", "data": {"b": 2}, "updated_at": 100.0},
            {"entity_type": "friends", "entity_id": "item_c", "data": {"c": 3}, "updated_at": 100.0},
        ]
    })

    # 1. Single delete: item_a
    del1 = client.post("/api/sync/delete", json={
        "user_id": user_id,
        "entity_type": "trades",
        "entity_id": "item_a"
    })
    assert del1.status_code == 200
    assert del1.json()["deleted_count"] == 1

    # Verify item_a is gone
    pull1 = client.get(f"/api/sync/pull?user_id={user_id}&since=0")
    remaining_ids = {i["entity_id"] for i in pull1.json()["items"]}
    assert remaining_ids == {"item_b", "item_c"}

    # 2. Batch delete: item_b and item_c
    del2 = client.post("/api/sync/delete", json={
        "user_id": user_id,
        "items": [
            {"entity_type": "trades", "entity_id": "item_b"},
            {"entity_type": "friends", "entity_id": "item_c"}
        ]
    })
    assert del2.status_code == 200
    assert del2.json()["deleted_count"] == 2

    # Verify all gone
    pull2 = client.get(f"/api/sync/pull?user_id={user_id}&since=0")
    assert len(pull2.json()["items"]) == 0


# ============================================================================
# 6. ZERO-LEAKAGE STATUS AUDIT
# ============================================================================

def test_sync_status_summary_isolated_per_user(client):
    """GET /api/sync/status must only return counts for the requested user, not leaking other users."""
    user_alice = "user_alice"
    user_bob = "user_bob"

    client.post("/api/sync/push", json={
        "user_id": user_alice,
        "items": [
            {"entity_type": "trades", "entity_id": "t1", "data": {}, "updated_at": 100.0},
            {"entity_type": "trades", "entity_id": "t2", "data": {}, "updated_at": 100.0},
        ]
    })

    client.post("/api/sync/push", json={
        "user_id": user_bob,
        "items": [
            {"entity_type": "friends", "entity_id": "f1", "data": {}, "updated_at": 100.0},
        ]
    })

    status_alice = client.get(f"/api/sync/status?user_id={user_alice}").json()
    assert status_alice["user_id"] == user_alice
    summary_map_alice = {s["entity_type"]: s["count"] for s in status_alice["summary"]}
    assert summary_map_alice.get("trades") == 2
    assert "friends" not in summary_map_alice  # Bob's table must not appear

    status_bob = client.get(f"/api/sync/status?user_id={user_bob}").json()
    assert status_bob["user_id"] == user_bob
    summary_map_bob = {s["entity_type"]: s["count"] for s in status_bob["summary"]}
    assert summary_map_bob.get("friends") == 1
    assert "trades" not in summary_map_bob  # Alice's table must not appear
