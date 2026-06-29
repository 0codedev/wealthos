"""Tests for CoinGecko crypto router (2026-06-19)."""
from unittest.mock import patch, MagicMock
import json

from fastapi.testclient import TestClient
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402

client = TestClient(app)


def _mock_urlopen(payload):
    body = json.dumps(payload).encode("utf-8")
    cm = MagicMock()
    cm.__enter__.return_value.read.return_value = body
    return cm


def test_get_price_happy_path():
    fake = {"bitcoin": {"inr": 8500000.0}, "ethereum": {"inr": 350000.0}}
    with patch("routers.crypto.urlrequest.urlopen", return_value=_mock_urlopen(fake)):
        r = client.get("/api/crypto/price?ids=bitcoin,ethereum&vs=inr")
    assert r.status_code == 200
    body = r.json()
    assert body["prices"]["bitcoin"]["inr"] == 8500000.0
    assert body["cached"] is False
    assert body["vs"] == "inr"


def test_get_price_60s_cache():
    fake = {"bitcoin": {"inr": 100.0}}
    with patch("routers.crypto.urlrequest.urlopen", return_value=_mock_urlopen(fake)) as m:
        first = client.get("/api/crypto/price?ids=bitcoin").json()
        second = client.get("/api/crypto/price?ids=bitcoin").json()
        assert m.call_count == 1, "second call should hit in-memory cache"
    assert first["cached"] is False
    assert second["cached"] is True


def test_get_price_rejects_empty_ids():
    r = client.get("/api/crypto/price?ids=")
    assert r.status_code == 400


def test_get_price_rejects_more_than_25():
    ids = ",".join([f"coin{i}" for i in range(26)])
    r = client.get(f"/api/crypto/price?ids={ids}")
    assert r.status_code == 400


def test_get_list_returns_top_coins():
    fake = [
        {"id": "bitcoin", "symbol": "btc", "name": "Bitcoin", "current_price": 8500000},
        {"id": "ethereum", "symbol": "eth", "name": "Ethereum", "current_price": 350000},
    ]
    with patch("routers.crypto.urlrequest.urlopen", return_value=_mock_urlopen(fake)):
        r = client.get("/api/crypto/list")
    assert r.status_code == 200
    body = r.json()
    assert len(body["coins"]) == 2
    assert body["coins"][0]["id"] == "bitcoin"
    assert body["coins"][0]["symbol"] == "BTC"
