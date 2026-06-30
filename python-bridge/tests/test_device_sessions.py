"""
Unit & Integration tests for Device Session Consciousness and In-Memory Token Hydration
Verifies:
1. Device heartbeat registration and update in SQLite.
2. Device session query showing online status, hardware info, and current device indicator.
3. Remote session revocation (marking device as revoked).
4. Revoked devices receiving status='revoked' on heartbeat and HTTP 401 on sync requests.
5. In-memory Upstox token auto-hydration upon sync push.
"""

import os
import sys
import time
import json
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

BRIDGE_DIR = Path(__file__).resolve().parent.parent
if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

import app as main_app
import routers.sync as sync_router


@pytest.fixture
def temp_sync_db():
    """Create an isolated temporary SQLite database for device session tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db_path = Path(tmpdir) / "test_wealthos_device_sync.db"
        orig_db_path = sync_router.DB_PATH
        sync_router.DB_PATH = test_db_path

        sync_router.init_db()
        yield test_db_path
        sync_router.DB_PATH = orig_db_path


@pytest.fixture
def client(temp_sync_db):
    """FastAPI TestClient with isolated sync database."""
    return TestClient(main_app.app)


def test_device_heartbeat_registration(client):
    """Registering a new device via heartbeat creates a record in device_sessions."""
    payload = {
        "user_id": "test_user_alpha",
        "device_id": "dev_laptop_123",
        "device_name": "Chrome on Windows 11",
        "device_type": "desktop",
        "os": "Windows 10/11",
        "browser": "Chrome"
    }
    res = client.post("/api/sync/device/heartbeat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["is_revoked"] is False


def test_device_heartbeat_updates_existing(client):
    """Heartbeat from existing device updates last_active_at and metadata."""
    payload = {
        "user_id": "test_user_alpha",
        "device_id": "dev_phone_456",
        "device_name": "OnePlus 13",
        "device_type": "mobile",
        "os": "Android",
        "browser": "Chrome"
    }
    res1 = client.post("/api/sync/device/heartbeat", json=payload)
    assert res1.status_code == 200

    # Second heartbeat with updated nickname
    payload["device_name"] = "My College Phone"
    res2 = client.post("/api/sync/device/heartbeat", json=payload)
    assert res2.status_code == 200
    assert res2.json()["status"] == "ok"

    # Query device list to confirm update
    list_res = client.get("/api/sync/devices?user_id=test_user_alpha")
    assert list_res.status_code == 200
    devices = list_res.json()["devices"]
    assert len(devices) == 1
    assert devices[0]["device_name"] == "My College Phone"
    assert devices[0]["device_type"] == "mobile"
    assert devices[0]["is_online"] is True


def test_get_user_devices_isolation(client):
    """Devices are strictly isolated by user_id."""
    client.post("/api/sync/device/heartbeat", json={
        "user_id": "user_a",
        "device_id": "dev_a_1",
        "device_name": "Device A",
        "device_type": "desktop",
        "os": "macOS",
        "browser": "Safari"
    })
    client.post("/api/sync/device/heartbeat", json={
        "user_id": "user_b",
        "device_id": "dev_b_1",
        "device_name": "Device B",
        "device_type": "mobile",
        "os": "iOS",
        "browser": "Safari"
    })

    res_a = client.get("/api/sync/devices?user_id=user_a")
    devices_a = res_a.json()["devices"]
    assert len(devices_a) == 1
    assert devices_a[0]["device_id"] == "dev_a_1"

    res_b = client.get("/api/sync/devices?user_id=user_b")
    devices_b = res_b.json()["devices"]
    assert len(devices_b) == 1
    assert devices_b[0]["device_id"] == "dev_b_1"


def test_revoke_device_session(client):
    """Revoking a device marks is_revoked = 1, and subsequent heartbeat returns revoked."""
    client.post("/api/sync/device/heartbeat", json={
        "user_id": "user_victim",
        "device_id": "dev_lost_phone",
        "device_name": "Lost Phone",
        "device_type": "mobile",
        "os": "Android",
        "browser": "Chrome"
    })

    # Revoke from another device
    revoke_res = client.post("/api/sync/device/revoke", json={
        "user_id": "user_victim",
        "device_id": "dev_lost_phone"
    })
    assert revoke_res.status_code == 200
    assert revoke_res.json()["status"] == "success"

    # Victim heartbeat now receives revoked
    hb_res = client.post("/api/sync/device/heartbeat", json={
        "user_id": "user_victim",
        "device_id": "dev_lost_phone",
        "device_name": "Lost Phone",
        "device_type": "mobile",
        "os": "Android",
        "browser": "Chrome"
    })
    assert hb_res.status_code == 200
    assert hb_res.json()["is_revoked"] is True
    assert hb_res.json()["status"] == "revoked"


def test_revoked_device_blocked_on_sync_push(client):
    """A revoked device sending X-Device-Id receives HTTP 401 on sync push."""
    client.post("/api/sync/device/heartbeat", json={
        "user_id": "user_victim",
        "device_id": "dev_bad",
        "device_name": "Rogue Device",
        "device_type": "desktop",
        "os": "Linux",
        "browser": "Firefox"
    })
    client.post("/api/sync/device/revoke", json={
        "user_id": "user_victim",
        "device_id": "dev_bad"
    })

    # Attempt push with X-Device-Id
    push_res = client.post(
        "/api/sync/push",
        headers={"X-Device-Id": "dev_bad"},
        json={
            "user_id": "user_victim",
            "items": [{"entity_type": "trades", "entity_id": "t1", "data": {"ticker": "RELIANCE"}}]
        }
    )
    assert push_res.status_code == 401
    assert "revoked" in push_res.json()["detail"].lower()


def test_upstox_token_auto_hydration_hook(client):
    """Pushing an Upstox access token inside broker_credentials triggers in-memory set_token."""
    fake_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.upstox_test_mock_token_1234567890"

    with patch("routers.shared.upstox_client.set_token") as mock_set_token, \
         patch("routers.shared.upstox_ws_client.trigger_reconnect") as mock_reconnect:

        res = client.post(
            "/api/sync/push",
            json={
                "user_id": "test_user_upstox",
                "items": [{
                    "entity_type": "broker_credentials",
                    "entity_id": "broker_keys",
                    "data": {
                        "upstoxAccessToken": fake_token,
                        "upstoxApiKey": "my_api_key"
                    }
                }]
            }
        )
        assert res.status_code == 200
        mock_set_token.assert_called_once_with(fake_token)
        mock_reconnect.assert_called_once()
