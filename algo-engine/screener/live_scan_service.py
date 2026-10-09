"""Live stock-type scanner daemon (docs/algo/strategy_brief.md).

Serves today's classified candidates from the latest feature panel so the
dashboard (and Telegram) see the SAME math the backtest validated:

    GET /scan/candidates        -> ranked cash + F&O candidates for today
    POST /scan/run              -> trigger an immediate rescan
    GET /scan/health            -> daemon heartbeat

The daemon NEVER places orders. Punching stays 1-click via the existing
/api/openalgo/placeorder-sandbox endpoint (human confirms).

Candidate files are written immutably per scan (data/scan_candidates_<ts>.json)
— a photograph: scores/evidence frozen at scan time, never recalculated.

Run:  python -m screener.live_scan_service   (or pm2: wealthos-scanner)
"""

from __future__ import annotations

import os
import sys
import json
import time
import threading
import datetime as dt

import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:  # package import when run as part of algo-engine
    from screener.stock_types import CONFIG, classify_cash, classify_fno  # noqa: E402
except ModuleNotFoundError:  # loaded by file path (bridge has its own screener.py)
    import importlib.util as _ilu
    _st_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stock_types.py")
    _spec = _ilu.spec_from_file_location("algo_screener_stock_types", _st_path)
    _st = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_st)
    CONFIG, classify_cash, classify_fno = _st.CONFIG, _st.classify_cash, _st.classify_fno

ALGO_ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREENER_DIR = os.path.abspath(os.path.join(ALGO_ENGINE_DIR, "..", "python-bridge", "data", "screener"))
FNO_UNIVERSE_PATH = os.path.join(ALGO_ENGINE_DIR, "config", "universe_fno.json")
OUT_DIR = os.path.abspath(os.path.join(ALGO_ENGINE_DIR, "..", "data"))
os.makedirs(OUT_DIR, exist_ok=True)

FEATURE_COLS = ["minutes_since_open", "gap_pct", "low_vs_open", "day_range_pos",
                "chg_from_open_pct", "fc_range_pct", "fc15_vol_ratio", "vol_pace_45",
                "vol_stab_45", "body_open30", "d_atr14", "candle_body_fade", "em_coverage",
                "freeze_streak", "push_from_open_pct", "low6_vs_open_pct", "pb_vol_ratio",
                "dist_vwap_pct", "vwap_z", "atr_14"]

CASH_LABELS = {
    "TYPE1_ACCUMULATOR": "🟢 Silent Accumulator",
    "TYPE3_PULLBACK_CONTINUE": "🟠 Pullback-Continue",
    "TYPE5_GAP_FREEZE": "🟡 Gap-Freeze",
    "TYPE2_EXHAUSTION_TRAP": "🔴 Exhaustion Trap (BLOCKED)",
    "TYPE4_FRONT_LOADED": "⛔ Front-Loaded (BLOCKED)",
}
FNO_LABELS = {
    "FNO1_HOD_EXHAUSTION_SHORT": "📉 HOD Exhaustion SHORT",
    "FNO2_VWAP_SNAPBACK_SHORT": "📉 VWAP Snapback SHORT",
    "FNO3_GAP_EXHAUSTION_SHORT": "📉 Gap Exhaustion SHORT",
    "FNO4_ACCUMULATION_LONG": "📈 Slow Accumulation LONG",
}

_state = {
    "last_scan_at": None,
    "last_candidates": {"cash": [], "fno_short": [], "fno_long": []},
    "scanning": False,
    "error": None,
}
_lock = threading.Lock()


def _fno_universe() -> set:
    if os.path.exists(FNO_UNIVERSE_PATH):
        with open(FNO_UNIVERSE_PATH) as fh:
            return set(json.load(fh))
    return set()


