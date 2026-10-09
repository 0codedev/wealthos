"""Stock-type classifier — docs/algo/strategy_brief.md as executable math.

Pure, stateless classifier over the causal day-shape features built by
``backtester/build_screener.py``. Both the backtest (WS-C) and the live scanner
daemon (WS-E) call :func:`classify`; the TypeScript live classifier in
``services/alpha/StockTypeClassifier.ts`` mirrors the same rules from the same
``stock_types_config.json``.

Cash types (evaluated in the morning decision window):
    TYPE1_ACCUMULATOR        LONG  priority 1   (PCJEWELLER)
    TYPE2_EXHAUSTION_TRAP    SHORT scalp        (ADFFOODS)  -> blocks longs
    TYPE3_PULLBACK_CONTINUE  LONG  priority 2   (RITES)
    TYPE4_FRONT_LOADED       NONE  block-all
    TYPE5_GAP_FREEZE         LONG  priority 3   (BHARATSE)

F&O setups (evaluated from 10:30 IST onward):
    FNO1_HOD_EXHAUSTION_SHORT, FNO2_VWAP_SNAPBACK_SHORT,
    FNO3_GAP_EXHAUSTION_SHORT, FNO4_ACCUMULATION_LONG
"""

from __future__ import annotations

import json
import math
import os
from typing import Optional

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stock_types_config.json")

with open(CONFIG_PATH) as _fh:
    CONFIG = json.load(_fh)

# feature-name -> config-key per detector (kept declarative so TS mirrors it 1:1)
_RULES = {
    "TYPE1_ACCUMULATOR": [
        ("low_vs_open", "min_low_vs_open", "ge"),
        ("day_range_pos", "max_day_range_pos", "le"),
        ("chg_from_open_pct", "min_chg_from_open_pct", "ge"),
        ("chg_from_open_pct", "max_chg_from_open_pct", "le"),
        ("fc_range_pct", "max_fc_range_pct", "le"),
        ("vol_pace_45", "min_vol_pace_45", "ge"),
        ("vol_pace_45", "max_vol_pace_45", "le"),
        ("vol_stab_45", "max_vol_stab_45", "le"),
    ],
    "TYPE2_EXHAUSTION_TRAP": [
        # volume leg is the validated signal; gap leg handled separately at 5%
    ],
    "TYPE3_PULLBACK_CONTINUE": [
        ("push_from_open_pct", "min_push_from_open_pct", "ge"),
        ("low6_vs_open_pct", "min_low6_vs_open_pct", "ge"),
        ("pb_vol_ratio", "max_pb_vol_ratio", "le"),
        ("dist_vwap_pct", "min_dist_vwap_pct", "ge"),
        ("day_range_pos", "max_day_range_pos", "le"),
    ],
    "TYPE4_FRONT_LOADED": [
        ("em_coverage", "min_em_coverage", "ge"),
    ],
    "TYPE5_GAP_FREEZE": [
        ("gap_pct", "min_gap_pct", "ge"),
        ("gap_pct", "max_gap_pct", "le"),
        ("freeze_streak", "min_freeze_streak", "ge"),
    ],
    "FNO1_HOD_EXHAUSTION_SHORT": [
        ("day_range_pos", "min_day_range_pos", "ge"),
        ("chg_from_open_pct", "min_chg_from_open_pct", "ge"),
        ("candle_body_fade", "max_candle_body_fade", "le"),
        ("vol_pace_45", "max_vol_pace_45", "le"),
    ],
    "FNO2_VWAP_SNAPBACK_SHORT": [
        ("vwap_z", "min_vwap_z", "ge"),
        ("day_range_pos", "min_day_range_pos", "ge"),
        ("candle_body_fade", "max_candle_body_fade", "le"),
    ],
    "FNO3_GAP_EXHAUSTION_SHORT": [
        ("gap_pct", "min_gap_pct", "ge"),
        ("day_range_pos", "min_day_range_pos", "ge"),
    ],
}


def _val(features: dict, key: str) -> Optional[float]:
    v = features.get(key)
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) else v


def _check(features: dict, rule_set: str, cfg: dict) -> tuple:
    """Return (passed, evidence) for one rule set. Missing/NaN features fail."""
    evidence = {}
    for feat, thr_key, op in _RULES[rule_set]:
        v = _val(features, feat)
        thr = cfg[thr_key]
        evidence[feat] = v
        if v is None:
            return False, evidence
        if op == "ge" and not v >= thr:
            return False, evidence
        if op == "le" and not v <= thr:
            return False, evidence
    return True, evidence


def _type1_body_ok(features: dict) -> bool:
    cfg = CONFIG["type1_accumulator"]
    body = _val(features, "body_open30")
    atr = _val(features, "d_atr14")
    if body is None or atr is None or atr <= 0:
        return False
    return (body / atr) <= cfg["max_body_open30_to_atr"]


def _in_cash_window(minutes_since_open: Optional[float]) -> bool:
    lo, hi = CONFIG["decision_windows"]["cash_scan_minutes"]
    return minutes_since_open is not None and lo <= minutes_since_open <= hi


def _in_fno_window(minutes_since_open: Optional[float]) -> bool:
    w = CONFIG["decision_windows"]
    return (minutes_since_open is not None
            and w["fno_scan_start_minute"] <= minutes_since_open <= w["fno_scan_end_minute"])


