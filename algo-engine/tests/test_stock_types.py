"""Unit tests for the stock-type classifier (docs/algo/strategy_brief.md math)."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from screener.stock_types import CONFIG, classify_cash, classify_fno  # noqa: E402

MORNING = 75  # 10:00 AM


def f(**kw):
    base = {
        "minutes_since_open": MORNING, "gap_pct": 0.2, "low_vs_open": 0.999,
        "day_range_pos": 0.35, "chg_from_open_pct": 1.0, "fc_range_pct": 0.6,
        "fc15_vol_ratio": 1.5, "vol_pace_45": 1.0, "vol_stab_45": 0.6,
        "body_open30": 2.0, "d_atr14": 10.0, "candle_body_fade": 0.8,
        "em_coverage": 0.4, "freeze_streak": 0, "push_from_open_pct": 1.5,
        "low6_vs_open_pct": 0.2, "pb_vol_ratio": 0.5, "dist_vwap_pct": 0.4,
        "vwap_z": 0.3, "close": 100.0, "atr_14": 0.8,
    }
    base.update(kw)
    return base


class TestType1Accumulator:
    def test_perfect_silent_accumulator(self):
        # Evidence 2026-09: Type 1 has NO directional edge (-0.115%, t=-2.76).
        # It must still be LABELLED (for learning/UI) but surfaced as watch-only.
        r = classify_cash(f())
        assert r["type_id"] == "TYPE1_ACCUMULATOR"
        assert r["direction"] == "LONG"
        assert r["priority"] == 0
        assert r["action"] == "WATCH_ONLY_NO_EDGE"

    def test_low_broke_below_open_rejects(self):
        assert classify_cash(f(low_vs_open=0.99))["type_id"] != "TYPE1_ACCUMULATOR"

    def test_already_at_top_of_range_rejects(self):
        assert classify_cash(f(day_range_pos=0.8))["type_id"] != "TYPE1_ACCUMULATOR"

    def test_big_first_candle_rejects(self):
        assert classify_cash(f(fc_range_pct=2.5))["type_id"] != "TYPE1_ACCUMULATOR"

    def test_body_too_large_vs_atr_rejects(self):
        # "small candles": opening-30m bodies must stay < 0.4 x prior-day ATR
        assert classify_cash(f(body_open30=5.0, d_atr14=10.0))["type_id"] != "TYPE1_ACCUMULATOR"


class TestType2ExhaustionTrap:
    def test_volume_spike_is_the_trap_trigger(self):
        # Evidence: first-15m volume >= 8x is the ROBUST signal (t=-2.93, negative 4/4 yrs)
        r = classify_cash(f(fc15_vol_ratio=25.0))
        assert r["type_id"] == "TYPE2_EXHAUSTION_TRAP"
        assert "BLOCK" in r["action"]

    def test_large_gap_alone_still_traps(self):
        # gap > 5% only (3% gap was disproven: mildly bullish +0.110%)
        r = classify_cash(f(gap_pct=6.0))
        assert r["type_id"] == "TYPE2_EXHAUSTION_TRAP"

    def test_moderate_gap_is_NOT_a_trap(self):
        # the old 3% threshold removed mildly GOOD stocks - it must not fire now
        assert classify_cash(f(gap_pct=3.5, day_range_pos=0.9))["type_id"] != "TYPE2_EXHAUSTION_TRAP"

    def test_volume_trap_beats_accumulator(self):
        r = classify_cash(f(fc15_vol_ratio=25.0, low_vs_open=1.0))
        assert r["type_id"] == "TYPE2_EXHAUSTION_TRAP"


class TestType4FrontLoaded:
    def test_front_loaded_requires_volume_spike_now(self):
        # evidence: em_coverage alone has no edge (+0.022%), so it cannot block alone
        assert classify_cash(f(minutes_since_open=15, em_coverage=0.95))["type_id"] != "TYPE4_FRONT_LOADED"

    def test_front_loaded_with_volume_spike_blocks(self):
        r = classify_cash(f(minutes_since_open=15, em_coverage=0.95, fc15_vol_ratio=20.0))
        assert r["action"] in ("BLOCK_ALL", "BLOCK_LONG_SCALP_SHORT")


class TestType3PullbackContinue:
    def test_clean_pullback(self):
        r = classify_cash(f(day_range_pos=0.55, chg_from_open_pct=1.8,
                            push_from_open_pct=2.2, low6_vs_open_pct=0.3, pb_vol_ratio=0.4))
        assert r["type_id"] == "TYPE3_PULLBACK_CONTINUE"

    def test_pullback_below_open_rejects(self):
        assert classify_cash(f(low6_vs_open_pct=-0.5))["type_id"] != "TYPE3_PULLBACK_CONTINUE"

    def test_pullback_volume_high_rejects(self):
        assert classify_cash(f(pb_vol_ratio=1.4))["type_id"] != "TYPE3_PULLBACK_CONTINUE"

    def test_below_vwap_rejects(self):
        assert classify_cash(f(dist_vwap_pct=-0.3))["type_id"] != "TYPE3_PULLBACK_CONTINUE"


class TestType5GapFreeze:
    def test_frozen_gap_stock_is_watch_only(self):
        # evidence: only 4 samples - cannot be promoted, kept to accumulate data
        r = classify_cash(f(gap_pct=2.5, freeze_streak=8, day_range_pos=0.9,
                            chg_from_open_pct=2.5, low_vs_open=1.0))
        assert r["type_id"] == "TYPE5_GAP_FREEZE"
        assert r["action"] == "WATCH_ONLY_INSUFFICIENT_SAMPLE"

    def test_no_freeze_no_type5(self):
        # day_range_pos 0.9 also rules out Type1/Type3 so the only possible hit is Type5
        assert classify_cash(f(gap_pct=2.5, freeze_streak=2, day_range_pos=0.9))["type_id"] == "NONE"


class TestWindowsAndNaN:
    def test_outside_cash_window_no_type(self):
        assert classify_cash(f(minutes_since_open=250))["type_id"] == "NONE"
        assert classify_cash(f(minutes_since_open=20))["type_id"] == "NONE"

    def test_nan_features_never_crash(self):
        row = f()
        row["low_vs_open"] = float("nan")
        row["pb_vol_ratio"] = None
        r = classify_cash(row)  # must not raise
        assert "type_id" in r

    def test_fno_window_gate(self):
        assert classify_fno(f(minutes_since_open=45))["type_id"] == "NONE"
        assert classify_fno(f(minutes_since_open=100))["type_id"] in ("NONE", "FNO4_ACCUMULATION_LONG")


class TestFnoSetups:
    def test_hod_exhaustion_short_labelled_watch_only(self):
        r = classify_fno(f(day_range_pos=0.96, chg_from_open_pct=3.0,
                           candle_body_fade=0.3, vol_pace_45=0.5))
        assert r["type_id"] == "FNO1_HOD_EXHAUSTION_SHORT"
        assert r["direction"] == "SHORT"
        assert r["action"] == "WATCH_ONLY_NO_EDGE"

    def test_vwap_snapback_short(self):
        r = classify_fno(f(day_range_pos=0.88, vwap_z=2.4, candle_body_fade=0.5,
                           chg_from_open_pct=1.0, vol_pace_45=1.0))
        assert r["type_id"] == "FNO2_VWAP_SNAPBACK_SHORT"

    def test_gap_exhaustion_short_needs_5pct_now(self):
        # 2.5% threshold removed; only >=5% gaps showed trap behaviour
        assert classify_fno(f(gap_pct=2.5, day_range_pos=0.9))["type_id"] != "FNO3_GAP_EXHAUSTION_SHORT"
        assert classify_fno(f(gap_pct=6.0, day_range_pos=0.9))["type_id"] == "FNO3_GAP_EXHAUSTION_SHORT"

    def test_fno_accumulation_long(self):
        r = classify_fno(f())
        assert r["type_id"] == "FNO4_ACCUMULATION_LONG"
        assert r["direction"] == "LONG"

    def test_fno1_beats_fno3_when_both_fire(self):
        r = classify_fno(f(gap_pct=3.5, day_range_pos=0.96, chg_from_open_pct=3.0,
                           candle_body_fade=0.3, vol_pace_45=0.5))
        assert r["type_id"] == "FNO1_HOD_EXHAUSTION_SHORT"


class TestConfigIntegrity:
    def test_all_detectors_present(self):
        for key in ("type1_accumulator", "type2_exhaustion_trap", "type3_pullback_continue",
                    "type4_front_loaded", "type5_gap_freeze", "fno1_hod_exhaustion_short",
                    "fno2_vwap_snapback_short", "fno3_gap_exhaustion_short"):
            assert key in CONFIG

    def test_no_edge_detectors_are_watch_only(self):
        """Evidence 2026-09: every shape-based detector failed significance testing
        and must not be presented as a tradeable candidate."""
        for key in ("type1_accumulator", "type3_pullback_continue", "type5_gap_freeze",
                    "fno1_hod_exhaustion_short", "fno2_vwap_snapback_short",
                    "fno3_gap_exhaustion_short", "fno4_accumulation_long"):
            assert CONFIG[key]["priority"] == 0, f"{key} must be demoted to watch-only"
            assert "WATCH_ONLY" in CONFIG[key]["action"]

    def test_volume_blocker_remains_active(self):
        """The first-15m volume spike is the one validated signal and must stay live."""
        assert CONFIG["type2_exhaustion_trap"]["priority"] == 0
        assert CONFIG["type2_exhaustion_trap"]["min_fc15_vol_ratio"] == 8.0
        assert CONFIG["type2_exhaustion_trap"]["min_gap_pct"] == 5.0
