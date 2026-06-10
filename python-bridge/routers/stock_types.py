"""Stock-type scanner API (docs/algo/strategy_brief.md).

Exposes the validated stock-type classifier to the dashboard. The actual scan is
computed by algo-engine/screener/live_scan_service.py; results are cached here so
repeated dashboard polls do not rescan.

    GET  /api/stock-types/candidates   -> today's ranked cash + F&O candidates
    POST /api/stock-types/scan         -> force a fresh scan now
    GET  /api/stock-types/status       -> last scan time / errors
"""

from __future__ import annotations

import os
import sys
import threading
import datetime as dt

from fastapi import APIRouter

router = APIRouter(prefix="/api/stock-types", tags=["stock-types"])

ALGO_ENGINE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "algo-engine"))


def _load_scan_module():
    """Load algo-engine/screener/live_scan_service.py by explicit file path.

    python-bridge already has its own ``screener.py`` module, so a plain
    ``import screener`` would be ambiguous. Loading by path keeps both intact.
    """
    import importlib.util
    svc_path = os.path.join(ALGO_ENGINE_DIR, "screener", "live_scan_service.py")
    if ALGO_ENGINE_DIR not in sys.path:
        sys.path.append(ALGO_ENGINE_DIR)  # append (not insert) so bridge modules win
    spec = importlib.util.spec_from_file_location("algo_screener_live_scan", svc_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

_cache = {"data": None, "at": None, "error": None, "scanning": False}
_lock = threading.Lock()
_TTL_SECONDS = 120


def _fresh() -> bool:
    return bool(_cache["data"]) and _cache["at"] is not None and \
        (dt.datetime.now() - _cache["at"]).total_seconds() < _TTL_SECONDS


def _do_scan():
    with _lock:
        if _cache["scanning"]:
            return
        _cache["scanning"] = True
    try:
        mod = _load_scan_module()
        data = mod.run_scan(write_file=True)
        with _lock:
            _cache["data"] = data
            _cache["at"] = dt.datetime.now()
            _cache["error"] = None
    except Exception as e:  # pragma: no cover - surfaced via status endpoint
        with _lock:
            _cache["error"] = str(e)
    finally:
        with _lock:
            _cache["scanning"] = False


@router.get("/candidates")
def candidates():
    if not _fresh():
        _do_scan()
    with _lock:
        return {
            "status": "success" if _cache["data"] else "unavailable",
            "error": _cache["error"],
            "data": _cache["data"],
        }


@router.post("/scan")
def scan_now():
    threading.Thread(target=_do_scan, daemon=True).start()
    return {"status": "triggered"}


@router.get("/status")
def status():
    return {
        "last_scan": _cache["at"].isoformat(timespec="seconds") if _cache["at"] else None,
        "scanning": _cache["scanning"],
        "has_data": bool(_cache["data"]),
        "error": _cache["error"],
    }