def classify_cash(features: dict) -> dict:
    """Classify one stock snapshot in the morning cash decision window."""
    t1 = CONFIG["type1_accumulator"]
    t2 = CONFIG["type2_exhaustion_trap"]
    t3 = CONFIG["type3_pullback_continue"]
    t4 = CONFIG["type4_front_loaded"]
    t5 = CONFIG["type5_gap_freeze"]
    mins = _val(features, "minutes_since_open")
    gap = _val(features, "gap_pct")

    base = {"segment": "cash", "session_minutes": mins, "gap_pct": gap}

    # blockers first — a blocked stock can never be a long candidate.
    # Type 4 needs BOTH em_coverage AND the validated volume spike (evidence 2026-09:
    # em_coverage alone has no edge, so it no longer blocks on its own).
    ok4, ev4 = _check(features, "TYPE4_FRONT_LOADED", t4)
    vol_spike = (_val(features, "fc15_vol_ratio") or 0) >= t2["min_fc15_vol_ratio"]
    if ok4 and mins is not None and mins <= t4["max_minutes_since_open"] \
            and (vol_spike or not t4.get("require_volume_spike")):
        return {**base, "type_id": "TYPE4_FRONT_LOADED", **t4, "evidence": ev4}

    # Type 2: VOLUME leg is the validated trigger (t=-2.93); the 3% gap leg was
    # disproven (mildly bullish) and is now a 5% threshold in config.
    if vol_spike or (gap is not None and gap > t2["min_gap_pct"]):
        ev2 = {**ev4, "fc15_vol_ratio": _val(features, "fc15_vol_ratio"), "gap_pct": gap}
        return {**base, "type_id": "TYPE2_EXHAUSTION_TRAP", **t2, "evidence": ev2}

    if not _in_cash_window(mins):
        return {**base, "type_id": "NONE", "direction": "NONE", "priority": 9,
                "evidence": {"reason": "outside_cash_window"}}

    ok1, ev1 = _check(features, "TYPE1_ACCUMULATOR", t1)
    if ok1 and _type1_body_ok(features):
        return {**base, "type_id": "TYPE1_ACCUMULATOR", **t1, "evidence": ev1}

    ok3, ev3 = _check(features, "TYPE3_PULLBACK_CONTINUE", t3)
    if ok3 and mins is not None and mins >= t3["min_minutes_since_open"]:
        return {**base, "type_id": "TYPE3_PULLBACK_CONTINUE", **t3, "evidence": ev3}

    ok5, ev5 = _check(features, "TYPE5_GAP_FREEZE", t5)
    if ok5:
        return {**base, "type_id": "TYPE5_GAP_FREEZE", **t5, "evidence": ev5}

    return {**base, "type_id": "NONE", "direction": "NONE", "priority": 9, "evidence": {}}


def classify_fno(features: dict) -> dict:
    """Classify one stock snapshot in the F&O scan window (10:30 onward)."""
    f1 = CONFIG["fno1_hod_exhaustion_short"]
    f2 = CONFIG["fno2_vwap_snapback_short"]
    f3 = CONFIG["fno3_gap_exhaustion_short"]
    mins = _val(features, "minutes_since_open")
    base = {"segment": "fno", "session_minutes": mins}

    if not _in_fno_window(mins):
        return {**base, "type_id": "NONE", "direction": "NONE", "priority": 9,
                "evidence": {"reason": "outside_fno_window"}}

    ok1, ev1 = _check(features, "FNO1_HOD_EXHAUSTION_SHORT", f1)
    if ok1:
        return {**base, "type_id": "FNO1_HOD_EXHAUSTION_SHORT", **f1, "evidence": ev1}
    ok2, ev2 = _check(features, "FNO2_VWAP_SNAPBACK_SHORT", f2)
    if ok2:
        return {**base, "type_id": "FNO2_VWAP_SNAPBACK_SHORT", **f2, "evidence": ev2}
    ok3, ev3 = _check(features, "FNO3_GAP_EXHAUSTION_SHORT", f3)
    if ok3:
        return {**base, "type_id": "FNO3_GAP_EXHAUSTION_SHORT", **f3, "evidence": ev3}
    # F&O Type 4 = cash accumulator rules on the F&O universe
    t1 = CONFIG["type1_accumulator"]
    ok4, ev4 = _check(features, "TYPE1_ACCUMULATOR", t1)
    if ok4 and _type1_body_ok(features):
        return {**base, "type_id": "FNO4_ACCUMULATION_LONG",
                "direction": t1["direction"], "priority": t1["priority"], "evidence": ev4}

    return {**base, "type_id": "NONE", "direction": "NONE", "priority": 9, "evidence": {}}


def classify(features: dict, segment: str = "cash") -> dict:
    return classify_fno(features) if segment == "fno" else classify_cash(features)


def row_features(row) -> dict:
    """Extract the classifier's feature dict from a pandas row (panel or live)."""
    keys = ["minutes_since_open", "gap_pct", "low_vs_open", "day_range_pos",
            "chg_from_open_pct", "fc_range_pct", "fc15_vol_ratio", "vol_pace_45",
            "vol_stab_45", "body_open30", "d_atr14", "candle_body_fade", "em_coverage",
            "freeze_streak", "push_from_open_pct", "low6_vs_open_pct", "pb_vol_ratio",
            "dist_vwap_pct", "vwap_z", "close", "atr_14"]
    return {k: row.get(k) for k in keys}
