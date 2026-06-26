"""Unit tests for services/auth_guard.py - pure decision logic only (no Firebase)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.auth_guard import (  # noqa: E402
    extract_bearer_token,
    should_require_auth,
)


def test_public_paths_never_require_auth():
    for path in ("/", "/api/health", "/api/health/deep", "/metrics", "/docs", "/openapi.json", "/api/upstox/ws/stream", "/api/nse/option-chain", "/api/alpha/ore", "/api/macro/pulse"):
        assert should_require_auth(path, "wealthos-sudhanshu.xyz", True, False) is False


def test_proxied_request_requires_auth_even_with_local_host():
    # cloudflared on the same VPS can rewrite Host to localhost - proxy headers win on protected endpoints.
    assert should_require_auth("/api/trade/order", "127.0.0.1:8765", True, False) is True


def test_remote_host_requires_auth():
    assert should_require_auth("/api/trade/order", "wealthos-sudhanshu.xyz", False, False) is True


def test_local_direct_call_is_trusted():
    assert should_require_auth("/api/trade/order", "127.0.0.1:8765", False, False) is False
    assert should_require_auth("/api/trade/order", "localhost:8765", False, False) is False
    assert should_require_auth("/api/trade/order", "127.0.0.1:8765", False, False, "127.0.0.1") is False


def test_remote_socket_requires_auth_even_with_spoofed_host_header():
    # External attacker on LAN (e.g. 192.168.1.50) spoofing Host: 127.0.0.1 header
    assert should_require_auth("/api/trade/order", "127.0.0.1:8765", False, False, "192.168.1.50") is True


def test_static_secret_mode_enforces_everything_non_public():
    assert should_require_auth("/api/trade/order", "127.0.0.1:8765", False, True) is True
    assert should_require_auth("/api/health", "wealthos-sudhanshu.xyz", True, True) is False


def test_extract_bearer_token():
    assert extract_bearer_token("Bearer abc.def") == "abc.def"
    assert extract_bearer_token("Bearer  ") is None
    assert extract_bearer_token("Basic xyz") is None
    assert extract_bearer_token("") is None