def run_scan(tf: str = "5minute", top_n: int = 10, write_file: bool = True) -> dict:
    """One classification pass over the latest row per symbol (today or last day)."""
    panel_path = os.path.join(SCREENER_DIR, f"features_{tf}.parquet")
    if not os.path.exists(panel_path):
        raise FileNotFoundError(panel_path)
    fno_syms = _fno_universe()

    # memory-light: read only needed columns; per symbol keep the last row inside the
    # cash window AND the last row inside the F&O window (they classify differently)
    cols = ["symbol", "date", "close"] + FEATURE_COLS
    df = pd.read_parquet(panel_path, columns=cols)
    latest_date = df["date"].max()
    w = CONFIG["decision_windows"]
    c_lo, c_hi = w["cash_scan_minutes"]
    f_lo, f_hi = w["fno_scan_start_minute"], w["fno_scan_end_minute"]
    today = df[df["date"] == latest_date]
    cash_rows = (today[(today["minutes_since_open"] >= c_lo) & (today["minutes_since_open"] <= c_hi)]
                 .sort_values("minutes_since_open", ascending=False).drop_duplicates("symbol", keep="first"))
    fno_rows = (today[(today["minutes_since_open"] >= f_lo) & (today["minutes_since_open"] <= f_hi)]
                .sort_values("minutes_since_open", ascending=False).drop_duplicates("symbol", keep="first"))

    cash, fno_short, fno_long = [], [], []

    def _emit(rec, r, is_fno):
        tid = r["type_id"]
        if tid == "NONE":
            return
        sym = rec["symbol"]
        entry = {
            "symbol": sym,
            "type_id": tid,
            "label": (FNO_LABELS if is_fno else CASH_LABELS).get(tid, tid),
            "direction": r["direction"],
            "priority": r["priority"],
            "close": round(float(rec.get("close") or 0.0), 2),
            "evidence": {k: (None if v is None or (isinstance(v, float) and np.isnan(v))
                             else round(float(v), 3))
                         for k, v in (r.get("evidence") or {}).items() if k in FEATURE_COLS},
        }
        if is_fno:
            if r["direction"] == "SHORT":
                fno_short.append(entry)
            elif r["direction"] == "LONG":
                fno_long.append(entry)
        else:
            cash.append(entry)

    for rec in cash_rows.to_dict("records"):
        feats = {k: rec.get(k) for k in FEATURE_COLS}
        feats["close"] = rec.get("close")
        _emit(rec, classify_cash(feats), is_fno=False)

    for rec in fno_rows.to_dict("records"):
        if rec["symbol"] not in fno_syms:
            continue
        feats = {k: rec.get(k) for k in FEATURE_COLS}
        feats["close"] = rec.get("close")
        _emit(rec, classify_fno(feats), is_fno=True)

    for lst in (cash, fno_short, fno_long):
        lst.sort(key=lambda x: (x["priority"], -(x["evidence"].get("chg_from_open_pct") or 0.0)))
    out = {
        "scan_time_ist": dt.datetime.now(dt.timezone.utc).astimezone(
            __import__("zoneinfo").ZoneInfo("Asia/Kolkata")).isoformat(timespec="seconds"),
        "panel_date": str(latest_date),
        "cash": cash[:top_n * 2],
        "fno_short": fno_short[:top_n],
        "fno_long": fno_long[:top_n],
        "counts": {"cash": len(cash), "fno_short": len(fno_short), "fno_long": len(fno_long)},
    }

    if write_file:
        stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(OUT_DIR, f"scan_candidates_{stamp}.json")
        with open(path, "w") as fh:
            json.dump(out, fh, indent=2)
    return out


def telegram_message(scan: dict, top_n: int = 5) -> str:
    lines = [f"📊 Stock-Type Scan — {scan['scan_time_ist']} (panel {scan['panel_date']})"]
    if scan["cash"]:
        lines.append("\n🟢 CASH LONGS")
        lines += [f"  {c['label']} · {c['symbol']} @ {c['close']}" for c in scan["cash"][:top_n]]
    if scan["fno_short"]:
        lines.append("\n📉 F&O SHORTS")
        lines += [f"  {c['label']} · {c['symbol']} @ {c['close']}" for c in scan["fno_short"][:top_n]]
    if scan["fno_long"]:
        lines.append("\n📈 F&O LONGS")
        lines += [f"  {c['label']} · {c['symbol']} @ {c['close']}" for c in scan["fno_long"][:top_n]]
    if not (scan["cash"] or scan["fno_short"] or scan["fno_long"]):
        lines.append("\nNo qualifying setups this scan.")
    return "\n".join(lines)


def scan_job(write_file: bool = True):
    with _lock:
        if _state["scanning"]:
            return
        _state["scanning"] = True
    try:
        scan = run_scan(write_file=write_file)
        with _lock:
            _state["last_scan_at"] = scan["scan_time_ist"]
            _state["last_candidates"] = scan
            _state["error"] = None
        print(telegram_message(scan), flush=True)
    except Exception as e:
        with _lock:
            _state["error"] = str(e)
        print(f"[SCAN ERROR] {e}", flush=True)
    finally:
        with _lock:
            _state["scanning"] = False


def scheduler_loop():
    """IST market-hours scheduler: cash scans 9:35/10:00/10:30; F&O every 30 min 10:30-14:30."""
    import zoneinfo
    ist = zoneinfo.ZoneInfo("Asia/Kolkata")
    cash_times = {int(h) * 60 + int(m) for h, m in
                  (t.split(":") for t in CONFIG["decision_windows"]["cash_scan_times_ist"])}
    fired_today = set()
    print("[SCANNER] scheduler started", flush=True)
    while True:
        now = dt.datetime.now(ist)
        minute_of_day = now.hour * 60 + now.minute
        is_weekday = now.weekday() < 5
        key = (now.date().isoformat(), minute_of_day)
        if is_weekday and key not in fired_today:
            if minute_of_day in cash_times or (630 <= minute_of_day <= 870 and minute_of_day % 30 == 0):
                fired_today.add(key)
                scan_job()
        time.sleep(20)


def api():
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    app = FastAPI(title="WealthOS Stock-Type Scanner", docs_url="/docs")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/scan/candidates")
    def candidates():
        return _state["last_candidates"]

    @app.get("/scan/health")
    def health():
        return {"status": "ok", "last_scan_at": _state["last_scan_at"],
                "scanning": _state["scanning"], "error": _state["error"]}

    @app.post("/scan/run")
    def run_now():
        threading.Thread(target=scan_job, daemon=True).start()
        return {"status": "triggered"}

    return app


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="scheduler", choices=["scheduler", "once", "serve"])
    ap.add_argument("--top-n", type=int, default=10)
    args = ap.parse_args()
    if args.mode == "once":
        print(json.dumps(run_scan(top_n=args.top_n), indent=2))
    elif args.mode == "serve":
        import uvicorn
        threading.Thread(target=scheduler_loop, daemon=True).start()
        uvicorn.run(api(), host="127.0.0.1", port=8790)
    else:
        scheduler_loop()
