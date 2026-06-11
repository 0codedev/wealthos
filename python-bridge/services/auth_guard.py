"""
auth_guard.py - Firebase ID-token gate for the WealthOS bridge.

Production posture:
  - Requests arriving from the LOCAL machine (direct 127.0.0.1 calls from the
    Node ear-server, algo-engine, python scripts, and the Vite dev proxy which
    rewrites Host) stay friction-free: no token required.
  - Requests arriving through any PROXY (Cloudflare tunnel sets
    CF-Connecting-IP / X-Forwarded-For) or with a non-local Host header MUST
    present either a valid Firebase ID token (Authorization: Bearer ...) from
    the app's own Google login, or the static BRIDGE_API_SECRET if configured.

Kill switch: set BRIDGE_AUTH_DISABLED=1 to bypass all auth (emergency only).

Firebase project note: the frontend signs in on project
`wealthaggregator-b6ba5` while the service-account file belongs to
`wealth-aggregator`. The admin app is therefore initialized with an explicit
projectId override so verify_id_token validates the correct audience.
"""

import os
import logging
from typing import Optional, Dict, Any

log = logging.getLogger("wealthos.auth_guard")

# The Firebase project the FRONTEND authenticates against (lib/firebase.ts).
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "wealthaggregator-b6ba5")

LOCAL_HOSTNAMES = {"127.0.0.1", "localhost", "0.0.0.0", "::1", "testserver"}

# Paths and prefixes that are non-destructive (market quotes, SSE streams,
# quant analytics, scanners, telemetry, and OAuth onboarding handshakes).
PUBLIC_PATHS = (
    "/",
    "/health/liveness",
    "/health/readiness",
    "/health/state",
    "/api/health",
    "/api/health/liveness",
    "/api/health/readiness",
    "/api/health/sre",
    "/api/ready",
    "/api/capabilities",
    "/api/telemetry",
    "/metrics",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/upstox/token-exchange",
    "/api/upstox/set-token",
    "/api/upstox/set-credentials",
    "/api/upstox/health",
)

PUBLIC_PREFIXES = (
    "/health/",
    "/api/health",
    "/api/telemetry",
    "/api/diagnostics",
    "/api/upstox/",
    "/api/dhan/",
    "/api/nse/",
    "/api/yahoo/",
    "/api/moneycontrol",
    "/api/alpha/",
    "/api/backtest/",
    "/api/options/",
    "/api/macro/",
    "/api/market/",
    "/api/fii-dii/",
    "/api/agents/",
    "/api/telegram",
    "/api/alerts/",
    "/api/tradefinder",
    "/api/openalgo/",
    "/ws/",
)

_firebase_app: Optional[Any] = None
_firebase_init_error: Optional[str] = None


def _get_firebase_app():
    """Lazy-init the Firebase Admin app. Returns None on failure (logged once)."""
    global _firebase_app, _firebase_init_error
    if _firebase_app is not None:
        return _firebase_app
    if _firebase_init_error is not None:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials

        creds_path = os.getenv(
            "GCP_CREDENTIALS_PATH",
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "gcp-credentials.json"),
        )
        cred = credentials.Certificate(creds_path)
        _firebase_app = firebase_admin.initialize_app(cred, {"projectId": FIREBASE_PROJECT_ID})
        log.info("[AUTH] Firebase Admin initialized (project=%s)", FIREBASE_PROJECT_ID)
        return _firebase_app
    except Exception as exc:  # noqa: BLE001
        _firebase_init_error = str(exc)
        log.critical("[AUTH] Firebase Admin init FAILED - remote requests will be rejected: %s", exc)
        return None


def verify_firebase_id_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify a Firebase ID token. Returns decoded claims or None."""
    app = _get_firebase_app()
    if app is None:
        return None
    try:
        from firebase_admin import auth

        return auth.verify_id_token(token, app=app, clock_skew_seconds=60)
    except Exception as exc:  # noqa: BLE001
        log.warning("[AUTH] Firebase token verification failed: %s", exc)
        return None


def should_require_auth(
    path: str,
    host_header: str,
    has_proxy_headers: bool,
    bridge_secret_configured: bool,
    client_ip: Optional[str] = None,
) -> bool:
    """Pure decision function - unit-testable without FastAPI/Firebase.

    Auth is required when the request did NOT originate from the local machine:
      - any proxied request (tunnel / reverse proxy) always requires auth, even
        if the proxy rewrote Host to localhost;
      - direct local calls (Host: 127.0.0.1 / localhost) are trusted, provided
        the raw socket peer address is also local.
    """
    if bridge_secret_configured:
        # Static secret mode: enforce on everything non-public (legacy behavior).
        return not _is_public_path(path)

    if _is_public_path(path):
        return False

    if has_proxy_headers:
        return True

    if client_ip and client_ip not in LOCAL_HOSTNAMES:
        return True

    hostname = (host_header or "").split(":", 1)[0].strip().lower()
    return hostname not in LOCAL_HOSTNAMES


def _is_public_path(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES)


def extract_bearer_token(authorization_header: str) -> Optional[str]:
    if authorization_header and authorization_header.startswith("Bearer "):
        token = authorization_header[7:].strip()
        return token or None
    return None


def auth_disabled_by_env() -> bool:
    return os.getenv("BRIDGE_AUTH_DISABLED", "").strip() == "1"
