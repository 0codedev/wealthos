"""Tests for OpenFIGI bridge router (2026-06-19)."""
from unittest.mock import patch, MagicMock
import json

from fastapi.testclient import TestClient
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402

client = TestClient(app)


def _mock_urlopen(payload):
    """Build a context-manager stand-in for urlopen returning JSON.

    The production code calls `resp.read().decode('utf-8')`, so the mock
    must yield raw bytes from `.read()`.
    """
    body = json.dumps(payload).encode("utf-8")
    cm = MagicMock()
    cm.__enter__.return_value.read.return_value = body
    return cm


def test_get_search_isin_happy_path():
    fake_hits = [{"figi": "BBG000BDQYS6", "ticker": "RELIANCE", "name": "RELIANCE INDUSTRIES LTD", "exchCode": "IN"}]
    with patch("routers.openfigi.urlrequest.urlopen", return_value=_mock_urlopen([{"data": fake_hits}])):
        r = client.get("/api/openfigi/search?q=INE002A01018&id_type=ISIN&exchange_code=NS")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["hits"] == fake_hits
    assert body["cached"] is False


def test_get_search_uses_cache_on_second_call():
    fake_hits = [{"figi": "BBG_TEST", "ticker": "TCS", "name": "TCS LTD"}]
    with patch("routers.openfigi.urlrequest.urlopen", return_value=_mock_urlopen([{"data": fake_hits}])):
        first = client.get("/api/openfigi/search?q=INE467B01029&id_type=ISIN").json()
        second = client.get("/api/openfigi/search?q=INE467B01029&id_type=ISIN").json()
    assert first["cached"] is False
    assert second["cached"] is True
    assert second["hits"] == fake_hits


def test_get_search_unsupported_id_type_rejected():
    r = client.get("/api/openfigi/search?q=ABC&id_type=BAD")
    assert r.status_code == 400


def test_post_search_batch_happy_path():
    fake = [
        {"data": [{"figi": "BBG1", "ticker": "A"}]},
        {"data": [{"figi": "BBG2", "ticker": "B"}]},
    ]
    body = {"queries": [
        {"value": "INE002A01018", "id_type": "ISIN"},
        {"value": "467B01029", "id_type": "CUSIP"},
    ]}
    with patch("routers.openfigi.urlrequest.urlopen", return_value=_mock_urlopen(fake)):
        r = client.post("/api/openfigi/search", json=body)
    assert r.status_code == 200
    out = r.json()
    assert len(out["results"]) == 2
    assert out["results"][0]["hits"][0]["ticker"] == "A"


def test_post_search_enforces_25_limit():
    body = {"queries": [{"value": f"ISIN{i}", "id_type": "ISIN"} for i in range(26)]}
    r = client.post("/api/openfigi/search", json=body)
    assert r.status_code == 400


def test_get_search_handles_429_from_openfigi():
    from urllib.error import HTTPError
    err = HTTPError(url="https://api.openfigi.com/v3/mapping", code=429, msg="Too Many", hdrs={}, fp=None)
    with patch("routers.openfigi.urlrequest.urlopen", side_effect=err):
        r = client.get("/api/openfigi/search?q=INE002A01018&id_type=ISIN")
    # First call is not cached, so should bubble up as 429
    assert r.status_code == 429
